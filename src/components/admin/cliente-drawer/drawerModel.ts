import { deriveJourneySteps, journeyInputFromProcess } from "../../../lib/journeySteps";
import type { CartaoCliente, EstagioCentral } from "../../../features/scheduling/types";
import { ETAPA_POR_ID } from "../../../features/scheduling/jornada";
import type { Boleto } from "../../../types/database";
import { statusParcela, type ParcelaStatus } from "./drawerFormat";

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

export interface ResumoCarteira {
  total: number;
  pagas: number;
  vencidas: number;
  emConferencia: number;
  comprovantes: number;
  /** Soma das parcelas ainda não pagas (suspensas ficam de fora). */
  valorEmAberto: number;
  itens: { id: string; numero: number; status: ParcelaStatus; vencimento: string | null; valor: number }[];
}

/**
 * Carteira de parcelas do levantamento financeiro (aba Processo): contagens e
 * mapa por parcela, com o mesmo `statusParcela` da tabela do Financeiro.
 */
export function resumoCarteira(boletos: Pick<Boleto, "id" | "numero_parcela" | "status" | "data_vencimento" | "suspensa" | "valor" | "comprovante_url">[], hoje: string): ResumoCarteira {
  const itens = [...boletos]
    .sort((a, b) => a.numero_parcela - b.numero_parcela)
    .map((b) => ({ id: b.id, numero: b.numero_parcela, status: statusParcela(b, hoje), vencimento: b.data_vencimento, valor: Number(b.valor || 0) }));
  const conta = (s: ParcelaStatus) => itens.filter((i) => i.status === s).length;
  return {
    total: itens.length,
    pagas: conta("paid"),
    vencidas: conta("overdue"),
    emConferencia: conta("review"),
    comprovantes: boletos.filter((b) => b.comprovante_url).length,
    valorEmAberto: itens.filter((i) => i.status !== "paid" && i.status !== "suspended").reduce((s, i) => s + i.valor, 0),
    itens,
  };
}
