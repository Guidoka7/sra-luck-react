-- ============================================================================
-- migration_041_agendamentos_data_cirurgia.sql
--
-- Correção: "Cirurgias confirmadas" (Fase 5) usava previsao_liberacao_financeira
-- como se fosse a data da cirurgia. Previsão de liberação financeira NÃO é a
-- data real da cirurgia — são conceitos diferentes que hoje coincidem por
-- acidente de implementação (agendar_cirurgia_data grava a data escolhida
-- nesse campo por herança do fluxo antigo). Cria um campo próprio e explícito
-- para a data real da cirurgia, sem remover o campo antigo (várias telas já
-- leem previsao_liberacao_financeira com esse sentido; migrar todas de uma
-- vez seria fora do escopo desta correção pontual).
-- ============================================================================

alter table agendamentos add column if not exists data_cirurgia date;
comment on column agendamentos.data_cirurgia is
  'Data real da cirurgia, definida quando a cliente confirma a data (agendar_cirurgia_data). Não confundir com previsao_liberacao_financeira (nome histórico mantido por compatibilidade com leituras existentes).';

create index if not exists idx_agendamentos_data_cirurgia on agendamentos(data_cirurgia);

-- Backfill determinístico: agendamentos que já têm previsao_liberacao_financeira
-- preenchida E cliente com status_cirurgia agendada/realizada são, com certeza,
-- os que já passaram pelo fluxo de escolha de data de cirurgia.
update agendamentos a
set data_cirurgia = a.previsao_liberacao_financeira
where a.data_cirurgia is null
  and a.previsao_liberacao_financeira is not null
  and exists (
    select 1 from clientes c
    where c.id = a.cliente_id and c.status_cirurgia in ('agendada', 'realizada')
  );

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
  v_limite date;
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
  v_limite := public.adicionar_dias_corridos(v_base, 90);

  if p_data > v_limite then
    raise exception using errcode = 'P0016', message = 'PRAZO_CIRURGICO_EXCEDIDO';
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
      data_cirurgia = p_data,
      updated_at = now()
  where id = p_agendamento_id;

  update public.clientes
  set status_cirurgia = 'agendada',
      updated_at = now()
  where id = v_agendamento.cliente_id;
end;
$$;

revoke all on function public.agendar_cirurgia_data(uuid, date) from public, anon, authenticated;
grant execute on function public.agendar_cirurgia_data(uuid, date) to service_role;
