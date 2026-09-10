-- Telemetria operacional: erros de frontend/API e diagnósticos automáticos.
-- A aplicação grava apenas dados técnicos; não armazenar CPF, senha, token ou payload sensível.

create table if not exists public.monitoramento_erros (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  origem text not null check (origem in ('frontend','api','diagnostico')),
  nivel text not null default 'error' check (nivel in ('warning','error','critical')),
  rota text,
  metodo text,
  status_http integer,
  codigo text,
  mensagem text not null,
  stack text,
  componente text,
  request_id text,
  user_agent text,
  ambiente text,
  detalhes jsonb not null default '{}'::jsonb
);

create index if not exists monitoramento_erros_criado_em_idx on public.monitoramento_erros (criado_em desc);
create index if not exists monitoramento_erros_nivel_idx on public.monitoramento_erros (nivel, criado_em desc);
create index if not exists monitoramento_erros_rota_idx on public.monitoramento_erros (rota, criado_em desc);

alter table public.monitoramento_erros enable row level security;

revoke all on public.monitoramento_erros from anon, authenticated;
