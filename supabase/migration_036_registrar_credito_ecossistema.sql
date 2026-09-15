-- ============================================================================
-- migration_036_registrar_credito_ecossistema.sql
--
-- Registra em git/migration history 9 tabelas que já existem no banco
-- conectado (criadas diretamente via SQL/dashboard para o sra-luck-react,
-- confirmado pelo responsável do projeto em 2026-09-14), sem migration
-- correspondente até agora. Nenhum dado é tocado.
--
-- Toda instrução aqui é idempotente por construção (IF NOT EXISTS ou bloco
-- DO com captura de duplicate_object/duplicate_table): rodar esta migration
-- contra o banco que já tem essas tabelas não altera nada (é um no-op);
-- rodar contra um banco vazio (novo ambiente/staging) recria fielmente a
-- mesma estrutura.
--
-- Fonte de verdade detalhada (colunas, defaults, comentários de cada
-- constraint): supabase/baseline/credito-ecossistema-2026-09-14.md, gerado
-- por introspecção direta do banco (information_schema/pg_constraint/
-- pg_indexes/pg_policies/pg_trigger) na mesma data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tipos ENUM
-- ---------------------------------------------------------------------------
do $$ begin
  create type status_nova_venda as enum ('aguardando_cadastro', 'aguardando_boletos', 'financeiro_concluido');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_carne as enum ('ativo', 'concluido');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_importacao_boleto as enum ('processando', 'aguardando_vinculacao', 'aguardando_confirmacao', 'vinculado', 'erro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_conciliacao_pagamento as enum ('pendente', 'conciliado', 'nao_identificado', 'divergencia', 'ignorado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type metodo_conciliacao_pagamento as enum ('boleto', 'pix', 'outro');
exception when duplicate_object then null; end $$;

-- cargo_colaborador já existe desde a migration_030 (equipe_rbac_real); não recriar.

-- ---------------------------------------------------------------------------
-- novas_vendas
-- ---------------------------------------------------------------------------
create table if not exists novas_vendas (
  id uuid primary key default gen_random_uuid(),
  rd_station_id text not null unique,
  cliente_id uuid references clientes(id),
  nome_completo text not null,
  cpf text,
  telefone text,
  email text,
  data_venda timestamptz not null default now(),
  vendedora_responsavel text,
  valor_contrato numeric not null default 0 check (valor_contrato >= 0),
  quantidade_parcelas integer check (quantidade_parcelas is null or quantidade_parcelas > 0),
  valor_parcela numeric,
  taxa_administrativa numeric,
  tipo_venda text,
  origem_venda text,
  status status_nova_venda not null default 'aguardando_cadastro',
  payload_original jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vendedora_id uuid references colaboradores(id)
);

create index if not exists idx_novas_vendas_status on novas_vendas(status);
create index if not exists idx_novas_vendas_data_venda on novas_vendas(data_venda desc);
create index if not exists idx_novas_vendas_cliente on novas_vendas(cliente_id);
create index if not exists idx_novas_vendas_cpf on novas_vendas(cpf);
create index if not exists idx_novas_vendas_vendedora on novas_vendas(vendedora_id);

alter table novas_vendas enable row level security;

do $$ begin
  create policy admin_full_access_novas_vendas on novas_vendas
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- carnes
-- ---------------------------------------------------------------------------
create table if not exists carnes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  instituicao_financeira text not null check (length(trim(instituicao_financeira)) > 0),
  identificador_externo text not null check (length(trim(identificador_externo)) > 0),
  data_geracao date not null,
  quantidade_parcelas integer not null check (quantidade_parcelas > 0),
  valor_parcela numeric not null check (valor_parcela >= 0),
  valor_total numeric not null check (valor_total >= 0),
  status status_carne not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uniq_carne_instituicao_identificador
  on carnes(lower(trim(instituicao_financeira)), lower(trim(identificador_externo)));
create index if not exists idx_carnes_cliente on carnes(cliente_id);
create index if not exists idx_carnes_instituicao on carnes(lower(trim(instituicao_financeira)));
create index if not exists idx_carnes_data_geracao on carnes(data_geracao desc);
create index if not exists idx_carnes_status on carnes(status);

do $$ begin
  create trigger trg_carnes_updated_at before update on carnes
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

alter table carnes enable row level security;

do $$ begin
  create policy admin_full_access_carnes on carnes
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- importacoes_boletos
-- ---------------------------------------------------------------------------
create table if not exists importacoes_boletos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id),
  carne_id uuid references carnes(id),
  boleto_id uuid references boletos(id),
  instituicao_financeira text,
  nosso_numero text,
  numero_documento text,
  identificador_externo text,
  linha_digitavel text,
  codigo_barras text,
  nome_pagador_extraido text,
  cpf_pagador_extraido text,
  valor_extraido numeric,
  vencimento_extraido date,
  numero_parcela integer,
  dados_extraidos jsonb not null default '{}'::jsonb,
  arquivo_nome text,
  arquivo_mime text,
  arquivo_tamanho bigint,
  arquivo_sha256 text,
  arquivo_storage_path text,
  historico jsonb not null default '[]'::jsonb,
  status status_importacao_boleto not null default 'processando',
  erro_detalhes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cliente_sugerido_id uuid references clientes(id),
  carne_sugerido_id uuid references carnes(id),
  boleto_sugerido_id uuid references boletos(id),
  cliente_vinculado_id uuid references clientes(id),
  carne_vinculado_id uuid references carnes(id),
  boleto_vinculado_id uuid references boletos(id),
  pontuacao_confianca integer,
  nivel_confianca text check (nivel_confianca is null or nivel_confianca in ('alta', 'media', 'baixa')),
  status_vinculacao text not null default 'pendente'
    check (status_vinculacao in ('pendente', 'analisado', 'aguardando_confirmacao', 'vinculado', 'ignorado')),
  analise_detalhada jsonb not null default '{}'::jsonb
);

create unique index if not exists uniq_importacao_boleto_arquivo_sha256
  on importacoes_boletos(arquivo_sha256) where arquivo_sha256 is not null and length(trim(arquivo_sha256)) > 0;
create unique index if not exists uniq_importacao_boleto_instituicao_nosso
  on importacoes_boletos(lower(trim(instituicao_financeira)), lower(trim(nosso_numero)))
  where instituicao_financeira is not null and nosso_numero is not null
    and length(trim(instituicao_financeira)) > 0 and length(trim(nosso_numero)) > 0;
create unique index if not exists uniq_importacao_boleto_instituicao_externo
  on importacoes_boletos(lower(trim(instituicao_financeira)), lower(trim(identificador_externo)))
  where instituicao_financeira is not null and identificador_externo is not null
    and length(trim(instituicao_financeira)) > 0 and length(trim(identificador_externo)) > 0;
create index if not exists idx_importacoes_boletos_nivel_confianca on importacoes_boletos(nivel_confianca);
create index if not exists idx_importacoes_boletos_cliente_sugerido on importacoes_boletos(cliente_sugerido_id);
create index if not exists idx_importacoes_boletos_boleto_sugerido on importacoes_boletos(boleto_sugerido_id);
create index if not exists idx_importacoes_boletos_cliente on importacoes_boletos(cliente_id);
create index if not exists idx_importacoes_boletos_carne on importacoes_boletos(carne_id);
create index if not exists idx_importacoes_boletos_boleto on importacoes_boletos(boleto_id);
create index if not exists idx_importacoes_boletos_status on importacoes_boletos(status);
create index if not exists idx_importacoes_boletos_created_at on importacoes_boletos(created_at desc);
create index if not exists idx_importacoes_boletos_instituicao on importacoes_boletos(lower(trim(instituicao_financeira)));
create index if not exists idx_importacoes_boletos_vinculacao_status on importacoes_boletos(status_vinculacao);

do $$ begin
  create trigger trg_importacoes_boletos_updated_at before update on importacoes_boletos
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

alter table importacoes_boletos enable row level security;

do $$ begin
  create policy admin_full_access_importacoes_boletos on importacoes_boletos
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- comissoes
-- ---------------------------------------------------------------------------
create table if not exists comissoes (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id),
  cargo cargo_colaborador not null,
  cliente_id uuid references clientes(id),
  agendamento_id uuid references agendamentos(id),
  boleto_id uuid references boletos(id),
  evento text not null check (evento in ('primeira_parcela_confirmada', 'comparecimento', 'manual_configuracao_financeiro')),
  chave_evento text not null unique,
  valor numeric not null check (valor >= 0),
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'paga')),
  gerado_por uuid,
  pago_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_comissoes_colaborador_created on comissoes(colaborador_id, created_at desc);
create index if not exists idx_comissoes_cliente_evento on comissoes(cliente_id, evento);

do $$ begin
  create trigger trg_comissoes_updated_at before update on comissoes
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

alter table comissoes enable row level security;

do $$ begin
  create policy colaborador_self_comissoes on comissoes
    for select using (exists (select 1 from colaboradores c where c.id = comissoes.colaborador_id and c.auth_user_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- metas_colaboradores
-- ---------------------------------------------------------------------------
create table if not exists metas_colaboradores (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id),
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  meta_minima numeric not null default 0,
  percentual_comissao numeric,
  comissao_estimada numeric,
  comissao_final numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (colaborador_id, ano, mes)
);

do $$ begin
  create trigger trg_metas_colaboradores_updated_at before update on metas_colaboradores
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

alter table metas_colaboradores enable row level security;

do $$ begin
  create policy colaborador_self_meta on metas_colaboradores
    for select using (exists (select 1 from colaboradores c where c.id = metas_colaboradores.colaborador_id and c.auth_user_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- notificacoes_colaboradores
-- ---------------------------------------------------------------------------
create table if not exists notificacoes_colaboradores (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id),
  tipo text not null,
  titulo text not null,
  mensagem text not null,
  data_referencia date,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notificacoes_colaborador_created on notificacoes_colaboradores(colaborador_id, created_at desc);
create unique index if not exists uniq_resumo_colaborador_dia
  on notificacoes_colaboradores(colaborador_id, tipo, data_referencia) where data_referencia is not null;

alter table notificacoes_colaboradores enable row level security;

do $$ begin
  create policy colaborador_self_notificacoes on notificacoes_colaboradores
    for select using (exists (select 1 from colaboradores c where c.id = notificacoes_colaboradores.colaborador_id and c.auth_user_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy colaborador_self_notificacoes_update on notificacoes_colaboradores
    for update
    using (exists (select 1 from colaboradores c where c.id = notificacoes_colaboradores.colaborador_id and c.auth_user_id = auth.uid()))
    with check (exists (select 1 from colaboradores c where c.id = notificacoes_colaboradores.colaborador_id and c.auth_user_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- mensagens_motivacionais
-- ---------------------------------------------------------------------------
create table if not exists mensagens_motivacionais (
  id uuid primary key default gen_random_uuid(),
  cargo cargo_colaborador,
  titulo text not null,
  mensagem text not null,
  programada_para timestamptz,
  ativo boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  create trigger trg_mensagens_motivacionais_updated_at before update on mensagens_motivacionais
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

alter table mensagens_motivacionais enable row level security;
-- Nenhuma policy hoje (só service_role acessa) — preservado fielmente, não é erro a corrigir aqui.

-- ---------------------------------------------------------------------------
-- conciliacao_pagamentos
-- ---------------------------------------------------------------------------
create table if not exists conciliacao_pagamentos (
  id uuid primary key default gen_random_uuid(),
  banco text not null check (length(trim(banco)) > 0),
  identificador_externo text,
  cliente_id uuid references clientes(id),
  boleto_id uuid references boletos(id),
  data_pagamento date not null,
  valor_recebido numeric not null check (valor_recebido >= 0),
  metodo_pagamento metodo_conciliacao_pagamento not null,
  status status_conciliacao_pagamento not null default 'pendente',
  dados_origem jsonb,
  observacao text,
  motivo_divergencia text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conciliacao_pagamentos_divergencia_chk
    check (status <> 'divergencia' or length(trim(coalesce(motivo_divergencia, ''))) > 0),
  constraint conciliacao_pagamentos_ignorado_chk
    check (status <> 'ignorado' or length(trim(coalesce(observacao, motivo_divergencia, ''))) > 0)
);

create unique index if not exists uniq_conciliacao_banco_identificador
  on conciliacao_pagamentos(lower(trim(banco)), identificador_externo)
  where identificador_externo is not null and length(trim(identificador_externo)) > 0;
create index if not exists idx_conciliacao_data_pagamento on conciliacao_pagamentos(data_pagamento desc);
create index if not exists idx_conciliacao_status on conciliacao_pagamentos(status);
create index if not exists idx_conciliacao_banco on conciliacao_pagamentos(lower(trim(banco)));
create index if not exists idx_conciliacao_cliente on conciliacao_pagamentos(cliente_id);
create index if not exists idx_conciliacao_boleto on conciliacao_pagamentos(boleto_id);

do $$ begin
  create trigger trg_conciliacao_pagamentos_updated_at before update on conciliacao_pagamentos
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

alter table conciliacao_pagamentos enable row level security;

do $$ begin
  create policy admin_full_access_conciliacao_pagamentos on conciliacao_pagamentos
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- conciliacao_pagamentos_historico
-- ---------------------------------------------------------------------------
create table if not exists conciliacao_pagamentos_historico (
  id uuid primary key default gen_random_uuid(),
  conciliacao_pagamento_id uuid not null references conciliacao_pagamentos(id),
  usuario text not null,
  created_at timestamptz not null default now(),
  status_anterior status_conciliacao_pagamento,
  status_novo status_conciliacao_pagamento not null,
  cliente_id uuid references clientes(id),
  boleto_id uuid references boletos(id),
  observacao text,
  motivo_divergencia text
);

create index if not exists idx_conciliacao_historico_pagamento on conciliacao_pagamentos_historico(conciliacao_pagamento_id, created_at desc);
create index if not exists idx_conciliacao_historico_created_at on conciliacao_pagamentos_historico(created_at desc);

alter table conciliacao_pagamentos_historico enable row level security;

do $$ begin
  create policy admin_select_conciliacao_historico on conciliacao_pagamentos_historico
    for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy admin_insert_conciliacao_historico on conciliacao_pagamentos_historico
    for insert with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
