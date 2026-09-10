-- ============================================================================
-- MIGRATION 018: Ciclo pós-previsão de liberação financeira
--
-- Guarda a confirmação do custeio para que a agenda possa exigir os dois
-- marcos (custeio + cirurgia realizada) antes de retirar a cliente do fluxo.
-- ============================================================================

alter table clientes add column if not exists custeio_confirmado_em timestamptz;
create index if not exists idx_clientes_custeio_confirmado on clientes(custeio_confirmado_em);
