export type EstagioCentral = "preEligibility" | "financialReview" | "termsConfirmed" | "financialRelease" | "surgeryConfirmed";
export type EstagioDrawer = EstagioCentral | "concluido";

export type StatusComparecimento = "pendente" | "compareceu" | "nao_compareceu";
export type StatusQuitacao = "pendente" | "paga" | "nao_realizada";

export interface CartaoCliente {
  id: string;
  nome: string;
  cpf: string | null;
  procedimento: string | null;
  cartaDeCredito: number;
  totalParcelas: number;
  parcelasPagas: number;
  parcelasFaltantes: number;
  agendamentoId: string | null;
  dataTermos: string | null;
  horarioTermos: string | null;
  termosResponsavel: string | null;
  comparecimentoStatus: StatusComparecimento;
  quitacaoStatus: StatusQuitacao;
  previsaoCirurgia: string | null;
  previsaoConfirmadaEm: string | null;
  agendaCirurgicaLiberadaEm: string | null;
  dataCirurgia: string | null;
  pagamentoCirurgiaConfirmadoEm: string | null;
  prazoCirurgico?: string | null;
}

export interface VisaoGeralResponse {
  hoje: string;
  filas: Record<EstagioCentral, CartaoCliente[]>;
}

export interface DiaCalendario {
  id: string;
  data: string;
  vagasTotais: number;
  status: "disponivel" | "bloqueado";
  vagasOcupadas: number;
}

export interface ProximaAssinatura {
  agendamentoId: string;
  clienteId: string;
  nome: string;
  cpf: string | null;
  procedimento: string | null;
  data: string;
  horario: string | null;
  responsavel: string | null;
}

export interface AgendaTermosResponse {
  ano: number;
  mes: number;
  calendario: DiaCalendario[];
  proximasAssinaturas: ProximaAssinatura[];
}

export interface ItemMapaCirurgico {
  agendamentoId: string;
  clienteId: string;
  nome: string;
  procedimento: string | null;
  data: string;
  cartaDeCredito: number;
  quitada: boolean;
  processoConcluido: boolean;
  pagamentoConfirmadoEm: string | null;
}

export interface AgendaCirurgiaResponse {
  ano: number;
  mes: number;
  calendario: DiaCalendario[];
  mapaCirurgico: ItemMapaCirurgico[];
  tetoMensal: number;
  comprometidoMensal: number;
}

export type ContextoDrawer = "termos" | "financeiro" | "cirurgia" | null;
