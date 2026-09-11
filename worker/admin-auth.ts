import { getCookie, verificarTokenAdmin, type AdminSessionPayload } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";

const ADMIN_COOKIE = "admin_session";

function jsonErro(erro: string, status: number) {
  return new Response(JSON.stringify({ erro }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export interface ColaboradorAdmin {
  id: string;
  auth_user_id: string;
  cargo: "administrativo";
  ativo: true;
  permissoes: string[];
}

/**
 * Fonte de verdade server-side para autorização administrativa.
 *
 * Autenticação (Supabase Auth) prova identidade; esta consulta prova autorização.
 * Nunca confiar em cargo/role recebido do frontend ou armazenado em localStorage.
 */
export async function buscarColaboradorAdminAtivo(authUserId: string, env: Env): Promise<ColaboradorAdmin | null> {
  const db = createServiceSupabaseClient(env);
  const { data, error } = await db
    .from("colaboradores")
    .select("id,auth_user_id,cargo,ativo,permissoes")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.ativo !== true || data.cargo !== "administrativo") return null;

  return {
    id: String(data.id),
    auth_user_id: String(data.auth_user_id),
    cargo: "administrativo",
    ativo: true,
    permissoes: Array.isArray(data.permissoes) ? data.permissoes.filter((item): item is string => typeof item === "string") : [],
  };
}

export async function exigirAdmin(request: Request, env: Env): Promise<Response | null> {
  if (!env.CLIENTE_SESSION_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonErro("Serviço temporariamente indisponível.", 503);
  }

  const token = getCookie(request, ADMIN_COOKIE);
  const session: AdminSessionPayload | null = await verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET);
  if (!session) {
    return jsonErro("Sessão administrativa expirada.", 401);
  }

  try {
    const colaborador = await buscarColaboradorAdminAtivo(session.adminId, env);
    if (!colaborador) {
      return jsonErro("Acesso administrativo não autorizado.", 403);
    }
  } catch (error) {
    console.error("Falha ao validar autorização administrativa:", error);
    return jsonErro("Não foi possível validar sua autorização agora.", 503);
  }

  return null;
}
