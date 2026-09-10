-- ============================================================================
-- MIGRATION 016: Monitoramento de acesso Web/PWA e notificações
-- Registra somente metadados técnicos necessários para acompanhar a adoção do app.
-- ============================================================================

create table if not exists cliente_app_devices (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  device_key text not null,
  device_type text not null default 'unknown',
  display_mode text not null default 'browser',
  is_pwa_installed boolean not null default false,
  notification_permission text not null default 'default',
  push_active boolean not null default false,
  user_agent text,
  first_access_at timestamptz not null default now(),
  last_access_at timestamptz not null default now(),
  pwa_installed_at timestamptz,
  notifications_activated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(cliente_id, device_key)
);

create index if not exists idx_cliente_app_devices_cliente on cliente_app_devices(cliente_id);
create index if not exists idx_cliente_app_devices_last_access on cliente_app_devices(last_access_at desc);
create index if not exists idx_cliente_app_devices_pwa on cliente_app_devices(is_pwa_installed);
create index if not exists idx_cliente_app_devices_push on cliente_app_devices(push_active);

alter table cliente_app_devices enable row level security;

-- Somente Route Handlers autenticados usam service_role para gravar/consultar.
-- Não expõe user-agent, endpoint ou outros metadados entre clientes.
