-- ============================================================================
-- MIGRATION 012: Bloqueio global da agenda de liberação financeira
-- Execute no SQL Editor do Supabase após testar em dev
--
-- Contexto:
-- Além do bloqueio individual por data (coluna `status` em
-- `datas_liberacao_financeira`, já existente desde a migration 011), a
-- gestão precisa de um interruptor único em Configurações para pausar a
-- agenda de liberação financeira inteira de uma vez, sem ter que bloquear
-- data por data.
--
-- Quando `agenda_liberacao_financeira_bloqueada = true`:
--   • o calendário admin (aba "Previsão de liberação financeira") passa a
--     mostrar SOMENTE as datas já disponíveis (verde); todas as demais
--     (não liberadas, bloqueadas individualmente, ou já ocupadas) aparecem
--     como "Lotada", com risco, e ficam não-clicáveis.
-- Quando `agenda_liberacao_financeira_bloqueada = false` (padrão):
--   • o calendário volta a mostrar todos os estados normalmente, como já
--     funciona hoje (verde/amarelo/vermelho/cinza/bloqueado).
--
-- Nenhuma regra de negócio nova é criada: é só uma flag de exibição,
-- lida pelo mesmo calendário que já existe.
-- ============================================================================

alter table configuracoes
  add column if not exists agenda_liberacao_financeira_bloqueada boolean not null default false;
