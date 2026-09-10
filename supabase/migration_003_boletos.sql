-- ============================================================================
-- MIGRATION 003: Sistema de Boletos e Liberação Condicional da Agenda
-- Execute no SQL Editor do Supabase após testar em dev
-- ============================================================================

-- 1. Adicionar campo de quantidade de parcelas em clientes
alter table clientes add column if not exists quantidade_parcelas int default 12 check (quantidade_parcelas in (12, 18, 24, 36, 48, 60));

-- 2. Criar tipo de status para boletos
create type status_boleto as enum ('nao_pago', 'pago', 'pendente_confirmacao', 'rejeitado');

-- 3. Tabela de boletos
create table if not exists boletos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  numero_parcela int not null,
  total_parcelas int not null,
  valor numeric(12,2) not null,
  data_vencimento date,
  status status_boleto not null default 'nao_pago',
  comprovante_url text, -- URL do arquivo no Supabase Storage ou terceiro
  data_pagamento date, -- data real do pagamento confirmado
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  constraint chk_numero_parcela check (numero_parcela > 0 and numero_parcela <= total_parcelas)
);

create index if not exists idx_boletos_cliente on boletos(cliente_id);
create index if not exists idx_boletos_status on boletos(status);
create index if not exists idx_boletos_data_vencimento on boletos(data_vencimento);

-- Unique: uma cliente só pode ter 1 boleto por número de parcela
create unique index if not exists uniq_boleto_por_parcela 
  on boletos(cliente_id, numero_parcela);

-- ============================================================================
-- FUNÇÃO: calcular % de progresso de pagamento para uma cliente
-- Retorna: (parcelas_pagas / total_parcelas) * 100
-- ============================================================================
create or replace function porcentagem_pagamento(p_cliente_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(
    round(
      (count(*) filter (where status = 'pago')::numeric / nullif(max(total_parcelas), 0)) * 100,
      1
    ),
    0
  )::numeric
  from boletos
  where cliente_id = p_cliente_id;
$$;

-- ============================================================================
-- FUNÇÃO: verificar se cliente pode agendar (atingiu % mínima de pagamento)
-- ============================================================================
create or replace function pode_agendar(p_cliente_id uuid)
returns boolean
language sql
stable
as $$
  select case
    when c.quantidade_parcelas is null then false
    when c.quantidade_parcelas in (12, 18, 24) then
      porcentagem_pagamento(p_cliente_id) >= 60
    when c.quantidade_parcelas = 36 then
      porcentagem_pagamento(p_cliente_id) >= 70
    when c.quantidade_parcelas in (48, 60) then
      porcentagem_pagamento(p_cliente_id) >= 80
    else false
  end
  from clientes c
  where c.id = p_cliente_id;
$$;

-- ============================================================================
-- FUNÇÃO: gerar as parcelas (boletos) de uma cliente de uma só vez
-- Usada pelo admin ao definir quantidade_parcelas + valor_contrato.
-- Não duplica: se já existir boleto pra aquele número de parcela, ignora.
-- ============================================================================
create or replace function gerar_boletos_cliente(
  p_cliente_id uuid,
  p_quantidade_parcelas int,
  p_primeiro_vencimento date default (current_date + interval '30 days')::date
)
returns setof boletos
language plpgsql
as $$
declare
  v_valor_contrato numeric(12,2);
  v_valor_parcela numeric(12,2);
  v_num int;
begin
  select valor_contrato into v_valor_contrato from clientes where id = p_cliente_id;
  if v_valor_contrato is null then
    raise exception 'Cliente não encontrada';
  end if;

  v_valor_parcela := round(v_valor_contrato / p_quantidade_parcelas, 2);

  update clientes set quantidade_parcelas = p_quantidade_parcelas where id = p_cliente_id;

  for v_num in 1..p_quantidade_parcelas loop
    insert into boletos (cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status)
    values (
      p_cliente_id,
      v_num,
      p_quantidade_parcelas,
      v_valor_parcela,
      (p_primeiro_vencimento + ((v_num - 1) * interval '30 days'))::date,
      'nao_pago'
    )
    on conflict (cliente_id, numero_parcela) do nothing;
  end loop;

  return query select * from boletos where cliente_id = p_cliente_id order by numero_parcela;
end;
$$;

-- ============================================================================
-- TRIGGER: atualizar updated_at em boletos
-- ============================================================================
drop trigger if exists trg_boletos_updated_at on boletos;
create trigger trg_boletos_updated_at before update on boletos
  for each row execute function set_updated_at();

-- ============================================================================
-- RLS: Row Level Security para boletos
-- ============================================================================
alter table boletos enable row level security;

create policy "admin_full_access_boletos" on boletos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================================
-- REALTIME: para painel admin
-- ============================================================================
alter publication supabase_realtime add table boletos;

-- ============================================================================
-- STORAGE: bucket para comprovantes de pagamento
-- Privado (não público) — o arquivo só é servido via signed URL gerada pela
-- API, tanto pra cliente (dono do comprovante) quanto pro admin.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('comprovantes-pagamento', 'comprovantes-pagamento', false)
on conflict (id) do nothing;

-- Apenas o service_role (usado pelas API routes) acessa o bucket; não criamos
-- policy para 'anon'/'authenticated' pois cliente final não tem sessão do
-- Supabase Auth e o admin acessa via API também. Isso mantém os comprovantes
-- privados por padrão.

-- ============================================================================
-- DADOS DE TESTE (opcional - comente se não quiser)
-- ============================================================================
-- Assumindo que existe uma cliente com id = 'test-cliente-id' (substitua pelo UUID real)
-- insert into boletos (cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status)
-- select 
--   c.id,
--   n.num,
--   12,
--   c.valor_contrato / 12,
--   date_trunc('month', now())::date + (n.num * 30)::int,
--   case when n.num <= 5 then 'pago' else 'nao_pago' end
-- from clientes c
-- cross join generate_series(1, 12) as n(num)
-- where c.nome_completo = 'Cliente Teste'
-- on conflict do nothing;
