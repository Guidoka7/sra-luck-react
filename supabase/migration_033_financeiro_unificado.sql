-- Financeiro Unificado - fase 1
-- Esta migration e versionada, mas nao deve ser aplicada automaticamente em producao.

create table if not exists public.financeiro_recebimentos (
  id uuid primary key default gen_random_uuid(),
  boleto_id uuid not null references public.boletos(id) on delete restrict,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  valor_original numeric(12,2) not null check (valor_original >= 0),
  juros numeric(12,2) not null default 0 check (juros >= 0),
  multa numeric(12,2) not null default 0 check (multa >= 0),
  desconto numeric(12,2) not null default 0 check (desconto >= 0),
  valor_recebido numeric(12,2) not null check (valor_recebido >= 0),
  data_pagamento date,
  forma_pagamento text,
  instituicao_conta text,
  origem text not null check (origem in ('manual', 'comprovante', 'historico', 'banco', 'mercado_pago', 'conta_azul')),
  status_validacao text not null check (status_validacao in ('pendente', 'validado', 'rejeitado')),
  comprovante_url text,
  external_payment_id text,
  external_reference text,
  origem_boleto text,
  instituicao_financeira text,
  observacao text,
  motivo_rejeicao text,
  idempotency_key text not null unique,
  criado_por text not null,
  validado_por text,
  validado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financeiro_recebimentos_forma_check check (
    forma_pagamento is null or forma_pagamento in ('pix', 'dinheiro', 'transferencia', 'boleto', 'cartao', 'cheque', 'comprovante', 'outro')
  ),
  constraint financeiro_recebimentos_total_check check (
    desconto <= valor_original + juros + multa
  ),
  constraint financeiro_recebimentos_validado_check check (
    status_validacao <> 'validado'
    or (
      data_pagamento is not null
      and (forma_pagamento is not null or origem = 'historico')
      and round(valor_recebido, 2) = round(valor_original + juros + multa - desconto, 2)
      and validado_por is not null
      and validado_em is not null
    )
  ),
  constraint financeiro_recebimentos_rejeicao_check check (
    status_validacao <> 'rejeitado' or nullif(btrim(motivo_rejeicao), '') is not null
  )
);

create index if not exists idx_financeiro_recebimentos_boleto
  on public.financeiro_recebimentos (boleto_id);
create index if not exists idx_financeiro_recebimentos_cliente
  on public.financeiro_recebimentos (cliente_id);
create index if not exists idx_financeiro_recebimentos_data
  on public.financeiro_recebimentos (data_pagamento desc);
create index if not exists idx_financeiro_recebimentos_validacao
  on public.financeiro_recebimentos (status_validacao, created_at desc);
create unique index if not exists uniq_financeiro_recebimento_validado_boleto
  on public.financeiro_recebimentos (boleto_id)
  where status_validacao = 'validado';

-- Compatibilidade historica: boletos ja pagos antes da criacao do ledger.
-- A leitura dinamica preserva os campos que existem no banco conectado sem
-- impedir que um ambiente historico sem essas colunas execute a migration.
-- Este INSERT nao atualiza boletos, portanto nao dispara nova baixa, comissao
-- ou recalculo de elegibilidade. ON CONFLICT torna o backfill repetivel.
do $backfill$
declare
  v_origem_boleto text := 'null::text';
  v_instituicao_financeira text := 'null::text';
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'boletos' and column_name = 'origem_boleto'
  ) then
    v_origem_boleto := 'b.origem_boleto::text';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'boletos' and column_name = 'instituicao_financeira'
  ) then
    v_instituicao_financeira := 'b.instituicao_financeira::text';
  end if;

  execute format($sql$
    insert into public.financeiro_recebimentos (
      boleto_id, cliente_id, valor_original, juros, multa, desconto, valor_recebido,
      data_pagamento, forma_pagamento, instituicao_conta, origem, status_validacao,
      comprovante_url, origem_boleto, instituicao_financeira, idempotency_key,
      criado_por, validado_por, validado_em
    )
    select
      b.id, b.cliente_id, b.valor, 0, 0, 0, b.valor,
      b.data_pagamento, null, %2$s, 'historico', 'validado',
      b.comprovante_url, %1$s, %2$s,
      'migration-033:historico-pago:' || b.id::text,
      'migration:033', 'migration:033', now()
    from public.boletos b
    where b.status = 'pago'
      and b.data_pagamento is not null
    on conflict do nothing
  $sql$, v_origem_boleto, v_instituicao_financeira);
end;
$backfill$;

create or replace function public.financeiro_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_financeiro_recebimentos_updated_at on public.financeiro_recebimentos;
create trigger trg_financeiro_recebimentos_updated_at
before update on public.financeiro_recebimentos
for each row execute function public.financeiro_set_updated_at();

create or replace function public.financeiro_baixar_boleto(
  p_boleto_id uuid,
  p_data_pagamento date,
  p_juros numeric,
  p_multa numeric,
  p_desconto numeric,
  p_forma_pagamento text,
  p_instituicao_conta text,
  p_observacao text,
  p_usuario text,
  p_idempotency_key text
)
returns public.financeiro_recebimentos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_boleto public.boletos%rowtype;
  v_recebimento public.financeiro_recebimentos%rowtype;
  v_juros numeric(12,2) := round(coalesce(p_juros, 0), 2);
  v_multa numeric(12,2) := round(coalesce(p_multa, 0), 2);
  v_desconto numeric(12,2) := round(coalesce(p_desconto, 0), 2);
  v_total numeric(12,2);
begin
  if p_data_pagamento is null then raise exception 'Data do pagamento obrigatoria'; end if;
  if p_forma_pagamento not in ('pix', 'dinheiro', 'transferencia', 'boleto', 'cartao', 'cheque', 'outro') then
    raise exception 'Forma de pagamento invalida';
  end if;
  if v_juros < 0 or v_multa < 0 or v_desconto < 0 then raise exception 'Composicao financeira invalida'; end if;

  select * into v_boleto from public.boletos where id = p_boleto_id for update;
  if not found then raise exception 'Parcela nao encontrada'; end if;

  -- A consulta da chave ocorre depois do lock para que retries concorrentes
  -- retornem o mesmo lançamento, em vez de disputarem o INSERT único.
  select * into v_recebimento
  from public.financeiro_recebimentos
  where idempotency_key = p_idempotency_key;
  if found then return v_recebimento; end if;

  if v_boleto.status = 'pago' then raise exception 'Parcela ja liquidada'; end if;

  v_total := round(v_boleto.valor + v_juros + v_multa - v_desconto, 2);
  if v_total < 0 then raise exception 'Desconto superior ao valor devido'; end if;

  insert into public.financeiro_recebimentos (
    boleto_id, cliente_id, valor_original, juros, multa, desconto, valor_recebido,
    data_pagamento, forma_pagamento, instituicao_conta, origem, status_validacao,
    comprovante_url, observacao, idempotency_key, criado_por, validado_por, validado_em
  ) values (
    v_boleto.id, v_boleto.cliente_id, v_boleto.valor, v_juros, v_multa, v_desconto, v_total,
    p_data_pagamento, p_forma_pagamento, nullif(btrim(p_instituicao_conta), ''), 'manual', 'validado',
    v_boleto.comprovante_url, nullif(btrim(p_observacao), ''), p_idempotency_key, p_usuario, p_usuario, now()
  ) returning * into v_recebimento;

  update public.boletos
  set status = 'pago', data_pagamento = p_data_pagamento,
      observacoes = coalesce(nullif(btrim(p_observacao), ''), observacoes)
  where id = v_boleto.id;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, 'baixou_parcela_manual', 'boletos', v_boleto.id,
    jsonb_build_object('recebimento_id', v_recebimento.id, 'cliente_id', v_boleto.cliente_id,
      'valor_original', v_boleto.valor, 'juros', v_juros, 'multa', v_multa,
      'desconto', v_desconto, 'valor_recebido', v_total, 'forma_pagamento', p_forma_pagamento));

  return v_recebimento;
end;
$$;

create or replace function public.financeiro_validar_comprovante(
  p_boleto_id uuid,
  p_acao text,
  p_observacao text,
  p_usuario text,
  p_idempotency_key text
)
returns public.financeiro_recebimentos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_boleto public.boletos%rowtype;
  v_recebimento public.financeiro_recebimentos%rowtype;
begin
  if p_acao not in ('confirmar', 'rejeitar') then raise exception 'Acao de validacao invalida'; end if;
  if p_acao = 'rejeitar' and nullif(btrim(p_observacao), '') is null then
    raise exception 'Motivo da rejeicao obrigatorio';
  end if;

  select * into v_boleto from public.boletos where id = p_boleto_id for update;
  if not found then raise exception 'Parcela nao encontrada'; end if;

  select * into v_recebimento
  from public.financeiro_recebimentos
  where idempotency_key = p_idempotency_key;
  if found then return v_recebimento; end if;

  if v_boleto.status <> 'pendente_confirmacao' then raise exception 'Comprovante nao esta pendente de validacao'; end if;

  if p_acao = 'confirmar' then
    insert into public.financeiro_recebimentos (
      boleto_id, cliente_id, valor_original, valor_recebido, data_pagamento,
      forma_pagamento, origem, status_validacao, comprovante_url, observacao,
      idempotency_key, criado_por, validado_por, validado_em
    ) values (
      v_boleto.id, v_boleto.cliente_id, v_boleto.valor, v_boleto.valor, current_date,
      'comprovante', 'comprovante', 'validado', v_boleto.comprovante_url, nullif(btrim(p_observacao), ''),
      p_idempotency_key, p_usuario, p_usuario, now()
    ) returning * into v_recebimento;

    update public.boletos
    set status = 'pago', data_pagamento = current_date,
        observacoes = coalesce(nullif(btrim(p_observacao), ''), observacoes)
    where id = v_boleto.id;
  else
    insert into public.financeiro_recebimentos (
      boleto_id, cliente_id, valor_original, valor_recebido, origem, status_validacao,
      comprovante_url, observacao, motivo_rejeicao, idempotency_key, criado_por, validado_por, validado_em
    ) values (
      v_boleto.id, v_boleto.cliente_id, v_boleto.valor, 0, 'comprovante', 'rejeitado',
      v_boleto.comprovante_url, p_observacao, p_observacao, p_idempotency_key, p_usuario, p_usuario, now()
    ) returning * into v_recebimento;

    update public.boletos
    set status = 'rejeitado', data_pagamento = null, observacoes = p_observacao
    where id = v_boleto.id;
  end if;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, case when p_acao = 'confirmar' then 'confirmou_comprovante' else 'rejeitou_comprovante' end,
    'boletos', v_boleto.id,
    jsonb_build_object('recebimento_id', v_recebimento.id, 'cliente_id', v_boleto.cliente_id,
      'parcela', v_boleto.numero_parcela, 'observacao', nullif(btrim(p_observacao), '')));

  return v_recebimento;
end;
$$;

alter table public.financeiro_recebimentos enable row level security;
revoke all on table public.financeiro_recebimentos from public, anon, authenticated;
grant select, insert, update on table public.financeiro_recebimentos to service_role;

revoke all on function public.financeiro_baixar_boleto(uuid, date, numeric, numeric, numeric, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.financeiro_baixar_boleto(uuid, date, numeric, numeric, numeric, text, text, text, text, text) to service_role;
revoke all on function public.financeiro_validar_comprovante(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.financeiro_validar_comprovante(uuid, text, text, text, text) to service_role;

comment on table public.financeiro_recebimentos is
  'Ledger auditavel de recebimentos do Financeiro Unificado. Integracoes externas permanecem desativadas na fase 1.';
