-- ============================================================================
-- migration_015_seguranca_concorrencia.sql
-- Proteções atômicas para agenda cirúrgica e rate limit do login da cliente.
-- Execute no SQL Editor do Supabase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Rate limit persistente para tentativas de login.
-- A chave armazenada deve ser um HMAC gerado pela aplicação; nenhum IP/CPF
-- bruto precisa ser persistido.
-- ----------------------------------------------------------------------------
create table if not exists login_rate_limits (
  chave text primary key,
  falhas int not null default 0,
  janela_iniciada_em timestamptz not null default now(),
  bloqueado_ate timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function login_pode_tentar(p_chave text, p_max_falhas int default 8, p_janela_segundos int default 900)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v login_rate_limits%rowtype;
begin
  select * into v from login_rate_limits where chave = p_chave for update;
  if not found then
    insert into login_rate_limits (chave) values (p_chave);
    return true;
  end if;

  if v.bloqueado_ate is not null and v.bloqueado_ate > now() then
    return false;
  end if;

  if v.janela_iniciada_em <= now() - make_interval(secs => p_janela_segundos) then
    update login_rate_limits
      set falhas = 0, janela_iniciada_em = now(), bloqueado_ate = null, updated_at = now()
      where chave = p_chave;
    return true;
  end if;

  return v.falhas < p_max_falhas;
end;
$$;

create or replace function login_registrar_falha(p_chave text, p_max_falhas int default 8, p_janela_segundos int default 900)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v login_rate_limits%rowtype;
  v_falhas int;
begin
  select * into v from login_rate_limits where chave = p_chave for update;
  if not found then
    insert into login_rate_limits (chave, falhas) values (p_chave, 1);
    return true;
  end if;

  if v.janela_iniciada_em <= now() - make_interval(secs => p_janela_segundos) then
    update login_rate_limits
      set falhas = 1, janela_iniciada_em = now(), bloqueado_ate = null, updated_at = now()
      where chave = p_chave;
    return true;
  end if;

  v_falhas := v.falhas + 1;
  update login_rate_limits
    set falhas = v_falhas,
        bloqueado_ate = case when v_falhas >= p_max_falhas then now() + make_interval(secs => p_janela_segundos) else bloqueado_ate end,
        updated_at = now()
    where chave = p_chave;

  return v_falhas < p_max_falhas;
end;
$$;

create or replace function login_limpar_rate_limit(p_chave text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from login_rate_limits where chave = p_chave;
$$;

revoke all on function login_pode_tentar(text, int, int) from public, anon, authenticated;
revoke all on function login_registrar_falha(text, int, int) from public, anon, authenticated;
revoke all on function login_limpar_rate_limit(text) from public, anon, authenticated;
grant execute on function login_pode_tentar(text, int, int) to service_role;
grant execute on function login_registrar_falha(text, int, int) to service_role;
grant execute on function login_limpar_rate_limit(text) to service_role;

-- ----------------------------------------------------------------------------
-- Agendamento cirúrgico atômico: trava a data de liberação antes de contar
-- ocupação e atualizar o agendamento.
-- ----------------------------------------------------------------------------
create or replace function agendar_cirurgia_data(
  p_agendamento_id uuid,
  p_data date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data datas_liberacao_financeira%rowtype;
  v_ocupadas int;
begin
  select * into v_data
    from datas_liberacao_financeira
    where data = p_data
    for update;

  if not found or v_data.status <> 'disponivel' then
    raise exception using errcode = 'P0010', message = 'DATA_CIRURGIA_INDISPONIVEL';
  end if;

  select count(*)::int into v_ocupadas
    from agendamentos
    where status = 'confirmado'
      and previsao_liberacao_financeira = p_data
      and id <> p_agendamento_id;

  if v_ocupadas >= 1 then
    raise exception using errcode = 'P0011', message = 'DATA_CIRURGIA_OCUPADA';
  end if;

  update agendamentos
    set previsao_liberacao_financeira = p_data
    where id = p_agendamento_id
      and status = 'confirmado';

  if not found then
    raise exception using errcode = 'P0012', message = 'AGENDAMENTO_NAO_ENCONTRADO';
  end if;
end;
$$;

revoke all on function agendar_cirurgia_data(uuid, date) from public, anon, authenticated;
grant execute on function agendar_cirurgia_data(uuid, date) to service_role;
