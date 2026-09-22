/**
 * Formato das respostas de /api/cliente/agenda e /api/cliente/boletos usado
 * pelo app da cliente, e o cache local que permite abrir a aba Agenda
 * instantaneamente ao recarregar a página (os dados são revalidados em
 * seguida, em silêncio).
 */

/**
 * Prazo máximo (teto) para liberar a agenda cirúrgica, contado a partir da
 * mais recente entre assinatura dos termos e quitação confirmada.
 * Fonte: docs/BUSINESS-RULES.md §12 — ponto único para quando virar configuração.
 */
export const PRAZO_MAXIMO_LIBERACAO_CIRURGICA_DIAS = 90;

export type StatusRevisaoFinanceira = "pendente" | "aprovada" | "recusada" | null;
export type StatusCusteio = "pendente" | "em_analise" | "aprovada" | "recusada" | null;
export type FormaCusteio = "cartao" | "pix" | "cheques" | "boleto_100";
type StatusComparecimento = "pendente" | "compareceu" | "nao_compareceu";
type StatusQuitacao = "pendente" | "paga" | "nao_realizada";

export type AgendamentoAgenda = {
  id: string;
  data: string;
  horario: string | null;
  termosAssinadosEm: string | null;
  comparecimentoStatus: StatusComparecimento;
  quitacaoStatus: StatusQuitacao;
  previsaoCirurgia: string | null;
  dataCirurgia: string | null;
  horarioCirurgia: string | null;
  status?: string;
};

export type SolicitacaoLiberacaoFinanceira = {
  id: string;
  forma_custeio: FormaCusteio;
  saldo_restante?: number;
  taxa_cartao?: number;
  total_com_taxa?: number;
  status: StatusCusteio | string;
  observacao: string | null;
};

export type AgendaFinanceiro = {
  statusRevisao?: StatusRevisaoFinanceira;
  saldoRestante?: number | null;
  taxaCartao?: number | null;
  totalComTaxa?: number | null;
  formasCusteio?: string[];
  custeioConfirmadoEm?: string | null;
  statusFinanceiro?: string | null;
  statusCirurgia: string | null;
};

export type AgendaData = {
  cliente: { id: string; nome: string; procedimento: string | null };
  elegibilidade: { elegivel: boolean; liberacaoFinanceiraSolicitada: boolean; liberacaoFinanceiraSolicitadaEm: string | null };
  financeiro: AgendaFinanceiro;
  solicitacaoLiberacaoFinanceira: SolicitacaoLiberacaoFinanceira | null;
  agendamentoAtivo: AgendamentoAgenda | null;
  agendamentoConcluido: AgendamentoAgenda | null;
  datasDisponiveis: { id: string; data: string; vagasRestantes: number }[];
  datasCirurgiaDisponiveis?: { id: string; data: string; vagasRestantes: number }[];
  agendaCirurgicaLiberada: boolean;
  agendaCirurgicaLiberarEm: string | null;
};

export type BoletosData = {
  boletos: unknown[];
  porcentagem_pagamento: number;
  parcelas_pagas: number;
  parcelas_nao_pagas?: number;
  pode_agendar: boolean;
  agenda_liberada: boolean;
  status_revisao_financeira: StatusRevisaoFinanceira;
  observacao_revisao_financeira?: string | null;
  quantidade_parcelas: number | null;
};

const CHAVE_CACHE = "sra-luck-cliente-snapshot-v1";
const VALIDADE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

type CacheCliente = { agenda: AgendaData; boletos: BoletosData; salvoEm: number };

export function lerCacheCliente(): { agenda: AgendaData; boletos: BoletosData } | null {
  try {
    const bruto = localStorage.getItem(CHAVE_CACHE);
    if (!bruto) return null;
    const cache = JSON.parse(bruto) as CacheCliente;
    if (!cache?.agenda?.cliente || !cache?.boletos || Date.now() - cache.salvoEm > VALIDADE_CACHE_MS) return null;
    return { agenda: cache.agenda, boletos: cache.boletos };
  } catch {
    return null;
  }
}

export function salvarCacheCliente(agenda: AgendaData, boletos: BoletosData) {
  try {
    localStorage.setItem(CHAVE_CACHE, JSON.stringify({ agenda, boletos, salvoEm: Date.now() } satisfies CacheCliente));
  } catch {}
}

/** Chamado ao sair e na tela de login, para que outra pessoa nunca veja dados anteriores. */
export function limparCacheCliente() {
  try { localStorage.removeItem(CHAVE_CACHE); } catch {}
}
