import { dataBr, diasEntre, proximoDiaUtil } from "./api";
import { estadoLiberacao, faltamTexto } from "./v46Cards";
import type { CartaoCliente, EstagioCentral } from "./types";

/**
 * Leitura das 5 filas da Central (somente exibição). As filas vêm prontas de
 * `/api/admin/central/visao-geral` (etapa definida por `etapaCentral` no
 * Worker); aqui só se explica cada etapa, quem precisa agir e o que falta.
 * Nenhuma regra de negócio é decidida no navegador.
 */

/** Quem destrava o próximo passo da cliente. */
export type Responsavel = "equipe" | "cliente" | "sistema";
export type TomSituacao = "danger" | "wait" | "info" | "success";

export interface Situacao {
  responsavel: Responsavel;
  tom: TomSituacao;
  /** O que está acontecendo, em uma frase curta. */
  texto: string;
  /** Referência de tempo/prazo já formatada. */
  prazo: string | null;
  atrasado: boolean;
  /** Ordenação por urgência (menor = mais urgente). */
  urgencia: number;
}

export interface Segmento {
  id: string;
  rotulo: string;
  filtro: (c: CartaoCliente, hoje: string) => boolean;
}

export interface EtapaInfo {
  id: EstagioCentral;
  numero: number;
  titulo: string;
  curto: string;
  /** O que é esta lista. */
  resumo: string;
  /** Como a cliente sai desta lista. */
  saida: string;
  segmentos: Segmento[];
}

/** BUSINESS-RULES §11 Etapa C — mesmo prazo exibido na Visão geral. */
export const PRAZO_LEVANTAMENTO_DIAS_UTEIS = 5;

export const ROTULO_RESPONSAVEL: Record<Responsavel, string> = {
  equipe: "Equipe",
  cliente: "Cliente",
  sistema: "Automático",
};

const todas: Segmento = { id: "todas", rotulo: "Todas", filtro: () => true };

function somarDiasUteis(iso: string, dias: number) {
  let atual = iso;
  for (let i = 0; i < dias; i++) atual = proximoDiaUtil(atual);
  return atual;
}

function emDias(dias: number) {
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  if (dias > 1) return `em ${dias} dias`;
  return dias === -1 ? "há 1 dia" : `há ${-dias} dias`;
}

function atraso(dias: number) {
  return dias === 1 ? "1 dia em atraso" : `${dias} dias em atraso`;
}

/** Prazo do levantamento: solicitação + 5 dias úteis. */
export function prazoLevantamento(c: CartaoCliente): string | null {
  const solicitado = c.liberacaoFinanceiraSolicitadaEm?.slice(0, 10);
  return solicitado ? somarDiasUteis(solicitado, PRAZO_LEVANTAMENTO_DIAS_UTEIS) : null;
}

/** Fase da Etapa 4, na ordem em que a equipe trabalha. */
export type FaseLiberacao = "pendencia" | "registrar" | "prazo" | "liberada";

export function faseLiberacao(c: CartaoCliente, hoje: string): FaseLiberacao {
  if (c.comparecimentoStatus === "nao_compareceu" || c.quitacaoStatus === "nao_realizada") return "pendencia";
  const e = estadoLiberacao(c, hoje);
  if (e.liberada) return "liberada";
  if (!e.ambos) return "registrar";
  return "prazo";
}

export const ETAPAS: EtapaInfo[] = [
  {
    id: "preEligibility", numero: 1, titulo: "Pagando parcelas", curto: "Parcelas",
    resumo: "Clientes pagando o carnê que ainda não pediram os termos no app.",
    saida: "Sai daqui quando a cliente atinge o mínimo de parcelas pagas e toca em “Solicitar liberação financeira” no app.",
    segmentos: [
      todas,
      { id: "elegiveis", rotulo: "Já elegíveis", filtro: (c) => c.parcelasFaltantes === 0 },
      { id: "falta1", rotulo: "Falta 1 parcela", filtro: (c) => c.parcelasFaltantes === 1 },
      { id: "falta2", rotulo: "Faltam 2", filtro: (c) => c.parcelasFaltantes === 2 },
      { id: "falta3", rotulo: "Faltam 3 ou mais", filtro: (c) => c.parcelasFaltantes >= 3 },
    ],
  },
  {
    id: "financialReview", numero: 2, titulo: "Levantamento financeiro", curto: "Levantamento",
    resumo: "Clientes que pediram os termos. A equipe confere o financeiro e define o saldo e as formas de quitação.",
    saida: "Sai daqui quando o levantamento está concluído e a cliente escolhe a data dos termos no app.",
    segmentos: [
      todas,
      { id: "analisar", rotulo: "A analisar", filtro: (c) => c.statusRevisaoFinanceira !== "aprovada" && c.statusRevisaoFinanceira !== "recusada" },
      { id: "divergencia", rotulo: "Com divergência", filtro: (c) => c.statusRevisaoFinanceira === "recusada" },
      { id: "concluidos", rotulo: "Concluídos · aguardando data", filtro: (c) => c.statusRevisaoFinanceira === "aprovada" },
    ],
  },
  {
    id: "termsConfirmed", numero: 3, titulo: "Termos agendados", curto: "Termos",
    resumo: "A cliente escolheu a data da assinatura dos termos.",
    saida: "No dia da assinatura, a cliente passa automaticamente para Liberação cirúrgica.",
    segmentos: [
      todas,
      { id: "semana", rotulo: "Próximos 7 dias", filtro: (c, hoje) => Boolean(c.dataTermos) && diasEntre(hoje, c.dataTermos!) < 7 },
      { id: "sem-responsavel", rotulo: "Sem responsável", filtro: (c) => !c.termosResponsavel },
    ],
  },
  {
    id: "financialRelease", numero: 4, titulo: "Liberação cirúrgica", curto: "Liberação",
    resumo: "Do dia dos termos até a cliente escolher a data da cirurgia: registrar comparecimento e quitação, e aguardar o prazo de liberação.",
    saida: "Sai daqui quando a cliente escolhe a data da cirurgia no app.",
    segmentos: [
      todas,
      { id: "registrar", rotulo: "Registrar no dia", filtro: (c, hoje) => faseLiberacao(c, hoje) === "registrar" },
      { id: "pendencia", rotulo: "Com pendência", filtro: (c, hoje) => faseLiberacao(c, hoje) === "pendencia" },
      { id: "prazo", rotulo: "Em prazo", filtro: (c, hoje) => faseLiberacao(c, hoje) === "prazo" },
      { id: "liberada", rotulo: "Agenda liberada", filtro: (c, hoje) => faseLiberacao(c, hoje) === "liberada" },
    ],
  },
  {
    id: "surgeryConfirmed", numero: 5, titulo: "Cirurgia agendada", curto: "Cirurgia",
    resumo: "A cliente escolheu a data da cirurgia.",
    saida: "Sai daqui quando a equipe confirma o pagamento da cirurgia: o processo é concluído e fica arquivado na Agenda cirúrgica.",
    segmentos: [
      todas,
      { id: "proximas", rotulo: "Próximos 30 dias", filtro: (c, hoje) => Boolean(c.dataCirurgia) && c.dataCirurgia! >= hoje && diasEntre(hoje, c.dataCirurgia!) <= 30 },
      { id: "confirmar", rotulo: "Confirmar pagamento", filtro: (c, hoje) => Boolean(c.dataCirurgia) && c.dataCirurgia! < hoje },
    ],
  },
];

export const ETAPA_POR_ID = new Map(ETAPAS.map((e) => [e.id, e]));

export function situacao(c: CartaoCliente, etapa: EstagioCentral, hoje: string): Situacao {
  if (etapa === "preEligibility") {
    if (c.parcelasFaltantes === 0) {
      return { responsavel: "cliente", tom: "success", texto: "Elegível · falta a cliente solicitar no app", prazo: null, atrasado: false, urgencia: 0 };
    }
    return {
      responsavel: "cliente", tom: "info", texto: `${faltamTexto(c.parcelasFaltantes)} para ficar elegível`,
      prazo: c.proximaParcelaEm ? `próxima vence ${dataBr(c.proximaParcelaEm)}` : null, atrasado: false, urgencia: c.parcelasFaltantes,
    };
  }

  if (etapa === "financialReview") {
    const prazo = prazoLevantamento(c);
    if (c.statusRevisaoFinanceira === "aprovada") {
      return { responsavel: "cliente", tom: "success", texto: "Levantamento concluído · falta a cliente escolher a data dos termos", prazo: c.financeiroConfirmadoEm ? `concluído em ${dataBr(c.financeiroConfirmadoEm)}` : null, atrasado: false, urgencia: 50 };
    }
    const vencido = Boolean(prazo && prazo < hoje);
    const referencia = prazo ? (vencido ? `prazo ${dataBr(prazo)} · ${atraso(diasEntre(prazo, hoje))}` : `prazo ${dataBr(prazo)} · ${emDias(diasEntre(hoje, prazo))}`) : null;
    if (c.statusRevisaoFinanceira === "recusada") {
      return { responsavel: "equipe", tom: "danger", texto: "Divergência registrada · refazer o levantamento", prazo: referencia, atrasado: vencido, urgencia: vencido ? 0 : 10 };
    }
    return { responsavel: "equipe", tom: vencido ? "danger" : "wait", texto: c.statusRevisaoFinanceira === "pendente" ? "Em análise · concluir o levantamento" : "Conferir o financeiro e concluir o levantamento", prazo: referencia, atrasado: vencido, urgencia: vencido ? 0 : 10 + (prazo ? diasEntre(hoje, prazo) : 0) };
  }

  if (etapa === "termsConfirmed") {
    const dias = c.dataTermos ? diasEntre(hoje, c.dataTermos) : 99;
    const quando = c.dataTermos ? `${dataBr(c.dataTermos)}${c.horarioTermos ? ` às ${c.horarioTermos}` : ""} · ${emDias(dias)}` : null;
    if (!c.termosResponsavel) {
      return { responsavel: "equipe", tom: "wait", texto: "Definir quem conduz a assinatura", prazo: quando, atrasado: false, urgencia: dias };
    }
    return { responsavel: "sistema", tom: "info", texto: `Assinatura com ${c.termosResponsavel}`, prazo: quando, atrasado: false, urgencia: dias };
  }

  if (etapa === "financialRelease") {
    const fase = faseLiberacao(c, hoje);
    const e = estadoLiberacao(c, hoje);
    if (fase === "pendencia") {
      const texto = c.comparecimentoStatus === "nao_compareceu" ? "Não compareceu · reagendar os termos" : "Saldo não quitado · regularizar";
      return { responsavel: "equipe", tom: "danger", texto, prazo: c.dataTermos ? `termos em ${dataBr(c.dataTermos)}` : null, atrasado: true, urgencia: 0 };
    }
    if (fase === "registrar") {
      const faltas = [
        !c.previsaoConfirmadaEm ? "previsão" : null,
        !e.compareceu ? "comparecimento" : null,
        !e.quitada ? "quitação" : null,
      ].filter(Boolean) as string[];
      const dias = c.dataTermos ? diasEntre(c.dataTermos, hoje) : 0;
      return {
        responsavel: "equipe", tom: dias > 0 ? "danger" : "wait",
        texto: `Registrar ${faltas.join(", ").replace(/, ([^,]*)$/, " e $1")}`,
        prazo: c.dataTermos ? (dias === 0 ? "termos hoje" : `termos em ${dataBr(c.dataTermos)} · ${emDias(-dias)}`) : null,
        atrasado: dias > 0, urgencia: dias > 0 ? 1 : 2,
      };
    }
    if (fase === "prazo") {
      const vencido = Boolean(e.previsao && e.previsao < hoje);
      return {
        responsavel: vencido ? "equipe" : "sistema", tom: vencido ? "danger" : "wait",
        texto: vencido ? "Prazo vencido · agenda ainda não liberada" : `Contando o prazo · ${e.decorridos} de ${e.totalDias} dias úteis`,
        prazo: e.previsao ? (vencido ? `previsto ${dataBr(e.previsao)} · ${atraso(diasEntre(e.previsao, hoje))}` : `libera em ${dataBr(e.previsao)}`) : null,
        atrasado: vencido, urgencia: vencido ? 0 : 20,
      };
    }
    return { responsavel: "cliente", tom: "success", texto: "Agenda liberada · falta a cliente escolher a data da cirurgia", prazo: c.agendaCirurgicaLiberadaEm ? `liberada em ${dataBr(c.agendaCirurgicaLiberadaEm)}` : null, atrasado: false, urgencia: 40 };
  }

  const dias = c.dataCirurgia ? diasEntre(hoje, c.dataCirurgia) : 0;
  const quando = c.dataCirurgia ? `${dataBr(c.dataCirurgia)}${c.horarioCirurgia ? ` às ${c.horarioCirurgia}` : ""} · ${emDias(dias)}` : null;
  if (dias < 0) return { responsavel: "equipe", tom: "wait", texto: "Cirurgia realizada? Confirmar o pagamento", prazo: quando, atrasado: false, urgencia: dias };
  return { responsavel: "sistema", tom: "info", texto: "Cirurgia marcada · aguardando o dia", prazo: quando, atrasado: false, urgencia: dias };
}

/** Quantas clientes da etapa dependem de uma ação da equipe agora. */
export function contarAcaoEquipe(lista: CartaoCliente[], etapa: EstagioCentral, hoje: string) {
  return lista.filter((c) => situacao(c, etapa, hoje).responsavel === "equipe").length;
}
