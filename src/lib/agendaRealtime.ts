import { supabase } from "@/lib/supabase-vite";

export type AgendaSyncTipo = "termos" | "cirurgia";
type Listener = (tipo: AgendaSyncTipo) => void;

const listeners = new Set<Listener>();
let channel: ReturnType<typeof supabase.channel> | null = null;

export function agendaSyncTipoFromRow(row: unknown): AgendaSyncTipo | null {
  if (!row || typeof row !== "object") return null;
  const tipo = String((row as { tipo?: unknown }).tipo ?? "");
  return tipo === "termos" || tipo === "cirurgia" ? tipo : null;
}

function configurado() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function iniciar() {
  if (channel || listeners.size === 0 || !configurado()) return;

  channel = supabase
    .channel("sra-luck-agenda-sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "agenda_sync_state" },
      (payload) => {
        const tipo = agendaSyncTipoFromRow(payload.new ?? payload.old);
        if (!tipo) return;
        for (const listener of listeners) listener(tipo);
      },
    )
    .subscribe();
}

export function subscribeAgendaSync(listener: Listener) {
  listeners.add(listener);
  iniciar();

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || !channel) return;
    const atual = channel;
    channel = null;
    void supabase.removeChannel(atual);
  };
}
