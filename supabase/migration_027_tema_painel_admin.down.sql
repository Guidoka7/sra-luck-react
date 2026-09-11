-- Rollback da migration 027_tema_painel_admin.sql
-- Remove somente as colunas introduzidas por esta migration.

alter table public.configuracoes
  drop constraint if exists chk_configuracoes_tema_cor_primaria,
  drop constraint if exists chk_configuracoes_tema_cor_secundaria,
  drop constraint if exists chk_configuracoes_tema_cor_destaque;

alter table public.configuracoes
  drop column if exists tema_cor_primaria,
  drop column if exists tema_cor_secundaria,
  drop column if exists tema_cor_destaque;
