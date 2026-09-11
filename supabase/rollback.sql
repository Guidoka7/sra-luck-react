-- SRA. LUCK — ROLLBACK DAS MIGRATIONS FINAIS
-- Data: 2026-09-11
-- Execute somente em incidente e após backup. Este rollback remove infraestrutura
-- de hardening adicionada por supabase/migrations.sql; não apaga clientes, boletos,
-- contratos, pontos, comissões ou treinamentos.

begin;

drop trigger if exists audit_clientes_change on public.clientes;
drop trigger if exists audit_contratos_credito_change on public.contratos_credito;
drop trigger if exists audit_boletos_change on public.boletos;

drop function if exists public.audit_critical_change();
drop function if exists public.dequeue_webhook_events(integer);
drop function if exists public.check_rate_limit(text, integer, integer);

drop table if exists public.webhook_queue;
drop table if exists public.rate_limit_buckets;
drop table if exists public.api_request_metrics;
-- audit_log é preservada deliberadamente para não destruir evidência operacional.

alter table if exists public.clientes drop column if exists deleted_at;
alter table if exists public.clientes drop column if exists deleted_by;
alter table if exists public.contratos_credito drop column if exists deleted_at;
alter table if exists public.contratos_credito drop column if exists deleted_by;
alter table if exists public.colaboradores drop column if exists deleted_at;
alter table if exists public.colaboradores drop column if exists deleted_by;
alter table if exists public.treinamentos drop column if exists deleted_at;
alter table if exists public.clube_recompensas drop column if exists deleted_at;

delete from public.schema_migrations where version in ('001_20260911','002_20260911','003_20260911','004_20260911');

commit;
