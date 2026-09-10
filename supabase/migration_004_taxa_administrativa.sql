-- ============================================================================
-- MIGRATION 004: Taxa administrativa (lucro real) separada do valor liberado
-- Execute no SQL Editor do Supabase após testar em dev
--
-- Contexto: a "Sra. Luck" é uma facilitadora de crédito. O valor_contrato
-- (ex: R$10.000,00) é o valor LIBERADO à cliente, não é receita da empresa.
-- A receita real é a taxa administrativa, que varia conforme o nº de
-- parcelas escolhido (ex: 25% em 12x até 83% em 72x). Até aqui o sistema
-- não modelava essa taxa em lugar nenhum — os boletos eram gerados
-- dividindo o valor_contrato puro pelo nº de parcelas, sem taxa nenhuma.
-- ============================================================================

-- 1. Permitir 72x como opção de parcelamento (faltava)
alter table clientes drop constraint if exists clientes_quantidade_parcelas_check;
alter table clientes add constraint clientes_quantidade_parcelas_check
  check (quantidade_parcelas in (12, 18, 24, 36, 48, 60, 72));

-- 2. Taxa administrativa (%) aplicada ao contrato — definida no momento da
--    geração dos boletos, editável pelo admin (a tabela padrão é só um
--    valor sugerido no front-end; o que vale é o que fica salvo aqui).
alter table clientes add column if not exists taxa_administrativa_percentual numeric(5,2) not null default 0;

-- 3. Custo total do contrato (valor liberado + taxa administrativa).
--    É o valor que efetivamente é parcelado em boletos. Coluna gerada:
--    nunca fica dessincronizada do valor_contrato / taxa.
alter table clientes drop column if exists custo_total;
alter table clientes add column custo_total numeric(12,2)
  generated always as (round(valor_contrato * (1 + taxa_administrativa_percentual / 100), 2)) stored;

-- ============================================================================
-- FUNÇÃO: gerar_boletos_cliente — agora recebe a taxa administrativa e
-- parcela o CUSTO TOTAL (valor liberado + taxa), não o valor liberado puro.
-- ============================================================================
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
  if p_taxa_percentual is not null then
    update clientes set taxa_administrativa_percentual = p_taxa_percentual where id = p_cliente_id;
  end if;

  select custo_total into v_custo_total from clientes where id = p_cliente_id;
  if v_custo_total is null then
    raise exception 'Cliente não encontrada';
  end if;

  v_valor_parcela := round(v_custo_total / p_quantidade_parcelas, 2);

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
-- FUNÇÃO: pode_agendar — passa a reconhecer o plano de 72x (mesma faixa
-- exigida do 48x/60x: 80% pago). Ajuste se sua regra de negócio for outra.
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
    when c.quantidade_parcelas in (48, 60, 72) then
      porcentagem_pagamento(p_cliente_id) >= 80
    else false
  end
  from clientes c
  where c.id = p_cliente_id;
$$;
