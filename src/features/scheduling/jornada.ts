import { dataBr, diasEntre, proximoDiaUtil, rotuloFormaCusteio } from "./api";
import { estadoLiberacao, faltamTexto } from "./v46Cards";
import type { CartaoCliente, EstagioCentral, VisaoGeralResponse } from "./types";

/**
 * Leitura das 5 filas da Central (somente exibição). As filas vêm prontas de
 * `/api/admin/central/visao-geral` (etapa definida por `etapaCentral` no
 * Worker); aqui só se explica cada etapa, em que ponto a cliente está, quem
 * precisa agir e qual é a próxima ação. Nenhuma regra é decidida no navegador:
 * as ações chamam as RPCs de sempre (ver docs/FLOWS.md §7).
 *
 * Fluxo real (conferido nas funções do banco):
 *  1 Pagando parcelas → cliente toca "Solicitar liberação financeira" (pode_agendar).
 *  2 Levantamento → equipe conclui (saldo + formas) → cliente escolhe a forma de
 *    pagamento → cliente escolhe a data dos termos (agenda_liberada/agendar_data).
 *  3 Termos agendados → equipe define responsável e pode confirmar a previsão
 *    cirúrgica antes do dia (agenda_confirmar_previsao valida o teto do mês).
 *  4 Liberação → no dia: previsão + comparecimento + quitação (ausência ou saldo
 *    não quitado cancelam o agendamento e a cliente volta à etapa 2); depois o
 *    prazo em dias úteis libera a Agenda Cirúrgica; a cliente escolhe a data.
 *  5 Cirurgia agendada → após a cirurgia, equipe confirma o pagamento e conclui.
 */

/** Quem destrava o próximo passo da cliente. */
export type Responsavel = "equipe" | "cliente" | "sistema";
export type TomSituacao = "danger" | "wait" | "info" | "success";

/** Ação principal da equipe para a cliente, executada direto da lista. */
export type AcaoJornada =
  | "levantamento"
  | "preparar"
  | "atendimento"
  | "liberar"
  | "pagamento"
  | "abrirDatasTermos"
  | "abrirDatasCirurgia";

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
  acao: { id: AcaoJornada; rotulo: string } | null;
}

/** Contexto da operação que muda a situação (ex.: não há datas abertas). */
export interface ContextoJornada {
  vagasTermos: number | null;
  vagasCirurgia: number | null;
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
  /** O que é esta lista. */
  resumo: string;
  /** Como a cliente sai desta lista. */
  saida: string;
  /** Passos internos da etapa, na ordem. */
  passos: string[];
  segmentos: Segmento[];
}

/** BUSINESS-RULES §11 Etapa C — mesmo prazo exibido na Visão geral. */
export const PRAZO_LEVANTAMENTO_DIAS_UTEIS = 5;

export const ROTULO_RESPONSAVEL: Record<Responsavel, string> = {
  equipe: "Equipe",
  cliente: "Cliente",
  sistema: "Automático",
};

export const SEM_CONTEXTO: ContextoJornada = { vagasTermos: null, vagasCirurgia: null };

export function contextoDe(dados: Pick<VisaoGeralResponse, "disponibilidade">): ContextoJornada {
  return {
    vagasTermos: dados.disponibilidade?.termos.vagas ?? null,
    vagasCirurgia: dados.disponibilidade?.cirurgia.vagas ?? null,
  };
}

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

/** Ponto da Etapa 2 (levantamento → forma de pagamento → data dos termos). */
export type FaseLevantamento = "analisar" | "divergencia" | "forma" | "data";

export function faseLevantamento(c: CartaoCliente): FaseLevantamento {
  if (c.statusRevisaoFinanceira === "recusada") return "divergencia";
  if (c.statusRevisaoFinanceira !== "aprovada") return "analisar";
  // A escolha da cliente no app grava a solicitação de custeio (client-agenda).
  if (!c.custeioStatus || c.custeioStatus === "recusada") return "forma";
  return "data";
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
    id: "preEligibility", numero: 1, titulo: "Pagando parcelas",
    resumo: "Clientes pagando o carnê que ainda não pediram a liberação financeira no app.",
    saida: "Sai daqui quando a cliente atinge o mínimo de parcelas pagas e toca em “Solicitar liberação financeira” no app.",
    passos: ["Pagar o mínimo de parcelas", "Solicitar no app"],
    segmentos: [
      todas,
      { id: "elegiveis", rotulo: "Já elegíveis", filtro: (c) => c.parcelasFaltantes === 0 },
      { id: "falta1", rotulo: "Falta 1 parcela", filtro: (c) => c.parcelasFaltantes === 1 },
      { id: "falta2", rotulo: "Faltam 2", filtro: (c) => c.parcelasFaltantes === 2 },
      { id: "falta3", rotulo: "Faltam 3 ou mais", filtro: (c) => c.parcelasFaltantes >= 3 },
    ],
  },
  {
    id: "financialReview", numero: 2, titulo: "Levantamento financeiro",
    resumo: "A equipe confere o contrato e define o saldo e as formas de quitação. Depois, a cliente escolhe como vai pagar e a data dos termos no app.",
    saida: "Sai daqui quando a cliente escolhe a data da assinatura dos termos.",
    passos: ["Equipe faz o levantamento", "Cliente escolhe a forma de pagamento", "Cliente escolhe a data dos termos"],
    segmentos: [
      todas,
      { id: "analisar", rotulo: "A analisar", filtro: (c) => faseLevantamento(c) === "analisar" },
      { id: "divergencia", rotulo: "Com divergência", filtro: (c) => faseLevantamento(c) === "divergencia" },
      { id: "forma", rotulo: "Falta forma de pagamento", filtro: (c) => faseLevantamento(c) === "forma" },
      { id: "data", rotulo: "Falta escolher a data", filtro: (c) => faseLevantamento(c) === "data" },
    ],
  },
  {
    id: "termsConfirmed", numero: 3, titulo: "Termos agendados",
    resumo: "A cliente escolheu a data da assinatura. Prepare o atendimento: responsável e previsão cirúrgica.",
    saida: "No dia da assinatura, a cliente passa automaticamente para Liberação cirúrgica.",
    passos: ["Definir responsável", "Confirmar previsão cirúrgica", "Aguardar o dia"],
    segmentos: [
      todas,
      { id: "semana", rotulo: "Próximos 7 dias", filtro: (c, hoje) => Boolean(c.dataTermos) && diasEntre(hoje, c.dataTermos!) < 7 },
      { id: "preparar", rotulo: "Falta preparar", filtro: (c) => !c.termosResponsavel || !c.previsaoConfirmadaEm },
    ],
  },
  {
    id: "financialRelease", numero: 4, titulo: "Liberação cirúrgica",
    resumo: "No dia dos termos, registre o atendimento. Depois o prazo em dias úteis libera a Agenda Cirúrgica e a cliente escolhe a data.",
    saida: "Sai daqui quando a cliente escolhe a data da cirurgia no app.",
    passos: ["Registrar atendimento", "Prazo em dias úteis", "Cliente escolhe a data"],
    segmentos: [
      todas,
      { id: "registrar", rotulo: "Registrar atendimento", filtro: (c, hoje) => ["registrar", "pendencia"].includes(faseLiberacao(c, hoje)) },
      { id: "prazo", rotulo: "Em prazo", filtro: (c, hoje) => faseLiberacao(c, hoje) === "prazo" },
      { id: "liberada", rotulo: "Agenda liberada", filtro: (c, hoje) => faseLiberacao(c, hoje) === "liberada" },
    ],
  },
  {
    id: "surgeryConfirmed", numero: 5, titulo: "Cirurgia agendada",
    resumo: "A cliente escolheu a data da cirurgia.",
    saida: "Sai daqui quando a equipe confirma o pagamento da cirurgia: o processo é concluído e fica arquivado na Agenda cirúrgica.",
    passos: ["Aguardar a cirurgia", "Confirmar o pagamento"],
    segmentos: [
      todas,
      { id: "proximas", rotulo: "Próximos 30 dias", filtro: (c, hoje) => Boolean(c.dataCirurgia) && c.dataCirurgia! >= hoje && diasEntre(hoje, c.dataCirurgia!) <= 30 },
      { id: "confirmar", rotulo: "Confirmar pagamento", filtro: (c, hoje) => Boolean(c.dataCirurgia) && c.dataCirurgia! < hoje },
    ],
  },
];

export const ETAPA_POR_ID = new Map(ETAPAS.map((e) => [e.id, e]));

/** dd/mm — referência curta para cartões e para o drawer. */
export function diaMes(iso: string | null | undefined) {
  return iso ? dataBr(iso).slice(0, 5) : "—";
}

function comHora(iso: string, hora: string | null) {
  return `${diaMes(iso)}${hora ? ` às ${hora}` : ""}`;
}

/**
 * Situação da cliente em uma frase curta (`texto`) e uma referência de tempo
 * (`prazo`). Mesma leitura no quadro e no drawer.
 */
export function situacao(c: CartaoCliente, etapa: EstagioCentral, hoje: string, ctx: ContextoJornada = SEM_CONTEXTO): Situacao {
  if (etapa === "preEligibility") {
    if (c.parcelasFaltantes === 0) {
      return { responsavel: "cliente", tom: "success", texto: "Pode solicitar no app", prazo: `${c.parcelasPagas} de ${c.parcelasNecessarias} parcelas pagas`, atrasado: false, urgencia: 0, acao: null };
    }
    return {
      responsavel: "cliente", tom: "info", texto: faltamTexto(c.parcelasFaltantes),
      prazo: `${c.parcelasPagas} de ${c.parcelasNecessarias} pagas${c.proximaParcelaEm ? ` · próxima ${diaMes(c.proximaParcelaEm)}` : ""}`, atrasado: false, urgencia: c.parcelasFaltantes, acao: null,
    };
  }

  if (etapa === "financialReview") {
    const fase = faseLevantamento(c);
    if (fase === "forma") {
      return { responsavel: "cliente", tom: "info", texto: "Escolhendo a forma de pagamento", prazo: null, atrasado: false, urgencia: 40, acao: null };
    }
    if (fase === "data") {
      if (ctx.vagasTermos === 0) {
        return { responsavel: "equipe", tom: "danger", texto: "Sem datas de termos abertas", prazo: null, atrasado: true, urgencia: 1, acao: { id: "abrirDatasTermos", rotulo: "Abrir datas" } };
      }
      const r = c.retornoTermos;
      if (r) {
        return { responsavel: "cliente", tom: "wait", texto: r.motivo === "ausencia" ? "Faltou nos termos · nova data" : "Não quitou · nova data", prazo: r.dataTermos ? `termos de ${diaMes(r.dataTermos)}` : null, atrasado: false, urgencia: 30, acao: null };
      }
      return { responsavel: "cliente", tom: "info", texto: "Escolhendo a data dos termos", prazo: c.custeioForma ? `pagamento: ${rotuloFormaCusteio(c.custeioForma)}` : null, atrasado: false, urgencia: 30, acao: null };
    }
    const prazo = prazoLevantamento(c);
    const vencido = Boolean(prazo && prazo < hoje);
    const referencia = prazo ? (vencido ? atraso(diasEntre(prazo, hoje)) : `vence ${emDias(diasEntre(hoje, prazo))}`) : null;
    if (fase === "divergencia") {
      return { responsavel: "equipe", tom: "danger", texto: "Divergência no levantamento", prazo: referencia, atrasado: vencido, urgencia: vencido ? 0 : 10, acao: { id: "levantamento", rotulo: "Refazer levantamento" } };
    }
    return { responsavel: "equipe", tom: vencido ? "danger" : "wait", texto: "Levantamento a fazer", prazo: referencia, atrasado: vencido, urgencia: vencido ? 0 : 10 + (prazo ? diasEntre(hoje, prazo) : 0), acao: { id: "levantamento", rotulo: "Fazer levantamento" } };
  }

  if (etapa === "termsConfirmed") {
    const dias = c.dataTermos ? diasEntre(hoje, c.dataTermos) : 99;
    const quando = c.dataTermos ? `${comHora(c.dataTermos, c.horarioTermos)} · ${emDias(dias)}` : null;
    const faltas = [!c.termosResponsavel ? "responsável" : null, !c.previsaoConfirmadaEm ? "previsão" : null].filter(Boolean) as string[];
    if (faltas.length) {
      return { responsavel: "equipe", tom: dias <= 2 ? "wait" : "info", texto: `Falta ${faltas.join(" e ")}`, prazo: quando, atrasado: false, urgencia: dias, acao: { id: "preparar", rotulo: "Preparar" } };
    }
    return { responsavel: "sistema", tom: "success", texto: "Pronta para a assinatura", prazo: quando, atrasado: false, urgencia: 50 + dias, acao: null };
  }

  if (etapa === "financialRelease") {
    const fase = faseLiberacao(c, hoje);
    const e = estadoLiberacao(c, hoje);
    if (fase === "pendencia") {
      const texto = c.comparecimentoStatus === "nao_compareceu" ? "Não compareceu aos termos" : "Saldo não quitado";
      return { responsavel: "equipe", tom: "danger", texto, prazo: c.dataTermos ? `termos de ${diaMes(c.dataTermos)}` : null, atrasado: true, urgencia: 0, acao: null };
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
        texto: faltas.length === 3 ? "Registrar atendimento" : `Falta ${faltas.join(" e ")}`,
        prazo: c.dataTermos ? (dias === 0 ? `termos hoje${c.horarioTermos ? ` às ${c.horarioTermos}` : ""}` : `termos ${diaMes(c.dataTermos)} · ${emDias(-dias)}`) : null,
        atrasado: dias > 0, urgencia: dias > 0 ? 1 : 2, acao: { id: "atendimento", rotulo: "Registrar" },
      };
    }
    if (fase === "prazo") {
      const vencido = Boolean(e.previsao && e.previsao < hoje);
      return {
        responsavel: vencido ? "equipe" : "sistema", tom: vencido ? "danger" : "wait",
        texto: vencido ? "Prazo vencido sem liberação" : `Prazo: ${e.decorridos} de ${e.totalDias} dias úteis`,
        prazo: e.previsao ? (vencido ? `venceu ${diaMes(e.previsao)}` : `libera ${diaMes(e.previsao)}`) : null,
        atrasado: vencido, urgencia: vencido ? 0 : 20, acao: { id: "liberar", rotulo: vencido ? "Liberar agora" : "Gerenciar prazo" },
      };
    }
    if (ctx.vagasCirurgia === 0) {
      return { responsavel: "equipe", tom: "danger", texto: "Sem datas cirúrgicas abertas", prazo: null, atrasado: true, urgencia: 1, acao: { id: "abrirDatasCirurgia", rotulo: "Abrir datas" } };
    }
    return { responsavel: "cliente", tom: "success", texto: "Escolhendo a data da cirurgia", prazo: c.agendaCirurgicaLiberadaEm ? `liberada ${diaMes(c.agendaCirurgicaLiberadaEm)}` : null, atrasado: false, urgencia: 40, acao: null };
  }

  const dias = c.dataCirurgia ? diasEntre(hoje, c.dataCirurgia) : 0;
  const quando = c.dataCirurgia ? `${comHora(c.dataCirurgia, c.horarioCirurgia)} · ${emDias(dias)}` : null;
  if (dias < 0) return { responsavel: "equipe", tom: "wait", texto: "Confirmar pagamento", prazo: quando, atrasado: false, urgencia: dias, acao: { id: "pagamento", rotulo: "Confirmar" } };
  return { responsavel: "sistema", tom: "info", texto: "Aguardando a cirurgia", prazo: quando, atrasado: false, urgencia: dias, acao: null };
}

/** Quantas clientes da etapa dependem de uma ação da equipe agora. */
export function contarAcaoEquipe(lista: CartaoCliente[], etapa: EstagioCentral, hoje: string, ctx: ContextoJornada = SEM_CONTEXTO) {
  return lista.filter((c) => situacao(c, etapa, hoje, ctx).responsavel === "equipe").length;
}

/** Bloqueios da operação que travam várias clientes de uma vez. */
export function bloqueios(dados: VisaoGeralResponse): { id: "termos" | "cirurgia"; texto: string; quantidade: number }[] {
  const ctx = contextoDe(dados);
  const lista: { id: "termos" | "cirurgia"; texto: string; quantidade: number }[] = [];
  const esperandoTermos = dados.filas.financialReview.filter((c) => faseLevantamento(c) === "data").length;
  if (ctx.vagasTermos === 0 && esperandoTermos > 0) {
    lista.push({ id: "termos", quantidade: esperandoTermos, texto: `${esperandoTermos} ${esperandoTermos === 1 ? "cliente está pronta" : "clientes estão prontas"} para escolher a data dos termos, mas não há nenhuma data futura aberta com vaga.` });
  }
  const esperandoCirurgia = dados.filas.financialRelease.filter((c) => faseLiberacao(c, dados.hoje) === "liberada").length;
  if (ctx.vagasCirurgia === 0 && esperandoCirurgia > 0) {
    lista.push({ id: "cirurgia", quantidade: esperandoCirurgia, texto: `${esperandoCirurgia} ${esperandoCirurgia === 1 ? "cliente tem" : "clientes têm"} a agenda cirúrgica liberada, mas não há nenhuma data cirúrgica futura aberta com vaga.` });
  }
  return lista;
}
