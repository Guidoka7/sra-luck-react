-- ============================================================================
-- MIGRATION 025: Exclusão definitiva de cliente
--
-- Garante ON DELETE CASCADE para TODA FK que aponta para clientes(id).
-- Assim o botão "Remover" do painel consegue excluir a cliente mesmo quando
-- ela possui boletos, agendamentos ou registros criados por migrações novas.
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      c.relname as table_name,
      con.conname as constraint_name,
      a.attname as column_name
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class parent on parent.oid = con.confrelid
    join pg_namespace parent_n on parent_n.oid = parent.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = con.conkey[1]
    where con.contype = 'f'
      and parent_n.nspname = 'public'
      and parent.relname = 'clientes'
      and c.relname <> 'clientes'
      and n.nspname = 'public'
      and array_length(con.conkey, 1) = 1
      and array_length(con.confkey, 1) = 1
  loop
    execute format(
      'alter table %I.%I drop constraint %I',
      r.schema_name,
      r.table_name,
      r.constraint_name
    );

    execute format(
      'alter table %I.%I add constraint %I foreign key (%I) references public.clientes(id) on delete cascade',
      r.schema_name,
      r.table_name,
      r.constraint_name,
      r.column_name
    );
  end loop;
end $$;
