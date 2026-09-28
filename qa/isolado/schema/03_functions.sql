CREATE OR REPLACE FUNCTION public.adicionar_dias_corridos(p_data date, p_dias integer)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case when p_data is null then null else p_data + greatest(0, p_dias) end;
$function$
;

CREATE OR REPLACE FUNCTION public.adicionar_dias_uteis(p_data date, p_dias integer)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_central_snapshot(p_hoje date, p_limite integer DEFAULT 20, p_estagio text DEFAULT NULL::text, p_apos_nome text DEFAULT NULL::text, p_apos_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT public.loadtest_admin_central_snapshot(p_hoje,p_limite,p_estagio,p_apos_nome,p_apos_id);
$function$
;

CREATE OR REPLACE FUNCTION public.admin_clientes_bancos()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ SELECT public.loadtest_admin_clientes_bancos(); $function$
;

CREATE OR REPLACE FUNCTION public.admin_clientes_pagina(p_limite integer, p_cursor_created timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_busca text DEFAULT NULL::text, p_funil text DEFAULT 'cadastradas'::text, p_status text DEFAULT NULL::text, p_periodo_inicio timestamp with time zone DEFAULT NULL::timestamp with time zone, p_banco text DEFAULT NULL::text, p_sort text DEFAULT 'recent'::text, p_cursor_name text DEFAULT NULL::text)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT * FROM public.loadtest_admin_clientes_pagina(p_limite,p_cursor_created,p_cursor_id,p_busca,p_funil,p_status,p_periodo_inicio,p_banco,p_sort,p_cursor_name);
$function$
;

CREATE OR REPLACE FUNCTION public.admin_clientes_pagina_recent(p_limite integer, p_cursor_created timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_busca text DEFAULT NULL::text, p_funil text DEFAULT 'cadastradas'::text, p_status text DEFAULT NULL::text, p_periodo_inicio timestamp with time zone DEFAULT NULL::timestamp with time zone, p_banco text DEFAULT NULL::text, p_sort text DEFAULT 'recent'::text, p_cursor_name text DEFAULT NULL::text)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT * FROM public.loadtest_admin_clientes_pagina_recent(p_limite,p_cursor_created,p_cursor_id,p_busca,p_funil,p_status,p_periodo_inicio,p_banco,p_sort,p_cursor_name);
$function$
;

CREATE OR REPLACE FUNCTION public.admin_clientes_totais()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ SELECT public.loadtest_admin_clientes_totais(); $function$
;

CREATE OR REPLACE FUNCTION public.admin_dashboard_agenda(p_inicio date, p_fim date, p_hoje date, p_proximos_fim date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT public.loadtest_admin_dashboard_agenda(p_inicio,p_fim,p_hoje,p_proximos_fim);
$function$
;

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats(p_hoje date, p_inicio date, p_fim date, p_semana_inicio date, p_semana_fim date, p_grafico_inicio date, p_grafico_fim date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT public.loadtest_admin_dashboard_stats(p_hoje,p_inicio,p_fim,p_semana_inicio,p_semana_fim,p_grafico_inicio,p_grafico_fim);
$function$
;

CREATE OR REPLACE FUNCTION public.admin_excluir_colaborador_auditado(p_actor_auth_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor public.colaboradores%rowtype;
  v_alvo public.colaboradores%rowtype;
  v_historico jsonb;
begin
  select * into v_actor from public.colaboradores where auth_user_id = p_actor_auth_id and ativo = true for share;
  if v_actor.id is null or v_actor.cargo::text <> 'administrativo' then
    raise exception 'STAFF_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_alvo from public.colaboradores where id = p_id for update;
  if v_alvo.id is null then raise exception 'STAFF_NOT_FOUND'; end if;
  if v_alvo.auth_user_id = p_actor_auth_id then
    raise exception 'STAFF_SELF_DELETE' using errcode = '42501';
  end if;

  v_historico := jsonb_build_object(
    'comissoes', (select count(*) from public.comissoes where colaborador_id = p_id),
    'eventosComissao', (select count(*) from public.comissao_eventos where colaborador_id = p_id),
    'clientes', (select count(*) from public.clientes where vendedora_id = p_id),
    'vendas', (select count(*) from public.novas_vendas where vendedora_id = p_id),
    'agendamentos', (select count(*) from public.agendamentos where sdr_id = p_id)
  );
  if exists (select 1 from jsonb_each_text(v_historico) where value::int > 0) then
    raise exception 'STAFF_HAS_HISTORY' using detail = v_historico::text;
  end if;

  delete from public.colaboradores where id = p_id;
  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
    values(v_actor.id::text,'excluiu_colaborador','colaboradores',p_id,
      jsonb_build_object('nome',v_alvo.nome,'email',v_alvo.email,'cargo',v_alvo.cargo));
  return jsonb_build_object('auth_user_id', v_alvo.auth_user_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_forecast_page(p_limite integer DEFAULT 50, p_antes_criado timestamp with time zone DEFAULT NULL::timestamp with time zone, p_antes_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT public.loadtest_admin_forecast_page(p_limite,p_antes_criado,p_antes_id);
$function$
;

CREATE OR REPLACE FUNCTION public.admin_integration_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ SELECT public.loadtest_admin_integration_snapshot(); $function$
;

CREATE OR REPLACE FUNCTION public.admin_salvar_colaborador_auditado(p_actor_auth_id uuid, p_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor public.colaboradores%rowtype;
  v_old public.colaboradores%rowtype;
  v_new public.colaboradores%rowtype;
  v_permissions text[];
  v_fields text[];
begin
  select * into v_actor from public.colaboradores
    where auth_user_id = p_actor_auth_id and ativo = true for share;
  if v_actor.id is null
     or (v_actor.cargo::text <> 'administrativo' and not ('equipe.gerenciar' = any(v_actor.permissoes))) then
    raise exception 'STAFF_FORBIDDEN' using errcode = '42501';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'STAFF_INVALID_INPUT';
  end if;
  select array_agg(k) into v_fields from jsonb_object_keys(p_dados) as k;
  if exists (select 1 from unnest(v_fields) k where k <> all(
    case when p_id is null then array['auth_user_id','nome','email','cargo','ativo','permissoes']
    else array['nome','email','cargo','ativo','permissoes','updated_at'] end)) then
    raise exception 'STAFF_INVALID_FIELDS';
  end if;
  if p_dados ? 'cargo' and coalesce(p_dados->>'cargo','') not in ('vendedora','sdr','financeiro','gestao','administrativo') then
    raise exception 'STAFF_INVALID_ROLE';
  end if;
  if p_dados ? 'ativo' and jsonb_typeof(p_dados->'ativo') <> 'boolean' then
    raise exception 'STAFF_INVALID_ACTIVE';
  end if;
  if p_dados ? 'nome' and (jsonb_typeof(p_dados->'nome') <> 'string' or length(trim(p_dados->>'nome')) not between 1 and 200) then
    raise exception 'STAFF_INVALID_NAME';
  end if;
  if p_dados ? 'email' and (jsonb_typeof(p_dados->'email') <> 'string' or length(p_dados->>'email') > 200 or (p_dados->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'STAFF_INVALID_EMAIL';
  end if;
  if p_dados ? 'permissoes' then
    if jsonb_typeof(p_dados->'permissoes') <> 'array' then raise exception 'STAFF_INVALID_PERMISSIONS'; end if;
    select coalesce(array_agg(distinct val),'{}'::text[]) into v_permissions
      from jsonb_array_elements_text(p_dados->'permissoes') val;
    if exists (select 1 from unnest(v_permissions) p where p <> all(array['visao_geral.ver','agenda.ver','agenda.gerenciar','clientes.ver','clientes.editar','clientes.liberar_acesso_app','clientes.alterar_status_contrato','clientes.excluir','financeiro.ver','financeiro.validar_comprovante','financeiro.baixa_manual','financeiro.revisao','clube.ver','credito.gerenciar','previsoes.ver','relatorios.visualizar','relatorios.exportar','configuracoes.gerenciar','notificacoes.gerenciar','equipe.gerenciar'])) then
      raise exception 'STAFF_INVALID_PERMISSIONS';
    end if;
  end if;
  if p_id is null then
    if v_actor.cargo::text <> 'administrativo' and
      (p_dados->>'cargo' in ('administrativo','gestao') or cardinality(v_permissions) > 0) then
      raise exception 'STAFF_FORBIDDEN' using errcode = '42501';
    end if;
    insert into public.colaboradores(auth_user_id,nome,email,cargo,ativo,permissoes)
      values ((p_dados->>'auth_user_id')::uuid,trim(p_dados->>'nome'),lower(p_dados->>'email'),
        (p_dados->>'cargo')::public.cargo_colaborador,true,coalesce(v_permissions,'{}'::text[])) returning * into v_new;
  else
    select * into v_old from public.colaboradores where id=p_id for update;
    if v_old.id is null then raise exception 'STAFF_NOT_FOUND'; end if;
    if v_actor.cargo::text <> 'administrativo' and
      (v_old.cargo::text in ('administrativo','gestao') or p_dados ? 'cargo' or p_dados ? 'permissoes' or p_dados ? 'email') then
      raise exception 'STAFF_FORBIDDEN' using errcode = '42501';
    end if;
    if v_old.auth_user_id = p_actor_auth_id and
      ((p_dados ? 'ativo' and (p_dados->>'ativo')::boolean = false)
        or (p_dados ? 'cargo' and p_dados->>'cargo' <> 'administrativo')) then
      raise exception 'STAFF_SELF_LOCKOUT' using errcode = '42501';
    end if;
    update public.colaboradores set
      nome=case when p_dados ? 'nome' then trim(p_dados->>'nome') else nome end,
      email=case when p_dados ? 'email' then lower(p_dados->>'email') else email end,
      cargo=case when p_dados ? 'cargo' then (p_dados->>'cargo')::public.cargo_colaborador else cargo end,
      ativo=case when p_dados ? 'ativo' then (p_dados->>'ativo')::boolean else ativo end,
      permissoes=coalesce(v_permissions,permissoes), updated_at=now()
      where id=p_id returning * into v_new;
  end if;
  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
    values(v_actor.id::text,case when p_id is null then 'criou_colaborador' else 'alterou_colaborador' end,
      'colaboradores',v_new.id,jsonb_build_object('campos',array_remove(v_fields,'updated_at'),
      'cargo',v_new.cargo,'ativo',v_new.ativo,'permissoes',v_new.permissoes));
  return to_jsonb(v_new) - 'auth_user_id';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_cirurgia_datas_snapshot(p_hoje date)
 RETURNS TABLE(id uuid, data date, vagas_restantes integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT * FROM public.loadtest_agenda_cirurgia_datas_snapshot(p_hoje);
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_cirurgica_ajustar_prazo(p_agendamento_id uuid, p_dias_uteis integer, p_usuario text)
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_cirurgica_liberar_manual(p_agendamento_id uuid, p_usuario text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_comprometimento_mes(p_mes date, p_excluir_cliente uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_confirmar_levantamento(p_cliente_id uuid, p_saldo_final numeric, p_formas text[], p_usuario text)
 RETURNS clientes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_confirmar_pagamento_cirurgia(p_agendamento_id uuid, p_usuario text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_confirmar_previsao(p_agendamento_id uuid, p_previsao date, p_usuario text)
 RETURNS agendamentos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_data_minima_cirurgia(p_agendamento_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d.data + coalesce((select c.cirurgia_intervalo_minimo_dias from public.configuracoes c where c.id = 1), 90)
  from public.agendamentos a
  join public.datas d on d.id = a.data_id
  where a.id = p_agendamento_id;
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_datas_snapshot(p_hoje date)
 RETURNS TABLE(id uuid, data date, vagas_restantes integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT * FROM public.loadtest_agenda_datas_snapshot(p_hoje);
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_definir_responsavel_termos(p_agendamento_id uuid, p_responsavel text, p_usuario text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_liberada(p_cliente_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    public.pode_agendar(p_cliente_id)
    and exists (
      select 1
      from public.clientes c
      where c.id = p_cliente_id
        and c.status_revisao_financeira = 'aprovada'
        and c.financeiro_confirmado_em is not null
    )
    and exists (
      select 1
      from public.solicitacoes_liberacao_financeira s
      where s.cliente_id = p_cliente_id
        and s.status in ('pendente','em_analise','aprovada')
    );
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_liberar_termos_para_nova_escolha(p_agendamento_id uuid, p_usuario text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_processar_liberacoes_v46()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_agendamento record;
  v_liberadas integer := 0;
begin
  for v_agendamento in
    select a.id
    from public.agendamentos a
    where a.status = 'confirmado'
      and a.comparecimento_status = 'compareceu'
      and a.quitacao_status = 'paga'
      and a.agenda_cirurgica_liberada_em is null
    order by a.id
  loop
    if public.agenda_tentar_liberar_cirurgia(
      v_agendamento.id,
      'sistema:cron-v46'
    ) then
      v_liberadas := v_liberadas + 1;
    end if;
  end loop;

  return v_liberadas;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_reagendar_termos_agora(p_agendamento_atual_id uuid, p_nova_data_id uuid, p_horario_termos text, p_usuario text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_registrar_comparecimento(p_agendamento_id uuid, p_compareceu boolean, p_usuario text)
 RETURNS agendamentos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_registrar_quitacao(p_agendamento_id uuid, p_recebido boolean, p_usuario text, p_idempotency_key text)
 RETURNS agendamentos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.agendamentos%rowtype;
  v_cliente public.clientes%rowtype;
  v_escolha public.solicitacoes_liberacao_financeira%rowtype;
  v_boleto public.boletos%rowtype;
  v_aberto numeric := 0;
  v_total_final numeric := 0;
  v_alocado numeric := 0;
  v_valor numeric := 0;
  v_juros numeric := 0;
  v_desconto numeric := 0;
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
    if v_total_final < 0 then raise exception 'SALDO_FINAL_INVALIDO'; end if;

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

      v_valor := greatest(0, v_valor);
      v_alocado := v_alocado + v_valor;

      if v_valor >= v_boleto.valor then
        v_juros := round(v_valor - v_boleto.valor,2);
        v_desconto := 0;
      else
        v_juros := 0;
        v_desconto := round(v_boleto.valor - v_valor,2);
      end if;

      insert into public.financeiro_recebimentos(
        boleto_id,cliente_id,valor_original,juros,multa,desconto,valor_recebido,data_pagamento,
        forma_pagamento,origem,status_validacao,observacao,
        idempotency_key,criado_por,validado_por,validado_em
      ) values (
        v_boleto.id,v.cliente_id,v_boleto.valor,v_juros,0,v_desconto,v_valor,
        (timezone('America/Sao_Paulo',now()))::date,
        v_forma,'manual','validado',
        'Quitação integral confirmada na Liberação Financeira. Valor final definido no levantamento.',
        p_idempotency_key||':'||v_boleto.id::text,p_usuario,p_usuario,now()
      )
      on conflict (idempotency_key) do nothing;

      update public.boletos
      set status = 'pago',
          data_pagamento = (timezone('America/Sao_Paulo',now()))::date,
          observacoes = coalesce(observacoes,'') ||
            case when coalesce(observacoes,'')='' then '' else E'\n' end ||
            'Quitação integral confirmada na Liberação Financeira. Valor final definido no levantamento.',
          updated_at = now()
      where id = v_boleto.id;
    end loop;

    if round(v_alocado,2) <> round(v_total_final,2) then
      raise exception 'DISTRIBUICAO_QUITACAO_INVALIDA';
    end if;

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
        'valor_nominal_aberto',v_aberto,
        'valor_recebido',v_total_final,
        'ajuste_financeiro',round(v_total_final-v_aberto,2),
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_reservar_cirurgia(p_cliente_id uuid, p_data date, p_horario text, p_usuario text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_reservar_cirurgia_cliente(p_cliente_id uuid, p_data date, p_horario text, p_usuario text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_tentar_liberar_cirurgia(p_agendamento_id uuid, p_usuario text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.agendar_cirurgia_data(p_agendamento_id uuid, p_data date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agendamento public.agendamentos%rowtype;
  v_cliente public.clientes%rowtype;
  v_data public.datas_liberacao_financeira%rowtype;
  v_ocupadas integer;
  v_base date;
  v_limite date;
  v_hoje date := (timezone('America/Sao_Paulo', now()))::date;
begin
  select * into v_agendamento from public.agendamentos where id = p_agendamento_id for update;
  if not found then raise exception using errcode = 'P0012', message = 'AGENDAMENTO_NAO_ENCONTRADO'; end if;
  if v_agendamento.termos_assinados_em is null then raise exception using errcode = 'P0013', message = 'TERMOS_NAO_ASSINADOS'; end if;

  select * into v_cliente from public.clientes where id = v_agendamento.cliente_id for update;
  if not found then raise exception using errcode = 'P0014', message = 'CLIENTE_NAO_ENCONTRADA'; end if;
  if v_cliente.custeio_confirmado_em is null then raise exception using errcode = 'P0015', message = 'SALDO_NAO_QUITADO'; end if;

  v_base := greatest((timezone('America/Sao_Paulo', v_agendamento.termos_assinados_em))::date,(timezone('America/Sao_Paulo', v_cliente.custeio_confirmado_em))::date);
  v_limite := public.adicionar_dias_corridos(v_base, 90);

  if p_data < greatest(v_base, v_hoje) then raise exception using errcode = 'P0017', message = 'DATA_CIRURGIA_ANTES_DA_BASE'; end if;
  if p_data > v_limite then raise exception using errcode = 'P0016', message = 'PRAZO_CIRURGICO_EXCEDIDO'; end if;

  select * into v_data from public.datas_liberacao_financeira where data = p_data for update;
  if not found or v_data.status <> 'disponivel' then raise exception using errcode = 'P0010', message = 'DATA_CIRURGIA_INDISPONIVEL'; end if;

  select count(*)::integer into v_ocupadas
  from public.agendamentos
  where status in ('confirmado', 'realizado') and data_cirurgia = p_data and id <> p_agendamento_id;
  if v_ocupadas >= 1 then raise exception using errcode = 'P0011', message = 'DATA_CIRURGIA_OCUPADA'; end if;

  update public.agendamentos set data_cirurgia = p_data, previsao_liberacao_financeira = p_data, updated_at = now() where id = p_agendamento_id;
  update public.clientes set status_cirurgia = 'agendada', updated_at = now() where id = v_agendamento.cliente_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.agendar_data(p_cliente_id uuid, p_data_id uuid, p_valor_contrato numeric, p_horario_termos text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.atualizar_solicitacao_liberacao_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.bump_agenda_sync_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_table_name = 'datas' then
    update public.agenda_sync_state
       set versao = versao + 1, updated_at = clock_timestamp()
     where tipo = 'termos';
  elsif tg_table_name = 'datas_liberacao_financeira' then
    update public.agenda_sync_state
       set versao = versao + 1, updated_at = clock_timestamp()
     where tipo = 'cirurgia';
  elsif tg_table_name = 'agendamentos' then
    update public.agenda_sync_state
       set versao = versao + 1, updated_at = clock_timestamp()
     where tipo in ('termos','cirurgia');
  end if;
  return coalesce(new, old);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.calcular_prazo_cirurgico_v46(p_comparecimento_em timestamp with time zone, p_quitacao_em timestamp with time zone, p_dias_ajuste integer DEFAULT 0)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.carne_importar_parcelas(p_cliente_id uuid, p_chave text, p_documento jsonb, p_itens jsonb, p_usuario text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existente public.carne_importacoes%rowtype;
  v_item jsonb;
  v_acao text;
  v_boleto public.boletos%rowtype;
  v_numero integer;
  v_total integer;
  v_total_cliente integer;
  v_vencimento date;
  v_centavos bigint;
  v_path text;
  v_prefixo text;
  v_ident text;
  v_banco text := nullif(trim(coalesce(p_documento->>'banco', '')), '');
  v_novo_id uuid;
  v_resultado jsonb := '[]'::jsonb;
  v_criadas integer := 0;
  v_anexadas integer := 0;
  v_substituidas integer := 0;
  v_ignoradas integer := 0;
  v_importacao_id uuid;
  v_sha text := lower(coalesce(p_documento->>'sha256', ''));
begin
  if p_chave is null or length(p_chave) < 16 then raise exception 'CHAVE_IDEMPOTENCIA_INVALIDA'; end if;
  if v_sha !~ '^[0-9a-f]{64}$' then raise exception 'ARQUIVO_HASH_INVALIDO'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'SEM_ITENS'; end if;
  if jsonb_array_length(p_itens) > 400 then raise exception 'ITENS_DEMAIS'; end if;

  -- Uma importação por cliente por vez.
  perform pg_advisory_xact_lock(hashtextextended('carne_importar:' || p_cliente_id::text, 0));

  if not exists (select 1 from public.clientes where id = p_cliente_id and arquivado_em is null) then
    raise exception 'CLIENTE_NAO_ENCONTRADA';
  end if;

  -- Idempotência: mesma chave → mesmo resultado, nada reaplicado.
  select * into v_existente from public.carne_importacoes where chave_idempotencia = p_chave;
  if found then
    if v_existente.cliente_id <> p_cliente_id or v_existente.arquivo_sha256 <> v_sha then
      raise exception 'CHAVE_IDEMPOTENCIA_CONFLITANTE';
    end if;
    return v_existente.resultado || jsonb_build_object('repetida', true);
  end if;

  if not coalesce((p_documento->>'permitirReimportacao')::boolean, false)
     and exists (select 1 from public.carne_importacoes where cliente_id = p_cliente_id and arquivo_sha256 = v_sha) then
    raise exception 'DOCUMENTO_JA_IMPORTADO';
  end if;

  v_prefixo := 'carnes/' || p_cliente_id::text || '/' || v_sha || '/';
  select max(total_parcelas) into v_total_cliente from public.boletos where cliente_id = p_cliente_id;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_acao := v_item->>'acao';
    v_path := v_item->>'arquivoPath';
    v_ident := nullif(regexp_replace(coalesce(v_item->>'identificador', ''), '\D', '', 'g'), '');
    if v_ident is not null and length(v_ident) not in (44, 47, 48) then raise exception 'IDENTIFICADOR_INVALIDO:%', v_item->>'item'; end if;

    if v_acao = 'ignorar' then
      v_ignoradas := v_ignoradas + 1;
      v_resultado := v_resultado || jsonb_build_object('item', v_item->>'item', 'acao', 'ignorar');
      continue;
    end if;

    if v_acao not in ('criar', 'anexar', 'substituir') then raise exception 'ACAO_INVALIDA:%', v_item->>'item'; end if;
    if v_path is null or left(v_path, length(v_prefixo)) <> v_prefixo or v_path ~ '\.\.' then
      raise exception 'ARQUIVO_INVALIDO:%', v_item->>'item';
    end if;

    if v_acao = 'criar' then
      if coalesce(v_item->>'numero', '') !~ '^\d{1,4}$' or coalesce(v_item->>'total', '') !~ '^\d{1,4}$' then raise exception 'PARCELA_INVALIDA:%', v_item->>'item'; end if;
      v_numero := (v_item->>'numero')::integer;
      v_total := (v_item->>'total')::integer;
      if v_numero < 1 or v_total < 1 or v_numero > v_total then raise exception 'PARCELA_INVALIDA:%', v_item->>'item'; end if;
      if v_total_cliente is not null and v_total <> v_total_cliente then raise exception 'TOTAL_CONFLITANTE:%', v_item->>'item'; end if;
      if coalesce(v_item->>'vencimento', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'VENCIMENTO_OBRIGATORIO:%', v_item->>'item'; end if;
      v_vencimento := (v_item->>'vencimento')::date;
      if coalesce(v_item->>'valorCentavos', '') !~ '^\d{1,10}$' then raise exception 'VALOR_OBRIGATORIO:%', v_item->>'item'; end if;
      v_centavos := (v_item->>'valorCentavos')::bigint;
      if v_centavos <= 0 then raise exception 'VALOR_OBRIGATORIO:%', v_item->>'item'; end if;
      if exists (select 1 from public.boletos where cliente_id = p_cliente_id and numero_parcela = v_numero) then
        raise exception 'PARCELA_JA_EXISTE:%', v_numero;
      end if;

      insert into public.boletos (cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status, boleto_url, identificador_externo, instituicao_financeira, origem_boleto)
      values (p_cliente_id, v_numero, v_total, round(v_centavos::numeric / 100, 2), v_vencimento, 'nao_pago', v_path, v_ident, v_banco, 'externo')
      returning id into v_novo_id;
      v_total_cliente := coalesce(v_total_cliente, v_total);
      v_criadas := v_criadas + 1;
      v_resultado := v_resultado || jsonb_build_object('item', v_item->>'item', 'acao', 'criar', 'boletoId', v_novo_id, 'numero', v_numero);
    else
      if coalesce(v_item->>'boletoId', '') !~ '^[0-9a-f-]{36}$' then raise exception 'PARCELA_INVALIDA:%', v_item->>'item'; end if;
      select * into v_boleto from public.boletos where id = (v_item->>'boletoId')::uuid and cliente_id = p_cliente_id for update;
      if not found then raise exception 'PARCELA_NAO_ENCONTRADA:%', v_item->>'item'; end if;

      if v_acao = 'anexar' then
        if v_boleto.boleto_url is not null then raise exception 'PARCELA_JA_TEM_BOLETO:%', v_boleto.numero_parcela; end if;
        v_anexadas := v_anexadas + 1;
      else
        if v_boleto.boleto_url is null then raise exception 'PARCELA_SEM_BOLETO:%', v_boleto.numero_parcela; end if;
        if v_boleto.status in ('pago', 'pendente_confirmacao') then raise exception 'PARCELA_PAGA_OU_EM_CONFERENCIA:%', v_boleto.numero_parcela; end if;
        v_substituidas := v_substituidas + 1;
      end if;

      -- Só o documento do boleto muda: valor, vencimento, status e origem ficam como estão.
      update public.boletos
      set boleto_url = v_path,
          identificador_externo = coalesce(v_ident, case when v_acao = 'anexar' then identificador_externo end),
          instituicao_financeira = coalesce(instituicao_financeira, v_banco),
          updated_at = now()
      where id = v_boleto.id;
      v_resultado := v_resultado || jsonb_build_object('item', v_item->>'item', 'acao', v_acao, 'boletoId', v_boleto.id, 'numero', v_boleto.numero_parcela);
    end if;
  end loop;

  insert into public.carne_importacoes (
    cliente_id, chave_idempotencia, arquivo_sha256, arquivo_nome, arquivo_tipo, arquivo_tamanho, paginas,
    tipo_documento, parser, layout_fingerprint, banco, confianca_documento, nivel_confianca, alertas, metricas,
    itens, resultado, cpf_divergente_confirmado, criado_por
  ) values (
    p_cliente_id, p_chave, v_sha, left(p_documento->>'nome', 200), p_documento->>'tipo',
    nullif(p_documento->>'tamanho', '')::bigint, nullif(p_documento->>'paginas', '')::integer,
    p_documento->>'tipoDocumento', left(p_documento->>'parser', 60), left(p_documento->>'fingerprint', 60), v_banco,
    nullif(p_documento->>'confianca', '')::numeric, p_documento->>'nivel',
    coalesce(array(select jsonb_array_elements_text(coalesce(p_documento->'alertas', '[]'::jsonb))), '{}'),
    coalesce(p_documento->'metricas', '{}'::jsonb),
    -- Itens sem identificador (a linha digitável fica só na parcela).
    (select coalesce(jsonb_agg(i - 'identificador'), '[]'::jsonb) from jsonb_array_elements(p_itens) i),
    '{}'::jsonb,
    coalesce((p_documento->>'cpfDivergenteConfirmado')::boolean, false),
    p_usuario
  ) returning id into v_importacao_id;

  v_resultado := jsonb_build_object(
    'importacaoId', v_importacao_id,
    'criadas', v_criadas, 'anexadas', v_anexadas, 'substituidas', v_substituidas, 'ignoradas', v_ignoradas,
    'itens', v_resultado
  );
  update public.carne_importacoes set resultado = v_resultado where id = v_importacao_id;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, 'importou_carne_leitor', 'clientes', p_cliente_id, jsonb_build_object(
    'importacaoId', v_importacao_id, 'tipo', p_documento->>'tipo', 'paginas', p_documento->'paginas',
    'criadas', v_criadas, 'anexadas', v_anexadas, 'substituidas', v_substituidas, 'ignoradas', v_ignoradas,
    'cpfDivergenteConfirmado', coalesce((p_documento->>'cpfDivergenteConfirmado')::boolean, false)
  ));

  return v_resultado;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cliente_agenda_snapshot(p_cliente_id uuid, p_hoje date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT public.loadtest_cliente_agenda_snapshot(p_cliente_id,p_hoje);
$function$
;

CREATE OR REPLACE FUNCTION public.cliente_financeiro_snapshot(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT public.loadtest_cliente_financeiro_snapshot(p_cliente_id);
$function$
;

CREATE OR REPLACE FUNCTION public.cliente_solicitar_liberacao_financeira(p_cliente_id uuid)
 RETURNS clientes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.clientes_arquivar(p_cliente_id uuid, p_usuario text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_vendas uuid[];
begin
  update public.clientes
  set ativo = false,
      acesso_app_liberado = false,
      status_contrato = 'cancelado',
      suspenso_desde = null,
      suspenso_ate = null,
      suspensao_motivo = null,
      arquivado_em = coalesce(arquivado_em, now()),
      arquivado_por = coalesce(arquivado_por, p_usuario)
  where id = p_cliente_id
  returning id into v_id;

  if v_id is null then raise exception 'CLIENTE_NAO_ENCONTRADA'; end if;

  -- A venda do RD volta para a fila de cadastro local; o snapshot rd_* e o
  -- histórico continuam intactos.
  with liberadas as (
    update public.novas_vendas
    set cliente_id = null, status = 'aguardando_cadastro', updated_at = now()
    where cliente_id = p_cliente_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_vendas from liberadas;

  insert into public.logs_alteracoes(usuario, acao, entidade, entidade_id, detalhes)
  values (
    p_usuario, 'arquivou_cliente', 'clientes', p_cliente_id,
    jsonb_build_object('registroExcluido', false, 'modo', 'arquivado', 'historicoPreservado', true,
                       'cpfLiberado', true, 'vendasLiberadas', to_jsonb(v_vendas), 'escritaNoRd', false)
  );

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clube_atualizar_indicacao(p_indicacao_id uuid, p_status text, p_indicado_cliente_id uuid, p_observacao text, p_usuario text)
 RETURNS indicacoes_clientes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_ind public.indicacoes_clientes%rowtype;
begin
  if p_status not in ('enviada', 'qualificada', 'venda', 'invalidada') then
    raise exception 'Status de indicacao invalido';
  end if;

  select * into v_ind from public.indicacoes_clientes where id = p_indicacao_id for update;
  if not found then
    raise exception 'Indicacao nao encontrada';
  end if;
  if v_ind.pontos_creditados > 0 and p_status <> 'venda' then
    raise exception 'Indicacao ja creditada';
  end if;
  if p_status = 'venda' and p_indicado_cliente_id is null then
    raise exception 'Vincule a cliente indicada para marcar como fechada';
  end if;
  if p_indicado_cliente_id is not null and p_indicado_cliente_id = v_ind.indicador_cliente_id then
    raise exception 'A cliente nao pode indicar a si mesma';
  end if;
  if p_indicado_cliente_id is not null and not exists (select 1 from public.clientes where id = p_indicado_cliente_id) then
    raise exception 'Cliente indicada nao encontrada';
  end if;

  update public.indicacoes_clientes
  set status = p_status,
      indicado_cliente_id = case when v_ind.pontos_creditados > 0 then v_ind.indicado_cliente_id else p_indicado_cliente_id end,
      observacao = nullif(btrim(p_observacao), ''),
      status_atualizado_em = now(),
      status_atualizado_por = p_usuario
  where id = p_indicacao_id
  returning * into v_ind;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (
    coalesce(p_usuario, 'admin'), 'atualizou_indicacao_clube', 'indicacoes_clientes', v_ind.id,
    jsonb_build_object('status', p_status, 'indicado_cliente_id', v_ind.indicado_cliente_id, 'observacao', v_ind.observacao)
  );

  perform public.clube_avaliar_indicacao(v_ind.id);
  select * into v_ind from public.indicacoes_clientes where id = p_indicacao_id;
  return v_ind;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clube_atualizar_resgate(p_resgate_id uuid, p_status text, p_usuario text)
 RETURNS clube_resgates
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_resgate public.clube_resgates%rowtype;
  v_recompensa public.clube_recompensas%rowtype;
begin
  if p_resgate_id is null then
    raise exception 'Resgate nao encontrado';
  end if;
  if p_status not in ('aprovado','separacao','entregue','cancelado') then
    raise exception 'Transicao de resgate invalida';
  end if;

  select * into v_resgate from public.clube_resgates where id = p_resgate_id for update;
  if not found then raise exception 'Resgate nao encontrado'; end if;
  if v_resgate.status = p_status then return v_resgate; end if;
  if v_resgate.status in ('entregue','cancelado') then raise exception 'Resgate ja finalizado'; end if;

  if not (
    (v_resgate.status = 'solicitado' and p_status in ('aprovado','cancelado')) or
    (v_resgate.status = 'aprovado' and p_status in ('separacao','cancelado')) or
    (v_resgate.status = 'separacao' and p_status in ('entregue','cancelado'))
  ) then raise exception 'Transicao de resgate invalida'; end if;

  select * into v_recompensa from public.clube_recompensas where id = v_resgate.recompensa_id for update;

  if p_status = 'cancelado' then
    insert into public.cliente_pontos (cliente_id, saldo)
    values (v_resgate.cliente_id, v_resgate.pontos)
    on conflict (cliente_id) do update
      set saldo = public.cliente_pontos.saldo + excluded.saldo,
          updated_at = now();

    if v_recompensa.estoque is not null then
      update public.clube_recompensas set estoque = estoque + 1 where id = v_resgate.recompensa_id;
    end if;

    insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
    values (
      v_resgate.cliente_id,'ajuste',v_resgate.pontos,v_resgate.id::text,
      jsonb_build_object('motivo','cancelamento_resgate','resgate_id',v_resgate.id,'recompensa_id',v_resgate.recompensa_id,'usuario',coalesce(nullif(btrim(p_usuario),''),'admin'))
    );
  end if;

  update public.clube_resgates set status = p_status, updated_at = now()
  where id = v_resgate.id returning * into v_resgate;

  perform public.notificar_cliente(v_resgate.cliente_id, 'clube_resgate_' || p_status,
    jsonb_build_object('recompensa', coalesce(v_recompensa.titulo, 'sua recompensa')), v_resgate.id, 'resgate:' || v_resgate.id::text || ':' || p_status);

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (
    coalesce(nullif(btrim(p_usuario),''),'admin'),'alterou_status_resgate_clube','clube_resgates',v_resgate.id,
    jsonb_build_object('status',p_status,'cliente_id',v_resgate.cliente_id,'recompensa_id',v_resgate.recompensa_id,'pontos',v_resgate.pontos)
  );
  return v_resgate;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clube_avaliar_indicacao(p_indicacao_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_ind public.indicacoes_clientes%rowtype;
  v_pontos integer;
  v_creditou boolean;
begin
  select * into v_ind from public.indicacoes_clientes where id = p_indicacao_id for update;
  if not found or v_ind.status <> 'venda' or v_ind.indicado_cliente_id is null or v_ind.pontos_creditados > 0 then
    return false;
  end if;

  if not exists (
    select 1 from public.boletos
    where cliente_id = v_ind.indicado_cliente_id and numero_parcela = 1 and status = 'pago'
  ) then
    return false;
  end if;

  select pontos_indicacao_venda into v_pontos from public.clube_config where id = 1;
  v_creditou := public.clube_creditar_pontos(
    v_ind.indicador_cliente_id, 'indicacao', coalesce(v_pontos, 0), 'indicacao_venda', v_ind.id::text,
    jsonb_build_object('indicacao_id', v_ind.id, 'nome_indicado', v_ind.nome_indicado)
  );
  if not v_creditou then
    return false;
  end if;

  update public.indicacoes_clientes
  set pontos_creditados = v_pontos, pontos_creditados_em = now()
  where id = v_ind.id;

  perform public.notificar_cliente(v_ind.indicador_cliente_id, 'clube_indicacao_fechou',
    jsonb_build_object('indicada', coalesce(split_part(btrim(v_ind.nome_indicado), ' ', 1), 'Sua indicada'), 'pontos', coalesce(v_pontos, 0)::text),
    v_ind.id, 'indicacao:' || v_ind.id::text);

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clube_conceder_bonus_primeira_parcela(p_cliente_id uuid, p_boleto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_config public.clube_config%rowtype;
  v_beneficio_id uuid;
begin
  select * into v_config from public.clube_config where id = 1;
  if not found or not v_config.voucher_primeira_parcela_ativo then return; end if;

  insert into public.clube_beneficios_cliente (cliente_id, beneficio_key, origem, referencia_id)
  values (p_cliente_id, 'voucher_consulta_doutor', 'primeira_parcela', p_boleto_id)
  on conflict (cliente_id, beneficio_key, origem) do nothing
  returning id into v_beneficio_id;

  if v_beneficio_id is null then return; end if;

  if v_config.pontos_primeira_parcela > 0 then
    insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
    values (p_cliente_id, 'bonus', v_config.pontos_primeira_parcela, p_boleto_id::text, jsonb_build_object('motivo', 'primeira_parcela'));

    insert into public.cliente_pontos (cliente_id, saldo, updated_at)
    values (p_cliente_id, v_config.pontos_primeira_parcela, now())
    on conflict (cliente_id) do update
      set saldo = public.cliente_pontos.saldo + excluded.saldo, updated_at = now();
  end if;

  perform public.notificar_cliente(p_cliente_id, 'clube_bonus_primeira_parcela',
    jsonb_build_object('pontos', v_config.pontos_primeira_parcela::text, 'beneficio', v_config.voucher_primeira_parcela_titulo),
    v_beneficio_id, 'beneficio:' || v_beneficio_id::text);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clube_creditar_pontos(p_cliente_id uuid, p_tipo text, p_pontos integer, p_motivo text, p_referencia text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_cliente_id is null or coalesce(p_pontos, 0) <= 0 or nullif(btrim(p_motivo), '') is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'clube_credito:' || p_cliente_id::text || ':' || p_motivo || ':' || coalesce(p_referencia, ''), 0
  ));

  if exists (
    select 1 from public.cliente_pontos_eventos
    where cliente_id = p_cliente_id
      and metadata->>'motivo' = p_motivo
      and referencia is not distinct from p_referencia
  ) then
    return false;
  end if;

  insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
  values (p_cliente_id, p_tipo, p_pontos, p_referencia, coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('motivo', p_motivo));

  insert into public.cliente_pontos (cliente_id, saldo, updated_at)
  values (p_cliente_id, p_pontos, now())
  on conflict (cliente_id) do update
    set saldo = public.cliente_pontos.saldo + excluded.saldo,
        updated_at = now();

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clube_notificar_boleto_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_pontos_em_dia integer;
  v_ind record;
  v_total integer;
  v_pagas integer;
  v_abertas integer;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'pendente_confirmacao' then
    perform public.notificar_cliente(new.cliente_id, 'comprovante_recebido',
      jsonb_build_object('parcela', new.numero_parcela::text, 'total', coalesce(new.total_parcelas::text, '—')), new.id, null);
  elsif new.status = 'pago' then
    perform public.notificar_cliente(new.cliente_id, 'pagamento_confirmado',
      jsonb_build_object('parcela', new.numero_parcela::text, 'total', coalesce(new.total_parcelas::text, '—')), new.id, 'boleto:' || new.id::text);

    select coalesce(c.quantidade_parcelas, new.total_parcelas) into v_total from public.clientes c where c.id = new.cliente_id;
    select count(*) filter (where b.status = 'pago'), count(*) filter (where b.status <> 'pago')
      into v_pagas, v_abertas
      from public.boletos b where b.cliente_id = new.cliente_id;
    if v_total is not null and v_total > 0 and v_abertas = 0 and v_pagas >= v_total then
      perform public.notificar_cliente(new.cliente_id, 'plano_quitado', jsonb_build_object('total', v_total::text), new.id, 'plano');
    end if;

    if new.numero_parcela = 1 then
      perform public.clube_conceder_bonus_primeira_parcela(new.cliente_id, new.id);

      for v_ind in
        select id from public.indicacoes_clientes
        where indicado_cliente_id = new.cliente_id and status = 'venda' and pontos_creditados = 0
      loop
        perform public.clube_avaliar_indicacao(v_ind.id);
      end loop;
    end if;

    if new.data_vencimento is not null
       and coalesce(new.data_pagamento, (now() at time zone 'America/Sao_Paulo')::date) <= new.data_vencimento then
      select pontos_parcela_em_dia into v_pontos_em_dia from public.clube_config where id = 1;
      if public.clube_creditar_pontos(
        new.cliente_id, 'bonus', coalesce(v_pontos_em_dia, 0), 'parcela_em_dia', new.id::text,
        jsonb_build_object('numero_parcela', new.numero_parcela)
      ) then
        perform public.notificar_cliente(new.cliente_id, 'clube_pontos_parcela_em_dia',
          jsonb_build_object('parcela', new.numero_parcela::text, 'pontos', coalesce(v_pontos_em_dia, 0)::text), new.id, 'pontos_em_dia:' || new.id::text);
      end if;
    end if;
  elsif new.status = 'rejeitado' then
    perform public.notificar_cliente(new.cliente_id, 'comprovante_rejeitado',
      jsonb_build_object('parcela', new.numero_parcela::text, 'total', coalesce(new.total_parcelas::text, '—'), 'motivo', public.notificacao_motivo(new.observacoes)), new.id, null);
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clube_resgatar(p_cliente_id uuid, p_recompensa_id uuid, p_idempotency_key text)
 RETURNS clube_resgates
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_recompensa public.clube_recompensas%rowtype;
  v_pontos public.cliente_pontos%rowtype;
  v_resgate public.clube_resgates%rowtype;
  v_saldo_atual integer;
begin
  if p_cliente_id is null or p_recompensa_id is null then raise exception 'Cliente e recompensa sao obrigatorios'; end if;
  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 120 then raise exception 'Chave de idempotencia invalida'; end if;

  perform pg_advisory_xact_lock(hashtextextended('clube_resgatar:' || p_idempotency_key, 0));

  select * into v_resgate from public.clube_resgates where idempotency_key = p_idempotency_key;
  if found then
    if v_resgate.cliente_id <> p_cliente_id or v_resgate.recompensa_id <> p_recompensa_id then
      raise exception 'Chave de idempotencia ja utilizada em outro resgate';
    end if;
    return v_resgate;
  end if;

  select * into v_recompensa from public.clube_recompensas
  where id = p_recompensa_id and ativo = true for update;
  if not found then raise exception 'Recompensa indisponivel'; end if;
  if v_recompensa.estoque is not null and v_recompensa.estoque <= 0 then raise exception 'Recompensa sem estoque disponivel'; end if;

  insert into public.cliente_pontos (cliente_id, saldo) values (p_cliente_id, 0)
  on conflict (cliente_id) do nothing;

  select * into v_pontos from public.cliente_pontos where cliente_id = p_cliente_id for update;
  v_saldo_atual := coalesce(v_pontos.saldo, 0);
  if v_saldo_atual < v_recompensa.pontos then raise exception 'Saldo de pontos insuficiente'; end if;

  update public.cliente_pontos set saldo = v_saldo_atual - v_recompensa.pontos, updated_at = now()
  where cliente_id = p_cliente_id;

  if v_recompensa.estoque is not null then
    update public.clube_recompensas set estoque = estoque - 1 where id = v_recompensa.id;
  end if;

  insert into public.clube_resgates (cliente_id, recompensa_id, pontos, status, idempotency_key)
  values (p_cliente_id, v_recompensa.id, v_recompensa.pontos, 'solicitado', p_idempotency_key)
  returning * into v_resgate;

  insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
  values (p_cliente_id, 'resgate', -v_recompensa.pontos, v_resgate.id::text,
    jsonb_build_object('recompensa_id', v_recompensa.id, 'titulo', v_recompensa.titulo));

  perform public.notificar_cliente(p_cliente_id, 'clube_resgate_solicitado',
    jsonb_build_object('recompensa', v_recompensa.titulo), v_resgate.id, 'resgate:' || v_resgate.id::text || ':solicitado');

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values ('cliente:' || p_cliente_id::text, 'solicitou_resgate_clube', 'clube_resgates', v_resgate.id,
    jsonb_build_object('cliente_id', p_cliente_id, 'recompensa_id', v_recompensa.id, 'pontos', v_recompensa.pontos, 'idempotency_key', p_idempotency_key));

  return v_resgate;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.finance_client_funnel(p_bucket text, p_busca text, p_ordenacao text, p_pagina integer, p_limite integer, p_hoje date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT public.loadtest_finance_client_funnel(p_bucket,p_busca,p_ordenacao,p_pagina,p_limite,p_hoje);
$function$
;

CREATE OR REPLACE FUNCTION public.finance_receivables_page(p_inicio date, p_fim date, p_status text, p_busca text, p_pagina integer, p_limite integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT public.loadtest_finance_receivables_page(p_inicio,p_fim,p_status,p_busca,p_pagina,p_limite);
$function$
;

CREATE OR REPLACE FUNCTION public.finance_received_page(p_tipo text, p_data date, p_busca text, p_pagina integer, p_limite integer, p_hoje date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT public.loadtest_finance_received_page(p_tipo,p_data,p_busca,p_pagina,p_limite,p_hoje);
$function$
;

CREATE OR REPLACE FUNCTION public.finance_summary(p_inicio date, p_fim date, p_hoje date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ SELECT public.loadtest_finance_summary(p_inicio,p_fim,p_hoje); $function$
;

CREATE OR REPLACE FUNCTION public.financeiro_baixar_boleto(p_boleto_id uuid, p_data_pagamento date, p_juros numeric, p_multa numeric, p_desconto numeric, p_forma_pagamento text, p_instituicao_conta text, p_observacao text, p_usuario text, p_idempotency_key text)
 RETURNS financeiro_recebimentos
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_boleto public.boletos%rowtype;
  v_recebimento public.financeiro_recebimentos%rowtype;
  v_juros numeric(12,2) := round(coalesce(p_juros, 0), 2);
  v_multa numeric(12,2) := round(coalesce(p_multa, 0), 2);
  v_desconto numeric(12,2) := round(coalesce(p_desconto, 0), 2);
  v_total numeric(12,2);
begin
  if p_data_pagamento is null then raise exception 'Data do pagamento obrigatoria'; end if;
  if p_forma_pagamento not in ('pix', 'dinheiro', 'transferencia', 'boleto', 'cartao', 'cheque', 'outro') then
    raise exception 'Forma de pagamento invalida';
  end if;
  if v_juros < 0 or v_multa < 0 or v_desconto < 0 then raise exception 'Composicao financeira invalida'; end if;

  select * into v_boleto from public.boletos where id = p_boleto_id for update;
  if not found then raise exception 'Parcela nao encontrada'; end if;

  -- A consulta da chave ocorre depois do lock para que retries concorrentes
  -- retornem o mesmo lançamento, em vez de disputarem o INSERT único.
  select * into v_recebimento
  from public.financeiro_recebimentos
  where idempotency_key = p_idempotency_key;
  if found then return v_recebimento; end if;

  if v_boleto.status = 'pago' then raise exception 'Parcela ja liquidada'; end if;

  v_total := round(v_boleto.valor + v_juros + v_multa - v_desconto, 2);
  if v_total < 0 then raise exception 'Desconto superior ao valor devido'; end if;

  insert into public.financeiro_recebimentos (
    boleto_id, cliente_id, valor_original, juros, multa, desconto, valor_recebido,
    data_pagamento, forma_pagamento, instituicao_conta, origem, status_validacao,
    comprovante_url, observacao, idempotency_key, criado_por, validado_por, validado_em
  ) values (
    v_boleto.id, v_boleto.cliente_id, v_boleto.valor, v_juros, v_multa, v_desconto, v_total,
    p_data_pagamento, p_forma_pagamento, nullif(btrim(p_instituicao_conta), ''), 'manual', 'validado',
    v_boleto.comprovante_url, nullif(btrim(p_observacao), ''), p_idempotency_key, p_usuario, p_usuario, now()
  ) returning * into v_recebimento;

  update public.boletos
  set status = 'pago', data_pagamento = p_data_pagamento,
      observacoes = coalesce(nullif(btrim(p_observacao), ''), observacoes)
  where id = v_boleto.id;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, 'baixou_parcela_manual', 'boletos', v_boleto.id,
    jsonb_build_object('recebimento_id', v_recebimento.id, 'cliente_id', v_boleto.cliente_id,
      'valor_original', v_boleto.valor, 'juros', v_juros, 'multa', v_multa,
      'desconto', v_desconto, 'valor_recebido', v_total, 'forma_pagamento', p_forma_pagamento));

  return v_recebimento;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.financeiro_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.financeiro_validar_comprovante(p_boleto_id uuid, p_acao text, p_observacao text, p_usuario text, p_idempotency_key text)
 RETURNS financeiro_recebimentos
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_boleto public.boletos%rowtype;
  v_recebimento public.financeiro_recebimentos%rowtype;
begin
  if p_acao not in ('confirmar', 'rejeitar') then raise exception 'Acao de validacao invalida'; end if;
  if p_acao = 'rejeitar' and nullif(btrim(p_observacao), '') is null then
    raise exception 'Motivo da rejeicao obrigatorio';
  end if;

  select * into v_boleto from public.boletos where id = p_boleto_id for update;
  if not found then raise exception 'Parcela nao encontrada'; end if;

  select * into v_recebimento
  from public.financeiro_recebimentos
  where idempotency_key = p_idempotency_key;
  if found then return v_recebimento; end if;

  if v_boleto.status <> 'pendente_confirmacao' then raise exception 'Comprovante nao esta pendente de validacao'; end if;

  if p_acao = 'confirmar' then
    insert into public.financeiro_recebimentos (
      boleto_id, cliente_id, valor_original, valor_recebido, data_pagamento,
      forma_pagamento, origem, status_validacao, comprovante_url, observacao,
      idempotency_key, criado_por, validado_por, validado_em
    ) values (
      v_boleto.id, v_boleto.cliente_id, v_boleto.valor, v_boleto.valor, current_date,
      'comprovante', 'comprovante', 'validado', v_boleto.comprovante_url, nullif(btrim(p_observacao), ''),
      p_idempotency_key, p_usuario, p_usuario, now()
    ) returning * into v_recebimento;

    update public.boletos
    set status = 'pago', data_pagamento = current_date,
        observacoes = coalesce(nullif(btrim(p_observacao), ''), observacoes)
    where id = v_boleto.id;
  else
    insert into public.financeiro_recebimentos (
      boleto_id, cliente_id, valor_original, valor_recebido, origem, status_validacao,
      comprovante_url, observacao, motivo_rejeicao, idempotency_key, criado_por, validado_por, validado_em
    ) values (
      v_boleto.id, v_boleto.cliente_id, v_boleto.valor, 0, 'comprovante', 'rejeitado',
      v_boleto.comprovante_url, p_observacao, p_observacao, p_idempotency_key, p_usuario, p_usuario, now()
    ) returning * into v_recebimento;

    update public.boletos
    set status = 'rejeitado', data_pagamento = null, observacoes = p_observacao
    where id = v_boleto.id;
  end if;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, case when p_acao = 'confirmar' then 'confirmou_comprovante' else 'rejeitou_comprovante' end,
    'boletos', v_boleto.id,
    jsonb_build_object('recebimento_id', v_recebimento.id, 'cliente_id', v_boleto.cliente_id,
      'parcela', v_boleto.numero_parcela, 'observacao', nullif(btrim(p_observacao), '')));

  return v_recebimento;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.gerar_boletos_cliente(p_cliente_id uuid, p_quantidade_parcelas integer, p_taxa_percentual numeric DEFAULT NULL::numeric, p_primeiro_vencimento date DEFAULT ((CURRENT_DATE + '30 days'::interval))::date)
 RETURNS SETOF boletos
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_custo_total numeric(12,2);
  v_valor_parcela numeric(12,2);
  v_num int;
begin
  if p_taxa_percentual is not null then
    update clientes set taxa_administrativa_percentual = p_taxa_percentual where id = p_cliente_id;
  end if;

  select custo_total into v_custo_total from clientes where id = p_cliente_id;
  if v_custo_total is null then
    raise exception 'Cliente não encontrada';
  end if;

  v_valor_parcela := round(v_custo_total / p_quantidade_parcelas, 2);

  update clientes set quantidade_parcelas = p_quantidade_parcelas where id = p_cliente_id;

  for v_num in 1..p_quantidade_parcelas loop
    insert into boletos (cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status)
    values (
      p_cliente_id,
      v_num,
      p_quantidade_parcelas,
      v_valor_parcela,
      (p_primeiro_vencimento + ((v_num - 1) * interval '1 month'))::date,
      'nao_pago'
    )
    on conflict (cliente_id, numero_parcela) do nothing;
  end loop;

  return query select * from boletos where cliente_id = p_cliente_id order by numero_parcela;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.gerar_comissao_sdr_comparecimento(p_agendamento_id uuid, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agendamento record;
  v_comissao comissoes;
begin
  select id, cliente_id, sdr_id, comparecimento_status into v_agendamento from agendamentos where id = p_agendamento_id;
  if not found or v_agendamento.comparecimento_status <> 'compareceu' then
    return jsonb_build_object('gerada', false, 'motivo', 'comparecimento_nao_confirmado');
  end if;
  if v_agendamento.sdr_id is null then
    return jsonb_build_object('gerada', false, 'motivo', 'sdr_nao_vinculada');
  end if;
  insert into comissoes (colaborador_id, cargo, cliente_id, agendamento_id, evento, chave_evento, valor, status, gerado_por)
  values (v_agendamento.sdr_id, 'sdr', v_agendamento.cliente_id, v_agendamento.id, 'comparecimento', 'sdr:comparecimento:' || v_agendamento.id, 10, 'pendente', p_usuario_id)
  on conflict (chave_evento) do nothing
  returning * into v_comissao;
  if v_comissao.id is null then
    return jsonb_build_object('gerada', false, 'duplicada', true, 'chave_evento', 'sdr:comparecimento:' || v_agendamento.id);
  end if;
  return jsonb_build_object('gerada', true, 'comissao_id', v_comissao.id, 'valor', v_comissao.valor);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.gerar_comissao_vendedora_primeira_parcela(p_boleto_id uuid, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_boleto record;
  v_cliente record;
  v_comissao comissoes;
begin
  select id, cliente_id, numero_parcela, status into v_boleto from boletos where id = p_boleto_id;
  if not found or v_boleto.status <> 'pago' or v_boleto.numero_parcela <> 1 then
    return jsonb_build_object('gerada', false, 'motivo', 'evento_nao_e_primeira_parcela_paga');
  end if;
  select id, vendedora_id into v_cliente from clientes where id = v_boleto.cliente_id;
  if not found or v_cliente.vendedora_id is null then
    return jsonb_build_object('gerada', false, 'motivo', 'vendedora_nao_vinculada');
  end if;
  insert into comissoes (colaborador_id, cargo, cliente_id, boleto_id, evento, chave_evento, valor, status, gerado_por)
  values (v_cliente.vendedora_id, 'vendedora', v_cliente.id, v_boleto.id, 'primeira_parcela_confirmada', 'vendedora:primeira_parcela:' || v_cliente.id, 100, 'pendente', p_usuario_id)
  on conflict (chave_evento) do nothing
  returning * into v_comissao;
  if v_comissao.id is null then
    return jsonb_build_object('gerada', false, 'duplicada', true, 'chave_evento', 'vendedora:primeira_parcela:' || v_cliente.id);
  end if;
  return jsonb_build_object('gerada', true, 'comissao_id', v_comissao.id, 'valor', v_comissao.valor);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.integracao_consumir_uso(p_provedor text, p_funcao text, p_dia date, p_limite integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total integer;
begin
  insert into public.integracao_uso (provedor, funcao, dia, chamadas)
  values (p_provedor, p_funcao, p_dia, 1)
  on conflict (provedor, funcao, dia) do update
    set chamadas = public.integracao_uso.chamadas + 1
    where p_limite is null or public.integracao_uso.chamadas < p_limite
  returning chamadas into v_total;
  return coalesce(v_total, -1);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.integracao_liberar_trava(p_nome text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ delete from public.integracao_travas where nome = p_nome; $function$
;

CREATE OR REPLACE FUNCTION public.integracao_tentar_trava(p_nome text, p_segundos integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
begin
  insert into public.integracao_travas(nome, ate) values (p_nome, now() + make_interval(secs => p_segundos))
  on conflict (nome) do update set ate = excluded.ate where public.integracao_travas.ate < now()
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.integracoes_disparar_sync()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_url text;
  v_segredo text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sra_luck_app_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'sra_luck_cron_secret';
  if v_url is null or v_segredo is null or v_url !~ '^https://' then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/integracoes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_segredo),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lgpd_limpar_dados_tecnicos()
 RETURNS TABLE(rate_limits_removidos bigint, monitoramento_removido bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rate bigint; v_monitor bigint;
begin
  delete from public.login_rate_limits where updated_at < now() - interval '7 days';
  get diagnostics v_rate = row_count;
  delete from public.monitoramento_erros where criado_em < now() - interval '90 days';
  get diagnostics v_monitor = row_count;
  return query select v_rate, v_monitor;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lgpd_normalizar_usuario_auditoria(valor text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v text := btrim(coalesce(valor, ''));
  v_id uuid;
begin
  if v = '' then return 'system:unknown'; end if;
  if v = 'admin_worker' then return 'system:admin_worker'; end if;
  if v like 'cliente:%' or v like 'staff:%' or v like 'sistema:%' or v like 'system:%' then return left(v, 160); end if;

  if v like 'admin:%' then
    begin
      select id into v_id from public.colaboradores where auth_user_id = substring(v from 7)::uuid limit 1;
      if v_id is not null then return 'staff:' || v_id::text; end if;
    exception when others then null;
    end;
    return 'admin_hash:' || substr(encode(digest(lower(v), 'sha256'), 'hex'), 1, 24);
  end if;

  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select id into v_id from public.colaboradores where auth_user_id = v::uuid limit 1;
    if v_id is not null then return 'staff:' || v_id::text; end if;
    return 'actor:' || v;
  end if;

  if position('@' in v) > 1 then
    select id into v_id from public.colaboradores where lower(email) = lower(v) limit 1;
    if v_id is not null then return 'staff:' || v_id::text; end if;
    return 'email_hash:' || substr(encode(digest(lower(v), 'sha256'), 'hex'), 1, 24);
  end if;

  return 'actor_hash:' || substr(encode(digest(lower(v), 'sha256'), 'hex'), 1, 24);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lgpd_proteger_log_alteracao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.usuario := public.lgpd_normalizar_usuario_auditoria(new.usuario);
  new.detalhes := public.lgpd_sanitizar_json_auditoria(coalesce(new.detalhes, '{}'::jsonb));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lgpd_sanitizar_json_auditoria(valor jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  resultado jsonb;
  chave text;
  val jsonb;
  campo text;
begin
  if valor is null then return '{}'::jsonb; end if;

  if jsonb_typeof(valor) = 'object' then
    campo := lower(coalesce(valor->>'campo', ''));
    if campo ~ '(nome|cpf|telefone|e-mail|email|nascimento|procedimento|m[eé]dico|hospital|observa|endere[cç]o|whatsapp|senha|token|segredo)' then
      resultado := valor || jsonb_build_object('de', '[REDACTED]', 'para', '[REDACTED]');
    else
      resultado := '{}'::jsonb;
      for chave, val in select key, value from jsonb_each(valor)
      loop
        if lower(chave) in ('cpf','data_nascimento','email','telefone','phone','whatsapp','endereco','endereço','nome','nome_completo','nomecliente','nome_cliente','cliente','procedimento','medico','médico','hospital','senha','password','token','authorization','cookie','session','secret','client_secret','webhook_secret','access_token','refresh_token','api_key','service_role','pix_key','qr_code','card_number','pan','cvv','p256dh','endpoint','auth') then
          resultado := resultado || jsonb_build_object(chave, '[REDACTED]');
        else
          resultado := resultado || jsonb_build_object(chave, public.lgpd_sanitizar_json_auditoria(val));
        end if;
      end loop;
    end if;
    return resultado;
  end if;

  if jsonb_typeof(valor) = 'array' then
    select coalesce(jsonb_agg(public.lgpd_sanitizar_json_auditoria(v) order by ord), '[]'::jsonb)
      into resultado
    from jsonb_array_elements(valor) with ordinality a(v, ord);
    return resultado;
  end if;

  if jsonb_typeof(valor) = 'string' then
    return to_jsonb(
      regexp_replace(
        regexp_replace(
          regexp_replace(valor #>> '{}', '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[EMAIL_REDACTED]', 'g'),
          '\m[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}\M', '[CPF_REDACTED]', 'g'
        ),
        '(?i)bearer[[:space:]]+[A-Za-z0-9._~+/=-]{8,}', '[SECRET_REDACTED]', 'g'
      )
    );
  end if;

  return valor;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_admin_central_snapshot(p_hoje date, p_limite integer DEFAULT 20, p_estagio text DEFAULT NULL::text, p_apos_nome text DEFAULT NULL::text, p_apos_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH base AS MATERIALIZED (
    SELECT c.id, c.nome_completo, a.id AS agendamento_id,
      CASE
        WHEN a.processo_concluido_em IS NOT NULL THEN NULL
        WHEN a.data_cirurgia IS NOT NULL THEN 'surgeryConfirmed'
        WHEN a.data_termos IS NOT NULL AND a.data_termos <= p_hoje THEN 'financialRelease'
        WHEN a.data_termos IS NOT NULL THEN 'termsConfirmed'
        WHEN c.liberacao_financeira_solicitada_em IS NOT NULL THEN 'financialReview'
        ELSE 'preEligibility'
      END AS estagio
    FROM public.clientes c
    LEFT JOIN LATERAL (
      SELECT a.id,a.data_cirurgia,a.processo_concluido_em,d.data AS data_termos
      FROM public.agendamentos a LEFT JOIN public.datas d ON d.id=a.data_id
      WHERE a.cliente_id=c.id AND a.status IN ('confirmado','realizado')
      ORDER BY a.created_at DESC LIMIT 1
    ) a ON true
    WHERE c.ativo=true
  ),
  totais AS (
    SELECT coalesce(jsonb_object_agg(estagio,total),'{}'::jsonb) AS por_estagio
    FROM (SELECT estagio,count(*) AS total FROM base
      WHERE estagio IS NOT NULL GROUP BY estagio) t
  ),
  ranqueados AS (
    SELECT b.*,row_number() OVER (PARTITION BY b.estagio ORDER BY b.nome_completo,b.id) AS posicao
    FROM base b
    WHERE b.estagio IS NOT NULL
      AND (p_estagio IS NULL OR b.estagio=p_estagio)
      AND (p_apos_nome IS NULL OR (b.nome_completo,b.id)>(p_apos_nome,p_apos_id))
  ),
  pagina AS MATERIALIZED (
    SELECT * FROM ranqueados WHERE posicao<=greatest(1,least(coalesce(p_limite,20),50))
  ),
  cursores AS (
    SELECT coalesce(jsonb_object_agg(estagio,jsonb_build_object('nome',nome_completo,'id',id)),'{}'::jsonb) AS por_estagio
    FROM (SELECT DISTINCT ON (estagio) estagio,nome_completo,id
      FROM pagina ORDER BY estagio,nome_completo DESC,id DESC) finais
  ),
  cartoes AS (
    SELECT p.estagio,p.nome_completo,p.id,
      jsonb_build_object('cliente',to_jsonb(c),'agendamento',to_jsonb(a),
        'parcelas',jsonb_build_object('total',b.total,'pagas',b.pagas,'proxima',b.proxima),
        'solicitacao',to_jsonb(s)) AS dados
    FROM pagina p
    JOIN LATERAL (
      SELECT id,nome_completo,cpf,data_nascimento,procedimento,valor_contrato,
        quantidade_parcelas,status_revisao_financeira,financeiro_confirmado_em,
        data_atingiu_percentual,liberacao_financeira_solicitada_em,
        custeio_confirmado_em,status_cirurgia,ativo,acesso_app_liberado,
        acesso_app_liberado_em FROM public.clientes WHERE id=p.id
    ) c ON true
    LEFT JOIN LATERAL (
      SELECT a.id,a.cliente_id,a.status,a.horario_termos,a.termos_assinados_em,
        a.termos_responsavel,a.comparecimento_status,a.comparecimento_em,
        a.quitacao_status,a.quitacao_em,a.previsao_cirurgia,
        a.previsao_cirurgia_confirmada_em,a.agenda_cirurgica_liberada_em,
        a.agenda_cirurgica_liberada_manualmente,a.agenda_cirurgica_prazo_ajuste_dias,
        a.data_cirurgia,a.horario_cirurgia,a.cirurgia_escolhida_em,
        a.valor_contrato,a.pagamento_cirurgia_confirmado_em,
        a.processo_concluido_em,a.created_at,d.data AS data_termos
      FROM public.agendamentos a LEFT JOIN public.datas d ON d.id=a.data_id
      WHERE a.id=p.agendamento_id
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total,count(*) FILTER (WHERE status='pago') AS pagas,
        min(data_vencimento) FILTER (WHERE status<>'pago') AS proxima
      FROM public.boletos WHERE cliente_id=p.id
    ) b ON true
    LEFT JOIN LATERAL (
      SELECT status,forma_custeio,saldo_restante
      FROM public.solicitacoes_liberacao_financeira
      WHERE cliente_id=p.id ORDER BY created_at DESC LIMIT 1
    ) s ON true
  ),
  filas AS (
    SELECT coalesce(jsonb_object_agg(estagio,itens),'{}'::jsonb) AS por_estagio
    FROM (SELECT estagio,jsonb_agg(dados ORDER BY nome_completo,id) AS itens
      FROM cartoes GROUP BY estagio) f
  )
  SELECT jsonb_build_object('filas',filas.por_estagio,'totais',totais.por_estagio,
    'cursores',cursores.por_estagio)
  FROM filas,totais,cursores;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_admin_clientes_bancos()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(jsonb_agg(nome ORDER BY nome),'[]'::jsonb)
  FROM (SELECT DISTINCT instituicao_financeira AS nome FROM public.carnes
    WHERE instituicao_financeira IS NOT NULL AND btrim(instituicao_financeira) <> '') bancos;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_admin_clientes_pagina(p_limite integer, p_cursor_created timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_busca text DEFAULT NULL::text, p_funil text DEFAULT 'cadastradas'::text, p_status text DEFAULT NULL::text, p_periodo_inicio timestamp with time zone DEFAULT NULL::timestamp with time zone, p_banco text DEFAULT NULL::text, p_sort text DEFAULT 'recent'::text, p_cursor_name text DEFAULT NULL::text)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH pagina AS MATERIALIZED (
    SELECT c.id,c.nome_completo,c.cpf,c.data_nascimento,c.telefone,c.email,
      c.procedimento,c.medico,c.hospital,c.consultora,c.valor_contrato,
      c.taxa_administrativa_percentual,c.status_cirurgia,c.status_financeiro,
      c.observacoes_internas,c.quantidade_parcelas,c.status_revisao_financeira,
      c.data_atingiu_percentual,c.observacao_revisao_financeira,
      c.financeiro_saldo_restante,c.financeiro_taxa_cartao,c.financeiro_total_com_taxa,
      c.financeiro_formas_custeio,c.financeiro_confirmado_em,c.custeio_confirmado_em,
      c.ativo,c.status_contrato,c.suspenso_desde,c.suspenso_ate,c.suspensao_motivo,
      c.vendedora_id,c.acesso_app_liberado,c.acesso_app_liberado_em,c.inicio_plano,
      c.forma_pagamento_plano,c.instituicao_pagamento,c.dia_cobranca,c.status_plano,
      c.valor_total_plano,c.valor_parcela_plano,c.created_at,c.updated_at
    FROM public.clientes c
    WHERE c.ativo = true
      AND (p_cursor_id IS NULL OR
        (p_sort = 'recent' AND (c.created_at,c.id) < (p_cursor_created,p_cursor_id)) OR
        (p_sort = 'old' AND (c.created_at,c.id) > (p_cursor_created,p_cursor_id)) OR
        (p_sort = 'az' AND (lower(coalesce(c.nome_completo,'')),c.id) > (p_cursor_name,p_cursor_id)) OR
        (p_sort = 'za' AND (lower(coalesce(c.nome_completo,'')),c.id) < (p_cursor_name,p_cursor_id)))
      AND (p_periodo_inicio IS NULL OR c.created_at >= p_periodo_inicio)
      AND (p_status IS NULL OR coalesce(c.status_contrato::text,'ativo') = p_status)
      AND (
        p_funil = 'canceladas' AND c.status_contrato = 'cancelado'
        OR p_funil = 'aguardando' AND c.status_contrato IS DISTINCT FROM 'cancelado'
          AND NOT EXISTS (SELECT 1 FROM public.boletos b WHERE b.cliente_id=c.id)
        OR p_funil = 'cadastradas' AND c.status_contrato IS DISTINCT FROM 'cancelado'
          AND EXISTS (SELECT 1 FROM public.boletos b WHERE b.cliente_id=c.id)
      )
      AND (p_busca IS NULL OR c.nome_completo ILIKE '%'||p_busca||'%'
        OR c.cpf ILIKE '%'||p_busca||'%' OR c.telefone ILIKE '%'||p_busca||'%'
        OR c.consultora ILIKE '%'||p_busca||'%'
        OR EXISTS (SELECT 1 FROM public.novas_vendas v WHERE v.cliente_id=c.id AND v.origem_venda ILIKE '%'||p_busca||'%')
        OR EXISTS (SELECT 1 FROM public.carnes n WHERE n.cliente_id=c.id AND n.instituicao_financeira ILIKE '%'||p_busca||'%'))
      AND (p_banco IS NULL OR (
        SELECT n.instituicao_financeira FROM public.carnes n
        WHERE n.cliente_id=c.id AND n.instituicao_financeira IS NOT NULL
        ORDER BY n.data_geracao DESC LIMIT 1
      ) = p_banco)
    ORDER BY
      CASE WHEN p_sort='recent' THEN c.created_at END DESC,
      CASE WHEN p_sort='old' THEN c.created_at END ASC,
      CASE WHEN p_sort='az' THEN lower(coalesce(c.nome_completo,'')) END ASC,
      CASE WHEN p_sort='za' THEN lower(coalesce(c.nome_completo,'')) END DESC,
      CASE WHEN p_sort IN ('recent','za') THEN c.id END DESC,
      CASE WHEN p_sort IN ('old','az') THEN c.id END ASC
    LIMIT LEAST(GREATEST(p_limite,1),50)+1
  )
  SELECT to_jsonb(c)
    || jsonb_build_object(
      'porcentagem_pagamento',CASE WHEN b.total>0 THEN round(b.pagos::numeric/b.total*100,1) ELSE NULL END,
      'parcelas_pagas',CASE WHEN b.total>0 THEN b.pagos ELSE NULL END,
      'parcelas_total',CASE WHEN b.total>0 THEN b.total ELSE NULL END,
      'termos_assinados_em',a.termos_assinados_em,
      'proximo_agendamento_data',CASE WHEN a.status='confirmado' THEN a.data ELSE NULL END,
      'proximo_agendamento_horario',CASE WHEN a.status='confirmado' THEN a.horario ELSE NULL END,
      'banco',n.instituicao_financeira,
      'origem_venda',v.origem_venda
    )
  FROM pagina c
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS total,count(*) FILTER (WHERE status='pago')::integer AS pagos
    FROM public.boletos WHERE cliente_id=c.id
  ) b ON true
  LEFT JOIN LATERAL (
    SELECT a.status::text AS status,d.data,a.termos_assinados_em,
      left(a.horario_termos::text,5) AS horario
    FROM public.agendamentos a LEFT JOIN public.datas d ON d.id=a.data_id
    WHERE a.cliente_id=c.id AND a.status IN ('confirmado','realizado')
    ORDER BY (a.status='realizado') DESC,a.created_at DESC LIMIT 1
  ) a ON true
  LEFT JOIN LATERAL (
    SELECT instituicao_financeira FROM public.carnes
    WHERE cliente_id=c.id AND instituicao_financeira IS NOT NULL
    ORDER BY data_geracao DESC LIMIT 1
  ) n ON true
  LEFT JOIN LATERAL (
    SELECT origem_venda FROM public.novas_vendas
    WHERE cliente_id=c.id AND origem_venda IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  ) v ON true
  ORDER BY
    CASE WHEN p_sort='recent' THEN c.created_at END DESC,
    CASE WHEN p_sort='old' THEN c.created_at END ASC,
    CASE WHEN p_sort='az' THEN lower(coalesce(c.nome_completo,'')) END ASC,
    CASE WHEN p_sort='za' THEN lower(coalesce(c.nome_completo,'')) END DESC,
    CASE WHEN p_sort IN ('recent','za') THEN c.id END DESC,
    CASE WHEN p_sort IN ('old','az') THEN c.id END ASC;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_admin_clientes_pagina_recent(p_limite integer, p_cursor_created timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_busca text DEFAULT NULL::text, p_funil text DEFAULT 'cadastradas'::text, p_status text DEFAULT NULL::text, p_periodo_inicio timestamp with time zone DEFAULT NULL::timestamp with time zone, p_banco text DEFAULT NULL::text, p_sort text DEFAULT 'recent'::text, p_cursor_name text DEFAULT NULL::text)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH pagina AS MATERIALIZED (
    SELECT c.id,c.nome_completo,c.cpf,c.data_nascimento,c.telefone,c.email,
      c.procedimento,c.medico,c.hospital,c.consultora,c.valor_contrato,
      c.taxa_administrativa_percentual,c.status_cirurgia,c.status_financeiro,
      c.observacoes_internas,c.quantidade_parcelas,c.status_revisao_financeira,
      c.data_atingiu_percentual,c.observacao_revisao_financeira,
      c.financeiro_saldo_restante,c.financeiro_taxa_cartao,c.financeiro_total_com_taxa,
      c.financeiro_formas_custeio,c.financeiro_confirmado_em,c.custeio_confirmado_em,
      c.ativo,c.status_contrato,c.suspenso_desde,c.suspenso_ate,c.suspensao_motivo,
      c.vendedora_id,c.acesso_app_liberado,c.acesso_app_liberado_em,c.inicio_plano,
      c.forma_pagamento_plano,c.instituicao_pagamento,c.dia_cobranca,c.status_plano,
      c.valor_total_plano,c.valor_parcela_plano,c.created_at,c.updated_at
    FROM public.clientes c
    WHERE c.ativo = true
      AND (p_cursor_id IS NULL OR (c.created_at,c.id) < (p_cursor_created,p_cursor_id))
      AND (p_periodo_inicio IS NULL OR c.created_at >= p_periodo_inicio)
      AND (p_status IS NULL OR coalesce(c.status_contrato::text,'ativo') = p_status)
      AND (
        p_funil = 'canceladas' AND c.status_contrato = 'cancelado'
        OR p_funil = 'aguardando' AND c.status_contrato IS DISTINCT FROM 'cancelado'
          AND NOT EXISTS (SELECT 1 FROM public.boletos b WHERE b.cliente_id=c.id)
        OR p_funil = 'cadastradas' AND c.status_contrato IS DISTINCT FROM 'cancelado'
          AND EXISTS (SELECT 1 FROM public.boletos b WHERE b.cliente_id=c.id)
      )
      AND (p_busca IS NULL OR c.nome_completo ILIKE '%'||p_busca||'%'
        OR c.cpf ILIKE '%'||p_busca||'%' OR c.telefone ILIKE '%'||p_busca||'%'
        OR c.consultora ILIKE '%'||p_busca||'%'
        OR EXISTS (SELECT 1 FROM public.novas_vendas v WHERE v.cliente_id=c.id AND v.origem_venda ILIKE '%'||p_busca||'%')
        OR EXISTS (SELECT 1 FROM public.carnes n WHERE n.cliente_id=c.id AND n.instituicao_financeira ILIKE '%'||p_busca||'%'))
      AND (p_banco IS NULL OR (
        SELECT n.instituicao_financeira FROM public.carnes n
        WHERE n.cliente_id=c.id AND n.instituicao_financeira IS NOT NULL
        ORDER BY n.data_geracao DESC LIMIT 1
      ) = p_banco)
    ORDER BY c.created_at DESC,c.id DESC
    LIMIT LEAST(GREATEST(p_limite,1),50)+1
  )
  SELECT to_jsonb(c)
    || jsonb_build_object(
      'porcentagem_pagamento',CASE WHEN b.total>0 THEN round(b.pagos::numeric/b.total*100,1) ELSE NULL END,
      'parcelas_pagas',CASE WHEN b.total>0 THEN b.pagos ELSE NULL END,
      'parcelas_total',CASE WHEN b.total>0 THEN b.total ELSE NULL END,
      'termos_assinados_em',a.termos_assinados_em,
      'proximo_agendamento_data',CASE WHEN a.status='confirmado' THEN a.data ELSE NULL END,
      'proximo_agendamento_horario',CASE WHEN a.status='confirmado' THEN a.horario ELSE NULL END,
      'banco',n.instituicao_financeira,
      'origem_venda',v.origem_venda
    )
  FROM pagina c
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS total,count(*) FILTER (WHERE status='pago')::integer AS pagos
    FROM public.boletos WHERE cliente_id=c.id
  ) b ON true
  LEFT JOIN LATERAL (
    SELECT a.status::text AS status,d.data,a.termos_assinados_em,
      left(a.horario_termos::text,5) AS horario
    FROM public.agendamentos a LEFT JOIN public.datas d ON d.id=a.data_id
    WHERE a.cliente_id=c.id AND a.status IN ('confirmado','realizado')
    ORDER BY (a.status='realizado') DESC,a.created_at DESC LIMIT 1
  ) a ON true
  LEFT JOIN LATERAL (
    SELECT instituicao_financeira FROM public.carnes
    WHERE cliente_id=c.id AND instituicao_financeira IS NOT NULL
    ORDER BY data_geracao DESC LIMIT 1
  ) n ON true
  LEFT JOIN LATERAL (
    SELECT origem_venda FROM public.novas_vendas
    WHERE cliente_id=c.id AND origem_venda IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  ) v ON true
  ORDER BY c.created_at DESC,c.id DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_admin_clientes_totais()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'aguardando',count(*) FILTER (WHERE c.status_contrato IS DISTINCT FROM 'cancelado' AND b.cliente_id IS NULL),
    'cadastradas',count(*) FILTER (WHERE c.status_contrato IS DISTINCT FROM 'cancelado' AND b.cliente_id IS NOT NULL),
    'canceladas',count(*) FILTER (WHERE c.status_contrato='cancelado')
  ) FROM public.clientes c
  LEFT JOIN (SELECT DISTINCT cliente_id FROM public.boletos) b ON b.cliente_id=c.id
  WHERE c.ativo=true;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_admin_dashboard_agenda(p_inicio date, p_fim date, p_hoje date, p_proximos_fim date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH termos AS MATERIALIZED (
    SELECT a.id,a.cliente_id,a.status,a.horario_termos,a.termos_assinados_em,
      a.created_at,d.data,c.nome_completo,c.status_financeiro,c.status_cirurgia
    FROM public.agendamentos a
    JOIN public.datas d ON d.id=a.data_id
    LEFT JOIN public.clientes c ON c.id=a.cliente_id
    WHERE a.status IN ('confirmado','realizado') AND
      ((d.data>=p_inicio AND d.data<p_fim) OR (d.data>=p_hoje AND d.data<p_proximos_fim))
  ),
  cirurgias AS MATERIALIZED (
    SELECT a.id,a.cliente_id,a.status,a.data_cirurgia,
      c.nome_completo,c.status_financeiro,c.status_cirurgia
    FROM public.agendamentos a
    LEFT JOIN public.clientes c ON c.id=a.cliente_id
    WHERE a.status IN ('confirmado','realizado') AND
      ((a.data_cirurgia>=p_inicio AND a.data_cirurgia<p_fim)
        OR (a.data_cirurgia>=p_hoje AND a.data_cirurgia<p_proximos_fim))
  ),
  termos_mes AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'cliente_id',t.cliente_id,'status',t.status,
      'horario_termos',t.horario_termos,'termos_assinados_em',t.termos_assinados_em,
      'datas',jsonb_build_object('data',t.data),
      'clientes',jsonb_build_object('id',t.cliente_id,'nome_completo',t.nome_completo,
        'status_financeiro',t.status_financeiro,'status_cirurgia',t.status_cirurgia))
      ORDER BY t.created_at),'[]'::jsonb) AS itens FROM
      (SELECT * FROM termos WHERE data>=p_inicio AND data<p_fim ORDER BY created_at LIMIT 1000) t
  ),
  termos_proximos AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'cliente_id',t.cliente_id,'status',t.status,
      'horario_termos',t.horario_termos,'termos_assinados_em',t.termos_assinados_em,
      'datas',jsonb_build_object('data',t.data),
      'clientes',jsonb_build_object('id',t.cliente_id,'nome_completo',t.nome_completo,
        'status_financeiro',t.status_financeiro,'status_cirurgia',t.status_cirurgia))
      ORDER BY t.created_at),'[]'::jsonb) AS itens FROM
      (SELECT * FROM termos WHERE data>=p_hoje AND data<p_proximos_fim ORDER BY created_at LIMIT 1000) t
  ),
  cirurgias_mes AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'cliente_id',s.cliente_id,'status',s.status,
      'data_cirurgia',s.data_cirurgia,'clientes',jsonb_build_object('id',s.cliente_id,
        'nome_completo',s.nome_completo,'status_financeiro',s.status_financeiro,
        'status_cirurgia',s.status_cirurgia)) ORDER BY s.data_cirurgia),'[]'::jsonb) AS itens FROM
      (SELECT * FROM cirurgias WHERE data_cirurgia>=p_inicio AND data_cirurgia<p_fim
        ORDER BY data_cirurgia LIMIT 1000) s
  ),
  cirurgias_proximas AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'cliente_id',s.cliente_id,'status',s.status,
      'data_cirurgia',s.data_cirurgia,'clientes',jsonb_build_object('id',s.cliente_id,
        'nome_completo',s.nome_completo,'status_financeiro',s.status_financeiro,
        'status_cirurgia',s.status_cirurgia)) ORDER BY s.data_cirurgia),'[]'::jsonb) AS itens FROM
      (SELECT * FROM cirurgias WHERE data_cirurgia>=p_hoje AND data_cirurgia<p_proximos_fim
        ORDER BY data_cirurgia LIMIT 1000) s
  )
  SELECT jsonb_build_object('termosMes',tm.itens,'termosProximos',tp.itens,
    'cirurgiasMes',cm.itens,'cirurgiasProximas',cp.itens)
  FROM termos_mes tm,termos_proximos tp,cirurgias_mes cm,cirurgias_proximas cp;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_admin_dashboard_stats(p_hoje date, p_inicio date, p_fim date, p_semana_inicio date, p_semana_fim date, p_grafico_inicio date, p_grafico_fim date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH clientes_stats AS (
    SELECT count(*) FILTER (WHERE coalesce(status_contrato::text,'ativo')='ativo') AS ativas,
      count(*) FILTER (WHERE status_contrato::text='suspenso') AS suspensas,
      count(*) FILTER (WHERE status_contrato::text='negativado') AS negativadas,
      count(*) FILTER (WHERE status_contrato::text='cancelado') AS canceladas,
      count(*) FILTER (WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date=p_hoje) AS novas_hoje,
      count(*) FILTER (
        WHERE coalesce(ativo,true)
          AND status_contrato IS DISTINCT FROM 'cancelado'
          AND NOT EXISTS (SELECT 1 FROM public.boletos bx WHERE bx.cliente_id=clientes.id)
      ) AS aguardando_financeiro,
      coalesce(sum(valor_contrato) FILTER (WHERE coalesce(status_contrato::text,'ativo')='ativo'),0) AS valor_ativo
    FROM public.clientes
  ),
  boletos_stats AS (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE status <> 'pago') AS abertos,
      count(*) FILTER (WHERE status <> 'pago' AND NOT coalesce(suspensa,false) AND data_vencimento<p_hoje) AS vencidos,
      count(*) FILTER (WHERE status='pendente_confirmacao') AS conferencia,
      count(*) FILTER (WHERE status <> 'pago' AND data_vencimento IS NULL) AS sem_vencimento,
      count(*) FILTER (WHERE status='pago' AND data_pagamento>=p_inicio AND data_pagamento<p_fim) AS pagos_mes,
      count(*) FILTER (WHERE status='pago' AND data_pagamento>=p_semana_inicio AND data_pagamento<p_semana_fim) AS pagos_semana,
      coalesce(sum(valor) FILTER (WHERE status <> 'pago'),0) AS valor_aberto,
      coalesce(sum(valor) FILTER (WHERE status <> 'pago' AND NOT coalesce(suspensa,false) AND data_vencimento<p_hoje),0) AS valor_vencido,
      coalesce(sum(valor) FILTER (WHERE status='pago' AND data_pagamento>=p_inicio AND data_pagamento<p_fim),0) AS valor_mes,
      coalesce(sum(valor) FILTER (WHERE status='pago' AND data_pagamento>=p_semana_inicio AND data_pagamento<p_semana_fim),0) AS valor_semana
    FROM public.boletos
  ),
  inadimplentes AS (
    SELECT count(*) AS total FROM (
      SELECT cliente_id FROM public.boletos
      WHERE status <> 'pago' AND NOT coalesce(suspensa,false) AND data_vencimento<p_hoje
      GROUP BY cliente_id
    ) inadimplentes_unicos
  ),
  prontos AS (
    SELECT count(*) AS total FROM public.clientes c
    WHERE NOT coalesce(c.acesso_app_liberado,false)
      AND c.nome_completo IS NOT NULL AND c.nome_completo <> ''
      AND regexp_replace(coalesce(c.cpf,''),'[^0-9]','','g') ~ '^[0-9]{11}$'
      AND c.data_nascimento IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.boletos b WHERE b.cliente_id=c.id)
  ),
  recentes AS (
    SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC),'[]'::jsonb) AS itens
    FROM (SELECT id,nome_completo,cpf,created_at,status_contrato
      FROM public.clientes ORDER BY created_at DESC LIMIT 6) c
  ),
  revisoes AS (
    SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC),'[]'::jsonb) AS itens
    FROM (SELECT p.id,p.nome_completo,p.valor_contrato,p.quantidade_parcelas,p.created_at,
      b.total AS parcelas_total,b.pagas AS parcelas_pagas
      FROM (SELECT id,nome_completo,valor_contrato,quantidade_parcelas,created_at
        FROM public.clientes WHERE status_revisao_financeira='pendente'
        ORDER BY created_at DESC LIMIT 8) p
      LEFT JOIN LATERAL (SELECT count(*) AS total,count(*) FILTER (WHERE status='pago') AS pagas
        FROM public.boletos WHERE cliente_id=p.id) b ON true) c
  ),
  comprovantes AS (
    SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.data_vencimento ASC NULLS LAST),'[]'::jsonb) AS itens
    FROM (SELECT b.id,b.cliente_id,b.numero_parcela,b.total_parcelas,b.valor,b.data_pagamento,b.data_vencimento,c.nome_completo
      FROM public.boletos b LEFT JOIN public.clientes c ON c.id=b.cliente_id
      WHERE b.status='pendente_confirmacao'
      ORDER BY b.data_vencimento ASC NULLS LAST LIMIT 8) b
  ),
  grafico AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('mes',to_char(m.mes,'YYYY-MM'),
      'previsto',coalesce(prev.previsto,0),'recebido',coalesce(rec.valor,0),'vencido',coalesce(prev.vencido,0))
      ORDER BY m.mes),'[]'::jsonb) AS itens
    FROM generate_series(p_grafico_inicio::timestamp,(p_grafico_fim-interval '1 day')::timestamp,interval '1 month') m(mes)
    LEFT JOIN (SELECT date_trunc('month',data_vencimento)::date mes,
        sum(valor) previsto,
        sum(valor) FILTER (WHERE status<>'pago' AND NOT coalesce(suspensa,false)
          AND data_vencimento<p_hoje) vencido
      FROM public.boletos WHERE data_vencimento>=p_grafico_inicio
        AND data_vencimento<p_grafico_fim GROUP BY 1) prev ON prev.mes=m.mes::date
    LEFT JOIN (SELECT date_trunc('month',data_pagamento)::date mes,sum(valor) valor FROM public.boletos
      WHERE status='pago' AND data_pagamento>=p_grafico_inicio AND data_pagamento<p_grafico_fim GROUP BY 1) rec ON rec.mes=m.mes::date
  ),
  dispositivos AS (
    SELECT count(*) total,
      count(*) FILTER (WHERE is_pwa_installed=true) instalados,
      count(*) FILTER (WHERE last_access_at IS NULL OR last_access_at<now()-interval '7 days') sem_acesso
    FROM public.cliente_app_devices
  ),
  novas_vendas AS (SELECT count(*) total FROM public.novas_vendas WHERE status='aguardando_cadastro' AND cliente_id IS NULL),
  notificacoes AS (SELECT count(*) total FROM public.notificacao_logs
    WHERE created_at >= (p_hoje::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND created_at < ((p_hoje+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AND push_enviadas>0),
  vapid AS (SELECT count(DISTINCT chave) FILTER (WHERE chave IN ('vapid_public_key','vapid_private_key','vapid_subject'))=3 AS configurado
    FROM public.integracoes_credenciais WHERE provedor='web_push' AND ativo=true),
  atividade AS (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC),'[]'::jsonb) AS itens
    FROM (SELECT usuario,acao,entidade,created_at FROM public.logs_alteracoes ORDER BY created_at DESC LIMIT 8) l)
  SELECT jsonb_build_object(
    'clientes',to_jsonb(c),'boletos',to_jsonb(b)||jsonb_build_object('inadimplentes',i.total),
    'clientesProntasAcessoApp',p.total,'novasClientesRecentes',r.itens,
    'clientesAguardandoLiberacao',rv.itens,'comprovantesPendentes',cp.itens,
    'financeiroMensal',g.itens,'dispositivos',to_jsonb(d),
    'novasVendas',nv.total,'notificacoesHoje',nf.total,
    'webPushConfigurado',v.configurado,'atividadeRecente',a.itens
  ) FROM clientes_stats c,boletos_stats b,inadimplentes i,prontos p,recentes r,revisoes rv,
    comprovantes cp,grafico g,dispositivos d,novas_vendas nv,notificacoes nf,vapid v,atividade a;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_admin_forecast_page(p_limite integer DEFAULT 50, p_antes_criado timestamp with time zone DEFAULT NULL::timestamp with time zone, p_antes_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH pagina AS MATERIALIZED (
    SELECT id,nome_completo,cpf,quantidade_parcelas,consultora,
      data_atingiu_percentual,valor_contrato,ativo,created_at
    FROM public.clientes
    WHERE p_antes_criado IS NULL OR (created_at,id)<(p_antes_criado,p_antes_id)
    ORDER BY created_at DESC,id DESC
    LIMIT greatest(1,least(coalesce(p_limite,50),50))
  ), itens AS (
    SELECT p.created_at,p.id,jsonb_build_object(
      'cliente',to_jsonb(p),
      'parcelas',coalesce(b.parcelas,'[]'::jsonb),
      'contrato',NULL::jsonb,
      'crm',to_jsonb(cr)
    ) AS dados FROM pagina p
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.numero_parcela,b.data_vencimento NULLS LAST) AS parcelas
      FROM (SELECT numero_parcela,total_parcelas,status,data_vencimento,
        data_pagamento,suspensa,created_at
        FROM public.boletos WHERE cliente_id=p.id) b
    ) b ON true
    LEFT JOIN LATERAL (
      SELECT cliente_cpf,campanha,origem,vendedor,status,created_at
      FROM public.crm_vendas_entrada
      WHERE regexp_replace(coalesce(cliente_cpf,''),'[^0-9]','','g')
        = regexp_replace(coalesce(p.cpf,''),'[^0-9]','','g')
      ORDER BY created_at DESC LIMIT 1
    ) cr ON true
  ), cursor_final AS (
    SELECT jsonb_build_object('criado',created_at,'id',id) AS valor
    FROM pagina ORDER BY created_at ASC,id ASC LIMIT 1
  )
  SELECT jsonb_build_object(
    'itens',(SELECT coalesce(jsonb_agg(dados ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM itens),
    'total',(SELECT count(*) FROM public.clientes),
    'cursor',(SELECT valor FROM cursor_final)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_admin_integration_checks()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(jsonb_object_agg(provedor, jsonb_build_object(
    'created_at', created_at, 'detalhes', detalhes
  )), '{}'::jsonb)
  FROM (
    SELECT DISTINCT ON (detalhes->>'provedor')
      detalhes->>'provedor' AS provedor, created_at, detalhes
    FROM public.logs_alteracoes
    WHERE acao = 'testou_conexao_integracao'
      AND detalhes->>'provedor' = ANY (ARRAY[
        'web_push','mercado_pago','conta_azul','rd_station','gemini',
        'brb','bb','santander','sicredi','efi'
      ])
    ORDER BY detalhes->>'provedor', created_at DESC
  ) AS recentes;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_admin_integration_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE conta_azul_total bigint;
BEGIN
  IF to_regclass('public.conta_azul_operacoes') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.conta_azul_operacoes' INTO conta_azul_total;
  END IF;

  RETURN jsonb_build_object(
    'estados', (SELECT coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
      FROM (SELECT provedor,ativo,atualizado_por,atualizado_em FROM public.integracoes_estado) e),
    'disponibilidade', jsonb_build_object(
      'push', to_regclass('public.web_push_subscriptions') IS NOT NULL,
      'eventos', to_regclass('public.integracao_eventos') IS NOT NULL,
      'pagamentos', to_regclass('public.pagamentos_externos') IS NOT NULL,
      'contaAzul', to_regclass('public.conta_azul_operacoes') IS NOT NULL,
      'crm', to_regclass('public.crm_vendas_entrada') IS NOT NULL,
      'vendas', to_regclass('public.novas_vendas') IS NOT NULL,
      'frases', to_regclass('public.mensagens_do_dia') IS NOT NULL
    ),
    'contagens', jsonb_build_object(
      'push', (SELECT count(*) FROM public.web_push_subscriptions),
      'pagamentos', (SELECT count(*) FROM public.pagamentos_externos),
      'contaAzul', conta_azul_total,
      'vendas', (SELECT count(*) FROM public.novas_vendas),
      'frasesIa', (SELECT count(*) FROM public.mensagens_do_dia WHERE origem='ia')
    ),
    'rd', jsonb_build_object(
      'ultimaSincronizacao', (SELECT created_at FROM public.integracao_eventos
        WHERE provedor='rd_station' AND event_type='sync_manual'
        ORDER BY created_at DESC LIMIT 1),
      'erros', (SELECT count(*) FROM public.integracao_eventos
        WHERE provedor='rd_station' AND status='erro'),
      'ultimoWebhook', (SELECT created_at FROM public.crm_vendas_entrada
        WHERE provedor='rd_station' ORDER BY created_at DESC LIMIT 1)
    ),
    'verificacoes', public.loadtest_admin_integration_checks()
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_agenda_cirurgia_datas_snapshot(p_hoje date)
 RETURNS TABLE(id uuid, data date, vagas_restantes integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT d.id, d.data,
         GREATEST(0, d.vagas_totais - count(a.id)::integer) AS vagas_restantes
  FROM public.datas_liberacao_financeira AS d
  LEFT JOIN public.agendamentos AS a
    ON a.data_cirurgia = d.data AND a.status IN ('confirmado', 'realizado')
  WHERE d.status = 'disponivel' AND d.fechamento_manual = false AND d.data >= p_hoje
  GROUP BY d.id, d.data, d.vagas_totais
  ORDER BY d.data;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_agenda_datas_snapshot(p_hoje date)
 RETURNS TABLE(id uuid, data date, vagas_restantes integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT d.id, d.data,
         GREATEST(0, d.vagas_totais - count(a.id)::integer) AS vagas_restantes
  FROM public.datas AS d
  LEFT JOIN public.agendamentos AS a
    ON a.data_id = d.id AND a.status = 'confirmado'
  WHERE d.status = 'disponivel' AND d.data >= p_hoje
  GROUP BY d.id, d.data, d.vagas_totais
  ORDER BY d.data;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_cliente_agenda_snapshot(p_cliente_id uuid, p_hoje date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_agendamentos jsonb;
  v_agendamento_id uuid;
  v_cirurgica_id uuid;
  v_solicitacao jsonb;
  v_remarcacoes jsonb := '[]'::jsonb;
  v_datas_cirurgia jsonb := '[]'::jsonb;
  v_minima date;
  v_comprometimento jsonb := '{}'::jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(linha) - 'created_at_ord' ORDER BY linha.created_at_ord DESC),'[]'::jsonb)
    INTO v_agendamentos FROM (
      SELECT a.id,a.data_id,a.status,a.horario_termos,a.termos_assinados_em,
        a.comparecimento_status,a.comparecimento_em,a.quitacao_status,a.quitacao_em,
        a.previsao_cirurgia,a.previsao_cirurgia_confirmada_em,a.data_cirurgia,
        a.horario_cirurgia,a.valor_contrato,a.agenda_cirurgica_liberada_em,
        a.created_at,a.created_at AS created_at_ord,
        jsonb_build_object('data',d.data) AS datas
      FROM public.agendamentos a LEFT JOIN public.datas d ON d.id=a.data_id
      WHERE a.cliente_id=p_cliente_id AND a.status IN ('confirmado','realizado')
    ) linha;

  SELECT a.id INTO v_agendamento_id FROM public.agendamentos a
    WHERE a.cliente_id=p_cliente_id AND a.status IN ('confirmado','realizado')
    ORDER BY (a.status='confirmado') DESC,a.created_at DESC LIMIT 1;
  SELECT a.id INTO v_cirurgica_id FROM public.agendamentos a
    WHERE a.id=v_agendamento_id AND a.agenda_cirurgica_liberada_em IS NOT NULL
      AND a.data_cirurgia IS NULL;

  SELECT to_jsonb(linha) INTO v_solicitacao FROM (
    SELECT id,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa,
      status,observacao,agendamento_id,created_at,updated_at
    FROM public.solicitacoes_liberacao_financeira
    WHERE cliente_id=p_cliente_id ORDER BY created_at DESC LIMIT 1
  ) linha;

  IF v_agendamento_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(linha) - 'created_at_ord' ORDER BY linha.created_at_ord DESC),'[]'::jsonb)
      INTO v_remarcacoes FROM (
        SELECT id,tipo,status,data_solicitada,horario_termos,observacao,
          created_at,updated_at,created_at AS created_at_ord
        FROM public.solicitacoes_remarcacao_agendamento
        WHERE cliente_id=p_cliente_id AND agendamento_id=v_agendamento_id
      ) linha;
  END IF;

  IF v_cirurgica_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(linha) ORDER BY linha.data),'[]'::jsonb)
      INTO v_datas_cirurgia
    FROM public.loadtest_agenda_cirurgia_datas_snapshot(p_hoje) linha;
    SELECT public.agenda_data_minima_cirurgia(v_cirurgica_id) INTO v_minima;
    SELECT coalesce(jsonb_object_agg(mes,valor),'{}'::jsonb)
      INTO v_comprometimento FROM (
        SELECT to_char(m.inicio,'YYYY-MM') AS mes,
          public.agenda_comprometimento_mes(m.inicio,p_cliente_id) AS valor
        FROM (
          SELECT DISTINCT date_trunc('month',(item->>'data')::date)::date AS inicio
          FROM jsonb_array_elements(v_datas_cirurgia) item
        ) m
      ) mensal;
  END IF;

  RETURN jsonb_build_object(
    'agendamentos',v_agendamentos,
    'elegivel',public.pode_agendar(p_cliente_id),
    'solicitacao',v_solicitacao,
    'remarcacoes',v_remarcacoes,
    'datas_disponiveis',(
      SELECT coalesce(jsonb_agg(to_jsonb(linha) ORDER BY linha.data),'[]'::jsonb)
      FROM public.loadtest_agenda_datas_snapshot(p_hoje) linha
    ),
    'datas_cirurgia',v_datas_cirurgia,
    'data_minima',v_minima,
    'comprometido_por_mes',v_comprometimento
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_cliente_financeiro_snapshot(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'boletos', (
      SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.numero_parcela), '[]'::jsonb)
      FROM (
        SELECT id,numero_parcela,total_parcelas,valor,data_vencimento,status,
               data_pagamento,comprovante_url,boleto_url
        FROM public.boletos WHERE cliente_id = p_cliente_id
        ORDER BY numero_parcela
      ) AS b
    ),
    'porcentagem_pagamento', public.porcentagem_pagamento(p_cliente_id),
    'pode_agendar', public.pode_agendar(p_cliente_id),
    'agenda_liberada', public.agenda_liberada(p_cliente_id)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_finance_client_funnel(p_bucket text, p_busca text, p_ordenacao text, p_pagina integer, p_limite integer, p_hoje date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE resultado jsonb;
BEGIN
  IF p_pagina < 1 OR p_pagina > 100000 OR p_limite < 1 OR p_limite > 100
      OR p_bucket NOT IN ('todos','aguardando_conferencia','ativos','suspensos','negativados','cancelados')
      OR p_ordenacao NOT IN ('venc','saldo','az','za') THEN
    RAISE EXCEPTION 'Filtro financeiro invalido';
  END IF;

  WITH latest AS MATERIALIZED (
    SELECT DISTINCT ON (boleto_id) boleto_id,juros,multa,desconto
    FROM public.financeiro_recebimentos
    ORDER BY boleto_id,(status_validacao='validado') DESC,created_at DESC
  ), agregado AS MATERIALIZED (
    SELECT b.cliente_id,count(*)::integer AS total,
      count(*) FILTER (WHERE NOT b.suspensa AND b.status::text='pago')::integer AS pagas,
      coalesce(sum(round(coalesce(b.valor,0),2)+round(coalesce(r.juros,0),2)
        +round(coalesce(r.multa,0),2)-round(coalesce(r.desconto,0),2))
        FILTER (WHERE b.suspensa OR b.status::text<>'pago'),0) AS saldo,
      count(*) FILTER (WHERE NOT b.suspensa AND b.status::text='nao_pago' AND b.data_vencimento<p_hoje)::integer AS vencidas,
      count(*) FILTER (WHERE NOT b.suspensa AND b.status::text='pendente_confirmacao')::integer AS aguardando,
      min(b.data_vencimento) FILTER (WHERE b.suspensa OR b.status::text<>'pago') AS proximo_vencimento
    FROM public.boletos b LEFT JOIN latest r ON r.boleto_id=b.id
    GROUP BY b.cliente_id
  ), vendas AS MATERIALIZED (
    SELECT DISTINCT ON (cliente_id) cliente_id,origem_venda FROM public.novas_vendas
    WHERE cliente_id IS NOT NULL AND origem_venda IS NOT NULL
    ORDER BY cliente_id,created_at,id
  ), todos AS MATERIALIZED (
    SELECT c.id AS cliente_id,c.nome_completo AS nome,c.cpf,c.status_contrato::text AS status_contrato,
      c.consultora AS vendedora,v.origem_venda AS campanha,a.total,a.pagas,a.saldo,a.vencidas,a.aguardando,a.proximo_vencimento,
      CASE WHEN c.status_contrato::text='cancelado' THEN 'cancelados'
        WHEN c.status_contrato::text='negativado' THEN 'negativados'
        WHEN c.status_contrato::text='suspenso' THEN 'suspensos'
        WHEN a.aguardando>0 THEN 'aguardando_conferencia' ELSE 'ativos' END AS bucket
    FROM agregado a JOIN public.clientes c ON c.id=a.cliente_id
      LEFT JOIN vendas v ON v.cliente_id=c.id
  ), filtrados AS MATERIALIZED (
    SELECT * FROM todos WHERE (p_bucket='todos' OR bucket=p_bucket)
      AND (coalesce(p_busca,'')='' OR concat_ws(' ',nome,cpf,vendedora,campanha) ILIKE '%' || p_busca || '%')
  ), pagina AS (
    SELECT * FROM filtrados ORDER BY
      CASE WHEN p_ordenacao='venc' THEN proximo_vencimento END ASC NULLS LAST,
      CASE WHEN p_ordenacao='saldo' THEN saldo END DESC NULLS LAST,
      CASE WHEN p_ordenacao='az' THEN nome END ASC NULLS LAST,
      CASE WHEN p_ordenacao='za' THEN nome END DESC NULLS LAST,
      cliente_id ASC
    LIMIT p_limite OFFSET (p_pagina-1)*p_limite
  )
  SELECT jsonb_build_object(
    'total',(SELECT count(*) FROM filtrados),
    'funis',jsonb_build_array(
      jsonb_build_object('bucket','aguardando_conferencia','total',(SELECT count(*) FROM todos WHERE bucket='aguardando_conferencia')),
      jsonb_build_object('bucket','ativos','total',(SELECT count(*) FROM todos WHERE bucket='ativos')),
      jsonb_build_object('bucket','todos','total',(SELECT count(*) FROM todos)),
      jsonb_build_object('bucket','suspensos','total',(SELECT count(*) FROM todos WHERE bucket='suspensos')),
      jsonb_build_object('bucket','negativados','total',(SELECT count(*) FROM todos WHERE bucket='negativados')),
      jsonb_build_object('bucket','cancelados','total',(SELECT count(*) FROM todos WHERE bucket='cancelados'))),
    'itens',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM pagina p)
  ) INTO resultado;
  RETURN resultado;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_finance_receivables_page(p_inicio date, p_fim date, p_status text, p_busca text, p_pagina integer, p_limite integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE resultado jsonb;
BEGIN
  IF p_pagina < 1 OR p_pagina > 100000 OR p_limite < 1 OR p_limite > 100 THEN
    RAISE EXCEPTION 'Paginacao invalida';
  END IF;
  WITH latest AS MATERIALIZED (
    SELECT DISTINCT ON (boleto_id) boleto_id,status_validacao,juros,multa,desconto,valor_recebido,
      forma_pagamento,origem_boleto,origem,instituicao_financeira,instituicao_conta,data_pagamento,
      comprovante_url,external_payment_id,external_reference,observacao
    FROM public.financeiro_recebimentos
    ORDER BY boleto_id,(status_validacao='validado') DESC,created_at DESC
  ), filtrados AS MATERIALIZED (
    SELECT b.id,b.cliente_id,b.numero_parcela,b.total_parcelas,b.valor,b.data_vencimento,
      b.status,b.comprovante_url,b.data_pagamento,b.observacoes,b.created_at,b.updated_at,b.suspensa,
      c.nome_completo,c.cpf,
      r.status_validacao,r.juros,r.multa,r.desconto,r.valor_recebido,r.forma_pagamento,
      r.origem_boleto,r.origem,r.instituicao_financeira,r.instituicao_conta,
      r.data_pagamento AS recebimento_data,r.comprovante_url AS recebimento_comprovante,
      r.external_payment_id,r.external_reference,r.observacao
    FROM public.boletos b JOIN public.clientes c ON c.id=b.cliente_id
      LEFT JOIN latest r ON r.boleto_id=b.id
    WHERE (b.data_vencimento BETWEEN p_inicio AND p_fim OR b.data_vencimento IS NULL)
      AND (p_status='todos' OR p_status=CASE WHEN b.suspensa THEN 'suspensa'
        WHEN b.status::text='nao_pago' AND b.data_vencimento < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'vencido'
        ELSE b.status::text END)
      AND (coalesce(p_busca,'')='' OR concat_ws(' ',c.nome_completo,c.cpf,
        b.numero_parcela::text||'/'||b.total_parcelas::text,r.external_payment_id) ILIKE '%' || p_busca || '%')
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM filtrados),
    'itens',(SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.data_vencimento,page.id),'[]'::jsonb)
      FROM (SELECT * FROM filtrados ORDER BY data_vencimento,id
        LIMIT p_limite OFFSET (p_pagina-1)*p_limite) page)) INTO resultado;
  RETURN resultado;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_finance_received_page(p_tipo text, p_data date, p_busca text, p_pagina integer, p_limite integer, p_hoje date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE resultado jsonb;
BEGIN
  IF p_tipo NOT IN ('recebidos','vencidos') OR p_pagina<1 OR p_pagina>100000
    OR p_limite<1 OR p_limite>100 THEN RAISE EXCEPTION 'Filtro financeiro invalido'; END IF;

  WITH candidatos AS MATERIALIZED (
    SELECT r.boleto_id,r.id AS recebimento_id,r.validado_em AS confirmado_em,NULL::date AS vencimento
    FROM public.financeiro_recebimentos r
    WHERE p_tipo='recebidos' AND r.status_validacao='validado'
      AND r.validado_em >= (p_data::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND r.validado_em < ((p_data+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    UNION ALL
    SELECT b.id,NULL::uuid,NULL::timestamptz,b.data_vencimento FROM public.boletos b
    WHERE p_tipo='vencidos' AND b.status::text='nao_pago' AND NOT b.suspensa AND b.data_vencimento<p_hoje
  ), filtrados AS MATERIALIZED (
    SELECT can.* FROM candidatos can
    WHERE coalesce(p_busca,'')='' OR EXISTS (
      SELECT 1 FROM public.boletos b JOIN public.clientes c ON c.id=b.cliente_id
        LEFT JOIN LATERAL (
          SELECT origem_boleto,origem,forma_pagamento FROM public.financeiro_recebimentos r
          WHERE r.boleto_id=b.id
          ORDER BY (r.status_validacao='validado') DESC,r.created_at DESC LIMIT 1
        ) atual ON true
      WHERE b.id=can.boleto_id AND concat_ws(' ',c.nome_completo,c.cpf,
        b.numero_parcela::text||'/'||b.total_parcelas::text,
        coalesce(atual.origem_boleto,atual.origem,'interno'),atual.forma_pagamento)
        ILIKE '%' || p_busca || '%'
    )
  ), pagina AS (
    SELECT * FROM filtrados ORDER BY
      CASE WHEN p_tipo='recebidos' THEN confirmado_em END DESC NULLS LAST,
      CASE WHEN p_tipo='vencidos' THEN vencimento END ASC NULLS LAST,boleto_id ASC
    LIMIT p_limite OFFSET (p_pagina-1)*p_limite
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM filtrados),
    'itens',(SELECT coalesce(jsonb_agg(to_jsonb(linha)),'[]'::jsonb)
      FROM (SELECT b.id,b.cliente_id,b.numero_parcela,b.total_parcelas,b.valor,b.data_vencimento,
        b.status,b.comprovante_url,b.data_pagamento,b.observacoes,b.created_at,b.updated_at,b.suspensa,
        c.nome_completo,c.cpf,atual.id AS ultimo_recebimento_id,
        atual.status_validacao,atual.juros,atual.multa,atual.desconto,atual.valor_recebido,
        atual.forma_pagamento,atual.origem_boleto,atual.origem,atual.instituicao_financeira,
        atual.instituicao_conta,atual.data_pagamento AS recebimento_data,
        atual.comprovante_url AS recebimento_comprovante,atual.external_payment_id,
        atual.external_reference,atual.observacao,p.recebimento_id,p.confirmado_em
        FROM pagina p JOIN public.boletos b ON b.id=p.boleto_id
          JOIN public.clientes c ON c.id=b.cliente_id
          LEFT JOIN LATERAL (
            SELECT id,status_validacao,juros,multa,desconto,valor_recebido,forma_pagamento,
              origem_boleto,origem,instituicao_financeira,instituicao_conta,data_pagamento,
              comprovante_url,external_payment_id,external_reference,observacao
            FROM public.financeiro_recebimentos r WHERE r.boleto_id=b.id
            ORDER BY (r.status_validacao='validado') DESC,r.created_at DESC LIMIT 1
          ) atual ON true
        ORDER BY CASE WHEN p_tipo='recebidos' THEN p.confirmado_em END DESC NULLS LAST,
          CASE WHEN p_tipo='vencidos' THEN b.data_vencimento END ASC NULLS LAST,b.id
      ) linha)) INTO resultado;
  RETURN resultado;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.loadtest_finance_summary(p_inicio date, p_fim date, p_hoje date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH ids AS MATERIALIZED (
  SELECT id FROM public.boletos WHERE data_vencimento BETWEEN p_inicio AND p_fim
  UNION
  SELECT id FROM public.boletos WHERE data_vencimento BETWEEN p_hoje AND p_hoje + 90
  UNION
  SELECT id FROM public.boletos WHERE data_pagamento BETWEEN p_inicio AND p_fim
  UNION
  SELECT boleto_id FROM public.financeiro_recebimentos
    WHERE status_validacao = 'validado' AND data_pagamento BETWEEN p_inicio AND p_fim
), latest AS MATERIALIZED (
  SELECT DISTINCT ON (boleto_id) boleto_id,status_validacao,data_pagamento,valor_recebido
  FROM public.financeiro_recebimentos
  ORDER BY boleto_id,(status_validacao = 'validado') DESC,created_at DESC
), base AS MATERIALIZED (
  SELECT b.data_vencimento AS vencimento,b.status::text AS status,b.suspensa,
    coalesce(b.valor,0)::numeric AS previsto,
    CASE WHEN r.status_validacao = 'validado' THEN r.data_pagamento ELSE b.data_pagamento END AS data_recebida,
    CASE WHEN r.status_validacao = 'validado' THEN coalesce(r.valor_recebido,0)
         WHEN b.status::text = 'pago' THEN coalesce(b.valor,0) ELSE 0 END::numeric AS realizado,
    CASE WHEN coalesce(c.custo_total,0) > 0
      THEN (coalesce(greatest(0,coalesce(c.custo_total,0)-coalesce(c.valor_contrato,0)),0)
         + CASE WHEN coalesce(c.custo_total,0)-coalesce(c.valor_contrato,0) <= 0
             THEN coalesce(c.valor_contrato,0)*coalesce(c.taxa_administrativa_percentual,0)/100
             ELSE 0 END) / c.custo_total
      ELSE 0 END::numeric AS fracao_receita
  FROM ids JOIN public.boletos b ON b.id=ids.id
    JOIN public.clientes c ON c.id=b.cliente_id
    LEFT JOIN latest r ON r.boleto_id=b.id
), valores AS MATERIALIZED (
  SELECT *, vencimento BETWEEN p_inicio AND p_fim AS em_periodo,
    data_recebida BETWEEN p_inicio AND p_fim AS recebido_periodo,
    round(previsto*fracao_receita,2) AS receita_futura,
    round(realizado*fracao_receita,2) AS receita_realizada,
    (NOT suspensa AND status='nao_pago' AND vencimento < p_hoje) AS vencido
  FROM base
), totais AS (
  SELECT coalesce(sum(previsto) FILTER (WHERE em_periodo),0) AS a_receber,
    coalesce(sum(realizado) FILTER (WHERE recebido_periodo),0) AS recebido,
    coalesce(sum(previsto) FILTER (WHERE em_periodo AND vencido),0) AS vencido,
    count(*) FILTER (WHERE em_periodo AND status='pendente_confirmacao') AS aguardando,
    coalesce(sum(receita_realizada) FILTER (WHERE recebido_periodo),0) AS receita_realizada,
    coalesce(sum(receita_futura) FILTER (WHERE em_periodo AND status<>'pago'),0) AS receita_futura,
    coalesce(sum(previsto) FILTER (WHERE status<>'pago' AND NOT suspensa AND vencimento BETWEEN p_hoje AND p_hoje+30),0) AS dias30,
    coalesce(sum(previsto) FILTER (WHERE status<>'pago' AND NOT suspensa AND vencimento BETWEEN p_hoje AND p_hoje+60),0) AS dias60,
    coalesce(sum(previsto) FILTER (WHERE status<>'pago' AND NOT suspensa AND vencimento BETWEEN p_hoje AND p_hoje+90),0) AS dias90
  FROM valores
), meses AS (
  SELECT to_char(date_trunc('month',coalesce(data_recebida,vencimento)), 'MM/YYYY') AS label,
    date_trunc('month',coalesce(data_recebida,vencimento)) AS mes,
    round(coalesce(sum(previsto) FILTER (WHERE em_periodo),0),2) AS previsto,
    round(coalesce(sum(realizado) FILTER (WHERE recebido_periodo),0),2) AS realizado,
    round(coalesce(sum(previsto) FILTER (WHERE em_periodo AND vencido),0),2) AS vencido,
    round(coalesce(sum(receita_realizada) FILTER (WHERE recebido_periodo),0),2) AS "receitaRealizada",
    round(coalesce(sum(receita_futura) FILTER (WHERE em_periodo AND status<>'pago'),0),2) AS "receitaFutura"
  FROM valores WHERE em_periodo OR recebido_periodo
  GROUP BY date_trunc('month',coalesce(data_recebida,vencimento))
)
SELECT jsonb_build_object(
  'periodo',jsonb_build_object('inicio',p_inicio,'fim',p_fim),
  'kpis',jsonb_build_object('aReceber',round(t.a_receber,2),'recebido',round(t.recebido,2),
    'vencido',round(t.vencido,2),'aguardandoValidacao',t.aguardando,
    'divergencias',NULL,'divergenciasDisponiveis',false,
    'receitaAdministrativaRealizada',round(t.receita_realizada,2),
    'receitaAdministrativaFutura',round(t.receita_futura,2)),
  'previsao',jsonb_build_object('dias30',round(t.dias30,2),'dias60',round(t.dias60,2),'dias90',round(t.dias90,2)),
  'evolucao',(SELECT coalesce(jsonb_agg(to_jsonb(m)-'mes' ORDER BY m.mes),'[]'::jsonb) FROM meses m),
  'ultimaAtualizacao',now(),'truncado',false
) FROM totais t;
$function$
;

CREATE OR REPLACE FUNCTION public.login_limpar_rate_limit(p_chave text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from public.login_rate_limits
   where chave = p_chave;
$function$
;

CREATE OR REPLACE FUNCTION public.login_limpar_rate_limits_expirados()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_removidos integer;
begin
  delete from public.login_rate_limits
   where updated_at < now() - interval '2 days'
     and (bloqueado_ate is null or bloqueado_ate < now());

  get diagnostics v_removidos = row_count;
  return v_removidos;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.login_pode_tentar(p_chave text, p_max_falhas integer DEFAULT 8, p_janela_segundos integer DEFAULT 900)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v login_rate_limits%rowtype;
begin
  select *
    into v
    from public.login_rate_limits
   where chave = p_chave
   for update;

  if not found then
    insert into public.login_rate_limits (chave)
    values (p_chave);

    return true;
  end if;

  if v.bloqueado_ate is not null
     and v.bloqueado_ate > now() then
    return false;
  end if;

  if v.janela_iniciada_em <= now() - make_interval(secs => p_janela_segundos) then
    update public.login_rate_limits
       set falhas = 0,
           janela_iniciada_em = now(),
           bloqueado_ate = null,
           updated_at = now()
     where chave = p_chave;

    return true;
  end if;

  return v.falhas < p_max_falhas;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.login_registrar_falha(p_chave text, p_max_falhas integer DEFAULT 8, p_janela_segundos integer DEFAULT 900)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v login_rate_limits%rowtype;
  v_falhas integer;
begin
  select *
    into v
    from public.login_rate_limits
   where chave = p_chave
   for update;

  if not found then
    insert into public.login_rate_limits (
      chave,
      falhas
    )
    values (
      p_chave,
      1
    );

    return true;
  end if;

  if v.janela_iniciada_em <= now() - make_interval(secs => p_janela_segundos) then
    update public.login_rate_limits
       set falhas = 1,
           janela_iniciada_em = now(),
           bloqueado_ate = null,
           updated_at = now()
     where chave = p_chave;

    return true;
  end if;

  v_falhas := v.falhas + 1;

  update public.login_rate_limits
     set falhas = v_falhas,
         bloqueado_ate = case
           when v_falhas >= p_max_falhas
           then now() + make_interval(secs => p_janela_segundos)
           else bloqueado_ate
         end,
         updated_at = now()
   where chave = p_chave;

  return v_falhas < p_max_falhas;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notificacao_data_br(p_data date)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when p_data is null then '' else to_char(p_data, 'DD/MM/YYYY') end
$function$
;

CREATE OR REPLACE FUNCTION public.notificacao_horario_br(p_hora time without time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_hora is null then ''
    when extract(minute from p_hora) = 0 then ' às ' || to_char(p_hora, 'FMHH24') || 'h'
    else ' às ' || to_char(p_hora, 'FMHH24') || 'h' || to_char(p_hora, 'MI')
  end
$function$
;

CREATE OR REPLACE FUNCTION public.notificacao_motivo(p_texto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when nullif(btrim(p_texto), '') is null then '' else ' Motivo: ' || rtrim(btrim(p_texto), '.') || '.' end
$function$
;

CREATE OR REPLACE FUNCTION public.notificacoes_lembretes_agenda()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_total integer := 0;
  r record;
begin
  for r in
    select a.id, a.cliente_id, d.data, a.horario_termos
    from public.agendamentos a
    join public.datas d on d.id = a.data_id
    join public.clientes c on c.id = a.cliente_id
    where a.status = 'confirmado'
      and coalesce(a.comparecimento_status, 'pendente') <> 'compareceu'
      and d.data in (v_hoje, v_hoje + 1)
      and c.ativo is not false
  loop
    if public.notificar_cliente(r.cliente_id,
      case when r.data = v_hoje then 'termos_lembrete_dia' else 'termos_lembrete_vespera' end,
      jsonb_build_object('data', public.notificacao_data_br(r.data), 'horario', public.notificacao_horario_br(r.horario_termos)),
      r.id, 'lembrete:' || r.id::text || ':' || r.data::text || ':' || case when r.data = v_hoje then 'dia' else 'vespera' end) is not null then
      v_total := v_total + 1;
    end if;
  end loop;

  for r in
    select a.id, a.cliente_id, a.data_cirurgia
    from public.agendamentos a
    join public.clientes c on c.id = a.cliente_id
    where a.status <> 'cancelado'
      and a.data_cirurgia = v_hoje + 1
      and c.ativo is not false
  loop
    if public.notificar_cliente(r.cliente_id, 'cirurgia_lembrete_vespera', '{}'::jsonb, r.id,
      'lembrete:' || r.id::text || ':cirurgia:' || r.data_cirurgia::text) is not null then
      v_total := v_total + 1;
    end if;
  end loop;

  return v_total;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notificar_agendamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_data date;
  v_data_antiga date;
  v_chave text := 'ag:' || new.id::text;
begin
  select d.data into v_data from public.datas d where d.id = new.data_id;

  if tg_op = 'INSERT' then
    if new.status = 'confirmado' then
      perform public.notificar_cliente(new.cliente_id, 'termos_agendados',
        jsonb_build_object('data', public.notificacao_data_br(v_data), 'horario', public.notificacao_horario_br(new.horario_termos)), new.id, v_chave || ':agendado');
    end if;
    return new;
  end if;

  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    perform public.notificar_cliente(new.cliente_id, 'termos_cancelados',
      jsonb_build_object('data', public.notificacao_data_br(v_data)), new.id, v_chave || ':cancelado');
    return new;
  end if;

  if new.status = 'confirmado' and (new.data_id is distinct from old.data_id or new.horario_termos is distinct from old.horario_termos)
     and coalesce(new.comparecimento_status, 'pendente') <> 'compareceu' then
    select d.data into v_data_antiga from public.datas d where d.id = old.data_id;
    if v_data is distinct from v_data_antiga or new.horario_termos is distinct from old.horario_termos then
      perform public.notificar_cliente(new.cliente_id, 'termos_remarcados',
        jsonb_build_object('data', public.notificacao_data_br(v_data), 'horario', public.notificacao_horario_br(new.horario_termos)),
        new.id, v_chave || ':termos:' || coalesce(v_data::text, '') || coalesce(new.horario_termos::text, ''));
    end if;
  end if;

  if (new.comparecimento_status = 'compareceu' and old.comparecimento_status is distinct from 'compareceu')
     or (new.termos_assinados_em is not null and old.termos_assinados_em is null) then
    perform public.notificar_cliente(new.cliente_id, 'termos_assinados', '{}'::jsonb, new.id, v_chave || ':assinados');
  end if;

  if new.quitacao_status = 'paga' and old.quitacao_status is distinct from 'paga' then
    perform public.notificar_cliente(new.cliente_id, 'quitacao_confirmada', '{}'::jsonb, new.id, v_chave || ':quitacao');
  end if;

  if new.agenda_cirurgica_liberada_em is not null and old.agenda_cirurgica_liberada_em is null then
    perform public.notificar_cliente(new.cliente_id, 'agenda_cirurgica_liberada', '{}'::jsonb, new.id, v_chave || ':liberada');
  end if;

  if new.previsao_liberacao_financeira is not null and new.previsao_liberacao_financeira is distinct from old.previsao_liberacao_financeira then
    perform public.notificar_cliente(new.cliente_id, 'previsao_liberacao',
      jsonb_build_object('data', public.notificacao_data_br(new.previsao_liberacao_financeira)), new.id, v_chave || ':prev_lib:' || new.previsao_liberacao_financeira::text);
  end if;

  if new.previsao_cirurgia is not null and new.previsao_cirurgia is distinct from old.previsao_cirurgia and new.data_cirurgia is null then
    perform public.notificar_cliente(new.cliente_id, 'previsao_cirurgia',
      jsonb_build_object('data', public.notificacao_data_br(new.previsao_cirurgia)), new.id, v_chave || ':prev_cir:' || new.previsao_cirurgia::text);
  end if;

  if new.data_cirurgia is not null and (new.data_cirurgia is distinct from old.data_cirurgia or new.horario_cirurgia is distinct from old.horario_cirurgia) then
    perform public.notificar_cliente(new.cliente_id,
      case when old.data_cirurgia is null then 'cirurgia_agendada' else 'cirurgia_remarcada' end,
      jsonb_build_object('data', public.notificacao_data_br(new.data_cirurgia), 'horario', public.notificacao_horario_br(new.horario_cirurgia)),
      new.id, v_chave || ':cirurgia:' || new.data_cirurgia::text || coalesce(new.horario_cirurgia::text, ''));
  end if;

  if new.processo_concluido_em is not null and old.processo_concluido_em is null then
    perform public.notificar_cliente(new.cliente_id, 'processo_concluido', '{}'::jsonb, new.id, v_chave || ':concluido');
  end if;

  return new;
exception when others then
  raise warning 'notificar_agendamento falhou: %', sqlerrm;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notificar_cliente(p_cliente_id uuid, p_evento text, p_vars jsonb DEFAULT '{}'::jsonb, p_referencia_id uuid DEFAULT NULL::uuid, p_chave_dedupe text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ev public.notificacao_eventos%rowtype;
  v_nome text;
  v_vars jsonb;
  v_titulo text;
  v_corpo text;
  v_k text;
  v_v text;
  v_id uuid;
  v_url text;
  v_segredo text;
begin
  if p_cliente_id is null or p_evento is null then return null; end if;
  select * into v_ev from public.notificacao_eventos where chave = p_evento;
  if not found or not v_ev.is_active then return null; end if;

  select initcap(lower(split_part(btrim(nome_completo), ' ', 1))) into v_nome from public.clientes where id = p_cliente_id;
  v_vars := jsonb_build_object('nome', coalesce(nullif(v_nome, ''), 'cliente')) || coalesce(p_vars, '{}'::jsonb);
  v_titulo := v_ev.titulo;
  v_corpo := v_ev.corpo;
  for v_k, v_v in select key, value from jsonb_each_text(v_vars) loop
    v_titulo := replace(v_titulo, '{{' || v_k || '}}', coalesce(v_v, ''));
    v_corpo := replace(v_corpo, '{{' || v_k || '}}', coalesce(v_v, ''));
  end loop;
  v_titulo := btrim(regexp_replace(v_titulo, '\{\{[a-z_]+\}\}', '', 'g'));
  v_corpo := btrim(regexp_replace(v_corpo, '\{\{[a-z_]+\}\}', '', 'g'));

  insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id, evento, chave_dedupe)
  values (
    p_cliente_id,
    case v_ev.categoria when 'pagamentos' then 'parcela' else v_ev.categoria end,
    v_titulo, v_corpo, coalesce(v_ev.emoji, '🔔'), v_ev.destino, p_referencia_id, p_evento, p_chave_dedupe
  )
  on conflict (cliente_id, evento, chave_dedupe) where chave_dedupe is not null do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  insert into public.notificacao_logs (cliente_id, notificacao_id, referencia_id, tipo, titulo, corpo, status, push_enviadas, push_falhas, push_status)
  values (p_cliente_id, v_id, p_referencia_id, 'evento:' || p_evento, v_titulo, v_corpo, 'enviada', 0, 0, 'pendente');

  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sra_luck_app_url';
    select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'sra_luck_cron_secret';
    if v_url ~ '^https://' and v_segredo is not null then
      perform net.http_post(
        url := rtrim(v_url, '/') || '/api/internal/notificacoes/despachar',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_segredo),
        body := jsonb_build_object('notificacaoId', v_id),
        timeout_milliseconds := 20000
      );
    end if;
  exception when others then
    null;
  end;

  return v_id;
exception when others then
  -- Aviso nunca derruba a operação que o disparou (pagamento, agenda, clube).
  raise warning 'notificar_cliente(%) falhou: %', p_evento, sqlerrm;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notificar_liberacao_financeira()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'em_analise' then
    perform public.notificar_cliente(new.cliente_id, 'liberacao_em_analise', '{}'::jsonb, new.id, 'liberacao:' || new.id::text || ':em_analise');
  elsif new.status = 'aprovada' then
    perform public.notificar_cliente(new.cliente_id, 'liberacao_aprovada', '{}'::jsonb, new.id, 'liberacao:' || new.id::text || ':aprovada');
  elsif new.status = 'recusada' then
    perform public.notificar_cliente(new.cliente_id, 'liberacao_recusada',
      jsonb_build_object('motivo', public.notificacao_motivo(new.observacao)), new.id, 'liberacao:' || new.id::text || ':recusada');
  end if;
  return new;
exception when others then
  raise warning 'notificar_liberacao_financeira falhou: %', sqlerrm;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notificar_revisao_financeira()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status_revisao_financeira is not distinct from old.status_revisao_financeira then return new; end if;
  if new.status_revisao_financeira = 'aprovada' then
    perform public.notificar_cliente(new.id, 'revisao_aprovada', '{}'::jsonb, null,
      'revisao:aprovada:' || coalesce(new.data_atingiu_percentual::text, ''));
  elsif new.status_revisao_financeira = 'recusada' then
    perform public.notificar_cliente(new.id, 'revisao_recusada',
      jsonb_build_object('motivo', public.notificacao_motivo(new.observacao_revisao_financeira)), null, null);
  end if;
  return new;
exception when others then
  raise warning 'notificar_revisao_financeira falhou: %', sqlerrm;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.novas_vendas_avancar_concluidas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.acesso_app_liberado is true and (old.acesso_app_liberado is distinct from true) then
    update public.novas_vendas v
       set status = 'financeiro_concluido', updated_at = now()
     where v.cliente_id = new.id
       and v.status = 'aguardando_boletos'
       and exists (select 1 from public.boletos b where b.cliente_id = new.id);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.orcamento_do_mes(p_ano integer, p_mes integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(a.valor_contrato), 0)::numeric
  from agendamentos a
  join datas d on d.id = a.data_id
  where a.status = 'confirmado'
    and extract(year from d.data) = p_ano
    and extract(month from d.data) = p_mes;
$function$
;

CREATE OR REPLACE FUNCTION public.percentual_minimo_fluxo_agenda()
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select 70::numeric;
$function$
;

CREATE OR REPLACE FUNCTION public.pode_agendar(p_cliente_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.porcentagem_pagamento(p_cliente_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    round(
      (
        count(*) filter (where status = 'pago')::numeric
        / nullif(count(*)::numeric, 0)
      ) * 100,
      1
    ),
    0
  )::numeric
  from public.boletos
  where cliente_id = p_cliente_id;
$function$
;

CREATE OR REPLACE FUNCTION public.proteger_exclusao_cliente_com_historico_financeiro()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.carnes where cliente_id = old.id limit 1)
     or exists (select 1 from public.financeiro_recebimentos where cliente_id = old.id limit 1)
     or exists (select 1 from public.boletos where cliente_id = old.id limit 1)
     or exists (select 1 from public.agendamentos where cliente_id = old.id limit 1)
     or exists (select 1 from public.pagamentos_externos where cliente_id = old.id limit 1)
     or exists (select 1 from public.conciliacao_pagamentos where cliente_id = old.id limit 1)
     or exists (select 1 from public.comissoes where cliente_id = old.id limit 1)
     or exists (select 1 from public.solicitacoes_liberacao_financeira where cliente_id = old.id limit 1)
     or exists (select 1 from public.importacoes_boletos where cliente_id = old.id limit 1)
  then
    raise exception 'Esta cliente possui histórico financeiro ou operacional e não pode ser excluída fisicamente. Altere o status do contrato para Cancelado para arquivar o cadastro sem apagar parcelas, carnês, recebimentos ou agenda.'
      using errcode = '23503',
            constraint = 'clientes_historico_financeiro_protegido';
  end if;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prune_monitoramento_acessos(p_dias integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare removidos integer := 0;
begin
  delete from public.monitoramento_acessos where criado_em < now() - make_interval(days => greatest(7, p_dias));
  get diagnostics removidos = row_count;
  return removidos;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rate_limit_consumir(p_chave text, p_max_tentativas integer DEFAULT 120, p_janela_segundos integer DEFAULT 60)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.login_rate_limits%rowtype;
  v_novo integer;
begin
  if p_chave is null or length(p_chave) < 8 or length(p_chave) > 240 then
    return false;
  end if;
  if p_max_tentativas is null or p_janela_segundos is null
     or p_max_tentativas < 1 or p_max_tentativas > 10000
     or p_janela_segundos < 1 or p_janela_segundos > 86400 then
    return false;
  end if;

  -- The unique key arbitrates first-use races before the row lock exists.
  insert into public.login_rate_limits(
    chave, falhas, janela_iniciada_em, bloqueado_ate, updated_at
  ) values (p_chave, 0, now(), null, now())
  on conflict (chave) do nothing;

  select *
    into v
    from public.login_rate_limits
   where chave = p_chave
   for update;

  if v.bloqueado_ate is not null and v.bloqueado_ate > now() then
    return false;
  end if;

  if v.janela_iniciada_em <= now() - make_interval(secs => p_janela_segundos) then
    update public.login_rate_limits
       set falhas = 1,
           janela_iniciada_em = now(),
           bloqueado_ate = null,
           updated_at = now()
     where chave = p_chave;
    return true;
  end if;

  v_novo := coalesce(v.falhas, 0) + 1;

  update public.login_rate_limits
     set falhas = v_novo,
         bloqueado_ate = case
           when v_novo > p_max_tentativas
           then now() + make_interval(secs => p_janela_segundos)
           else null
         end,
         updated_at = now()
   where chave = p_chave;

  return v_novo <= p_max_tentativas;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.salvar_plano_financeiro_cliente(p_cliente_id uuid, p_quantidade integer, p_valor_parcela numeric DEFAULT NULL::numeric, p_primeiro_vencimento date DEFAULT NULL::date, p_taxa_percentual numeric DEFAULT NULL::numeric, p_recalcular_abertas boolean DEFAULT true)
 RETURNS SETOF boletos
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_cliente record;
  v_tem_existentes boolean := false;
  v_anchor_data date;
  v_anchor_numero integer;
  v_max_protegida integer := 0;
  v_valor numeric(12,2);
  v_numero integer;
  v_parcela public.boletos%rowtype;
  v_vencimento date;
begin
  if p_quantidade is null or p_quantidade < 1 or p_quantidade > 240 then
    raise exception 'A quantidade de parcelas deve estar entre 1 e 240';
  end if;

  if p_taxa_percentual is not null and (p_taxa_percentual < 0 or p_taxa_percentual > 999.99) then
    raise exception 'Taxa administrativa inválida';
  end if;

  select id, valor_contrato, custo_total, taxa_administrativa_percentual, quantidade_parcelas
    into v_cliente
  from public.clientes
  where id = p_cliente_id
  for update;

  if not found then
    raise exception 'Cliente não encontrada';
  end if;

  if p_taxa_percentual is not null then
    update public.clientes
       set taxa_administrativa_percentual = p_taxa_percentual
     where id = p_cliente_id;

    select id, valor_contrato, custo_total, taxa_administrativa_percentual, quantidade_parcelas
      into v_cliente
    from public.clientes
    where id = p_cliente_id;
  end if;

  select exists(select 1 from public.boletos where cliente_id = p_cliente_id)
    into v_tem_existentes;

  select coalesce(max(numero_parcela), 0)
    into v_max_protegida
  from public.boletos
  where cliente_id = p_cliente_id
    and status in ('pago', 'pendente_confirmacao');

  if p_quantidade < v_max_protegida then
    raise exception 'Não é possível reduzir para % parcelas: existe parcela paga ou em conferência até a parcela %', p_quantidade, v_max_protegida;
  end if;

  if p_valor_parcela is not null then
    if p_valor_parcela <= 0 then
      raise exception 'Valor da parcela inválido';
    end if;
    v_valor := round(p_valor_parcela, 2);
  else
    select valor
      into v_valor
    from public.boletos
    where cliente_id = p_cliente_id
      and status <> 'pago'
      and valor > 0
    order by numero_parcela
    limit 1;

    if v_valor is null then
      v_valor := round(coalesce(v_cliente.custo_total, 0) / p_quantidade, 2);
    end if;
  end if;

  if v_valor is null or v_valor <= 0 then
    raise exception 'Informe um valor de parcela válido';
  end if;

  if p_primeiro_vencimento is not null then
    v_anchor_data := p_primeiro_vencimento;
    v_anchor_numero := 1;
  else
    select data_vencimento, numero_parcela
      into v_anchor_data, v_anchor_numero
    from public.boletos
    where cliente_id = p_cliente_id
      and data_vencimento is not null
    order by numero_parcela
    limit 1;
  end if;

  if not v_tem_existentes and v_anchor_data is null then
    raise exception 'Informe o primeiro vencimento para gerar o financeiro';
  end if;

  if p_recalcular_abertas
     and v_anchor_data is null
     and exists(
       select 1 from public.boletos
       where cliente_id = p_cliente_id
         and status not in ('pago', 'pendente_confirmacao')
         and data_vencimento is null
     ) then
    raise exception 'Informe o primeiro vencimento para corrigir o cronograma das parcelas em aberto';
  end if;

  delete from public.boletos
   where cliente_id = p_cliente_id
     and numero_parcela > p_quantidade
     and status not in ('pago', 'pendente_confirmacao');

  for v_numero in 1..p_quantidade loop
    if v_anchor_data is not null then
      v_vencimento := (v_anchor_data + make_interval(months => v_numero - v_anchor_numero))::date;
    else
      v_vencimento := null;
    end if;

    select *
      into v_parcela
    from public.boletos
    where cliente_id = p_cliente_id
      and numero_parcela = v_numero;

    if found then
      if v_parcela.status in ('pago', 'pendente_confirmacao') then
        update public.boletos
           set total_parcelas = p_quantidade
         where id = v_parcela.id;
      else
        update public.boletos
           set total_parcelas = p_quantidade,
               valor = v_valor,
               data_vencimento = case
                 when p_recalcular_abertas and v_vencimento is not null then v_vencimento
                 else data_vencimento
               end
         where id = v_parcela.id;
      end if;
    else
      if v_vencimento is null then
        raise exception 'Informe o primeiro vencimento para completar o cronograma financeiro';
      end if;
      insert into public.boletos (
        cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status
      ) values (
        p_cliente_id, v_numero, p_quantidade, v_valor, v_vencimento, 'nao_pago'
      );
    end if;
  end loop;

  update public.clientes
     set quantidade_parcelas = p_quantidade
   where id = p_cliente_id;

  return query
    select b.*
    from public.boletos b
    where b.cliente_id = p_cliente_id
    order by b.numero_parcela;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.salvar_plano_financeiro_drawer(p_cliente_id uuid, p_quantidade integer, p_valor_parcela numeric, p_primeiro_vencimento date, p_valor_total_plano numeric, p_forma_pagamento text DEFAULT NULL::text, p_instituicao text DEFAULT NULL::text, p_dia_cobranca integer DEFAULT NULL::integer, p_status_plano text DEFAULT 'Ativa'::text, p_recalcular_abertas boolean DEFAULT true)
 RETURNS SETOF boletos
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_tem_existentes boolean := false;
  v_anchor_data date;
  v_anchor_numero integer;
  v_max_protegida integer := 0;
  v_valor numeric(12,2);
  v_numero integer;
  v_parcela public.boletos%rowtype;
  v_vencimento date;
begin
  if p_quantidade is null or p_quantidade < 1 or p_quantidade > 240 then
    raise exception 'A quantidade de parcelas deve estar entre 1 e 240';
  end if;
  if p_valor_parcela is null or p_valor_parcela <= 0 then
    raise exception 'Informe um valor de parcela válido';
  end if;
  if p_valor_total_plano is null or p_valor_total_plano < 0 then
    raise exception 'Informe um valor total do plano válido';
  end if;
  if p_dia_cobranca is not null and (p_dia_cobranca < 1 or p_dia_cobranca > 31) then
    raise exception 'Dia de cobrança inválido';
  end if;
  if coalesce(p_status_plano, 'Ativa') not in ('Ativa', 'Suspensa') then
    raise exception 'Status do plano inválido';
  end if;

  perform 1 from public.clientes where id = p_cliente_id for update;
  if not found then raise exception 'Cliente não encontrada'; end if;

  select exists(select 1 from public.boletos where cliente_id = p_cliente_id)
    into v_tem_existentes;

  select coalesce(max(numero_parcela), 0)
    into v_max_protegida
  from public.boletos
  where cliente_id = p_cliente_id
    and status in ('pago', 'pendente_confirmacao');

  if p_quantidade < v_max_protegida then
    raise exception 'Não é possível reduzir para % parcelas: existe parcela paga ou em conferência até a parcela %',
      p_quantidade, v_max_protegida;
  end if;

  v_valor := round(p_valor_parcela, 2);

  if p_primeiro_vencimento is not null then
    v_anchor_data := p_primeiro_vencimento;
    v_anchor_numero := 1;
  else
    select data_vencimento, numero_parcela
      into v_anchor_data, v_anchor_numero
    from public.boletos
    where cliente_id = p_cliente_id and data_vencimento is not null
    order by numero_parcela
    limit 1;
  end if;

  if not v_tem_existentes and v_anchor_data is null then
    raise exception 'Informe o primeiro vencimento para gerar o financeiro';
  end if;

  delete from public.boletos
  where cliente_id = p_cliente_id
    and numero_parcela > p_quantidade
    and status not in ('pago', 'pendente_confirmacao');

  for v_numero in 1..p_quantidade loop
    if v_anchor_data is not null then
      v_vencimento := (v_anchor_data + make_interval(months => v_numero - v_anchor_numero))::date;
    else
      v_vencimento := null;
    end if;

    select * into v_parcela
    from public.boletos
    where cliente_id = p_cliente_id and numero_parcela = v_numero;

    if found then
      if v_parcela.status in ('pago', 'pendente_confirmacao') then
        update public.boletos
        set total_parcelas = p_quantidade
        where id = v_parcela.id;
      else
        update public.boletos
        set total_parcelas = p_quantidade,
            valor = v_valor,
            data_vencimento = case
              when p_recalcular_abertas and v_vencimento is not null then v_vencimento
              else data_vencimento
            end
        where id = v_parcela.id;
      end if;
    else
      if v_vencimento is null then
        raise exception 'Informe o primeiro vencimento para completar o cronograma financeiro';
      end if;
      insert into public.boletos (
        cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status
      ) values (
        p_cliente_id, v_numero, p_quantidade, v_valor, v_vencimento, 'nao_pago'
      );
    end if;
  end loop;

  update public.clientes
  set quantidade_parcelas = p_quantidade,
      valor_total_plano = round(p_valor_total_plano, 2),
      valor_parcela_plano = v_valor,
      inicio_plano = coalesce(p_primeiro_vencimento, inicio_plano),
      forma_pagamento_plano = nullif(btrim(coalesce(p_forma_pagamento, '')), ''),
      instituicao_pagamento = nullif(btrim(coalesce(p_instituicao, '')), ''),
      dia_cobranca = p_dia_cobranca,
      status_plano = coalesce(p_status_plano, 'Ativa')
  where id = p_cliente_id;

  return query
    select b.*
    from public.boletos b
    where b.cliente_id = p_cliente_id
    order by b.numero_parcela;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sincronizar_revisao_financeira()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_cliente_id uuid;
  v_pode boolean;
  v_status status_revisao_financeira;
begin
  v_cliente_id := coalesce(new.cliente_id, old.cliente_id);
  v_pode := pode_agendar(v_cliente_id);

  select status_revisao_financeira into v_status from clientes where id = v_cliente_id;

  if v_pode and v_status is null then
    update clientes
    set status_revisao_financeira = 'pendente', data_atingiu_percentual = now()
    where id = v_cliente_id;
  elsif not v_pode and v_status is not null then
    update clientes
    set status_revisao_financeira = null, data_atingiu_percentual = null, observacao_revisao_financeira = null
    where id = v_cliente_id;
  end if;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.suspender_realocar_parcelas_cliente(p_cliente_id uuid, p_parcela_ids uuid[], p_usuario text DEFAULT 'admin'::text)
 RETURNS SETOF boletos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total integer;
  v_encontradas integer;
  v_candidato integer := 1;
  v_boleto record;
  v_cursor date;
  v_dia integer;
  v_mes_base date;
  v_ultimo_dia integer;
  v_nova_data date;
begin
  if p_parcela_ids is null or coalesce(array_length(p_parcela_ids, 1), 0) = 0 then
    raise exception 'Selecione ao menos uma parcela em aberto';
  end if;

  perform 1 from public.clientes where id = p_cliente_id for update;
  if not found then raise exception 'Cliente não encontrada'; end if;

  select count(*) into v_encontradas
  from public.boletos
  where cliente_id = p_cliente_id and id = any(p_parcela_ids);

  if v_encontradas <> array_length(p_parcela_ids, 1) then
    raise exception 'Uma ou mais parcelas não pertencem a esta cliente';
  end if;

  if exists (
    select 1 from public.boletos
    where cliente_id = p_cliente_id
      and id = any(p_parcela_ids)
      and status in ('pago', 'pendente_confirmacao')
  ) then
    raise exception 'Parcelas pagas ou em conferência não podem ser suspensas';
  end if;

  update public.boletos
  set suspensa = true,
      suspensa_em = coalesce(suspensa_em, now()),
      suspensa_por = coalesce(suspensa_por, p_usuario)
  where cliente_id = p_cliente_id
    and id = any(p_parcela_ids)
    and status not in ('pago', 'pendente_confirmacao');

  select count(*) into v_total
  from public.boletos
  where cliente_id = p_cliente_id;

  if v_total < 1 or v_total > 240 then
    raise exception 'O contrato deve possuir entre 1 e 240 parcelas';
  end if;

  select max(data_vencimento) into v_cursor
  from public.boletos
  where cliente_id = p_cliente_id
    and (
      status in ('pago', 'pendente_confirmacao')
      or coalesce(suspensa, false) = false
    );

  if v_cursor is null then
    select max(data_vencimento) into v_cursor
    from public.boletos
    where cliente_id = p_cliente_id;
  end if;
  v_cursor := coalesce(v_cursor, current_date);

  select extract(day from coalesce(
           min(data_vencimento) filter (where data_vencimento is not null),
           current_date
         ))::integer
  into v_dia
  from public.boletos
  where cliente_id = p_cliente_id;

  update public.boletos
  set total_parcelas = v_total * 2
  where cliente_id = p_cliente_id;

  update public.boletos
  set numero_parcela = numero_parcela + v_total
  where cliente_id = p_cliente_id
    and status not in ('pago', 'pendente_confirmacao');

  for v_boleto in
    select id, suspensa, numero_parcela
    from public.boletos
    where cliente_id = p_cliente_id
      and status not in ('pago', 'pendente_confirmacao')
    order by
      case when coalesce(suspensa, false) then 1 else 0 end,
      numero_parcela,
      id
  loop
    while exists (
      select 1 from public.boletos
      where cliente_id = p_cliente_id
        and status in ('pago', 'pendente_confirmacao')
        and numero_parcela = v_candidato
    ) loop
      v_candidato := v_candidato + 1;
    end loop;

    if coalesce(v_boleto.suspensa, false) then
      v_mes_base := (date_trunc('month', v_cursor)::date + interval '1 month')::date;
      v_ultimo_dia := extract(day from ((date_trunc('month', v_mes_base) + interval '1 month - 1 day')::date))::integer;
      v_nova_data := make_date(
        extract(year from v_mes_base)::integer,
        extract(month from v_mes_base)::integer,
        least(v_dia, v_ultimo_dia)
      );
      v_cursor := v_nova_data;

      update public.boletos
      set numero_parcela = v_candidato,
          data_vencimento = v_nova_data
      where id = v_boleto.id;
    else
      update public.boletos
      set numero_parcela = v_candidato
      where id = v_boleto.id;
    end if;

    v_candidato := v_candidato + 1;
  end loop;

  update public.boletos
  set total_parcelas = v_total
  where cliente_id = p_cliente_id;

  update public.clientes
  set quantidade_parcelas = v_total
  where id = p_cliente_id;

  return query
    select b.*
    from public.boletos b
    where b.cliente_id = p_cliente_id
    order by b.numero_parcela;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.teto_mensal_operacional()
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((select teto_mensal_operacional from public.regras_operacionais where id = 1), 100000)::numeric;
$function$
;

CREATE OR REPLACE FUNCTION public.vagas_ocupadas(p_data_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::int from agendamentos
  where data_id = p_data_id and status = 'confirmado';
$function$
;

