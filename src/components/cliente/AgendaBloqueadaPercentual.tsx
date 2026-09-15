"use client";

import { CalendarioAgendamento, DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Etapa = "percentual" | "levantamento";

function LockIcon({ clock=false }: { clock?: boolean }) {
  if (clock) return <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2"/><path d="M9 5.6V9l2.3 1.5"/></svg>;
  return <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><rect x="3.8" y="8" width="10.4" height="7" rx="1.8"/><path d="M6.2 8V5.9a2.8 2.8 0 0 1 5.6 0V8"/></svg>;
}

export function AgendaBloqueadaPercentual({ percentual, parcelasNecessarias, datas, etapa = "percentual" }: { percentual:number; parcelasNecessarias:number|null; datas:DataDisponivel[]; etapa?:Etapa }) {
  const levantamento=etapa==="levantamento";
  return <section className="overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
    <div className="border-b px-[13px] py-3" style={{background:levantamento?"#FFF9F2":"#FFF7F7",borderColor:levantamento?"#F0E2C7":"#F0DDDD"}}>
      <div className="flex items-start gap-[10px]"><span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px]" style={{background:levantamento?"#F8EEDB":"#F7E9EA",color:levantamento?"#A77A24":"#B65B67"}}><LockIcon clock={levantamento}/></span><div className="min-w-0"><div className="text-[8.5px] font-bold uppercase tracking-[.13em]" style={{color:levantamento?"#A77A24":"#B65B67"}}>Minha agenda</div><div className="pt-[2px] font-heading text-[15px] font-semibold leading-[1.25] text-[#7D2434]">{levantamento?"Estamos realizando seu levantamento financeiro":"Atinja o percentual mínimo para liberar sua agenda"}</div><div className="pt-[2px] text-[9.6px] font-light leading-[1.45] text-[#7E6867]">{levantamento?"Você já atingiu o percentual necessário. Estamos conferindo seus pagamentos para liberar a escolha da data.":<>Para liberar a escolha da data, você precisa atingir <b className="font-semibold text-[#7D2434]">{percentual}% das parcelas mínimas pagas</b>{parcelasNecessarias?` (${parcelasNecessarias} parcelas).`:"."}</>}</div></div></div>
    </div>
    <div className="relative min-h-[395px] p-[14px]">
      <div className="pointer-events-none select-none opacity-[.38] blur-[3.2px]"><CalendarioAgendamento datas={datas} onConfirmar={()=>{}} confirmando={false} bloqueado /></div>
      <div className="absolute inset-[14px] flex items-center justify-center"><div className="w-full max-w-[345px] rounded-[16px] bg-white/95 px-[18px] pb-[18px] pt-[25px] text-center shadow-[0_20px_48px_rgba(95,54,58,.14)]" style={{border:`1px solid ${levantamento?"#E8D1A5":"#E9D4B2"}`}}><div className="mx-auto flex h-[42px] w-[42px] items-center justify-center rounded-full" style={{background:levantamento?"#FBF1DD":"#F7EFED",color:levantamento?"#A77A24":"#8E3243"}}><LockIcon clock={levantamento}/></div><div className="pt-[13px] text-[8.5px] font-bold uppercase tracking-[.15em]" style={{color:levantamento?"#A77A24":"#B65B67"}}>{levantamento?"Levantamento financeiro":"Agenda bloqueada"}</div><div className="pt-[6px] font-heading text-[21px] font-semibold leading-[1.15] text-[#7D2434]">{levantamento?"Levantamento financeiro em andamento":"Agenda da assinatura dos termos"}</div><div className="px-[3px] pt-[9px] text-[11px] font-light leading-[1.55] text-[#7C6B68]">{levantamento?"Estamos realizando seu levantamento financeiro no prazo de até 5 dias úteis. Assim que a análise for concluída, a próxima etapa será liberada.":"Sua agenda permanece visível, porém bloqueada. Assim que você atingir o percentual necessário de pagamentos, iniciaremos seu levantamento financeiro."}</div><div className="mt-[13px] flex items-center justify-center gap-[7px] rounded-[10px] border px-[10px] py-[9px] text-[8.5px] font-semibold" style={levantamento?{background:"#FFF9EF",borderColor:"#EFD9AA",color:"#8E6420"}:{background:"#FFF6F6",borderColor:"#F0DDDD",color:"#8E3243"}}><LockIcon clock={levantamento}/>{levantamento?"Prazo estimado: até 5 dias úteis.":`Necessário atingir ${percentual}% das parcelas mínimas.`}</div></div></div>
    </div>
  </section>;
}
