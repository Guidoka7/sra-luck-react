-- ============================================================================
-- migration_071_agenda_realtime_sync.sql
--
-- Sinal público mínimo para espelhamento instantâneo das agendas no app.
-- Não expõe clientes, agendamentos nem observações internas: o navegador
-- recebe apenas {tipo, versao, updated_at} e então refaz o GET autenticado
-- /api/cliente/agenda, que continua sendo a fonte de verdade.
-- ============================================================================

create table if not exists public.agenda_sync_state (
  tipo text primary key check (tipo in ('termos','cirurgia')),
  versao bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.agenda_sync_state (tipo, versao)
values ('termos', 0), ('cirurgia', 0)
on conflict (tipo) do nothing;

alter table public.agenda_sync_state enable row level security;

revoke all on table public.agenda_sync_state from public, anon, authenticated;
grant select on table public.agenda_sync_state to anon, authenticated;

drop policy if exists agenda_sync_state_public_read on public.agenda_sync_state;
create policy agenda_sync_state_public_read
on public.agenda_sync_state
for select
to anon, authenticated
using (true);

comment on table public.agenda_sync_state is
  'Sinal sem PII para Supabase Realtime. Clientes refazem /api/cliente/agenda ao receber mudança.';

create or replace function public.bump_agenda_sync_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'datas' then
    update public.agenda_sync_state
       set versao = versao + 1, updated_at = clock_timestamp()
     where tipo = 'termos';
  elsif tg_table_name = 'datas_liberacao_financeira' then
    update public.agenda_sync_state
       set versao = versao + 1, updated_at = clock_timestamp()
     where tipo = 'cirurgia';
  elsif tg_table_name = 'agendamentos' then
    update public.agenda_sync_state
       set versao = versao + 1, updated_at = clock_timestamp()
     where tipo in ('termos','cirurgia');
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.bump_agenda_sync_state() from public, anon, authenticated;

drop trigger if exists trg_agenda_sync_datas on public.datas;
create trigger trg_agenda_sync_datas
after insert or update or delete on public.datas
for each statement execute function public.bump_agenda_sync_state();

drop trigger if exists trg_agenda_sync_datas_cirurgia on public.datas_liberacao_financeira;
create trigger trg_agenda_sync_datas_cirurgia
after insert or update or delete on public.datas_liberacao_financeira
for each statement execute function public.bump_agenda_sync_state();

drop trigger if exists trg_agenda_sync_agendamentos on public.agendamentos;
create trigger trg_agenda_sync_agendamentos
after insert or update or delete on public.agendamentos
for each statement execute function public.bump_agenda_sync_state();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'agenda_sync_state'
  ) then
    alter publication supabase_realtime add table public.agenda_sync_state;
  end if;
end
$$;
