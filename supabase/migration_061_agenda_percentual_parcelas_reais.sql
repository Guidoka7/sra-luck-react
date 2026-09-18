-- migration_061_agenda_percentual_parcelas_reais.sql
-- Agenda definitiva: o percentual usa exclusivamente as parcelas reais persistidas.
-- Denominador = quantidade real de boletos da cliente.
-- Numerador = quantidade desses boletos com status pago.
-- Não usa carta de crédito, valor do contrato, quantidade_parcelas cadastral
-- nem o campo total_parcelas de uma parcela como fonte de verdade.

create or replace function public.porcentagem_pagamento(p_cliente_id uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(
    round(
      (
        count(*) filter (where status = 'pago')::numeric
        / nullif(count(*)::numeric, 0)
      ) * 100,
      1
    ),
    0
  )::numeric
  from public.boletos
  where cliente_id = p_cliente_id;
$$;

create or replace function public.pode_agendar(p_cliente_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    exists(select 1 from public.clientes c where c.id = p_cliente_id)
    and exists(select 1 from public.boletos b where b.cliente_id = p_cliente_id)
    and public.porcentagem_pagamento(p_cliente_id) >= public.percentual_minimo_fluxo_agenda();
$$;

revoke all on function public.porcentagem_pagamento(uuid) from public, anon, authenticated;
revoke all on function public.pode_agendar(uuid) from public, anon, authenticated;
grant execute on function public.porcentagem_pagamento(uuid) to service_role;
grant execute on function public.pode_agendar(uuid) to service_role;

-- Reconcilia somente clientes elegíveis ainda sem revisão iniciada.
-- Não desfaz decisões ou etapas já persistidas de clientes existentes.
update public.clientes c
set status_revisao_financeira = 'pendente',
    data_atingiu_percentual = coalesce(c.data_atingiu_percentual, now()),
    updated_at = now()
where c.status_revisao_financeira is null
  and public.pode_agendar(c.id);

comment on function public.porcentagem_pagamento(uuid) is
  'Percentual da Agenda = parcelas reais pagas / parcelas reais persistidas. Não usa total_parcelas, quantidade_parcelas ou valores.';
