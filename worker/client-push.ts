import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function clienteId(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenSessao(getCookie(request, "cliente_session"), env.CLIENTE_SESSION_SECRET);
  return session?.clienteId ?? null;
}

type SubscriptionBody = {
  deviceKey?: string;
  subscription?: {
    endpoint?: string;
    expirationTime?: number | null;
    keys?: { p256dh?: string; auth?: string };
  };
};

export async function clientPushApi(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/cliente/push/")) return null;

  const client = await clienteId(request, env);
  if (!client) return json({ erro: "Sessão expirada." }, 401);

  if (path === "/api/cliente/push/vapid" && request.method === "GET") {
    if (!env.WEB_PUSH_VAPID_PUBLIC_KEY) {
      return json({ erro: "Notificações push ainda não estão configuradas." }, 503);
    }
    return json({ publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY });
  }

  if (path === "/api/cliente/push/subscribe" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
    if (!env.WEB_PUSH_VAPID_PUBLIC_KEY) {
      return json({ erro: "Notificações push ainda não estão configuradas." }, 503);
    }

    const body = await request.json().catch(() => ({})) as SubscriptionBody;
    const endpoint = String(body.subscription?.endpoint ?? "").trim();
    const p256dh = String(body.subscription?.keys?.p256dh ?? "").trim();
    const auth = String(body.subscription?.keys?.auth ?? "").trim();
    const deviceKey = String(body.deviceKey ?? "").trim().slice(0, 200) || null;

    if (!endpoint || !p256dh || !auth) {
      return json({ erro: "Assinatura push inválida." }, 400);
    }
    if (!/^https:\/\//i.test(endpoint) || endpoint.length > 4096 || p256dh.length > 1024 || auth.length > 1024) {
      return json({ erro: "Assinatura push inválida." }, 400);
    }

    const db = createServiceSupabaseClient(env);
    const { error } = await db.from("web_push_subscriptions").upsert({
      cliente_id: client,
      endpoint,
      p256dh,
      auth,
      device_key: deviceKey,
      user_agent: request.headers.get("User-Agent")?.slice(0, 1000) ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });

    if (error) {
      console.error("Falha ao registrar assinatura push:", error);
      return json({ erro: "Não foi possível registrar este dispositivo." }, 500);
    }
    return json({ ok: true });
  }

  if (path === "/api/cliente/push/unsubscribe" && (request.method === "POST" || request.method === "DELETE")) {
    if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
    const body = await request.json().catch(() => ({})) as { endpoint?: string; deviceKey?: string };
    const endpoint = String(body.endpoint ?? "").trim();
    const deviceKey = String(body.deviceKey ?? "").trim();
    if (!endpoint && !deviceKey) return json({ erro: "Dispositivo não informado." }, 400);

    const db = createServiceSupabaseClient(env);
    let query = db.from("web_push_subscriptions").delete().eq("cliente_id", client);
    query = endpoint ? query.eq("endpoint", endpoint) : query.eq("device_key", deviceKey);
    const { error } = await query;
    if (error) {
      console.error("Falha ao remover assinatura push:", error);
      return json({ erro: "Não foi possível remover este dispositivo." }, 500);
    }
    return json({ ok: true });
  }

  return null;
}
