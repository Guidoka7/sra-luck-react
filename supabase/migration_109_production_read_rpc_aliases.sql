-- Fachadas estáveis de produção para as RPCs de leitura validadas no ensaio isolado.
-- Todas permanecem SECURITY INVOKER e exclusivas do service_role.

ALTER INDEX IF EXISTS public.idx_loadtest_clientes_ativos_recent RENAME TO idx_clientes_ativos_recent;

CREATE OR REPLACE FUNCTION public.agenda_datas_snapshot(p_hoje date)
RETURNS TABLE(id uuid, data date, vagas_restantes integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM public.loadtest_agenda_datas_snapshot(p_hoje);
$$;

CREATE OR REPLACE FUNCTION public.agenda_cirurgia_datas_snapshot(p_hoje date)
RETURNS TABLE(id uuid, data date, vagas_restantes integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM public.loadtest_agenda_cirurgia_datas_snapshot(p_hoje);
$$;

CREATE OR REPLACE FUNCTION public.cliente_financeiro_snapshot(p_cliente_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.loadtest_cliente_financeiro_snapshot(p_cliente_id);
$$;

CREATE OR REPLACE FUNCTION public.admin_clientes_pagina(
  p_limite integer,p_cursor_created timestamptz DEFAULT NULL,p_cursor_id uuid DEFAULT NULL,
  p_busca text DEFAULT NULL,p_funil text DEFAULT 'cadastradas',p_status text DEFAULT NULL,
  p_periodo_inicio timestamptz DEFAULT NULL,p_banco text DEFAULT NULL,p_sort text DEFAULT 'recent',p_cursor_name text DEFAULT NULL
) RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM public.loadtest_admin_clientes_pagina(p_limite,p_cursor_created,p_cursor_id,p_busca,p_funil,p_status,p_periodo_inicio,p_banco,p_sort,p_cursor_name);
$$;

CREATE OR REPLACE FUNCTION public.admin_clientes_pagina_recent(
  p_limite integer,p_cursor_created timestamptz DEFAULT NULL,p_cursor_id uuid DEFAULT NULL,
  p_busca text DEFAULT NULL,p_funil text DEFAULT 'cadastradas',p_status text DEFAULT NULL,
  p_periodo_inicio timestamptz DEFAULT NULL,p_banco text DEFAULT NULL,p_sort text DEFAULT 'recent',p_cursor_name text DEFAULT NULL
) RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM public.loadtest_admin_clientes_pagina_recent(p_limite,p_cursor_created,p_cursor_id,p_busca,p_funil,p_status,p_periodo_inicio,p_banco,p_sort,p_cursor_name);
$$;

CREATE OR REPLACE FUNCTION public.admin_clientes_totais()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT public.loadtest_admin_clientes_totais(); $$;
CREATE OR REPLACE FUNCTION public.admin_clientes_bancos()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT public.loadtest_admin_clientes_bancos(); $$;

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats(p_hoje date,p_inicio date,p_fim date,p_semana_inicio date,p_semana_fim date,p_grafico_inicio date,p_grafico_fim date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.loadtest_admin_dashboard_stats(p_hoje,p_inicio,p_fim,p_semana_inicio,p_semana_fim,p_grafico_inicio,p_grafico_fim);
$$;
CREATE OR REPLACE FUNCTION public.admin_dashboard_agenda(p_inicio date,p_fim date,p_hoje date,p_proximos_fim date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.loadtest_admin_dashboard_agenda(p_inicio,p_fim,p_hoje,p_proximos_fim);
$$;
CREATE OR REPLACE FUNCTION public.cliente_agenda_snapshot(p_cliente_id uuid,p_hoje date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.loadtest_cliente_agenda_snapshot(p_cliente_id,p_hoje);
$$;
CREATE OR REPLACE FUNCTION public.admin_central_snapshot(p_hoje date,p_limite integer DEFAULT 20,p_estagio text DEFAULT NULL,p_apos_nome text DEFAULT NULL,p_apos_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.loadtest_admin_central_snapshot(p_hoje,p_limite,p_estagio,p_apos_nome,p_apos_id);
$$;
CREATE OR REPLACE FUNCTION public.admin_forecast_page(p_limite integer DEFAULT 50,p_antes_criado timestamptz DEFAULT NULL,p_antes_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.loadtest_admin_forecast_page(p_limite,p_antes_criado,p_antes_id);
$$;
CREATE OR REPLACE FUNCTION public.admin_integration_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT public.loadtest_admin_integration_snapshot(); $$;

CREATE OR REPLACE FUNCTION public.finance_summary(p_inicio date,p_fim date,p_hoje date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT public.loadtest_finance_summary(p_inicio,p_fim,p_hoje); $$;
CREATE OR REPLACE FUNCTION public.finance_receivables_page(p_inicio date,p_fim date,p_status text,p_busca text,p_pagina integer,p_limite integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.loadtest_finance_receivables_page(p_inicio,p_fim,p_status,p_busca,p_pagina,p_limite);
$$;
CREATE OR REPLACE FUNCTION public.finance_client_funnel(p_bucket text,p_busca text,p_ordenacao text,p_pagina integer,p_limite integer,p_hoje date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.loadtest_finance_client_funnel(p_bucket,p_busca,p_ordenacao,p_pagina,p_limite,p_hoje);
$$;
CREATE OR REPLACE FUNCTION public.finance_received_page(p_tipo text,p_data date,p_busca text,p_pagina integer,p_limite integer,p_hoje date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.loadtest_finance_received_page(p_tipo,p_data,p_busca,p_pagina,p_limite,p_hoje);
$$;

REVOKE ALL ON FUNCTION public.agenda_datas_snapshot(date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.agenda_cirurgia_datas_snapshot(date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cliente_financeiro_snapshot(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_clientes_pagina(integer,timestamptz,uuid,text,text,text,timestamptz,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_clientes_pagina_recent(integer,timestamptz,uuid,text,text,text,timestamptz,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_clientes_totais() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_clientes_bancos() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_dashboard_stats(date,date,date,date,date,date,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_dashboard_agenda(date,date,date,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cliente_agenda_snapshot(uuid,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_central_snapshot(date,integer,text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_forecast_page(integer,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_integration_snapshot() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_summary(date,date,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_receivables_page(date,date,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_client_funnel(text,text,text,integer,integer,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_received_page(text,date,text,integer,integer,date) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.agenda_datas_snapshot(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_cirurgia_datas_snapshot(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.cliente_financeiro_snapshot(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_clientes_pagina(integer,timestamptz,uuid,text,text,text,timestamptz,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_clientes_pagina_recent(integer,timestamptz,uuid,text,text,text,timestamptz,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_clientes_totais() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_clientes_bancos() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats(date,date,date,date,date,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_agenda(date,date,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.cliente_agenda_snapshot(uuid,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_central_snapshot(date,integer,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_forecast_page(integer,timestamptz,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_integration_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_summary(date,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_receivables_page(date,date,text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_client_funnel(text,text,text,integer,integer,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_received_page(text,date,text,integer,integer,date) TO service_role;
