-- ============================================================================
-- migration_028_agenda_cirurgica_5_dias_uteis.sql
-- Regra operacional vigente:
-- termos assinados + quitação confirmada -> 5 dias úteis -> agenda cirúrgica.
-- A contagem começa quando ambos os pré-requisitos já existem, portanto usa o
-- marco mais recente entre assinatura e confirmação da quitação.
-- ============================================================================

create or replace function public.adicionar_dias_uteis(p_data date, p_dias integer)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  resultado date := p_data;
  adicionados integer := 0;
begin
  if p_data is null then return null; end if;
  if p_dias <= 0 then return resultado; end if;
  while adicionados < p_dias loop
    resultado := resultado + 1;
    if extract(isodow from resultado) between 1 and 5 then
      adicionados := adicionados + 1;
    end if;
  end loop;
  return resultado;
end;
$$;

create or replace function public.agendar_cirurgia_data(p_agendamento_id uuid, p_data date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agendamento public.agendamentos%rowtype;
  v_cliente public.clientes%rowtype;
  v_data public.datas_liberacao_financeira%rowtype;
  v_ocupadas integer;
  v_base date;
  v_liberar_em date;
  v_hoje date := (timezone('America/Sao_Paulo', now()))::date;
begin
  select * into v_agendamento
  from public.agendamentos
  where id = p_agendamento_id
  for update;

  if not found then
    raise exception using errcode = 'P0012', message = 'AGENDAMENTO_NAO_ENCONTRADO';
  end if;

  if v_agendamento.termos_assinados_em is null then
    raise exception using errcode = 'P0013', message = 'TERMOS_NAO_ASSINADOS';
  end if;

  select * into v_cliente
  from public.clientes
  where id = v_agendamento.cliente_id
  for update;

  if not found then
    raise exception using errcode = 'P0014', message = 'CLIENTE_NAO_ENCONTRADA';
  end if;

  if v_cliente.custeio_confirmado_em is null then
    raise exception using errcode = 'P0015', message = 'SALDO_NAO_QUITADO';
  end if;

  v_base := greatest(
    (timezone('America/Sao_Paulo', v_agendamento.termos_assinados_em))::date,
    (timezone('America/Sao_Paulo', v_cliente.custeio_confirmado_em))::date
  );
  v_liberar_em := public.adicionar_dias_uteis(v_base, 5);

  if v_hoje < v_liberar_em or p_data < v_liberar_em then
    raise exception using errcode = 'P0016', message = 'PRAZO_CIRURGICO_NAO_CONCLUIDO';
  end if;

  select * into v_data
  from public.datas_liberacao_financeira
  where data = p_data
  for update;

  if not found or v_data.status <> 'disponivel' then
    raise exception using errcode = 'P0010', message = 'DATA_CIRURGIA_INDISPONIVEL';
  end if;

  select count(*)::integer into v_ocupadas
  from public.agendamentos
  where status in ('confirmado', 'realizado')
    and previsao_liberacao_financeira = p_data
    and id <> p_agendamento_id;

  if v_ocupadas >= 1 then
    raise exception using errcode = 'P0011', message = 'DATA_CIRURGIA_OCUPADA';
  end if;

  update public.agendamentos
  set previsao_liberacao_financeira = p_data,
      updated_at = now()
  where id = p_agendamento_id;

  update public.clientes
  set status_cirurgia = 'agendada',
      updated_at = now()
  where id = v_agendamento.cliente_id;
end;
$$;

revoke all on function public.adicionar_dias_uteis(date, integer) from public, anon, authenticated;
revoke all on function public.agendar_cirurgia_data(uuid, date) from public, anon, authenticated;
grant execute on function public.adicionar_dias_uteis(date, integer) to service_role;
grant execute on function public.agendar_cirurgia_data(uuid, date) to service_role;
