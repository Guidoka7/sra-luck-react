export type JourneyStepStatus = "done" | "current" | "upcoming";

export interface JourneyStepInfo {
  numero: number;
  nome: string;
  status: JourneyStepStatus;
  desc: string;
}

export interface JourneyStepsInput {
  porcentagemPagamento: number;
  percentualAtingido: boolean;
  statusRevisaoFinanceira: "pendente" | "aprovada" | "recusada" | null;
  agendaLiberada: boolean;
  agendamentoAtivo: { previsaoLiberacaoFinanceira: string | null } | null;
  agendamentoConcluido: { previsaoLiberacaoFinanceira: string | null } | null;
}

/**
 * Deriva os 8 passos da Jornada (nomes fixos do produto) a partir do estado
 * REAL já carregado pela Home (/api/cliente/agenda + /api/cliente/boletos).
 * Nenhum percentual/data é inventado aqui — só a rotulagem concluído/atual/
 * próximo é calculada em cima dos campos que o backend já retorna.
 */
export function deriveJourneySteps({
  porcentagemPagamento,
  percentualAtingido,
  statusRevisaoFinanceira,
  agendaLiberada,
  agendamentoAtivo,
  agendamentoConcluido,
}: JourneyStepsInput): JourneyStepInfo[] {
  const revisaoAprovada = statusRevisaoFinanceira === "aprovada" || agendaLiberada;
  const temAgendamento = Boolean(agendamentoAtivo || agendamentoConcluido);
  const previsao = agendamentoConcluido?.previsaoLiberacaoFinanceira ?? agendamentoAtivo?.previsaoLiberacaoFinanceira ?? null;
  const previsaoNoPassado = previsao ? new Date(`${previsao.slice(0, 10)}T00:00:00`) <= new Date() : false;

  const passos: { nome: string; status: JourneyStepStatus; desc: string }[] = [
    {
      nome: "Contrato confirmado",
      status: "done",
      desc: "Seu contrato foi recebido e está ativo no acompanhamento.",
    },
    {
      nome: "Parcelas em andamento",
      status: percentualAtingido ? "done" : "current",
      desc: percentualAtingido
        ? "Você já concluiu esta fase de pagamentos."
        : `Você está em ${Math.round(porcentagemPagamento)}% do necessário para liberar sua agenda.`,
    },
    {
      nome: "Percentual mínimo atingido",
      status: percentualAtingido ? "done" : "upcoming",
      desc: percentualAtingido
        ? "Percentual necessário atingido — seu levantamento financeiro pode começar."
        : "Continue pagando suas parcelas para atingir o percentual necessário.",
    },
    {
      nome: "Levantamento financeiro",
      status: revisaoAprovada ? "done" : percentualAtingido ? "current" : "upcoming",
      desc: revisaoAprovada
        ? "Levantamento concluído e aprovado pela equipe financeira."
        : percentualAtingido
          ? "Nossa equipe está conferindo seus pagamentos (até 5 dias úteis)."
          : "Começa assim que o percentual mínimo for atingido.",
    },
    {
      nome: "Agenda e assinatura dos termos",
      status: temAgendamento ? "done" : revisaoAprovada ? "current" : "upcoming",
      desc: temAgendamento
        ? "Data da assinatura dos termos confirmada."
        : revisaoAprovada
          ? "Sua agenda está liberada — escolha a data da assinatura."
          : "Liberada após a aprovação do levantamento financeiro.",
    },
    {
      nome: "Definição do custeio",
      status: previsao ? "done" : temAgendamento ? "current" : "upcoming",
      desc: previsao
        ? "Forma de custeio do saldo restante definida."
        : temAgendamento
          ? "Defina com a equipe a forma de custeio do saldo restante."
          : "Definida após a assinatura dos termos.",
    },
    {
      nome: "Agenda cirúrgica liberada",
      status: previsao ? (previsaoNoPassado ? "done" : "current") : "upcoming",
      desc: previsao
        ? `Liberação prevista para ${previsao.split("-").reverse().join("/")}.`
        : "Liberada após a quitação do saldo restante.",
    },
    {
      nome: "Cirurgia agendada",
      status: previsaoNoPassado ? "current" : "upcoming",
      desc: previsaoNoPassado
        ? "Escolha a data da sua cirurgia com a equipe."
        : "Próxima conquista depois da liberação da agenda cirúrgica.",
    },
  ];

  return passos.map((passo, indice) => ({ numero: indice + 1, ...passo }));
}
