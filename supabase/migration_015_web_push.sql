-- ============================================================================
-- MIGRATION 015: Web Push para notificações do sistema no celular
-- ============================================================================
-- Guarda uma ou mais assinaturas por cliente/dispositivo. O servidor usa
-- service_role para inserir/remover e enviar os pushes; a cliente nunca recebe
-- a chave privada VAPID.

create table if not exists web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_web_push_subscriptions_cliente on web_push_subscriptions(cliente_id);
create index if not exists idx_web_push_subscriptions_updated on web_push_subscriptions(updated_at desc);

alter table web_push_subscriptions enable row level security;

-- Não há policy pública: as Route Handlers validam a sessão da cliente e usam
-- service_role para gravar a assinatura. Assim endpoint/keys nunca ficam
-- expostos para outras clientes.

alter table notificacao_logs add column if not exists push_enviadas integer not null default 0;
alter table notificacao_logs add column if not exists push_falhas integer not null default 0;
alter table notificacao_logs add column if not exists push_status text;
