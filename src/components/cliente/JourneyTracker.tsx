"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useState, type ElementType } from "react";
import { Calendar, Check, Clock3, CreditCard, FileSignature, HeartHandshake, PartyPopper, Sparkles, Star } from "lucide-react";
import { cn, formatarDataLonga } from "@/lib/utils";
import { FeedbackConclusao } from "@/components/cliente/FeedbackConclusao";

export type JourneyStepStatus = "done" | "current" | "upcoming";
export interface JourneyStep { id: string; title: string; icon: ElementType; status: JourneyStepStatus; description: string; }

interface JourneyTrackerProps {
  percentualPagamento: number;
  percentualAtingido: boolean;
  statusRevisao: "pendente" | "aprovada" | "recusada" | null;
  custeioStatus: "pendente" | "em_analise" | "aprovada" | "recusada" | null;
  agendada: boolean;
  termosAssinados: boolean;
  agendaCirurgicaLiberada: boolean;
  cirurgiaAgendada: boolean;
  cirurgiaRealizada: boolean;
  previsaoLiberacaoFinanceira?: string | null;
  agendaCirurgicaLiberarEm?: string | null;
}

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

export function JourneyTracker({
  percentualPagamento, percentualAtingido, statusRevisao, custeioStatus, agendada, termosAssinados,
  agendaCirurgicaLiberada, cirurgiaAgendada, cirurgiaRealizada, previsaoLiberacaoFinanceira = null, agendaCirurgicaLiberarEm = null,
}: JourneyTrackerProps) {
  const levantamentoAprovado = statusRevisao === "aprovada";
  const levantamentoRecusado = statusRevisao === "recusada";
  const custeioAprovado = custeioStatus === "aprovada";
  const custeioEnviado = custeioStatus === "pendente" || custeioStatus === "em_analise";
  const custeioRecusado = custeioStatus === "recusada";

  const [momentoEspecial,setMomentoEspecial]=useState<MomentoEspecial>(null); const [dataMomentoEspecial,setDataMomentoEspecial]=useState<string|null>(null);
  useEffect(()=>{ let cancelado=false; async function verificar(){ try{ const res=await fetch("/api/cliente/agenda",{cache:"no-store"}); if(!res.ok||cancelado)return; const data=await res.json(); const agenda=data.agendamentoAtivo??data.agendamentoConcluido??null; if(!agenda)return; const hoje=hojeDaAplicacao(); const termos=agenda.data as string|null|undefined; const liberacao=agenda.previsaoLiberacaoFinanceira as string|null|undefined; const dt=termos?diferencaEmDias(termos,hoje):null; const dl=liberacao?diferencaEmDias(liberacao,hoje):null; let proximo:MomentoEspecial=null; let evento:string|null=null; if(dl===0){proximo="cirurgia-hoje";evento=liberacao??null;} else if(dt===0){proximo="termos-hoje";evento=termos??null;} else if(dt===1){proximo="termos-amanha";evento=termos??null;} if(!proximo||!evento)return; const chave=`sra-luck-momento-especial:${proximo}:${evento}`; if(sessionStorage.getItem(chave)==="1")return; sessionStorage.setItem(chave,"1"); setDataMomentoEspecial(evento); setMomentoEspecial(proximo); fetch("/api/cliente/momentos-especiais",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({momento:proximo,dataEvento:evento})}).catch(()=>{}); }catch{} } verificar(); const intervalo=window.setInterval(verificar,15000); return()=>{cancelado=true;window.clearInterval(intervalo)}; },[]);

  const percentualFormatado = Math.min(100, Math.max(0, Math.round(percentualPagamento)));
  const dataLiberacaoFormatada = previsaoLiberacaoFinanceira ? formatarDataLonga(previsaoLiberacaoFinanceira) : null;
  const dataAgendaCirurgicaFormatada = agendaCirurgicaLiberarEm ? formatarDataLonga(agendaCirurgicaLiberarEm) : null;

  const steps: JourneyStep[] = useMemo(() => [
    {
      id: "contratar", title: "Contrato iniciado", icon: FileSignature, status: "done",
      description: "Seu contrato foi iniciado. Cada pagamento confirmado passa a fazer parte da sua evolução.",
    },
    {
      id: "pagamento", title: `${percentualFormatado}% das parcelas pagas`, icon: HeartHandshake,
      status: percentualAtingido ? "done" : "current",
      description: percentualAtingido
        ? "Você atingiu o percentual mínimo de parcelas pagas necessário para seguir na jornada."
        : "Cada pagamento confirmado te aproxima do percentual necessário. Envie seus comprovantes na aba \"Meus Boletos\".",
    },
    {
      id: "levantamento", title: "Levantamento financeiro", icon: Clock3,
      status: levantamentoAprovado ? "done" : percentualAtingido ? "current" : "upcoming",
      description: !percentualAtingido
        ? "Depois de atingir o percentual mínimo, nossa equipe faz o levantamento financeiro do seu contrato em até 5 dias úteis."
        : levantamentoAprovado
          ? "Levantamento financeiro concluído pela nossa equipe."
          : levantamentoRecusado
            ? "Identificamos uma divergência no levantamento financeiro. Confira o aviso acima para regularizar e sermos capazes de refazer a análise."
            : "Estamos realizando seu levantamento financeiro no prazo de até 5 dias úteis.",
    },
    {
      id: "custeio", title: "Forma de pagamento do saldo", icon: CreditCard,
      status: custeioAprovado ? "done" : levantamentoAprovado ? "current" : "upcoming",
      description: !levantamentoAprovado
        ? "Depois do levantamento financeiro, você escolhe como deseja pagar o saldo restante do contrato."
        : custeioAprovado
          ? "Forma de pagamento do saldo restante confirmada pela nossa equipe."
          : custeioEnviado
            ? "Recebemos sua escolha de pagamento e estamos confirmando com a equipe financeira."
            : custeioRecusado
              ? "Sua forma de pagamento anterior precisou de ajuste. Escolha novamente na aba \"Minha Agenda\"."
              : "Sua agenda está pronta para você escolher como pagar o saldo restante do contrato.",
    },
    {
      id: "assinatura", title: "Assinatura dos termos", icon: Calendar,
      status: termosAssinados ? "done" : custeioAprovado ? "current" : "upcoming",
      description: !custeioAprovado
        ? "Depois da forma de pagamento confirmada, sua agenda libera para você escolher o dia e horário da assinatura."
        : termosAssinados
          ? "Termos assinados e saldo restante quitado em nosso escritório."
          : agendada
            ? "Assinatura marcada. No dia, compareça ao nosso escritório e quite o saldo restante para concluir esta etapa."
            : "Sua agenda está liberada. Escolha o dia e o horário para a assinatura dos termos cirúrgicos.",
    },
    {
      id: "liberacao-cirurgica", title: "Liberação da agenda da cirurgia", icon: Clock3,
      status: agendaCirurgicaLiberada ? "done" : termosAssinados ? "current" : "upcoming",
      description: !termosAssinados
        ? "Depois da assinatura e da quitação do saldo, sua agenda da cirurgia é liberada em até 5 dias úteis."
        : agendaCirurgicaLiberada
          ? "Agenda da cirurgia liberada para você escolher a data."
          : dataAgendaCirurgicaFormatada
            ? `Estamos preparando a liberação da sua agenda. Previsão: ${dataAgendaCirurgicaFormatada}.`
            : "Estamos preparando a liberação da sua agenda no prazo de até 5 dias úteis.",
    },
    {
      id: "data-cirurgia", title: "Escolha da data da cirurgia", icon: Calendar,
      status: cirurgiaAgendada ? "done" : agendaCirurgicaLiberada ? "current" : "upcoming",
      description: !agendaCirurgicaLiberada
        ? "Assim que sua agenda for liberada, você escolhe a data da sua cirurgia diretamente pelo aplicativo."
        : cirurgiaAgendada
          ? dataLiberacaoFormatada
            ? `Sua cirurgia está programada para ${dataLiberacaoFormatada}.`
            : "Data da cirurgia confirmada."
          : "Escolha no aplicativo a data da sua cirurgia.",
    },
    {
      id: "cirurgia", title: "Cirurgia", icon: cirurgiaRealizada ? PartyPopper : Sparkles,
      status: cirurgiaRealizada ? "done" : cirurgiaAgendada ? "current" : "upcoming",
      description: cirurgiaRealizada
        ? "Cirurgia realizada! Toda a sua jornada com a Sra. Luck chegou à conclusão."
        : "A cirurgia é a conquista final da sua jornada com a Sra. Luck.",
    },
  ], [percentualAtingido, percentualFormatado, levantamentoAprovado, levantamentoRecusado, custeioAprovado, custeioEnviado, custeioRecusado, termosAssinados, agendada, agendaCirurgicaLiberada, dataAgendaCirurgicaFormatada, cirurgiaAgendada, dataLiberacaoFormatada, cirurgiaRealizada]);

  const etapaAtual = steps.find((step) => step.status === "current") ?? steps[steps.length - 1];

  return <>
    {momentoEspecial&&dataMomentoEspecial&&<CelebracaoEtapa momento={momentoEspecial} data={dataMomentoEspecial} onFechar={()=>setMomentoEspecial(null)}/>}
    <div className="relative z-30 overflow-hidden rounded-2xl border-2 border-gold/20 bg-gradient-to-br from-white via-blush/30 to-white p-3.5 shadow-card transition-all duration-300 hover:border-gold/40 sm:p-4 dark:border-gold/20 dark:bg-gradient-to-br dark:from-[#202225] dark:via-[#181a1d] dark:to-[#111315]">
      <div className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full bg-gold/10 blur-2xl"/>
      <div className="relative mb-3.5 flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-[.8rem] font-semibold text-burgundy sm:text-sm dark:text-[#F4D9DC]">Sua jornada até a cirurgia</h2>
        <span className="rounded-full bg-gold/10 px-2 py-1 text-[.6rem] font-semibold uppercase tracking-label text-gold">{etapaAtual.title}</span>
      </div>

      <div className="relative z-10 space-y-0">
        {steps.map((step, index) => (
          <div key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < steps.length - 1 && (
              <span aria-hidden="true" className={cn(
                "absolute left-[19px] top-10 bottom-0 w-px",
                step.status === "done" ? "bg-rose/60" : "bg-clay/15 dark:bg-white/12",
              )} />
            )}
            <span className={cn(
              "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 shadow-sm transition-all duration-200",
              step.status === "done" && "border-rose bg-rose/10 text-burgundy shadow-[0_0_0_3px_rgba(211,117,143,.12)] dark:bg-rose/10 dark:text-rose",
              step.status === "current" && "border-gold bg-gold/[0.06] text-burgundy shadow-[0_0_0_5px_rgba(201,161,90,.18),0_0_22px_rgba(201,161,90,.22)] dark:text-gold",
              step.status === "upcoming" && "border-clay/20 bg-transparent text-clay/45 dark:border-white/15 dark:text-white/45",
            )}>
              <step.icon className="h-[1.05rem] w-[1.05rem] shrink-0" strokeWidth={2.25} />
              {step.status === "done" && <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-rose text-white shadow-sm dark:border-[#202225]"><Check className="h-2.5 w-2.5" strokeWidth={3}/></span>}
            </span>
            <div className="min-w-0 flex-1 pt-1.5">
              <p className={cn(
                "text-[.72rem] font-semibold",
                step.status === "current" ? "text-burgundy dark:text-gold" : step.status === "done" ? "text-burgundy/85 dark:text-[#F4D9DC]" : "text-clay/50 dark:text-white/50",
              )}>{step.title}</p>
              <p className={cn(
                "mt-0.5 leading-5",
                step.status === "current" ? "text-[.68rem] text-clay/75 dark:text-[#E7E2E5]/80" : "text-[.62rem] text-clay/45 dark:text-white/38",
              )}>{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </>;
}
