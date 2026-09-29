-- Rollback da migration_115: remove só o catálogo pré-calculado. O App volta a guardá-lo em memória.
drop table if exists public.integracao_catalogos;
