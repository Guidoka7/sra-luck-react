-- migration_060_agenda_operacional_definitiva.sql
-- Nova Agenda Administrativa definitiva.
-- Reutiliza as entidades reais: clientes, boletos, datas, agendamentos,
-- datas_liberacao_financeira, solicitacoes_liberacao_financeira,
-- financeiro_recebimentos e logs_alteracoes.
--
-- Não cria uma segunda fonte de verdade para cliente, parcelas ou pagamentos.

alter table public.datas
  add column if not exists fechamento_manual boolean not null default false;

alter table public.datas_liberacao_financeira
  add column if not exists vagas_totais integer,
  add column if not exists fechamento_manual boolean not null default false;

update public.datas_liberacao_financeira
set vagas_totais = 1
where vagas_totais is null;

alter table public.datas_liberacao_financeira
  alter column vagas_totais set default 1,
  alter column vagas_totais set not null;

do $$ begin
  alter table public.datas_liberacao_financeira
    add constraint datas_liberacao_financeira_vagas_check
    check (vagas_totais >= 0);
exception when duplicate_object then null; end $$;

alter table public.agendamentos
  add column if not exists previsao_cirurgia date,
  add column if not exists previsao_cirurgia_confirmada_em timestamptz,
  add column if not exists previsao_cirurgia_confirmada_por text,
  add column if not exists quitacao_status text not null default 'pendente',
  add column if not exists quitacao_em timestamptz,
  add column if not exists quitacao_metodo text,
  add column if not exists agenda_cirurgica_liberada_em timestamptz,
  add column if not exists horario_cirurgia time,
  add column if not exists cirurgia_escolhida_em timestamptz;

do $$ begin
  alter table public.agendamentos
    add constraint agendamentos_quitacao_status_check
    check (quitacao_status in ('pendente','paga','nao_realizada'));
exception when duplicate_object then null; end $$;

alter table public.clientes
  add column if not exists financeiro_valor_total_calculado numeric(12,2),
  add column if not exists financeiro_saldo_calculado numeric(12,2),
  add column if not exists financeiro_levantamento_confirmado_por text;

create index if not exists idx_agendamentos_previsao_cirurgia
  on public.agendamentos (previsao_cirurgia)
  where previsao_cirurgia_confirmada_em is not null;

create index if not exists idx_agendamentos_data_cirurgia_horario
  on public.agendamentos (data_cirurgia, horario_cirurgia)
  where data_cirurgia is not null and status <> 'cancelado';

create index if not exists idx_agendamentos_release_queue
  on public.agendamentos (cliente_id, status, data_cirurgia, previsao_cirurgia_confirmada_em);

-- Regra central e única de elegibilidade da nova Agenda.
create or replace function public.percentual_minimo_fluxo_agenda()
returns numeric
language sql
immutable
set search_path = public
as $$
  select 70::numeric;
$$;

create or replace function public.pode_agendar(p_cliente_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when c.id is null or c.quantidade_parcelas is null then false
    else public.porcentagem_pagamento(p_cliente_id) >= public.percentual_minimo_fluxo_agenda()
  end
  from public.clientes c
  where c.id = p_cliente_id;
$$;

revoke all on function public.percentual_minimo_fluxo_agenda() from public, anon, authenticated;
revoke all on function public.pode_agendar(uuid) from public, anon, authenticated;
grant execute on function public.percentual_minimo_fluxo_agenda() to service_role;
grant execute on function public.pode_agendar(uuid) to service_role;

comment on function public.percentual_minimo_fluxo_agenda() is
  'Fonte única do percentual mínimo da Agenda definitiva: 70% das parcelas reais pagas.';

-- Confirma o levantamento financeiro usando exclusivamente os boletos reais.
create or replace function public.agenda_confirmar_levantamento(
  p_cliente_id uuid,
  p_saldo_final numeric,
  p_formas text[],
  p_usuario text
)
returns public.clientes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente public.clientes%rowtype;
  v_total numeric(12,2);
  v_saldo_calculado numeric(12,2);
  v_qtd integer;
  v_forma text;
begin
  select * into v_cliente
  from public.clientes
  where id = p_cliente_id
  for update;

  if not found then raise exception 'CLIENTE_NAO_ENCONTRADA'; end if;

  select
    count(*)::integer,
    coalesce(sum(valor),0)::numeric(12,2),
    coalesce(sum(valor) filter (where status <> 'pago'),0)::numeric(12,2)
  into v_qtd, v_total, v_saldo_calculado
  from public.boletos
  where cliente_id = p_cliente_id;

  if v_qtd = 0 then raise exception 'FINANCEIRO_NAO_CRIADO'; end if;
  if not public.pode_agendar(p_cliente_id) then raise exception 'PERCENTUAL_MINIMO_NAO_ATINGIDO'; end if;
  if p_saldo_final is null or p_saldo_final < 0 then raise exception 'SALDO_FINAL_INVALIDO'; end if;
  if coalesce(array_length(p_formas,1),0) = 0 then raise exception 'FORMAS_QUITACAO_OBRIGATORIAS'; end if;

  foreach v_forma in array p_formas loop
    if v_forma not in ('cartao','pix','boleto_100','cheques') then
      raise exception 'FORMA_QUITACAO_INVALIDA';
    end if;
  end loop;

  update public.clientes
  set status_revisao_financeira = 'aprovada',
      financeiro_valor_total_calculado = v_total,
      financeiro_saldo_calculado = v_saldo_calculado,
      financeiro_saldo_restante = round(p_saldo_final,2),
      financeiro_formas_custeio = p_formas,
      financeiro_confirmado_em = now(),
      financeiro_levantamento_confirmado_por = p_usuario,
      observacao_revisao_financeira = null,
      updated_at = now()
  where id = p_cliente_id
  returning * into v_cliente;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (
    p_usuario,
    'confirmou_levantamento_financeiro',
    'clientes',
    p_cliente_id,
    jsonb_build_object(
      'valor_total_plano',v_total,
      'saldo_calculado',v_saldo_calculado,
      'saldo_final',round(p_saldo_final,2),
      'formas_quitacao',p_formas,
      'percentual_minimo',public.percentual_minimo_fluxo_agenda()
    )
  );

  return v_cliente;
end;
$$;

-- Etapa 4: reserva de termos com gate real e lock da capacidade.
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
  v_cliente public.clientes%rowtype;
  v_agendamento_id uuid;
  v_horario time;
  v_ocupadas integer;
  v_escolha uuid;
begin
  begin
    v_horario := p_horario_termos::time;
  exception when others then
    raise exception using errcode='P0005', message='HORARIO_INVALIDO';
  end;

  if p_horario_termos not in ('09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30') then
    raise exception using errcode='P0005', message='HORARIO_INVALIDO';
  end if;

  select * into v_cliente
  from public.clientes
  where id = p_cliente_id
  for update;

  if not found then raise exception using errcode='P0006', message='CLIENTE_NAO_ENCONTRADA'; end if;
  if not public.pode_agendar(p_cliente_id) then raise exception using errcode='P0007', message='PERCENTUAL_MINIMO_NAO_ATINGIDO'; end if;
  if v_cliente.status_revisao_financeira <> 'aprovada' or v_cliente.financeiro_confirmado_em is null then
    raise exception using errcode='P0008', message='LEVANTAMENTO_NAO_CONCLUIDO';
  end if;

  select id into v_escolha
  from public.solicitacoes_liberacao_financeira
  where cliente_id = p_cliente_id
    and status in ('pendente','em_analise','aprovada')
  order by created_at desc
  limit 1;

  if v_escolha is null then
    raise exception using errcode='P0009', message='FORMA_QUITACAO_NAO_ESCOLHIDA';
  end if;

  select * into v_data
  from public.datas
  where id = p_data_id
  for update;

  if not found
    or v_data.status <> 'disponivel'
    or coalesce(v_data.fechamento_manual,false)
    or v_data.vagas_totais <= 0
    or v_data.data < (timezone('America/Sao_Paulo',now()))::date then
    raise exception using errcode='P0001', message='DATA_INDISPONIVEL';
  end if;

  if exists (
    select 1 from public.agendamentos
    where cliente_id = p_cliente_id and status = 'confirmado'
  ) then
    raise exception using errcode='P0002', message='CLIENTE_JA_AGENDADA';
  end if;

  select count(*)::integer into v_ocupadas
  from public.agendamentos
  where data_id = p_data_id
    and status in ('confirmado','realizado');

  if v_ocupadas >= v_data.vagas_totais then
    raise exception using errcode='P0003', message='VAGAS_ESGOTADAS';
  end if;

  insert into public.agendamentos(
    cliente_id,data_id,valor_contrato,status,horario_termos,
    comparecimento_status,quitacao_status
  )
  values(
    p_cliente_id,p_data_id,coalesce(v_cliente.valor_contrato,p_valor_contrato,0),
    'confirmado',v_horario,'pendente','pendente'
  )
  returning id into v_agendamento_id;

  update public.solicitacoes_liberacao_financeira
  set agendamento_id = v_agendamento_id,
      updated_at = now()
  where id = v_escolha;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (
    'cliente:'||p_cliente_id::text,
    'agendou_termos_etapa_4',
    'agendamentos',
    v_agendamento_id,
    jsonb_build_object('cliente_id',p_cliente_id,'data_id',p_data_id,'data',v_data.data,'horario',p_horario_termos)
  );

  return v_agendamento_id;
exception
  when unique_violation then
    raise exception using errcode='P0004', message='CLIENTE_JA_AGENDADA';
end;
$$;

-- Comprometimento mensal: cirurgia escolhida tem prioridade sobre previsão.
create or replace function public.agenda_comprometimento_mes(
  p_mes date,
  p_excluir_cliente uuid default null
)
returns numeric
language sql
stable
set search_path = public
as $$
  with candidatos as (
    select
      a.cliente_id,
      c.valor_contrato,
      case
        when a.data_cirurgia is not null then a.data_cirurgia
        when a.previsao_cirurgia_confirmada_em is not null then a.previsao_cirurgia
        else null
      end as data_compromisso,
      (a.data_cirurgia is not null) as final,
      coalesce(a.cirurgia_escolhida_em,a.previsao_cirurgia_confirmada_em,a.updated_at,a.created_at) as marco
    from public.agendamentos a
    join public.clientes c on c.id = a.cliente_id
    where a.status in ('confirmado','realizado')
      and (a.data_cirurgia is not null or a.previsao_cirurgia_confirmada_em is not null)
      and (p_excluir_cliente is null or a.cliente_id <> p_excluir_cliente)
  ), unicos as (
    select distinct on (cliente_id)
      cliente_id,valor_contrato,data_compromisso
    from candidatos
    where data_compromisso is not null
    order by cliente_id,final desc,marco desc
  )
  select coalesce(sum(valor_contrato),0)::numeric
  from unicos
  where date_trunc('month',data_compromisso)::date = date_trunc('month',p_mes)::date;
$$;

create or replace function public.agenda_confirmar_previsao(
  p_agendamento_id uuid,
  p_previsao date,
  p_usuario text
)
returns public.agendamentos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agendamento public.agendamentos%rowtype;
  v_data_termos date;
  v_credito numeric(12,2);
  v_atual numeric;
  v_projecao numeric;
  v_hoje date := (timezone('America/Sao_Paulo',now()))::date;
begin
  select a.*, d.data
  into v_agendamento, v_data_termos
  from public.agendamentos a
  join public.datas d on d.id = a.data_id
  where a.id = p_agendamento_id
    and a.status in ('confirmado','realizado')
  for update of a;

  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;
  if p_previsao is null or p_previsao < v_data_termos or p_previsao < v_hoje then
    raise exception 'PREVISAO_INVALIDA';
  end if;

  select coalesce(valor_contrato,0)::numeric(12,2)
  into v_credito
  from public.clientes
  where id = v_agendamento.cliente_id;

  v_atual := public.agenda_comprometimento_mes(p_previsao,v_agendamento.cliente_id);
  v_projecao := v_atual + v_credito;
  if v_projecao > 100000 then raise exception 'TETO_MENSAL_EXCEDIDO'; end if;

  update public.agendamentos
  set previsao_cirurgia = p_previsao,
      previsao_cirurgia_confirmada_em = now(),
      previsao_cirurgia_confirmada_por = p_usuario,
      updated_at = now()
  where id = p_agendamento_id
  returning * into v_agendamento;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (
    p_usuario,'confirmou_previsao_cirurgia','agendamentos',p_agendamento_id,
    jsonb_build_object(
      'cliente_id',v_agendamento.cliente_id,
      'previsao',p_previsao,
      'carta_credito',v_credito,
      'comprometido_antes',v_atual,
      'projecao',v_projecao,
      'teto',100000
    )
  );

  return v_agendamento;
end;
$$;

create or replace function public.agenda_tentar_liberar_cirurgia(
  p_agendamento_id uuid,
  p_usuario text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.agendamentos%rowtype;
  v_liberou boolean := false;
begin
  select * into v
  from public.agendamentos
  where id = p_agendamento_id
  for update;

  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  if v.previsao_cirurgia_confirmada_em is not null
    and v.comparecimento_status = 'compareceu'
    and v.quitacao_status = 'paga'
    and v.status in ('confirmado','realizado') then

    v_liberou := v.agenda_cirurgica_liberada_em is null;

    update public.agendamentos
    set agenda_cirurgica_liberada_em = coalesce(agenda_cirurgica_liberada_em,now()),
        updated_at = now()
    where id = p_agendamento_id;

    if v_liberou then
      insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
      values (
        p_usuario,'liberou_agenda_cirurgica','agendamentos',p_agendamento_id,
        jsonb_build_object('cliente_id',v.cliente_id,'previsao_cirurgia',v.previsao_cirurgia)
      );
    end if;
  end if;

  return v_liberou;
end;
$$;

create or replace function public.agenda_registrar_comparecimento(
  p_agendamento_id uuid,
  p_compareceu boolean,
  p_usuario text
)
returns public.agendamentos
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.agendamentos%rowtype;
begin
  select * into v
  from public.agendamentos
  where id = p_agendamento_id
    and status in ('confirmado','realizado')
  for update;

  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  if p_compareceu then
    if v.previsao_cirurgia_confirmada_em is null then raise exception 'PREVISAO_NAO_CONFIRMADA'; end if;

    update public.agendamentos
    set comparecimento_status = 'compareceu',
        comparecimento_em = now(),
        termos_assinados_em = coalesce(termos_assinados_em,now()),
        status = 'realizado',
        updated_at = now()
    where id = p_agendamento_id
    returning * into v;

    perform public.agenda_tentar_liberar_cirurgia(p_agendamento_id,p_usuario);

    insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
    values (p_usuario,'confirmou_comparecimento_termos','agendamentos',p_agendamento_id,jsonb_build_object('cliente_id',v.cliente_id));
  else
    update public.agendamentos
    set comparecimento_status = 'nao_compareceu',
        comparecimento_em = now(),
        status = 'cancelado',
        agenda_cirurgica_liberada_em = null,
        updated_at = now()
    where id = p_agendamento_id
    returning * into v;

    update public.solicitacoes_liberacao_financeira
    set agendamento_id = null, updated_at = now()
    where agendamento_id = p_agendamento_id;

    insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
    values (
      p_usuario,'registrou_ausencia_termos','agendamentos',p_agendamento_id,
      jsonb_build_object('cliente_id',v.cliente_id,'retorno','etapa_4','vaga_liberada',true)
    );
  end if;

  return v;
end;
$$;

create or replace function public.agenda_registrar_quitacao(
  p_agendamento_id uuid,
  p_recebido boolean,
  p_usuario text,
  p_idempotency_key text
)
returns public.agendamentos
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.agendamentos%rowtype;
  v_cliente public.clientes%rowtype;
  v_escolha public.solicitacoes_liberacao_financeira%rowtype;
  v_boleto public.boletos%rowtype;
  v_aberto numeric := 0;
  v_total_final numeric := 0;
  v_alocado numeric := 0;
  v_valor numeric := 0;
  v_restante numeric := 0;
  v_forma text;
  v_count integer := 0;
  v_index integer := 0;
begin
  select * into v
  from public.agendamentos
  where id = p_agendamento_id
    and status in ('confirmado','realizado')
  for update;

  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  select * into v_cliente
  from public.clientes
  where id = v.cliente_id
  for update;

  select * into v_escolha
  from public.solicitacoes_liberacao_financeira
  where cliente_id = v.cliente_id
    and status in ('pendente','em_analise','aprovada')
  order by created_at desc
  limit 1;

  if p_recebido then
    if v.previsao_cirurgia_confirmada_em is null then raise exception 'PREVISAO_NAO_CONFIRMADA'; end if;
    if v_escolha.id is null then raise exception 'FORMA_QUITACAO_NAO_ESCOLHIDA'; end if;
    if v.quitacao_status = 'paga' then return v; end if;

    v_total_final := round(coalesce(v_cliente.financeiro_saldo_restante,0),2);

    select coalesce(sum(valor),0), count(*)
    into v_aberto, v_count
    from public.boletos
    where cliente_id = v.cliente_id
      and status <> 'pago';

    if v_count = 0 and v_total_final > 0 then raise exception 'PARCELAS_ABERTAS_NAO_ENCONTRADAS'; end if;

    v_forma := case v_escolha.forma_custeio::text
      when 'cartao' then 'cartao'
      when 'pix' then 'pix'
      when 'cheques' then 'cheque'
      when 'boleto_100' then 'boleto'
      else 'outro'
    end;

    for v_boleto in
      select *
      from public.boletos
      where cliente_id = v.cliente_id
        and status <> 'pago'
      order by numero_parcela
      for update
    loop
      v_index := v_index + 1;
      if v_index = v_count then
        v_valor := round(v_total_final - v_alocado,2);
      elsif v_aberto > 0 then
        v_valor := round(v_total_final * (v_boleto.valor / v_aberto),2);
      else
        v_valor := 0;
      end if;
      v_alocado := v_alocado + v_valor;

      insert into public.financeiro_recebimentos(
        boleto_id,cliente_id,valor_original,valor_recebido,data_pagamento,
        forma_pagamento,origem,status_validacao,observacao,
        idempotency_key,criado_por,validado_por,validado_em
      ) values (
        v_boleto.id,v.cliente_id,v_boleto.valor,greatest(0,v_valor),(timezone('America/Sao_Paulo',now()))::date,
        v_forma,'manual','validado','Quitação integral confirmada na Liberação Financeira.',
        p_idempotency_key||':'||v_boleto.id::text,p_usuario,p_usuario,now()
      )
      on conflict (idempotency_key) do nothing;

      update public.boletos
      set status = 'pago',
          data_pagamento = (timezone('America/Sao_Paulo',now()))::date,
          observacoes = coalesce(observacoes,'') ||
            case when coalesce(observacoes,'')='' then '' else E'\n' end ||
            'Quitação integral confirmada na Liberação Financeira.',
          updated_at = now()
      where id = v_boleto.id;
    end loop;

    update public.agendamentos
    set quitacao_status = 'paga',
        quitacao_em = now(),
        quitacao_metodo = v_escolha.forma_custeio::text,
        updated_at = now()
    where id = p_agendamento_id
    returning * into v;

    update public.clientes
    set custeio_confirmado_em = coalesce(custeio_confirmado_em,now()),
        status_financeiro = 'pago',
        updated_at = now()
    where id = v.cliente_id;

    perform public.agenda_tentar_liberar_cirurgia(p_agendamento_id,p_usuario);

    insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
    values (
      p_usuario,'confirmou_quitacao_saldo','agendamentos',p_agendamento_id,
      jsonb_build_object(
        'cliente_id',v.cliente_id,
        'valor_recebido',v_total_final,
        'forma',v_escolha.forma_custeio,
        'parcelas_liquidadas',v_count
      )
    );
  else
    if v.quitacao_status = 'paga' then raise exception 'QUITACAO_JA_CONFIRMADA'; end if;

    update public.agendamentos
    set quitacao_status = 'nao_realizada',
        quitacao_em = now(),
        quitacao_metodo = coalesce(v_escolha.forma_custeio::text,quitacao_metodo),
        status = 'cancelado',
        agenda_cirurgica_liberada_em = null,
        updated_at = now()
    where id = p_agendamento_id
    returning * into v;

    update public.solicitacoes_liberacao_financeira
    set agendamento_id = null, updated_at = now()
    where agendamento_id = p_agendamento_id;

    insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
    values (
      p_usuario,'registrou_pagamento_nao_realizado','agendamentos',p_agendamento_id,
      jsonb_build_object('cliente_id',v.cliente_id,'retorno','etapa_4','vaga_liberada',true)
    );
  end if;

  return v;
end;
$$;

-- Reserva final da cirurgia: capacidade real + corte individual da previsão.
create or replace function public.agenda_reservar_cirurgia(
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
  v public.agendamentos%rowtype;
  v_data public.datas_liberacao_financeira%rowtype;
  v_horario time;
  v_ocupadas integer;
begin
  begin
    v_horario := p_horario::time;
  exception when others then
    raise exception 'HORARIO_INVALIDO';
  end;

  if p_horario not in ('08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00') then
    raise exception 'HORARIO_INVALIDO';
  end if;

  select * into v
  from public.agendamentos
  where cliente_id = p_cliente_id
    and status in ('confirmado','realizado')
    and agenda_cirurgica_liberada_em is not null
    and data_cirurgia is null
  order by created_at desc
  limit 1
  for update;

  if not found then raise exception 'AGENDA_CIRURGICA_NAO_LIBERADA'; end if;
  if v.previsao_cirurgia is null or p_data < v.previsao_cirurgia then raise exception 'ANTES_DA_PREVISAO'; end if;
  if p_data < (timezone('America/Sao_Paulo',now()))::date then raise exception 'DATA_PASSADA'; end if;

  select * into v_data
  from public.datas_liberacao_financeira
  where data = p_data
  for update;

  if not found
    or v_data.status <> 'disponivel'
    or coalesce(v_data.fechamento_manual,false)
    or v_data.vagas_totais <= 0 then
    raise exception 'DATA_CIRURGIA_INDISPONIVEL';
  end if;

  select count(*)::integer into v_ocupadas
  from public.agendamentos
  where data_cirurgia = p_data
    and status in ('confirmado','realizado')
    and id <> v.id;

  if v_ocupadas >= v_data.vagas_totais then raise exception 'VAGAS_ESGOTADAS'; end if;

  if exists (
    select 1 from public.agendamentos
    where data_cirurgia = p_data
      and horario_cirurgia = v_horario
      and status in ('confirmado','realizado')
      and id <> v.id
  ) then
    raise exception 'HORARIO_OCUPADO';
  end if;

  update public.agendamentos
  set data_cirurgia = p_data,
      horario_cirurgia = v_horario,
      cirurgia_escolhida_em = now(),
      updated_at = now()
  where id = v.id;

  update public.clientes
  set status_cirurgia = 'agendada',
      updated_at = now()
  where id = p_cliente_id;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (
    coalesce(p_usuario,'cliente:'||p_cliente_id::text),
    'escolheu_cirurgia_no_app',
    'agendamentos',
    v.id,
    jsonb_build_object('cliente_id',p_cliente_id,'data',p_data,'horario',p_horario)
  );

  return v.id;
end;
$$;

revoke all on function public.agenda_confirmar_levantamento(uuid,numeric,text[],text) from public, anon, authenticated;
revoke all on function public.agendar_data(uuid,uuid,numeric,text) from public, anon, authenticated;
revoke all on function public.agenda_comprometimento_mes(date,uuid) from public, anon, authenticated;
revoke all on function public.agenda_confirmar_previsao(uuid,date,text) from public, anon, authenticated;
revoke all on function public.agenda_tentar_liberar_cirurgia(uuid,text) from public, anon, authenticated;
revoke all on function public.agenda_registrar_comparecimento(uuid,boolean,text) from public, anon, authenticated;
revoke all on function public.agenda_registrar_quitacao(uuid,boolean,text,text) from public, anon, authenticated;
revoke all on function public.agenda_reservar_cirurgia(uuid,date,text,text) from public, anon, authenticated;

grant execute on function public.agenda_confirmar_levantamento(uuid,numeric,text[],text) to service_role;
grant execute on function public.agendar_data(uuid,uuid,numeric,text) to service_role;
grant execute on function public.agenda_comprometimento_mes(date,uuid) to service_role;
grant execute on function public.agenda_confirmar_previsao(uuid,date,text) to service_role;
grant execute on function public.agenda_tentar_liberar_cirurgia(uuid,text) to service_role;
grant execute on function public.agenda_registrar_comparecimento(uuid,boolean,text) to service_role;
grant execute on function public.agenda_registrar_quitacao(uuid,boolean,text,text) to service_role;
grant execute on function public.agenda_reservar_cirurgia(uuid,date,text,text) to service_role;

comment on column public.agendamentos.previsao_cirurgia is
  'Previsão operacional confirmada pelo Admin. Sugestão inicial = termos + 90 dias, mas não é bloqueio rígido.';
comment on column public.agendamentos.agenda_cirurgica_liberada_em is
  'Persistido somente quando previsão confirmada AND comparecimento confirmado AND quitação paga.';
comment on column public.agendamentos.data_cirurgia is
  'Data final escolhida pela cliente no app; prevalece sobre a previsão no comprometimento mensal.';
