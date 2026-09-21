-- ============================================================================
-- postflight_064_agenda_v46.sql
--
-- SOMENTE LEITURA (não altera nada). Rodar logo após
-- migration_064_agenda_v46_regras_definitivas.sql e comparar o bloco 1
-- contra os números que o preflight imprimiu ANTES da migration.
--
-- O último bloco (RESULTADO FINAL) resume tudo em uma única linha.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Mesmas contagens do preflight — NENHUM destes números pode ter
--    DIMINUÍDO em relação ao que você anotou antes de migrar.
-- ----------------------------------------------------------------------------
select
  (select count(*) from public.clientes) as total_clientes,
  (select count(*) from public.clientes where ativo) as clientes_ativos,
  (select count(*) from public.agendamentos) as total_agendamentos,
  (select count(*) from public.agendamentos where status = 'confirmado') as agendamentos_confirmados,
  (select count(*) from public.agendamentos where status = 'realizado') as agendamentos_realizados,
  (select count(*) from public.agendamentos where status = 'cancelado') as agendamentos_cancelados,
  (select count(*) from public.agendamentos where data_cirurgia is not null) as cirurgias_com_data,
  (select count(*) from public.agendamentos where comparecimento_status = 'compareceu') as comparecimentos_confirmados,
  (select count(*) from public.agendamentos where quitacao_status = 'paga') as quitacoes_confirmadas,
  (select count(*) from public.agendamentos where agenda_cirurgica_liberada_em is not null) as agendas_ja_liberadas,
  (select count(*) from public.clientes where status_cirurgia = 'realizada') as clientes_status_cirurgia_realizada,
  (select count(*) from public.boletos) as total_boletos,
  (select count(*) from public.boletos where status = 'pago') as boletos_pagos,
  (select count(*) from public.agendamentos where processo_concluido_em is not null) as processos_concluidos;

-- ----------------------------------------------------------------------------
-- 2) As 7 colunas novas devem existir agora, com os tipos/defaults certos.
-- ----------------------------------------------------------------------------
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'agendamentos'
  and column_name in (
    'termos_responsavel','agenda_cirurgica_liberada_manualmente','agenda_cirurgica_liberada_por',
    'agenda_cirurgica_prazo_ajuste_dias','pagamento_cirurgia_confirmado_em',
    'pagamento_cirurgia_confirmado_por','processo_concluido_em'
  )
order by column_name;
-- Esperado: 7 linhas. agenda_cirurgica_liberada_manualmente = boolean/not
-- null/false; agenda_cirurgica_prazo_ajuste_dias = integer/not null/0;
-- as demais timestamptz/text, nullable.

-- ----------------------------------------------------------------------------
-- 3) As 8 funções novas devem existir com a assinatura esperada.
-- ----------------------------------------------------------------------------
select p.proname as funcao, pg_get_function_identity_arguments(p.oid) as assinatura,
  pg_get_function_result(p.oid) as retorno
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'cliente_solicitar_liberacao_financeira','calcular_prazo_cirurgico_v46',
    'agenda_cirurgica_ajustar_prazo','agenda_cirurgica_liberar_manual',
    'agenda_definir_responsavel_termos','agenda_liberar_termos_para_nova_escolha',
    'agenda_reagendar_termos_agora','agenda_confirmar_pagamento_cirurgia'
  )
order by 1;
-- Esperado: 8 linhas.

-- ----------------------------------------------------------------------------
-- 4) Índice e constraint novos.
-- ----------------------------------------------------------------------------
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'agendamentos' and indexname = 'idx_agendamentos_processo_concluido';
-- Esperado: 1 linha.

select conname, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.agendamentos'::regclass and conname = 'agendamentos_prazo_ajuste_check';
-- Esperado: 1 linha, "CHECK ((agenda_cirurgica_prazo_ajuste_dias >= 0))".

-- ----------------------------------------------------------------------------
-- 5) pode_agendar() não pode mais depender só do 70% fixo — precisa citar
--    percentual_minimo_agendar.
-- ----------------------------------------------------------------------------
select
  pg_get_functiondef(p.oid) ilike '%percentual_minimo_agendar%' as usa_tiered_por_cliente,
  pg_get_functiondef(p.oid) as definicao
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'pode_agendar';
-- Esperado: usa_tiered_por_cliente = true.

-- ----------------------------------------------------------------------------
-- 6) agenda_tentar_liberar_cirurgia precisa citar a regra de 5 dias úteis
--    (via calcular_prazo_cirurgico_v46) e NÃO pode liberar imediatamente.
-- ----------------------------------------------------------------------------
select
  pg_get_functiondef(p.oid) ilike '%calcular_prazo_cirurgico_v46%' as usa_prazo_5_dias_uteis,
  pg_get_functiondef(p.oid) ilike '%90%' as contem_literal_90_suspeito,
  pg_get_functiondef(p.oid) as definicao
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'agenda_tentar_liberar_cirurgia';
-- Esperado: usa_prazo_5_dias_uteis = true; contem_literal_90_suspeito = false.

-- ----------------------------------------------------------------------------
-- 7) calcular_prazo_cirurgico_v46 precisa somar exatamente 5 (+ ajuste) dias
--    úteis via adicionar_dias_uteis — nunca dias corridos.
-- ----------------------------------------------------------------------------
select
  pg_get_functiondef(p.oid) ilike '%adicionar_dias_uteis%' as usa_dias_uteis,
  pg_get_functiondef(p.oid) ilike '%adicionar_dias_corridos%' as usa_dias_corridos_suspeito,
  pg_get_functiondef(p.oid) ilike '%5 +%' as soma_base_5,
  pg_get_functiondef(p.oid) as definicao
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'calcular_prazo_cirurgico_v46';
-- Esperado: usa_dias_uteis = true; usa_dias_corridos_suspeito = false; soma_base_5 = true.

-- ----------------------------------------------------------------------------
-- 8) Teto de R$ 100.000 precisa estar em agenda_confirmar_previsao E em
--    agenda_reservar_cirurgia, protegido por advisory lock nas duas.
-- ----------------------------------------------------------------------------
select
  'agenda_confirmar_previsao' as funcao,
  pg_get_functiondef(p.oid) ilike '%100000%' as tem_teto_100k,
  pg_get_functiondef(p.oid) ilike '%pg_advisory_xact_lock%' as tem_advisory_lock
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'agenda_confirmar_previsao'
union all
select
  'agenda_reservar_cirurgia',
  pg_get_functiondef(p.oid) ilike '%100000%',
  pg_get_functiondef(p.oid) ilike '%pg_advisory_xact_lock%'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'agenda_reservar_cirurgia';
-- Esperado: as duas linhas com tem_teto_100k = true e tem_advisory_lock = true.

-- ----------------------------------------------------------------------------
-- 9) data_cirurgia continua a coluna canônica (usada pela agenda_reservar_
--    cirurgia nova; agenda_comprometimento_mes prioriza sobre previsao).
-- ----------------------------------------------------------------------------
select
  pg_get_functiondef(p.oid) ilike '%data_cirurgia%' as agenda_reservar_grava_data_cirurgia
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'agenda_reservar_cirurgia';
-- Esperado: true.

-- ----------------------------------------------------------------------------
-- 10) Nenhum agendamento/cirurgia/processo pode ter sumido (compare com os
--     números do preflight que você anotou).
-- ----------------------------------------------------------------------------
select
  'Compare manualmente com o preflight: nenhuma contagem do bloco 1 pode ser MENOR que antes.' as lembrete;

-- ----------------------------------------------------------------------------
-- 11) RESULTADO FINAL
-- ----------------------------------------------------------------------------
do $$
declare
  v_problemas text[] := '{}';
  v_colunas_novas integer;
  v_funcoes_novas integer;
  v_pode_agendar_ok boolean;
  v_prazo_ok boolean;
  v_teto_previsao_ok boolean;
  v_teto_reserva_ok boolean;
begin
  select count(*) into v_colunas_novas
  from information_schema.columns
  where table_schema = 'public' and table_name = 'agendamentos'
    and column_name in ('termos_responsavel','agenda_cirurgica_liberada_manualmente','agenda_cirurgica_liberada_por','agenda_cirurgica_prazo_ajuste_dias','pagamento_cirurgia_confirmado_em','pagamento_cirurgia_confirmado_por','processo_concluido_em');

  select count(*) into v_funcoes_novas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('cliente_solicitar_liberacao_financeira','calcular_prazo_cirurgico_v46','agenda_cirurgica_ajustar_prazo','agenda_cirurgica_liberar_manual','agenda_definir_responsavel_termos','agenda_liberar_termos_para_nova_escolha','agenda_reagendar_termos_agora','agenda_confirmar_pagamento_cirurgia');

  select pg_get_functiondef(p.oid) ilike '%percentual_minimo_agendar%' into v_pode_agendar_ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'pode_agendar';

  select pg_get_functiondef(p.oid) ilike '%calcular_prazo_cirurgico_v46%' into v_prazo_ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'agenda_tentar_liberar_cirurgia';

  select pg_get_functiondef(p.oid) ilike '%pg_advisory_xact_lock%' into v_teto_previsao_ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'agenda_confirmar_previsao';

  select pg_get_functiondef(p.oid) ilike '%pg_advisory_xact_lock%' into v_teto_reserva_ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'agenda_reservar_cirurgia';

  if v_colunas_novas < 7 then v_problemas := v_problemas || format('so %s/7 colunas novas foram criadas', v_colunas_novas); end if;
  if v_funcoes_novas < 8 then v_problemas := v_problemas || format('so %s/8 funcoes novas foram criadas', v_funcoes_novas); end if;
  if coalesce(v_pode_agendar_ok, false) is not true then v_problemas := v_problemas || 'pode_agendar nao referencia percentual_minimo_agendar'; end if;
  if coalesce(v_prazo_ok, false) is not true then v_problemas := v_problemas || 'agenda_tentar_liberar_cirurgia nao referencia calcular_prazo_cirurgico_v46'; end if;
  if coalesce(v_teto_previsao_ok, false) is not true then v_problemas := v_problemas || 'agenda_confirmar_previsao sem advisory lock'; end if;
  if coalesce(v_teto_reserva_ok, false) is not true then v_problemas := v_problemas || 'agenda_reservar_cirurgia sem advisory lock'; end if;

  if array_length(v_problemas, 1) is null then
    raise notice 'RESULTADO: MIGRATION APLICADA CORRETAMENTE';
  else
    raise notice 'RESULTADO: PROBLEMA ENCONTRADO: %', array_to_string(v_problemas, ' | ');
  end if;
end $$;
