import { buildPushPayload } from "@block65/webcrypto-web-push";
import { obterCredencial } from "./integrations-credenciais";
import { createServiceSupabaseClient, type Env } from "./supabase";

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

/**
 * Envia Web Push diretamente do Worker usando Web Crypto/RFC 8291 + VAPID.
 * Assinaturas 404/410 são removidas automaticamente porque o push service já
 * declarou aquele endpoint expirado. Demais falhas ficam registradas para
 * observabilidade, sem apagar a inscrição.
 */
export async function enviarWebPushParaCliente(
  env: Env,
  db: Db,
  clienteId: string,
  payload: WebPushPayload,
): Promise<WebPushResultado> {
  const chaves = await vapid(env);
  if (!chaves) return { configurado: false, assinaturas: 0, enviadas: 0, falhas: 0, removidas: 0, erros: ["VAPID não configurado."] };

  const { data: subscriptions, error } = await db
    .from("web_push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("cliente_id", clienteId);
  if (error) {
    return { configurado: true, assinaturas: 0, enviadas: 0, falhas: 1, removidas: 0, erros: ["Falha ao carregar assinaturas push."] };
  }

  const resultado: WebPushResultado = {
    configurado: true,
    assinaturas: subscriptions?.length ?? 0,
    enviadas: 0,
    falhas: 0,
    removidas: 0,
    erros: [],
  };
  const data = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/agenda",
    tag: payload.tag ?? "sra-luck-notificacao",
    notificationId: payload.notificationId ?? null,
    installmentId: payload.installmentId ?? null,
    action: payload.action ?? null,
  });

  for (const subscription of subscriptions ?? []) {
    try {
      const requestInit = await buildPushPayload(
        { data, options: { ttl: 60 * 60 * 24 } },
        {
          endpoint: subscription.endpoint,
          expirationTime: null,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        chaves,
      );
      const response = await fetch(subscription.endpoint, requestInit);
      if (response.ok) {
        resultado.enviadas += 1;
        continue;
      }
      if (response.status === 404 || response.status === 410) {
        await db.from("web_push_subscriptions").delete().eq("id", subscription.id).eq("cliente_id", clienteId);
        resultado.removidas += 1;
        continue;
      }
      resultado.falhas += 1;
      resultado.erros.push(`Push HTTP ${response.status}`);
    } catch (erro) {
      resultado.falhas += 1;
      resultado.erros.push(erro instanceof Error ? erro.message.slice(0, 240) : "Falha ao enviar Web Push.");
    }
  }

  return resultado;
}
