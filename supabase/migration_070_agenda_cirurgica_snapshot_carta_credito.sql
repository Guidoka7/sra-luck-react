-- ============================================================================
-- migration_070_agenda_cirurgica_snapshot_carta_credito.sql
--
-- Risco identificado em QA (achado do snapshot da carta): agenda_comprometimento_mes
-- lê clientes.valor_contrato AO VIVO. Editar a carta de crédito de uma cliente
-- depois que um mês já tinha previsão/reserva confirmada muda retroativamente
-- o comprometimento daquele mês, sem passar por nenhum gate (o teto só é
-- checado dentro de agenda_confirmar_previsao/agenda_reservar_cirurgia, nunca
-- num UPDATE clientes). Não é um jeito de estourar o teto numa gravação nova
-- (toda nova escrita revalida na hora), mas é inconsistência de leitura/
-- exibição e pode bloquear indevidamente uma cliente diferente no mesmo mês.
--
-- Correção: congelar o valor da carta de crédito (clientes.valor_contrato —
-- nunca custo_total/taxa administrativa/valor calculado) no momento em que o
-- agendamento passa a comprometer um mês, dentro da mesma transação já
-- protegida pelo advisory lock do teto. Nenhuma regra de negócio muda: mesmo
-- teto de R$100.000, mesma elegibilidade, mesmos 5 dias úteis, mesma
-- concorrência — só a FONTE do valor somado por mês deixa de ser "live" para
-- ser o snapshot gravado no compromisso.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Coluna nova, aditiva. Nula por padrão: linhas que nunca comprometeram
--    mês nenhum (sem previsão/reserva confirmada) não precisam de snapshot.
-- ----------------------------------------------------------------------------
alter table public.agendamentos
  add column if not exists valor_contrato_comprometido numeric(12,2);

comment on column public.agendamentos.valor_contrato_comprometido is
  'V46: snapshot de clientes.valor_contrato (carta de crédito) capturado dentro de agenda_confirmar_previsao/agenda_reservar_cirurgia, no momento em que este agendamento passa a comprometer o teto mensal de R$100.000. Fonte de verdade de agenda_comprometimento_mes para linhas com snapshot; editar clientes.valor_contrato depois não altera este valor.';

-- ----------------------------------------------------------------------------
-- 2) Backfill único: agendamentos que já comprometem algum mês (mesmo filtro
--    usado por agenda_comprometimento_mes) mas ainda não têm snapshot. Não
--    existe valor histórico melhor disponível, então o backfill usa o valor
--    ATUAL da carta — o mesmo número que agenda_comprometimento_mes já vinha
--    somando para essas linhas até agora, então não muda nenhum total hoje.
--    Não toca data, status, cliente ou boleto nenhum.
-- ----------------------------------------------------------------------------
update public.agendamentos a
set valor_contrato_comprometido = c.valor_contrato
from public.clientes c
where c.id = a.cliente_id
  and a.valor_contrato_comprometido is null
  and a.status in ('confirmado','realizado')
  and (a.data_cirurgia is not null or a.previsao_cirurgia_confirmada_em is not null);

-- ----------------------------------------------------------------------------
-- 3) agenda_comprometimento_mes: soma coalesce(snapshot, carta ao vivo) em
--    vez de sempre a carta ao vivo. O fallback só é exercido por linhas que
--    por algum motivo ficarem sem snapshot (não deveria acontecer após o
--    backfill acima + os dois pontos de escrita abaixo, mas evita reviver o
--    bug antigo por omissão em vez de travar duro). Mesmos parâmetros, mesma
--    assinatura, mesmo filtro de status/mês — só a coluna somada muda.
-- ----------------------------------------------------------------------------
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
      coalesce(a.valor_contrato_comprometido, c.valor_contrato) as valor_comprometido,
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
      cliente_id, valor_comprometido, data_compromisso
    from candidatos
    where data_compromisso is not null
    order by cliente_id, final desc, marco desc
  )
  select coalesce(sum(valor_comprometido),0)::numeric
  from unicos
  where date_trunc('month',data_compromisso)::date = date_trunc('month',p_mes)::date;
$$;

revoke all on function public.agenda_comprometimento_mes(date, uuid) from public, anon, authenticated;
grant execute on function public.agenda_comprometimento_mes(date, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 4) agenda_confirmar_previsao: grava o snapshot na mesma UPDATE que já
--    confirma a previsão, dentro da mesma transação protegida pelo advisory
--    lock do teto (nenhuma mudança de validação/ordem/exceções). v_credito já
--    era buscado direto do banco (nunca do frontend) — só passa a ser
--    persistido, não só usado para o cálculo do momento.
-- ----------------------------------------------------------------------------
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
  if v_projecao > 100000 then raise exception 'TETO_MENSAL_EXCEDIDO'; end if;

  -- Reagendamento (nova chamada com p_previsao em outro mês): o mês anterior
  -- deixa de contar sozinho, porque agenda_comprometimento_mes lê o valor
  -- ATUAL de previsao_cirurgia desta mesma linha — não há linha duplicada
  -- para "liberar". O snapshot é recapturado agora, com a carta atual neste
  -- exato momento (nunca a de uma chamada anterior), igual a uma previsão
  -- nova; só não muda mais sozinho depois disso por edição de clientes.valor_contrato.
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
      'comprometido_antes',v_atual,'projecao',v_projecao,'teto',100000
    )
  );

  return v_agendamento;
end;
$$;

revoke all on function public.agenda_confirmar_previsao(uuid, date, text) from public, anon, authenticated;
grant execute on function public.agenda_confirmar_previsao(uuid, date, text) to service_role;

-- ----------------------------------------------------------------------------
-- 5) agenda_reservar_cirurgia: mesma lógica, snapshot gravado junto com
--    data_cirurgia/horario_cirurgia/cirurgia_escolhida_em, dentro da mesma
--    transação protegida pelo mesmo advisory lock. Este é o compromisso final
--    (data_cirurgia tem prioridade sobre previsao_cirurgia em
--    agenda_comprometimento_mes), então o snapshot aqui passa a valer para o
--    mês final escolhido, com a carta atual neste momento.
-- ----------------------------------------------------------------------------
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
  if v_comprometido + v_credito > 100000 then raise exception 'TETO_MENSAL_EXCEDIDO'; end if;

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

revoke all on function public.agenda_reservar_cirurgia(uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.agenda_reservar_cirurgia(uuid, date, text, text) to service_role;
