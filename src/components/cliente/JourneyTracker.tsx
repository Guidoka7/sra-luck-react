"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useState, type ElementType } from "react";
import { Calendar, Check, FileSignature, HeartHandshake, PartyPopper, Sparkles, Star } from "lucide-react";
import { cn, formatarDataLonga } from "@/lib/utils";
import { FeedbackConclusao } from "@/components/cliente/FeedbackConclusao";

export type JourneyStepStatus = "done" | "current" | "upcoming";
export interface JourneyStep { id: string; label: string; icon: ElementType; status: JourneyStepStatus; }
interface JourneyTrackerProps { percentualPagamento: number; percentualAtingido: boolean; statusRevisao: "pendente" | "aprovada" | "recusada" | null; agendada: boolean; previsaoLiberacaoFinanceira?: string | null; }
type MomentoEspecial = "termos-amanha" | "termos-hoje" | "cirurgia-hoje" | null;
const TEST_CLOCK_KEY = "sra-luck-test-date";

function dataLocalISO(date: Date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function hojeDaAplicacao() { if (typeof window !== "undefined") { const teste = window.localStorage.getItem(TEST_CLOCK_KEY); if (teste && /^\d{4}-\d{2}-\d{2}$/.test(teste)) return teste; } return dataLocalISO(new Date()); }
function diferencaEmDias(dataISO: string, hojeISO: string) { const [y,m,d]=dataISO.split("-").map(Number); const [hy,hm,hd]=hojeISO.split("-").map(Number); if (![y,m,d,hy,hm,hd].every(Number.isFinite)) return null; return Math.round((Date.UTC(y,m-1,d)-Date.UTC(hy,hm-1,hd))/86400000); }
function formatarData(data?: string | null) { return data ? data.split("-").reverse().join("/") : ""; }

function CelebracaoEtapa({ momento, data, onFechar }: { momento: Exclude<MomentoEspecial,null>; data: string; onFechar: () => void }) {
  const cirurgia = momento === "cirurgia-hoje"; const hoje = momento === "termos-hoje"; const [feedbackAberto,setFeedbackAberto]=useState(false);
  const titulo = cirurgia ? "Hoje é o grande dia!" : hoje ? "Hoje é o dia da sua assinatura" : "Amanhã é um dia especial";
  const mensagem = cirurgia ? "Sua jornada chegou à conclusão. Hoje acontece a sua cirurgia e todo o processo que você percorreu até aqui se concretiza." : hoje ? "Chegou o dia da assinatura dos seus termos cirúrgicos. Estamos felizes em acompanhar você nesta etapa tão importante." : `Amanhã, ${formatarData(data)}, será a assinatura dos seus termos cirúrgicos. Prepare-se para esta etapa especial da sua jornada.`;
  return <AnimatePresence><motion.div className="fixed inset-0 z-[70] flex items-center justify-center bg-burgundy-dark/95 px-4 py-5 backdrop-blur-md sm:px-6 sm:py-6" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
    <motion.div className="w-[calc(100%-1.25rem)] max-w-[22rem] rounded-[28px] border border-rose/20 bg-burgundy px-5 py-6 text-center shadow-[0_24px_80px_rgba(0,0,0,.38)] sm:w-full sm:max-w-lg sm:rounded-[30px] sm:px-10 sm:py-8" initial={{scale:.94,opacity:0,y:8}} animate={{scale:1,opacity:1,y:0}} exit={{scale:.97,opacity:0,y:4}} transition={{type:"spring",stiffness:320,damping:26}}>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gold/35 bg-gold/10 text-gold sm:h-16 sm:w-16">{cirurgia ? <PartyPopper className="h-7 w-7 sm:h-8 sm:w-8"/> : <FileSignature className="h-7 w-7 sm:h-8 sm:w-8"/>}</div>
      <span className="mt-4 block text-[.65rem] font-semibold uppercase tracking-[.24em] text-gold sm:mt-5 sm:text-xs sm:tracking-[.28em]">{cirurgia ? "Conclusão da sua jornada" : hoje ? "Chegou o dia" : "Sua próxima etapa"}</span>
      <h2 className="mt-2.5 font-heading text-[1.65rem] font-semibold leading-tight text-cream sm:mt-3 sm:text-3xl">{titulo}</h2><p className="mx-auto mt-4 max-w-md text-[.82rem] leading-6 text-cream/75 sm:mt-5 sm:text-sm sm:leading-7">{mensagem}</p>
      {cirurgia && <><p className="mx-auto mt-3 max-w-md text-[.78rem] leading-5 text-cream/70 sm:mt-4 sm:text-sm sm:leading-6">Foi um prazer acompanhar você até aqui. Esperamos que toda a sua experiência com a Sra. Luck tenha sido especial e acolhedora.</p>{!feedbackAberto && <button type="button" onClick={()=>setFeedbackAberto(true)} className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold/35 bg-gold/10 px-4 py-2.5 text-[.68rem] font-bold uppercase tracking-label text-gold sm:mt-5 sm:px-5 sm:py-3 sm:text-xs"><Star className="h-3.5 w-3.5 fill-gold sm:h-4 sm:w-4"/> Avaliar minha experiência</button>}{feedbackAberto && <FeedbackConclusao onFechar={()=>setFeedbackAberto(false)}/>}</>}
      {!feedbackAberto && <button type="button" onClick={onFechar} className="mt-5 w-full rounded-full bg-cream px-5 py-2.5 text-[.68rem] font-bold uppercase tracking-label text-burgundy sm:mt-7 sm:py-3 sm:text-xs">{cirurgia ? "Continuar" : "Ver minha jornada"}</button>}
    </motion.div></motion.div></AnimatePresence>;
}

export function JourneyTracker({ percentualPagamento, percentualAtingido, statusRevisao, agendada, previsaoLiberacaoFinanceira=null }: JourneyTrackerProps) {
  const agendaLiberada = statusRevisao === "aprovada";
  const etapaAtual = useMemo(()=>{ if(!percentualAtingido) return "pagamento"; if(!agendaLiberada || !agendada) return "agendar"; return "cirurgia"; },[percentualAtingido,agendaLiberada,agendada]);
  const [etapaAberta,setEtapaAberta]=useState(etapaAtual); const [momentoEspecial,setMomentoEspecial]=useState<MomentoEspecial>(null); const [dataMomentoEspecial,setDataMomentoEspecial]=useState<string|null>(null);
  const steps: JourneyStep[]=[
    {id:"contratar",label:"Contratar",icon:FileSignature,status:"done"},
    {id:"pagamento",label:`${Math.min(100,Math.max(0,Math.round(percentualPagamento)))}% pago`,icon:HeartHandshake,status:percentualAtingido?"done":"current"},
    {id:"agendar",label:"Agendar",icon:Calendar,status:agendaLiberada&&agendada?"done":etapaAtual==="agendar"?"current":"upcoming"},
    {id:"cirurgia",label:"Cirurgia",icon:Sparkles,status:etapaAtual==="cirurgia"?"current":"upcoming"},
  ];
  const indiceAtual=steps.findIndex(s=>s.id===etapaAtual);
  useEffect(()=>setEtapaAberta(etapaAtual),[etapaAtual]);
  useEffect(()=>{ let cancelado=false; async function verificar(){ try{ const res=await fetch("/api/cliente/agenda",{cache:"no-store"}); if(!res.ok||cancelado)return; const data=await res.json(); const agenda=data.agendamentoAtivo??data.agendamentoConcluido??null; if(!agenda)return; const hoje=hojeDaAplicacao(); const termos=agenda.data as string|null|undefined; const liberacao=agenda.previsaoLiberacaoFinanceira as string|null|undefined; const dt=termos?diferencaEmDias(termos,hoje):null; const dl=liberacao?diferencaEmDias(liberacao,hoje):null; let proximo:MomentoEspecial=null; let evento:string|null=null; if(dl===0){proximo="cirurgia-hoje";evento=liberacao??null;} else if(dt===0){proximo="termos-hoje";evento=termos??null;} else if(dt===1){proximo="termos-amanha";evento=termos??null;} if(!proximo||!evento)return; const chave=`sra-luck-momento-especial:${proximo}:${evento}`; if(sessionStorage.getItem(chave)==="1")return; sessionStorage.setItem(chave,"1"); setDataMomentoEspecial(evento); setMomentoEspecial(proximo); fetch("/api/cliente/momentos-especiais",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({momento:proximo,dataEvento:evento})}).catch(()=>{}); }catch{} } verificar(); const intervalo=window.setInterval(verificar,15000); return()=>{cancelado=true;window.clearInterval(intervalo)}; },[]);
  const dataFormatadaLiberacao=previsaoLiberacaoFinanceira?formatarDataLonga(previsaoLiberacaoFinanceira):null;
  const textos:Record<string,string>={
    contratar:"Seu contrato foi iniciado. Agora, cada pagamento confirmado faz parte da sua evolução.",
    pagamento:percentualAtingido?"Parabéns! Você atingiu o percentual de pagamento necessário. A próxima etapa será a liberação da sua agenda.":"Cada pagamento confirmado te aproxima do percentual necessário para liberar sua agenda. Envie seus comprovantes na aba \"Meus Boletos\".",
    agendar:agendaLiberada?(agendada?"Sua assinatura dos termos cirúrgicos foi confirmada. Agora você segue para a próxima etapa da sua jornada.":"Sua agenda está liberada para escolher a assinatura dos termos cirúrgicos."):"Em até 5 dias úteis sua agenda será liberada",
    cirurgia:agendada?(dataFormatadaLiberacao?`Sua assinatura está confirmada. Você poderá realizar sua cirurgia a partir da data prevista para liberação financeira: ${dataFormatadaLiberacao}.`:"Sua assinatura está confirmada. A data prevista para liberação financeira será informada pela equipe."):"A cirurgia é a próxima conquista depois da assinatura dos termos."
  };
  return <>
    {momentoEspecial&&dataMomentoEspecial&&<CelebracaoEtapa momento={momentoEspecial} data={dataMomentoEspecial} onFechar={()=>setMomentoEspecial(null)}/>} 
    <div className="relative z-30 overflow-hidden rounded-2xl border-2 border-gold/20 bg-gradient-to-br from-white via-blush/30 to-white p-3.5 shadow-card transition-all duration-300 hover:border-gold/40 sm:p-4 dark:border-gold/20 dark:bg-gradient-to-br dark:from-[#202225] dark:via-[#181a1d] dark:to-[#111315]">
      <div className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full bg-gold/10 blur-2xl"/>
      <div className="relative mb-3 flex items-baseline justify-between gap-3"><h2 className="font-heading text-[.8rem] font-semibold text-burgundy sm:text-sm dark:text-[#F4D9DC]">Sua jornada até a cirurgia</h2><span className="rounded-full bg-gold/10 px-2 py-1 text-[.6rem] font-semibold uppercase tracking-label text-gold">{etapaAtual==="cirurgia"?"Próxima etapa":etapaAtual==="agendar"?"Etapa atual":"Em andamento"}</span></div>
      <div className="relative z-10 mx-auto flex max-w-md items-center justify-between gap-1">{steps.map((step,index)=>{
        const linhaAntesDaAtual=index<indiceAtual; const linhaParaProxima=index===indiceAtual;
        return <div key={step.id} className="flex min-w-0 flex-1 items-center">
          <button type="button" aria-current={step.id===etapaAtual?"step":undefined} onClick={()=>setEtapaAberta(step.id)} className="group relative z-10 mx-auto flex min-w-0 flex-col items-center gap-1 px-1.5 py-1 text-center transition-transform active:scale-[0.98] focus:outline-none focus-visible:outline-none" style={{WebkitTapHighlightColor:"transparent"}}>
            <span className={cn("relative flex h-10 w-10 items-center justify-center rounded-full border-2 shadow-sm transition-all duration-200 group-focus-visible:ring-2 group-focus-visible:ring-gold/70 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-white dark:group-focus-visible:ring-offset-[#181a1d]",step.status==="done"&&"border-rose bg-rose/10 text-burgundy shadow-[0_0_0_3px_rgba(211,117,143,.12)] dark:bg-rose/10 dark:text-rose",step.status==="current"&&"border-gold bg-gold/[0.06] text-burgundy shadow-[0_0_0_5px_rgba(201,161,90,.18),0_0_22px_rgba(201,161,90,.22)] dark:text-gold",step.status==="upcoming"&&"border-clay/20 bg-transparent text-clay/45 dark:border-white/15 dark:text-white/45")}>
              <step.icon className="h-[1.05rem] w-[1.05rem] shrink-0" strokeWidth={2.25}/>
              {step.status==="done"&&<span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-rose text-white shadow-sm dark:border-[#202225]"><Check className="h-2.5 w-2.5" strokeWidth={3}/></span>}
            </span>
            <span className={cn("max-w-[82px] truncate text-[.58rem] font-semibold uppercase tracking-label",step.status==="current"?"text-burgundy dark:text-gold":step.status==="done"?"text-burgundy/80 dark:text-[#F4D9DC]":"text-clay/45 dark:text-[#D9D9DE]/60")}>{step.label}</span>
          </button>
          {index<steps.length-1&&<div aria-hidden="true" className={cn("mx-1 flex-1 border-t border-dashed transition-colors duration-500",linhaAntesDaAtual?"border-rose/70":"",linhaParaProxima?"border-gold/80":"",!linhaAntesDaAtual&&!linhaParaProxima?"border-clay/25 dark:border-white/15":"")}/>} 
        </div>;
      })}</div>
      <AnimatePresence mode="wait"><motion.div key={etapaAberta} initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} className="relative z-10 mt-3 rounded-lg border border-rose/15 bg-transparent px-3 py-2 text-center text-[.7rem] leading-5 text-clay/70 dark:border-rose/15 dark:text-[#E7E2E5]/75">{textos[etapaAberta]??textos[etapaAtual]}</motion.div></AnimatePresence>
    </div>
  </>;
}
