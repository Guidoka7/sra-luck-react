-- ============================================================================
-- migration_064_agenda_v46_regras_definitivas.sql
--
-- Reconciliação: as migrations 052-063 (branch feat/cliente-detail-drawer,
-- não commitadas em main mas JÁ APLICADAS no banco real) implementaram uma
-- "Agenda operacional definitiva" completa (agendar_data, agenda_confirmar_
-- levantamento, agenda_confirmar_previsao, agenda_registrar_comparecimento,
-- agenda_registrar_quitacao, agenda_tentar_liberar_cirurgia,
-- agenda_reservar_cirurgia, agenda_liberada, pode_agendar/porcentagem_
-- pagamento) com auditoria "quem" (comparecimento_registrado_por, previsao_
-- cirurgia_confirmada_por), advisory-safe onde já existia, e reaproveitando
-- clientes/boletos/datas/agendamentos/datas_liberacao_financeira/
-- solicitacoes_liberacao_financeira/financeiro_recebimentos/logs_alteracoes
-- como as ÚNICAS fontes de verdade. Esta migration NÃO recria nada disso.
--
-- Duas regras dessa linhagem divergem do handoff V46 (fonte de verdade do
-- produto) e são substituídas aqui, SEM editar as migrations 060/061
-- históricas:
--
--   1) Elegibilidade: migration_060/061 fixaram pode_agendar() em 70% fixo
--      via percentual_minimo_fluxo_agenda(). O V46 pede a tabela por
--      quantidade de parcelas (12/18/24→60%, 36→70%, 48/60/72→80%) — que
--      por acaso é EXATAMENTE o que clientes.percentual_minimo_agendar já
--      armazena por cliente (migration_055/059), só que órfão desde a
--      migration_060 passou a ignorá-lo. Aqui pode_agendar() volta a ler
--      esse campo (com fallback tiered), sem apagar percentual_minimo_
--      fluxo_agenda() (fica sem uso, preservada por histórico).
--
--   2) Liberação da agenda cirúrgica: migration_060's agenda_tentar_liberar_
--      cirurgia() libera IMEDIATAMENTE quando previsão confirmada AND
--      comparecimento AND quitação — sem qualquer espera. O V46 exige
--      exatamente 5 dias úteis entre (comparecimento + quitação, o que
--      vier depois) e a liberação, com extensão manual (+1/+3/+5 dias
--      úteis) e liberação manual antecipada. Reescrita abaixo.
--
-- "Previsão cirúrgica" (agenda_confirmar_previsao) É MANTIDA como pré-
-- requisito real: agenda_registrar_comparecimento (migration_060, não
-- alterada aqui) já exige previsao_cirurgia_confirmada_em antes de aceitar
-- comparecimento, e agenda_reservar_cirurgia exige previsao_cirurgia como
-- piso da data final. Isso significa que, na prática, "confirmar previsão"
-- continua sendo um passo administrativo real e anterior ao comparecimento
-- — não um resquício a remover, e não algo que esta migration precisa
-- ocultar ou automatizar: a Central V46 deve expor essa ação (com o teto
-- já protegido dentro de agenda_confirmar_previsao) antes de comparecimento
-- e quitação ficarem disponíveis para aquele agendamento.
--
-- Nenhuma regra de 90 dias corridos é usada por este runtime: essa string
-- só aparece em comentário de coluna (sugestão de UI, não trava). A
-- migration_039 (90 dias) pertence a uma linhagem paralela (agendar_
-- cirurgia_data / previsao_liberacao_financeira) que o handoff V46 não usa
-- e que esta migration não toca.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Colunas novas (nenhum equivalente real encontrado por introspecção).
-- ----------------------------------------------------------------------------
alter table public.agendamentos
  add column if not exists termos_responsavel text,
  add column if not exists agenda_cirurgica_liberada_manualmente boolean not null default false,
  add column if not exists agenda_cirurgica_liberada_por text,
  add column if not exists agenda_cirurgica_prazo_ajuste_dias integer not null default 0,
  add column if not exists pagamento_cirurgia_confirmado_em timestamptz,
  add column if not exists pagamento_cirurgia_confirmado_por text,
  add column if not exists processo_concluido_em timestamptz;

do $$ begin
  alter table public.agendamentos
    add constraint agendamentos_prazo_ajuste_check
    check (agenda_cirurgica_prazo_ajuste_dias >= 0);
exception when duplicate_object then null; end $$;

create index if not exists idx_agendamentos_processo_concluido
  on public.agendamentos (processo_concluido_em);

-- clientes.status_revisao_financeira/data_atingiu_percentual (migration_061)
-- são conceitos DIFERENTES da solicitação da cliente: eles também mudam via
-- o fluxo de reenvio após "recusada" (worker/client-boletos.ts) e refletem
-- o julgamento do ADMIN sobre o levantamento, não o clique da cliente. Usar
-- um deles como proxy de "solicitou" quebraria se qualquer outro caminho
-- tocar essas colunas no futuro. A solicitação precisa da sua própria
-- coluna, gravada por uma única RPC.
alter table public.clientes
  add column if not exists liberacao_financeira_solicitada_em timestamptz;

create index if not exists idx_clientes_liberacao_financeira_solicitada
  on public.clientes (liberacao_financeira_solicitada_em);

-- ----------------------------------------------------------------------------
-- 2) Elegibilidade V46 (tiers por quantidade de parcelas), reaproveitando
--    clientes.percentual_minimo_agendar já populado por cliente.
-- ----------------------------------------------------------------------------
create or replace function public.pode_agendar(p_cliente_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    exists(select 1 from public.clientes c where c.id = p_cliente_id)
    and exists(select 1 from public.boletos b where b.cliente_id = p_cliente_id)
    and public.porcentagem_pagamento(p_cliente_id) >= coalesce(
      (select c.percentual_minimo_agendar from public.clientes c where c.id = p_cliente_id),
      (select case
        when c.quantidade_parcelas in (12, 18, 24) then 60
        when c.quantidade_parcelas = 36 then 70
        else 80
      end from public.clientes c where c.id = p_cliente_id)
    );
$$;

revoke all on function public.pode_agendar(uuid) from public, anon, authenticated;
grant execute on function public.pode_agendar(uuid) to service_role;

comment on function public.pode_agendar(uuid) is
  'V46: elegibilidade por tabela de parcelamento (12/18/24x=60%, 36x=70%, 48/60/72x=80%), lida de clientes.percentual_minimo_agendar (fallback tiered). Substitui o 70% fixo de migration_061.';

-- ----------------------------------------------------------------------------
-- 3) Etapa 1 -> 2: solicitação explícita da cliente. Atingir o percentual
--    NÃO move sozinha para Levantamentos; só esta chamada move. Fonte de
--    verdade é clientes.liberacao_financeira_solicitada_em (dedicada, não
--    compartilhada com status_revisao_financeira/data_atingiu_percentual —
--    ver comentário acima da coluna). Elegibilidade é revalidada aqui no
--    servidor, nunca confiando em estado enviado pelo cliente. Idempotente
--    e concorrência-segura via `for update`: de duas chamadas simultâneas,
--    a segunda encontra a coluna já preenchida e não grava nada — sem
--    timestamp conflitante, sem log duplicado.
-- ----------------------------------------------------------------------------
create or replace function public.cliente_solicitar_liberacao_financeira(
  p_cliente_id uuid
)
returns public.clientes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente public.clientes%rowtype;
begin
  select * into v_cliente from public.clientes where id = p_cliente_id for update;
  if not found then raise exception 'CLIENTE_NAO_ENCONTRADA'; end if;

  if not public.pode_agendar(p_cliente_id) then
    raise exception 'PERCENTUAL_MINIMO_NAO_ATINGIDO';
  end if;

  if v_cliente.liberacao_financeira_solicitada_em is null then
    update public.clientes
    set liberacao_financeira_solicitada_em = now(),
        data_atingiu_percentual = coalesce(data_atingiu_percentual, now()),
        updated_at = now()
    where id = p_cliente_id
    returning * into v_cliente;

    insert into public.logs_alteracoes(usuario, acao, entidade, entidade_id, detalhes)
    values (
      'cliente:' || p_cliente_id::text,
      'solicitou_liberacao_financeira_etapa1',
      'clientes',
      p_cliente_id,
      jsonb_build_object('liberacao_financeira_solicitada_em', v_cliente.liberacao_financeira_solicitada_em)
    );
  end if;

  return v_cliente;
end;
$$;

revoke all on function public.cliente_solicitar_liberacao_financeira(uuid) from public, anon, authenticated;
grant execute on function public.cliente_solicitar_liberacao_financeira(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 4) Prazo de 5 dias úteis (V46), reaproveitando adicionar_dias_uteis já
--    existente (migration_028, nunca removida).
-- ----------------------------------------------------------------------------
create or replace function public.calcular_prazo_cirurgico_v46(
  p_comparecimento_em timestamptz,
  p_quitacao_em timestamptz,
  p_dias_ajuste integer default 0
)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  v_base date;
begin
  if p_comparecimento_em is null or p_quitacao_em is null then
    return null;
  end if;
  v_base := greatest(
    (timezone('America/Sao_Paulo', p_comparecimento_em))::date,
    (timezone('America/Sao_Paulo', p_quitacao_em))::date
  );
  return public.adicionar_dias_uteis(v_base, 5 + greatest(0, coalesce(p_dias_ajuste, 0)));
end;
$$;

revoke all on function public.calcular_prazo_cirurgico_v46(timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.calcular_prazo_cirurgico_v46(timestamptz, timestamptz, integer) to service_role;

-- ----------------------------------------------------------------------------
-- 5) agenda_confirmar_previsao: mesma lógica de migration_060, com advisory
--    lock por mês antes de somar o comprometido (V46 §16: validação
--    concorrência-safe na mesma transação). Nenhuma outra regra muda.
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
-- 6) agenda_tentar_liberar_cirurgia: REGRA NOVA. Substitui a liberação
--    imediata de migration_060 por comparecimento + quitação -> 5 dias
--    úteis. Não precisa confirmar previsão aqui: agenda_registrar_
--    comparecimento já exige previsao_cirurgia_confirmada_em como pré-
--    requisito (migration_060), então ao chegar aqui com comparecimento_
--    status='compareceu' a previsão (e seu teto) já foram confirmados
--    antes — essa ordem não muda, só a espera adicional dos 5 dias úteis.
-- ----------------------------------------------------------------------------
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
  v_prazo date;
  v_hoje date := (timezone('America/Sao_Paulo',now()))::date;
begin
  select * into v from public.agendamentos where id = p_agendamento_id for update;
  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  if v.status not in ('confirmado','realizado')
    or v.comparecimento_status <> 'compareceu'
    or v.quitacao_status <> 'paga' then
    return false;
  end if;

  if v.agenda_cirurgica_liberada_em is not null then
    return true; -- idempotente: já liberada (manual ou automática).
  end if;

  v_prazo := public.calcular_prazo_cirurgico_v46(v.comparecimento_em, v.quitacao_em, v.agenda_cirurgica_prazo_ajuste_dias);
  if v_prazo is null or v_hoje < v_prazo then
    return false; -- prazo de 5 dias úteis ainda não atingido.
  end if;

  update public.agendamentos
  set agenda_cirurgica_liberada_em = now(),
      updated_at = now()
  where id = p_agendamento_id;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (
    coalesce(p_usuario,'sistema'),'liberou_agenda_cirurgica','agendamentos',p_agendamento_id,
    jsonb_build_object('cliente_id',v.cliente_id,'prazo_calculado',v_prazo,'manual',false)
  );

  return true;
end;
$$;

revoke all on function public.agenda_tentar_liberar_cirurgia(uuid, text) from public, anon, authenticated;
grant execute on function public.agenda_tentar_liberar_cirurgia(uuid, text) to service_role;

comment on function public.agenda_tentar_liberar_cirurgia(uuid, text) is
  'V46: libera a agenda cirurgica 5 dias uteis apos comparecimento+quitacao (nao mais imediatamente). Idempotente; chamar novamente ate retornar true.';

-- ----------------------------------------------------------------------------
-- 7) Ajuste manual do prazo (+1/+3/+5 dias uteis) e liberacao manual
--    antecipada. Auditam quem/quando/prazo antigo/prazo novo.
-- ----------------------------------------------------------------------------
create or replace function public.agenda_cirurgica_ajustar_prazo(
  p_agendamento_id uuid,
  p_dias_uteis integer,
  p_usuario text
)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.agendamentos%rowtype;
  v_prazo_antigo date;
  v_prazo_novo date;
begin
  if p_dias_uteis not in (1,3,5) then
    raise exception 'AJUSTE_PRAZO_INVALIDO';
  end if;

  select * into v from public.agendamentos where id = p_agendamento_id for update;
  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  v_prazo_antigo := public.calcular_prazo_cirurgico_v46(v.comparecimento_em, v.quitacao_em, v.agenda_cirurgica_prazo_ajuste_dias);

  update public.agendamentos
  set agenda_cirurgica_prazo_ajuste_dias = coalesce(agenda_cirurgica_prazo_ajuste_dias,0) + p_dias_uteis,
      updated_at = now()
  where id = p_agendamento_id
  returning * into v;

  v_prazo_novo := public.calcular_prazo_cirurgico_v46(v.comparecimento_em, v.quitacao_em, v.agenda_cirurgica_prazo_ajuste_dias);

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (
    coalesce(p_usuario,'admin'),'ajustou_prazo_cirurgico','agendamentos',p_agendamento_id,
    jsonb_build_object('cliente_id',v.cliente_id,'dias_uteis_adicionados',p_dias_uteis,'prazo_antigo',v_prazo_antigo,'prazo_novo',v_prazo_novo)
  );

  return v_prazo_novo;
end;
$$;

revoke all on function public.agenda_cirurgica_ajustar_prazo(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.agenda_cirurgica_ajustar_prazo(uuid, integer, text) to service_role;

create or replace function public.agenda_cirurgica_liberar_manual(
  p_agendamento_id uuid,
  p_usuario text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.agendamentos%rowtype;
begin
  select * into v from public.agendamentos where id = p_agendamento_id for update;
  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  if v.status not in ('confirmado','realizado') or v.comparecimento_status <> 'compareceu' or v.quitacao_status <> 'paga' then
    raise exception 'CONDICOES_NAO_ATENDIDAS';
  end if;

  if v.agenda_cirurgica_liberada_em is not null then
    return; -- idempotente.
  end if;

  update public.agendamentos
  set agenda_cirurgica_liberada_em = now(),
      agenda_cirurgica_liberada_manualmente = true,
      agenda_cirurgica_liberada_por = p_usuario,
      updated_at = now()
  where id = p_agendamento_id;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (coalesce(p_usuario,'admin'),'liberou_agenda_cirurgica','agendamentos',p_agendamento_id,jsonb_build_object('cliente_id',v.cliente_id,'manual',true));
end;
$$;

revoke all on function public.agenda_cirurgica_liberar_manual(uuid, text) from public, anon, authenticated;
grant execute on function public.agenda_cirurgica_liberar_manual(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 8) Responsável administrativo dos termos (não médico/cirurgião).
-- ----------------------------------------------------------------------------
create or replace function public.agenda_definir_responsavel_termos(
  p_agendamento_id uuid,
  p_responsavel text,
  p_usuario text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
begin
  update public.agendamentos
  set termos_responsavel = nullif(btrim(coalesce(p_responsavel,'')), ''),
      updated_at = now()
  where id = p_agendamento_id
  returning cliente_id into v_cliente_id;

  if v_cliente_id is null then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (coalesce(p_usuario,'admin'),'definiu_responsavel_termos','agendamentos',p_agendamento_id,jsonb_build_object('cliente_id',v_cliente_id,'responsavel',p_responsavel));
end;
$$;

revoke all on function public.agenda_definir_responsavel_termos(uuid, text, text) from public, anon, authenticated;
grant execute on function public.agenda_definir_responsavel_termos(uuid, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 9) Reagendar/devolver escolha de termos ao app: cancela o agendamento
--    confirmado atual (devolve a vaga), preserva historico, mantem a
--    solicitacao de custeio ja aprovada para a cliente reservar de novo.
--    Usa exatamente o mesmo mecanismo do "nao compareceu" de migration_060,
--    sem marcar comparecimento_status (nao e uma ausencia).
-- ----------------------------------------------------------------------------
create or replace function public.agenda_liberar_termos_para_nova_escolha(
  p_agendamento_id uuid,
  p_usuario text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.agendamentos%rowtype;
begin
  select * into v from public.agendamentos where id = p_agendamento_id and status = 'confirmado' for update;
  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  update public.agendamentos
  set status = 'cancelado', updated_at = now()
  where id = p_agendamento_id;

  update public.solicitacoes_liberacao_financeira
  set agendamento_id = null, updated_at = now()
  where agendamento_id = p_agendamento_id;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (
    coalesce(p_usuario,'admin'),'liberou_termos_para_nova_escolha','agendamentos',p_agendamento_id,
    jsonb_build_object('cliente_id',v.cliente_id,'data_liberada_id',v.data_id,'vaga_liberada',true)
  );
end;
$$;

revoke all on function public.agenda_liberar_termos_para_nova_escolha(uuid, text) from public, anon, authenticated;
grant execute on function public.agenda_liberar_termos_para_nova_escolha(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 10) Reagendar termos AGORA (admin escolhe nova data/horario imediatamente):
--     cancela o atual e reserva o novo. Reaproveita agendar_data (ja faz o
--     lock/capacidade/validacoes da nova data); nao e uma unica transacao
--     entre as duas chamadas, mas agendar_data revalida tudo de novo, entao
--     uma falha no segundo passo deixa a cliente sem agendamento (igual ao
--     caminho de ausencia) em vez de estado corrompido.
-- ----------------------------------------------------------------------------
create or replace function public.agenda_reagendar_termos_agora(
  p_agendamento_atual_id uuid,
  p_nova_data_id uuid,
  p_horario_termos text,
  p_usuario text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_responsavel text;
  v_valor_contrato numeric;
  v_novo_id uuid;
begin
  select cliente_id, termos_responsavel, valor_contrato
  into v_cliente_id, v_responsavel, v_valor_contrato
  from public.agendamentos
  where id = p_agendamento_atual_id and status = 'confirmado';

  if v_cliente_id is null then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  perform public.agenda_liberar_termos_para_nova_escolha(p_agendamento_atual_id, p_usuario);

  v_novo_id := public.agendar_data(v_cliente_id, p_nova_data_id, v_valor_contrato, p_horario_termos);

  if v_responsavel is not null then
    perform public.agenda_definir_responsavel_termos(v_novo_id, v_responsavel, p_usuario);
  end if;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (
    coalesce(p_usuario,'admin'),'reagendou_termos','agendamentos',v_novo_id,
    jsonb_build_object('cliente_id',v_cliente_id,'agendamento_anterior_id',p_agendamento_atual_id,'nova_data_id',p_nova_data_id,'novo_horario',p_horario_termos)
  );

  return v_novo_id;
end;
$$;

revoke all on function public.agenda_reagendar_termos_agora(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.agenda_reagendar_termos_agora(uuid, uuid, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 11) Pagamento final da cirurgia: conclui e arquiva o processo (sai das
--     filas operacionais, permanece na Agenda Cirurgica/mapa do mes).
-- ----------------------------------------------------------------------------
create or replace function public.agenda_confirmar_pagamento_cirurgia(
  p_agendamento_id uuid,
  p_usuario text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.agendamentos%rowtype;
begin
  select * into v from public.agendamentos where id = p_agendamento_id for update;
  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;
  if v.data_cirurgia is null then raise exception 'CIRURGIA_NAO_AGENDADA'; end if;
  if v.pagamento_cirurgia_confirmado_em is not null then return; end if;

  update public.agendamentos
  set pagamento_cirurgia_confirmado_em = now(),
      pagamento_cirurgia_confirmado_por = p_usuario,
      processo_concluido_em = now(),
      status = 'realizado',
      updated_at = now()
  where id = p_agendamento_id;

  update public.clientes
  set status_cirurgia = 'realizada', updated_at = now()
  where id = v.cliente_id;

  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (coalesce(p_usuario,'admin'),'confirmou_pagamento_cirurgia','agendamentos',p_agendamento_id,jsonb_build_object('cliente_id',v.cliente_id,'data_cirurgia',v.data_cirurgia));
end;
$$;

revoke all on function public.agenda_confirmar_pagamento_cirurgia(uuid, text) from public, anon, authenticated;
grant execute on function public.agenda_confirmar_pagamento_cirurgia(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 12) agenda_reservar_cirurgia: mesma logica de migration_060, com teto
--     mensal revalidado (advisory lock) NA MESMA TRANSACAO que grava a
--     data final — gap real da versao anterior (o teto so era checado na
--     previsao, nao na escolha final, que pode cair em outro mes).
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
  set data_cirurgia = p_data, horario_cirurgia = v_horario, cirurgia_escolhida_em = now(), updated_at = now()
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
