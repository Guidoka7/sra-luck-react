-- Somente xqlxzdmleekbrietejoq (o Preview isolado usa a chave anon).
-- Não aplicar em produção: esse papel nunca deve ler os dados da cliente.
GRANT EXECUTE ON FUNCTION public.loadtest_agenda_datas_snapshot(date) TO anon;
GRANT EXECUTE ON FUNCTION public.loadtest_agenda_cirurgia_datas_snapshot(date) TO anon;
GRANT EXECUTE ON FUNCTION public.loadtest_cliente_financeiro_snapshot(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.loadtest_cliente_agenda_snapshot(uuid,date) TO anon;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_clientes_pagina(integer,timestamptz,uuid,text,text,text,timestamptz,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_clientes_pagina_recent(integer,timestamptz,uuid,text,text,text,timestamptz,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_clientes_totais() TO anon;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_clientes_bancos() TO anon;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_dashboard_stats(date,date,date,date,date,date,date) TO anon;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_dashboard_agenda(date,date,date,date) TO anon;
