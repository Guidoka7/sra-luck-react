-- migration_047_plano_financeiro_consistente.sql
-- Corrige a criação/ajuste do plano financeiro pelo drawer de clientes.
-- Preserva parcelas pagas/em conferência, aceita valor de parcela manual,
-- mantém a carta de crédito independente e gera vencimentos mensais coerentes.

create or replace function public.salvar_plano_financeiro_cliente(
  p_cliente_id uuid,
  p_quantidade integer,
  p_valor_parcela numeric default null,
  p_primeiro_vencimento date default null,
  p_taxa_percentual numeric default null,
  p_recalcular_abertas boolean default true
)
returns setof public.boletos
language plpgsql
set search_path = public
as $$
declare
  v_cliente record;
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

  if p_taxa_percentual is not null and (p_taxa_percentual < 0 or p_taxa_percentual > 999.99) then
    raise exception 'Taxa administrativa inválida';
  end if;

  select id, valor_contrato, custo_total, taxa_administrativa_percentual, quantidade_parcelas
    into v_cliente
  from public.clientes
  where id = p_cliente_id
  for update;

  if not found then
    raise exception 'Cliente não encontrada';
  end if;

  if p_taxa_percentual is not null then
    update public.clientes
       set taxa_administrativa_percentual = p_taxa_percentual
     where id = p_cliente_id;

    select id, valor_contrato, custo_total, taxa_administrativa_percentual, quantidade_parcelas
      into v_cliente
    from public.clientes
    where id = p_cliente_id;
  end if;

  select exists(select 1 from public.boletos where cliente_id = p_cliente_id)
    into v_tem_existentes;

  select coalesce(max(numero_parcela), 0)
    into v_max_protegida
  from public.boletos
  where cliente_id = p_cliente_id
    and status in ('pago', 'pendente_confirmacao');

  if p_quantidade < v_max_protegida then
    raise exception 'Não é possível reduzir para % parcelas: existe parcela paga ou em conferência até a parcela %', p_quantidade, v_max_protegida;
  end if;

  if p_valor_parcela is not null then
    if p_valor_parcela <= 0 then
      raise exception 'Valor da parcela inválido';
    end if;
    v_valor := round(p_valor_parcela, 2);
  else
    select valor
      into v_valor
    from public.boletos
    where cliente_id = p_cliente_id
      and status <> 'pago'
      and valor > 0
    order by numero_parcela
    limit 1;

    if v_valor is null then
      v_valor := round(coalesce(v_cliente.custo_total, 0) / p_quantidade, 2);
    end if;
  end if;

  if v_valor is null or v_valor <= 0 then
    raise exception 'Informe um valor de parcela válido';
  end if;

  if p_primeiro_vencimento is not null then
    v_anchor_data := p_primeiro_vencimento;
    v_anchor_numero := 1;
  else
    select data_vencimento, numero_parcela
      into v_anchor_data, v_anchor_numero
    from public.boletos
    where cliente_id = p_cliente_id
      and data_vencimento is not null
    order by numero_parcela
    limit 1;
  end if;

  if not v_tem_existentes and v_anchor_data is null then
    raise exception 'Informe o primeiro vencimento para gerar o financeiro';
  end if;

  if p_recalcular_abertas
     and v_anchor_data is null
     and exists(
       select 1 from public.boletos
       where cliente_id = p_cliente_id
         and status not in ('pago', 'pendente_confirmacao')
         and data_vencimento is null
     ) then
    raise exception 'Informe o primeiro vencimento para corrigir o cronograma das parcelas em aberto';
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

    select *
      into v_parcela
    from public.boletos
    where cliente_id = p_cliente_id
      and numero_parcela = v_numero;

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
     set quantidade_parcelas = p_quantidade
   where id = p_cliente_id;

  return query
    select b.*
    from public.boletos b
    where b.cliente_id = p_cliente_id
    order by b.numero_parcela;
end;
$$;
