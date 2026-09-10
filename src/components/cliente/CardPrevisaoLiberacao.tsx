"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CalendarDays, CheckCircle2, FileSignature, Info } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn, formatarDataLonga, nomeMes } from "@/lib/utils";

interface CardPrevisaoLiberacaoProps { previsaoLiberacaoFinanceira: string | null; dataAssinatura: string; destacar?: boolean; }
type EstadoJornada = "agendada" | "cirurgia";
function dataParts(iso: string | null) { if (!iso) return null; const [ano, mes, dia] = iso.split("-").map(Number); return ano && mes && dia ? { ano, mes, dia } : null; }

export function CardPrevisaoLiberacao({ previsaoLiberacaoFinanceira, dataAssinatura, destacar = false }: CardPrevisaoLiberacaoProps) {
  const assinatura = dataParts(dataAssinatura); const cirurgia = dataParts(previsaoLiberacaoFinanceira); const estado: EstadoJornada = cirurgia ? "cirurgia" : "agendada";
  return <div className={cn("[perspective:1200px]", !cirurgia && "order-first")}><AnimatePresence mode="wait"><motion.div key={`${estado}-${previsaoLiberacaoFinanceira ?? "sem-cirurgia"}`} initial={{ opacity: 0, rotateY: -16, scale: 0.98 }} animate={{ opacity: 1, rotateY: 0, scale: 1 }} exit={{ opacity: 0, rotateY: 16, scale: 0.98 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} style={{ transformStyle: "preserve-3d" }}>
    <Card className={cn("overflow-hidden p-4 transition-shadow duration-700 sm:p-5", destacar && "ring-2 ring-gold shadow-[0_0_0_6px_rgba(201,161,90,0.18)]")}>
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-rose"><CalendarDays className="h-3.5 w-3.5" /><p className="text-[0.6rem] font-semibold uppercase tracking-label">Minha Agenda</p></div><span className="whitespace-nowrap rounded-full bg-success/10 px-2 py-0.5 text-[0.56rem] font-bold uppercase tracking-label text-success">{cirurgia ? "Confirmada" : "Termos confirmados"}</span></div>
      {assinatura && cirurgia ? <>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border border-rose/12 bg-blush/45 p-3 text-center"><p className="text-[0.58rem] font-bold uppercase tracking-label text-clay/45">Assinatura dos termos</p><p className="mt-2 font-heading text-2xl font-bold leading-none text-burgundy">{String(assinatura.dia).padStart(2,"0")}</p><p className="mt-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-burgundy/75">{nomeMes(assinatura.mes)}</p><p className="text-[0.62rem] text-clay/45">{assinatura.ano}</p></div>
          <div className="rounded-2xl border border-rose/20 bg-rose/[0.06] p-3 text-center"><p className="text-[0.58rem] font-bold uppercase tracking-label text-clay/45">Data da sua cirurgia</p><p className="mt-2 font-heading text-2xl font-bold leading-none text-burgundy">{String(cirurgia.dia).padStart(2,"0")}</p><p className="mt-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-burgundy/75">{nomeMes(cirurgia.mes)}</p><p className="text-[0.62rem] text-clay/45">{cirurgia.ano}</p></div>
        </div>
        <p className="mt-3 text-center text-[0.7rem] leading-relaxed text-clay/55">As duas datas foram registradas: assinatura dos termos e data da sua cirurgia.</p>
      </> : <div className="mt-3.5 flex flex-col items-center gap-1.5 text-center"><FileSignature className="h-5 w-5 text-rose" /><p className="text-[0.8rem] font-semibold text-burgundy">{formatarDataLonga(dataAssinatura)}</p><p className="max-w-sm text-[0.7rem] leading-relaxed text-clay/55">A assinatura dos termos já foi escolhida. Depois de informar o custeio do saldo restante, escolha aqui a data da sua cirurgia.</p></div>}
      <div className="mt-3.5 flex items-start gap-2 rounded-xl bg-blush/40 p-3"><Info className="mt-0.5 h-3.5 w-3.5 flex-none text-rose" /><p className="text-[0.68rem] leading-relaxed text-clay/60">A escolha do médico é totalmente livre e fica a critério da cliente. A data da cirurgia segue as datas liberadas pela equipe no painel administrativo.</p></div>
    </Card>
  </motion.div></AnimatePresence></div>;
}
