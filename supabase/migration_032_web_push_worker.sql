-- ============================================================================
-- migration_032_web_push_worker.sql
-- Persistência de assinaturas Web Push para o Worker atual.
-- Não ativa envio nem exige conexão com provedor externo nesta etapa.
-- ============================================================================

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_key text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.web_push_subscriptions
  add column if not exists device_key text;

create index if not exists idx_web_push_subscriptions_cliente
  on public.web_push_subscriptions(cliente_id);

create index if not exists idx_web_push_subscriptions_updated
  on public.web_push_subscriptions(updated_at desc);

create index if not exists idx_web_push_subscriptions_device
  on public.web_push_subscriptions(cliente_id, device_key)
  where device_key is not null;

alter table public.web_push_subscriptions enable row level security;

-- A aplicação acessa esta tabela exclusivamente pelo Worker/service role.
-- Nenhuma policy pública é criada.
