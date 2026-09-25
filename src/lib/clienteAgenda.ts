/**
 * Formato das respostas de /api/cliente/agenda e /api/cliente/boletos usado
 * pelo app da cliente. O snapshot financeiro pode ser reutilizado apenas
 * enquanto esta página está aberta; não fica gravado no dispositivo.
 */

/**
 * Prazo para liberar a agenda cirúrgica, em dias úteis, contado a partir da
 * mais recente entre assinatura dos termos e quitação confirmada. Espelha
 * regras_operacionais.prazo_liberacao_dias_uteis (migration_094; padrão 5).
 * Fonte: docs/BUSINESS-RULES.md §12. Usado só em textos para a cliente.
 */
export { prazoLiberacaoDiasUteis } from "@/lib/regrasOperacionais";

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
const VALIDADE_CACHE_MS = 60_000;

type CacheCliente = { agenda: AgendaData; boletos: BoletosData; salvoEm: number };
let cacheMemoria: CacheCliente | null = null;

export function lerCacheCliente(): { agenda: AgendaData; boletos: BoletosData } | null {
  try {
    // Apaga snapshots legados com informações pessoais e financeiras persistidas.
    localStorage.removeItem(CHAVE_CACHE);
  } catch {
    // Armazenamento desabilitado: o cache em memória ainda funciona.
  }
  if (!cacheMemoria || Date.now() - cacheMemoria.salvoEm > VALIDADE_CACHE_MS) return null;
  return { agenda: cacheMemoria.agenda, boletos: cacheMemoria.boletos };
}

export function salvarCacheCliente(agenda: AgendaData, boletos: BoletosData) {
  cacheMemoria = { agenda, boletos, salvoEm: Date.now() } satisfies CacheCliente;
}

/** Chamado ao sair e na tela de login. */
export function limparCacheCliente() {
  cacheMemoria = null;
  try { localStorage.removeItem(CHAVE_CACHE); } catch {}
}
