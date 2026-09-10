-- MIGRATION 011: percentual de pagamento baseado no total real de parcelas
-- Evita que exclusões/reorganizações de parcelas abertas alterem registros pagos.

create or replace function porcentagem_pagamento(p_cliente_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(
    round(
      (count(*) filter (where status = 'pago')::numeric / nullif(count(*), 0)) * 100,
      1
    ),
    0
  )::numeric
  from boletos
  where cliente_id = p_cliente_id;
$$;
