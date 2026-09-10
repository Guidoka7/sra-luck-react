import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { verificarTokenSessao, CLIENTE_COOKIE_NAME } from "@/lib/session";

function normalizarDispositivo(value: unknown) {
  return ["mobile", "tablet", "desktop", "unknown"].includes(String(value)) ? String(value) : "unknown";
}

function normalizarModo(value: unknown) {
  return ["browser", "standalone"].includes(String(value)) ? String(value) : "browser";
}

function normalizarPermissao(value: unknown) {
  return ["granted", "denied", "default"].includes(String(value)) ? String(value) : "default";
}

export async function POST(req: NextRequest) {
  const token = cookies().get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const deviceKey = String(body?.deviceKey || "").slice(0, 180);
  if (!deviceKey) return NextResponse.json({ erro: "Identificador do dispositivo ausente." }, { status: 400 });

  const service = createServiceSupabaseClient();
  const now = new Date().toISOString();
  const pwaInstalled = Boolean(body?.isPwaInstalled);
  const notificationPermission = normalizarPermissao(body?.notificationPermission);
  const displayMode = normalizarModo(body?.displayMode);

  const { data: existente } = await service
    .from("cliente_app_devices")
    .select("pwa_installed_at, notifications_activated_at")
    .eq("cliente_id", sessao.clienteId)
    .eq("device_key", deviceKey)
    .maybeSingle();

  const { error } = await service.from("cliente_app_devices").upsert({
    cliente_id: sessao.clienteId,
    device_key: deviceKey,
    device_type: normalizarDispositivo(body?.deviceType),
    display_mode: displayMode,
    is_pwa_installed: pwaInstalled,
    notification_permission: notificationPermission,
    push_active: Boolean(body?.pushActive),
    user_agent: req.headers.get("user-agent"),
    last_access_at: now,
    pwa_installed_at: pwaInstalled ? (existente?.pwa_installed_at || now) : existente?.pwa_installed_at || null,
    notifications_activated_at: notificationPermission === "granted" ? (existente?.notifications_activated_at || now) : existente?.notifications_activated_at || null,
    updated_at: now,
  }, { onConflict: "cliente_id,device_key" });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
