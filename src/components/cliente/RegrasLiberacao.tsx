"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ScrollText } from "lucide-react";
import { REGRAS_LIBERACAO_AGENDA } from "@/lib/utils";

export function RegrasLiberacao({ quantidadeParcelas }: { quantidadeParcelas: number | null }) {
  const [aberto, setAberto] = useState(false);
  const regraDoContrato = REGRAS_LIBERACAO_AGENDA.find((regra) => regra.parcelas === quantidadeParcelas);
  const parcelasNecessarias = regraDoContrato ? Math.ceil((regraDoContrato.parcelas * regraDoContrato.percentual) / 100) : null;

  return <div className="rounded-2xl border border-rose/15 bg-white/70 p-3.5 shadow-sm dark:border-white/10 dark:bg-white/[0.035] sm:p-4">
    <button type="button" onClick={() => setAberto((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
      <span className="flex items-center gap-2"><span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-burgundy/10"><ScrollText className="h-3.5 w-3.5 text-burgundy" /></span><span className="text-[0.8rem] font-semibold text-burgundy">Como funciona a liberação da sua agenda</span></span>
      <ChevronDown className={`h-4 w-4 flex-none text-clay/50 transition-transform duration-200 ${aberto ? "rotate-180" : ""}`} />
    </button>
    <AnimatePresence>{aberto && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
      <div className="mt-3 space-y-3 border-t border-rose/10 pt-3">
        {regraDoContrato && parcelasNecessarias ? <div className="relative overflow-hidden rounded-xl border border-gold/25 bg-gradient-to-br from-burgundy via-burgundy to-burgundy-dark p-4 text-cream shadow-card">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gold/20 blur-3xl" /><div className="pointer-events-none absolute -bottom-12 -left-8 h-28 w-28 rounded-full bg-white/5 blur-3xl" />
          <p className="relative flex items-center gap-2 text-[0.6rem] font-semibold uppercase tracking-label text-gold/85"><span className="h-1 w-1 rounded-full bg-gold" /> Seu contrato</p>
          <div className="relative mt-3 grid grid-cols-2 gap-2.5"><div className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5"><p className="font-heading text-2xl font-semibold leading-none">{regraDoContrato.parcelas}<span className="text-lg text-cream/60">x</span></p><p className="mt-1 text-[0.65rem] leading-tight text-cream/60">parcelas contratadas</p></div><div className="rounded-lg border border-gold/25 bg-gold/[0.08] px-3 py-2.5"><p className="font-heading text-2xl font-semibold leading-none text-gold">{regraDoContrato.percentual}<span className="text-lg text-gold/70">%</span></p><p className="mt-1 text-[0.65rem] leading-tight text-cream/60">das parcelas para liberar a agenda</p></div></div>
          <div className="relative mt-2.5 flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2.5"><span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gold/20"><span className="font-heading text-xs font-bold text-gold">{parcelasNecessarias}</span></span><p className="text-[0.8rem] leading-snug text-cream/90">Ao confirmar <strong className="font-semibold text-cream">{parcelasNecessarias} {parcelasNecessarias === 1 ? "parcela" : "parcelas"}</strong>, sua agenda poderá ser liberada.</p></div>
        </div> : <p className="text-[0.8rem] text-clay/60">As regras do seu contrato aparecerão aqui assim que as parcelas forem cadastradas.</p>}
        <p className="text-[0.8rem] leading-relaxed text-clay/70">Ao atingir o percentual necessário, faremos um levantamento financeiro (em até <strong className="text-burgundy">5 dias úteis</strong>) para confirmar seus pagamentos. Assim que aprovado, você poderá escolher, no calendário abaixo, a data da sua <strong className="text-burgundy">assinatura dos termos cirúrgicos</strong>. É nesse encontro, junto à nossa equipe, que a <strong className="text-burgundy">data da sua cirurgia</strong> será definida e informada a você.</p>
      </div>
    </motion.div>}</AnimatePresence>
  </div>;
}
