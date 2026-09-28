-- ============================================================================
-- Rollback da migration_111 — restaura SOMENTE o que a 111 altera:
--   1. índice idx_agendamentos_liberacao_pendente_v46
--   2. função agenda_processar_liberacoes_v46()
-- Definições copiadas de produção (pg_get_functiondef / pg_indexes) em
-- 28/09/2026, antes da 111. Não mexe em dados nem em outras funções da 065.
-- ============================================================================

drop index if exists public.idx_agendamentos_liberacao_pendente_v46;

create index if not exists idx_agendamentos_liberacao_pendente_v46
  on public.agendamentos using btree (id)
  where ((status = 'confirmado'::status_agendamento)
    and (comparecimento_status = 'compareceu'::text)
    and (quitacao_status = 'paga'::text)
    and (agenda_cirurgica_liberada_em is null));

CREATE OR REPLACE FUNCTION public.agenda_processar_liberacoes_v46()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_agendamento record;
  v_liberadas integer := 0;
begin
  for v_agendamento in
    select a.id
    from public.agendamentos a
    where a.status = 'confirmado'
      and a.comparecimento_status = 'compareceu'
      and a.quitacao_status = 'paga'
      and a.agenda_cirurgica_liberada_em is null
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
$function$;

-- A 111 acrescenta um comentário; antes dela a função não tinha comentário.
comment on function public.agenda_processar_liberacoes_v46() is null;

-- Privilégios idênticos antes e depois da 111 (postgres, service_role).
revoke all on function public.agenda_processar_liberacoes_v46() from public, anon, authenticated;
grant execute on function public.agenda_processar_liberacoes_v46() to service_role;
