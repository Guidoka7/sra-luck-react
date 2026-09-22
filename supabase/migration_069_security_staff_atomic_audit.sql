-- Security-only delta: staff mutation and audit either both commit or both roll back.
-- Callable exclusively by the Worker service role; actor comes from its verified session.
create or replace function public.admin_salvar_colaborador_auditado(
  p_actor_auth_id uuid, p_id uuid, p_dados jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
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
  if v_actor.id is null or v_actor.cargo::text not in ('administrativo','gestao','financeiro')
     or (v_actor.cargo::text <> 'administrativo' and not ('equipe.gerenciar' = any(v_actor.permissoes))) then
    raise exception 'STAFF_FORBIDDEN' using errcode = '42501';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'STAFF_INVALID_INPUT';
  end if;
  select array_agg(k) into v_fields from jsonb_object_keys(p_dados) as k;
  if exists (select 1 from unnest(v_fields) k where k <> all(
    case when p_id is null then array['auth_user_id','nome','email','cargo','ativo','permissoes']
    else array['nome','cargo','ativo','permissoes','updated_at'] end)) then
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
  if p_dados ? 'permissoes' then
    if jsonb_typeof(p_dados->'permissoes') <> 'array' then raise exception 'STAFF_INVALID_PERMISSIONS'; end if;
    select coalesce(array_agg(distinct val),'{}'::text[]) into v_permissions
      from jsonb_array_elements_text(p_dados->'permissoes') val;
    if exists (select 1 from unnest(v_permissions) p where p <> all(array[
      'clientes.alterar_status_contrato','clientes.excluir','clientes.editar','clientes.liberar_acesso_app',
      'agenda.gerenciar','configuracoes.gerenciar','financeiro.revisao','financeiro.baixa_manual',
      'financeiro.validar_comprovante','integracoes.gerenciar_credenciais','integracoes.operar_financeiro',
      'equipe.gerenciar','credito.gerenciar','notificacoes.gerenciar','monitoramento.visualizar',
      'relatorios.visualizar','relatorios.exportar'])) then raise exception 'STAFF_INVALID_PERMISSIONS'; end if;
  end if;
  if p_id is null then
    if v_actor.cargo::text <> 'administrativo' and
      (p_dados->>'cargo' in ('administrativo','gestao') or cardinality(v_permissions) > 0) then
      raise exception 'STAFF_FORBIDDEN' using errcode = '42501';
    end if;
    insert into public.colaboradores(auth_user_id,nome,email,cargo,ativo,permissoes)
      values ((p_dados->>'auth_user_id')::uuid,trim(p_dados->>'nome'),p_dados->>'email',
        (p_dados->>'cargo')::public.cargo_colaborador,true,coalesce(v_permissions,'{}'::text[])) returning * into v_new;
  else
    select * into v_old from public.colaboradores where id=p_id for update;
    if v_old.id is null then raise exception 'STAFF_NOT_FOUND'; end if;
    if v_actor.cargo::text <> 'administrativo' and
      (v_old.cargo::text in ('administrativo','gestao') or p_dados ? 'cargo' or p_dados ? 'permissoes') then
      raise exception 'STAFF_FORBIDDEN' using errcode = '42501';
    end if;
    if v_old.auth_user_id = p_actor_auth_id and
      ((p_dados ? 'ativo' and (p_dados->>'ativo')::boolean = false)
        or (p_dados ? 'cargo' and p_dados->>'cargo' <> 'administrativo')) then
      raise exception 'STAFF_SELF_LOCKOUT' using errcode = '42501';
    end if;
    update public.colaboradores set
      nome=case when p_dados ? 'nome' then trim(p_dados->>'nome') else nome end,
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
revoke all on function public.admin_salvar_colaborador_auditado(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_salvar_colaborador_auditado(uuid,uuid,jsonb) to service_role;
