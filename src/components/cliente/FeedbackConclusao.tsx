"use client";

import { useMemo, useState } from "react";
import { Check, ExternalLink, Star } from "lucide-react";
import { cn } from "@/lib/utils";

const GOOGLE_REVIEW_URL = process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL || "https://www.google.com/search?q=Sra+Luck+Cirurgias+avalia%C3%A7%C3%B5es";

export function FeedbackConclusao({ onFechar }: { onFechar?: () => void }) {
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState("");

  const textoNota = useMemo(() => {
    if (nota === 5) return "Excelente experiência";
    if (nota === 4) return "Muito boa experiência";
    if (nota === 3) return "Boa experiência";
    if (nota === 2) return "Podemos melhorar";
    if (nota === 1) return "Queremos ouvir você";
    return "Como foi sua experiência?";
  }, [nota]);

  async function enviar() {
    if (!nota || enviando) return;
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch("/api/cliente/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nota, comentario }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || "Não foi possível enviar seu feedback.");
      setEnviado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar seu feedback.");
    } finally {
      setEnviando(false);
    }
  }

  function abrirGoogle() {
    const texto = comentario.trim();
    if (texto) {
      try { navigator.clipboard?.writeText(texto); } catch {}
    }
    window.open(GOOGLE_REVIEW_URL, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="mt-7 rounded-2xl border border-gold/25 bg-gold/5 p-4 text-left sm:p-5">
      {!enviado ? (
        <>
          <div className="text-center">
            <p className="font-heading text-lg font-semibold text-cream">Queremos ouvir você</p>
            <p className="mt-1 text-xs leading-5 text-cream/65">Seu feedback sobre o acompanhamento é muito importante para nós.</p>
            <div className="mt-4 flex justify-center gap-1.5" role="radiogroup" aria-label="Nota da experiência">
              {[1, 2, 3, 4, 5].map((valor) => (
                <button key={valor} type="button" onClick={() => setNota(valor)} aria-label={`${valor} estrela${valor > 1 ? "s" : ""}`} aria-pressed={nota === valor} className="rounded-full p-1 transition-transform hover:scale-110">
                  <Star className={cn("h-7 w-7", valor <= nota ? "fill-gold text-gold" : "text-cream/30")} />
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs font-semibold text-gold">{textoNota}</p>
          </div>
          <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={2000} rows={3} placeholder="Se quiser, conte como foi seu acompanhamento com a Sra. Luck..." className="mt-4 w-full resize-none rounded-xl border border-cream/10 bg-black/15 px-3 py-2.5 text-sm text-cream outline-none placeholder:text-cream/35 focus:border-gold/50" />
          {erro && <p className="mt-2 text-xs text-red-300">{erro}</p>}
          <button type="button" disabled={!nota || enviando} onClick={enviar} className="mt-3 w-full rounded-full bg-cream px-4 py-3 text-xs font-bold uppercase tracking-label text-burgundy transition disabled:cursor-not-allowed disabled:opacity-40">
            {enviando ? "Enviando..." : "Enviar feedback"}
          </button>
          <button type="button" onClick={onFechar} className="mt-2 w-full py-2 text-[11px] font-semibold uppercase tracking-label text-cream/45 hover:text-cream/70">Agora não</button>
        </>
      ) : (
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success"><Check className="h-6 w-6" /></div>
          <p className="mt-3 font-heading text-lg font-semibold text-cream">Muito obrigado pelo seu feedback!</p>
          <p className="mt-1 text-xs leading-5 text-cream/65">Foi um prazer fazer parte dessa etapa da sua jornada.</p>
          <button type="button" onClick={abrirGoogle} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-gold/35 bg-gold/10 px-4 py-3 text-xs font-bold uppercase tracking-label text-gold hover:bg-gold/15">
            <Star className="h-4 w-4 fill-gold" /> Avaliar a Sra. Luck no Google <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <p className="mt-2 text-[10px] leading-4 text-cream/40">Se você escreveu um comentário, ele foi copiado para facilitar a publicação no Google.</p>
          <button type="button" onClick={onFechar} className="mt-2 py-2 text-[11px] font-semibold uppercase tracking-label text-cream/45 hover:text-cream/70">Continuar</button>
        </div>
      )}
    </div>
  );
}
