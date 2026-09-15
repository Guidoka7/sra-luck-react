-- Contexto técnico correlacionável sem PII para eventos de observabilidade.

alter table public.monitoramento_erros
  add column if not exists action text,
  add column if not exists actor_type text,
  add column if not exists actor_id text,
  add column if not exists duration_ms integer;

update public.monitoramento_erros
set actor_type = 'anonymous'
where actor_type is null;

alter table public.monitoramento_erros
  drop constraint if exists monitoramento_erros_actor_type_check;
alter table public.monitoramento_erros
  add constraint monitoramento_erros_actor_type_check
  check (actor_type is null or actor_type in ('cliente','admin','staff','system','anonymous'));

alter table public.monitoramento_erros
  drop constraint if exists monitoramento_erros_duration_ms_check;
alter table public.monitoramento_erros
  add constraint monitoramento_erros_duration_ms_check
  check (duration_ms is null or duration_ms >= 0);

create index if not exists monitoramento_erros_action_idx
  on public.monitoramento_erros (action, criado_em desc)
  where action is not null;

create index if not exists monitoramento_erros_actor_idx
  on public.monitoramento_erros (actor_type, actor_id, criado_em desc)
  where actor_id is not null;

comment on column public.monitoramento_erros.actor_id is
  'Identificador técnico pseudonimizado por HMAC. Nunca armazenar o ID real do usuário neste campo.';
