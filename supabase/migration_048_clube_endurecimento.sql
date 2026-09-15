-- ============================================================================
-- MIGRATION 048: Clube de Vantagens do app cliente
--
-- O arquivo legado migration_022_operacao_credito_ecossistema nunca foi
-- aplicado integralmente no projeto de produção. Por isso esta migration NÃO
-- assume que as tabelas do Clube já existam: ela provisiona somente o subconjunto
-- necessário ao app da cliente, sem ativar o subsistema paralelo de contratos/
-- agenda daquela migration antiga.
--
-- Escopo:
-- - catálogo, saldo, ledger de pontos, indicações e resgates;
-- - benefício de uso único da primeira parcela;
-- - resgate atômico/idempotente;
-- - bônus/notificação quando um boleto muda de status;
-- - acesso direto bloqueado para anon/authenticated; o Worker é a autoridade.
--
-- A migration é aditiva e não remove nem renomeia dados existentes.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Estruturas mínimas do Clube (subconjunto seguro da migration_022 antiga).
-- ----------------------------------------------------------------------------
create table if not exists public.clube_recompensas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  categoria text,
  pontos integer not null check (pontos > 0),
  estoque integer,
  ativo boolean not null default true,
  imagem_url text,
  ordem integer not null default 0,
  icone_key text,
  instrucoes_pos_resgate text,
  created_at timestamptz not null default now()
);

alter table public.clube_recompensas
  add column if not exists ordem integer not null default 0,
  add column if not exists icone_key text,
  add column if not exists instrucoes_pos_resgate text;

create table if not exists public.cliente_pontos (
  cliente_id uuid primary key references public.clientes(id) on delete cascade,
  saldo integer not null default 0 check (saldo >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.cliente_pontos_eventos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  tipo text not null check (tipo in ('indicacao','bonus','resgate','ajuste')),
  pontos integer not null,
  referencia text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.indicacoes_clientes (
  id uuid primary key default gen_random_uuid(),
  indicador_cliente_id uuid not null references public.clientes(id) on delete cascade,
  nome_indicado text not null,
  telefone_indicado text,
  rd_lead_id text,
  status text not null default 'enviada' check (status in ('enviada','qualificada','venda','invalidada')),
  pontos_creditados integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.clube_resgates (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  recompensa_id uuid not null references public.clube_recompensas(id) on delete restrict,
  pontos integer not null,
  status text not null default 'solicitado' check (status in ('solicitado','aprovado','separacao','entregue','cancelado')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clube_resgates
  add column if not exists idempotency_key text;

create unique index if not exists idx_clube_resgates_idempotency_key
  on public.clube_resgates(idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_clube_resgates_cliente_created
  on public.clube_resgates(cliente_id, created_at desc);
create index if not exists idx_cliente_pontos_eventos_cliente_created
  on public.cliente_pontos_eventos(cliente_id, created_at desc);
create index if not exists idx_indicacoes_clientes_indicador_created
  on public.indicacoes_clientes(indicador_cliente_id, created_at desc);

-- Catálogo inicial já previsto na migration_022 original. Só é inserido quando
-- o catálogo estiver completamente vazio, evitando duplicar ou substituir dados.
insert into public.clube_recompensas (titulo, descricao, categoria, pontos, estoque, ordem)
select * from (values
  ('Kit Giovanna Baby','Kit presente com itens selecionados para autocuidado.','Autocuidado',600,20,10),
  ('Massagem relaxante','Sessão de massagem em parceiro credenciado.','Bem-estar',900,20,20),
  ('Nécessaire premium','Nécessaire Sra. Luck em edição especial.','Mimo',450,50,30),
  ('Vale-spa','Crédito para experiência de spa em parceiro selecionado.','Experiência',1200,10,40),
  ('Kit autocuidado','Seleção de cuidados pessoais e aromaterapia.','Autocuidado',750,30,50),
  ('Voucher de beleza','Voucher para serviço de beleza em estabelecimento parceiro.','Experiência',1000,15,60)
) as seed(titulo, descricao, categoria, pontos, estoque, ordem)
where not exists (select 1 from public.clube_recompensas);

-- ----------------------------------------------------------------------------
-- 2. Benefício de uso único e configuração do bônus da primeira parcela.
-- ----------------------------------------------------------------------------
create table if not exists public.clube_beneficios_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  beneficio_key text not null,
  status text not null default 'disponivel' check (status in ('disponivel','utilizado','cancelado')),
  origem text not null,
  referencia_id uuid,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cliente_id, beneficio_key, origem)
);

create index if not exists idx_clube_beneficios_cliente_cliente_id
  on public.clube_beneficios_cliente(cliente_id);

create table if not exists public.clube_config (
  id integer primary key default 1 check (id = 1),
  pontos_primeira_parcela integer not null default 50 check (pontos_primeira_parcela >= 0),
  voucher_primeira_parcela_ativo boolean not null default true,
  voucher_primeira_parcela_titulo text not null default 'Voucher de Consulta com o Doutor',
  updated_at timestamptz not null default now()
);

insert into public.clube_config (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Hardening: o app nunca acessa estas tabelas diretamente. Toda regra passa
--    pelo Cloudflare Worker, que valida a sessão e usa service_role no servidor.
-- ----------------------------------------------------------------------------
alter table public.clube_recompensas enable row level security;
alter table public.cliente_pontos enable row level security;
alter table public.cliente_pontos_eventos enable row level security;
alter table public.indicacoes_clientes enable row level security;
alter table public.clube_resgates enable row level security;
alter table public.clube_beneficios_cliente enable row level security;
alter table public.clube_config enable row level security;

-- Remove políticas permissivas caso esta migration rode em um ambiente onde uma
-- versão anterior tenha sido aplicada parcialmente.
drop policy if exists admin_full_access_clube_recompensas on public.clube_recompensas;
drop policy if exists admin_full_access_cliente_pontos on public.cliente_pontos;
drop policy if exists admin_full_access_cliente_pontos_eventos on public.cliente_pontos_eventos;
drop policy if exists admin_full_access_indicacoes_clientes on public.indicacoes_clientes;
drop policy if exists admin_full_access_clube_resgates on public.clube_resgates;
drop policy if exists admin_full_access_clube_beneficios_cliente on public.clube_beneficios_cliente;
drop policy if exists admin_full_access_clube_config on public.clube_config;

revoke all privileges on table public.clube_recompensas from public, anon, authenticated;
revoke all privileges on table public.cliente_pontos from public, anon, authenticated;
revoke all privileges on table public.cliente_pontos_eventos from public, anon, authenticated;
revoke all privileges on table public.indicacoes_clientes from public, anon, authenticated;
revoke all privileges on table public.clube_resgates from public, anon, authenticated;
revoke all privileges on table public.clube_beneficios_cliente from public, anon, authenticated;
revoke all privileges on table public.clube_config from public, anon, authenticated;

grant select, insert, update, delete on table public.clube_recompensas to service_role;
grant select, insert, update, delete on table public.cliente_pontos to service_role;
grant select, insert, update, delete on table public.cliente_pontos_eventos to service_role;
grant select, insert, update, delete on table public.indicacoes_clientes to service_role;
grant select, insert, update, delete on table public.clube_resgates to service_role;
grant select, insert, update, delete on table public.clube_beneficios_cliente to service_role;
grant select, insert, update, delete on table public.clube_config to service_role;

-- ----------------------------------------------------------------------------
-- 4. Bônus idempotente da primeira parcela.
-- ----------------------------------------------------------------------------
create or replace function public.clube_conceder_bonus_primeira_parcela(
  p_cliente_id uuid,
  p_boleto_id uuid
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_config public.clube_config%rowtype;
  v_beneficio_id uuid;
begin
  select * into v_config from public.clube_config where id = 1;
  if not found or not v_config.voucher_primeira_parcela_ativo then
    return;
  end if;

  insert into public.clube_beneficios_cliente (cliente_id, beneficio_key, origem, referencia_id)
  values (p_cliente_id, 'voucher_consulta_doutor', 'primeira_parcela', p_boleto_id)
  on conflict (cliente_id, beneficio_key, origem) do nothing
  returning id into v_beneficio_id;

  if v_beneficio_id is null then
    return;
  end if;

  if v_config.pontos_primeira_parcela > 0 then
    insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
    values (
      p_cliente_id,
      'bonus',
      v_config.pontos_primeira_parcela,
      p_boleto_id::text,
      jsonb_build_object('motivo', 'primeira_parcela')
    );

    insert into public.cliente_pontos (cliente_id, saldo, updated_at)
    values (p_cliente_id, v_config.pontos_primeira_parcela, now())
    on conflict (cliente_id) do update
      set saldo = public.cliente_pontos.saldo + excluded.saldo,
          updated_at = now();
  end if;

  insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
  values (
    p_cliente_id,
    'clube',
    'Bônus da primeira parcela liberado!',
    format(
      'Você ganhou %s moedas e o %s no Clube de Vantagens.',
      v_config.pontos_primeira_parcela,
      v_config.voucher_primeira_parcela_titulo
    ),
    '🎁',
    'clube',
    v_beneficio_id
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Notificação/bônus no mesmo commit da alteração do boleto, sem substituir
--    as RPCs financeiras existentes. Isso preserva integralmente a lógica do
--    Financeiro e do Mercado Pago atual.
-- ----------------------------------------------------------------------------
create or replace function public.clube_notificar_boleto_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'pago' then
    insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
    values (
      new.cliente_id,
      'parcela',
      'Pagamento confirmado',
      format('Sua parcela %s foi confirmada como paga.', new.numero_parcela),
      '✅',
      'parcelas',
      new.id
    );

    if new.numero_parcela = 1 then
      perform public.clube_conceder_bonus_primeira_parcela(new.cliente_id, new.id);
    end if;
  elsif new.status = 'rejeitado' then
    insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
    values (
      new.cliente_id,
      'parcela',
      'Comprovante rejeitado',
      case
        when nullif(btrim(new.observacoes), '') is not null
          then format('O comprovante da parcela %s foi rejeitado: %s', new.numero_parcela, new.observacoes)
        else format('O comprovante da parcela %s foi rejeitado. Entre em contato com a equipe.', new.numero_parcela)
      end,
      '⚠️',
      'parcelas',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_clube_notificar_boleto_status on public.boletos;
create trigger trg_clube_notificar_boleto_status
after update of status on public.boletos
for each row
when (old.status is distinct from new.status)
execute function public.clube_notificar_boleto_status();

-- ----------------------------------------------------------------------------
-- 6. Resgate atômico e realmente idempotente. O advisory lock serializa retries
--    concorrentes com a mesma chave antes de verificar/insertar o resgate.
-- ----------------------------------------------------------------------------
create or replace function public.clube_resgatar(
  p_cliente_id uuid,
  p_recompensa_id uuid,
  p_idempotency_key text
) returns public.clube_resgates
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recompensa public.clube_recompensas%rowtype;
  v_pontos public.cliente_pontos%rowtype;
  v_resgate public.clube_resgates%rowtype;
  v_saldo_atual integer;
begin
  if p_cliente_id is null or p_recompensa_id is null then
    raise exception 'Cliente e recompensa sao obrigatorios';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 120 then
    raise exception 'Chave de idempotencia invalida';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('clube_resgatar:' || p_idempotency_key, 0));

  select * into v_resgate
  from public.clube_resgates
  where idempotency_key = p_idempotency_key;

  if found then
    if v_resgate.cliente_id <> p_cliente_id or v_resgate.recompensa_id <> p_recompensa_id then
      raise exception 'Chave de idempotencia ja utilizada em outro resgate';
    end if;
    return v_resgate;
  end if;

  select * into v_recompensa
  from public.clube_recompensas
  where id = p_recompensa_id and ativo = true
  for update;
  if not found then
    raise exception 'Recompensa indisponivel';
  end if;

  if v_recompensa.estoque is not null and v_recompensa.estoque <= 0 then
    raise exception 'Recompensa sem estoque disponivel';
  end if;

  insert into public.cliente_pontos (cliente_id, saldo)
  values (p_cliente_id, 0)
  on conflict (cliente_id) do nothing;

  select * into v_pontos
  from public.cliente_pontos
  where cliente_id = p_cliente_id
  for update;

  v_saldo_atual := coalesce(v_pontos.saldo, 0);
  if v_saldo_atual < v_recompensa.pontos then
    raise exception 'Saldo de pontos insuficiente';
  end if;

  update public.cliente_pontos
  set saldo = v_saldo_atual - v_recompensa.pontos,
      updated_at = now()
  where cliente_id = p_cliente_id;

  if v_recompensa.estoque is not null then
    update public.clube_recompensas
    set estoque = estoque - 1
    where id = v_recompensa.id;
  end if;

  insert into public.clube_resgates (cliente_id, recompensa_id, pontos, status, idempotency_key)
  values (p_cliente_id, v_recompensa.id, v_recompensa.pontos, 'solicitado', p_idempotency_key)
  returning * into v_resgate;

  insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
  values (
    p_cliente_id,
    'resgate',
    -v_recompensa.pontos,
    v_resgate.id::text,
    jsonb_build_object('recompensa_id', v_recompensa.id, 'titulo', v_recompensa.titulo)
  );

  insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
  values (
    p_cliente_id,
    'clube',
    'Resgate solicitado',
    format('Seu resgate de "%s" foi enviado para a equipe.', v_recompensa.titulo),
    '🎁',
    'clube',
    v_resgate.id
  );

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (
    'cliente:' || p_cliente_id::text,
    'solicitou_resgate_clube',
    'clube_resgates',
    v_resgate.id,
    jsonb_build_object(
      'cliente_id', p_cliente_id,
      'recompensa_id', v_recompensa.id,
      'pontos', v_recompensa.pontos,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_resgate;
end;
$$;

-- RPCs do Clube ficam exclusivas do Worker/service_role.
revoke all on function public.clube_conceder_bonus_primeira_parcela(uuid, uuid) from public, anon, authenticated;
grant execute on function public.clube_conceder_bonus_primeira_parcela(uuid, uuid) to service_role;

revoke all on function public.clube_notificar_boleto_status() from public, anon, authenticated;
grant execute on function public.clube_notificar_boleto_status() to service_role;

revoke all on function public.clube_resgatar(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.clube_resgatar(uuid, uuid, text) to service_role;

commit;

select 'Migration 048 aplicada com sucesso!' as mensagem;
