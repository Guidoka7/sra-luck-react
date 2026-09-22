import { deriveJourneySteps, journeyInputFromProcess } from "../../../lib/journeySteps";
import type { CartaoCliente, EstagioCentral } from "../../../features/scheduling/types";
import { estadoLiberacao, faltamTexto } from "../../../features/scheduling/v46Cards";

/**
 * Regras de exibição do drawer da cliente que dependem do estado persistido
 * do processo (`/api/admin/central/cliente/:id`). Sem React/CSS para poderem
 * ser testadas isoladamente.
 */

/** Rótulo da etapa real exibido no cabeçalho do drawer. */
export function statusDoDrawer(c: CartaoCliente, estagio: EstagioCentral, concluido: boolean, hoje: string): string {
  if (estagio === "preEligibility") return c.parcelasFaltantes === 0 ? "Etapa 1 · Aguardando solicitação" : `Etapa 1 · ${faltamTexto(c.parcelasFaltantes)}`;
  if (estagio === "financialReview") return c.statusRevisaoFinanceira === "aprovada" ? "Etapa 2 · Aguardando escolha dos termos" : "Etapa 2 · Levantamento";
  if (estagio === "termsConfirmed") return "Etapa 3 · Próximos termos";
  if (estagio === "financialRelease") {
    const e = estadoLiberacao(c, hoje);
    if (e.liberada) return "Etapa 4 · Agenda cirúrgica liberada";
    if (e.ambos) return e.decorridos === 0 ? `Etapa 4 · Aguardando prazo de ${e.totalDias} dias úteis` : `Etapa 4 · ${e.decorridos} de ${e.totalDias} dias úteis`;
    return "Etapa 4 · Conferência presencial";
  }
  return concluido ? "Etapa 5 · Processo concluído" : "Etapa 5 · Cirurgia confirmada";
}

/**
 * Aba Jornada: as mesmas 8 etapas do app da cliente (`deriveJourneySteps`),
 * alimentadas pelo mesmo adaptador `journeyInputFromProcess`.
 */
export function passosDaJornada(c: CartaoCliente, concluido: boolean) {
  return deriveJourneySteps(journeyInputFromProcess({
    percentualPagamento: c.totalParcelas ? (c.parcelasPagas / c.totalParcelas) * 100 : 0,
    percentualAtingido: c.parcelasFaltantes === 0,
    statusRevisao: c.statusRevisaoFinanceira,
    custeioStatus: c.custeioStatus,
    temAgendamentoTermos: Boolean(c.dataTermos),
    comparecimentoConfirmado: c.comparecimentoStatus === "compareceu",
    processoConcluido: concluido,
    agendaCirurgicaLiberadaEm: c.agendaCirurgicaLiberadaEm,
    dataCirurgia: c.dataCirurgia,
    cirurgiaRealizada: c.statusCirurgia === "realizada",
  }));
}
