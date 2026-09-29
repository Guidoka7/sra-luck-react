-- Rollback da migration_117: o agendador volta a depender só do CRON_SECRET da hospedagem.
drop function if exists public.integracoes_cron_autorizado(text);
