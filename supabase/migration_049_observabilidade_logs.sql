-- Observabilidade técnica da aplicação.
-- Nunca armazenar CPF, senha, tokens, cookies, dados bancários ou payloads brutos.

create table if not exists public.monitoramento_erros (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  origem text not null default 'api',
  nivel text not null default 'error',
  rota text,
  metodo text,
  status_http integer,
  codigo text,
  mensagem text not null,
  stack text,
  componente text,
  request_id text,
  user_agent text,
  ambiente text,
  detalhes jsonb not null default '{}'::jsonb
);

-- Atualiza instalações antigas da migration_023 para os níveis canônicos.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.monitoramento_erros'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%nivel%'
  loop
    execute format('alter table public.monitoramento_erros drop constraint if exists %I', c.conname);
  end loop;
end $$;

update public.monitoramento_erros set nivel = 'warn' where nivel = 'warning';
update public.monitoramento_erros set nivel = 'fatal' where nivel = 'critical';
update public.monitoramento_erros set nivel = 'error' where nivel not in ('info','warn','error','fatal');

alter table public.monitoramento_erros
  add constraint monitoramento_erros_nivel_check
  check (nivel in ('info','warn','error','fatal'));

alter table public.monitoramento_erros
  drop constraint if exists monitoramento_erros_origem_check;
alter table public.monitoramento_erros
  add constraint monitoramento_erros_origem_check
  check (origem in ('frontend','api','diagnostico'));

create index if not exists monitoramento_erros_criado_em_idx
  on public.monitoramento_erros (criado_em desc);
create index if not exists monitoramento_erros_nivel_idx
  on public.monitoramento_erros (nivel, criado_em desc);
create index if not exists monitoramento_erros_rota_idx
  on public.monitoramento_erros (rota, criado_em desc);
create index if not exists monitoramento_erros_request_id_idx
  on public.monitoramento_erros (request_id, criado_em desc)
  where request_id is not null;

alter table public.monitoramento_erros enable row level security;
revoke all on public.monitoramento_erros from anon, authenticated;
grant select, insert, update, delete on public.monitoramento_erros to service_role;

comment on table public.monitoramento_erros is
  'Eventos técnicos sanitizados. PII, credenciais, cookies, tokens e payloads brutos são proibidos.';
