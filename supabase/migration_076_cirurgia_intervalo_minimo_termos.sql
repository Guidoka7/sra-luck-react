-- ============================================================================
-- MIGRATION 076: intervalo mínimo entre a assinatura dos termos e a cirurgia
--
-- Regra aprovada (2026-09-23):
-- - A agenda cirúrgica continua sendo liberada em até 5 dias úteis após termos
--   assinados E quitação confirmada (V46, migration_064/065 — inalterado).
-- - Depois de liberada, a cliente só pode escolher datas a partir da data que
--   ela escolheu para a assinatura dos termos + 90 dias corridos (regra
--   interna). Antes disso, todas as datas aparecem para ela como lotadas.
-- - O intervalo fica em public.configuracoes.cirurgia_intervalo_minimo_dias
--   (configurável, padrão 90).
-- - A regra vale para a escolha feita pela cliente no app. A reserva feita
--   pela equipe no admin (agenda_reservar_cirurgia) não é alterada.
--
-- Migration aditiva: só adiciona coluna e funções novas.
-- Depende da migration_070 (agenda_reservar_cirurgia vigente).
-- ============================================================================

begin;

alter table public.configuracoes
  add column if not exists cirurgia_intervalo_minimo_dias integer not null default 90;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_configuracoes_cirurgia_intervalo_minimo_dias') then
    alter table public.configuracoes
      add constraint chk_configuracoes_cirurgia_intervalo_minimo_dias
      check (cirurgia_intervalo_minimo_dias between 0 and 365);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Primeira data que a cliente pode escolher para a cirurgia: data escolhida
-- para a assinatura dos termos + intervalo configurado. Única implementação
-- da regra; o worker usa esta função para montar o calendário.
-- ----------------------------------------------------------------------------
create or replace function public.agenda_data_minima_cirurgia(p_agendamento_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select d.data + coalesce((select c.cirurgia_intervalo_minimo_dias from public.configuracoes c where c.id = 1), 90)
  from public.agendamentos a
  join public.datas d on d.id = a.data_id
  where a.id = p_agendamento_id;
$$;

revoke all on function public.agenda_data_minima_cirurgia(uuid) from public, anon, authenticated;
grant execute on function public.agenda_data_minima_cirurgia(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Reserva feita pela cliente: aplica o intervalo mínimo e delega todo o resto
-- (liberação, previsão, vagas, horário, teto mensal, auditoria) para
-- agenda_reservar_cirurgia, na mesma transação.
-- ----------------------------------------------------------------------------
create or replace function public.agenda_reservar_cirurgia_cliente(
  p_cliente_id uuid,
  p_data date,
  p_horario text,
  p_usuario text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agendamento_id uuid;
  v_minima date;
begin
  select a.id into v_agendamento_id
  from public.agendamentos a
  where a.cliente_id = p_cliente_id
    and a.status in ('confirmado','realizado')
    and a.agenda_cirurgica_liberada_em is not null
    and a.data_cirurgia is null
  order by a.created_at desc
  limit 1
  for update;

  if v_agendamento_id is not null then
    v_minima := public.agenda_data_minima_cirurgia(v_agendamento_id);
    if v_minima is not null and p_data < v_minima then
      raise exception 'DATA_CIRURGIA_LOTADA';
    end if;
  end if;

  return public.agenda_reservar_cirurgia(p_cliente_id, p_data, p_horario, p_usuario);
end;
$$;

revoke all on function public.agenda_reservar_cirurgia_cliente(uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.agenda_reservar_cirurgia_cliente(uuid, date, text, text) to service_role;

commit;
