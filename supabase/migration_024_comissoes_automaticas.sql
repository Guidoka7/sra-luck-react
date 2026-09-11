-- ============================================================================
-- migration_024_comissoes_automaticas.sql
-- Eventos auditáveis de comissão por regra de negócio.
-- ============================================================================

create unique index if not exists colaboradores_auth_user_unique
  on colaboradores(auth_user_id) where auth_user_id is not null;

alter table contratos_credito
  add column if not exists sdr_id uuid references colaboradores(id) on delete set null;

alter table contratos_credito
  drop constraint if exists contratos_credito_vendedor_id_fkey;
alter table contratos_credito
  add constraint contratos_credito_vendedor_id_fkey
  foreign key (vendedor_id) references colaboradores(id) on delete set null;

alter table boletos
  add column if not exists recuperado_por uuid references colaboradores(id) on delete set null;

create table if not exists sdr_agendamentos (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete set null,
  contrato_credito_id uuid references contratos_credito(id) on delete set null,
  agendado_para timestamptz not null,
  compareceu boolean not null default false,
  compareceu_em timestamptz,
  origem text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sdr_agendamentos_colaborador_idx on sdr_agendamentos(colaborador_id, agendado_para desc);

create unique index if not exists comissao_evento_referencia_unique
  on comissao_eventos(colaborador_id, regra_id, referencia_tipo, referencia_id)
  where referencia_id is not null;

create or replace function public.gerar_comissao_primeira_parcela()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  contrato contratos_credito%rowtype;
  regra comissao_regras%rowtype;
  primeira uuid;
begin
  if new.status <> 'pago' or coalesce(old.status,'') = 'pago' or new.contrato_credito_id is null then
    return new;
  end if;

  select * into contrato from contratos_credito where id = new.contrato_credito_id;
  if not found or contrato.vendedor_id is null then return new; end if;

  select id into primeira
  from boletos
  where contrato_credito_id = contrato.id
  order by numero_parcela asc, created_at asc
  limit 1;
  if primeira is distinct from new.id then return new; end if;

  select * into regra
  from comissao_regras
  where perfil = 'vendedora' and ativo = true
  order by vigencia_inicio desc limit 1;
  if not found then return new; end if;

  insert into comissao_eventos (
    colaborador_id, regra_id, referencia_tipo, referencia_id,
    base_calculo, valor_comissao, status, competencia,
    metadata
  ) values (
    contrato.vendedor_id, regra.id, 'primeira_parcela', new.id::text,
    coalesce(new.valor_recebido,new.valor), regra.valor, 'validada', date_trunc('month',coalesce(new.recebido_em,now()))::date,
    jsonb_build_object('contrato_id',contrato.id,'parcela',new.numero_parcela)
  ) on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_comissao_primeira_parcela on boletos;
create trigger trg_comissao_primeira_parcela
after update of status on boletos
for each row execute function public.gerar_comissao_primeira_parcela();

create or replace function public.gerar_comissao_recuperacao_financeira()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  regra comissao_regras%rowtype;
  base numeric(14,2);
  comissao numeric(14,2);
begin
  if new.status <> 'pago' or coalesce(old.status,'') = 'pago' or new.recuperado_por is null then return new; end if;
  if new.data_vencimento is null or new.data_vencimento >= coalesce(new.recebido_em::date,current_date) then return new; end if;

  select * into regra
  from comissao_regras
  where perfil = 'financeiro' and ativo = true
  order by vigencia_inicio desc limit 1;
  if not found then return new; end if;

  base := coalesce(new.valor_recebido,new.valor,0);
  comissao := round(base * regra.valor / 100.0, 2);

  insert into comissao_eventos (
    colaborador_id, regra_id, referencia_tipo, referencia_id,
    base_calculo, valor_comissao, status, competencia,
    metadata
  ) values (
    new.recuperado_por, regra.id, 'parcela_recuperada', new.id::text,
    base, comissao, 'validada', date_trunc('month',coalesce(new.recebido_em,now()))::date,
    jsonb_build_object('vencimento',new.data_vencimento,'dias_atraso',greatest(0,coalesce(new.recebido_em::date,current_date)-new.data_vencimento))
  ) on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_comissao_recuperacao_financeira on boletos;
create trigger trg_comissao_recuperacao_financeira
after update of status on boletos
for each row execute function public.gerar_comissao_recuperacao_financeira();

create or replace function public.gerar_comissao_sdr_comparecimento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  regra comissao_regras%rowtype;
begin
  if new.compareceu is not true or coalesce(old.compareceu,false) is true then return new; end if;

  select * into regra
  from comissao_regras
  where perfil = 'sdr' and ativo = true
  order by vigencia_inicio desc limit 1;
  if not found then return new; end if;

  insert into comissao_eventos (
    colaborador_id, regra_id, referencia_tipo, referencia_id,
    base_calculo, valor_comissao, status, competencia,
    metadata
  ) values (
    new.colaborador_id, regra.id, 'comparecimento_sdr', new.id::text,
    1, regra.valor, 'validada', date_trunc('month',coalesce(new.compareceu_em,now()))::date,
    jsonb_build_object('cliente_id',new.cliente_id,'contrato_id',new.contrato_credito_id)
  ) on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_comissao_sdr_comparecimento on sdr_agendamentos;
create trigger trg_comissao_sdr_comparecimento
after update of compareceu on sdr_agendamentos
for each row execute function public.gerar_comissao_sdr_comparecimento();

alter table sdr_agendamentos enable row level security;
