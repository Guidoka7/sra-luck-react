-- ============================================================================
-- migration_046_integracoes_worker_only.sql
-- Hardening: credenciais e staging de integrações são acessíveis somente pelo
-- Worker/service_role. Sessões do navegador (anon/authenticated) não leem nem
-- alteram ciphertext, snapshots, eventos ou pagamentos externos diretamente.
-- ============================================================================

alter table if exists public.integracoes_credenciais enable row level security;
drop policy if exists "admin_full_access_integracoes_credenciais" on public.integracoes_credenciais;

revoke all on table public.integracoes_credenciais from anon, authenticated;
revoke all on table public.integracao_eventos from anon, authenticated;
revoke all on table public.crm_vendas_entrada from anon, authenticated;
revoke all on table public.pagamentos_externos from anon, authenticated;

comment on table public.integracoes_credenciais is 'Cofre cifrado de credenciais. Acesso exclusivo via Worker/service_role.';
comment on table public.integracao_eventos is 'Eventos de integrações externas. Acesso exclusivo via Worker/service_role.';
comment on table public.crm_vendas_entrada is 'Staging somente leitura de eventos/vendas vindos do CRM. Acesso exclusivo via Worker/service_role.';
comment on table public.pagamentos_externos is 'Eventos de pagamento externos aguardando fluxo interno/humano. Acesso exclusivo via Worker/service_role.';
