-- migration_117 — autorização do agendador de integrações pelo cofre do banco.
--
-- O pg_cron (integracoes_disparar_sync, a cada 15 min) chama /api/cron/integracoes do App com o
-- segredo do cofre (sra_luck_cron_secret). Em 29/09/2026 o App publicado respondia 401 porque o
-- CRON_SECRET da hospedagem não era o mesmo — e antes disso a URL apontava para um deploy
-- desativado (402). Resultado: nenhuma importação agendada do RD desde 26/09.
--
-- Esta função deixa o App confirmar o token com o próprio cofre, sem copiar o segredo para fora:
-- recebe o token e devolve só verdadeiro/falso. Só service_role executa.
--
-- Não destrutiva. Rollback: supabase/rollback/migration_117_rollback.sql.

create or replace function public.integracoes_cron_autorizado(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_segredo text;
begin
  if p_token is null or char_length(p_token) < 32 then
    return false;
  end if;
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'sra_luck_cron_secret';
  return v_segredo is not null and char_length(v_segredo) >= 32 and v_segredo = p_token;
end;
$$;

revoke all on function public.integracoes_cron_autorizado(text) from public, anon, authenticated;
grant execute on function public.integracoes_cron_autorizado(text) to service_role;
