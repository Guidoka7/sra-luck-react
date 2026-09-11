export type AbaFinanceiro = "visao-geral" | "recebiveis" | "validacao" | "contratos" | "conciliacao";

export interface PeriodoFinanceiro { inicio: string; fim: string }

export interface ResumoFinanceiro {
  periodo: PeriodoFinanceiro;
  kpis: {
    aReceber: number;
    recebido: number;
    vencido: number;
    aguardandoValidacao: number;
    divergencias: number | null;
    divergenciasDisponiveis: boolean;
    receitaAdministrativaRealizada: number;
    receitaAdministrativaFutura: number;
  };
  previsao: { dias30: number; dias60: number; dias90: number };
  evolucao: Array<{
    label: string;
    previsto: number;
    realizado: number;
    vencido: number;
    receitaRealizada: number;
    receitaFutura: number;
  }>;
  ultimaAtualizacao: string;
  truncado: boolean;
}

export interface Recebivel {
  id: string;
  clienteId: string;
  cliente: string;
  cpf: string | null;
  vendedora: string | null;
  numeroParcela: number;
  totalParcelas: number;
  vencimento: string | null;
  valorOriginal: number;
  juros: number;
  multa: number;
  desconto: number;
  valorEsperado: number;
  valorRecebido: number | null;
  status: "nao_pago" | "pago" | "pendente_confirmacao" | "rejeitado" | "suspensa" | "vencido" | string;
  formaPagamento: string | null;
  origem: string;
  instituicaoConta: string | null;
  dataPagamento: string | null;
  comprovante: string | null;
  externalId: string | null;
  externalReference: string | null;
  observacoes: string | null;
  suspensa: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Recebimento {
  id: string;
  valor_original: number;
  juros: number;
  multa: number;
  desconto: number;
  valor_recebido: number;
  data_pagamento: string | null;
  forma_pagamento: string | null;
  origem: string;
  origem_boleto: string | null;
  instituicao_financeira: string | null;
  status_validacao: string;
  observacao: string | null;
  motivo_rejeicao: string | null;
  criado_por: string;
  validado_por: string | null;
  validado_em: string | null;
  created_at: string;
}

export interface HistoricoFinanceiro {
  id: string;
  usuario: string;
  acao: string;
  detalhes: Record<string, unknown> | null;
  created_at: string;
}

export interface DetalheRecebivel {
  recebivel: Recebivel;
  recebimentos: Recebimento[];
  historico: HistoricoFinanceiro[];
}

export interface ListaRecebiveis {
  itens: Recebivel[];
  total: number;
  pagina: number;
  limite: number;
  truncado: boolean;
}

export interface ClienteFinanceiro {
  id: string;
  nome_completo: string;
  cpf?: string | null;
}
