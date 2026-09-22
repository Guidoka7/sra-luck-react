-- Controlled fixtures only. Always rolls back users, staff and logs.
begin;
do $$
declare
  a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); t uuid := gen_random_uuid();
  aid uuid; mid uuid; tid uuid; saved jsonb; denied boolean := false;
begin
  insert into auth.users(id,email) values (a,a::text||'@qa.invalid'),(m,m::text||'@qa.invalid'),(t,t::text||'@qa.invalid');
  insert into public.colaboradores(auth_user_id,nome,email,cargo) values(a,'Security QA admin',a::text||'@qa.invalid','administrativo') returning id into aid;
  insert into public.colaboradores(auth_user_id,nome,email,cargo,permissoes) values(m,'Security QA manager',m::text||'@qa.invalid','financeiro',array['equipe.gerenciar']) returning id into mid;
  saved := public.admin_salvar_colaborador_auditado(a,null,jsonb_build_object('auth_user_id',t,'nome','Security QA target','email',t::text||'@qa.invalid','cargo','sdr','permissoes',jsonb_build_array()));
  tid := (saved->>'id')::uuid;
  if not exists(select 1 from public.logs_alteracoes where entidade_id=tid and usuario=public.lgpd_normalizar_usuario_auditoria(aid::text) and acao='criou_colaborador' and not detalhes ? 'email' and not detalhes ? 'nome') then raise exception 'Missing minimized creation audit'; end if;
  begin
    perform public.admin_salvar_colaborador_auditado(m,tid,'{"cargo":"administrativo"}');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Privilege escalation accepted'; end if;
  saved := public.admin_salvar_colaborador_auditado(a,tid,'{"ativo":false,"permissoes":["clientes.editar"]}');
  if (saved->>'ativo')::boolean <> false or not exists(select 1 from public.logs_alteracoes where entidade_id=tid and acao='alterou_colaborador' and usuario=public.lgpd_normalizar_usuario_auditoria(aid::text)) then raise exception 'Missing update audit'; end if;
  denied := false;
  update public.colaboradores set ativo=false where id=mid;
  begin
    perform public.admin_salvar_colaborador_auditado(m,tid,'{"nome":"forbidden"}');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Inactive actor accepted'; end if;
  if has_function_privilege('anon','public.admin_salvar_colaborador_auditado(uuid,uuid,jsonb)','execute') or has_function_privilege('authenticated','public.admin_salvar_colaborador_auditado(uuid,uuid,jsonb)','execute') then raise exception 'Public execution granted'; end if;
end;
$$;
rollback;
