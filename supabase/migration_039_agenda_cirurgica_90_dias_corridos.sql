-- ============================================================================
-- migration_039_agenda_cirurgica_90_dias_corridos.sql
--
-- Fase 2 do plano ZIP Admin: substitui a regra operacional de liberação da
-- agenda cirúrgica. A regra de "5 dias úteis" (migration_028) está
-- SUPERADA para este fluxo.
--
-- Regra vigente:
--   termos_assinados_em + custeio_confirmado_em (SÓ quando os DOIS existem)
--   -> data-base = a mais recente entre os dois eventos
--   -> prazo MÁXIMO de 90 dias corridos a partir da data-base.
--
-- A liberação real pode ocorrer ANTES desse prazo (conforme agenda
-- disponível/planejamento financeiro/decisão operacional) — não há mais
-- piso mínimo de espera. O prazo de 90 dias é o teto: a função continua
-- bloqueando a escolha de uma data além dele, para não deixar o
-- compromisso da Sra. Luck com a cliente indefinido.
--
-- public.adicionar_dias_uteis() NÃO é removida/alterada: continua em uso
-- pelo SLA de revisão financeira (worker/journey.ts, endpoint
-- request-terms), que é uma regra DIFERENTE e não faz parte desta mudança.
--
-- Nota de escopo: worker/journey.ts e a tabela contratos_credito (e o
-- gatilho trg_contrato_liberacao_cirurgica da migration_023, que também
-- teria a regra antiga) operam sobre uma tabela que nunca foi aplicada
-- neste banco (confirmado por introspecção: contratos_credito não existe).
-- Esse subsistema paralelo está fora do runtime real hoje e fora do escopo
-- desta migration — não deve ser "corrigido" aplicando migration_022/023
-- sem uma decisão own própria sobre esse domínio.
-- ============================================================================

create or replace function public.adicionar_dias_corridos(p_data date, p_dias integer)
returns date
language sql
immutable
set search_path = public
as $$
  select case when p_data is null then null else p_data + greatest(0, p_dias) end;
$$;

create or replace function public.agendar_cirurgia_data(p_agendamento_id uuid, p_data date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agendamento public.agendamentos%rowtype;
  v_cliente public.clientes%rowtype;
  v_data public.datas_liberacao_financeira%rowtype;
  v_ocupadas integer;
  v_base date;
  v_limite date;
begin
  select * into v_agendamento
  from public.agendamentos
  where id = p_agendamento_id
  for update;

  if not found then
    raise exception using errcode = 'P0012', message = 'AGENDAMENTO_NAO_ENCONTRADO';
  end if;

  if v_agendamento.termos_assinados_em is null then
    raise exception using errcode = 'P0013', message = 'TERMOS_NAO_ASSINADOS';
  end if;

  select * into v_cliente
  from public.clientes
  where id = v_agendamento.cliente_id
  for update;

  if not found then
    raise exception using errcode = 'P0014', message = 'CLIENTE_NAO_ENCONTRADA';
  end if;

  if v_cliente.custeio_confirmado_em is null then
    raise exception using errcode = 'P0015', message = 'SALDO_NAO_QUITADO';
  end if;

  v_base := greatest(
    (timezone('America/Sao_Paulo', v_agendamento.termos_assinados_em))::date,
    (timezone('America/Sao_Paulo', v_cliente.custeio_confirmado_em))::date
  );
  v_limite := public.adicionar_dias_corridos(v_base, 90);

  if p_data > v_limite then
    raise exception using errcode = 'P0016', message = 'PRAZO_CIRURGICO_EXCEDIDO';
  end if;

  select * into v_data
  from public.datas_liberacao_financeira
  where data = p_data
  for update;

  if not found or v_data.status <> 'disponivel' then
    raise exception using errcode = 'P0010', message = 'DATA_CIRURGIA_INDISPONIVEL';
  end if;

  select count(*)::integer into v_ocupadas
  from public.agendamentos
  where status in ('confirmado', 'realizado')
    and previsao_liberacao_financeira = p_data
    and id <> p_agendamento_id;

  if v_ocupadas >= 1 then
    raise exception using errcode = 'P0011', message = 'DATA_CIRURGIA_OCUPADA';
  end if;

  update public.agendamentos
  set previsao_liberacao_financeira = p_data,
      updated_at = now()
  where id = p_agendamento_id;

  update public.clientes
  set status_cirurgia = 'agendada',
      updated_at = now()
  where id = v_agendamento.cliente_id;
end;
$$;

revoke all on function public.adicionar_dias_corridos(date, integer) from public, anon, authenticated;
revoke all on function public.agendar_cirurgia_data(uuid, date) from public, anon, authenticated;
grant execute on function public.adicionar_dias_corridos(date, integer) to service_role;
grant execute on function public.agendar_cirurgia_data(uuid, date) to service_role;
