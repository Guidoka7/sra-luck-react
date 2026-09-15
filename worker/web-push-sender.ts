import { buildPushPayload } from "@block65/webcrypto-web-push";
import { obterCredencial } from "./integrations-credenciais";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { isAllowedPushEndpoint } from "./outbound-url";

type Db = ReturnType<typeof createServiceSupabaseClient>;

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  notificationId?: string | null;
  installmentId?: string | null;
  action?: string | null;
}

export interface WebPushResultado {
  configurado: boolean;
  assinaturas: number;
  enviadas: number;
  falhas: number;
  removidas: number;
  erros: string[];
}

async function vapid(env: Env) {
  const [subject, publicKey, privateKey] = await Promise.all([
    obterCredencial(env, "web_push", "vapid_subject"),
    obterCredencial(env, "web_push", "vapid_public_key"),
    obterCredencial(env, "web_push", "vapid_private_key"),
  ]);
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

export async function enviarWebPushParaCliente(
  env: Env,
  db: Db,
  clienteId: string,
  payload: WebPushPayload,
): Promise<WebPushResultado> {
  const chaves = await vapid(env);
  if (!chaves) return { configurado: false, assinaturas: 0, enviadas: 0, falhas: 0, removidas: 0, erros: ["VAPID não configurado."] };

  const { data: subscriptions, error } = await db.from("web_push_subscriptions").select("id,endpoint,p256dh,auth").eq("cliente_id", clienteId);
  if (error) return { configurado: true, assinaturas: 0, enviadas: 0, falhas: 1, removidas: 0, erros: ["Falha ao carregar assinaturas push."] };

  const resultado: WebPushResultado = { configurado: true, assinaturas: subscriptions?.length ?? 0, enviadas: 0, falhas: 0, removidas: 0, erros: [] };
  const data = JSON.stringify({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 500),
    url: payload.url?.startsWith("/") ? payload.url.slice(0, 500) : "/agenda",
    tag: (payload.tag ?? "sra-luck-notificacao").slice(0, 120),
    notificationId: payload.notificationId ?? null,
    installmentId: payload.installmentId ?? null,
    action: payload.action?.slice(0, 120) ?? null,
  });

  for (const subscription of subscriptions ?? []) {
    if (!isAllowedPushEndpoint(String(subscription.endpoint || ""))) {
      // Defesa em profundidade: também elimina registros legados inseguros já persistidos.
      await db.from("web_push_subscriptions").delete().eq("id", subscription.id).eq("cliente_id", clienteId);
      resultado.removidas += 1;
      resultado.falhas += 1;
      resultado.erros.push("Endpoint push inválido removido.");
      continue;
    }
    try {
      const requestInit = await buildPushPayload(
        { data, options: { ttl: 60 * 60 * 24 } },
        { endpoint: subscription.endpoint, expirationTime: null, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        chaves,
      );
      const response = await fetch(subscription.endpoint, requestInit);
      if (response.ok) { resultado.enviadas += 1; continue; }
      if (response.status === 404 || response.status === 410) {
        await db.from("web_push_subscriptions").delete().eq("id", subscription.id).eq("cliente_id", clienteId);
        resultado.removidas += 1;
        continue;
      }
      resultado.falhas += 1;
      resultado.erros.push(`Push HTTP ${response.status}`);
    } catch {
      resultado.falhas += 1;
      resultado.erros.push("Falha ao enviar Web Push.");
    }
  }

  return resultado;
}
