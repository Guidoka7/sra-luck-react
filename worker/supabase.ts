import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CLIENTE_SESSION_SECRET?: string;

  // Web Push. A chave pública pode ser exposta ao navegador; subject e chave privada
  // permanecem exclusivamente no backend quando o envio for ativado futuramente.
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_VAPID_SUBJECT?: string;

  // Integrações — manter exclusivamente como secrets/vars do Worker.
  RD_WEBHOOK_SECRET?: string;
  RD_API_ACCESS_TOKEN?: string;
  CONTA_AZUL_CLIENT_ID?: string;
  CONTA_AZUL_CLIENT_SECRET?: string;
  CONTA_AZUL_ACCESS_TOKEN?: string;
  CONTA_AZUL_REFRESH_TOKEN?: string;
  MERCADO_PAGO_ACCESS_TOKEN?: string;
  MERCADO_PAGO_WEBHOOK_SECRET?: string;
  PUBLIC_APP_URL?: string;

  // Bancos. Cada provedor pode exigir credenciais/certificados próprios em homologação.
  BRB_WEBHOOK_SECRET?: string;
  BB_WEBHOOK_SECRET?: string;
  SANTANDER_WEBHOOK_SECRET?: string;
  SICREDI_WEBHOOK_SECRET?: string;
  EFI_WEBHOOK_SECRET?: string;
}

export function createServiceSupabaseClient(env: Env): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase do Worker não está configurado.");
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
