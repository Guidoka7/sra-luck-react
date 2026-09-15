-- LGPD / least privilege follow-up.
-- 1) O schema public deixa de ser navegável pelos papéis públicos.
-- 2) Auditorias legadas mantêm a prova da ação, mas removem valores pessoais
--    desnecessários inclusive quando estavam aninhados em arrays de alterações.

begin;

revoke usage on schema public from public, anon, authenticated;
grant usage on schema public to service_role;

create or replace function public.lgpd_sanitizar_json_auditoria(valor jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  resultado jsonb;
  item jsonb;
  chave text;
  val jsonb;
  campo text;
begin
  if valor is null then
    return null;
  end if;

  if jsonb_typeof(valor) = 'object' then
    campo := lower(coalesce(valor->>'campo', ''));

    -- Formato histórico {campo, de, para}: preserva qual campo mudou, mas não
    -- replica o valor quando ele é pessoal, identificável ou de saúde.
    if campo ~ '(nome|cpf|telefone|e-mail|email|nascimento|procedimento|m[eé]dico|hospital|observa|endere[cç]o|whatsapp)' then
      resultado := valor || jsonb_build_object('de', '[REDACTED]', 'para', '[REDACTED]');
    else
      resultado := '{}'::jsonb;
      for chave, val in select key, value from jsonb_each(valor)
      loop
        if lower(chave) in (
          'cpf','data_nascimento','email','telefone','whatsapp','endereco','endereço',
          'nome','nome_completo','nomecliente','nome_cliente','cliente','procedimento',
          'medico','médico','hospital','senha','password','token','authorization','cookie',
          'session','secret','access_token','refresh_token','api_key','service_role','pix_key',
          'card_number','cvv'
        ) then
          resultado := resultado || jsonb_build_object(chave, '[REDACTED]');
        else
          resultado := resultado || jsonb_build_object(chave, public.lgpd_sanitizar_json_auditoria(val));
        end if;
      end loop;
    end if;

    return resultado;
  end if;

  if jsonb_typeof(valor) = 'array' then
    select coalesce(jsonb_agg(public.lgpd_sanitizar_json_auditoria(item_value) order by ord), '[]'::jsonb)
      into resultado
    from jsonb_array_elements(valor) with ordinality as a(item_value, ord);
    return resultado;
  end if;

  if jsonb_typeof(valor) = 'string' then
    -- Strings de auditoria podem conter e-mail ou CPF formatado no meio do texto.
    -- Não mascara sequências numéricas genéricas para não corromper valores financeiros.
    return to_jsonb(
      regexp_replace(
        regexp_replace(valor #>> '{}',
          '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
          '[EMAIL_REDACTED]', 'g'),
        '\m[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}\M',
        '[CPF_REDACTED]', 'g'
      )
    );
  end if;

  return valor;
end;
$$;

revoke execute on function public.lgpd_sanitizar_json_auditoria(jsonb) from public, anon, authenticated;
grant execute on function public.lgpd_sanitizar_json_auditoria(jsonb) to service_role;

update public.logs_alteracoes
set detalhes = public.lgpd_sanitizar_json_auditoria(coalesce(detalhes, '{}'::jsonb));

-- A função de transformação é somente ferramenta de migration; não fica exposta
-- como superfície permanente da API.
drop function public.lgpd_sanitizar_json_auditoria(jsonb);

-- Reforço após CREATE/DROP nesta migration.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

commit;
