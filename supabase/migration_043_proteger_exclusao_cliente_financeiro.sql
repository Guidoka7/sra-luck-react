-- ============================================================================
-- migration_043_proteger_exclusao_cliente_financeiro.sql
--
-- A exclusão física de uma cliente com carnês/recebimentos já era bloqueada
-- pelas FKs RESTRICT. O problema era a experiência operacional: o Admin
-- recebia a mensagem crua do PostgreSQL (`carnes_cliente_id_fkey`).
--
-- Esta proteção roda antes das FKs e devolve uma orientação explícita. Não
-- transforma as relações financeiras em CASCADE e não apaga histórico.
-- Para clientes com histórico, o fluxo correto continua sendo cancelar/
-- arquivar o contrato. Clientes sem dependências protegidas continuam aptas
-- à exclusão física pelo fluxo existente.
-- ============================================================================

create or replace function public.proteger_exclusao_cliente_com_historico_financeiro()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.carnes
     where cliente_id = old.id
     limit 1
  ) or exists (
    select 1
      from public.financeiro_recebimentos
     where cliente_id = old.id
     limit 1
  ) then
    raise exception 'Esta cliente possui histórico financeiro e não pode ser excluída fisicamente. Altere o status do contrato para Cancelado para arquivar o cadastro sem apagar carnês ou recebimentos.'
      using errcode = '23503',
            constraint = 'clientes_historico_financeiro_protegido';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_proteger_exclusao_cliente_financeiro on public.clientes;

create trigger trg_proteger_exclusao_cliente_financeiro
before delete on public.clientes
for each row
execute function public.proteger_exclusao_cliente_com_historico_financeiro();
