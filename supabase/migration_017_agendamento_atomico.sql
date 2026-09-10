-- ============================================================================
-- migration_017_agendamento_atomico.sql
-- Protege a reserva da última vaga contra requisições concorrentes.
-- Execute no SQL Editor do Supabase.
-- ============================================================================

alter table agendamentos add column if not exists horario_termos text;

create or replace function agendar_data(
  p_cliente_id uuid,
  p_data_id uuid,
  p_valor_contrato numeric,
  p_horario_termos text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data datas%rowtype;
  v_agendamento_id uuid;
begin
  select * into v_data from datas where id = p_data_id for update;

  if not found or v_data.status <> 'disponivel' then
    raise exception using errcode = 'P0001', message = 'DATA_INDISPONIVEL';
  end if;

  if exists (
    select 1 from agendamentos
    where cliente_id = p_cliente_id and status = 'confirmado'
  ) then
    raise exception using errcode = 'P0002', message = 'CLIENTE_JA_AGENDADA';
  end if;

  if (
    select count(*) from agendamentos
    where data_id = p_data_id and status = 'confirmado'
  ) >= v_data.vagas_totais then
    raise exception using errcode = 'P0003', message = 'VAGAS_ESGOTADAS';
  end if;

  insert into agendamentos (cliente_id, data_id, valor_contrato, status, horario_termos)
  values (p_cliente_id, p_data_id, p_valor_contrato, 'confirmado', p_horario_termos)
  returning id into v_agendamento_id;

  return v_agendamento_id;
exception
  when unique_violation then
    raise exception using errcode = 'P0004', message = 'CLIENTE_JA_AGENDADA';
end;
$$;

revoke all on function agendar_data(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function agendar_data(uuid, uuid, numeric, text) to service_role;
