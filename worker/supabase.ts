import { createClient } from "@supabase/supabase-js";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CLIENTE_SESSION_SECRET?: string;
  LOG_PSEUDONYM_KEY?: string;
  PUBLIC_APP_URL?: string;
  CONTA_AZUL_ACCESS_TOKEN?: string;
  [key: string]: string | undefined;
}

export function createServiceSupabaseClient(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase não configurado no Worker.");
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
