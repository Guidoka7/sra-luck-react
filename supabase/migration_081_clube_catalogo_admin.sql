-- ============================================================================
-- MIGRATION 081: catálogo do Clube gerenciável pelo Admin
--
-- Permite exclusão lógica de recompensas sem romper o histórico de resgates.
-- Pausa continua usando ativo=false; exclusão usa excluido_em.
-- ============================================================================

begin;

alter table public.clube_recompensas
  add column if not exists excluido_em timestamptz;

create index if not exists idx_clube_recompensas_catalogo_visivel
  on public.clube_recompensas (ativo, ordem, pontos)
  where excluido_em is null;

commit;
