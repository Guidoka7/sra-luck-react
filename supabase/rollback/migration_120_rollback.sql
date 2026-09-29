-- Rollback da migration_120: as rotinas voltam a depender só dos crons da Vercel.
select cron.unschedule(jobid) from cron.job where jobname in ('notificacoes-financeiras-diaria', 'mensagem-do-dia-diaria');
drop function if exists public.rotinas_disparar(text);
