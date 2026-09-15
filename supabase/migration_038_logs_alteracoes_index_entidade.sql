-- ============================================================================
-- migration_038_logs_alteracoes_index_entidade.sql
--
-- Extensão aditiva de logs_alteracoes para suportar o histórico por cliente
-- (drawer de Clientes/Financeiro do novo Admin) sem criar uma segunda
-- tabela de auditoria. logs_alteracoes continua a única fonte de histórico.
-- ============================================================================

create index if not exists idx_logs_alteracoes_entidade_id on logs_alteracoes(entidade_id);

-- Boa parte dos eventos de "boleto" guarda cliente_id dentro de detalhes (jsonb),
-- não como coluna própria. Índice de expressão para acelerar esse filtro.
create index if not exists idx_logs_alteracoes_detalhes_cliente_id
  on logs_alteracoes(((detalhes->>'cliente_id')));
