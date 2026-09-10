-- ============================================================================
-- MIGRATION 008: Corrige o vencimento das parcelas pra manter o mesmo
-- dia do mês em todas elas.
--
-- Bug: a função gerar_boletos_cliente somava "30 dias" fixos por parcela
-- (p_primeiro_vencimento + (v_num - 1) * interval '30 days'). Como nem todo
-- mês tem 30 dias, isso ia "escorregando" o dia — ex.: 1ª parcela dia 15,
-- 2ª cai dia 14, 3ª dia 16, etc.
--
-- Fix: somar "1 month" por parcela em vez de "30 days". O Postgres mantém
-- o dia do mês automaticamente (só ajusta em casos de mês mais curto — ex.:
-- vencimento dia 31 numa parcela que cairia em fevereiro vira dia 28/29,
-- comportamento padrão e esperado de "mesmo dia todo mês").
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
      (p_primeiro_vencimento + ((v_num - 1) * interval '1 month'))::date,
      'nao_pago'
    )
    on conflict (cliente_id, numero_parcela) do nothing;
  end loop;

  return query select * from boletos where cliente_id = p_cliente_id order by numero_parcela;
end;
$$;

-- ============================================================================
-- OPCIONAL — reparo das parcelas já geradas com o bug antigo (dias variando).
--
-- Isso recalcula a data_vencimento de TODAS as parcelas AINDA NÃO PAGAS de
-- um cliente específico, realinhando pro mesmo dia da 1ª parcela dela.
-- Parcelas já pagas não são tocadas (histórico não deve mudar).
--
-- Rode manualmente, um cliente por vez, trocando o UUID abaixo. NÃO faz
-- parte da migration em si — descomente e execute só quando precisar.
-- ============================================================================

-- do $$
-- declare
--   v_cliente_id uuid := 'COLE-AQUI-O-ID-DA-CLIENTE';
--   v_primeiro_vencimento date;
-- begin
--   select data_vencimento into v_primeiro_vencimento
--   from boletos
--   where cliente_id = v_cliente_id and numero_parcela = 1;
--
--   update boletos b
--   set data_vencimento = (v_primeiro_vencimento + ((b.numero_parcela - 1) * interval '1 month'))::date
--   where b.cliente_id = v_cliente_id
--     and b.status = 'nao_pago';
-- end $$;
