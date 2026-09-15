"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { FileSignature, PartyPopper, Star } from "lucide-react";
import { FeedbackConclusao } from "@/components/cliente/FeedbackConclusao";

type MomentoEspecial = "termos-amanha" | "termos-hoje" | "cirurgia-hoje" | null;
const TEST_CLOCK_KEY = "sra-luck-test-date";

function dataLocalISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function hojeDaAplicacao() {
  if (typeof window !== "undefined") {
    const teste = window.localStorage.getItem(TEST_CLOCK_KEY);
    if (teste && /^\d{4}-\d{2}-\d{2}$/.test(teste)) return teste;
  }
  return dataLocalISO(new Date());
}
function diferencaEmDias(dataISO: string, hojeISO: string) {
  const [y, m, d] = dataISO.split("-").map(Number);
  const [hy, hm, hd] = hojeISO.split("-").map(Number);
  if (![y, m, d, hy, hm, hd].every(Number.isFinite)) return null;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(hy, hm - 1, hd)) / 86400000);
}
function formatarData(data?: string | null) {
  return data ? data.split("-").reverse().join("/") : "";
}

function CelebracaoEtapa({ momento, data, onFechar }: { momento: Exclude<MomentoEspecial, null>; data: string; onFechar: () => void }) {
  const cirurgia = momento === "cirurgia-hoje";
  const hoje = momento === "termos-hoje";
  const [feedbackAberto, setFeedbackAberto] = useState(false);
  const titulo = cirurgia ? "Hoje é o grande dia!" : hoje ? "Hoje é o dia da sua assinatura" : "Amanhã é um dia especial";
  const mensagem = cirurgia
    ? "Sua jornada chegou à conclusão. Hoje acontece a sua cirurgia e todo o processo que você percorreu até aqui se concretiza."
    : hoje
      ? "Chegou o dia da assinatura dos seus termos cirúrgicos. Estamos felizes em acompanhar você nesta etapa tão importante."
      : `Amanhã, ${formatarData(data)}, será a assinatura dos seus termos cirúrgicos. Prepare-se para esta etapa especial da sua jornada.`;
  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[70] flex items-center justify-center bg-burgundy-dark/95 px-4 py-5 backdrop-blur-md sm:px-6 sm:py-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div className="w-[calc(100%-1.25rem)] max-w-[22rem] rounded-[28px] border border-rose/20 bg-burgundy px-5 py-6 text-center shadow-[0_24px_80px_rgba(0,0,0,.38)] sm:w-full sm:max-w-lg sm:rounded-[30px] sm:px-10 sm:py-8" initial={{ scale: .94, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: .97, opacity: 0, y: 4 }} transition={{ type: "spring", stiffness: 320, damping: 26 }}>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gold/35 bg-gold/10 text-gold sm:h-16 sm:w-16">
            {cirurgia ? <PartyPopper className="h-7 w-7 sm:h-8 sm:w-8" /> : <FileSignature className="h-7 w-7 sm:h-8 sm:w-8" />}
          </div>
          <span className="mt-4 block text-[.65rem] font-semibold uppercase tracking-[.24em] text-gold sm:mt-5 sm:text-xs sm:tracking-[.28em]">{cirurgia ? "Conclusão da sua jornada" : hoje ? "Chegou o dia" : "Sua próxima etapa"}</span>
          <h2 className="mt-2.5 font-heading text-[1.65rem] font-semibold leading-tight text-cream sm:mt-3 sm:text-3xl">{titulo}</h2>
          <p className="mx-auto mt-4 max-w-md text-[.82rem] leading-6 text-cream/75 sm:mt-5 sm:text-sm sm:leading-7">{mensagem}</p>
          {cirurgia && (
            <>
              <p className="mx-auto mt-3 max-w-md text-[.78rem] leading-5 text-cream/70 sm:mt-4 sm:text-sm sm:leading-6">Foi um prazer acompanhar você até aqui. Esperamos que toda a sua experiência com a Sra. Luck tenha sido especial e acolhedora.</p>
              {!feedbackAberto && (
                <button type="button" onClick={() => setFeedbackAberto(true)} className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold/35 bg-gold/10 px-4 py-2.5 text-[.68rem] font-bold uppercase tracking-label text-gold sm:mt-5 sm:px-5 sm:py-3 sm:text-xs">
                  <Star className="h-3.5 w-3.5 fill-gold sm:h-4 sm:w-4" /> Avaliar minha experiência
                </button>
              )}
              {feedbackAberto && <FeedbackConclusao onFechar={() => setFeedbackAberto(false)} />}
            </>
          )}
          {!feedbackAberto && (
            <button type="button" onClick={onFechar} className="mt-5 w-full rounded-full bg-cream px-5 py-2.5 text-[.68rem] font-bold uppercase tracking-label text-burgundy sm:mt-7 sm:py-3 sm:text-xs">
              {cirurgia ? "Continuar" : "Ver minha jornada"}
            </button>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Celebração de "amanhã/hoje é um dia especial" — extraída de
 * `JourneyTracker.tsx` (removido da Home) para continuar disparando
 * independente da tela em que a cliente esteja. Monta uma vez na raiz do
 * app cliente.
 */
export function MomentoEspecialCelebracao() {
  const [momentoEspecial, setMomentoEspecial] = useState<MomentoEspecial>(null);
  const [dataMomentoEspecial, setDataMomentoEspecial] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    async function verificar() {
      try {
        const res = await fetch("/api/cliente/agenda", { cache: "no-store" });
        if (!res.ok || cancelado) return;
        const data = await res.json();
        const agenda = data.agendamentoAtivo ?? data.agendamentoConcluido ?? null;
        if (!agenda) return;
        const hoje = hojeDaAplicacao();
        const termos = agenda.data as string | null | undefined;
        const liberacao = agenda.previsaoLiberacaoFinanceira as string | null | undefined;
        const dt = termos ? diferencaEmDias(termos, hoje) : null;
        const dl = liberacao ? diferencaEmDias(liberacao, hoje) : null;
        let proximo: MomentoEspecial = null;
        let evento: string | null = null;
        if (dl === 0) { proximo = "cirurgia-hoje"; evento = liberacao ?? null; }
        else if (dt === 0) { proximo = "termos-hoje"; evento = termos ?? null; }
        else if (dt === 1) { proximo = "termos-amanha"; evento = termos ?? null; }
        if (!proximo || !evento) return;
        const chave = `sra-luck-momento-especial:${proximo}:${evento}`;
        if (sessionStorage.getItem(chave) === "1") return;
        sessionStorage.setItem(chave, "1");
        setDataMomentoEspecial(evento);
        setMomentoEspecial(proximo);
        fetch("/api/cliente/momentos-especiais", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ momento: proximo, dataEvento: evento }) }).catch(() => {});
      } catch { /* silencioso: não deve interromper a navegação */ }
    }
    verificar();
    const intervalo = window.setInterval(verificar, 15000);
    return () => { cancelado = true; window.clearInterval(intervalo); };
  }, []);

  if (!momentoEspecial || !dataMomentoEspecial) return null;
  return <CelebracaoEtapa momento={momentoEspecial} data={dataMomentoEspecial} onFechar={() => setMomentoEspecial(null)} />;
}
