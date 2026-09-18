-- migration_059_pode_agendar_percentual_cliente.sql
-- Mantém a elegibilidade do app e do administrativo na mesma regra:
-- parcelas pagas / total real de parcelas versus percentual mínimo da cliente.
-- Quando o percentual específico ainda não existir, preserva o fallback histórico.

create or replace function public.pode_agendar(p_cliente_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when c.id is null or c.quantidade_parcelas is null then false
    else public.porcentagem_pagamento(p_cliente_id) >= coalesce(
      c.percentual_minimo_agendar,
      case
        when c.quantidade_parcelas in (12, 18, 24) then 60
        when c.quantidade_parcelas = 36 then 70
        else 80
      end
    )
  end
  from public.clientes c
  where c.id = p_cliente_id;
$$;

revoke all on function public.pode_agendar(uuid) from public, anon, authenticated;
grant execute on function public.pode_agendar(uuid) to service_role;

comment on function public.pode_agendar(uuid) is
  'Elegibilidade por quantidade de parcelas pagas usando clientes.percentual_minimo_agendar quando definido; compartilhada pelo app e administrativo.';
