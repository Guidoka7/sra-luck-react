import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { verificarTokenSessao, CLIENTE_COOKIE_NAME } from "@/lib/session";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const token = cookies().get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão da cliente inválida." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const subscription = body?.subscription;
  const deviceKey = String(body?.deviceKey || "").slice(0, 180);
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ erro: "Assinatura de notificações inválida." }, { status: 400 });
  }
  if (!deviceKey) return NextResponse.json({ erro: "Identificador do dispositivo ausente." }, { status: 400 });

  const service = createServiceSupabaseClient();
  const now = new Date().toISOString();
  const { error: erroPush } = await service.from("web_push_subscriptions").upsert({
    cliente_id: sessao.clienteId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    user_agent: req.headers.get("user-agent"),
    updated_at: now,
  }, { onConflict: "endpoint" });

  if (erroPush) return NextResponse.json({ erro: erroPush.message }, { status: 500 });

  const { error: erroDevice } = await service.from("cliente_app_devices").upsert({
    cliente_id: sessao.clienteId,
    device_key: deviceKey,
    device_type: String(req.headers.get("user-agent") || "").match(/Mobile|Android|iPhone|iPad/i) ? "mobile" : "desktop",
    display_mode: "standalone",
    is_pwa_installed: true,
    notification_permission: "granted",
    push_active: true,
    user_agent: req.headers.get("user-agent"),
    last_access_at: now,
    pwa_installed_at: now,
    notifications_activated_at: now,
    updated_at: now,
  }, { onConflict: "cliente_id,device_key" });

  if (erroDevice) return NextResponse.json({ erro: erroDevice.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
