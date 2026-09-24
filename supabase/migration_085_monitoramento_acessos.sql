-- ============================================================================
-- MIGRATION 085: histórico de acessos do App da cliente e do Admin
--
-- Cada tela aberta gera uma linha: quem (cliente ou colaborador), qual tela,
-- aparelho, se veio do app instalado (PWA) ou do navegador. Alimenta o
-- monitoramento por cliente e por colaborador no Admin/Dev Console.
-- Aditiva: nenhuma tabela ou regra existente é alterada.
-- Retenção: prune_monitoramento_acessos remove linhas antigas (90 dias).
-- ============================================================================

begin;

create table if not exists public.monitoramento_acessos (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  actor_type text not null check (actor_type in ('cliente', 'admin')),
  -- cliente: clientes.id · admin: auth user id do colaborador (sessão admin)
  actor_id uuid not null,
  tela text not null,
  rota text,
  sessao_id text,
  device_key text,
  device_type text,
  display_mode text,
  is_pwa_installed boolean,
  user_agent text
);

create index if not exists idx_monitoramento_acessos_ator
  on public.monitoramento_acessos (actor_type, actor_id, criado_em desc);
create index if not exists idx_monitoramento_acessos_criado_em
  on public.monitoramento_acessos (criado_em desc);

alter table public.monitoramento_acessos enable row level security;
revoke all on public.monitoramento_acessos from anon, authenticated;
grant select, insert, delete on public.monitoramento_acessos to service_role;

create or replace function public.prune_monitoramento_acessos(p_dias integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removidos integer := 0;
begin
  delete from public.monitoramento_acessos
   where criado_em < now() - make_interval(days => greatest(7, p_dias));
  get diagnostics removidos = row_count;
  return removidos;
end;
$$;

revoke all on function public.prune_monitoramento_acessos(integer) from public, anon, authenticated;
grant execute on function public.prune_monitoramento_acessos(integer) to service_role;

commit;
