-- migration_120 — rotinas diárias pelo pg_cron (notificações financeiras e mensagem do dia).
--
-- Os crons da Vercel (vercel.json) pararam: a última mensagem do dia é de 23/09/2026 e nenhum
-- lote/lembrete automático de parcela saiu desde 24/09. O pg_cron do banco já chama as
-- integrações com o segredo do cofre (migrations 091/117); estas duas rotinas passam a ser
-- disparadas do mesmo jeito, nos mesmos horários (08:05 e 00:05 de Brasília).
-- O App confirma o token pelo cofre (integracoes_cron_autorizado); o segredo não sai do banco.
--
-- Não destrutiva. Rollback: supabase/rollback/migration_120_rollback.sql.

create or replace function public.rotinas_disparar(p_rotina text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_segredo text;
  v_caminho text;
begin
  v_caminho := case p_rotina
    when 'notificacoes-financeiras' then '/api/cron/notificacoes-financeiras'
    when 'mensagem-do-dia' then '/api/cron/mensagem-do-dia'
    else null end;
  if v_caminho is null then
    raise exception 'Rotina desconhecida: %', p_rotina;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sra_luck_app_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'sra_luck_cron_secret';
  if v_url is null or v_segredo is null or v_url !~ '^https://' then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || v_caminho,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_segredo),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.rotinas_disparar(text) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('notificacoes-financeiras-diaria', 'mensagem-do-dia-diaria');
select cron.schedule('notificacoes-financeiras-diaria', '5 11 * * *', $$select public.rotinas_disparar('notificacoes-financeiras');$$);
select cron.schedule('mensagem-do-dia-diaria', '5 3 * * *', $$select public.rotinas_disparar('mensagem-do-dia');$$);
