import type { Cliente, StatusContratoCliente } from "@/types/database";

export type DrawerStatusLabel = "Ativa" | "Inadimplente" | "Suspensa" | "Negativada" | "Cancelamento";
export type InstallmentStatus = "paid" | "pending" | "overdue" | "review" | "rejected" | "suspended";

export interface DrawerClientModel {
  id: string;
  status: DrawerStatusLabel;
  name: string;
  birthDate: string;
  cpf: string;
  phone: string;
  email: string;
  procedure: string;
  planValue: number;
  seller: string;
  campaign: string;
  bank: string;
  notes: string;
  releaseForecast: string;
}

export interface DrawerFinancialModel {
  procedure: string;
  totalPlan: number;
  totalInstallments: number;
  installmentValue: number;
  eligibilityPercentage: number;
  planStart: string;
  paymentMethod: string;
  institution: string;
  billingDay: number | null;
  status: "Ativa" | "Suspensa";
}

export interface DrawerInstallment {
  id: string;
  number: number;
  dueDate: string;
  value: number;
  paidValue: number | null;
  status: InstallmentStatus;
  paymentDate: string;
  receipt: boolean;
  receiptPath: string | null;
  rawStatus: string;
  suspended: boolean;
}

export interface FinancialHistoryItem {
  id: string;
  date: string;
  type: "payment" | "receipt" | "plan" | "status" | "other";
  description: string;
  author: string;
}

export interface JourneyContract {
  etapa?: string | null;
  percentual_minimo?: number | string | null;
  levantamento_aprovado_em?: string | null;
  forma_quitacao?: string | null;
  escolha_forma_em?: string | null;
  termos_assinados_em?: string | null;
  quitado_em?: string | null;
  agenda_cirurgica_liberar_em?: string | null;
  cirurgia_em?: string | null;
}

export interface FinancialSummary {
  paidCount: number;
  totalPaid: number;
  openBalance: number;
  installmentProgress: number;
  minimumInstallments: number;
  missing: number;
  eligible: boolean;
}

export const CLIENT_STATUS_OPTIONS: Array<{ db: StatusContratoCliente; label: DrawerStatusLabel; color: string }> = [
  { db: "ativo", label: "Ativa", color: "#16A34A" },
  { db: "inadimplente", label: "Inadimplente", color: "#C9A15A" },
  { db: "suspenso", label: "Suspensa", color: "#66717C" },
  { db: "negativado", label: "Negativada", color: "#DC2626" },
  { db: "cancelado", label: "Cancelamento", color: "#7A2632" },
];

export const INSTALLMENT_LABELS: Record<InstallmentStatus, string> = {
  paid: "Pago",
  pending: "Pendente",
  overdue: "Vencida",
  review: "Em análise",
  rejected: "Rejeitada",
  suspended: "Suspensa",
};

export const PAYMENT_METHODS = ["Cartão de crédito", "PIX", "Boleto", "Cheque"] as const;
export const INSTITUTIONS = ["Santander", "BRB", "Banco do Brasil", "Sicredi", "Efí", "Mercado Pago", "Outro"] as const;

export function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

export function formatNumberBR(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const iso = String(value).slice(0, 10);
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "—";
}

export function statusLabel(status?: StatusContratoCliente | null): DrawerStatusLabel {
  return CLIENT_STATUS_OPTIONS.find((item) => item.db === status)?.label ?? "Ativa";
}

export function statusDb(label: DrawerStatusLabel): StatusContratoCliente {
  return CLIENT_STATUS_OPTIONS.find((item) => item.label === label)?.db ?? "ativo";
}

export function mapClienteToDrawerModel(cliente: Cliente): DrawerClientModel {
  return {
    id: cliente.id,
    status: statusLabel(cliente.status_contrato),
    name: cliente.nome_completo ?? "",
    birthDate: cliente.data_nascimento ?? "",
    cpf: cliente.cpf ?? "",
    phone: cliente.telefone ?? "",
    email: cliente.email ?? "",
    procedure: cliente.procedimento ?? "",
    planValue: Number(cliente.valor_contrato ?? 0),
    seller: cliente.consultora ?? "",
    campaign: cliente.origem_venda ?? "",
    bank: cliente.banco ?? "",
    notes: cliente.observacoes_internas ?? "",
    releaseForecast: "",
  };
}

export function initialFinancialModel(cliente: Cliente): DrawerFinancialModel {
  const quantity = Number(cliente.quantidade_parcelas ?? cliente.parcelas_total ?? 0);
  return {
    procedure: cliente.procedimento ?? "",
    totalPlan: Number(cliente.valor_total_plano ?? cliente.custo_total ?? 0),
    totalInstallments: Number.isFinite(quantity) ? quantity : 0,
    installmentValue: Number(cliente.valor_parcela_plano ?? 0),
    eligibilityPercentage: Number(cliente.percentual_minimo_agendar ?? 70),
    planStart: cliente.inicio_plano ?? "",
    paymentMethod: cliente.forma_pagamento_plano ?? "",
    institution: cliente.instituicao_pagamento ?? cliente.banco ?? "",
    billingDay: cliente.dia_cobranca == null ? null : Number(cliente.dia_cobranca),
    status: cliente.status_plano === "Suspensa" ? "Suspensa" : "Ativa",
  };
}

export function mergePlanClient(financial: DrawerFinancialModel, raw: Record<string, unknown> | null | undefined): DrawerFinancialModel {
  if (!raw) return financial;
  return {
    ...financial,
    totalPlan: Number(raw.valor_total_plano ?? raw.custo_total ?? financial.totalPlan),
    totalInstallments: Number(raw.quantidade_parcelas ?? financial.totalInstallments),
    installmentValue: Number(raw.valor_parcela_plano ?? financial.installmentValue),
    eligibilityPercentage: Number(raw.percentual_minimo_agendar ?? financial.eligibilityPercentage),
    planStart: String(raw.inicio_plano ?? financial.planStart ?? ""),
    paymentMethod: String(raw.forma_pagamento_plano ?? financial.paymentMethod ?? ""),
    institution: String(raw.instituicao_pagamento ?? financial.institution ?? ""),
    billingDay: raw.dia_cobranca == null ? financial.billingDay : Number(raw.dia_cobranca),
    status: raw.status_plano === "Suspensa" ? "Suspensa" : "Ativa",
  };
}

export function mapBoletoToDrawerInstallment(raw: Record<string, unknown>): DrawerInstallment {
  const rawStatus = String(raw.status ?? "nao_pago");
  const dueDate = String(raw.data_vencimento ?? "");
  let status: InstallmentStatus = "pending";
  if (Boolean(raw.suspensa)) status = "suspended";
  else if (rawStatus === "pago") status = "paid";
  else if (rawStatus === "pendente_confirmacao") status = "review";
  else if (rawStatus === "rejeitado") status = "rejected";
  else if (rawStatus === "nao_pago" && dueDate && dueDate < new Date().toISOString().slice(0, 10)) status = "overdue";
  return {
    id: String(raw.id ?? ""),
    number: Number(raw.numero_parcela ?? 0),
    dueDate,
    value: Number(raw.valor ?? 0),
    paidValue: raw.valor_recebido == null ? null : Number(raw.valor_recebido),
    status,
    paymentDate: String(raw.recebimento_data ?? raw.data_pagamento ?? ""),
    receipt: Boolean(raw.comprovante_url),
    receiptPath: raw.comprovante_url == null ? null : String(raw.comprovante_url),
    rawStatus,
    suspended: Boolean(raw.suspensa),
  };
}

export function calculateFinancialSummary(financial: DrawerFinancialModel, installments: DrawerInstallment[]): FinancialSummary {
  const paid = installments.filter((item) => item.status === "paid");
  const paidCount = paid.length;
  const totalPaid = paid.reduce((sum, item) => sum + Number(item.paidValue ?? item.value ?? 0), 0);
  const openBalance = Number(financial.totalPlan || 0) - totalPaid;
  const installmentProgress = financial.totalInstallments > 0 ? paidCount / financial.totalInstallments * 100 : 0;
  const minimumInstallments = Math.ceil(financial.totalInstallments * financial.eligibilityPercentage / 100);
  const missing = Math.max(minimumInstallments - paidCount, 0);
  return { paidCount, totalPaid, openBalance, installmentProgress, minimumInstallments, missing, eligible: paidCount >= minimumInstallments };
}

function logDescription(action: string, details: Record<string, unknown>) {
  const parcela = Number(details.parcela ?? details.numero_parcela ?? 0);
  const total = Number(details.total_parcelas ?? details.novo_total ?? 0);
  if (action === "baixou_parcela_manual") return parcela ? `Pagamento confirmado - Parcela ${parcela}${total ? `/${total}` : ""}` : "Pagamento confirmado";
  if (action === "confirmou_comprovante") return parcela ? `Comprovante confirmado - Parcela ${parcela}` : "Comprovante confirmado";
  if (action === "rejeitou_comprovante") return parcela ? `Comprovante rejeitado - Parcela ${parcela}` : "Comprovante rejeitado";
  if (action.includes("comprovante")) return parcela ? `Comprovante anexado - Parcela ${parcela}` : "Comprovante anexado";
  if (action === "excluiu_parcela") return parcela ? `Parcela ${parcela} excluída` : "Parcela excluída";
  if (action === "editou_parcela") return parcela ? `Parcela ${parcela} editada` : "Parcela editada";
  if (action === "ajustou_plano_financeiro") return "Plano financeiro atualizado";
  if (action === "criou_plano_financeiro") return "Plano financeiro criado";
  if (action === "alterou_status_contrato") return `Status alterado para ${String(details.para ?? "")}`;
  if (action === "reabriu_parcela") return parcela ? `Parcela ${parcela} reaberta` : "Parcela reaberta";
  return action.replaceAll("_", " ");
}

export function mapHistory(rows: unknown[]): FinancialHistoryItem[] {
  return (Array.isArray(rows) ? rows : []).map((row: any) => {
    const details = row?.detalhes && typeof row.detalhes === "object" ? row.detalhes as Record<string, unknown> : {};
    const action = String(row?.acao ?? "evento");
    return {
      id: String(row?.id ?? crypto.randomUUID()),
      date: String(row?.created_at ?? "").slice(0, 10),
      type: action.includes("pag") || action.includes("baix") || action.includes("confirmou_comprovante") ? "payment"
        : action.includes("comprovante") ? "receipt"
        : action.includes("status") ? "status"
        : action.includes("plano") || action.includes("parcela") ? "plan" : "other",
      description: logDescription(action, details),
      author: String(row?.usuario ?? "sistema").replace(/^admin:/, ""),
    };
  });
}

export function paymentMethodCode(label: string) {
  const value = label.toLocaleLowerCase("pt-BR");
  if (value.includes("pix")) return "pix";
  if (value.includes("cart")) return "cartao";
  if (value.includes("boleto")) return "boleto";
  if (value.includes("cheque")) return "cheque";
  if (value.includes("dinheiro")) return "dinheiro";
  if (value.includes("transfer")) return "transferencia";
  return "outro";
}

export async function apiJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const multipart = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: init?.body && !multipart ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.erro || "Não foi possível concluir a operação.");
  return data as T;
}

export function buildJourneyFlags(cliente: Cliente, contrato: JourneyContract | null) {
  const stage = String(contrato?.etapa ?? "");
  const afterReview = ["forma_pagamento_liberada","termos_agendados","aguardando_quitacao","quitado","agenda_cirurgica_liberada","cirurgia_agendada","concluido"].includes(stage);
  const afterPaymentChoice = ["termos_agendados","aguardando_quitacao","quitado","agenda_cirurgica_liberada","cirurgia_agendada","concluido"].includes(stage);
  const termsSigned = Boolean(contrato?.termos_assinados_em ?? cliente.termos_assinados_em) || ["aguardando_quitacao","quitado","agenda_cirurgica_liberada","cirurgia_agendada","concluido"].includes(stage);
  const surgeryReleased = ["agenda_cirurgica_liberada","cirurgia_agendada","concluido"].includes(stage);
  const surgeryScheduled = ["cirurgia_agendada","concluido"].includes(stage) || ["agendada","realizada"].includes(String(cliente.status_cirurgia));
  const surgeryDone = stage === "concluido" || cliente.status_cirurgia === "realizada";
  return {
    statusRevisao: afterReview ? "aprovada" as const : cliente.status_revisao_financeira ?? null,
    custeioStatus: afterPaymentChoice || cliente.custeio_confirmado_em ? "aprovada" as const : null,
    agendada: stage === "termos_agendados" || Boolean(cliente.proximo_agendamento_data),
    termosAssinados: termsSigned,
    agendaCirurgicaLiberada: surgeryReleased,
    cirurgiaAgendada: surgeryScheduled,
    cirurgiaRealizada: surgeryDone,
    previsaoLiberacaoFinanceira: contrato?.cirurgia_em ?? null,
    agendaCirurgicaLiberarEm: contrato?.agenda_cirurgica_liberar_em ?? null,
  };
}
