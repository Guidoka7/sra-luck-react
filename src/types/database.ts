export type StatusData = "disponivel" | "bloqueado";
export type StatusAgendamento = "confirmado" | "cancelado" | "realizado";
export type StatusCirurgia = "nao_agendada" | "agendada" | "realizada" | "cancelada";
export type StatusFinanceiro = "pago" | "a_pagar" | "parcial";
export type StatusBoleto = "nao_pago" | "pago" | "pendente_confirmacao" | "rejeitado";
export type QuantidadeParcelas = 12 | 18 | 24 | 36 | 48 | 60 | 72;
export type StatusRevisaoFinanceira = "pendente" | "aprovada" | "recusada";
export type FormaCusteioRestante = "cartao" | "pix" | "cheques" | "boleto_100";

export const STATUS_REVISAO_FINANCEIRA_LABEL: Record<StatusRevisaoFinanceira, string> = { pendente: "Revisão em andamento", aprovada: "Aprovada", recusada: "Recusada" };
export const PRAZO_REVISAO_FINANCEIRA_DIAS_UTEIS = 5;
export const PRAZO_REVISAO_FINANCEIRA_HORAS = 120;
export const STATUS_BOLETO_LABEL: Record<StatusBoleto, string> = { nao_pago: "Não pago", pago: "Pago", pendente_confirmacao: "Aguardando confirmação", rejeitado: "Rejeitado" };
export const QUANTIDADE_PARCELAS_OPCOES: QuantidadeParcelas[] = [12, 18, 24, 36, 48, 60, 72];
export const PERCENTUAL_MINIMO_AGENDAR: Record<QuantidadeParcelas, number> = { 12: 60, 18: 60, 24: 60, 36: 70, 48: 80, 60: 80, 72: 80 };
export const TAXA_ADMINISTRATIVA_PADRAO: Record<QuantidadeParcelas, number> = { 12: 25, 18: 32, 24: 41, 36: 59, 48: 63, 60: 77, 72: 83 };
export const STATUS_CIRURGIA_LABEL: Record<StatusCirurgia, string> = { nao_agendada: "Não iniciado", agendada: "Agendado", realizada: "Concluído", cancelada: "Cancelado" };
export const STATUS_FINANCEIRO_LABEL: Record<StatusFinanceiro, string> = { pago: "Pago", a_pagar: "A pagar", parcial: "Parcialmente pago" };

export interface Configuracoes { id: 1; nome_clinica: string; meta_orcamento_mensal: number; frase_sonho: string; pix_chave: string; pix_qrcode_base64: string; whatsapp_contato: string; telefone_contato: string; agenda_liberacao_financeira_bloqueada: boolean; updated_at: string; }
export interface Cliente { id: string; nome_completo: string; cpf: string; data_nascimento: string; telefone: string | null; email: string | null; procedimento: string | null; medico: string | null; hospital: string | null; consultora: string | null; valor_contrato: number; taxa_administrativa_percentual: number; custo_total: number; status_cirurgia: StatusCirurgia; status_financeiro: StatusFinanceiro; quantidade_parcelas: QuantidadeParcelas | null; percentual_minimo_agendar?: number | null; ativo: boolean; observacoes_internas: string | null; created_at: string; updated_at: string; porcentagem_pagamento?: number | null; parcelas_pagas?: number | null; parcelas_total?: number | null; status_revisao_financeira?: StatusRevisaoFinanceira | null; data_atingiu_percentual?: string | null; observacao_revisao_financeira?: string | null; financeiro_saldo_restante?: number | null; financeiro_taxa_cartao?: number | null; financeiro_total_com_taxa?: number | null; financeiro_formas_custeio?: FormaCusteioRestante[] | null; financeiro_confirmado_em?: string | null; custeio_confirmado_em?: string | null; termos_assinados_em?: string | null; proximo_agendamento_data?: string | null; proximo_agendamento_horario?: string | null; }
export interface Boleto { id: string; cliente_id: string; numero_parcela: number; total_parcelas: number; valor: number; data_vencimento: string | null; status: StatusBoleto; comprovante_url: string | null; boleto_url: string | null; data_pagamento: string | null; observacoes: string | null; suspensa?: boolean; suspensa_em?: string | null; suspensa_por?: string | null; created_at: string; updated_at: string; clientes?: { id: string; nome_completo: string; cpf: string }; }
export interface DataAgenda { id: string; data: string; vagas_totais: number; status: StatusData; observacoes_internas: string | null; created_at: string; updated_at: string; }
export interface ClienteAgendadaNaData { clienteId: string | null; nome: string; valor: number; criadoEm: string; statusRevisaoFinanceira: StatusRevisaoFinanceira | null; }
export interface DataLiberacaoFinanceira { id: string; data: string; status: StatusData; observacoes_internas: string | null; created_at: string; updated_at: string; }
export interface Agendamento { id: string; cliente_id: string; data_id: string; valor_contrato: number; status: StatusAgendamento; observacoes_internas: string | null; previsao_liberacao_financeira: string | null; horario_termos?: string | null; termos_assinados_em?: string | null; created_at: string; updated_at: string; }
export interface LogAlteracao { id: string; usuario: string; acao: string; entidade: string; entidade_id: string | null; detalhes: Record<string, unknown> | null; created_at: string; }
