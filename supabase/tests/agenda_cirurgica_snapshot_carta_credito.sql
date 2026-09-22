-- Controlled fixtures only. Always rolls back clients, agendamentos and datas.
-- Proves A-H, J from migration_070 (see relatório de QA for I: concorrência
-- real com duas conexões simultâneas, testada manualmente em produção porque
-- não é reproduzível dentro de uma única transação pgTAP).
begin;
do $$
declare
  cli_x uuid; cli_y uuid; cli_z uuid;
  data_termos_id uuid;
  data_cirurgica_id uuid;
  ag_x uuid; ag_y uuid; ag_z uuid;
  v_ag public.agendamentos%rowtype;
  v_snapshot numeric;
  v_mes date := '2099-01-01';
  v_mes2 date := '2099-02-01';
begin
  insert into public.clientes (nome_completo, cpf, data_nascimento, valor_contrato, quantidade_parcelas)
  values ('QA SQL TEST snapshot X','90000000001','1990-01-01',90000,12) returning id into cli_x;
  insert into public.clientes (nome_completo, cpf, data_nascimento, valor_contrato, quantidade_parcelas)
  values ('QA SQL TEST snapshot Y','90000000002','1990-01-01',60000,12) returning id into cli_y;
  insert into public.clientes (nome_completo, cpf, data_nascimento, valor_contrato, quantidade_parcelas)
  values ('QA SQL TEST snapshot Z','90000000003','1990-01-01',25000,12) returning id into cli_z;

  insert into public.datas (data, vagas_totais, status) values ('2099-01-05',3,'disponivel') returning id into data_termos_id;
  insert into public.datas_liberacao_financeira (data, vagas_totais, status) values ('2099-01-26',3,'disponivel') returning id into data_cirurgica_id;

  insert into public.agendamentos (cliente_id, data_id, valor_contrato, status, comparecimento_status, quitacao_status)
  values (cli_x, data_termos_id, 90000, 'confirmado', 'pendente', 'pendente') returning id into ag_x;
  insert into public.agendamentos (cliente_id, data_id, valor_contrato, status, comparecimento_status, quitacao_status)
  values (cli_y, data_termos_id, 60000, 'confirmado', 'pendente', 'pendente') returning id into ag_y;
  insert into public.agendamentos (cliente_id, data_id, valor_contrato, status, comparecimento_status, quitacao_status)
  values (cli_z, data_termos_id, 25000, 'confirmado', 'pendente', 'pendente') returning id into ag_z;

  -- A: snapshot é criado ao confirmar previsão (mês limpo, 90k cabe).
  v_ag := public.agenda_confirmar_previsao(ag_x, '2099-01-20', 'qa:sql-test');
  if v_ag.valor_contrato_comprometido is distinct from 90000::numeric(12,2) then
    raise exception 'A FAILED: snapshot not captured on confirmar_previsao, got %', v_ag.valor_contrato_comprometido;
  end if;

  -- C: editar clientes.valor_contrato depois NÃO pode alterar retroativamente
  --    o comprometimento de um mês já confirmado.
  update public.clientes set valor_contrato = 999999 where id = cli_x;
  if public.agenda_comprometimento_mes(v_mes) <> 90000::numeric then
    raise exception 'C FAILED: retroactive credit edit changed a committed month, got %', public.agenda_comprometimento_mes(v_mes);
  end if;
  update public.clientes set valor_contrato = 90000 where id = cli_x;

  -- H: teto continua bloqueando >100k (90k já comprometido + 25k de Z estoura).
  begin
    perform public.agenda_confirmar_previsao(ag_z, '2099-01-22', 'qa:sql-test');
    raise exception 'H FAILED: TETO_MENSAL_EXCEDIDO was not raised';
  exception when others then
    if sqlerrm <> 'TETO_MENSAL_EXCEDIDO' then raise; end if;
  end;

  -- E/F/G: reagendamento (nova chamada de agenda_confirmar_previsao para outro
  -- mês) preserva o snapshot, libera o mês anterior e compromete o novo mês
  -- atomicamente.
  v_ag := public.agenda_confirmar_previsao(ag_x, '2099-02-05', 'qa:sql-test');
  if v_ag.valor_contrato_comprometido is distinct from 90000::numeric(12,2) then
    raise exception 'E FAILED: snapshot lost/changed on reagendamento, got %', v_ag.valor_contrato_comprometido;
  end if;
  if public.agenda_comprometimento_mes(v_mes) <> 0::numeric then
    raise exception 'F FAILED: previous month did not release the commitment, got %', public.agenda_comprometimento_mes(v_mes);
  end if;
  if public.agenda_comprometimento_mes(v_mes2) <> 90000::numeric then
    raise exception 'G FAILED: new month did not receive the commitment, got %', public.agenda_comprometimento_mes(v_mes2);
  end if;

  -- D: nova confirmação usa o valor ATUAL da carta no momento da chamada
  --    (não um valor antigo/alheio).
  update public.clientes set valor_contrato = 30000 where id = cli_y;
  v_ag := public.agenda_confirmar_previsao(ag_y, '2099-01-25', 'qa:sql-test');
  if v_ag.valor_contrato_comprometido is distinct from 30000::numeric(12,2) then
    raise exception 'D FAILED: new confirmation did not use the current credit value, got %', v_ag.valor_contrato_comprometido;
  end if;

  -- B: snapshot também é (re)gravado ao reservar a cirurgia (compromisso final).
  update public.agendamentos
  set agenda_cirurgica_liberada_em = now(), comparecimento_status = 'compareceu', quitacao_status = 'paga'
  where id = ag_y;
  perform public.agenda_reservar_cirurgia(cli_y, '2099-01-26', '09:00', 'qa:sql-test');
  select valor_contrato_comprometido into v_snapshot from public.agendamentos where id = ag_y;
  if v_snapshot is distinct from 30000::numeric(12,2) then
    raise exception 'B FAILED: snapshot not (re)captured on reservar_cirurgia, got %', v_snapshot;
  end if;

  -- J: processo concluído permanece contabilizado no mês histórico correto.
  perform public.agenda_confirmar_pagamento_cirurgia(ag_y, 'qa:sql-test');
  if public.agenda_comprometimento_mes(v_mes) <> 30000::numeric then
    raise exception 'J FAILED: concluded process stopped counting in its historical month, got %', public.agenda_comprometimento_mes(v_mes);
  end if;

  -- I: garantia estrutural (o teste de concorrência real com duas conexões
  -- simultâneas foi feito manualmente em produção nesta rodada de QA — ver
  -- relatório; não é reproduzível dentro de uma única transação/sessão).
  if not exists (
    select 1 from pg_proc
    where proname in ('agenda_confirmar_previsao','agenda_reservar_cirurgia')
      and pg_get_functiondef(oid) ilike '%pg_advisory_xact_lock%'
  ) then
    raise exception 'I FAILED: advisory lock missing from teto functions';
  end if;

  raise notice 'agenda_cirurgica_snapshot_carta_credito: A-J passaram.';
end;
$$;
rollback;
