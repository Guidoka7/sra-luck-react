import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CLIENTE_SESSION_SECRET?: string;
  NOTIFICACOES_CRON_SECRET?: string;
  LOG_PSEUDONYM_KEY?: string;

  // Segredo compartilhado exclusivamente entre os backends do Dev Console e
  // do Sra. Luck. Nunca deve ser exposto ao navegador.
  DEV_CONSOLE_SERVICE_TOKEN?: string;

  // Web Push. A chave pública pode ser exposta ao navegador; subject e chave privada
  // permanecem exclusivamente no backend/cofre de integrações.
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_VAPID_SUBJECT?: string;

  // Integrações — manter exclusivamente como secrets/vars do Worker.
  RD_WEBHOOK_SECRET?: string;
  RD_API_ACCESS_TOKEN?: string;
  RD_CLIENT_ID?: string;
  RD_CLIENT_SECRET?: string;
  RD_REDIRECT_URI?: string;
  RD_ACCESS_TOKEN?: string;
  RD_REFRESH_TOKEN?: string;
  RD_TOKEN_EXPIRES_AT?: string;
  CONTA_AZUL_CLIENT_ID?: string;
  CONTA_AZUL_CLIENT_SECRET?: string;
  CONTA_AZUL_ACCESS_TOKEN?: string;
  CONTA_AZUL_REFRESH_TOKEN?: string;
  CONTA_AZUL_REDIRECT_URI?: string;
  CONTA_AZUL_TOKEN_EXPIRES_AT?: string;
  MERCADO_PAGO_ACCESS_TOKEN?: string;
  MERCADO_PAGO_WEBHOOK_SECRET?: string;
  PUBLIC_APP_URL?: string;

  BRB_WEBHOOK_SECRET?: string;
  BB_WEBHOOK_SECRET?: string;
  SANTANDER_WEBHOOK_SECRET?: string;
  SICREDI_WEBHOOK_SECRET?: string;
  EFI_WEBHOOK_SECRET?: string;

  // Mensagem do dia (Google Gemini, plano gratuito) — worker/frase-do-dia.ts.
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_PROMPT?: string;
  // Segredo do Vercel Cron (enviado como "Authorization: Bearer <CRON_SECRET>").
  CRON_SECRET?: string;
}

export function createServiceSupabaseClient(env: Env): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase do Worker não está configurado.");
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
