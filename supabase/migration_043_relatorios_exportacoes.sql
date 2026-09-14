-- ============================================================================
-- migration_043_relatorios_exportacoes.sql
--
-- Fase 10: histórico de exportações de relatórios (PDF/Excel). Aditiva.
-- ============================================================================

create table if not exists relatorios_exportacoes (
  id uuid primary key default gen_random_uuid(),
  modulo text not null,
  relatorio_id text not null,
  formato text not null check (formato in ('pdf', 'xlsx')),
  filtros jsonb not null default '{}'::jsonb,
  colunas jsonb not null default '[]'::jsonb,
  total_linhas integer not null default 0,
  nome_arquivo text not null,
  gerado_por text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_relatorios_exportacoes_created_at on relatorios_exportacoes(created_at desc);
create index if not exists idx_relatorios_exportacoes_modulo on relatorios_exportacoes(modulo);

alter table relatorios_exportacoes enable row level security;

do $$ begin
  create policy admin_full_access_relatorios_exportacoes on relatorios_exportacoes
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
