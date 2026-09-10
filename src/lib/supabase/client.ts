import { createClient } from "@supabase/supabase-js";

/**
 * Compatibilidade para componentes migrados do Next.js.
 * O portal Vite usa o cliente oficial do Supabase diretamente; não depende
 * de @supabase/ssr no navegador.
 */
export function createClientSupabaseClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
