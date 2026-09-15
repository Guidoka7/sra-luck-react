-- LGPD: minimiza logs de auditoria existentes e futuros sem perder rastreabilidade por ID.
begin;

create or replace function public.lgpd_sanitizar_json_auditoria(valor jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
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
$$;

create or replace function public.lgpd_normalizar_usuario_auditoria(valor text)
returns text
language plpgsql
stable
set search_path = public, extensions
as $$
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
$$;

create or replace function public.lgpd_proteger_log_alteracao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.usuario := public.lgpd_normalizar_usuario_auditoria(new.usuario);
  new.detalhes := public.lgpd_sanitizar_json_auditoria(coalesce(new.detalhes, '{}'::jsonb));
  return new;
end;
$$;

drop trigger if exists trg_lgpd_proteger_log_alteracao on public.logs_alteracoes;
create trigger trg_lgpd_proteger_log_alteracao
before insert or update on public.logs_alteracoes
for each row execute function public.lgpd_proteger_log_alteracao();

update public.logs_alteracoes
set usuario = public.lgpd_normalizar_usuario_auditoria(usuario),
    detalhes = public.lgpd_sanitizar_json_auditoria(coalesce(detalhes, '{}'::jsonb));

revoke execute on function public.lgpd_sanitizar_json_auditoria(jsonb) from public, anon, authenticated;
revoke execute on function public.lgpd_normalizar_usuario_auditoria(text) from public, anon, authenticated;
revoke execute on function public.lgpd_proteger_log_alteracao() from public, anon, authenticated;
grant execute on function public.lgpd_sanitizar_json_auditoria(jsonb) to service_role;
grant execute on function public.lgpd_normalizar_usuario_auditoria(text) to service_role;
grant execute on function public.lgpd_proteger_log_alteracao() to service_role;

commit;
