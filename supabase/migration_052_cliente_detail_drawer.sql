-- migration_052_cliente_detail_drawer.sql
-- Modelo financeiro independente e status adicionais usados pelo novo drawer de Clientes.
-- Mantém as colunas legadas (taxa/custo_total) intactas para não alterar outras telas.

do $$ begin
  alter type public.status_contrato_cliente add value if not exists 'inadimplente' after 'ativo';
exception when duplicate_object then null; end $$;

alter table public.clientes
  add column if not exists valor_total_plano numeric(12,2),
  add column if not exists valor_parcela_plano numeric(12,2),
  add column if not exists inicio_plano date,
  add column if not exists forma_pagamento_plano text,
  add column if not exists instituicao_pagamento text,
  add column if not exists dia_cobranca smallint,
  add column if not exists status_plano text,
  add column if not exists origem_venda text,
  add column if not exists banco text;

do $$ begin
  alter table public.clientes
    add constraint clientes_dia_cobranca_check
    check (dia_cobranca is null or dia_cobranca between 1 and 31);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.clientes
    add constraint clientes_status_plano_check
    check (status_plano is null or status_plano in ('Ativa', 'Suspensa'));
exception when duplicate_object then null; end $$;

-- Backfill somente para dar um estado inicial coerente. Depois disso os campos
-- passam a ser independentes: carta, total, quantidade e valor da parcela não
-- se recalculam mutuamente.
update public.clientes
set valor_total_plano = custo_total
where valor_total_plano is null;

update public.clientes c
set valor_parcela_plano = (
  select b.valor
  from public.boletos b
  where b.cliente_id = c.id
  order by case when b.status = 'pago' then 1 else 0 end, b.numero_parcela
  limit 1
)
where c.valor_parcela_plano is null;

update public.clientes c
set inicio_plano = (
  select b.data_vencimento
  from public.boletos b
  where b.cliente_id = c.id and b.data_vencimento is not null
  order by b.numero_parcela
  limit 1
)
where c.inicio_plano is null;

update public.clientes
set status_plano = 'Ativa'
where status_plano is null;

-- RPC exclusiva do novo drawer. Não recebe taxa administrativa e nunca deriva
-- total/parcela da carta de crédito.
create or replace function public.salvar_plano_financeiro_drawer(
  p_cliente_id uuid,
  p_quantidade integer,
  p_valor_parcela numeric,
  p_primeiro_vencimento date,
  p_valor_total_plano numeric,
  p_forma_pagamento text default null,
  p_instituicao text default null,
  p_dia_cobranca integer default null,
  p_status_plano text default 'Ativa',
  p_recalcular_abertas boolean default true
)
returns setof public.boletos
language plpgsql
set search_path = public
as $$
declare
  v_tem_existentes boolean := false;
  v_anchor_data date;
  v_anchor_numero integer;
  v_max_protegida integer := 0;
  v_valor numeric(12,2);
  v_numero integer;
  v_parcela public.boletos%rowtype;
  v_vencimento date;
begin
  if p_quantidade is null or p_quantidade < 1 or p_quantidade > 240 then
    raise exception 'A quantidade de parcelas deve estar entre 1 e 240';
  end if;
  if p_valor_parcela is null or p_valor_parcela <= 0 then
    raise exception 'Informe um valor de parcela válido';
  end if;
  if p_valor_total_plano is null or p_valor_total_plano < 0 then
    raise exception 'Informe um valor total do plano válido';
  end if;
  if p_dia_cobranca is not null and (p_dia_cobranca < 1 or p_dia_cobranca > 31) then
    raise exception 'Dia de cobrança inválido';
  end if;
  if coalesce(p_status_plano, 'Ativa') not in ('Ativa', 'Suspensa') then
    raise exception 'Status do plano inválido';
  end if;

  perform 1 from public.clientes where id = p_cliente_id for update;
  if not found then raise exception 'Cliente não encontrada'; end if;

  select exists(select 1 from public.boletos where cliente_id = p_cliente_id)
    into v_tem_existentes;

  select coalesce(max(numero_parcela), 0)
    into v_max_protegida
  from public.boletos
  where cliente_id = p_cliente_id
    and status in ('pago', 'pendente_confirmacao');

  if p_quantidade < v_max_protegida then
    raise exception 'Não é possível reduzir para % parcelas: existe parcela paga ou em conferência até a parcela %',
      p_quantidade, v_max_protegida;
  end if;

  v_valor := round(p_valor_parcela, 2);

  if p_primeiro_vencimento is not null then
    v_anchor_data := p_primeiro_vencimento;
    v_anchor_numero := 1;
  else
    select data_vencimento, numero_parcela
      into v_anchor_data, v_anchor_numero
    from public.boletos
    where cliente_id = p_cliente_id and data_vencimento is not null
    order by numero_parcela
    limit 1;
  end if;

  if not v_tem_existentes and v_anchor_data is null then
    raise exception 'Informe o primeiro vencimento para gerar o financeiro';
  end if;

  delete from public.boletos
  where cliente_id = p_cliente_id
    and numero_parcela > p_quantidade
    and status not in ('pago', 'pendente_confirmacao');

  for v_numero in 1..p_quantidade loop
    if v_anchor_data is not null then
      v_vencimento := (v_anchor_data + make_interval(months => v_numero - v_anchor_numero))::date;
    else
      v_vencimento := null;
    end if;

    select * into v_parcela
    from public.boletos
    where cliente_id = p_cliente_id and numero_parcela = v_numero;

    if found then
      if v_parcela.status in ('pago', 'pendente_confirmacao') then
        update public.boletos
        set total_parcelas = p_quantidade
        where id = v_parcela.id;
      else
        update public.boletos
        set total_parcelas = p_quantidade,
            valor = v_valor,
            data_vencimento = case
              when p_recalcular_abertas and v_vencimento is not null then v_vencimento
              else data_vencimento
            end
        where id = v_parcela.id;
      end if;
    else
      if v_vencimento is null then
        raise exception 'Informe o primeiro vencimento para completar o cronograma financeiro';
      end if;
      insert into public.boletos (
        cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status
      ) values (
        p_cliente_id, v_numero, p_quantidade, v_valor, v_vencimento, 'nao_pago'
      );
    end if;
  end loop;

  update public.clientes
  set quantidade_parcelas = p_quantidade,
      valor_total_plano = round(p_valor_total_plano, 2),
      valor_parcela_plano = v_valor,
      inicio_plano = coalesce(p_primeiro_vencimento, inicio_plano),
      forma_pagamento_plano = nullif(btrim(coalesce(p_forma_pagamento, '')), ''),
      instituicao_pagamento = nullif(btrim(coalesce(p_instituicao, '')), ''),
      dia_cobranca = p_dia_cobranca,
      status_plano = coalesce(p_status_plano, 'Ativa')
  where id = p_cliente_id;

  return query
    select b.*
    from public.boletos b
    where b.cliente_id = p_cliente_id
    order by b.numero_parcela;
end;
$$;

revoke all on function public.salvar_plano_financeiro_drawer(uuid, integer, numeric, date, numeric, text, text, integer, text, boolean)
from public, anon, authenticated;
grant execute on function public.salvar_plano_financeiro_drawer(uuid, integer, numeric, date, numeric, text, text, integer, text, boolean)
to service_role;
