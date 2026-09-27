-- ============================================================================
-- migration_096_agenda_liberacao_automatica_realizado.sql
--
-- Problema (verificado em produção em 27/09/2026, somente leitura):
--   agenda_registrar_comparecimento(p_compareceu := true) grava
--   status = 'realizado' no agendamento. A rotina automática da migration_065
--   (agenda_processar_liberacoes_v46, cron a cada minuto) só procurava
--   agendamentos com status = 'confirmado'. Resultado: nenhum agendamento com
--   comparecimento + quitação é encontrado pelo cron e a Agenda Cirúrgica
--   nunca é liberada automaticamente após o prazo em dias úteis — só por
--   liberação manual ou quando o registro acontece depois do prazo.
--   Contagem na data: 0 liberações feitas pelo cron ("sistema:cron-v46").
--
-- Correção: o cron passa a considerar status 'confirmado' OU 'realizado'
--   (os mesmos aceitos por agenda_tentar_liberar_cirurgia e
--   agenda_cirurgica_liberar_manual). A decisão continua sendo única:
--   agenda_tentar_liberar_cirurgia (prazo configurável da migration_094).
--   Nenhuma outra regra muda. Idempotente.
--
-- Rollback: reaplicar a função e o índice da migration_065 (status =
--   'confirmado'). Não há alteração de dados nesta migration.
-- ============================================================================

drop index if exists public.idx_agendamentos_liberacao_pendente_v46;

create index if not exists idx_agendamentos_liberacao_pendente_v46
  on public.agendamentos (id)
  where status in ('confirmado', 'realizado')
    and comparecimento_status = 'compareceu'
    and quitacao_status = 'paga'
    and agenda_cirurgica_liberada_em is null;

create or replace function public.agenda_processar_liberacoes_v46()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_agendamento record;
  v_liberadas integer := 0;
begin
  for v_agendamento in
    select a.id
    from public.agendamentos a
    where a.status in ('confirmado', 'realizado')
      and a.comparecimento_status = 'compareceu'
      and a.quitacao_status = 'paga'
      and a.agenda_cirurgica_liberada_em is null
      and a.data_cirurgia is null
    order by a.id
  loop
    if public.agenda_tentar_liberar_cirurgia(
      v_agendamento.id,
      'sistema:cron-v46'
    ) then
      v_liberadas := v_liberadas + 1;
    end if;
  end loop;

  return v_liberadas;
end;
$$;

revoke all on function public.agenda_processar_liberacoes_v46()
  from public, anon, authenticated;

grant execute on function public.agenda_processar_liberacoes_v46()
  to service_role;

comment on function public.agenda_processar_liberacoes_v46() is
  'V46: libera automaticamente a Agenda Cirúrgica quando o prazo em dias úteis vence. Considera agendamentos confirmados e realizados (o comparecimento grava realizado) — migration_096.';
