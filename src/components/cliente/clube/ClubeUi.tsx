import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flower2, Gem, Gift, ShoppingBag, Sparkles, X } from "lucide-react";
import type { ClubeRecompensa } from "@/lib/clube";

export function Moeda({ tamanho = 14 }: { tamanho?: number }) {
  return (
    <span className="inline-flex flex-none items-center justify-center rounded-full border border-[#E8D39E] bg-[#FBF4E7] text-[#9B741E]" style={{ width: tamanho + 8, height: tamanho + 8 }} aria-hidden="true">
      <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><path d="M9 10.2c.6-.8 1.5-1.2 2.7-1.2 1.5 0 2.6.7 2.6 1.8 0 2.8-5.3 1.1-5.3 4 0 1.1 1.1 1.9 2.8 1.9 1.2 0 2.2-.4 2.9-1.3M12 7.2v1.5M12 16.8v1.5" /></svg>
    </span>
  );
}

/** Folha que sobe da base (padrão do app para ações e detalhes). */
export function Folha({ aberta, onFechar, titulo, children }: { aberta: boolean; onFechar: () => void; titulo: string; children: ReactNode }) {
  useEffect(() => {
    if (!aberta) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberta, onFechar]);
  return (
    <AnimatePresence>
      {aberta && (
        <motion.div className="fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(38,23,25,.42)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
          <motion.div
            role="dialog"
            aria-label={titulo}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 420, damping: 40 }}
            className="max-h-[88dvh] w-full max-w-[430px] overflow-y-auto overscroll-contain rounded-t-[26px] bg-white px-5 pb-[calc(max(env(safe-area-inset-bottom),0px)+20px)] pt-3 shadow-[0_-18px_50px_rgba(46,36,34,.18)]"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#E3D7D3]" />
            <div className="flex items-center justify-between gap-3 pb-2">
              <h2 className="m-0 font-heading text-[23px] font-semibold text-[#2E2422]">{titulo}</h2>
              <button type="button" onClick={onFechar} aria-label="Fechar" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F6EFED] text-[#7D2434]"><X className="h-4 w-4" /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const ARTE: Record<string, { de: string; para: string; Icone: typeof Gift }> = {
  autocuidado: { de: "#F6E6E3", para: "#E8C9C4", Icone: Sparkles },
  "bem-estar": { de: "#EEE8F3", para: "#D9CBE6", Icone: Flower2 },
  mimo: { de: "#FBF1DD", para: "#EFD9A9", Icone: ShoppingBag },
  experiência: { de: "#E7F0EA", para: "#C9DDD0", Icone: Gem },
};

/** Foto real do prêmio quando cadastrada; senão, arte da marca por categoria (não imita foto). */
export function ImagemPremio({ recompensa, className = "" }: { recompensa: Pick<ClubeRecompensa, "titulo" | "categoria" | "imagem_url">; className?: string }) {
  if (recompensa.imagem_url) {
    return <img src={recompensa.imagem_url} alt={recompensa.titulo} loading="lazy" decoding="async" className={`h-full w-full object-cover ${className}`} />;
  }
  const arte = ARTE[(recompensa.categoria ?? "").toLowerCase()] ?? { de: "#F7EEEC", para: "#E6D0CB", Icone: Gift };
  const { Icone } = arte;
  return (
    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden ${className}`} style={{ background: `radial-gradient(120% 90% at 20% 10%, #FFFFFF 0%, ${arte.de} 45%, ${arte.para} 100%)` }} aria-label={recompensa.titulo} role="img">
      <span className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/40" aria-hidden="true" />
      <span className="absolute -bottom-8 -left-4 h-20 w-20 rounded-full bg-white/30" aria-hidden="true" />
      <Icone className="relative h-10 w-10 text-[#7D2434]/80" strokeWidth={1.3} aria-hidden="true" />
    </div>
  );
}
