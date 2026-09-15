import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase público não configurado.");
}

/**
 * Cliente público somente para capacidades explicitamente públicas/realtime.
 * A autenticação e os dados de negócio passam pelo Worker; nenhuma sessão
 * Supabase é persistida no navegador ou lida da URL.
 */
export const supabase = createClient(
  supabaseUrl || "https://placeholder.invalid",
  supabaseAnonKey || "placeholder-anon-key",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);
