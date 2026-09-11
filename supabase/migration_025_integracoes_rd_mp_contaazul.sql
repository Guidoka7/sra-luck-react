-- ============================================================================
-- migration_025_integracoes_rd_mp_contaazul.sql
-- Staging seguro para CRM e pagamentos externos antes da conciliação final.
-- ============================================================================

create table if not exists crm_vendas_entrada (
  id uuid primary key default gen_random_uuid(),
  provedor text not null default 'rd_station',
  external_deal_id text,
  transaction_uuid text,
  event_name text not null,
  cliente_nome text,
  cliente_cpf text,
  cliente_email text,
  cliente_telefone text,
  campanha text,
  origem text,
  vendedor text,
  valor_contrato numeric(14,2),
  modalidade text,
  percentual_minimo numeric(5,2),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'aguardando_conferencia' check (status in ('aguardando_conferencia','convertido','ignorado','erro')),
  contrato_credito_id uuid references contratos_credito(id) on delete set null,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_vendas_transaction_unique on crm_vendas_entrada(provedor, transaction_uuid) where transaction_uuid is not null;
create index if not exists crm_vendas_status_idx on crm_vendas_entrada(status, created_at desc);

create table if not exists pagamentos_externos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) on delete set null,
  contrato_credito_id uuid references contratos_credito(id) on delete set null,
  boleto_id uuid references boletos(id) on delete set null,
  provedor text not null,
  external_payment_id text not null,
  external_reference text,
  valor numeric(14,2),
  status_provedor text,
  status_validacao text not null default 'aguardando_validacao' check (status_validacao in ('aguardando_validacao','em_analise','aprovado','rejeitado','conciliado')),
  metodo text,
  pago_em timestamptz,
  payload jsonb not null default '{}'::jsonb,
  analisado_por uuid,
  analisado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provedor, external_payment_id)
);
create index if not exists pagamentos_externos_validacao_idx on pagamentos_externos(status_validacao, created_at desc);
create index if not exists pagamentos_externos_boleto_idx on pagamentos_externos(boleto_id);

create table if not exists conta_azul_operacoes (
  id uuid primary key default gen_random_uuid(),
  boleto_id uuid references boletos(id) on delete set null,
  contrato_credito_id uuid references contratos_credito(id) on delete set null,
  tipo text not null check (tipo in ('criar_receber','alterar_parcela','baixar','alterar_baixa','excluir_baixa')),
  external_id text,
  protocolo text,
  status text not null default 'pendente' check (status in ('pendente','enviado','sucesso','erro')),
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conta_azul_operacoes_status_idx on conta_azul_operacoes(status, created_at desc);

alter table crm_vendas_entrada enable row level security;
alter table pagamentos_externos enable row level security;
alter table conta_azul_operacoes enable row level security;
