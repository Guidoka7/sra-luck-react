-- ============================================================================
-- MIGRATION 016: Solicitação de liberação financeira pela cliente
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'forma_custeio_restante') then
    create type forma_custeio_restante as enum ('cartao', 'pix', 'cheques');
  end if;
  if not exists (select 1 from pg_type where typname = 'status_solicitacao_liberacao') then
    create type status_solicitacao_liberacao as enum ('pendente', 'em_analise', 'aprovada', 'recusada');
  end if;
end $$;

create table if not exists solicitacoes_liberacao_financeira (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  forma_custeio forma_custeio_restante not null,
  saldo_restante numeric(12,2) not null check (saldo_restante >= 0),
  taxa_cartao numeric(12,2) not null default 0 check (taxa_cartao >= 0),
  total_com_taxa numeric(12,2) not null check (total_com_taxa >= 0),
  status status_solicitacao_liberacao not null default 'pendente',
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_solicitacoes_liberacao_cliente on solicitacoes_liberacao_financeira(cliente_id, created_at desc);
create unique index if not exists uq_solicitacao_liberacao_pendente on solicitacoes_liberacao_financeira(cliente_id) where status in ('pendente', 'em_analise');

create or replace function atualizar_solicitacao_liberacao_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_solicitacao_liberacao_updated_at on solicitacoes_liberacao_financeira;
create trigger trg_solicitacao_liberacao_updated_at before update on solicitacoes_liberacao_financeira for each row execute function atualizar_solicitacao_liberacao_updated_at();
