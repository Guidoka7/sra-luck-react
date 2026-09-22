-- migration_073_fix_realocacao_parcelas_suspensas.sql
--
-- Corrige a numeração temporária da migration 072 sem violar
-- chk_numero_parcela (numero_parcela > 0 e <= total_parcelas).

create or replace function public.suspender_realocar_parcelas_cliente(
  p_cliente_id uuid,
  p_parcela_ids uuid[],
  p_usuario text default 'admin'
)
returns setof public.boletos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_encontradas integer;
  v_candidato integer := 1;
  v_boleto record;
  v_cursor date;
  v_dia integer;
  v_mes_base date;
  v_ultimo_dia integer;
  v_nova_data date;
begin
  if p_parcela_ids is null or coalesce(array_length(p_parcela_ids, 1), 0) = 0 then
    raise exception 'Selecione ao menos uma parcela em aberto';
  end if;

  perform 1 from public.clientes where id = p_cliente_id for update;
  if not found then raise exception 'Cliente não encontrada'; end if;

  select count(*) into v_encontradas
  from public.boletos
  where cliente_id = p_cliente_id and id = any(p_parcela_ids);

  if v_encontradas <> array_length(p_parcela_ids, 1) then
    raise exception 'Uma ou mais parcelas não pertencem a esta cliente';
  end if;

  if exists (
    select 1 from public.boletos
    where cliente_id = p_cliente_id
      and id = any(p_parcela_ids)
      and status in ('pago', 'pendente_confirmacao')
  ) then
    raise exception 'Parcelas pagas ou em conferência não podem ser suspensas';
  end if;

  update public.boletos
  set suspensa = true,
      suspensa_em = coalesce(suspensa_em, now()),
      suspensa_por = coalesce(suspensa_por, p_usuario)
  where cliente_id = p_cliente_id
    and id = any(p_parcela_ids)
    and status not in ('pago', 'pendente_confirmacao');

  select count(*) into v_total
  from public.boletos
  where cliente_id = p_cliente_id;

  if v_total < 1 or v_total > 240 then
    raise exception 'O contrato deve possuir entre 1 e 240 parcelas';
  end if;

  -- Mantém datas das parcelas ativas. Somente as suspensas são empurradas
  -- para depois do último vencimento ativo.
  select max(data_vencimento) into v_cursor
  from public.boletos
  where cliente_id = p_cliente_id
    and (status = 'pago' or coalesce(suspensa, false) = false);

  if v_cursor is null then
    select max(data_vencimento) into v_cursor
    from public.boletos
    where cliente_id = p_cliente_id;
  end if;
  v_cursor := coalesce(v_cursor, current_date);

  select extract(day from coalesce(
           min(data_vencimento) filter (where data_vencimento is not null),
           current_date
         ))::integer
  into v_dia
  from public.boletos
  where cliente_id = p_cliente_id;

  -- Faixa temporária positiva para evitar colisão do índice único e respeitar
  -- chk_numero_parcela. A transação nunca deixa essa faixa visível parcialmente.
  update public.boletos
  set total_parcelas = v_total * 2
  where cliente_id = p_cliente_id;

  update public.boletos
  set numero_parcela = numero_parcela + v_total
  where cliente_id = p_cliente_id
    and status <> 'pago';

  for v_boleto in
    select id, suspensa, numero_parcela
    from public.boletos
    where cliente_id = p_cliente_id
      and status <> 'pago'
    order by
      case when coalesce(suspensa, false) then 1 else 0 end,
      numero_parcela,
      id
  loop
    while exists (
      select 1 from public.boletos
      where cliente_id = p_cliente_id
        and status = 'pago'
        and numero_parcela = v_candidato
    ) loop
      v_candidato := v_candidato + 1;
    end loop;

    if coalesce(v_boleto.suspensa, false) then
      v_mes_base := (date_trunc('month', v_cursor)::date + interval '1 month')::date;
      v_ultimo_dia := extract(day from ((date_trunc('month', v_mes_base) + interval '1 month - 1 day')::date))::integer;
      v_nova_data := make_date(
        extract(year from v_mes_base)::integer,
        extract(month from v_mes_base)::integer,
        least(v_dia, v_ultimo_dia)
      );
      v_cursor := v_nova_data;

      update public.boletos
      set numero_parcela = v_candidato,
          data_vencimento = v_nova_data
      where id = v_boleto.id;
    else
      update public.boletos
      set numero_parcela = v_candidato
      where id = v_boleto.id;
    end if;

    v_candidato := v_candidato + 1;
  end loop;

  update public.boletos
  set total_parcelas = v_total
  where cliente_id = p_cliente_id;

  update public.clientes
  set quantidade_parcelas = v_total
  where id = p_cliente_id;

  return query
    select b.*
    from public.boletos b
    where b.cliente_id = p_cliente_id
    order by b.numero_parcela;
end;
$$;

revoke all on function public.suspender_realocar_parcelas_cliente(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.suspender_realocar_parcelas_cliente(uuid, uuid[], text) to service_role;
