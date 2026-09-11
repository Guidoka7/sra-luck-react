-- MIGRATION 034: remove acesso direto a dados financeiros sensiveis.
-- Todo acesso de negocio a clientes, boletos e RPCs relacionadas deve ocorrer pelo Worker,
-- que valida a sessao da aplicacao antes de usar a service_role no servidor.

begin;

-- RLS permanece habilitado como defesa em profundidade. Nenhuma policy substituta
-- e criada para PUBLIC, anon ou authenticated porque o runtime atual usa o Worker.
alter table public.clientes enable row level security;
alter table public.boletos enable row level security;

drop policy if exists admin_full_access_clientes on public.clientes;
drop policy if exists admin_full_access_boletos on public.boletos;

revoke all privileges on table public.clientes from public, anon, authenticated;
revoke all privileges on table public.boletos from public, anon, authenticated;

grant select, insert, update, delete on table public.clientes to service_role;
grant select, insert, update, delete on table public.boletos to service_role;

-- As verificacoes de existencia tornam o hardening repetivel e tolerante a
-- ambientes historicos onde alguma assinatura ainda nao tenha sido criada.
-- Quando presentes, as RPCs ficam executaveis exclusivamente pelo backend.
do $hardening_rpc$
declare
  v_assinatura text;
  v_funcao regprocedure;
begin
  foreach v_assinatura in array array[
    'public.gerar_boletos_cliente(uuid,integer,numeric,date)',
    'public.gerar_comissao_vendedora_primeira_parcela(uuid,uuid)',
    'public.pode_agendar(uuid)',
    'public.porcentagem_pagamento(uuid)'
  ]
  loop
    v_funcao := to_regprocedure(v_assinatura);

    if v_funcao is null then
      raise notice 'Funcao % nao encontrada; nenhuma permissao para revogar.', v_assinatura;
      continue;
    end if;

    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      v_assinatura
    );
    execute format(
      'grant execute on function %s to service_role',
      v_assinatura
    );
  end loop;
end;
$hardening_rpc$;

commit;
