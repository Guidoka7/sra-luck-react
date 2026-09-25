-- Somente xqlxzdmleekbrietejoq (o Preview isolado usa a chave anon).
-- Não aplicar em produção: esse papel nunca deve ler os dados da cliente.
GRANT EXECUTE ON FUNCTION public.loadtest_agenda_datas_snapshot(date) TO anon;
GRANT EXECUTE ON FUNCTION public.loadtest_agenda_cirurgia_datas_snapshot(date) TO anon;
GRANT EXECUTE ON FUNCTION public.loadtest_cliente_financeiro_snapshot(uuid) TO anon;
