-- Rollback da migration_122: remove o espelho do RD (os dados voltam na próxima varredura se reaplicada).
drop table if exists public.crm_rd_negociacoes;
drop table if exists public.crm_rd_contatos;
