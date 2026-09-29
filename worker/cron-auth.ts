/**
 * Autorização das rotinas agendadas.
 *
 * Os crons da Vercel (mensagem do dia e notificações financeiras) pararam de rodar em 23–24/09/2026
 * e o CRON_SECRET da hospedagem não é o mesmo do cofre do banco. Agora o pg_cron do Supabase chama
 * as rotinas (migrations 117 e 120) com o segredo do cofre (sra_luck_cron_secret), e o banco confirma
 * o token pela RPC integracoes_cron_autorizado: o segredo nunca sai do cofre.
 */
import { rotinaAutorizada } from "./frase-do-dia";
import { createServiceSupabaseClient, type Env } from "./supabase";

type RpcDb = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

export async function cronAutorizadoPeloBanco(request: Request, env: Env, db?: RpcDb) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (token.length < 32) return false;
  try {
    const { data, error } = await (db ?? createServiceSupabaseClient(env)).rpc("integracoes_cron_autorizado", { p_token: token });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Cron da hospedagem (CRON_SECRET) ou pg_cron do banco (cofre). */
export async function rotinaAgendadaAutorizada(request: Request, env: Env, db?: RpcDb) {
  return rotinaAutorizada(request, env) || cronAutorizadoPeloBanco(request, env, db);
}
