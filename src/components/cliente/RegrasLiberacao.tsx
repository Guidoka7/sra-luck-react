"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { REGRAS_LIBERACAO_AGENDA } from "@/lib/utils";

export function RegrasLiberacao({ quantidadeParcelas }: { quantidadeParcelas: number | null }) {
  const [aberto, setAberto] = useState(false);
  const regraDoContrato = REGRAS_LIBERACAO_AGENDA.find((regra) => regra.parcelas === quantidadeParcelas);
  const parcelasNecessarias = regraDoContrato ? Math.ceil((regraDoContrato.parcelas * regraDoContrato.percentual) / 100) : null;

  return (
    <div>
      <button type="button" onClick={() => setAberto((v) => !v)} className="sl-agenda-rule w-full text-left">
        <span className="flex min-w-0 items-center gap-[10px]">
          <span className="sl-agenda-rule-icon">
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3.5h6.5a1.5 1.5 0 0 1 1.5 1.5v8.5H6.5A1.5 1.5 0 0 1 5 12V3.5Z" />
              <path d="M7.5 6.5h3M7.5 9h3M3 5.5h2M3 8h2M3 10.5h2" />
            </svg>
          </span>
          <span className="sl-agenda-rule-label">Como funciona a liberação da sua agenda</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#9A8C88" strokeWidth="1.3" className={`flex-none transition-transform duration-200 ${aberto ? "rotate-180" : ""}`}>
          <path d="M3.5 5.5 7 9l3.5-3.5" />
        </svg>
      </button>

      <AnimatePresence initial={false}>
        {aberto && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="mt-2 rounded-[15px] border border-[#EFE4E1] bg-white p-[14px] shadow-[0_5px_16px_rgba(73,42,45,.05)]">
              {regraDoContrato && parcelasNecessarias ? (
                <div className="relative overflow-hidden rounded-[14px] bg-gradient-to-br from-[#6B1F2E] to-[#4F1521] p-[15px] text-white">
                  <div className="absolute -right-[22px] -top-[34px] h-[110px] w-[110px] rounded-full bg-[rgba(206,170,105,.14)] blur-[8px]" />
                  <div className="relative text-[9px] font-semibold uppercase tracking-[.14em] text-[#E1C78F]">Seu contrato</div>
                  <div className="relative mt-[10px] grid grid-cols-2 gap-[9px]">
                    <div className="rounded-[11px] border border-white/10 bg-white/[.055] p-[10px]">
                      <div className="font-heading text-[26px] font-semibold leading-none">{regraDoContrato.parcelas}<span className="text-[16px] opacity-60">x</span></div>
                      <div className="pt-1 text-[9.5px] font-light opacity-70">parcelas contratadas</div>
                    </div>
                    <div className="rounded-[11px] border border-[rgba(218,190,132,.28)] bg-[rgba(218,190,132,.08)] p-[10px]">
                      <div className="font-heading text-[26px] font-semibold leading-none text-[#E1C78F]">{regraDoContrato.percentual}<span className="text-[16px] opacity-75">%</span></div>
                      <div className="pt-1 text-[9.5px] font-light opacity-70">para liberar a agenda</div>
                    </div>
                  </div>
                  <div className="relative mt-[9px] flex items-center gap-[10px] rounded-[11px] border border-white/10 bg-white/[.06] p-[10px]">
                    <span className="flex h-[27px] w-[27px] flex-none items-center justify-center rounded-full bg-[rgba(218,190,132,.18)] font-heading text-[12px] font-bold text-[#E1C78F]">{parcelasNecessarias}</span>
                    <span className="text-[10.8px] font-light leading-[1.45]">Ao confirmar <b className="font-semibold">{parcelasNecessarias} {parcelasNecessarias === 1 ? "parcela" : "parcelas"}</b>, sua agenda poderá ser liberada.</span>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] font-light leading-[1.55] text-[#7A6B67]">As regras do seu contrato aparecerão aqui assim que as parcelas forem cadastradas.</p>
              )}

              <p className="px-[2px] pt-[11px] text-[11px] font-light leading-[1.58] text-[#7A6B67]">
                Ao atingir o percentual necessário, fazemos o levantamento financeiro em até <b className="font-medium text-[#6B1F2E]">5 dias úteis</b>. Após a aprovação, você define o custeio do saldo e agenda a <b className="font-medium text-[#6B1F2E]">assinatura dos termos cirúrgicos</b>. Depois da assinatura e da quitação confirmada, a agenda da cirurgia pode ser liberada antes, respeitando o prazo máximo de <b className="font-medium text-[#6B1F2E]">até 90 dias corridos</b>.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
