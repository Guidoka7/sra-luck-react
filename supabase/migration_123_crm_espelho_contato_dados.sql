-- migration_123 — Espelho do RD guarda o contato completo usado pela importação.
--
-- Com todos os funis marcados, a importação consultava o RD uma vez por cliente nova para ler o
-- contato (~250 clientes a cada 5 min: horas para trazer tudo). A varredura já lê todos os contatos
-- (100 por consulta); com o contato inteiro guardado aqui (mesmo formato do cache da venda), a
-- importação usa o espelho e só consulta o RD o que ainda não está nele.
--
-- Não destrutiva. Rollback: supabase/rollback/migration_123_rollback.sql.

alter table public.crm_rd_contatos add column if not exists dados jsonb;
