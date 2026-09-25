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
    LOAD_TEST_TELEMETRY: "1",
    // Ambiente EXCLUSIVO do teste de carga. Nunca aponta para produção.
    SUPABASE_URL: "https://xqlxzdmleekbrietejoq.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxbHh6ZG1sZWVrYnJpZXRlam9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyODg1NzIsImV4cCI6MjEwNTg2NDU3Mn0.8xeWOMtFhdivO3NJTpCsUtwbvr74t56LmghYVLK1YFk",
    CLIENTE_SESSION_SECRET: "sra-luck-load-test-only-session-secret-2026-09-24",
    PUBLIC_APP_URL: new URL(request.url).origin,

    NOTIFICACOES_CRON_SECRET: undefined,
    DEV_CONSOLE_SERVICE_TOKEN: undefined,
    WEB_PUSH_VAPID_PUBLIC_KEY: undefined,
    WEB_PUSH_VAPID_PRIVATE_KEY: undefined,
    WEB_PUSH_VAPID_SUBJECT: undefined,
    RD_WEBHOOK_SECRET: undefined,
    RD_API_ACCESS_TOKEN: undefined,
    RD_CLIENT_ID: undefined,
    RD_CLIENT_SECRET: undefined,
    RD_REDIRECT_URI: undefined,
    RD_ACCESS_TOKEN: undefined,
    RD_REFRESH_TOKEN: undefined,
    RD_TOKEN_EXPIRES_AT: undefined,
    CONTA_AZUL_CLIENT_ID: undefined,
    CONTA_AZUL_CLIENT_SECRET: undefined,
    CONTA_AZUL_ACCESS_TOKEN: undefined,
    CONTA_AZUL_REFRESH_TOKEN: undefined,
    CONTA_AZUL_REDIRECT_URI: undefined,
    MERCADO_PAGO_ACCESS_TOKEN: undefined,
    MERCADO_PAGO_WEBHOOK_SECRET: undefined,
    BRB_WEBHOOK_SECRET: undefined,
    BB_WEBHOOK_SECRET: undefined,
    SANTANDER_WEBHOOK_SECRET: undefined,
    SICREDI_WEBHOOK_SECRET: undefined,
    EFI_WEBHOOK_SECRET: undefined,
    GEMINI_API_KEY: undefined,
    GEMINI_MODEL: undefined,
    GEMINI_PROMPT: undefined,
    CRON_SECRET: undefined,
  };
}

export default async function handler(request: Request, context?: { waitUntil?: (p: Promise<unknown>) => void }) {
  return worker.fetch(request, buildEnv(request), context);
}
