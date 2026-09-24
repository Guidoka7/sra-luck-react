import { createClient } from "@supabase/supabase-js";

/**
 * Cliente exclusivo da branch de teste de carga.
 * Nunca aponta para o Supabase de produção.
 */
export function createClientSupabaseClient() {
  return createClient("https://xqlxzdmleekbrietejoq.supabase.co", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxbHh6ZG1sZWVrYnJpZXRlam9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyODg1NzIsImV4cCI6MjEwNTg2NDU3Mn0.8xeWOMtFhdivO3NJTpCsUtwbvr74t56LmghYVLK1YFk", {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
