import { getCookie, verificarTokenAdmin, type AdminSessionPayload } from "./session";
import { type Env } from "./supabase";

const ADMIN_COOKIE = "admin_session";

export async function exigirAdmin(request: Request, env: Env): Promise<Response | null> {
  if (!env.CLIENTE_SESSION_SECRET) {
    return new Response(JSON.stringify({ erro: "Serviço temporariamente indisponível." }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  const token = getCookie(request, ADMIN_COOKIE);
  const session: AdminSessionPayload | null = await verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET);
  if (!session) {
    return new Response(JSON.stringify({ erro: "Sessão administrativa expirada." }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  return null;
}
