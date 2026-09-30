-- Rollback da migration_123.
alter table public.crm_rd_contatos drop column if exists dados;
