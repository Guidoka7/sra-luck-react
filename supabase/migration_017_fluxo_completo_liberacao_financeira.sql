-- ============================================================================
-- MIGRATION 017: Fluxo completo de liberação financeira
--
-- 1) Admin confirma o saldo restante e as formas de custeio permitidas.
-- 2) A confirmação libera a agenda de assinatura dos termos.
-- 3) A cliente escolhe uma forma de custeio; a solicitação volta ao Admin.
-- 4) Ao agendar os termos, a solicitação fica vinculada ao agendamento.
-- 5) A previsão de liberação é sugerida para 90 dias após os termos e pode
--    ser alterada pelo Admin.
-- ============================================================================

alter type forma_custeio_restante add value if not exists 'boleto_100';

alter table clientes add column if not exists financeiro_saldo_restante numeric(12,2);
alter table clientes add column if not exists financeiro_taxa_cartao numeric(12,2) not null default 5.4;
alter table clientes add column if not exists financeiro_total_com_taxa numeric(12,2);
alter table clientes add column if not exists financeiro_formas_custeio text[];
alter table clientes add column if not exists financeiro_confirmado_em timestamptz;

alter table solicitacoes_liberacao_financeira add column if not exists agendamento_id uuid references agendamentos(id) on delete set null;
create index if not exists idx_solicitacoes_liberacao_agendamento on solicitacoes_liberacao_financeira(agendamento_id);

-- A confirmação financeira deve ser a fonte de verdade do saldo apresentado
-- à cliente; a seleção do método não deve recalcular valores silenciosamente.
create index if not exists idx_clientes_financeiro_confirmado on clientes(financeiro_confirmado_em);
