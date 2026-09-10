-- ============================================================================
-- SCHEMA: Sra. Luck — Cirurgia Programada
-- Execute no SQL Editor do Supabase (Painel > SQL Editor > New query > Run)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- configuracoes: linha única (singleton) com textos e metas editáveis
-- ----------------------------------------------------------------------------
create table if not exists configuracoes (
  id int primary key default 1,
  nome_clinica text not null default 'Sra. Luck',
  meta_orcamento_mensal numeric(12,2) not null default 100000,
  frase_sonho text not null default 'Seu sonho tem uma data.',
  updated_at timestamptz not null default now(),
  constraint singleton check (id = 1)
);
insert into configuracoes (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- clientes: cadastradas pelo admin. Login da cliente = CPF + data de nascimento
-- ----------------------------------------------------------------------------
create type status_cirurgia as enum ('nao_agendada', 'agendada', 'realizada', 'cancelada');
create type status_financeiro as enum ('pago', 'a_pagar', 'parcial');

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  nome_completo text not null,
  cpf text not null unique, -- apenas dígitos, 11 caracteres
  data_nascimento date not null,
  telefone text,
  email text,
  procedimento text,
  medico text,
  hospital text,
  consultora text,
  valor_contrato numeric(12,2) not null default 0,
  status_cirurgia status_cirurgia not null default 'nao_agendada',
  status_financeiro status_financeiro not null default 'a_pagar',
  ativo boolean not null default true,
  observacoes_internas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_clientes_cpf on clientes(cpf);
create index if not exists idx_clientes_status_financeiro on clientes(status_financeiro);
create index if not exists idx_clientes_status_cirurgia on clientes(status_cirurgia);

-- ----------------------------------------------------------------------------
-- datas: dias liberados pelo admin para cirurgia, com número de vagas
-- ----------------------------------------------------------------------------
create type status_data as enum ('disponivel', 'bloqueado');

create table if not exists datas (
  id uuid primary key default gen_random_uuid(),
  data date not null unique,
  vagas_totais int not null default 1,
  status status_data not null default 'disponivel',
  observacoes_internas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_datas_data on datas(data);
create index if not exists idx_datas_status on datas(status);

-- ----------------------------------------------------------------------------
-- agendamentos: confirmação de uma cliente em uma data.
-- valor_contrato é uma cópia do valor no momento do agendamento (snapshot),
-- para o orçamento do mês não mudar retroativamente se o contrato for editado depois.
-- ----------------------------------------------------------------------------
create type status_agendamento as enum ('confirmado', 'cancelado');

create table if not exists agendamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  data_id uuid not null references datas(id) on delete cascade,
  valor_contrato numeric(12,2) not null,
  status status_agendamento not null default 'confirmado',
  observacoes_internas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- O frontend já envia o horário escolhido. Mantemos a migração idempotente
-- para bancos existentes cujo schema ainda não possua a coluna.
alter table agendamentos add column if not exists horario_termos text;

create index if not exists idx_agendamentos_cliente on agendamentos(cliente_id);
create index if not exists idx_agendamentos_data on agendamentos(data_id);
create index if not exists idx_agendamentos_status on agendamentos(status);

-- uma cliente só pode ter 1 agendamento confirmado por vez
create unique index if not exists uniq_agendamento_confirmado_por_cliente
  on agendamentos(cliente_id) where (status = 'confirmado');

-- ----------------------------------------------------------------------------
-- logs_alteracoes: auditoria de ações do admin
-- ----------------------------------------------------------------------------
create table if not exists logs_alteracoes (
  id uuid primary key default gen_random_uuid(),
  usuario text not null,
  acao text not null,
  entidade text not null,
  entidade_id uuid,
  detalhes jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_logs_created_at on logs_alteracoes(created_at desc);

-- ============================================================================
-- FUNÇÃO: soma do orçamento confirmado em um mês (para a barra de R$100.000)
-- ============================================================================
create or replace function orcamento_do_mes(p_ano int, p_mes int)
returns numeric
language sql
stable
as $$
  select coalesce(sum(a.valor_contrato), 0)::numeric
  from agendamentos a
  join datas d on d.id = a.data_id
  where a.status = 'confirmado'
    and extract(year from d.data) = p_ano
    and extract(month from d.data) = p_mes;
$$;

-- ============================================================================
-- FUNÇÃO: vagas ocupadas em uma data
-- ============================================================================
create or replace function vagas_ocupadas(p_data_id uuid)
returns int
language sql
stable
as $$
  select count(*)::int from agendamentos
  where data_id = p_data_id and status = 'confirmado';
$$;

-- ============================================================================
-- FUNÇÃO: agendamento atômico de uma data
-- Evita overbooking quando duas clientes tentam reservar a última vaga ao mesmo tempo.
-- ============================================================================
create or replace function agendar_data(
  p_cliente_id uuid,
  p_data_id uuid,
  p_valor_contrato numeric,
  p_horario_termos text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data datas%rowtype;
  v_agendamento_id uuid;
begin
  -- O lock da linha da data serializa as reservas concorrentes dessa data.
  select * into v_data
  from datas
  where id = p_data_id
  for update;

  if not found or v_data.status <> 'disponivel' then
    raise exception using errcode = 'P0001', message = 'DATA_INDISPONIVEL';
  end if;

  if exists (
    select 1 from agendamentos
    where cliente_id = p_cliente_id and status = 'confirmado'
  ) then
    raise exception using errcode = 'P0002', message = 'CLIENTE_JA_AGENDADA';
  end if;

  if (
    select count(*)
    from agendamentos
    where data_id = p_data_id and status = 'confirmado'
  ) >= v_data.vagas_totais then
    raise exception using errcode = 'P0003', message = 'VAGAS_ESGOTADAS';
  end if;

  insert into agendamentos (
    cliente_id,
    data_id,
    valor_contrato,
    status,
    horario_termos
  )
  values (
    p_cliente_id,
    p_data_id,
    p_valor_contrato,
    'confirmado',
    p_horario_termos
  )
  returning id into v_agendamento_id;

  return v_agendamento_id;
exception
  when unique_violation then
    raise exception using errcode = 'P0004', message = 'CLIENTE_JA_AGENDADA';
end;
$$;

-- A função é usada pelo servidor com service_role. Não a exponha para clientes.
revoke all on function agendar_data(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function agendar_data(uuid, uuid, numeric, text) to service_role;

-- ============================================================================
-- TRIGGER: updated_at automático
-- ============================================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_clientes_updated_at on clientes;
create trigger trg_clientes_updated_at before update on clientes
  for each row execute function set_updated_at();

drop trigger if exists trg_datas_updated_at on datas;
create trigger trg_datas_updated_at before update on datas
  for each row execute function set_updated_at();

drop trigger if exists trg_agendamentos_updated_at on agendamentos;
create trigger trg_agendamentos_updated_at before update on agendamentos
  for each row execute function set_updated_at();

drop trigger if exists trg_configuracoes_updated_at on configuracoes;
create trigger trg_configuracoes_updated_at before update on configuracoes
  for each row execute function set_updated_at();

-- ============================================================================
-- RLS — todo o acesso passa pelas API routes do Next.js (service_role no
-- servidor). O admin autenticado via Supabase Auth também tem acesso direto.
-- A cliente final NUNCA acessa o Supabase diretamente do navegador.
-- ============================================================================
alter table configuracoes enable row level security;
alter table clientes enable row level security;
alter table datas enable row level security;
alter table agendamentos enable row level security;
alter table logs_alteracoes enable row level security;

create policy "admin_full_access_configuracoes" on configuracoes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin_full_access_clientes" on clientes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin_full_access_datas" on datas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin_full_access_agendamentos" on agendamentos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin_full_access_logs" on logs_alteracoes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================================
-- REALTIME (opcional, para o painel admin atualizar sozinho)
-- ============================================================================
alter publication supabase_realtime add table datas;
alter publication supabase_realtime add table agendamentos;
