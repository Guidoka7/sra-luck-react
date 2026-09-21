-- ============================================================================
-- migration_065_agenda_v46_liberacao_automatica_segura.sql
--
-- Segurança/consistência:
-- - remove a necessidade de GETs com efeito colateral para liberar a agenda;
-- - processa automaticamente, no banco, liberações cujo prazo V46 venceu;
-- - mantém a RPC agenda_tentar_liberar_cirurgia como única regra de decisão;
-- - cron roda como postgres e a função auxiliar não é exposta a anon/auth.
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create index if not exists idx_agendamentos_liberacao_pendente_v46
  on public.agendamentos (id)
  where status = 'confirmado'
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
$$;

revoke all on function public.agenda_processar_liberacoes_v46()
  from public, anon, authenticated;

grant execute on function public.agenda_processar_liberacoes_v46()
  to service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid
    into v_jobid
  from cron.job
  where jobname = 'agenda-v46-liberacoes'
  order by jobid desc
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'agenda-v46-liberacoes',
    '* * * * *',
    'select public.agenda_processar_liberacoes_v46();'
  );
end;
$$;
