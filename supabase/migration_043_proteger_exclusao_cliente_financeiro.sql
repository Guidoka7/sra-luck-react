-- ============================================================================
-- migration_043_proteger_exclusao_cliente_financeiro.sql
--
-- Protege histórico financeiro/operacional de clientes contra exclusão física.
--
-- Algumas FKs (carnês/recebimentos) já usam RESTRICT, enquanto outras
-- (boletos/agendamentos) usam CASCADE. Sem esta proteção, o Admin podia receber
-- uma mensagem crua de FK ou, pior, apagar histórico em cascata.
--
-- Regra:
-- - cliente sem histórico relevante pode ser excluída fisicamente;
-- - cliente com qualquer histórico relevante deve ser cancelada/arquivada;
-- - nenhuma relação financeira passa a usar CASCADE por causa desta migration.
-- ============================================================================

create or replace function public.proteger_exclusao_cliente_com_historico_financeiro()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (select 1 from public.carnes where cliente_id = old.id limit 1)
     or exists (select 1 from public.financeiro_recebimentos where cliente_id = old.id limit 1)
     or exists (select 1 from public.boletos where cliente_id = old.id limit 1)
     or exists (select 1 from public.agendamentos where cliente_id = old.id limit 1)
     or exists (select 1 from public.pagamentos_externos where cliente_id = old.id limit 1)
     or exists (select 1 from public.conciliacao_pagamentos where cliente_id = old.id limit 1)
     or exists (select 1 from public.comissoes where cliente_id = old.id limit 1)
     or exists (select 1 from public.solicitacoes_liberacao_financeira where cliente_id = old.id limit 1)
     or exists (select 1 from public.importacoes_boletos where cliente_id = old.id limit 1)
  then
    raise exception 'Esta cliente possui histórico financeiro ou operacional e não pode ser excluída fisicamente. Altere o status do contrato para Cancelado para arquivar o cadastro sem apagar parcelas, carnês, recebimentos ou agenda.'
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
