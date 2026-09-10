-- MIGRATION 017: Reorganização segura de parcelas
-- Nunca usa 9001/10000 como numeração temporária.
-- A reorganização ocorre dentro de uma única transação PostgreSQL.

-- Dependências obrigatórias da gestão de parcelas.
-- Esta parte precisa vir ANTES das funções que referenciam as colunas.
alter table boletos add column if not exists suspensa boolean not null default false;
alter table boletos add column if not exists suspensa_em timestamptz;
alter table boletos add column if not exists suspensa_por text;

create index if not exists idx_boletos_cliente_numero on boletos(cliente_id, numero_parcela);
create index if not exists idx_boletos_suspensa on boletos(cliente_id, suspensa) where suspensa = true;

create or replace function reorganizar_parcelas_cliente(
  p_cliente_id uuid,
  p_excluir_id uuid default null,
  p_suspender_ids uuid[] default '{}',
  p_usuario text default 'admin'
)
returns integer
language plpgsql
as $$
declare
  v_total integer;
  v_max_pago integer;
  v_idx integer := 0;
  v_boleto record;
  v_suspensa boolean;
  v_nova_data date;
  v_data_base date;
begin
  if not exists (select 1 from clientes where id = p_cliente_id) then
    raise exception 'Cliente não encontrada';
  end if;

  perform 1 from clientes where id = p_cliente_id for update;

  if p_excluir_id is not null then
    if not exists (select 1 from boletos where id = p_excluir_id and cliente_id = p_cliente_id) then
      raise exception 'Parcela não encontrada';
    end if;
    if exists (select 1 from boletos where id = p_excluir_id and cliente_id = p_cliente_id and status = 'pago') then
      raise exception 'Parcelas pagas não podem ser excluídas';
    end if;
    delete from boletos where id = p_excluir_id and cliente_id = p_cliente_id;
  end if;

  if exists (
    select 1 from boletos
    where cliente_id = p_cliente_id
      and id = any(coalesce(p_suspender_ids, '{}'))
      and status = 'pago'
  ) then
    raise exception 'Parcelas pagas nunca podem ser suspensas';
  end if;

  select coalesce(max(numero_parcela), 0) into v_max_pago
  from boletos where cliente_id = p_cliente_id and status = 'pago';

  select count(*) into v_total from boletos where cliente_id = p_cliente_id;
  if v_total < 1 or v_total > 240 then
    raise exception 'O contrato deve possuir entre 1 e 240 parcelas';
  end if;

  v_idx := 0;
  for v_boleto in
    select id from boletos
    where cliente_id = p_cliente_id and status <> 'pago'
    order by numero_parcela, id
  loop
    v_idx := v_idx + 1;
    update boletos set numero_parcela = -v_idx, total_parcelas = v_total where id = v_boleto.id;
  end loop;

  v_data_base := coalesce(
    (select min(data_vencimento) from boletos where cliente_id = p_cliente_id and status <> 'pago'),
    current_date
  );

  v_idx := 0;
  for v_boleto in
    select b.id, b.data_vencimento
    from boletos b
    where b.cliente_id = p_cliente_id and b.status <> 'pago'
    order by
      case when b.id = any(coalesce(p_suspender_ids, '{}')) then 1 else 0 end,
      b.numero_parcela,
      b.id
  loop
    v_idx := v_idx + 1;
    v_suspensa := v_boleto.id = any(coalesce(p_suspender_ids, '{}'));
    v_nova_data := (v_data_base + ((v_idx - 1) * interval '1 month'))::date;

    update boletos
    set numero_parcela = v_max_pago + v_idx,
        total_parcelas = v_total,
        data_vencimento = v_nova_data,
        suspensa = v_suspensa,
        suspensa_em = case when v_suspensa then coalesce(suspensa_em, now()) else suspensa_em end,
        suspensa_por = case when v_suspensa then p_usuario else suspensa_por end
    where id = v_boleto.id;
  end loop;

  update boletos
  set total_parcelas = v_total
  where cliente_id = p_cliente_id and status <> 'pago';

  update clientes set quantidade_parcelas = v_total where id = p_cliente_id;

  return v_total;
end;
$$;

-- Corrige dados já contaminados pelo bug 9001/10000.
do $$
declare
  v_cliente uuid;
  v_max_pago integer;
  v_idx integer;
  v_total integer;
  v_boleto record;
begin
  for v_cliente in
    select distinct cliente_id
    from boletos
    where numero_parcela >= 9001 or total_parcelas = 10000
  loop
    select count(*) into v_total from boletos where cliente_id = v_cliente;
    if v_total between 1 and 240 then
      select coalesce(max(numero_parcela), 0) into v_max_pago
      from boletos where cliente_id = v_cliente and status = 'pago';

      v_idx := 0;
      for v_boleto in
        select id from boletos
        where cliente_id = v_cliente and status <> 'pago'
        order by numero_parcela, id
      loop
        v_idx := v_idx + 1;
        update boletos set numero_parcela = -v_idx, total_parcelas = v_total where id = v_boleto.id;
      end loop;

      v_idx := 0;
      for v_boleto in
        select id from boletos
        where cliente_id = v_cliente and status <> 'pago'
        order by numero_parcela, id
      loop
        v_idx := v_idx + 1;
        update boletos set numero_parcela = v_max_pago + v_idx, total_parcelas = v_total where id = v_boleto.id;
      end loop;

      update clientes set quantidade_parcelas = v_total where id = v_cliente;
    end if;
  end loop;
end $$;
