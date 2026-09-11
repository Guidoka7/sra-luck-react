-- ============================================================================
-- migration_029_restaurar_agendamento_termos.sql
-- Restaura a RPC usada pelo Worker para reservar a assinatura dos termos.
-- Mantém lock da data e verificação de vagas para evitar overbooking.
-- ============================================================================

create or replace function public.agendar_data(
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
  v_data public.datas%rowtype;
  v_agendamento_id uuid;
  v_horario time;
begin
  begin
    v_horario := p_horario_termos::time;
  exception when others then
    raise exception using errcode = 'P0005', message = 'HORARIO_INVALIDO';
  end;

  select * into v_data
  from public.datas
  where id = p_data_id
  for update;

  if not found or v_data.status <> 'disponivel' then
    raise exception using errcode = 'P0001', message = 'DATA_INDISPONIVEL';
  end if;

  if exists (
    select 1
    from public.agendamentos
    where cliente_id = p_cliente_id
      and status = 'confirmado'
  ) then
    raise exception using errcode = 'P0002', message = 'CLIENTE_JA_AGENDADA';
  end if;

  if (
    select count(*)
    from public.agendamentos
    where data_id = p_data_id
      and status = 'confirmado'
  ) >= v_data.vagas_totais then
    raise exception using errcode = 'P0003', message = 'VAGAS_ESGOTADAS';
  end if;

  insert into public.agendamentos (
    cliente_id,
    data_id,
    valor_contrato,
    status,
    horario_termos
  ) values (
    p_cliente_id,
    p_data_id,
    p_valor_contrato,
    'confirmado',
    v_horario
  )
  returning id into v_agendamento_id;

  return v_agendamento_id;
exception
  when unique_violation then
    raise exception using errcode = 'P0004', message = 'CLIENTE_JA_AGENDADA';
end;
$$;

revoke all on function public.agendar_data(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.agendar_data(uuid, uuid, numeric, text) to service_role;
