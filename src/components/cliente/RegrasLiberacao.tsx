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
            <div className="mt-2 rounded-[15px] border border-[#EFE4E1] bg-white p-[13px] shadow-[0_5px_16px_rgba(73,42,45,.05)]">
              {regraDoContrato && parcelasNecessarias ? (
                <>
                  <section className="rounded-[13px] border border-[#EADFDB] bg-[#FFFBFA] p-[12px]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[9px] font-semibold uppercase tracking-[.13em] text-[#A76B75]">Seu contrato</div>
                        <div className="mt-[2px] text-[11px] font-medium text-[#4B3B38]">Meta para iniciar a liberação</div>
                      </div>
                      <span className="rounded-full bg-[#F7EDEE] px-[8px] py-[4px] text-[8.5px] font-semibold uppercase tracking-[.08em] text-[#8E3243]">Regra do plano</span>
                    </div>

                    <div className="mt-[10px] grid grid-cols-3 divide-x divide-[#EADFDB] rounded-[11px] border border-[#EEE2DF] bg-white py-[9px]">
                      <div className="px-[8px] text-center">
                        <div className="font-heading text-[21px] font-semibold leading-none text-[#6B1F2E]">{regraDoContrato.parcelas}<span className="text-[13px] opacity-65">x</span></div>
                        <div className="mt-[4px] text-[8.8px] font-light leading-[1.3] text-[#8B7C78]">parcelas do plano</div>
                      </div>
                      <div className="px-[8px] text-center">
                        <div className="font-heading text-[21px] font-semibold leading-none text-[#6B1F2E]">{regraDoContrato.percentual}<span className="text-[13px] opacity-65">%</span></div>
                        <div className="mt-[4px] text-[8.8px] font-light leading-[1.3] text-[#8B7C78]">meta mínima</div>
                      </div>
                      <div className="px-[8px] text-center">
                        <div className="font-heading text-[21px] font-semibold leading-none text-[#6B1F2E]">{parcelasNecessarias}</div>
                        <div className="mt-[4px] text-[8.8px] font-light leading-[1.3] text-[#8B7C78]">parcelas necessárias</div>
                      </div>
                    </div>

                    <div className="mt-[9px] flex items-start gap-[8px] rounded-[10px] bg-[#F8F1F0] px-[10px] py-[8px]">
                      <span className="mt-[2px] h-[6px] w-[6px] flex-none rounded-full bg-[#B65B67]" />
                      <p className="text-[10.2px] font-light leading-[1.45] text-[#6F5E5A]">
                        Ao confirmar <b className="font-semibold text-[#6B1F2E]">{parcelasNecessarias} {parcelasNecessarias === 1 ? "parcela" : "parcelas"}</b>, você avança para o levantamento financeiro.
                      </p>
                    </div>
                  </section>

                  <section className="px-[2px] pt-[13px]">
                    <div className="mb-[9px] text-[9px] font-semibold uppercase tracking-[.12em] text-[#A76B75]">Depois de atingir a meta</div>

                    <div className="relative">
                      <div className="absolute bottom-[18px] left-[12px] top-[12px] w-px bg-[#E8DCD9]" aria-hidden="true" />

                      <div className="relative flex gap-[10px] pb-[11px]">
                        <span className="relative z-[1] flex h-[25px] w-[25px] flex-none items-center justify-center rounded-full bg-[#F6E9EA] text-[9px] font-semibold text-[#8E3243]">1</span>
                        <div className="min-w-0 pt-[1px]">
                          <div className="text-[10.7px] font-semibold text-[#4B3B38]">Levantamento financeiro</div>
                          <p className="mt-[1px] text-[9.8px] font-light leading-[1.45] text-[#81716D]">O financeiro confere o contrato e o saldo em até <b className="font-medium text-[#6B1F2E]">5 dias úteis</b>.</p>
                        </div>
                      </div>

                      <div className="relative flex gap-[10px] pb-[11px]">
                        <span className="relative z-[1] flex h-[25px] w-[25px] flex-none items-center justify-center rounded-full bg-[#F6E9EA] text-[9px] font-semibold text-[#8E3243]">2</span>
                        <div className="min-w-0 pt-[1px]">
                          <div className="text-[10.7px] font-semibold text-[#4B3B38]">Definição da quitação</div>
                          <p className="mt-[1px] text-[9.8px] font-light leading-[1.45] text-[#81716D]">Após a análise, você define como será utilizado o pagamento liberado pelo financeiro para quitar o saldo restante do contrato.</p>
                        </div>
                      </div>

                      <div className="relative flex gap-[10px] pb-[11px]">
                        <span className="relative z-[1] flex h-[25px] w-[25px] flex-none items-center justify-center rounded-full bg-[#F6E9EA] text-[9px] font-semibold text-[#8E3243]">3</span>
                        <div className="min-w-0 pt-[1px]">
                          <div className="text-[10.7px] font-semibold text-[#4B3B38]">Assinatura dos termos</div>
                          <p className="mt-[1px] text-[9.8px] font-light leading-[1.45] text-[#81716D]">Com a forma definida, você agenda a data da <b className="font-medium text-[#6B1F2E]">assinatura dos termos cirúrgicos</b>.</p>
                        </div>
                      </div>

                      <div className="relative flex gap-[10px]">
                        <span className="relative z-[1] flex h-[25px] w-[25px] flex-none items-center justify-center rounded-full bg-[#EDF5EF] text-[9px] font-semibold text-[#3F7D5B]">4</span>
                        <div className="min-w-0 pt-[1px]">
                          <div className="text-[10.7px] font-semibold text-[#4B3B38]">Quitação e liberação</div>
                          <p className="mt-[1px] text-[9.8px] font-light leading-[1.45] text-[#81716D]">Depois da assinatura e da quitação confirmada, a agenda da cirurgia poderá ser liberada antes, respeitando o prazo máximo de <b className="font-medium text-[#3F7D5B]">até 90 dias corridos</b>.</p>
                        </div>
                      </div>
                    </div>
                  </section>
                </>
              ) : (
                <p className="text-[11px] font-light leading-[1.55] text-[#7A6B67]">As regras do seu contrato aparecerão aqui assim que as parcelas forem cadastradas.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
