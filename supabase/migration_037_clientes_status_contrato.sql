-- ============================================================================
-- migration_037_clientes_status_contrato.sql
--
-- Fase 1 do plano ZIP Admin: status de contrato (Ativo/Suspenso/Negativado/
-- Cancelado) e suspensão com janela de datas, exigidos pelas telas de
-- Clientes e Financeiro do novo design.
--
-- "Ativo" é derivado automaticamente pelo backend quando o cliente tem ao
-- menos uma parcela gerada (não depende de carnê importado). Os demais
-- estados são sempre definidos manualmente pelo Worker (nunca pelo cliente
-- final, nunca só pela UI). Aditiva: coluna nova com default seguro, todos
-- os clientes existentes ficam automaticamente 'ativo'.
-- ============================================================================

do $$ begin
  create type status_contrato_cliente as enum ('ativo', 'suspenso', 'negativado', 'cancelado');
exception when duplicate_object then null; end $$;

alter table clientes
  add column if not exists status_contrato status_contrato_cliente not null default 'ativo',
  add column if not exists suspenso_desde date,
  add column if not exists suspenso_ate date,
  add column if not exists suspensao_motivo text;

comment on column clientes.status_contrato is
  'Ativo é automático (>=1 parcela gerada). Suspenso/Negativado/Cancelado são sempre manuais, via endpoint auditado.';
comment on column clientes.suspenso_ate is
  'NULL enquanto suspenso = suspensão por prazo indeterminado.';

create index if not exists idx_clientes_status_contrato on clientes(status_contrato);
