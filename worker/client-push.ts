import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";
import { pseudonymizeActorId, requestLogger } from "./logger";
import { garantirWebPushConfigurado } from "./web-push-bootstrap";

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

  const baseLog = requestLogger(request);
  const client = await clienteId(request, env);
  if (!client) return json({ erro: "Sessão expirada." }, 401);
  const log = baseLog.child({
    actorType: "cliente",
    actorId: await pseudonymizeActorId(client, env),
    action: "push.subscription",
  });

  if (path === "/api/cliente/push/vapid" && request.method === "GET") {
    const credenciais = await garantirWebPushConfigurado(request, env);
    if (!credenciais?.publicKey) {
      log.warn("Chave pública VAPID indisponível", {
        eventCode: "PUSH_VAPID_NOT_CONFIGURED",
        statusCode: 503,
      });
      return json({ erro: "Não foi possível preparar as notificações neste momento." }, 503);
    }
    return json({ publicKey: credenciais.publicKey });
  }

  if (path === "/api/cliente/push/subscribe" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);

    const credenciais = await garantirWebPushConfigurado(request, env);
    if (!credenciais?.publicKey || !credenciais.privateKey || !credenciais.subject) {
      log.warn("VAPID indisponível para assinatura", {
        eventCode: "PUSH_VAPID_NOT_CONFIGURED",
        statusCode: 503,
      });
      return json({ erro: "Não foi possível preparar as notificações neste momento." }, 503);
    }

    const body = (await request.json().catch(() => ({}))) as SubscriptionBody;
    const endpoint = String(body.subscription?.endpoint ?? "").trim();
    const p256dh = String(body.subscription?.keys?.p256dh ?? "").trim();
    const auth = String(body.subscription?.keys?.auth ?? "").trim();
    const deviceKey = String(body.deviceKey ?? "").trim().slice(0, 200) || null;

    if (!endpoint || !p256dh || !auth) return json({ erro: "Assinatura push inválida." }, 400);
    if (
      !/^https:\/\//i.test(endpoint) ||
      endpoint.length > 4096 ||
      p256dh.length > 1024 ||
      auth.length > 1024
    ) {
      return json({ erro: "Assinatura push inválida." }, 400);
    }

    const db = createServiceSupabaseClient(env);
    const { data: existente, error: erroConsulta } = await db
      .from("web_push_subscriptions")
      .select("cliente_id")
      .eq("endpoint", endpoint)
      .maybeSingle();

    if (erroConsulta) {
      log.error("Falha ao validar assinatura push existente", {
        eventCode: "PUSH_SUBSCRIPTION_LOOKUP_FAILED",
        statusCode: 500,
        error: erroConsulta,
      });
      return json({ erro: "Não foi possível validar este dispositivo." }, 500);
    }

    if (existente && existente.cliente_id !== client) {
      return json({ erro: "Este dispositivo já possui uma assinatura vinculada." }, 409);
    }

    const { error } = await db.from("web_push_subscriptions").upsert(
      {
        cliente_id: client,
        endpoint,
        p256dh,
        auth,
        device_key: deviceKey,
        user_agent: request.headers.get("User-Agent")?.slice(0, 1000) ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );

    if (error) {
      log.error("Falha ao registrar assinatura push", {
        eventCode: "PUSH_SUBSCRIPTION_SAVE_FAILED",
        statusCode: 500,
        error,
      });
      return json({ erro: "Não foi possível registrar este dispositivo." }, 500);
    }

    log.info("Assinatura push registrada", { eventCode: "PUSH_SUBSCRIPTION_SAVED" });
    return json({ ok: true });
  }

  if (
    path === "/api/cliente/push/unsubscribe" &&
    (request.method === "POST" || request.method === "DELETE")
  ) {
    if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
    const body = (await request.json().catch(() => ({}))) as {
      endpoint?: string;
      deviceKey?: string;
    };
    const endpoint = String(body.endpoint ?? "").trim();
    const deviceKey = String(body.deviceKey ?? "").trim();
    if (!endpoint && !deviceKey) return json({ erro: "Dispositivo não informado." }, 400);

    const db = createServiceSupabaseClient(env);
    let query = db.from("web_push_subscriptions").delete().eq("cliente_id", client);
    query = endpoint ? query.eq("endpoint", endpoint) : query.eq("device_key", deviceKey);
    const { error } = await query;

    if (error) {
      log.error("Falha ao remover assinatura push", {
        eventCode: "PUSH_SUBSCRIPTION_DELETE_FAILED",
        statusCode: 500,
        error,
      });
      return json({ erro: "Não foi possível remover este dispositivo." }, 500);
    }

    log.info("Assinatura push removida", { eventCode: "PUSH_SUBSCRIPTION_DELETED" });
    return json({ ok: true });
  }

  return null;
}
