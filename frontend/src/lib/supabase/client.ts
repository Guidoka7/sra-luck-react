import { createBrowserClient } from "@supabase/ssr";

export function createClientSupabaseClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não configuradas.",
    );
  }

  return createBrowserClient(url, anonKey);
}