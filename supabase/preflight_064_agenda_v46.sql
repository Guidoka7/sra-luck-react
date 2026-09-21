-- ============================================================================
-- preflight_064_agenda_v46.sql
--
-- SOMENTE LEITURA. Não faz nenhuma alteração. Rodar no SQL Editor do
-- Supabase ANTES de aplicar migration_064_agenda_v46_regras_definitivas.sql
-- e conferir visualmente cada bloco de resultado.
--
-- O último bloco (RESULTADO FINAL) resume tudo em uma única linha:
-- 'PRONTO PARA MIGRAR' ou 'BLOQUEIO ENCONTRADO: <motivo>'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Contagens de referência — guarde estes números para comparar com o
--    postflight depois da migration. Nenhum deles deve DIMINUIR.
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
  (select count(*) from public.boletos where status = 'pago') as boletos_pagos;

-- ----------------------------------------------------------------------------
-- 2) Colunas exigidas por migration_060-063 (devem já existir — se alguma
--    faltar, a 064 vai FALHAR ao rodar, porque ela assume essa base).
-- ----------------------------------------------------------------------------
select
  'agendamentos' as tabela, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'agendamentos'
  and column_name in (
    'comparecimento_status','comparecimento_em','comparecimento_registrado_por',
    'quitacao_status','quitacao_em','quitacao_metodo',
    'previsao_cirurgia','previsao_cirurgia_confirmada_em','previsao_cirurgia_confirmada_por',
    'agenda_cirurgica_liberada_em','data_cirurgia','horario_cirurgia','cirurgia_escolhida_em',
    'data_id','valor_contrato','status','termos_assinados_em','horario_termos'
  )
union all
select 'clientes', column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'clientes'
  and column_name in (
    'percentual_minimo_agendar','status_revisao_financeira','data_atingiu_percentual',
    'financeiro_confirmado_em','custeio_confirmado_em','valor_contrato','quantidade_parcelas',
    'financeiro_saldo_restante','status_cirurgia'
  )
union all
select 'datas', column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'datas'
  and column_name in ('vagas_totais','fechamento_manual','status','data')
union all
select 'datas_liberacao_financeira', column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'datas_liberacao_financeira'
  and column_name in ('vagas_totais','fechamento_manual','status','data')
order by 1, 2;

-- Contagem esperada: 17 (agendamentos) + 8 (clientes) + 4 (datas) + 4 (datas_liberacao_financeira) = 33.
-- Se vier menos que 33 linhas, alguma coluna-base da linhagem 060-063 não
-- está no banco que você está prestes a migrar — BLOQUEIO, não prossiga.

-- ----------------------------------------------------------------------------
-- 3) Colunas que a 064 vai ADICIONAR — devem estar AUSENTES agora (se já
--    existirem, alguém rodou algo parecido antes; confira antes de seguir).
-- ----------------------------------------------------------------------------
select 'agendamentos' as tabela, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'agendamentos'
  and column_name in (
    'termos_responsavel','agenda_cirurgica_liberada_manualmente','agenda_cirurgica_liberada_por',
    'agenda_cirurgica_prazo_ajuste_dias','pagamento_cirurgia_confirmado_em',
    'pagamento_cirurgia_confirmado_por','processo_concluido_em'
  )
union all
select 'clientes', column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'clientes'
  and column_name = 'liberacao_financeira_solicitada_em';
-- Esperado: 0 linhas (nenhuma dessas 8 colunas deve existir ainda).

-- ----------------------------------------------------------------------------
-- 4) Funções BASE que a 064 usa via CREATE OR REPLACE ou chama internamente
--    — todas precisam existir agora.
-- ----------------------------------------------------------------------------
select p.proname as funcao, pg_get_function_identity_arguments(p.oid) as assinatura
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'pode_agendar','porcentagem_pagamento','percentual_minimo_fluxo_agenda',
    'adicionar_dias_uteis','agendar_data','agenda_comprometimento_mes',
    'agenda_confirmar_previsao','agenda_registrar_comparecimento','agenda_registrar_quitacao',
    'agenda_tentar_liberar_cirurgia','agenda_reservar_cirurgia','agenda_liberada',
    'agenda_confirmar_levantamento'
  )
order by 1;
-- Esperado: 13 linhas. Se faltar alguma, a 064 vai quebrar ao tentar usá-la.

-- ----------------------------------------------------------------------------
-- 5) Funções NOVAS que a 064 vai CRIAR — devem estar AUSENTES agora (senão
--    já existe algo com esse nome e o CREATE OR REPLACE vai sobrescrevê-lo
--    sem você saber o que estava lá).
-- ----------------------------------------------------------------------------
select p.proname as funcao, pg_get_function_identity_arguments(p.oid) as assinatura
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'cliente_solicitar_liberacao_financeira','calcular_prazo_cirurgico_v46',
    'agenda_cirurgica_ajustar_prazo','agenda_cirurgica_liberar_manual',
    'agenda_definir_responsavel_termos','agenda_liberar_termos_para_nova_escolha',
    'agenda_reagendar_termos_agora','agenda_confirmar_pagamento_cirurgia'
  );
-- Esperado: 0 linhas.

-- ----------------------------------------------------------------------------
-- 6) Definição ATUAL das duas funções que a 064 vai comportamentalmente
--    trocar — confirme que ainda batem com o que a migration_064 documenta
--    estar substituindo (70% fixo / liberação imediata).
-- ----------------------------------------------------------------------------
select 'pode_agendar' as funcao, pg_get_functiondef(p.oid) as definicao_atual
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'pode_agendar'
union all
select 'agenda_tentar_liberar_cirurgia', pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'agenda_tentar_liberar_cirurgia';
-- Leia manualmente: pode_agendar deve conter 'percentual_minimo_fluxo_agenda'
-- (a regra de 70% fixo que a 064 substitui); agenda_tentar_liberar_cirurgia
-- NÃO deve conter lógica de dias úteis/prazo (a 064 é quem introduz isso).

-- ----------------------------------------------------------------------------
-- 7) Índices/constraints relevantes (não bloqueiam a migration, mas
--    confirmam o estado esperado).
-- ----------------------------------------------------------------------------
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'agendamentos'
  and indexname like 'idx_agendamentos_%'
order by 1;

select conname, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.agendamentos'::regclass
order by 1;

-- ----------------------------------------------------------------------------
-- 8) RESULTADO FINAL — leia esta linha primeiro.
-- ----------------------------------------------------------------------------
do $$
declare
  v_bloqueios text[] := '{}';
  v_faltando_base integer;
  v_ja_existe_nova_coluna integer;
  v_ja_existe_nova_funcao integer;
  v_faltando_funcao_base integer;
begin
  select count(*) into v_faltando_base
  from (values
    ('agendamentos','comparecimento_status'),('agendamentos','quitacao_status'),
    ('agendamentos','previsao_cirurgia'),('agendamentos','previsao_cirurgia_confirmada_em'),
    ('agendamentos','agenda_cirurgica_liberada_em'),('agendamentos','data_cirurgia'),
    ('clientes','percentual_minimo_agendar'),('clientes','status_revisao_financeira'),
    ('clientes','data_atingiu_percentual'),
    ('datas_liberacao_financeira','vagas_totais'),('datas_liberacao_financeira','fechamento_manual')
  ) as req(tabela, coluna)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = req.tabela and c.column_name = req.coluna
  );

  select count(*) into v_faltando_funcao_base
  from (values
    ('pode_agendar'),('porcentagem_pagamento'),('adicionar_dias_uteis'),('agendar_data'),
    ('agenda_comprometimento_mes'),('agenda_confirmar_previsao'),('agenda_registrar_comparecimento'),
    ('agenda_registrar_quitacao'),('agenda_tentar_liberar_cirurgia'),('agenda_reservar_cirurgia')
  ) as req(nome)
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = req.nome
  );

  select count(*) into v_ja_existe_nova_coluna
  from (
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'agendamentos'
      and column_name in ('termos_responsavel','agenda_cirurgica_liberada_manualmente','agenda_cirurgica_liberada_por','agenda_cirurgica_prazo_ajuste_dias','pagamento_cirurgia_confirmado_em','pagamento_cirurgia_confirmado_por','processo_concluido_em')
    union all
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'clientes' and column_name = 'liberacao_financeira_solicitada_em'
  ) x;

  select count(*) into v_ja_existe_nova_funcao
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('cliente_solicitar_liberacao_financeira','calcular_prazo_cirurgico_v46','agenda_cirurgica_ajustar_prazo','agenda_cirurgica_liberar_manual','agenda_definir_responsavel_termos','agenda_liberar_termos_para_nova_escolha','agenda_reagendar_termos_agora','agenda_confirmar_pagamento_cirurgia');

  if v_faltando_base > 0 then
    v_bloqueios := v_bloqueios || format('faltam %s coluna(s)-base da linhagem 060-063', v_faltando_base);
  end if;
  if v_faltando_funcao_base > 0 then
    v_bloqueios := v_bloqueios || format('faltam %s funcao(oes)-base da linhagem 060-063', v_faltando_funcao_base);
  end if;
  if v_ja_existe_nova_coluna > 0 then
    v_bloqueios := v_bloqueios || format('%s coluna(s) nova(s) da 064 ja existem — investigue antes de aplicar', v_ja_existe_nova_coluna);
  end if;
  if v_ja_existe_nova_funcao > 0 then
    v_bloqueios := v_bloqueios || format('%s funcao(oes) nova(s) da 064 ja existem — investigue antes de aplicar', v_ja_existe_nova_funcao);
  end if;

  if array_length(v_bloqueios, 1) is null then
    raise notice 'RESULTADO: PRONTO PARA MIGRAR';
  else
    raise notice 'RESULTADO: BLOQUEIO ENCONTRADO: %', array_to_string(v_bloqueios, ' | ');
  end if;
end $$;
