-- ============================================================================
-- migration_045_rd_station_read_only.sql
-- Integração RD Station CRM SOMENTE LEITURA + persistência segura de eventos.
--
-- Princípio arquitetural:
--   RD Station -> Sra. Luck = permitido
--   Sra. Luck -> dados comerciais do RD Station = proibido
--
-- As colunas rd_* abaixo formam o snapshot externo. Os campos operacionais já
-- existentes em novas_vendas (nome_completo, origem_venda,
-- vendedora_responsavel etc.) continuam locais e NÃO são sobrescritos por
-- sincronizações posteriores do RD.
--
-- Todas as tabelas novas ficam com RLS habilitado e SEM policy direta. O
-- Worker/service_role é a única autoridade de leitura/escrita; navegador e
-- usuários autenticados não acessam estas tabelas diretamente.
-- ============================================================================

create table if not exists integracao_eventos (
  id uuid primary key default gen_random_uuid(),
  provedor text not null,
  event_id text,
  event_type text not null,
  referencia text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'processado' check (status in ('recebido','processado','parcial','ignorado','erro')),
  erro text,
  processado_em timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists integracao_eventos_provider_event_unique
  on integracao_eventos(provedor, event_id)
  where event_id is not null and length(trim(event_id)) > 0;
create index if not exists integracao_eventos_provider_created_idx
  on integracao_eventos(provedor, created_at desc);
create index if not exists integracao_eventos_status_idx
  on integracao_eventos(status, created_at desc);
alter table integracao_eventos enable row level security;

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
  status text not null default 'aguardando_conferencia'
    check (status in ('aguardando_conferencia','convertido','ignorado','erro')),
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_vendas_transaction_unique
  on crm_vendas_entrada(provedor, transaction_uuid)
  where transaction_uuid is not null and length(trim(transaction_uuid)) > 0;
create index if not exists crm_vendas_deal_idx on crm_vendas_entrada(provedor, external_deal_id, created_at desc);
create index if not exists crm_vendas_status_idx on crm_vendas_entrada(status, created_at desc);
alter table crm_vendas_entrada enable row level security;

create table if not exists pagamentos_externos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) on delete set null,
  boleto_id uuid references boletos(id) on delete set null,
  provedor text not null,
  external_payment_id text not null,
  external_reference text,
  valor numeric(14,2),
  status_provedor text,
  status_validacao text not null default 'aguardando_validacao'
    check (status_validacao in ('aguardando_validacao','em_analise','aprovado','rejeitado','conciliado')),
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
create index if not exists pagamentos_externos_cliente_idx on pagamentos_externos(cliente_id);
alter table pagamentos_externos enable row level security;

alter table novas_vendas add column if not exists campanha_local text;
alter table novas_vendas add column if not exists rd_contact_id text;
alter table novas_vendas add column if not exists rd_campaign_id text;
alter table novas_vendas add column if not exists rd_source_id text;
alter table novas_vendas add column if not exists rd_owner_id text;
alter table novas_vendas add column if not exists rd_pipeline_id text;
alter table novas_vendas add column if not exists rd_stage_id text;
alter table novas_vendas add column if not exists rd_status text;
alter table novas_vendas add column if not exists rd_nome_original text;
alter table novas_vendas add column if not exists rd_cpf_original text;
alter table novas_vendas add column if not exists rd_telefone_original text;
alter table novas_vendas add column if not exists rd_email_original text;
alter table novas_vendas add column if not exists rd_campanha_original text;
alter table novas_vendas add column if not exists rd_origem_original text;
alter table novas_vendas add column if not exists rd_vendedora_original text;
alter table novas_vendas add column if not exists rd_valor_original numeric(14,2);
alter table novas_vendas add column if not exists rd_updated_at timestamptz;
alter table novas_vendas add column if not exists sincronizado_rd_em timestamptz;
alter table novas_vendas add column if not exists rd_excluido_em timestamptz;
alter table novas_vendas add column if not exists rd_snapshot jsonb not null default '{}'::jsonb;

create index if not exists novas_vendas_rd_status_idx on novas_vendas(rd_status);
create index if not exists novas_vendas_rd_owner_idx on novas_vendas(rd_owner_id);
create index if not exists novas_vendas_rd_campaign_idx on novas_vendas(rd_campaign_id);
create index if not exists novas_vendas_rd_sync_idx on novas_vendas(sincronizado_rd_em desc);

comment on column novas_vendas.nome_completo is 'Cópia operacional local. Sincronização RD nunca sobrescreve este campo após a criação.';
comment on column novas_vendas.origem_venda is 'Origem operacional local. O valor original do RD fica em rd_origem_original.';
comment on column novas_vendas.vendedora_responsavel is 'Responsável operacional local. O valor original do RD fica em rd_vendedora_original.';
comment on column novas_vendas.campanha_local is 'Campanha editável apenas no Sra. Luck. O valor do RD fica em rd_campanha_original.';
comment on column novas_vendas.rd_snapshot is 'Último snapshot externo recebido do RD Station. Somente origem externa; nunca usado para escrever de volta no CRM.';
