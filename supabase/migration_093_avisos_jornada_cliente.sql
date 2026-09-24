-- ============================================================================
-- MIGRATION 093: Avisos da jornada da cliente (agenda, pagamentos, clube)
-- ============================================================================
-- Um caminho único para avisar a cliente: public.notificar_cliente() grava o
-- aviso no app (notificacoes_cliente) e o registro de envio (notificacao_logs,
-- push_status = 'pendente'); o Worker entrega o Web Push
-- (worker/notificacoes-despacho.ts). Os textos ficam em notificacao_eventos,
-- editáveis em Configurações > Notificações; o catálogo padrão vem de
-- worker/notificacao-eventos-padrao.ts.
--
-- Disparos:
--   * boletos: comprovante recebido/recusado, pagamento confirmado, plano quitado
--     e os avisos do Clube (substitui os INSERTs diretos das funções do Clube);
--   * agendamentos: termos agendados/remarcados/cancelados/assinados, quitação,
--     agenda cirúrgica liberada, previsões, cirurgia agendada/remarcada, conclusão;
--   * clientes: revisão financeira aprovada/recusada;
--   * solicitacoes_liberacao_financeira: em análise/aprovada/recusada;
--   * pg_cron diário (08:00 de Brasília): véspera/dia da assinatura, véspera da cirurgia.
-- Um aviso nunca derruba a operação que o disparou (falhas viram WARNING).
--
-- Rollback: drop dos gatilhos trg_notificar_*, unschedule do job
-- notificacoes-lembretes-agenda e reaplicação das funções do Clube da
-- migration_083 / 075 (inserts diretos).

-- ---------------------------------------------------------------------------
-- 1. Catálogo editável dos avisos
-- ---------------------------------------------------------------------------
create table if not exists public.notificacao_eventos (
  chave text primary key,
  categoria text not null check (categoria in ('pagamentos', 'agenda', 'jornada', 'clube')),
  nome text not null,
  quando text not null,
  destino text not null,
  titulo text not null,
  corpo text not null,
  emoji text,
  variaveis text[] not null default array['nome'],
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notificacao_eventos enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Deduplicação dos avisos (um aviso por evento/chave)
-- ---------------------------------------------------------------------------
alter table public.notificacoes_cliente add column if not exists evento text;
alter table public.notificacoes_cliente add column if not exists chave_dedupe text;
create unique index if not exists ux_notificacoes_cliente_evento_dedupe
  on public.notificacoes_cliente (cliente_id, evento, chave_dedupe)
  where chave_dedupe is not null;
create index if not exists idx_notificacao_logs_push_pendente
  on public.notificacao_logs (created_at)
  where push_status = 'pendente';

-- ---------------------------------------------------------------------------
-- 3. Caminho único: grava o aviso no app + registro para o Web Push
-- ---------------------------------------------------------------------------
create or replace function public.notificar_cliente(
  p_cliente_id uuid,
  p_evento text,
  p_vars jsonb default '{}'::jsonb,
  p_referencia_id uuid default null,
  p_chave_dedupe text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev public.notificacao_eventos%rowtype;
  v_nome text;
  v_vars jsonb;
  v_titulo text;
  v_corpo text;
  v_k text;
  v_v text;
  v_id uuid;
  v_url text;
  v_segredo text;
begin
  if p_cliente_id is null or p_evento is null then return null; end if;
  select * into v_ev from public.notificacao_eventos where chave = p_evento;
  if not found or not v_ev.is_active then return null; end if;

  select initcap(lower(split_part(btrim(nome_completo), ' ', 1))) into v_nome from public.clientes where id = p_cliente_id;
  v_vars := jsonb_build_object('nome', coalesce(nullif(v_nome, ''), 'cliente')) || coalesce(p_vars, '{}'::jsonb);
  v_titulo := v_ev.titulo;
  v_corpo := v_ev.corpo;
  for v_k, v_v in select key, value from jsonb_each_text(v_vars) loop
    v_titulo := replace(v_titulo, '{{' || v_k || '}}', coalesce(v_v, ''));
    v_corpo := replace(v_corpo, '{{' || v_k || '}}', coalesce(v_v, ''));
  end loop;
  v_titulo := btrim(regexp_replace(v_titulo, '\{\{[a-z_]+\}\}', '', 'g'));
  v_corpo := btrim(regexp_replace(v_corpo, '\{\{[a-z_]+\}\}', '', 'g'));

  insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id, evento, chave_dedupe)
  values (
    p_cliente_id,
    case v_ev.categoria when 'pagamentos' then 'parcela' else v_ev.categoria end,
    v_titulo, v_corpo, coalesce(v_ev.emoji, '🔔'), v_ev.destino, p_referencia_id, p_evento, p_chave_dedupe
  )
  on conflict (cliente_id, evento, chave_dedupe) where chave_dedupe is not null do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  insert into public.notificacao_logs (cliente_id, notificacao_id, referencia_id, tipo, titulo, corpo, status, push_enviadas, push_falhas, push_status)
  values (p_cliente_id, v_id, p_referencia_id, 'evento:' || p_evento, v_titulo, v_corpo, 'enviada', 0, 0, 'pendente');

  -- Entrega imediata do Web Push quando o endereço do app e o segredo da
  -- rotina estão no Vault. Sem eles, o Worker entrega na próxima passagem.
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sra_luck_app_url';
    select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'sra_luck_cron_secret';
    if v_url ~ '^https://' and v_segredo is not null then
      perform net.http_post(
        url := rtrim(v_url, '/') || '/api/internal/notificacoes/despachar',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_segredo),
        body := jsonb_build_object('notificacaoId', v_id),
        timeout_milliseconds := 20000
      );
    end if;
  exception when others then
    null;
  end;

  return v_id;
exception when others then
  -- Aviso nunca derruba a operação que o disparou (pagamento, agenda, clube).
  raise warning 'notificar_cliente(%) falhou: %', p_evento, sqlerrm;
  return null;
end;
$$;

revoke all on function public.notificar_cliente(uuid, text, jsonb, uuid, text) from public, anon;
grant execute on function public.notificar_cliente(uuid, text, jsonb, uuid, text) to authenticated, service_role;

create or replace function public.notificacao_data_br(p_data date)
returns text language sql immutable set search_path = '' as $$
  select case when p_data is null then '' else to_char(p_data, 'DD/MM/YYYY') end
$$;

create or replace function public.notificacao_horario_br(p_hora time)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_hora is null then ''
    when extract(minute from p_hora) = 0 then ' às ' || to_char(p_hora, 'FMHH24') || 'h'
    else ' às ' || to_char(p_hora, 'FMHH24') || 'h' || to_char(p_hora, 'MI')
  end
$$;

create or replace function public.notificacao_motivo(p_texto text)
returns text language sql immutable set search_path = '' as $$
  select case when nullif(btrim(p_texto), '') is null then '' else ' Motivo: ' || rtrim(btrim(p_texto), '.') || '.' end
$$;

-- ---------------------------------------------------------------------------
-- 4. Parcelas: comprovante, pagamento, quitação do plano + Clube
-- ---------------------------------------------------------------------------
create or replace function public.clube_notificar_boleto_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pontos_em_dia integer;
  v_ind record;
  v_total integer;
  v_pagas integer;
  v_abertas integer;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'pendente_confirmacao' then
    perform public.notificar_cliente(new.cliente_id, 'comprovante_recebido',
      jsonb_build_object('parcela', new.numero_parcela::text, 'total', coalesce(new.total_parcelas::text, '—')), new.id, null);
  elsif new.status = 'pago' then
    perform public.notificar_cliente(new.cliente_id, 'pagamento_confirmado',
      jsonb_build_object('parcela', new.numero_parcela::text, 'total', coalesce(new.total_parcelas::text, '—')), new.id, 'boleto:' || new.id::text);

    -- Plano quitado: todas as parcelas do contrato pagas (conta pelo total do plano, não só pelos boletos importados).
    select coalesce(c.quantidade_parcelas, new.total_parcelas) into v_total from public.clientes c where c.id = new.cliente_id;
    select count(*) filter (where b.status = 'pago'), count(*) filter (where b.status <> 'pago')
      into v_pagas, v_abertas
      from public.boletos b where b.cliente_id = new.cliente_id;
    if v_total is not null and v_total > 0 and v_abertas = 0 and v_pagas >= v_total then
      perform public.notificar_cliente(new.cliente_id, 'plano_quitado', jsonb_build_object('total', v_total::text), new.id, 'plano');
    end if;

    if new.numero_parcela = 1 then
      perform public.clube_conceder_bonus_primeira_parcela(new.cliente_id, new.id);

      for v_ind in
        select id from public.indicacoes_clientes
        where indicado_cliente_id = new.cliente_id and status = 'venda' and pontos_creditados = 0
      loop
        perform public.clube_avaliar_indicacao(v_ind.id);
      end loop;
    end if;

    -- Parcela em dia: pagamento até o vencimento (data de São Paulo quando a
    -- data do pagamento não foi informada).
    if new.data_vencimento is not null
       and coalesce(new.data_pagamento, (now() at time zone 'America/Sao_Paulo')::date) <= new.data_vencimento then
      select pontos_parcela_em_dia into v_pontos_em_dia from public.clube_config where id = 1;
      if public.clube_creditar_pontos(
        new.cliente_id, 'bonus', coalesce(v_pontos_em_dia, 0), 'parcela_em_dia', new.id::text,
        jsonb_build_object('numero_parcela', new.numero_parcela)
      ) then
        perform public.notificar_cliente(new.cliente_id, 'clube_pontos_parcela_em_dia',
          jsonb_build_object('parcela', new.numero_parcela::text, 'pontos', coalesce(v_pontos_em_dia, 0)::text), new.id, 'pontos_em_dia:' || new.id::text);
      end if;
    end if;
  elsif new.status = 'rejeitado' then
    perform public.notificar_cliente(new.cliente_id, 'comprovante_rejeitado',
      jsonb_build_object('parcela', new.numero_parcela::text, 'total', coalesce(new.total_parcelas::text, '—'), 'motivo', public.notificacao_motivo(new.observacoes)), new.id, null);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Agenda: termos, quitação, liberação, previsões, cirurgia, conclusão
-- ---------------------------------------------------------------------------
create or replace function public.notificar_agendamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data date;
  v_data_antiga date;
  v_chave text := 'ag:' || new.id::text;
begin
  select d.data into v_data from public.datas d where d.id = new.data_id;

  if tg_op = 'INSERT' then
    if new.status = 'confirmado' then
      perform public.notificar_cliente(new.cliente_id, 'termos_agendados',
        jsonb_build_object('data', public.notificacao_data_br(v_data), 'horario', public.notificacao_horario_br(new.horario_termos)), new.id, v_chave || ':agendado');
    end if;
    return new;
  end if;

  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    perform public.notificar_cliente(new.cliente_id, 'termos_cancelados',
      jsonb_build_object('data', public.notificacao_data_br(v_data)), new.id, v_chave || ':cancelado');
    return new;
  end if;

  if new.status = 'confirmado' and (new.data_id is distinct from old.data_id or new.horario_termos is distinct from old.horario_termos)
     and coalesce(new.comparecimento_status, 'pendente') <> 'compareceu' then
    select d.data into v_data_antiga from public.datas d where d.id = old.data_id;
    if v_data is distinct from v_data_antiga or new.horario_termos is distinct from old.horario_termos then
      perform public.notificar_cliente(new.cliente_id, 'termos_remarcados',
        jsonb_build_object('data', public.notificacao_data_br(v_data), 'horario', public.notificacao_horario_br(new.horario_termos)),
        new.id, v_chave || ':termos:' || coalesce(v_data::text, '') || coalesce(new.horario_termos::text, ''));
    end if;
  end if;

  if (new.comparecimento_status = 'compareceu' and old.comparecimento_status is distinct from 'compareceu')
     or (new.termos_assinados_em is not null and old.termos_assinados_em is null) then
    perform public.notificar_cliente(new.cliente_id, 'termos_assinados', '{}'::jsonb, new.id, v_chave || ':assinados');
  end if;

  if new.quitacao_status = 'paga' and old.quitacao_status is distinct from 'paga' then
    perform public.notificar_cliente(new.cliente_id, 'quitacao_confirmada', '{}'::jsonb, new.id, v_chave || ':quitacao');
  end if;

  if new.agenda_cirurgica_liberada_em is not null and old.agenda_cirurgica_liberada_em is null then
    perform public.notificar_cliente(new.cliente_id, 'agenda_cirurgica_liberada', '{}'::jsonb, new.id, v_chave || ':liberada');
  end if;

  if new.previsao_liberacao_financeira is not null and new.previsao_liberacao_financeira is distinct from old.previsao_liberacao_financeira then
    perform public.notificar_cliente(new.cliente_id, 'previsao_liberacao',
      jsonb_build_object('data', public.notificacao_data_br(new.previsao_liberacao_financeira)), new.id, v_chave || ':prev_lib:' || new.previsao_liberacao_financeira::text);
  end if;

  if new.previsao_cirurgia is not null and new.previsao_cirurgia is distinct from old.previsao_cirurgia and new.data_cirurgia is null then
    perform public.notificar_cliente(new.cliente_id, 'previsao_cirurgia',
      jsonb_build_object('data', public.notificacao_data_br(new.previsao_cirurgia)), new.id, v_chave || ':prev_cir:' || new.previsao_cirurgia::text);
  end if;

  if new.data_cirurgia is not null and (new.data_cirurgia is distinct from old.data_cirurgia or new.horario_cirurgia is distinct from old.horario_cirurgia) then
    perform public.notificar_cliente(new.cliente_id,
      case when old.data_cirurgia is null then 'cirurgia_agendada' else 'cirurgia_remarcada' end,
      jsonb_build_object('data', public.notificacao_data_br(new.data_cirurgia), 'horario', public.notificacao_horario_br(new.horario_cirurgia)),
      new.id, v_chave || ':cirurgia:' || new.data_cirurgia::text || coalesce(new.horario_cirurgia::text, ''));
  end if;

  if new.processo_concluido_em is not null and old.processo_concluido_em is null then
    perform public.notificar_cliente(new.cliente_id, 'processo_concluido', '{}'::jsonb, new.id, v_chave || ':concluido');
  end if;

  return new;
exception when others then
  raise warning 'notificar_agendamento falhou: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_notificar_agendamento on public.agendamentos;
create trigger trg_notificar_agendamento
  after insert or update on public.agendamentos
  for each row execute function public.notificar_agendamento();

-- ---------------------------------------------------------------------------
-- 6. Revisão financeira e liberação financeira
-- ---------------------------------------------------------------------------
create or replace function public.notificar_revisao_financeira()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status_revisao_financeira is not distinct from old.status_revisao_financeira then return new; end if;
  if new.status_revisao_financeira = 'aprovada' then
    perform public.notificar_cliente(new.id, 'revisao_aprovada', '{}'::jsonb, null,
      'revisao:aprovada:' || coalesce(new.data_atingiu_percentual::text, ''));
  elsif new.status_revisao_financeira = 'recusada' then
    perform public.notificar_cliente(new.id, 'revisao_recusada',
      jsonb_build_object('motivo', public.notificacao_motivo(new.observacao_revisao_financeira)), null, null);
  end if;
  return new;
exception when others then
  raise warning 'notificar_revisao_financeira falhou: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_notificar_revisao_financeira on public.clientes;
create trigger trg_notificar_revisao_financeira
  after update of status_revisao_financeira on public.clientes
  for each row execute function public.notificar_revisao_financeira();

create or replace function public.notificar_liberacao_financeira()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'em_analise' then
    perform public.notificar_cliente(new.cliente_id, 'liberacao_em_analise', '{}'::jsonb, new.id, 'liberacao:' || new.id::text || ':em_analise');
  elsif new.status = 'aprovada' then
    perform public.notificar_cliente(new.cliente_id, 'liberacao_aprovada', '{}'::jsonb, new.id, 'liberacao:' || new.id::text || ':aprovada');
  elsif new.status = 'recusada' then
    perform public.notificar_cliente(new.cliente_id, 'liberacao_recusada',
      jsonb_build_object('motivo', public.notificacao_motivo(new.observacao)), new.id, 'liberacao:' || new.id::text || ':recusada');
  end if;
  return new;
exception when others then
  raise warning 'notificar_liberacao_financeira falhou: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_notificar_liberacao_financeira on public.solicitacoes_liberacao_financeira;
create trigger trg_notificar_liberacao_financeira
  after update of status on public.solicitacoes_liberacao_financeira
  for each row execute function public.notificar_liberacao_financeira();

-- ---------------------------------------------------------------------------
-- 7. Lembretes diários (08:00 de Brasília): véspera e dia da assinatura,
--    véspera da cirurgia. A chave de deduplicação impede repetição.
-- ---------------------------------------------------------------------------
create or replace function public.notificacoes_lembretes_agenda()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_total integer := 0;
  r record;
begin
  for r in
    select a.id, a.cliente_id, d.data, a.horario_termos
    from public.agendamentos a
    join public.datas d on d.id = a.data_id
    join public.clientes c on c.id = a.cliente_id
    where a.status = 'confirmado'
      and coalesce(a.comparecimento_status, 'pendente') <> 'compareceu'
      and d.data in (v_hoje, v_hoje + 1)
      and c.ativo is not false
  loop
    if public.notificar_cliente(r.cliente_id,
      case when r.data = v_hoje then 'termos_lembrete_dia' else 'termos_lembrete_vespera' end,
      jsonb_build_object('data', public.notificacao_data_br(r.data), 'horario', public.notificacao_horario_br(r.horario_termos)),
      r.id, 'lembrete:' || r.id::text || ':' || r.data::text || ':' || case when r.data = v_hoje then 'dia' else 'vespera' end) is not null then
      v_total := v_total + 1;
    end if;
  end loop;

  for r in
    select a.id, a.cliente_id, a.data_cirurgia
    from public.agendamentos a
    join public.clientes c on c.id = a.cliente_id
    where a.status <> 'cancelado'
      and a.data_cirurgia = v_hoje + 1
      and c.ativo is not false
  loop
    if public.notificar_cliente(r.cliente_id, 'cirurgia_lembrete_vespera', '{}'::jsonb, r.id,
      'lembrete:' || r.id::text || ':cirurgia:' || r.data_cirurgia::text) is not null then
      v_total := v_total + 1;
    end if;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.notificacoes_lembretes_agenda() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('notificacoes-lembretes-agenda') where exists (select 1 from cron.job where jobname = 'notificacoes-lembretes-agenda');
  perform cron.schedule('notificacoes-lembretes-agenda', '0 11 * * *', 'select public.notificacoes_lembretes_agenda();');
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. Clube: mesma lógica das funções atuais; só o aviso passa pelo caminho único
-- ---------------------------------------------------------------------------
create or replace function public.clube_conceder_bonus_primeira_parcela(p_cliente_id uuid, p_boleto_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_config public.clube_config%rowtype;
  v_beneficio_id uuid;
begin
  select * into v_config from public.clube_config where id = 1;
  if not found or not v_config.voucher_primeira_parcela_ativo then return; end if;

  insert into public.clube_beneficios_cliente (cliente_id, beneficio_key, origem, referencia_id)
  values (p_cliente_id, 'voucher_consulta_doutor', 'primeira_parcela', p_boleto_id)
  on conflict (cliente_id, beneficio_key, origem) do nothing
  returning id into v_beneficio_id;

  if v_beneficio_id is null then return; end if;

  if v_config.pontos_primeira_parcela > 0 then
    insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
    values (p_cliente_id, 'bonus', v_config.pontos_primeira_parcela, p_boleto_id::text, jsonb_build_object('motivo', 'primeira_parcela'));

    insert into public.cliente_pontos (cliente_id, saldo, updated_at)
    values (p_cliente_id, v_config.pontos_primeira_parcela, now())
    on conflict (cliente_id) do update
      set saldo = public.cliente_pontos.saldo + excluded.saldo, updated_at = now();
  end if;

  perform public.notificar_cliente(p_cliente_id, 'clube_bonus_primeira_parcela',
    jsonb_build_object('pontos', v_config.pontos_primeira_parcela::text, 'beneficio', v_config.voucher_primeira_parcela_titulo),
    v_beneficio_id, 'beneficio:' || v_beneficio_id::text);
end;
$$;

create or replace function public.clube_avaliar_indicacao(p_indicacao_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_ind public.indicacoes_clientes%rowtype;
  v_pontos integer;
  v_creditou boolean;
begin
  select * into v_ind from public.indicacoes_clientes where id = p_indicacao_id for update;
  if not found or v_ind.status <> 'venda' or v_ind.indicado_cliente_id is null or v_ind.pontos_creditados > 0 then
    return false;
  end if;

  if not exists (
    select 1 from public.boletos
    where cliente_id = v_ind.indicado_cliente_id and numero_parcela = 1 and status = 'pago'
  ) then
    return false;
  end if;

  select pontos_indicacao_venda into v_pontos from public.clube_config where id = 1;
  v_creditou := public.clube_creditar_pontos(
    v_ind.indicador_cliente_id, 'indicacao', coalesce(v_pontos, 0), 'indicacao_venda', v_ind.id::text,
    jsonb_build_object('indicacao_id', v_ind.id, 'nome_indicado', v_ind.nome_indicado)
  );
  if not v_creditou then
    return false;
  end if;

  update public.indicacoes_clientes
  set pontos_creditados = v_pontos, pontos_creditados_em = now()
  where id = v_ind.id;

  perform public.notificar_cliente(v_ind.indicador_cliente_id, 'clube_indicacao_fechou',
    jsonb_build_object('indicada', coalesce(split_part(btrim(v_ind.nome_indicado), ' ', 1), 'Sua indicada'), 'pontos', coalesce(v_pontos, 0)::text),
    v_ind.id, 'indicacao:' || v_ind.id::text);

  return true;
end;
$$;

create or replace function public.clube_resgatar(p_cliente_id uuid, p_recompensa_id uuid, p_idempotency_key text)
returns public.clube_resgates
language plpgsql
set search_path = ''
as $$
declare
  v_recompensa public.clube_recompensas%rowtype;
  v_pontos public.cliente_pontos%rowtype;
  v_resgate public.clube_resgates%rowtype;
  v_saldo_atual integer;
begin
  if p_cliente_id is null or p_recompensa_id is null then raise exception 'Cliente e recompensa sao obrigatorios'; end if;
  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 120 then raise exception 'Chave de idempotencia invalida'; end if;

  perform pg_advisory_xact_lock(hashtextextended('clube_resgatar:' || p_idempotency_key, 0));

  select * into v_resgate from public.clube_resgates where idempotency_key = p_idempotency_key;
  if found then
    if v_resgate.cliente_id <> p_cliente_id or v_resgate.recompensa_id <> p_recompensa_id then
      raise exception 'Chave de idempotencia ja utilizada em outro resgate';
    end if;
    return v_resgate;
  end if;

  select * into v_recompensa from public.clube_recompensas
  where id = p_recompensa_id and ativo = true for update;
  if not found then raise exception 'Recompensa indisponivel'; end if;
  if v_recompensa.estoque is not null and v_recompensa.estoque <= 0 then raise exception 'Recompensa sem estoque disponivel'; end if;

  insert into public.cliente_pontos (cliente_id, saldo) values (p_cliente_id, 0)
  on conflict (cliente_id) do nothing;

  select * into v_pontos from public.cliente_pontos where cliente_id = p_cliente_id for update;
  v_saldo_atual := coalesce(v_pontos.saldo, 0);
  if v_saldo_atual < v_recompensa.pontos then raise exception 'Saldo de pontos insuficiente'; end if;

  update public.cliente_pontos set saldo = v_saldo_atual - v_recompensa.pontos, updated_at = now()
  where cliente_id = p_cliente_id;

  if v_recompensa.estoque is not null then
    update public.clube_recompensas set estoque = estoque - 1 where id = v_recompensa.id;
  end if;

  insert into public.clube_resgates (cliente_id, recompensa_id, pontos, status, idempotency_key)
  values (p_cliente_id, v_recompensa.id, v_recompensa.pontos, 'solicitado', p_idempotency_key)
  returning * into v_resgate;

  insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
  values (p_cliente_id, 'resgate', -v_recompensa.pontos, v_resgate.id::text,
    jsonb_build_object('recompensa_id', v_recompensa.id, 'titulo', v_recompensa.titulo));

  perform public.notificar_cliente(p_cliente_id, 'clube_resgate_solicitado',
    jsonb_build_object('recompensa', v_recompensa.titulo), v_resgate.id, 'resgate:' || v_resgate.id::text || ':solicitado');

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values ('cliente:' || p_cliente_id::text, 'solicitou_resgate_clube', 'clube_resgates', v_resgate.id,
    jsonb_build_object('cliente_id', p_cliente_id, 'recompensa_id', v_recompensa.id, 'pontos', v_recompensa.pontos, 'idempotency_key', p_idempotency_key));

  return v_resgate;
end;
$$;

create or replace function public.clube_atualizar_resgate(p_resgate_id uuid, p_status text, p_usuario text)
returns public.clube_resgates
language plpgsql
set search_path = ''
as $$
declare
  v_resgate public.clube_resgates%rowtype;
  v_recompensa public.clube_recompensas%rowtype;
begin
  if p_resgate_id is null then
    raise exception 'Resgate nao encontrado';
  end if;
  if p_status not in ('aprovado','separacao','entregue','cancelado') then
    raise exception 'Transicao de resgate invalida';
  end if;

  select * into v_resgate from public.clube_resgates where id = p_resgate_id for update;
  if not found then raise exception 'Resgate nao encontrado'; end if;
  if v_resgate.status = p_status then return v_resgate; end if;
  if v_resgate.status in ('entregue','cancelado') then raise exception 'Resgate ja finalizado'; end if;

  if not (
    (v_resgate.status = 'solicitado' and p_status in ('aprovado','cancelado')) or
    (v_resgate.status = 'aprovado' and p_status in ('separacao','cancelado')) or
    (v_resgate.status = 'separacao' and p_status in ('entregue','cancelado'))
  ) then raise exception 'Transicao de resgate invalida'; end if;

  select * into v_recompensa from public.clube_recompensas where id = v_resgate.recompensa_id for update;

  if p_status = 'cancelado' then
    insert into public.cliente_pontos (cliente_id, saldo)
    values (v_resgate.cliente_id, v_resgate.pontos)
    on conflict (cliente_id) do update
      set saldo = public.cliente_pontos.saldo + excluded.saldo,
          updated_at = now();

    if v_recompensa.estoque is not null then
      update public.clube_recompensas set estoque = estoque + 1 where id = v_resgate.recompensa_id;
    end if;

    insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
    values (
      v_resgate.cliente_id,'ajuste',v_resgate.pontos,v_resgate.id::text,
      jsonb_build_object('motivo','cancelamento_resgate','resgate_id',v_resgate.id,'recompensa_id',v_resgate.recompensa_id,'usuario',coalesce(nullif(btrim(p_usuario),''),'admin'))
    );
  end if;

  update public.clube_resgates set status = p_status, updated_at = now()
  where id = v_resgate.id returning * into v_resgate;

  perform public.notificar_cliente(v_resgate.cliente_id, 'clube_resgate_' || p_status,
    jsonb_build_object('recompensa', coalesce(v_recompensa.titulo, 'sua recompensa')), v_resgate.id, 'resgate:' || v_resgate.id::text || ':' || p_status);

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (
    coalesce(nullif(btrim(p_usuario),''),'admin'),'alterou_status_resgate_clube','clube_resgates',v_resgate.id,
    jsonb_build_object('status',p_status,'cliente_id',v_resgate.cliente_id,'recompensa_id',v_resgate.recompensa_id,'pontos',v_resgate.pontos)
  );
  return v_resgate;
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. Catálogo padrão (não sobrescreve textos já editados)
-- ---------------------------------------------------------------------------
insert into public.notificacao_eventos (chave, categoria, nome, quando, destino, titulo, corpo, emoji, variaveis) values
  ('comprovante_recebido', 'pagamentos', 'Comprovante recebido', 'A cliente envia o comprovante de uma parcela', 'parcelas', 'Recebemos seu comprovante', '{{nome}}, o comprovante da parcela {{parcela}}/{{total}} chegou e está em conferência. Avisamos assim que for confirmado.', '📎', array['nome', 'parcela', 'total']),
  ('pagamento_confirmado', 'pagamentos', 'Pagamento confirmado', 'A parcela é confirmada como paga', 'parcelas', 'Pagamento confirmado', '{{nome}}, a parcela {{parcela}}/{{total}} foi confirmada. Obrigada por manter seu plano em dia!', '✅', array['nome', 'parcela', 'total']),
  ('comprovante_rejeitado', 'pagamentos', 'Comprovante não aprovado', 'A equipe recusa o comprovante enviado', 'parcelas', 'Comprovante não aprovado', '{{nome}}, não conseguimos confirmar o comprovante da parcela {{parcela}}/{{total}}.{{motivo}} Envie outro pelo app ou fale com a equipe.', '⚠️', array['nome', 'parcela', 'total', 'motivo']),
  ('plano_quitado', 'pagamentos', 'Plano quitado', 'A última parcela em aberto é confirmada', 'parcelas', 'Seu plano está quitado!', '{{nome}}, todas as {{total}} parcelas do seu plano estão pagas. Que conquista! Obrigada por caminhar com a Sra. Luck.', '🎉', array['nome', 'total']),
  ('revisao_aprovada', 'jornada', 'Revisão financeira aprovada', 'A equipe aprova a revisão financeira da cliente', 'agenda', 'Você já pode agendar seus termos', '{{nome}}, sua revisão financeira foi aprovada. Escolha no app a data para assinar os termos da sua cirurgia.', '🌷', array['nome']),
  ('revisao_recusada', 'jornada', 'Revisão financeira com pendência', 'A equipe recusa a revisão financeira', 'agenda', 'Sua revisão precisa de um ajuste', '{{nome}}, sua revisão financeira ainda não pôde ser aprovada.{{motivo}} Fale com a nossa equipe para seguir.', '💬', array['nome', 'motivo']),
  ('liberacao_em_analise', 'jornada', 'Liberação financeira em análise', 'A solicitação de liberação financeira entra em análise', 'agenda', 'Sua solicitação está em análise', '{{nome}}, recebemos sua solicitação de liberação financeira e ela já está com a nossa equipe. Avisamos assim que houver resposta.', '🔎', array['nome']),
  ('liberacao_aprovada', 'jornada', 'Liberação financeira aprovada', 'A liberação financeira é aprovada', 'agenda', 'Liberação financeira aprovada', '{{nome}}, sua liberação financeira foi aprovada. Acompanhe os próximos passos da sua cirurgia pelo app.', '✨', array['nome']),
  ('liberacao_recusada', 'jornada', 'Liberação financeira não aprovada', 'A liberação financeira é recusada', 'agenda', 'Precisamos ajustar sua solicitação', '{{nome}}, sua solicitação de liberação financeira não pôde ser aprovada.{{motivo}} Nossa equipe está à disposição.', '💬', array['nome', 'motivo']),
  ('previsao_liberacao', 'jornada', 'Previsão de liberação', 'A equipe define ou altera a previsão de liberação financeira', 'jornada', 'Previsão de liberação atualizada', '{{nome}}, a previsão de liberação financeira da sua cirurgia é {{data}}. Qualquer mudança, avisamos por aqui.', '🗓️', array['nome', 'data']),
  ('termos_agendados', 'agenda', 'Assinatura agendada', 'A cliente agenda a assinatura dos termos', 'agenda', 'Assinatura dos termos agendada', '{{nome}}, sua assinatura dos termos está marcada para {{data}}{{horario}}. Te esperamos!', '🗓️', array['nome', 'data', 'horario']),
  ('termos_remarcados', 'agenda', 'Assinatura remarcada', 'A data ou o horário da assinatura muda', 'agenda', 'Sua assinatura foi remarcada', '{{nome}}, a assinatura dos termos agora é em {{data}}{{horario}}. Se não puder comparecer, fale com a equipe.', '🔁', array['nome', 'data', 'horario']),
  ('termos_cancelados', 'agenda', 'Assinatura cancelada', 'O agendamento dos termos é cancelado', 'agenda', 'Agendamento cancelado', '{{nome}}, o agendamento da assinatura em {{data}} foi cancelado. Se precisar, escolha uma nova data pelo app ou fale com a equipe.', '📅', array['nome', 'data']),
  ('termos_lembrete_vespera', 'agenda', 'Lembrete: véspera da assinatura', 'Rotina diária, um dia antes da assinatura', 'agenda', 'Amanhã é o dia da sua assinatura', '{{nome}}, amanhã ({{data}}{{horario}}) você assina os termos da sua cirurgia. Qualquer dúvida, fale com a equipe.', '⏰', array['nome', 'data', 'horario']),
  ('termos_lembrete_dia', 'agenda', 'Lembrete: dia da assinatura', 'Rotina diária, no dia da assinatura', 'agenda', 'Hoje é o dia da sua assinatura', '{{nome}}, hoje{{horario}} é a assinatura dos termos da sua cirurgia. Estamos te esperando!', '✨', array['nome', 'horario']),
  ('termos_assinados', 'agenda', 'Termos assinados', 'A equipe registra a assinatura dos termos', 'agenda', 'Termos assinados', 'Parabéns, {{nome}}! Seus termos foram assinados. Com a quitação confirmada, sua agenda cirúrgica é liberada em até 5 dias úteis.', '🖋️', array['nome']),
  ('quitacao_confirmada', 'agenda', 'Quitação confirmada', 'A equipe confirma a quitação do valor da cirurgia', 'agenda', 'Quitação confirmada', '{{nome}}, sua quitação foi confirmada. Sua agenda cirúrgica será liberada em até 5 dias úteis.', '💗', array['nome']),
  ('agenda_cirurgica_liberada', 'agenda', 'Agenda cirúrgica liberada', 'A agenda cirúrgica da cliente é liberada', 'agenda', 'Sua agenda cirúrgica foi liberada!', '{{nome}}, chegou a hora: escolha no app a data da sua cirurgia.', '🎉', array['nome']),
  ('previsao_cirurgia', 'agenda', 'Previsão da cirurgia', 'A equipe define ou altera a previsão da cirurgia', 'agenda', 'Previsão da sua cirurgia', '{{nome}}, a previsão da sua cirurgia é {{data}}. A data final é confirmada quando sua agenda for liberada.', '🗓️', array['nome', 'data']),
  ('cirurgia_agendada', 'agenda', 'Cirurgia agendada', 'A data da cirurgia é definida', 'agenda', 'Sua cirurgia está marcada', '{{nome}}, sua cirurgia está marcada para {{data}}{{horario}}. A equipe Sra. Luck está com você em cada passo.', '💐', array['nome', 'data', 'horario']),
  ('cirurgia_remarcada', 'agenda', 'Cirurgia remarcada', 'A data da cirurgia muda', 'agenda', 'Sua cirurgia foi remarcada', '{{nome}}, a data da sua cirurgia agora é {{data}}{{horario}}. Qualquer dúvida, fale com a nossa equipe.', '🔁', array['nome', 'data', 'horario']),
  ('cirurgia_lembrete_vespera', 'agenda', 'Lembrete: véspera da cirurgia', 'Rotina diária, um dia antes da cirurgia', 'agenda', 'Amanhã é o seu grande dia', '{{nome}}, amanhã é a sua cirurgia. Siga as orientações da equipe médica e conte com a gente para o que precisar.', '💗', array['nome']),
  ('processo_concluido', 'jornada', 'Jornada concluída', 'A equipe conclui o processo da cliente', 'jornada', 'Sua jornada foi concluída', '{{nome}}, sua jornada com a Sra. Luck foi concluída. Obrigada por confiar na gente para realizar esse sonho!', '🌸', array['nome']),
  ('clube_pontos_parcela_em_dia', 'clube', 'Pontos por parcela em dia', 'A parcela é paga até o vencimento', 'clube', 'Parcela em dia: pontos creditados', '{{nome}}, você pagou a parcela {{parcela}} em dia e ganhou {{pontos}} pontos no Clube de Vantagens.', '⭐', array['nome', 'parcela', 'pontos']),
  ('clube_bonus_primeira_parcela', 'clube', 'Bônus da primeira parcela', 'A primeira parcela é paga', 'clube', 'Bônus da primeira parcela liberado!', '{{nome}}, você ganhou {{pontos}} pontos e o {{beneficio}} no Clube de Vantagens.', '🎁', array['nome', 'pontos', 'beneficio']),
  ('clube_indicacao_fechou', 'clube', 'Indicação fechou', 'A indicada fecha contrato e paga a 1ª parcela', 'clube', 'Sua indicação fechou!', '{{nome}}, {{indicada}} fechou contrato e pagou a 1ª parcela. Você ganhou {{pontos}} pontos no Clube de Vantagens.', '💝', array['nome', 'indicada', 'pontos']),
  ('clube_voucher_disponivel', 'clube', 'Voucher disponível', 'A equipe anexa o voucher da cliente', 'clube', 'Seu voucher está disponível', '{{nome}}, a equipe liberou o seu voucher. Abra o Clube de Vantagens para visualizar.', '🎟️', array['nome']),
  ('clube_resgate_solicitado', 'clube', 'Resgate solicitado', 'A cliente resgata uma recompensa', 'clube', 'Resgate solicitado', '{{nome}}, seu resgate de "{{recompensa}}" foi enviado para a equipe. Avisamos a cada etapa.', '🎁', array['nome', 'recompensa']),
  ('clube_resgate_aprovado', 'clube', 'Resgate aprovado', 'A equipe aprova o resgate', 'clube', 'Resgate aprovado', '{{nome}}, seu resgate de "{{recompensa}}" foi aprovado e segue para preparação.', '🎁', array['nome', 'recompensa']),
  ('clube_resgate_separacao', 'clube', 'Resgate em separação', 'O resgate entra em separação', 'clube', 'Seu benefício está em separação', '{{nome}}, a equipe Sra. Luck está separando o seu "{{recompensa}}".', '📦', array['nome', 'recompensa']),
  ('clube_resgate_entregue', 'clube', 'Resgate entregue', 'O resgate é marcado como entregue', 'clube', 'Resgate entregue', '{{nome}}, seu resgate de "{{recompensa}}" foi concluído. Aproveite!', '💝', array['nome', 'recompensa']),
  ('clube_resgate_cancelado', 'clube', 'Resgate cancelado', 'O resgate é cancelado', 'clube', 'Resgate cancelado', '{{nome}}, seu resgate de "{{recompensa}}" foi cancelado e os pontos voltaram para o seu saldo.', '↩️', array['nome', 'recompensa'])
on conflict (chave) do nothing;
