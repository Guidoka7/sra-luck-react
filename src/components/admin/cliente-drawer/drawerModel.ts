import { deriveJourneySteps, journeyInputFromProcess } from "../../../lib/journeySteps";
import type { CartaoCliente, EstagioCentral } from "../../../features/scheduling/types";
import { ETAPA_POR_ID } from "../../../features/scheduling/jornada";

/**
 * Regras de exibição do drawer da cliente que dependem do estado persistido
 * do processo (`/api/admin/central/cliente/:id`). Sem React/CSS para poderem
 * ser testadas isoladamente.
 */

/**
 * Rótulo da etapa real no cabeçalho do drawer (visível em todas as abas). A
 * situação detalhada fica só na aba Processo, para não repetir informação.
 */
export function statusDoDrawer(estagio: EstagioCentral, concluido: boolean): string {
  const etapa = ETAPA_POR_ID.get(estagio)!;
  return `Etapa ${etapa.numero} · ${concluido ? "Processo concluído" : etapa.titulo}`;
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
