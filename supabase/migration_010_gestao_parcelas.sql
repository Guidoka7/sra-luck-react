-- MIGRATION 010: Gestão avançada de parcelas
-- Permite contratos com qualquer quantidade de parcelas, histórico de alterações
-- e suspensão com realocação automática das parcelas abertas para o final.

alter table clientes drop constraint if exists clientes_quantidade_parcelas_check;
alter table clientes add constraint clientes_quantidade_parcelas_check check (quantidade_parcelas between 1 and 240);

alter table clientes add column if not exists percentual_minimo_agendar numeric(5,2);

update clientes
set percentual_minimo_agendar = case
  when quantidade_parcelas in (12,18,24) then 60
  when quantidade_parcelas = 36 then 70
  when quantidade_parcelas in (48,60,72) then 80
  else 80
end
where percentual_minimo_agendar is null;

alter table clientes alter column percentual_minimo_agendar set default 80;

alter table boletos add column if not exists suspensa boolean not null default false;
alter table boletos add column if not exists suspensa_em timestamptz;
alter table boletos add column if not exists suspensa_por text;

create index if not exists idx_boletos_cliente_numero on boletos(cliente_id, numero_parcela);

create or replace function pode_agendar(p_cliente_id uuid)
returns boolean
language sql
stable
as $$
  select case
    when c.id is null then false
    else porcentagem_pagamento(p_cliente_id) >= coalesce(
      c.percentual_minimo_agendar,
      case
        when c.quantidade_parcelas in (12,18,24) then 60
        when c.quantidade_parcelas = 36 then 70
        else 80
      end
    )
  end
  from clientes c
  where c.id = p_cliente_id;
$$;

create or replace function gerar_boletos_cliente(
  p_cliente_id uuid,
  p_quantidade_parcelas int,
  p_taxa_percentual numeric default null,
  p_primeiro_vencimento date default (current_date + interval '30 days')::date
)
returns setof boletos
language plpgsql
as $$
declare
  v_custo_total numeric(12,2);
  v_valor_parcela numeric(12,2);
  v_num int;
begin
  if p_quantidade_parcelas < 1 or p_quantidade_parcelas > 240 then
    raise exception 'A quantidade de parcelas deve estar entre 1 e 240';
  end if;

  if p_taxa_percentual is not null then
    update clientes set taxa_administrativa_percentual = p_taxa_percentual where id = p_cliente_id;
  end if;

  select custo_total into v_custo_total from clientes where id = p_cliente_id;
  if v_custo_total is null then raise exception 'Cliente não encontrada'; end if;
  v_valor_parcela := round(v_custo_total / p_quantidade_parcelas, 2);

  update clientes set quantidade_parcelas = p_quantidade_parcelas where id = p_cliente_id;

  for v_num in 1..p_quantidade_parcelas loop
    insert into boletos (cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status)
    values (p_cliente_id, v_num, p_quantidade_parcelas, v_valor_parcela,
      (p_primeiro_vencimento + ((v_num - 1) * interval '1 month'))::date, 'nao_pago')
    on conflict (cliente_id, numero_parcela) do nothing;
  end loop;

  update boletos set total_parcelas = p_quantidade_parcelas
  where cliente_id = p_cliente_id and status <> 'pago';

  return query select * from boletos where cliente_id = p_cliente_id order by numero_parcela;
end;
$$;
