import worker from "../worker/index";
import type { Env } from "../worker/supabase";

export const config = { runtime: "edge" };

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function buildEnv(request: Request): Env {
  return {
    SUPABASE_URL: firstEnv("SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: firstEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"),
    CLIENTE_SESSION_SECRET: firstEnv("CLIENTE_SESSION_SECRET"),

    WEB_PUSH_VAPID_PUBLIC_KEY: firstEnv("WEB_PUSH_VAPID_PUBLIC_KEY"),
    WEB_PUSH_VAPID_PRIVATE_KEY: firstEnv("WEB_PUSH_VAPID_PRIVATE_KEY"),
    WEB_PUSH_VAPID_SUBJECT: firstEnv("WEB_PUSH_VAPID_SUBJECT"),

    RD_WEBHOOK_SECRET: firstEnv("RD_WEBHOOK_SECRET"),
    RD_API_ACCESS_TOKEN: firstEnv("RD_API_ACCESS_TOKEN"),
    CONTA_AZUL_CLIENT_ID: firstEnv("CONTA_AZUL_CLIENT_ID"),
    CONTA_AZUL_CLIENT_SECRET: firstEnv("CONTA_AZUL_CLIENT_SECRET"),
    CONTA_AZUL_ACCESS_TOKEN: firstEnv("CONTA_AZUL_ACCESS_TOKEN"),
    CONTA_AZUL_REFRESH_TOKEN: firstEnv("CONTA_AZUL_REFRESH_TOKEN"),
    MERCADO_PAGO_ACCESS_TOKEN: firstEnv("MERCADO_PAGO_ACCESS_TOKEN"),
    MERCADO_PAGO_WEBHOOK_SECRET: firstEnv("MERCADO_PAGO_WEBHOOK_SECRET"),
    PUBLIC_APP_URL: firstEnv("PUBLIC_APP_URL", "NOTIFICACOES_APP_URL") ?? new URL(request.url).origin,
    BRB_WEBHOOK_SECRET: firstEnv("BRB_WEBHOOK_SECRET"),
    BB_WEBHOOK_SECRET: firstEnv("BB_WEBHOOK_SECRET"),
    SANTANDER_WEBHOOK_SECRET: firstEnv("SANTANDER_WEBHOOK_SECRET"),
    SICREDI_WEBHOOK_SECRET: firstEnv("SICREDI_WEBHOOK_SECRET"),
    EFI_WEBHOOK_SECRET: firstEnv("EFI_WEBHOOK_SECRET"),
  };
}

export default async function handler(request: Request) {
  return worker.fetch(request, buildEnv(request));
}
