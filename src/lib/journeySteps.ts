import { prazoLiberacaoDiasUteis } from "@/lib/clienteAgenda";
import type { ElementType } from "react";
import { Calendar, Clock3, CreditCard, FileSignature, HeartHandshake, PartyPopper, Sparkles } from "lucide-react";
import { formatarDataLonga } from "./utils";

export type JourneyStepStatus = "done" | "current" | "upcoming";

export interface JourneyStep {
  id: string;
  title: string;
  icon: ElementType;
  status: JourneyStepStatus;
  description: string;
}

export interface JourneyStepsInput {
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

/**
 * Estado real do processo, independente de quem está olhando. O app da
 * cliente e o drawer administrativo montam este snapshot a partir das suas
 * APIs e passam pelo mesmo `journeyInputFromProcess`, para que a Jornada seja
 * exatamente a mesma nos dois lados.
 */
export interface JourneyProcessSnapshot {
  percentualPagamento: number;
  percentualAtingido: boolean;
  statusRevisao: JourneyStepsInput["statusRevisao"];
  custeioStatus: JourneyStepsInput["custeioStatus"];
  temAgendamentoTermos: boolean;
  comparecimentoConfirmado: boolean;
  processoConcluido: boolean;
  agendaCirurgicaLiberadaEm: string | null;
  dataCirurgia: string | null;
  cirurgiaRealizada: boolean;
}

export function journeyInputFromProcess(s: JourneyProcessSnapshot): JourneyStepsInput {
  return {
    percentualPagamento: s.percentualPagamento,
    percentualAtingido: s.percentualAtingido,
    statusRevisao: s.statusRevisao,
    custeioStatus: s.custeioStatus,
    agendada: s.temAgendamentoTermos,
    termosAssinados: s.comparecimentoConfirmado || s.processoConcluido,
    // Depois de escolhida a data da cirurgia a agenda continua liberada.
    agendaCirurgicaLiberada: Boolean(s.agendaCirurgicaLiberadaEm) || Boolean(s.dataCirurgia),
    cirurgiaAgendada: Boolean(s.dataCirurgia),
    cirurgiaRealizada: s.cirurgiaRealizada,
    previsaoLiberacaoFinanceira: s.dataCirurgia,
    agendaCirurgicaLiberarEm: s.agendaCirurgicaLiberadaEm,
  };
}

/**
 * As 8 etapas fixas da Jornada, derivadas do estado real do contrato.
 * Extraído de `JourneyTracker.tsx` (o widget horizontal antigo, removido da
 * Home) para ser reaproveitado pela nova timeline vertical da aba Jornada —
 * mesmos nomes, mesmos textos e mesma lógica de done/current/upcoming, só a
 * apresentação visual muda.
 */
export function deriveJourneySteps({
  percentualPagamento,
  percentualAtingido,
  statusRevisao,
  custeioStatus,
  agendada,
  termosAssinados,
  agendaCirurgicaLiberada,
  cirurgiaAgendada,
  cirurgiaRealizada,
  previsaoLiberacaoFinanceira = null,
  agendaCirurgicaLiberarEm = null,
}: JourneyStepsInput): JourneyStep[] {
  const levantamentoAprovado = statusRevisao === "aprovada";
  const levantamentoRecusado = statusRevisao === "recusada";
  const custeioAprovado = custeioStatus === "aprovada";
  const custeioEnviado = custeioStatus === "pendente" || custeioStatus === "em_analise";
  const custeioRecusado = custeioStatus === "recusada";

  const percentualFormatado = Math.min(100, Math.max(0, Math.round(percentualPagamento)));
  const dataLiberacaoFormatada = previsaoLiberacaoFinanceira ? formatarDataLonga(previsaoLiberacaoFinanceira) : null;
  const dataAgendaCirurgicaFormatada = agendaCirurgicaLiberarEm ? formatarDataLonga(agendaCirurgicaLiberarEm) : null;

  return [
    {
      id: "contratar", title: "Contrato iniciado", icon: FileSignature, status: "done",
      description: "Seu contrato foi iniciado. Cada pagamento confirmado passa a fazer parte da sua evolução.",
    },
    {
      id: "pagamento", title: `${percentualFormatado}% das parcelas pagas`, icon: HeartHandshake,
      status: percentualAtingido ? "done" : "current",
      description: percentualAtingido
        ? "Você atingiu o percentual mínimo de parcelas pagas necessário para seguir na jornada."
        : "Cada pagamento confirmado te aproxima do percentual necessário. Envie seus comprovantes na aba \"Parcelas\".",
    },
    {
      id: "levantamento", title: "Levantamento financeiro", icon: Clock3,
      status: levantamentoAprovado ? "done" : percentualAtingido ? "current" : "upcoming",
      description: !percentualAtingido
        ? "Depois de atingir o percentual mínimo, nossa equipe faz o levantamento financeiro do seu contrato em até 5 dias úteis."
        : levantamentoAprovado
          ? "Levantamento financeiro concluído pela nossa equipe."
          : levantamentoRecusado
            ? "Identificamos uma divergência no levantamento financeiro. Confira o aviso na Home para regularizar e sermos capazes de refazer a análise."
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
              ? "Sua forma de pagamento anterior precisou de ajuste. Escolha novamente na Home."
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
        ? `Depois da assinatura dos termos e da quitação do saldo, a liberação da sua agenda da cirurgia é iniciada e ocorre em até ${prazoLiberacaoDiasUteis()} dias úteis.`
        : agendaCirurgicaLiberada
          ? "Agenda da cirurgia liberada para você escolher a data."
          : dataAgendaCirurgicaFormatada
            ? `Estamos preparando a liberação da sua agenda. Previsão: ${dataAgendaCirurgicaFormatada}.`
            : "Estamos preparando a liberação da sua agenda.",
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
  ];
}
