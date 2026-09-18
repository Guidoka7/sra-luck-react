-- migration_056_clientes_acesso_app.sql
-- Liberação explícita do acesso ao app da cliente.
-- Novos cadastros começam bloqueados. Clientes legadas que já conseguiam
-- autenticar pelo fluxo anterior preservam o acesso para evitar bloqueio
-- retroativo; casos legados sem parcelas são tratados pelo fallback do app.

alter table public.clientes
  add column if not exists acesso_app_liberado boolean not null default false,
  add column if not exists acesso_app_liberado_em timestamptz;

update public.clientes
set acesso_app_liberado = true
where acesso_app_liberado = false
  and ativo = true
  and nullif(btrim(coalesce(nome_completo, '')), '') is not null
  and nullif(btrim(coalesce(cpf, '')), '') is not null
  and data_nascimento is not null;

comment on column public.clientes.acesso_app_liberado is
  'Indica se o acesso da cliente ao aplicativo foi explicitamente liberado. Novos cadastros iniciam bloqueados.';
comment on column public.clientes.acesso_app_liberado_em is
  'Data/hora da liberação administrativa do app. Pode ser nula para acessos legados preservados pela migration.';
