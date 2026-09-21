-- ============================================================================
-- migration_066_auth_hardening_rate_limit_cleanup.sql
--
-- Hardening aditivo:
-- - remove EXECUTE público residual de uma trigger function;
-- - limpa chaves de rate limit antigas sem expor identificadores;
-- - mantém bloqueios ainda vigentes.
-- ============================================================================

revoke execute on function public.proteger_exclusao_cliente_com_historico_financeiro()
  from public, anon, authenticated;
grant execute on function public.proteger_exclusao_cliente_com_historico_financeiro()
  to service_role;

create or replace function public.login_limpar_rate_limits_expirados()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_removidos integer;
begin
  delete from public.login_rate_limits
   where updated_at < now() - interval '2 days'
     and (bloqueado_ate is null or bloqueado_ate < now());

  get diagnostics v_removidos = row_count;
  return v_removidos;
end;
$$;

revoke all on function public.login_limpar_rate_limits_expirados()
  from public, anon, authenticated;
grant execute on function public.login_limpar_rate_limits_expirados()
  to service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname = 'auth-rate-limit-cleanup'
  order by jobid desc
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'auth-rate-limit-cleanup',
    '17 3 * * *',
    'select public.login_limpar_rate_limits_expirados();'
  );
end;
$$;
