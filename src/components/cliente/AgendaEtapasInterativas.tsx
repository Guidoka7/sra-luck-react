"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export type EtapaAgenda = "percentual" | "levantamento" | "pagamento" | "data";

type Props = {
  atual: EtapaAgenda;
  percentual?: number;
  parcelasPagas?: number;
  parcelasNecessarias?: number | null;
  onPagamentoClick?: () => void;
};

const META: Record<EtapaAgenda,{numero:number;titulo:string;status:string}> = {
  percentual:{numero:1,titulo:"Percentual mínimo de pagamento",status:"EM ANDAMENTO"},
  levantamento:{numero:2,titulo:"Análise e levantamento financeiro",status:"EM ANÁLISE"},
  pagamento:{numero:3,titulo:"Definição da forma de pagamento do saldo",status:"SUA AÇÃO"},
  data:{numero:4,titulo:"Agendamento da assinatura dos termos",status:"AGENDA LIBERADA"},
};

function copy(atual:EtapaAgenda,percentual?:number,parcelasPagas?:number,parcelasNecessarias?:number|null) {
  if(atual==="percentual") {
    if(parcelasNecessarias && parcelasPagas!=null) return "Você já confirmou " + Math.min(parcelasPagas,parcelasNecessarias) + " de " + parcelasNecessarias + " parcelas necessárias. Ao atingir " + (percentual ?? 70) + "% das parcelas reais pagas, seu contrato segue automaticamente para o levantamento financeiro.";
    return "Atinga o percentual mínimo de " + (percentual ?? 70) + "% das parcelas reais pagas para avançar.";
  }
  if(atual==="levantamento") return "O financeiro confere os pagamentos reais do seu contrato, calcula o saldo restante e define as formas de quitação que ficarão disponíveis para você. Enquanto esta análise não for concluída, a agenda dos termos permanece bloqueada.";
  if(atual==="pagamento") return "Seu levantamento foi concluído. Escolha uma das formas de quitação liberadas pelo financeiro. Essa escolha conclui a Etapa 3 e libera a Etapa 4 para selecionar a data e o horário dos termos.";
  return "A Etapa 4 está liberada. Escolha uma data aberta e um horário disponível para a assinatura dos termos. Sua reserva será confirmada diretamente na agenda real da equipe.";
}

export function AgendaEtapasInterativas({ atual, percentual, parcelasPagas, parcelasNecessarias, onPagamentoClick }: Props) {
  const meta=META[atual];
  const [expanded,setExpanded]=useState(atual!=="data");
  useEffect(()=>setExpanded(atual!=="data"),[atual]);

  const card = <div className="rounded-[16px] border border-[#E9DADD] bg-white px-[14px] py-[13px] shadow-[0_7px_22px_rgba(83,48,53,.06)]">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[8px] font-bold uppercase tracking-[.13em] text-[#A99894]">Etapa {meta.numero} de 4</div>
        <div className="pt-[2px] font-heading text-[18px] font-semibold leading-[1.15] text-[#7D2434]">{meta.titulo}</div>
      </div>
      <span className={"flex-none rounded-full border px-[8px] py-[5px] text-[7.5px] font-bold uppercase tracking-[.045em] " + (atual==="data" ? "border-[#CFE3D4] bg-[#EEF7F0] text-[#3F7D5B]" : "border-[#E8D2A9] bg-[#FFF9EF] text-[#8E6420]")}>{meta.status}</span>
    </div>
    {expanded ? <motion.div initial={{opacity:0,y:-3}} animate={{opacity:1,y:0}} className="pt-[10px]">
      <p className="text-[10.7px] font-light leading-[1.55] text-[#786A66]">{copy(atual,percentual,parcelasPagas,parcelasNecessarias)}</p>
      {atual==="pagamento" && onPagamentoClick ? <button type="button" onClick={onPagamentoClick} className="mt-[11px] w-full rounded-[11px] border border-[#E1C48C] bg-[#FFF7E8] px-3 py-[10px] text-[10.2px] font-semibold text-[#7D5B1E]">Ver saldo e definir a forma de pagamento</button> : null}
      <div className="mt-[12px] grid grid-cols-4 gap-[5px]" aria-label="Progresso das quatro etapas">
        {[1,2,3,4].map((numero)=><div key={numero} className="text-center">
          <span className={"mx-auto flex h-[25px] w-[25px] items-center justify-center rounded-full text-[8px] font-bold " + (numero<meta.numero ? "bg-[#E5F2E8] text-[#3F7D5B]" : numero===meta.numero ? atual==="data" ? "bg-[#3F7D5B] text-white" : "bg-[#7D2434] text-white" : "bg-[#F2ECEA] text-[#9B8B87]")}>{numero<meta.numero?"✓":numero}</span>
          <span className="mt-[3px] block text-[6.8px] font-semibold uppercase tracking-[.04em] text-[#A3928E]">Etapa {numero}</span>
        </div>)}
      </div>
    </motion.div> : null}
  </div>;

  if(atual!=="data") return card;

  return <div>
    <button type="button" className="w-full text-left" aria-expanded={expanded} onClick={()=>setExpanded((value)=>!value)}>
      {card}
      <span className="mt-[5px] block text-right text-[8px] font-semibold text-[#8E6670]">{expanded?"Recolher etapa":"Toque para ver os detalhes"} {expanded?"⌃":"⌄"}</span>
    </button>
  </div>;
}
