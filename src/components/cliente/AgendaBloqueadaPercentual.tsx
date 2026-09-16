"use client";

import { useState } from "react";
import { CalendarioAgendamento, DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Etapa = "percentual" | "levantamento";
type EtapaLevantamento = "percentual" | "analise" | "agenda";

function LockIcon({ clock=false }: { clock?: boolean }) {
  if (clock) return <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="9" cy="9" r="6.2"/><path d="M9 5.6V9l2.3 1.5"/></svg>;
  return <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><rect x="3.8" y="8" width="10.4" height="7" rx="1.8"/><path d="M6.2 8V5.9a2.8 2.8 0 0 1 5.6 0V8"/></svg>;
}

function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.45"><path d="m4.3 9.2 3 3.1 6.4-6.6"/></svg>;
}

function CalendarIcon() {
  return <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25"><rect x="3" y="4.5" width="12" height="10.5" rx="2"/><path d="M6 2.8v3M12 2.8v3M3 7.5h12"/></svg>;
}

const DETALHES_ETAPA: Record<EtapaLevantamento, { titulo: string; status: string; texto: string; tom: "ok" | "atual" | "proxima" }> = {
  percentual: {
    titulo: "Percentual atingido",
    status: "Concluído",
    texto: "Você já atingiu o percentual necessário de pagamentos. Por isso, seu contrato avançou para a conferência financeira.",
    tom: "ok",
  },
  analise: {
    titulo: "Levantamento financeiro",
    status: "Em andamento",
    texto: "Estamos conferindo seus pagamentos e a situação financeira do contrato. O prazo operacional desta análise é de até 5 dias úteis.",
    tom: "atual",
  },
  agenda: {
    titulo: "Escolha da data",
    status: "Próxima etapa",
    texto: "Assim que o levantamento financeiro for concluído, a escolha da data será liberada para você continuar sua jornada.",
    tom: "proxima",
  },
};

function LevantamentoFinanceiroInterativo() {
  const [selecionada, setSelecionada] = useState<EtapaLevantamento>("analise");
  const detalhe = DETALHES_ETAPA[selecionada];
  const etapas: Array<{ id: EtapaLevantamento; numero: string; titulo: string; icon: "check" | "clock" | "calendar" }> = [
    { id: "percentual", numero: "01", titulo: "Percentual atingido", icon: "check" },
    { id: "analise", numero: "02", titulo: "Levantamento", icon: "clock" },
    { id: "agenda", numero: "03", titulo: "Escolha da data", icon: "calendar" },
  ];

  const tomDetalhe = detalhe.tom === "ok"
    ? { bg: "#F4F9F5", border: "#D7E8DA", badgeBg: "#E4F1E7", badge: "#3F7D5B", iconBg: "#EAF4EC", icon: "#3F7D5B" }
    : detalhe.tom === "atual"
      ? { bg: "#FFF9F0", border: "#EBD8B3", badgeBg: "#F8EEDB", badge: "#8E6420", iconBg: "#FBF1DD", icon: "#A77A24" }
      : { bg: "#FAF7F6", border: "#EAE0DD", badgeBg: "#F1E9E6", badge: "#8A7B77", iconBg: "#F3EEEC", icon: "#8A7B77" };

  return <div className="px-[14px] pb-[15px] pt-[14px]">
    <div className="rounded-[17px] border border-[#EBD8B3] bg-gradient-to-br from-[#FFFDF9] to-[#FFF8ED] px-[14px] pb-[14px] pt-[13px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-[9px]">
          <span className="relative flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] bg-[#F8EEDB] text-[#A77A24]">
            <span className="absolute inset-0 animate-ping rounded-[11px] bg-[#E7C987]/20" />
            <span className="relative"><LockIcon clock /></span>
          </span>
          <div className="min-w-0">
            <div className="text-[8px] font-bold uppercase tracking-[.15em] text-[#A77A24]">Etapa atual · 2 de 3</div>
            <div className="pt-[2px] font-heading text-[16px] font-semibold leading-tight text-[#7D2434]">Levantamento financeiro em andamento</div>
          </div>
        </div>
        <span className="flex flex-none items-center gap-[5px] rounded-full border border-[#E8D2A9] bg-white/80 px-[8px] py-[5px] text-[8px] font-semibold text-[#8E6420]">
          <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[#B7862A]" />
          EM ANÁLISE
        </span>
      </div>
      <p className="pt-[9px] text-[10.5px] font-light leading-[1.5] text-[#786A66]">Acompanhe abaixo em que ponto está a liberação da sua agenda. Toque em cada etapa para entender o processo.</p>
    </div>

    <div className="relative mt-[13px] grid grid-cols-3 gap-[7px]">
      <div className="pointer-events-none absolute left-[16.5%] right-[16.5%] top-[20px] h-px bg-[#E6D9D5]" />
      <div className="pointer-events-none absolute left-[16.5%] top-[20px] h-px w-[33.5%] bg-[#C89D45]" />
      {etapas.map((item) => {
        const ativo = selecionada === item.id;
        const concluido = item.id === "percentual";
        const atual = item.id === "analise";
        return <button
          key={item.id}
          type="button"
          onClick={() => setSelecionada(item.id)}
          aria-pressed={ativo}
          className={`relative z-[1] min-w-0 rounded-[13px] border px-[5px] pb-[9px] pt-[7px] text-center transition ${ativo ? "border-[#D8BD86] bg-[#FFF9EF] shadow-[0_5px_14px_rgba(127,91,30,.08)]" : "border-[#EDE4E1] bg-white hover:bg-[#FCF9F8]"}`}
        >
          <span className={`mx-auto flex h-[27px] w-[27px] items-center justify-center rounded-full border ${concluido ? "border-[#CFE2D3] bg-[#EAF4EC] text-[#3F7D5B]" : atual ? "border-[#E4C98E] bg-[#FBF1DD] text-[#A77A24]" : "border-[#E5DBD8] bg-[#F5F1EF] text-[#9A8A86]"}`}>
            {item.icon === "check" ? <CheckIcon /> : item.icon === "clock" ? <LockIcon clock /> : <CalendarIcon />}
          </span>
          <span className="block pt-[5px] text-[7px] font-bold uppercase tracking-[.12em] text-[#A99894]">{item.numero}</span>
          <span className={`block pt-[2px] text-[9px] font-semibold leading-[1.25] ${ativo ? "text-[#7D2434]" : "text-[#71615E]"}`}>{item.titulo}</span>
        </button>;
      })}
    </div>

    <div className="mt-[10px] rounded-[15px] border px-[13px] pb-[13px] pt-[12px] transition-colors" style={{ background: tomDetalhe.bg, borderColor: tomDetalhe.border }}>
      <div className="flex items-start gap-[10px]">
        <span className="flex h-[31px] w-[31px] flex-none items-center justify-center rounded-[10px]" style={{ background: tomDetalhe.iconBg, color: tomDetalhe.icon }}>
          {selecionada === "percentual" ? <CheckIcon /> : selecionada === "analise" ? <LockIcon clock /> : <CalendarIcon />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-[6px]">
            <div className="font-heading text-[14px] font-semibold text-[#4B3936]">{detalhe.titulo}</div>
            <span className="rounded-full px-[7px] py-[3px] text-[7.5px] font-bold uppercase tracking-[.08em]" style={{ background: tomDetalhe.badgeBg, color: tomDetalhe.badge }}>{detalhe.status}</span>
          </div>
          <p className="pt-[5px] text-[10px] font-light leading-[1.5] text-[#786A66]">{detalhe.texto}</p>
        </div>
      </div>
    </div>

    <div className="mt-[10px] flex items-center justify-between gap-3 rounded-[12px] border border-[#EFD9AA] bg-[#FFF9EF] px-[11px] py-[10px]">
      <div className="flex min-w-0 items-center gap-[7px] text-[9px] font-medium text-[#7D642C]"><LockIcon clock /><span>Prazo estimado do levantamento</span></div>
      <strong className="whitespace-nowrap text-[9px] font-bold text-[#8E6420]">até 5 dias úteis</strong>
    </div>
  </div>;
}

export function AgendaBloqueadaPercentual({ percentual, parcelasNecessarias, datas, etapa = "percentual" }: { percentual:number; parcelasNecessarias:number|null; datas:DataDisponivel[]; etapa?:Etapa }) {
  const levantamento=etapa==="levantamento";
  return <section className="overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
    <div className="border-b px-[13px] py-3" style={{background:levantamento?"#FFF9F2":"#FFF7F7",borderColor:levantamento?"#F0E2C7":"#F0DDDD"}}>
      <div className="flex items-start gap-[10px]"><span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px]" style={{background:levantamento?"#F8EEDB":"#F7E9EA",color:levantamento?"#A77A24":"#B65B67"}}><LockIcon clock={levantamento}/></span><div className="min-w-0"><div className="text-[8.5px] font-bold uppercase tracking-[.13em]" style={{color:levantamento?"#A77A24":"#B65B67"}}>Minha agenda</div><div className="pt-[2px] font-heading text-[15px] font-semibold leading-[1.25] text-[#7D2434]">{levantamento?"Estamos realizando seu levantamento financeiro":"Atinja o percentual mínimo para liberar sua agenda"}</div><div className="pt-[2px] text-[9.6px] font-light leading-[1.45] text-[#7E6867]">{levantamento?"Você já atingiu o percentual necessário. Estamos conferindo seus pagamentos para liberar a escolha da data.":<>Para liberar a escolha da data, você precisa atingir <b className="font-semibold text-[#7D2434]">{percentual}% das parcelas mínimas pagas</b>{parcelasNecessarias?` (${parcelasNecessarias} parcelas).`:"."}</>}</div></div></div>
    </div>

    {levantamento ? <LevantamentoFinanceiroInterativo /> : <div className="relative min-h-[395px] p-[14px]">
      <div className="pointer-events-none select-none opacity-[.38] blur-[3.2px]"><CalendarioAgendamento datas={datas} onConfirmar={()=>{}} confirmando={false} bloqueado /></div>
      <div className="absolute inset-[14px] flex items-center justify-center"><div className="w-full max-w-[345px] rounded-[16px] border border-[#E9D4B2] bg-white/95 px-[18px] pb-[18px] pt-[25px] text-center shadow-[0_20px_48px_rgba(95,54,58,.14)]"><div className="mx-auto flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[#F7EFED] text-[#8E3243]"><LockIcon /></div><div className="pt-[13px] text-[8.5px] font-bold uppercase tracking-[.15em] text-[#B65B67]">Agenda bloqueada</div><div className="pt-[6px] font-heading text-[21px] font-semibold leading-[1.15] text-[#7D2434]">Agenda da assinatura dos termos</div><div className="px-[3px] pt-[9px] text-[11px] font-light leading-[1.55] text-[#7C6B68]">Sua agenda permanece visível, porém bloqueada. Assim que você atingir o percentual necessário de pagamentos, iniciaremos seu levantamento financeiro.</div><div className="mt-[13px] flex items-center justify-center gap-[7px] rounded-[10px] border border-[#F0DDDD] bg-[#FFF6F6] px-[10px] py-[9px] text-[8.5px] font-semibold text-[#8E3243]"><LockIcon />Necessário atingir {percentual}% das parcelas mínimas.</div></div></div>
    </div>}
  </section>;
}
