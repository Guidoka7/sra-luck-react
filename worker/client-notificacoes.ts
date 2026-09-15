import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";

const COOKIE_NAME = "cliente_session";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function sessaoCliente(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  return verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
}

function mesmaOrigem(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * Handler das notificações da cliente. Lê/marca como lida a tabela
 * `notificacoes_cliente` (migration_010) — nenhum handler do Worker
 * respondia por essas rotas antes disso (a Central de Notificações do
 * frontend chamava uma rota inexistente e caía no 404 silenciosamente).
 */
export async function clientNotificacoesApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/cliente/notificacoes")) return null;

  const sessao = await sessaoCliente(request, env);
  if (!sessao) return json({ erro: "Sessão expirada." }, 401);
  if (request.method !== "GET" && !mesmaOrigem(request)) {
    return json({ erro: "Requisição de origem não autorizada." }, 403);
  }

  const db = createServiceSupabaseClient(env);

  if (path === "/api/cliente/notificacoes" && request.method === "GET") {
    const { data, error } = await db
      .from("notificacoes_cliente")
      .select("id,tipo,titulo,mensagem,emoji,destino,referencia_id,lida,created_at")
      .eq("cliente_id", sessao.clienteId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return json({ erro: error.message }, 500);
    const notificacoes = data ?? [];
    const naoLidas = notificacoes.filter((item) => !item.lida).length;
    return json({ notificacoes, naoLidas });
  }

  if (path === "/api/cliente/notificacoes/ler-todas" && request.method === "POST") {
    const { error } = await db
      .from("notificacoes_cliente")
      .update({ lida: true })
      .eq("cliente_id", sessao.clienteId)
      .eq("lida", false);
    if (error) return json({ erro: error.message }, 400);
    return json({ ok: true });
  }

  const lerMatch = path.match(/^\/api\/cliente\/notificacoes\/([^/]+)\/ler$/);
  if (lerMatch && request.method === "POST") {
    const { error } = await db
      .from("notificacoes_cliente")
      .update({ lida: true })
      .eq("id", decodeURIComponent(lerMatch[1]))
      .eq("cliente_id", sessao.clienteId);
    if (error) return json({ erro: error.message }, 400);
    return json({ ok: true });
  }

  return null;
}
