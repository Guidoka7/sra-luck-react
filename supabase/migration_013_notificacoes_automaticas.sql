-- ============================================================================
-- MIGRATION 013: Automação profissional de notificações de parcelas atrasadas
-- ============================================================================
-- Cria configurações e templates editáveis pelo painel. A execução da rotina
-- é feita pelo endpoint /api/admin/notificacoes/automacao; o worker opcional
-- scripts/notificacoes-cron.mjs pode chamá-lo periodicamente.

insert into notificacoes_config (chave, valor, tipo, descricao) values
  ('atraso_habilitado', 'true', 'boolean', 'Ativar envio automático para parcelas atrasadas'),
  ('frequencia_atraso_horas', '24', 'number', 'Intervalo mínimo entre novos avisos para a mesma parcela'),
  ('max_tentativas', '3', 'number', 'Limite de tentativas de processamento por ciclo')
on conflict (chave) do update set valor = excluded.valor, tipo = excluded.tipo, descricao = excluded.descricao;

insert into notificacao_templates (tipo, dias_referencia, titulo, corpo, emoji, is_active) values
  ('parcela_atrasada', 1, 'Parcela vencida', 'Olá, {{cliente}}. A parcela {{parcela}}/{{total}} venceu em {{vencimento}}. Se já realizou o pagamento, desconsidere este aviso.', '💳', true),
  ('parcela_atrasada', 3, 'Lembrete de pagamento', 'Olá, {{cliente}}. A parcela {{parcela}}/{{total}} está em atraso há {{dias_atraso}} dias. Estamos à disposição para ajudar.', '🔔', true),
  ('parcela_atrasada', 5, 'Precisamos regularizar sua parcela', 'Olá, {{cliente}}. A parcela {{parcela}}/{{total}} continua pendente há {{dias_atraso}} dias. Entre em contato conosco para regularizar.', '⚠️', true),
  ('parcela_atrasada', 7, 'Parcela em atraso há uma semana', 'Olá, {{cliente}}. Identificamos {{dias_atraso}} dias de atraso na parcela {{parcela}}/{{total}}. Fale com nossa equipe para verificarmos a melhor forma de regularização.', '📌', true),
  ('parcela_atrasada', 14, 'Regularização pendente', 'Olá, {{cliente}}. A parcela {{parcela}}/{{total}} permanece pendente há {{dias_atraso}} dias. Nossa equipe está disponível para orientar você.', '🤝', true),
  ('parcela_atrasada', 30, 'Atenção à parcela pendente', 'Olá, {{cliente}}. A parcela {{parcela}}/{{total}} está pendente há {{dias_atraso}} dias. Entre em contato para regularizarmos sua situação.', '🔎', true)
on conflict do nothing;

alter table notificacao_logs add column if not exists referencia_id uuid;

create index if not exists idx_notificacao_logs_cliente_tipo_created on notificacao_logs(cliente_id, tipo, created_at desc);
create index if not exists idx_notificacao_logs_referencia_created on notificacao_logs(referencia_id, created_at desc);
