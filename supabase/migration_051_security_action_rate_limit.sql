-- Rate limit genérico server-side para operações sensíveis.
-- Reutiliza a tabela login_rate_limits com chaves HMAC/pseudonimizadas.

begin;

create or replace function public.rate_limit_consumir(
  p_chave text,
  p_max_tentativas integer default 120,
  p_janela_segundos integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.login_rate_limits%rowtype;
  v_novo integer;
begin
  if p_chave is null or length(p_chave) < 8 or length(p_chave) > 240 then return false; end if;
  if p_max_tentativas < 1 or p_max_tentativas > 10000 or p_janela_segundos < 1 or p_janela_segundos > 86400 then return false; end if;

  select * into v
  from public.login_rate_limits
  where chave = p_chave
  for update;

  if not found then
    insert into public.login_rate_limits(chave, falhas, janela_iniciada_em, bloqueado_ate, updated_at)
    values(p_chave, 1, now(), null, now());
    return true;
  end if;

  if v.bloqueado_ate is not null and v.bloqueado_ate > now() then return false; end if;

  if v.janela_iniciada_em <= now() - make_interval(secs => p_janela_segundos) then
    update public.login_rate_limits
    set falhas = 1, janela_iniciada_em = now(), bloqueado_ate = null, updated_at = now()
    where chave = p_chave;
    return true;
  end if;

  v_novo := coalesce(v.falhas, 0) + 1;
  update public.login_rate_limits
  set falhas = v_novo,
      bloqueado_ate = case when v_novo > p_max_tentativas then now() + make_interval(secs => p_janela_segundos) else null end,
      updated_at = now()
  where chave = p_chave;

  return v_novo <= p_max_tentativas;
end;
$$;

revoke execute on function public.rate_limit_consumir(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_consumir(text, integer, integer) to service_role;

commit;
