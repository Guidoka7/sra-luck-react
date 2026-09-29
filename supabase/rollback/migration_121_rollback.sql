-- Rollback da migration_121. Falha se houver entidade_id que não seja UUID (ex.: "rd_station");
-- nesse caso, mova-os para detalhes antes: update ... set entidade_id = null where entidade_id !~ '^[0-9a-f-]{36}$'.
alter table public.logs_alteracoes alter column entidade_id type uuid using entidade_id::uuid;
