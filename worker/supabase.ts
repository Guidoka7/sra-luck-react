import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface Env {
  [key: string]: string | undefined;

  SUPABASE_URL?: string;
  SUPABASE_POOLER_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CLIENTE_SESSION_SECRET?: string;
  PUBLIC_APP_URL?: string;
  INTEGRATION_MODE?: "mock" | "live";
  SENTRY_DSN?: string;

  RD_STATION_API_KEY?: string;
  RD_STATION_WEBHOOK_TOKEN?: string;
  RD_STATION_BASE_URL?: string;
  RD_STATION_UPSERT_PATH?: string;
  RD_API_ACCESS_TOKEN?: string;
  RD_WEBHOOK_SECRET?: string;

  MERCADO_PAGO_ACCESS_TOKEN?: string;
  MERCADO_PAGO_WEBHOOK_TOKEN?: string;
  MERCADO_PAGO_WEBHOOK_SECRET?: string;
  MERCADO_PAGO_BASE_URL?: string;

  CONTA_AZUL_API_KEY?: string;
  CONTA_AZUL_WEBHOOK_TOKEN?: string;
  CONTA_AZUL_BASE_URL?: string;
  CONTA_AZUL_CREATE_RECEIVABLE_PATH?: string;
  CONTA_AZUL_GET_RECEIVABLE_PATH?: string;
  CONTA_AZUL_CLIENT_ID?: string;
  CONTA_AZUL_CLIENT_SECRET?: string;
  CONTA_AZUL_ACCESS_TOKEN?: string;
  CONTA_AZUL_REFRESH_TOKEN?: string;

  BANCO_BRB_API_KEY?: string;
  BANCO_BB_API_KEY?: string;
  BANCO_SANTANDER_API_KEY?: string;
  BANCO_SICREDI_API_KEY?: string;
  BANCO_EFI_API_KEY?: string;

  BANCO_BRB_WEBHOOK_TOKEN?: string;
  BANCO_BB_WEBHOOK_TOKEN?: string;
  BANCO_SANTANDER_WEBHOOK_TOKEN?: string;
  BANCO_SICREDI_WEBHOOK_TOKEN?: string;
  BANCO_EFI_WEBHOOK_TOKEN?: string;

  BRB_WEBHOOK_SECRET?: string;
  BB_WEBHOOK_SECRET?: string;
  SANTANDER_WEBHOOK_SECRET?: string;
  SICREDI_WEBHOOK_SECRET?: string;
  EFI_WEBHOOK_SECRET?: string;

  NOTIFICACOES_APP_URL?: string;
  NOTIFICACOES_CRON_SECRET?: string;
  WEB_PUSH_VAPID_SUBJECT?: string;
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
}

function requiredEnv(env: Env, key: keyof Env): string {
  const value = env[String(key)]?.trim();
  if (!value) throw new Error(`A variável ${String(key)} não está configurada no Worker.`);
  return value;
}

export function createServiceSupabaseClient(env: Env): SupabaseClient {
  const url = requiredEnv(env, "SUPABASE_URL");
  const serviceRole = requiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  try { new URL(url); } catch { throw new Error("SUPABASE_URL possui um formato inválido."); }

  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "sra-luck-worker/production" } },
  });
}
