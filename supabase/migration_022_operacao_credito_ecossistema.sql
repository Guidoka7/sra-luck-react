-- ============================================================================
-- migration_022_operacao_credito_ecossistema.sql
-- Base aditiva para o novo modelo operacional Sra. Luck.
-- Não remove estruturas legadas; permite migração gradual.
-- ============================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- Contratos / origem comercial / elegibilidade
-- --------------------------------------------------------------------------
create table if not exists contratos_credito (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  codigo text not null unique,
  rd_deal_id text,
  campanha text,
  origem text,
  vendedor_id uuid,
  modalidade text not null default 'flex' check (modalidade in ('flex','100_boleto')),
  valor_contrato numeric(14,2) not null check (valor_contrato >= 0),
  percentual_minimo numeric(5,2) not null default 60 check (percentual_minimo > 0 and percentual_minimo <= 100),
  etapa text not null default 'nova_venda' check (etapa in (
    'nova_venda','aguardando_conferencia','formacao_saldo','proxima_meta','meta_atingida',
    'levantamento_financeiro','forma_pagamento_liberada','termos_agendados','aguardando_quitacao',
    'quitado','agenda_cirurgica_liberada','cirurgia_agendada','concluido','cancelado'
  )),
  data_venda timestamptz default now(),
  data_conferencia timestamptz,
  data_atingiu_percentual timestamptz,
  previsao_atingir_percentual date,
  saldo_final_apurado numeric(14,2),
  forma_quitacao text,
  pagar_no_dia_termos boolean default false,
  termos_assinados_em timestamptz,
  agenda_cirurgica_liberar_em date,
  cirurgia_em date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contratos_credito_cliente_idx on contratos_credito(cliente_id);
create index if not exists contratos_credito_etapa_idx on contratos_credito(etapa);
create index if not exists contratos_credito_previsao_idx on contratos_credito(previsao_atingir_percentual);
create index if not exists contratos_credito_campanha_idx on contratos_credito(campanha);

-- --------------------------------------------------------------------------
-- Vínculos externos: RD, Conta Azul, bancos, Mercado Pago
-- --------------------------------------------------------------------------
create table if not exists integracao_vinculos (
  id uuid primary key default gen_random_uuid(),
  entidade_tipo text not null check (entidade_tipo in ('cliente','contrato','parcela','pagamento','comprovante')),
  entidade_id uuid not null,
  provedor text not null,
  external_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entidade_tipo, entidade_id, provedor),
  unique(provedor, external_id)
);
create index if not exists integracao_vinculos_external_idx on integracao_vinculos(provedor, external_id);

create table if not exists integracao_eventos (
  id uuid primary key default gen_random_uuid(),
  provedor text not null,
  event_id text,
  event_type text not null,
  referencia text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'recebido' check (status in ('recebido','processando','processado','ignorado','erro')),
  erro text,
  processado_em timestamptz,
  created_at timestamptz not null default now(),
  unique(provedor, event_id)
);
create index if not exists integracao_eventos_status_idx on integracao_eventos(status, created_at desc);

-- --------------------------------------------------------------------------
-- Comprovantes e conciliação
-- --------------------------------------------------------------------------
alter table boletos add column if not exists contrato_credito_id uuid references contratos_credito(id) on delete set null;
alter table boletos add column if not exists banco_emissor text;
alter table boletos add column if not exists external_charge_id text;
alter table boletos add column if not exists conta_azul_id text;
alter table boletos add column if not exists mercado_pago_id text;
alter table boletos add column if not exists liquidado_banco_em timestamptz;
alter table boletos add column if not exists valor_recebido numeric(14,2);
alter table boletos add column if not exists juros_recebidos numeric(14,2) default 0;
alter table boletos add column if not exists multa_recebida numeric(14,2) default 0;
alter table boletos add column if not exists desconto_recebido numeric(14,2) default 0;
alter table boletos add column if not exists recebido_em timestamptz;
alter table boletos add column if not exists origem_baixa text;

create table if not exists comprovantes_pagamento (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  boleto_id uuid references boletos(id) on delete set null,
  contrato_credito_id uuid references contratos_credito(id) on delete set null,
  storage_path text not null,
  nome_arquivo text,
  valor_informado numeric(14,2),
  pago_em timestamptz,
  status text not null default 'aguardando_validacao' check (status in ('aguardando_validacao','em_analise','aprovado','rejeitado','conciliado_banco')),
  analisado_por uuid,
  analisado_em timestamptz,
  observacao text,
  created_at timestamptz not null default now()
);
create index if not exists comprovantes_status_idx on comprovantes_pagamento(status, created_at desc);

create table if not exists conciliacao_financeira_eventos (
  id uuid primary key default gen_random_uuid(),
  boleto_id uuid references boletos(id) on delete cascade,
  contrato_credito_id uuid references contratos_credito(id) on delete set null,
  comprovante_id uuid references comprovantes_pagamento(id) on delete set null,
  origem text not null,
  tipo text not null,
  valor numeric(14,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists conciliacao_boleto_idx on conciliacao_financeira_eventos(boleto_id, created_at desc);

-- --------------------------------------------------------------------------
-- Agenda de termos e cirurgia
-- --------------------------------------------------------------------------
create table if not exists agenda_janelas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('termos','cirurgia')),
  data date not null,
  horario_inicio time not null,
  horario_fim time,
  vagas integer not null default 1 check (vagas >= 0),
  status text not null default 'disponivel' check (status in ('disponivel','bloqueado','esgotado')),
  observacao text,
  created_at timestamptz not null default now(),
  unique(tipo, data, horario_inicio)
);

create table if not exists agenda_reservas_credito (
  id uuid primary key default gen_random_uuid(),
  contrato_credito_id uuid not null references contratos_credito(id) on delete cascade,
  janela_id uuid not null references agenda_janelas(id) on delete restrict,
  tipo text not null check (tipo in ('termos','cirurgia')),
  status text not null default 'agendado' check (status in ('agendado','confirmado','reagendado','cancelado','concluido')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agenda_reserva_contrato_idx on agenda_reservas_credito(contrato_credito_id, tipo);

-- --------------------------------------------------------------------------
-- Clube de vantagens / indicações
-- --------------------------------------------------------------------------
create table if not exists clube_recompensas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  categoria text,
  pontos integer not null check (pontos > 0),
  estoque integer,
  ativo boolean not null default true,
  imagem_url text,
  created_at timestamptz not null default now()
);

create table if not exists cliente_pontos (
  cliente_id uuid primary key references clientes(id) on delete cascade,
  saldo integer not null default 0 check (saldo >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists cliente_pontos_eventos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo text not null check (tipo in ('indicacao','bonus','resgate','ajuste')),
  pontos integer not null,
  referencia text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists indicacoes_clientes (
  id uuid primary key default gen_random_uuid(),
  indicador_cliente_id uuid not null references clientes(id) on delete cascade,
  nome_indicado text not null,
  telefone_indicado text,
  rd_lead_id text,
  status text not null default 'enviada' check (status in ('enviada','qualificada','venda','invalidada')),
  pontos_creditados integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists clube_resgates (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  recompensa_id uuid not null references clube_recompensas(id) on delete restrict,
  pontos integer not null,
  status text not null default 'solicitado' check (status in ('solicitado','aprovado','separacao','entregue','cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into clube_recompensas (titulo,descricao,categoria,pontos,estoque)
select * from (values
  ('Kit Giovanna Baby','Kit presente com itens selecionados para autocuidado.','Autocuidado',600,20),
  ('Massagem relaxante','Sessão de massagem em parceiro credenciado.','Bem-estar',900,20),
  ('Nécessaire premium','Nécessaire Sra. Luck em edição especial.','Mimo',450,50),
  ('Vale-spa','Crédito para experiência de spa em parceiro selecionado.','Experiência',1200,10),
  ('Kit autocuidado','Seleção de cuidados pessoais e aromaterapia.','Autocuidado',750,30),
  ('Voucher de beleza','Voucher para serviço de beleza em estabelecimento parceiro.','Experiência',1000,15)
) as seed(titulo,descricao,categoria,pontos,estoque)
where not exists (select 1 from clube_recompensas);

-- --------------------------------------------------------------------------
-- Colaboradores, permissões, treinamento e comissão
-- --------------------------------------------------------------------------
create table if not exists colaboradores (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  nome text not null,
  email text unique,
  perfil text not null check (perfil in ('vendedora','sdr','financeiro','gestao','admin')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists comissao_regras (
  id uuid primary key default gen_random_uuid(),
  perfil text not null,
  nome text not null,
  tipo text not null check (tipo in ('valor_fixo','percentual','faixa')),
  valor numeric(14,4) not null,
  meta_base numeric(14,2),
  configuracao jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  vigencia_inicio date not null default current_date,
  vigencia_fim date,
  created_at timestamptz not null default now()
);

insert into comissao_regras (perfil,nome,tipo,valor,meta_base)
select * from (values
  ('vendedora','Primeira parcela paga','valor_fixo',100.00::numeric,null::numeric),
  ('sdr','Comparecimento em agendamento','valor_fixo',10.00::numeric,null::numeric),
  ('financeiro','Recuperação de carteira em atraso','percentual',1.69::numeric,90000.00::numeric)
) as seed(perfil,nome,tipo,valor,meta_base)
where not exists (select 1 from comissao_regras);

create table if not exists comissao_eventos (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id) on delete cascade,
  regra_id uuid references comissao_regras(id) on delete set null,
  referencia_tipo text,
  referencia_id text,
  base_calculo numeric(14,2),
  valor_comissao numeric(14,2) not null,
  status text not null default 'prevista' check (status in ('prevista','validada','paga','cancelada')),
  competencia date not null default date_trunc('month', current_date)::date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists comissao_eventos_colaborador_idx on comissao_eventos(colaborador_id, competencia desc);

create table if not exists treinamentos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  tipo text not null check (tipo in ('video','imagem','texto','misto')),
  conteudo_url text,
  conteudo_texto text,
  perfis text[] not null default array['todos']::text[],
  obrigatorio boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists treinamento_progresso (
  treinamento_id uuid not null references treinamentos(id) on delete cascade,
  colaborador_id uuid not null references colaboradores(id) on delete cascade,
  progresso integer not null default 0 check (progresso between 0 and 100),
  concluido_em timestamptz,
  updated_at timestamptz not null default now(),
  primary key (treinamento_id,colaborador_id)
);

-- RLS: novas tabelas são acessadas pelo Worker/service role até criação de políticas específicas.
alter table contratos_credito enable row level security;
alter table integracao_vinculos enable row level security;
alter table integracao_eventos enable row level security;
alter table comprovantes_pagamento enable row level security;
alter table conciliacao_financeira_eventos enable row level security;
alter table agenda_janelas enable row level security;
alter table agenda_reservas_credito enable row level security;
alter table clube_recompensas enable row level security;
alter table cliente_pontos enable row level security;
alter table cliente_pontos_eventos enable row level security;
alter table indicacoes_clientes enable row level security;
alter table clube_resgates enable row level security;
alter table colaboradores enable row level security;
alter table comissao_regras enable row level security;
alter table comissao_eventos enable row level security;
alter table treinamentos enable row level security;
alter table treinamento_progresso enable row level security;
