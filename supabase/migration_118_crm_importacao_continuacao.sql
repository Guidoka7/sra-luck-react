-- migration_118 — continuação da importação do CRM em etapas (a cada 5 min).
--
-- Com "todos os funis" o RD tem milhares de negociações e cada contato é uma consulta
-- (limite de 120/min). A leitura inteira não cabe numa execução da hospedagem: em 29/09/2026
-- todas as execuções foram encerradas no meio (EXECUCAO_INTERROMPIDA) sem registrar nada.
-- O App agora importa em etapas e guarda a posição (integracao_catalogos, crm_importacao_progresso).
-- Este job chama /api/cron/integracoes/crm a cada 5 min: só continua uma passada que ainda não
-- terminou; sem passada em andamento, o App responde sem ler nada no RD. O job de 15 min
-- (integracoes_disparar_sync) continua igual.
--
-- Mesmo cofre e mesma autorização do job de 15 min (migration_091/117).
-- Não destrutiva. Rollback: supabase/rollback/migration_118_rollback.sql.

create or replace function public.integracoes_disparar_continuacao_crm()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_segredo text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sra_luck_app_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'sra_luck_cron_secret';
  if v_url is null or v_segredo is null or v_url !~ '^https://' then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/integracoes/crm',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_segredo),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.integracoes_disparar_continuacao_crm() from public, anon, authenticated;

-- Minutos 5, 10, 20, 25, 35, 40, 50, 55: não coincide com o job de 15 min.
select cron.unschedule(jobid) from cron.job where jobname = 'integracoes-crm-continuacao';
select cron.schedule('integracoes-crm-continuacao', '5,10,20,25,35,40,50,55 * * * *', 'select public.integracoes_disparar_continuacao_crm();');
