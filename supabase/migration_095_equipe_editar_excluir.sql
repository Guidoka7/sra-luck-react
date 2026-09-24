-- ============================================================================
-- MIGRATION 095: Equipe — permissões do catálogo novo, editar dados e excluir
-- ============================================================================
-- 1. admin_salvar_colaborador_auditado passa a validar as permissões pelo
--    catálogo atual (src/lib/permissoesEquipe.ts). A versão anterior só
--    aceitava a lista antiga e recusava "Ver clientes", "Ver Financeiro" etc.
--    Também aceita alterar o e-mail (o Worker troca o login antes) e deixa
--    gerenciar a equipe quem tem "equipe.gerenciar", de qualquer cargo.
-- 2. admin_excluir_colaborador_auditado: exclui o perfil somente quando não
--    há histórico ligado (comissões, clientes/vendas atribuídas, agendamentos
--    como SDR). Com histórico, o caminho é desativar: nada é apagado em cascata.
--    Só o cargo Administrativo exclui, e nunca o próprio perfil.
-- Rollback: reaplicar a função da migration_030 e remover a de exclusão.

create or replace function public.admin_salvar_colaborador_auditado(p_actor_auth_id uuid, p_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
    -- Catálogo concedível (src/lib/permissoesEquipe.ts). Integrações e monitoramento não entram.
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
$$;

create or replace function public.admin_excluir_colaborador_auditado(p_actor_auth_id uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
$$;

revoke all on function public.admin_excluir_colaborador_auditado(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_excluir_colaborador_auditado(uuid, uuid) to service_role;
