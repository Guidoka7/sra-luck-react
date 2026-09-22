import type { StatusRevisaoFinanceira } from "@/lib/clienteAgenda";
export { PRAZO_MAXIMO_LIBERACAO_CIRURGICA_DIAS } from "@/lib/clienteAgenda";

type AgendamentoResumo = { id: string; data: string; horario: string | null; dataCirurgia: string | null; termosAssinadosEm?: string | null } | null;

export interface EstadoAgendaInput {
  agendamentoAtivo: AgendamentoResumo;
  agendamentoConcluido: AgendamentoResumo;
  podeAgendar: boolean;
  agendaLiberada: boolean;
  statusRevisaoFinanceira: StatusRevisaoFinanceira;
  custeioAprovado: boolean;
}

/**
 * Cada ponto do fluxo real da cliente, na ordem em que acontecem:
 * parcelas mínimas → solicitar liberação → levantamento → forma de
 * pagamento → escolha/assinatura dos termos → data da cirurgia.
 */
export type EtapaAgenda =
  | "percentual"
  | "elegivel"
  | "levantamento"
  | "ajuste"
  | "pagamento"
  | "custeio_analise"
  | "data"
  | "termos_agendados"
  | "termos_assinados"
  | "cirurgia";

/** Etapa 3: levantamento aprovado, mas a cliente ainda não escolheu o custeio. */
export function deveMostrarEscolhaCusteio(statusRevisaoFinanceira: StatusRevisaoFinanceira, custeioAprovado: boolean) {
  return statusRevisaoFinanceira === "aprovada" && !custeioAprovado;
}

export function termosJaAssinados(agendamentoAtivo: AgendamentoResumo, agendamentoConcluido: AgendamentoResumo) {
  const atual = agendamentoAtivo ?? agendamentoConcluido;
  return Boolean(atual?.termosAssinadosEm || (!agendamentoAtivo && agendamentoConcluido));
}

export function etapaAgenda(input: EstadoAgendaInput & { liberacaoFinanceiraSolicitada: boolean }): EtapaAgenda {
  const { agendamentoAtivo, agendamentoConcluido, podeAgendar, agendaLiberada, statusRevisaoFinanceira, custeioAprovado, liberacaoFinanceiraSolicitada } = input;
  const atual = agendamentoAtivo ?? agendamentoConcluido;
  if (atual?.dataCirurgia) return "cirurgia";
  if (termosJaAssinados(agendamentoAtivo, agendamentoConcluido)) return "termos_assinados";
  if (agendamentoAtivo) return "termos_agendados";
  if (statusRevisaoFinanceira === "recusada") return "ajuste";
  if (deveMostrarEscolhaCusteio(statusRevisaoFinanceira, custeioAprovado)) return "pagamento";
  if (!agendaLiberada) {
    if (!podeAgendar) return "percentual";
    if (statusRevisaoFinanceira === "aprovada") return "custeio_analise";
    return liberacaoFinanceiraSolicitada ? "levantamento" : "elegivel";
  }
  return "data";
}

/** Passos exibidos na trilha da aba Agenda. */
export const TRILHA_AGENDA = ["Parcelas", "Análise", "Pagamento", "Termos", "Cirurgia"] as const;

/** Índice do passo atual na trilha; `TRILHA_AGENDA.length` = tudo concluído. */
export function passoDaTrilha(etapa: EtapaAgenda) {
  switch (etapa) {
    case "percentual":
    case "elegivel": return 0;
    case "levantamento":
    case "ajuste": return 1;
    case "pagamento":
    case "custeio_analise": return 2;
    case "data":
    case "termos_agendados": return 3;
    case "termos_assinados": return 4;
    case "cirurgia": return TRILHA_AGENDA.length;
  }
}

export function statusAgenda({ agendamentoAtivo, agendamentoConcluido, podeAgendar, agendaLiberada, statusRevisaoFinanceira, custeioAprovado }: EstadoAgendaInput) {
  if ((agendamentoAtivo ?? agendamentoConcluido)?.dataCirurgia) return { label: "Cirurgia confirmada", bg: "#EEF6F0", color: "#3F7D5B", border: "#D3E6D8" };
  if (agendamentoConcluido) return { label: "Termos assinados", bg: "#EEF6F0", color: "#3F7D5B", border: "#D3E6D8" };
  if (agendamentoAtivo) return { label: "Assinatura agendada", bg: "#EEF6F0", color: "#3F7D5B", border: "#D3E6D8" };
  if (statusRevisaoFinanceira === "recusada") return { label: "Ajuste necessário", bg: "#FBEBEA", color: "#8F2A25", border: "#F0D3D1" };
  if (!podeAgendar) return { label: "Etapa 1 de 4", bg: "#F7EFED", color: "#7D2434", border: "#EBD9D5" };
  if (statusRevisaoFinanceira !== "aprovada") return { label: "Etapa 2 de 4", bg: "#FFF7E8", color: "#8A6720", border: "#E9D7AD" };
  // A aprovação do levantamento libera a Etapa 3 (escolha da forma de
  // pagamento). A RPC agenda_liberada só fica true DEPOIS dessa escolha,
  // então ela não pode ser usada como gate para entrar na própria Etapa 3.
  if (!custeioAprovado || !agendaLiberada) return { label: "Etapa 3 de 4", bg: "#FFF7E8", color: "#8A6720", border: "#E9D7AD" };
  return { label: "Etapa 4 de 4", bg: "#EEF6F0", color: "#3F7D5B", border: "#D3E6D8" };
}

/** Frase curta da etapa atual, usada no atalho da Início. */
export function resumoEtapa(etapa: EtapaAgenda) {
  switch (etapa) {
    case "percentual": return "Continue com suas parcelas";
    case "elegivel": return "Solicite a liberação financeira";
    case "levantamento": return "Levantamento em análise";
    case "ajuste": return "Ajuste necessário no levantamento";
    case "pagamento": return "Escolha a forma de pagamento";
    case "custeio_analise": return "Pagamento em confirmação";
    case "data": return "Escolha a data da assinatura";
    case "termos_agendados": return "Assinatura dos termos marcada";
    case "termos_assinados": return "Próximo passo: data da cirurgia";
    case "cirurgia": return "Cirurgia confirmada";
  }
}
