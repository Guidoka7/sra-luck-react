"use client";

import { type ReactNode } from "react";
import { CalendarioAgendamento, type DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Props = {
  datas: DataDisponivel[];
  etapa: number;
  resumo: string;
  children: ReactNode;
};

function LockIcon() {
  return <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"><rect x="3.8" y="8" width="10.4" height="7" rx="1.8"/><path d="M6.2 8V5.9a2.8 2.8 0 0 1 5.6 0V8"/></svg>;
}

export function AgendaBloqueadaShell({ datas, etapa, resumo, children }: Props) {
  return <section className="overflow-hidden rounded-[18px] border border-[#E8D6D9] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
    <div className="flex w-full items-center justify-between gap-3 border-b border-[#EEDADD] bg-[#FFF6F7] px-[14px] py-[12px] text-left">
      <span className="flex min-w-0 items-center gap-[10px]">
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border border-[#E9CDD3] bg-white text-[#A84759] shadow-[0_3px_9px_rgba(126,45,61,.06)]"><LockIcon/></span>
        <span className="min-w-0"><span className="block text-[8.5px] font-bold uppercase tracking-[.14em] text-[#B65B67]">Minha agenda</span><span className="block pt-[1px] font-heading text-[16px] font-semibold leading-[1.15] text-[#7D2434]">Agenda bloqueada</span><span className="block pt-[2px] text-[9.5px] font-light leading-[1.35] text-[#7B6B66]">{resumo}</span></span>
      </span>
      <span className="rounded-full border border-[#E8CDD2] bg-white px-[8px] py-[4px] text-[7.3px] font-bold uppercase tracking-[.06em] text-[#9E4353]">Etapa {etapa} de 4</span>
    </div>
    <div className="p-[12px]">
      {children}
      <div className="relative mt-[10px] overflow-hidden rounded-[14px] border border-[#EFE4E1]">
        <div className="pointer-events-none select-none p-[10px] opacity-[.42] blur-[2px]"><CalendarioAgendamento datas={datas} onConfirmar={() => {}} confirmando={false} bloqueado /></div>
        <div className="absolute inset-0 flex items-center justify-center bg-white/25 px-5 text-center"><span className="rounded-[13px] border border-[#E8CDD2] bg-white/95 px-[14px] py-[10px] text-[9.5px] font-medium text-[#8E4A57] shadow-[0_10px_24px_rgba(95,54,58,.09)]">A agenda dos termos será liberada somente na Etapa 4.</span></div>
      </div>
    </div>
  </section>;
}
