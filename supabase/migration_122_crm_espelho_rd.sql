-- migration_122 — Espelho somente-leitura das negociações e contatos do RD (todos os funis).
--
-- O Console precisa ver os 15 funis do CRM com a quantidade exata de negociações e, para cada
-- cliente de cada funil, a fonte e a campanha de onde ela veio. A importação para o Admin
-- continua só com os funis marcados no Console: estas tabelas NÃO criam vendas nem clientes.
--
-- crm_rd_negociacoes: uma linha por negociação do RD (qualquer funil), com o que a origem usa
--   (fonte, campanha e campos personalizados de origem) e a origem resolvida (fonte/campanha
--   com a prova de onde saiu, inclusive de outros cadastros da mesma pessoa).
-- crm_rd_contatos: uma linha por contato do RD, com e-mails e telefones (chave DDD+número)
--   para reconhecer cadastros diferentes da mesma pessoa.
--
-- Gravadas só pelo servidor (service role): RLS ligado e nenhuma política.
-- A varredura de 6 h regrava tudo e apaga o que não existe mais no RD.
-- Não destrutiva. Rollback: supabase/rollback/migration_122_rollback.sql.

create table if not exists public.crm_rd_negociacoes (
  id text primary key,
  pipeline_id text,
  stage_id text,
  status text,
  owner_id text,
  criada_em timestamptz,
  contact_ids text[] not null default '{}',
  source_id text,
  campaign_id text,
  -- Campos personalizados de origem da negociação (como-ficou-sabendo, influencer, cupom, *-lp).
  campos_origem jsonb not null default '{}'::jsonb,
  vista_em timestamptz not null default now(),
  -- Origem resolvida (crm-origem-geral).
  fonte text,
  campanha text,
  situacao text,
  origem jsonb,
  resolvida_em timestamptz
);
create index if not exists idx_crm_rd_negociacoes_funil on public.crm_rd_negociacoes (pipeline_id);
create index if not exists idx_crm_rd_negociacoes_contatos on public.crm_rd_negociacoes using gin (contact_ids);

create table if not exists public.crm_rd_contatos (
  id text primary key,
  nome text,
  emails text[] not null default '{}',
  telefones text[] not null default '{}',
  criado_em timestamptz,
  visto_em timestamptz not null default now()
);

alter table public.crm_rd_negociacoes enable row level security;
alter table public.crm_rd_contatos enable row level security;
