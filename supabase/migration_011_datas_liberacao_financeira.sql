-- ============================================================================
-- MIGRATION 011: Calendário próprio para a previsão de liberação financeira
-- Execute no SQL Editor do Supabase após testar em dev
--
-- Contexto:
-- Até aqui, a aba "Previsão de liberação financeira" usava as MESMAS datas
-- liberadas na aba "Termos cirúrgicos" (tabela `datas`) como base de
-- disponibilidade. Isso misturava as duas agendas: liberar uma data para
-- assinatura de termos também liberava (indevidamente) essa mesma data
-- para liberação financeira, e vice-versa.
--
-- Essa migration cria uma tabela independente — `datas_liberacao_financeira`
-- — para que o admin controle os dois calendários separadamente:
--   • `datas`                      → datas para AGENDAR A ASSINATURA dos
--                                     termos cirúrgicos (fluxo já existente).
--   • `datas_liberacao_financeira` → datas para AGENDAR O PAGAMENTO
--                                     (liberação do crédito) já com os
--                                     termos assinados.
-- ============================================================================

create table if not exists datas_liberacao_financeira (
  id uuid primary key default gen_random_uuid(),
  data date not null unique,
  status status_data not null default 'disponivel',
  observacoes_internas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_datas_liberacao_financeira_data on datas_liberacao_financeira(data);
create index if not exists idx_datas_liberacao_financeira_status on datas_liberacao_financeira(status);

drop trigger if exists trg_datas_liberacao_financeira_updated_at on datas_liberacao_financeira;
create trigger trg_datas_liberacao_financeira_updated_at before update on datas_liberacao_financeira
  for each row execute function set_updated_at();

-- Nota: nenhuma data é copiada automaticamente da tabela `datas` — a
-- gestão passa a liberar, a partir de agora, as datas de liberação
-- financeira de forma independente, na própria aba do painel.
