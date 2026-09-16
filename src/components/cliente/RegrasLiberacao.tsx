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
      <motion.button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls="regras-liberacao-agenda"
        whileTap={{ scale: 0.995 }}
        transition={{ duration: 0.14 }}
        className="sl-agenda-rule group w-full !items-center text-left transition-colors duration-200 hover:bg-[#FFFCFB]"
      >
        <span className="flex min-w-0 items-center gap-[10px]">
          <span className="sl-agenda-rule-icon !h-[32px] !w-[32px] transition-colors duration-200 group-hover:bg-[#F4E8E6]">
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4.25" y="7.25" width="9.5" height="7" rx="1.75" />
              <path d="M6.25 7.25V5.8A2.75 2.75 0 0 1 9 3.05a2.75 2.75 0 0 1 2.75 2.75v1.45" />
              <path d="M9 10v1.7" />
            </svg>
          </span>

          <span className="min-w-0">
            <span className="block text-[12.2px] font-semibold leading-[1.25] text-[#6B1F2E]">Liberação da agenda</span>
            <span className="mt-[2px] block max-w-[245px] text-[10.3px] font-light leading-[1.4] text-[#8A7B77]">
              Veja os requisitos do seu contrato e entenda as etapas até a liberação.
            </span>
          </span>
        </span>

        <span className="ml-2 flex flex-none items-center gap-[6px] text-[#9A8C88]">
          <span className="text-[8.5px] font-semibold uppercase tracking-[.08em] text-[#A76B75]">{aberto ? "Ocultar" : "Ver etapas"}</span>
          <span className="flex h-[25px] w-[25px] items-center justify-center rounded-full bg-[#F8F0EE] transition-colors duration-200 group-hover:bg-[#F3E5E2]">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" className={`transition-transform duration-200 ${aberto ? "rotate-180" : ""}`}>
              <path d="M3.5 5.5 7 9l3.5-3.5" />
            </svg>
          </span>
        </span>
      </motion.button>

      <AnimatePresence initial={false}>
        {aberto && (
          <motion.div
            id="regras-liberacao-agenda"
            initial={{ opacity: 0, height: 0, y: -3 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -3 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
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
