-- ============================================================================
-- MIGRATION 075: Clube de Vantagens v2 — missões, indicações e voucher
--
-- Regras aprovadas (2026-09-23):
-- - Parcela paga em dia (data do pagamento <= vencimento): +10 pontos por
--   parcela, uma única vez por parcela.
-- - Indicação: +200 pontos para quem indicou quando a amiga indicada FECHA
--   contrato (confirmado pela equipe no admin, vinculando a cliente indicada)
--   E paga a 1ª parcela. Crédito único por indicação.
-- - Voucher da consulta (benefício da 1ª parcela): a cliente pode solicitar a
--   retirada; a equipe anexa o arquivo do voucher pelo admin e ele é liberado.
--
-- Os valores ficam em public.clube_config (configuráveis). Migration aditiva:
-- não remove nem renomeia dados; só amplia colunas, funções e o gatilho.
-- Depende da migration_048_clube_endurecimento.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Configuração dos novos créditos.
-- ----------------------------------------------------------------------------
alter table public.clube_config
  add column if not exists pontos_parcela_em_dia integer not null default 10,
  add column if not exists pontos_indicacao_venda integer not null default 200;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_clube_config_pontos_parcela_em_dia') then
    alter table public.clube_config
      add constraint chk_clube_config_pontos_parcela_em_dia check (pontos_parcela_em_dia >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_clube_config_pontos_indicacao_venda') then
    alter table public.clube_config
      add constraint chk_clube_config_pontos_indicacao_venda check (pontos_indicacao_venda >= 0);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Indicações: vínculo com a cliente indicada e rastreio do status.
-- ----------------------------------------------------------------------------
alter table public.indicacoes_clientes
  add column if not exists indicado_cliente_id uuid references public.clientes(id) on delete set null,
  add column if not exists observacao text,
  add column if not exists status_atualizado_em timestamptz,
  add column if not exists status_atualizado_por text,
  add column if not exists pontos_creditados_em timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_indicacao_nao_propria') then
    alter table public.indicacoes_clientes
      add constraint chk_indicacao_nao_propria
      check (indicado_cliente_id is null or indicado_cliente_id <> indicador_cliente_id);
  end if;
end $$;

-- Uma cliente só pode ser a "venda" de uma única indicação (evita crédito duplo).
create unique index if not exists uq_indicacoes_indicado_venda
  on public.indicacoes_clientes(indicado_cliente_id)
  where status = 'venda' and indicado_cliente_id is not null;
create index if not exists idx_indicacoes_clientes_status_created
  on public.indicacoes_clientes(status, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. Voucher: solicitação da cliente e arquivo anexado pela equipe.
-- ----------------------------------------------------------------------------
alter table public.clube_beneficios_cliente
  add column if not exists solicitado_em timestamptz,
  add column if not exists arquivo_path text,
  add column if not exists arquivo_mime text,
  add column if not exists arquivo_anexado_em timestamptz,
  add column if not exists arquivo_anexado_por text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clube-vouchers',
  'clube-vouchers',
  false,
  10485760,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 4. Crédito de pontos genérico e idempotente (uma vez por motivo+referência).
-- ----------------------------------------------------------------------------
create or replace function public.clube_creditar_pontos(
  p_cliente_id uuid,
  p_tipo text,
  p_pontos integer,
  p_motivo text,
  p_referencia text,
  p_metadata jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_cliente_id is null or coalesce(p_pontos, 0) <= 0 or nullif(btrim(p_motivo), '') is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'clube_credito:' || p_cliente_id::text || ':' || p_motivo || ':' || coalesce(p_referencia, ''), 0
  ));

  if exists (
    select 1 from public.cliente_pontos_eventos
    where cliente_id = p_cliente_id
      and metadata->>'motivo' = p_motivo
      and referencia is not distinct from p_referencia
  ) then
    return false;
  end if;

  insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
  values (p_cliente_id, p_tipo, p_pontos, p_referencia, coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('motivo', p_motivo));

  insert into public.cliente_pontos (cliente_id, saldo, updated_at)
  values (p_cliente_id, p_pontos, now())
  on conflict (cliente_id) do update
    set saldo = public.cliente_pontos.saldo + excluded.saldo,
        updated_at = now();

  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Indicação: credita quem indicou quando a indicada fechou (status venda,
--    vinculada pela equipe) e já pagou a 1ª parcela. Chamada pelo admin e pelo
--    gatilho do boleto — o que acontecer por último efetiva o crédito.
-- ----------------------------------------------------------------------------
create or replace function public.clube_avaliar_indicacao(p_indicacao_id uuid)
returns boolean
language plpgsql
security invoker
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

  insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
  values (
    v_ind.indicador_cliente_id,
    'clube',
    'Sua indicação fechou!',
    format('%s fechou contrato e pagou a 1ª parcela. Você ganhou %s pontos no Clube de Vantagens.', v_ind.nome_indicado, v_pontos),
    '💝',
    'clube',
    v_ind.id
  );

  return true;
end;
$$;

-- Atualização da indicação pela equipe (status, vínculo e observação), com
-- auditoria e avaliação imediata do crédito.
create or replace function public.clube_atualizar_indicacao(
  p_indicacao_id uuid,
  p_status text,
  p_indicado_cliente_id uuid,
  p_observacao text,
  p_usuario text
) returns public.indicacoes_clientes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ind public.indicacoes_clientes%rowtype;
begin
  if p_status not in ('enviada', 'qualificada', 'venda', 'invalidada') then
    raise exception 'Status de indicacao invalido';
  end if;

  select * into v_ind from public.indicacoes_clientes where id = p_indicacao_id for update;
  if not found then
    raise exception 'Indicacao nao encontrada';
  end if;
  if v_ind.pontos_creditados > 0 and p_status <> 'venda' then
    raise exception 'Indicacao ja creditada';
  end if;
  if p_status = 'venda' and p_indicado_cliente_id is null then
    raise exception 'Vincule a cliente indicada para marcar como fechada';
  end if;
  if p_indicado_cliente_id is not null and p_indicado_cliente_id = v_ind.indicador_cliente_id then
    raise exception 'A cliente nao pode indicar a si mesma';
  end if;
  if p_indicado_cliente_id is not null and not exists (select 1 from public.clientes where id = p_indicado_cliente_id) then
    raise exception 'Cliente indicada nao encontrada';
  end if;

  update public.indicacoes_clientes
  set status = p_status,
      indicado_cliente_id = case when v_ind.pontos_creditados > 0 then v_ind.indicado_cliente_id else p_indicado_cliente_id end,
      observacao = nullif(btrim(p_observacao), ''),
      status_atualizado_em = now(),
      status_atualizado_por = p_usuario
  where id = p_indicacao_id
  returning * into v_ind;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (
    coalesce(p_usuario, 'admin'), 'atualizou_indicacao_clube', 'indicacoes_clientes', v_ind.id,
    jsonb_build_object('status', p_status, 'indicado_cliente_id', v_ind.indicado_cliente_id, 'observacao', v_ind.observacao)
  );

  perform public.clube_avaliar_indicacao(v_ind.id);
  select * into v_ind from public.indicacoes_clientes where id = p_indicacao_id;
  return v_ind;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Gatilho do boleto: mantém tudo o que a migration 048 fazia e adiciona
--    a parcela em dia e a avaliação das indicações.
-- ----------------------------------------------------------------------------
create or replace function public.clube_notificar_boleto_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pontos_em_dia integer;
  v_ind record;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'pago' then
    insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
    values (
      new.cliente_id,
      'parcela',
      'Pagamento confirmado',
      format('Sua parcela %s foi confirmada como paga.', new.numero_parcela),
      '✅',
      'parcelas',
      new.id
    );

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
        insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
        values (
          new.cliente_id,
          'clube',
          'Parcela em dia: pontos creditados',
          format('Você pagou a parcela %s em dia e ganhou %s pontos no Clube de Vantagens.', new.numero_parcela, v_pontos_em_dia),
          '⭐',
          'clube',
          new.id
        );
      end if;
    end if;
  elsif new.status = 'rejeitado' then
    insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
    values (
      new.cliente_id,
      'parcela',
      'Comprovante rejeitado',
      case
        when nullif(btrim(new.observacoes), '') is not null
          then format('O comprovante da parcela %s foi rejeitado: %s', new.numero_parcela, new.observacoes)
        else format('O comprovante da parcela %s foi rejeitado. Entre em contato com a equipe.', new.numero_parcela)
      end,
      '⚠️',
      'parcelas',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_clube_notificar_boleto_status on public.boletos;
create trigger trg_clube_notificar_boleto_status
after update of status on public.boletos
for each row
when (old.status is distinct from new.status)
execute function public.clube_notificar_boleto_status();

-- ----------------------------------------------------------------------------
-- 7. RPCs exclusivas do Worker/service_role.
-- ----------------------------------------------------------------------------
revoke all on function public.clube_creditar_pontos(uuid, text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.clube_creditar_pontos(uuid, text, integer, text, text, jsonb) to service_role;
revoke all on function public.clube_avaliar_indicacao(uuid) from public, anon, authenticated;
grant execute on function public.clube_avaliar_indicacao(uuid) to service_role;
revoke all on function public.clube_atualizar_indicacao(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.clube_atualizar_indicacao(uuid, text, uuid, text, text) to service_role;
revoke all on function public.clube_notificar_boleto_status() from public, anon, authenticated;
grant execute on function public.clube_notificar_boleto_status() to service_role;

commit;
