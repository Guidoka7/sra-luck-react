-- ============================================================================
-- MIGRATION 094: Regras operacionais configuráveis (somente pelo Dev)
-- ============================================================================
-- Fonte única das regras que o painel mostra com cadeado em Configurações >
-- Gerais. O Admin só lê; a alteração entra exclusivamente pelo Dev Console
-- (POST /api/admin/regras-operacionais, sessão técnica owner/developer),
-- sempre auditada em logs_alteracoes.
--
-- Passam a ler desta tabela (antes eram constantes):
--   * calcular_prazo_cirurgico_v46  → prazo_liberacao_dias_uteis (antes 5)
--   * pode_agendar                  → percentuais por plano (antes 60/70/80)
--   * agenda_confirmar_previsao e agenda_reservar_cirurgia → teto_mensal_operacional (antes 100000)
-- Os valores iniciais são exatamente os de antes: nada muda até o Dev alterar.
--
-- Rollback: reaplicar as quatro funções com as constantes (5, 60/70/80, 100000)
-- e remover a tabela.

create table if not exists public.regras_operacionais (
  id smallint primary key default 1 check (id = 1),
  prazo_liberacao_dias_uteis integer not null default 5 check (prazo_liberacao_dias_uteis between 1 and 30),
  teto_mensal_operacional numeric(14,2) not null default 100000 check (teto_mensal_operacional > 0 and teto_mensal_operacional <= 100000000),
  percentual_12_24x numeric(5,2) not null default 60 check (percentual_12_24x > 0 and percentual_12_24x <= 100),
  percentual_36x numeric(5,2) not null default 70 check (percentual_36x > 0 and percentual_36x <= 100),
  percentual_48_72x numeric(5,2) not null default 80 check (percentual_48_72x > 0 and percentual_48_72x <= 100),
  app_exige_parcela boolean not null default true,
  app_exige_procedimento boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.regras_operacionais enable row level security;
insert into public.regras_operacionais (id) values (1) on conflict (id) do nothing;

create or replace function public.calcular_prazo_cirurgico_v46(p_comparecimento_em timestamp with time zone, p_quitacao_em timestamp with time zone, p_dias_ajuste integer default 0)
returns date
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_base date;
  v_prazo integer;
begin
  if p_comparecimento_em is null or p_quitacao_em is null then
    return null;
  end if;
  select coalesce((select prazo_liberacao_dias_uteis from public.regras_operacionais where id = 1), 5) into v_prazo;
  v_base := greatest(
    (timezone('America/Sao_Paulo', p_comparecimento_em))::date,
    (timezone('America/Sao_Paulo', p_quitacao_em))::date
  );
  return public.adicionar_dias_uteis(v_base, v_prazo + greatest(0, coalesce(p_dias_ajuste, 0)));
end;
$$;

create or replace function public.pode_agendar(p_cliente_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select
    exists(select 1 from public.clientes c where c.id = p_cliente_id)
    and exists(select 1 from public.boletos b where b.cliente_id = p_cliente_id)
    and public.porcentagem_pagamento(p_cliente_id) >= coalesce(
      (select c.percentual_minimo_agendar from public.clientes c where c.id = p_cliente_id),
      (select case
        when c.quantidade_parcelas in (12, 18, 24) then coalesce(r.percentual_12_24x, 60)
        when c.quantidade_parcelas = 36 then coalesce(r.percentual_36x, 70)
        else coalesce(r.percentual_48_72x, 80)
      end
      from public.clientes c
      left join public.regras_operacionais r on r.id = 1
      where c.id = p_cliente_id)
    );
$$;

create or replace function public.teto_mensal_operacional()
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce((select teto_mensal_operacional from public.regras_operacionais where id = 1), 100000)::numeric;
$$;

create or replace function public.agenda_confirmar_previsao(p_agendamento_id uuid, p_previsao date, p_usuario text)
returns agendamentos
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agendamento public.agendamentos%rowtype;
  v_data_termos date;
  v_credito numeric(12,2);
  v_atual numeric;
  v_projecao numeric;
  v_teto numeric := public.teto_mensal_operacional();
  v_hoje date := (timezone('America/Sao_Paulo',now()))::date;
begin
  select a.* into v_agendamento
  from public.agendamentos a
  where a.id = p_agendamento_id
    and a.status in ('confirmado','realizado')
  for update;

  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  select d.data into v_data_termos
  from public.datas d
  where d.id = v_agendamento.data_id;

  if v_data_termos is null then raise exception 'DATA_TERMOS_NAO_ENCONTRADA'; end if;
  if p_previsao is null or p_previsao < v_data_termos or p_previsao < v_hoje then
    raise exception 'PREVISAO_INVALIDA';
  end if;

  select coalesce(valor_contrato,0)::numeric(12,2) into v_credito
  from public.clientes
  where id = v_agendamento.cliente_id;

  -- V46 §16: advisory lock por mês antes de somar o comprometido, para que
  -- duas confirmações concorrentes no mesmo mês não ultrapassem o teto.
  perform pg_advisory_xact_lock(hashtextextended('agenda-cirurgica-financeiro:' || to_char(p_previsao, 'YYYY-MM'), 0));

  v_atual := public.agenda_comprometimento_mes(p_previsao, v_agendamento.cliente_id);
  v_projecao := v_atual + v_credito;
  if v_projecao > v_teto then raise exception 'TETO_MENSAL_EXCEDIDO'; end if;

  update public.agendamentos
  set previsao_cirurgia = p_previsao,
      previsao_cirurgia_confirmada_em = now(),
      previsao_cirurgia_confirmada_por = p_usuario,
      valor_contrato_comprometido = v_credito,
      updated_at = now()
  where id = p_agendamento_id
  returning * into v_agendamento;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (
    p_usuario,'confirmou_previsao_cirurgia','agendamentos',p_agendamento_id,
    jsonb_build_object(
      'cliente_id',v_agendamento.cliente_id,'previsao',p_previsao,'carta_credito',v_credito,
      'comprometido_antes',v_atual,'projecao',v_projecao,'teto',v_teto
    )
  );

  return v_agendamento;
end;
$$;

create or replace function public.agenda_reservar_cirurgia(p_cliente_id uuid, p_data date, p_horario text, p_usuario text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v public.agendamentos%rowtype;
  v_data public.datas_liberacao_financeira%rowtype;
  v_horario time;
  v_ocupadas integer;
  v_credito numeric(12,2);
  v_comprometido numeric;
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

  select * into v_data from public.datas_liberacao_financeira where data = p_data for update;
  if not found or v_data.status <> 'disponivel' or coalesce(v_data.fechamento_manual,false) or v_data.vagas_totais <= 0 then
    raise exception 'DATA_CIRURGIA_INDISPONIVEL';
  end if;

  select count(*)::integer into v_ocupadas
  from public.agendamentos
  where data_cirurgia = p_data and status in ('confirmado','realizado') and id <> v.id;
  if v_ocupadas >= v_data.vagas_totais then raise exception 'VAGAS_ESGOTADAS'; end if;

  if exists (
    select 1 from public.agendamentos
    where data_cirurgia = p_data and horario_cirurgia = v_horario and status in ('confirmado','realizado') and id <> v.id
  ) then
    raise exception 'HORARIO_OCUPADO';
  end if;

  select coalesce(valor_contrato,0)::numeric(12,2) into v_credito from public.clientes where id = p_cliente_id;
  perform pg_advisory_xact_lock(hashtextextended('agenda-cirurgica-financeiro:' || to_char(p_data, 'YYYY-MM'), 0));
  v_comprometido := public.agenda_comprometimento_mes(p_data, p_cliente_id);
  if v_comprometido + v_credito > public.teto_mensal_operacional() then raise exception 'TETO_MENSAL_EXCEDIDO'; end if;

  update public.agendamentos
  set data_cirurgia = p_data, horario_cirurgia = v_horario, cirurgia_escolhida_em = now(),
      valor_contrato_comprometido = v_credito, updated_at = now()
  where id = v.id;

  update public.clientes set status_cirurgia = 'agendada', updated_at = now() where id = p_cliente_id;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (
    coalesce(p_usuario,'cliente:'||p_cliente_id::text),'escolheu_cirurgia_no_app','agendamentos',v.id,
    jsonb_build_object('cliente_id',p_cliente_id,'data',p_data,'horario',p_horario)
  );

  return v.id;
end;
$$;
