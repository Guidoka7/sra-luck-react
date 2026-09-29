-- Rollback da migration_118: a importação em etapas continua só no job de 15 min.
select cron.unschedule(jobid) from cron.job where jobname = 'integracoes-crm-continuacao';
drop function if exists public.integracoes_disparar_continuacao_crm();
