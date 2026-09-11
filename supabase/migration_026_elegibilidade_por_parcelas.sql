-- ============================================================================
-- MIGRATION 026 — Elegibilidade por quantidade de parcelas
-- Data: 2026-09-11
--
-- Regra oficial Sra. Luck:
-- percentual de elegibilidade = parcelas quitadas / total de parcelas.
-- Valores monetários continuam sendo usados no financeiro e na quitação final,
-- mas NÃO definem quando a cliente atinge o percentual mínimo do contrato.
-- ============================================================================

-- Esta view é de planejamento operacional. Ela informa em qual vencimento a
-- cliente deverá atingir a quantidade mínima de parcelas, assumindo pagamento
-- das parcelas na sequência prevista.
drop view if exists public.vw_previsao_elegibilidade;

create view public.vw_previsao_elegibilidade as
with base as (
  select
    c.id as contrato_id,
    c.cliente_id,
    c.percentual_minimo,
    greatest(
      count(b.id) over (partition by c.id),
      coalesce(max(b.total_parcelas) over (partition by c.id), 0)
    )::integer as total_parcelas,
    b.id as boleto_id,
    b.numero_parcela,
    b.data_vencimento,
    row_number() over (
      partition by c.id
      order by b.numero_parcela asc, b.data_vencimento asc nulls last, b.id
    )::integer as ordem_parcela
  from public.contratos_credito c
  join public.boletos b on b.contrato_credito_id = c.id
  where c.etapa not in ('cancelado', 'concluido')
), calculada as (
  select
    *,
    ceil(total_parcelas * percentual_minimo / 100.0)::integer as parcelas_necessarias
  from base
  where total_parcelas > 0
)
select distinct on (contrato_id)
  contrato_id,
  cliente_id,
  percentual_minimo,
  total_parcelas,
  parcelas_necessarias,
  data_vencimento as previsao_atingir_percentual
from calculada
where ordem_parcela = parcelas_necessarias
order by contrato_id, ordem_parcela, boleto_id;

comment on view public.vw_previsao_elegibilidade is
  'Forecast operacional de quando cada contrato deve atingir o percentual mínimo, calculado pela quantidade de parcelas previstas/quitadas, nunca pelo valor monetário pago.';

grant select on public.vw_previsao_elegibilidade to service_role;
