import webpush from "web-push";

let configurado = false;
const NOTIFICATION_ICON = "/brand/sra-luck-mark.png";

function configurarVapid() {
  if (configurado) return;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) throw new Error("Web Push não configurado: defina WEB_PUSH_VAPID_SUBJECT, WEB_PUSH_VAPID_PUBLIC_KEY e WEB_PUSH_VAPID_PRIVATE_KEY.");
  webpush.setVapidDetails(subject, publicKey, privateKey); configurado = true;
}

export function getVapidPublicKey() { const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY; if (!publicKey) throw new Error("WEB_PUSH_VAPID_PUBLIC_KEY não configurada."); return publicKey; }

export async function enviarWebPush(subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>, payload: { title: string; body: string; icon?: string; badge?: string; url?: string; tag?: string; notificationId?: string; installmentId?: string; action?: string }) {
  configurarVapid();
  const removiveis: string[] = [];
  const notificationPayload = { ...payload, icon: NOTIFICATION_ICON, badge: NOTIFICATION_ICON };
  const resultados = await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(notificationPayload), { TTL: 60 * 60 * 24 * 7, urgency: "high" });
      return { endpoint: subscription.endpoint, ok: true };
    } catch (error: any) {
      const status = Number(error?.statusCode ?? 0); if (status === 404 || status === 410) removiveis.push(subscription.endpoint); const detalhe = error?.body || error?.message || String(error); console.warn("Falha no Web Push:", status || detalhe); return { endpoint: subscription.endpoint, ok: false, status, erro: detalhe };
    }
  }));
  return { resultados, removiveis };
}

export async function enviarWebPushParaCliente(serviceClient: any, clienteId: string, payload: { title: string; body: string; icon?: string; badge?: string; url?: string; tag?: string; notificationId?: string; installmentId?: string; action?: string }) {
  const { data: subscriptions, error } = await serviceClient.from("web_push_subscriptions").select("endpoint, p256dh, auth").eq("cliente_id", clienteId);
  if (error) throw new Error(error.message);
  if (!subscriptions?.length) return { enviadas: 0, falhas: 0, removidas: 0, erros: [] as string[] };
  const result = await enviarWebPush(subscriptions, payload);
  if (result.removiveis.length) await serviceClient.from("web_push_subscriptions").delete().in("endpoint", result.removiveis);
  const enviadas = result.resultados.filter((item: any) => item.status === "fulfilled" && item.value?.ok).length;
  const falhados = result.resultados.filter((item: any) => item.status === "fulfilled" && !item.value?.ok); const rejeitados = result.resultados.filter((item: any) => item.status === "rejected"); const falhas = falhados.length + rejeitados.length;
  const erros = [...falhados.map((item: any) => `status ${item.value?.status ?? "?"}: ${item.value?.erro ?? "erro desconhecido"}`), ...rejeitados.map((item: any) => String((item as any).reason?.message ?? (item as any).reason))];
  return { enviadas, falhas, removidas: result.removiveis.length, erros };
}
