"use client";

import { type ReactNode, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarioAgendamento, type DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Props = {
  datas: DataDisponivel[];
  etapa: number;
  resumo: string;
  children: ReactNode;
};

function LockIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.8" y="8" width="10.4" height="7" rx="1.8" />
      <path d="M6.2 8V5.9a2.8 2.8 0 0 1 5.6 0V8" />
    </svg>
  );
}

export function AgendaBloqueadaShell({ datas, etapa, resumo, children }: Props) {
  const [aberta, setAberta] = useState(false);

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#E8D6D9] border-t-[3px] border-t-[#B65B67] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
      <button
        type="button"
        onClick={() => setAberta((valor) => !valor)}
        aria-expanded={aberta}
        className="flex w-full items-center justify-between gap-3 border-b border-[#EEDADD] bg-[#FFF6F7] px-[14px] py-[12px] text-left transition active:bg-[#FCEDEF]"
      >
        <span className="flex min-w-0 items-center gap-[10px]">
          <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border border-[#E9CDD3] bg-white text-[#A84759] shadow-[0_3px_9px_rgba(126,45,61,.06)]">
            <LockIcon />
          </span>
          <span className="min-w-0">
            <span className="block text-[8.5px] font-bold uppercase tracking-[.14em] text-[#B65B67]">Minha agenda</span>
            <span className="block pt-[1px] font-heading text-[16px] font-semibold leading-[1.15] text-[#7D2434]">Agenda bloqueada</span>
            <span className="block pt-[2px] text-[9.5px] font-light leading-[1.35] text-[#7B6B66]">{resumo}</span>
          </span>
        </span>
        <span className="flex flex-none flex-col items-end gap-[5px]">
          <span className="rounded-full border border-[#E8CDD2] bg-white px-[8px] py-[4px] text-[7.3px] font-bold uppercase tracking-[.06em] text-[#9E4353]">Etapa {etapa} de 4</span>
          <span className="text-[8.3px] font-semibold text-[#A66A75]">{aberta ? "Ocultar etapas" : "Ver etapas"}</span>
        </span>
      </button>

      <div className="relative min-h-[395px]">
        <div className={`pointer-events-none select-none p-[14px] transition duration-200 ${aberta ? "opacity-[.38] blur-[2px]" : "opacity-[.62] blur-[1.35px]"}`}>
          <CalendarioAgendamento datas={datas} onConfirmar={() => {}} confirmando={false} bloqueado />
        </div>

        <AnimatePresence initial={false}>
          {!aberta ? (
            <motion.button
              key="bloqueio"
              type="button"
              onClick={() => setAberta(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center px-[18px] text-center"
              aria-label="Agenda bloqueada. Toque para acompanhar as etapas de liberação."
            >
              <span className="w-full max-w-[300px] rounded-[16px] border border-[#E8CDD2] bg-white/94 px-[18px] py-[18px] shadow-[0_16px_38px_rgba(95,54,58,.13)] backdrop-blur-[2px]">
                <span className="mx-auto flex h-[45px] w-[45px] items-center justify-center rounded-full bg-[#F9ECEF] text-[#A84759] shadow-[0_4px_12px_rgba(166,71,89,.08)]">
                  <LockIcon size={18} />
                </span>
                <span className="block pt-[10px] font-heading text-[20px] font-semibold text-[#7D2434]">Agenda bloqueada</span>
                <span className="block px-2 pt-[5px] text-[10.5px] font-light leading-[1.45] text-[#756661]">Toque no cadeado para acompanhar as etapas de liberação da sua agenda.</span>
                <span className="mt-[10px] inline-flex items-center gap-[5px] rounded-full border border-[#E8CDD2] bg-[#FFF6F7] px-[10px] py-[6px] text-[8.8px] font-semibold text-[#9E4353]">
                  <LockIcon size={11} />
                  Ver andamento
                </span>
              </span>
            </motion.button>
          ) : (
            <motion.div
              key="etapas"
              initial={{ opacity: 0, y: 8, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.99 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-x-[12px] top-[14px]"
            >
              <div className="relative w-full rounded-[18px] border border-[#E8CDD2] bg-white/96 px-[15px] pb-[14px] pt-[14px] shadow-[0_17px_38px_rgba(95,54,58,.14)] backdrop-blur-[3px]">
                <button
                  type="button"
                  onClick={() => setAberta(false)}
                  aria-label="Fechar acompanhamento das etapas"
                  className="absolute right-[10px] top-[9px] z-10 flex h-7 w-7 items-center justify-center rounded-full bg-[#F7EFED] text-[16px] leading-none text-[#7D2434]"
                >
                  ×
                </button>
                <div className="pr-7">{children}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
