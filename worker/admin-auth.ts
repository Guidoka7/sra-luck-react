import { createServiceSupabaseClient, type Env } from "./supabase";

export async function exigirAdmin(request: Request, env: Env): Promise<Response | null> {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return new Response(JSON.stringify({ erro: "Não autenticado." }), { status: 401, headers: { "Content-Type": "application/json" } });

  try {
    const supabase = createServiceSupabaseClient(env);
    const { data, error } = await supabase.auth.getUser(match[1]);
    if (error || !data.user) {
      return new Response(JSON.stringify({ erro: "Não autenticado." }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    return null;
  } catch (error) {
    console.error("Falha ao validar sessão administrativa:", error);
    return new Response(JSON.stringify({ erro: "Serviço temporariamente indisponível." }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
}
