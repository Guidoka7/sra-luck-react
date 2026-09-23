-- ============================================================================
-- MIGRATION 083: carrossel da Home configurável
--
-- Guarda só os AJUSTES do Admin/Dev Console sobre HOME_CAMPAIGN_SLIDES
-- (ligar/desligar, ordem, textos, tema, destino) e cartões novos que copiam o
-- visual de um cartão existente. Sem linhas aqui, o app mostra o catálogo
-- padrão exatamente como antes. Aditiva: nenhuma tabela existente muda.
-- ============================================================================

begin;

create table if not exists public.home_campanhas_config (
  id text primary key check (id ~ '^[a-z0-9-]{3,60}$'),
  base_id text,
  ativo boolean,
  ordem integer check (ordem is null or ordem between -1000 and 1000),
  dados jsonb not null default '{}'::jsonb,
  atualizado_por text,
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz
);

alter table public.home_campanhas_config enable row level security;
revoke all on public.home_campanhas_config from anon, authenticated;
grant select, insert, update, delete on public.home_campanhas_config to service_role;

commit;
