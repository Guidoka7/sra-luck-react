-- ============================================================================
-- MIGRATION 014: Índices de desempenho
-- Otimiza as consultas mais frequentes do painel sem alterar regras de negócio.
-- ============================================================================

create index if not exists idx_boletos_cliente_status
  on boletos(cliente_id, status);

create index if not exists idx_boletos_cliente_parcela
  on boletos(cliente_id, numero_parcela);

create index if not exists idx_boletos_status_vencimento
  on boletos(status, data_vencimento);

create index if not exists idx_agendamentos_status_data_id
  on agendamentos(status, data_id);

create index if not exists idx_agendamentos_status_previsao
  on agendamentos(status, previsao_liberacao_financeira);

create index if not exists idx_datas_data
  on datas(data);

create index if not exists idx_clientes_revisao_data
  on clientes(status_revisao_financeira, data_atingiu_percentual);

create index if not exists idx_notificacoes_cliente_created
  on notificacoes_cliente(cliente_id, created_at desc);

create index if not exists idx_notificacao_logs_cliente_created
  on notificacao_logs(cliente_id, created_at desc);

create index if not exists idx_notificacao_logs_created
  on notificacao_logs(created_at desc);
