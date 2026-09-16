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
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls="regras-liberacao-agenda"
        className="sl-agenda-rule w-full text-left"
      >
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
          <motion.div
            id="regras-liberacao-agenda"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 overflow-hidden rounded-[16px] border border-[#EADFDB] bg-white shadow-[0_5px_16px_rgba(73,42,45,.05)]">
              {regraDoContrato && parcelasNecessarias ? (
                <>
                  <section className="bg-[linear-gradient(145deg,#FFFDFC_0%,#FFF8F7_100%)] px-[14px] pb-[13px] pt-[12px]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[9px] font-semibold uppercase tracking-[.13em] text-[#A76B75]">Seu contrato</div>
                        <div className="mt-[2px] text-[11.5px] font-semibold text-[#4B3B38]">Meta para iniciar a liberação</div>
                      </div>
                      <span className="rounded-full border border-[#E8D7D9] bg-white px-[9px] py-[4px] text-[9px] font-semibold text-[#7D2A3A]">
                        Plano {regraDoContrato.parcelas}x
                      </span>
                    </div>

                    <div className="mt-[13px] flex items-end justify-between gap-4">
                      <div>
                        <div className="text-[9px] font-medium uppercase tracking-[.09em] text-[#9A7C76]">Meta mínima</div>
                        <div className="mt-[2px] font-heading text-[34px] font-semibold leading-none text-[#6B1F2E]">
                          {regraDoContrato.percentual}<span className="text-[18px]">%</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[9px] font-medium uppercase tracking-[.09em] text-[#9A7C76]">Equivale a</div>
                        <div className="mt-[3px] text-[18px] font-semibold leading-none text-[#4B3B38]">
                          {parcelasNecessarias}<span className="text-[11px] font-medium text-[#9A8C88]"> de {regraDoContrato.parcelas}</span>
                        </div>
                        <div className="mt-[3px] text-[9.2px] font-light text-[#8A7975]">parcelas confirmadas</div>
                      </div>
                    </div>

                    <div className="mt-[11px] h-[5px] overflow-hidden rounded-full bg-[#EFE3E1]" aria-label={`Meta mínima de ${regraDoContrato.percentual}% do contrato`}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${regraDoContrato.percentual}%` }}
                        transition={{ duration: 0.45, ease: "easeOut" }}
                        className="h-full rounded-full bg-[#B65B67]"
                      />
                    </div>

                    <div className="mt-[9px] flex items-start gap-[8px] rounded-[10px] bg-[#F8F1F0] px-[10px] py-[8px]">
                      <span className="mt-[4px] h-[6px] w-[6px] flex-none rounded-full bg-[#B65B67]" />
                      <p className="text-[10.2px] font-light leading-[1.45] text-[#6F5E5A]">
                        Ao confirmar <b className="font-semibold text-[#6B1F2E]">{parcelasNecessarias} de {regraDoContrato.parcelas} parcelas</b>, o contrato avança para o levantamento financeiro.
                      </p>
                    </div>
                  </section>

                  <section className="border-t border-[#F0E5E2] px-[14px] pb-[13px] pt-[12px]">
                    <div>
                      <div className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#A76B75]">Depois de atingir a meta</div>
                      <div className="mt-[2px] text-[10.8px] font-medium text-[#4B3B38]">A liberação segue nesta ordem</div>
                    </div>

                    <div className="relative mt-[11px]">
                      <div className="absolute bottom-[17px] left-[11px] top-[12px] w-px bg-[#E7DAD7]" aria-hidden="true" />

                      <div className="relative flex gap-[10px] pb-[10px]">
                        <span className="relative z-[1] flex h-[23px] w-[23px] flex-none items-center justify-center rounded-full bg-[#F6E9EA] text-[9px] font-semibold text-[#8E3243]">1</span>
                        <div className="min-w-0">
                          <div className="text-[10.6px] font-semibold text-[#4B3B38]">Levantamento financeiro</div>
                          <p className="mt-[1px] text-[9.7px] font-light leading-[1.4] text-[#81716D]">Conferimos pagamentos e saldo restante em até <b className="font-medium text-[#6B1F2E]">5 dias úteis</b>.</p>
                        </div>
                      </div>

                      <div className="relative flex gap-[10px] pb-[10px]">
                        <span className="relative z-[1] flex h-[23px] w-[23px] flex-none items-center justify-center rounded-full bg-[#F6E9EA] text-[9px] font-semibold text-[#8E3243]">2</span>
                        <div className="min-w-0">
                          <div className="text-[10.6px] font-semibold text-[#4B3B38]">Definição da quitação</div>
                          <p className="mt-[1px] text-[9.7px] font-light leading-[1.4] text-[#81716D]">Você define qual forma liberada pelo financeiro será usada para quitar o saldo restante do contrato.</p>
                        </div>
                      </div>

                      <div className="relative flex gap-[10px] pb-[10px]">
                        <span className="relative z-[1] flex h-[23px] w-[23px] flex-none items-center justify-center rounded-full bg-[#F6E9EA] text-[9px] font-semibold text-[#8E3243]">3</span>
                        <div className="min-w-0">
                          <div className="text-[10.6px] font-semibold text-[#4B3B38]">Assinatura dos termos</div>
                          <p className="mt-[1px] text-[9.7px] font-light leading-[1.4] text-[#81716D]">Com a forma definida, você agenda a <b className="font-medium text-[#6B1F2E]">assinatura dos termos cirúrgicos</b>.</p>
                        </div>
                      </div>

                      <div className="relative flex gap-[10px]">
                        <span className="relative z-[1] flex h-[23px] w-[23px] flex-none items-center justify-center rounded-full bg-[#EDF5EF] text-[9px] font-semibold text-[#3F7D5B]">4</span>
                        <div className="min-w-0">
                          <div className="text-[10.6px] font-semibold text-[#4B3B38]">Quitação e liberação</div>
                          <p className="mt-[1px] text-[9.7px] font-light leading-[1.4] text-[#81716D]">Com assinatura e quitação confirmadas, a agenda da cirurgia pode ser liberada antes, respeitando o prazo máximo de <b className="font-medium text-[#3F7D5B]">até 90 dias corridos</b>.</p>
                        </div>
                      </div>
                    </div>
                  </section>
                </>
              ) : (
                <p className="p-[13px] text-[11px] font-light leading-[1.55] text-[#7A6B67]">As regras do seu contrato aparecerão aqui assim que as parcelas forem cadastradas.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
