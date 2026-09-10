"use client";

import { useEffect, useState } from "react";
import { Check, Clock3, X } from "lucide-react";
import { toast } from "sonner";

interface Solicitacao {
  id: string;
  tipo: "termos" | "cirurgia";
  data_solicitada: string | null;
  horario_termos: string | null;
  status: string;
  clientes?: { nome_completo: string } | null;
  created_at: string;
}

function dataBR(iso: string | null) { return iso ? iso.split("-").reverse().join("/") : "—"; }

export function RemarcacoesAdminInline({ tipo }: { tipo: "termos" | "cirurgia" }) {
  const [itens, setItens] = useState<Solicitacao[]>([]);
  const [processando, setProcessando] = useState<string | null>(null);

  async function carregar() {
    try {
      const r = await fetch("/api/admin/remarcacoes", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        setItens((j.solicitacoes ?? []).filter((x: Solicitacao) => x.tipo === tipo));
      }
    } catch {}
  }

  useEffect(() => { void carregar(); const t = setInterval(() => void carregar(), 5000); return () => clearInterval(t); }, [tipo]);

  async function analisar(id: string, acao: "aprovar" | "recusar") {
    setProcessando(id);
    try {
      const r = await fetch("/api/admin/remarcacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, acao }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.erro ?? "Não foi possível concluir a análise."); return; }
      toast.success(acao === "aprovar" ? "Remarcação autorizada." : "Remarcação recusada.");
      await carregar();
    } catch { toast.error("Erro de conexão. Tente novamente."); }
    finally { setProcessando(null); }
  }

  if (!itens.length) return null;

  return <div className="border-t border-rose/10 px-3 py-3 sm:px-4">
    <div className="flex items-center justify-between gap-2">
      <div><p className="text-[0.52rem] font-bold uppercase tracking-label text-gold">Remarcações em análise</p><p className="mt-0.5 text-[0.58rem] text-clay/60 dark:text-pearl/70">{tipo === "termos" ? "Solicitações da assinatura dos termos." : "Solicitações da data da cirurgia."}</p></div>
      <span className="rounded-full bg-gold/10 px-2 py-1 text-[0.5rem] font-bold text-gold">{itens.length}</span>
    </div>
    <div className="mt-2 grid gap-1.5">
      {itens.map(item => <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-gold/15 bg-gold/[0.035] px-2.5 py-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1"><p className="truncate text-[0.66rem] font-bold text-burgundy dark:text-pearl">{item.clientes?.nome_completo ?? "Cliente"}</p><p className="mt-0.5 flex items-center gap-1 text-[0.52rem] text-clay/70 dark:text-pearl/70"><Clock3 className="h-3 w-3 text-gold"/> Atual → {dataBR(item.data_solicitada)}{item.horario_termos ? ` às ${String(item.horario_termos).slice(0, 5)}` : ""}</p><p className="text-[0.48rem] text-clay/55 dark:text-pearl/55">Prazo de análise: até 5 dias úteis</p></div>
        <div className="flex shrink-0 gap-1.5"><button type="button" disabled={processando === item.id} onClick={() => void analisar(item.id, "recusar")} className="inline-flex items-center gap-1 rounded-lg border border-alert/20 px-2 py-1.5 text-[0.5rem] font-bold uppercase text-alert disabled:opacity-50"><X className="h-3 w-3"/> Recusar</button><button type="button" disabled={processando === item.id} onClick={() => void analisar(item.id, "aprovar")} className="inline-flex items-center gap-1 rounded-lg bg-burgundy px-2 py-1.5 text-[0.5rem] font-bold uppercase text-white disabled:opacity-50"><Check className="h-3 w-3"/> Autorizar</button></div>
      </div>)}
    </div>
  </div>;
}
