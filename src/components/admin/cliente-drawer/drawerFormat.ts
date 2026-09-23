import type { Boleto, LogAlteracao, StatusContratoCliente } from "@/types/database";

/** Formatação e mapeamentos de exibição do drawer compartilhado da cliente. */

export function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "—";
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** Data civil de São Paulo (mesma referência de "hoje" usada pelo servidor). */
export function hojeSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** Somente os status aceitos pela API atual (`validarTransicaoStatusContrato`). */
export const STATUS_CLIENTE: Array<{ db: StatusContratoCliente; label: string; key: string; color: string }> = [
  { db: "ativo", label: "Ativa", key: "ativa", color: "var(--green)" },
  { db: "suspenso", label: "Suspensa", key: "suspensa", color: "#66717C" },
  { db: "negativado", label: "Negativada", key: "negativada", color: "var(--danger)" },
  { db: "cancelado", label: "Cancelada", key: "cancelamento", color: "var(--wine)" },
];

export function statusCliente(db: StatusContratoCliente | null | undefined) {
  return STATUS_CLIENTE.find((s) => s.db === db) ?? STATUS_CLIENTE[0];
}

export type ParcelaStatus = "paid" | "pending" | "overdue" | "review" | "rejected" | "suspended";

export const PARCELA_LABEL: Record<ParcelaStatus, string> = {
  paid: "Pago", pending: "Pendente", overdue: "Vencida", review: "Em análise", rejected: "Rejeitada", suspended: "Suspensa",
};

export function statusParcela(b: Pick<Boleto, "status" | "data_vencimento" | "suspensa">, hoje: string): ParcelaStatus {
  if (b.suspensa) return "suspended";
  if (b.status === "pago") return "paid";
  if (b.status === "pendente_confirmacao") return "review";
  if (b.status === "rejeitado") return "rejected";
  if (b.data_vencimento && b.data_vencimento < hoje) return "overdue";
  return "pending";
}

export type HistoricoTipo = "payment" | "receipt" | "plan" | "status" | "other";

/** Texto legível para cada `logs_alteracoes.acao` (mesma leitura da referência). */
export function descreverHistorico(h: LogAlteracao): { tipo: HistoricoTipo; texto: string; autor: string } {
  const acao = h.acao ?? "evento";
  const d = (h.detalhes && typeof h.detalhes === "object" ? h.detalhes : {}) as Record<string, unknown>;
  const parcela = Number(d.parcela ?? d.numero_parcela ?? 0);
  const total = Number(d.total_parcelas ?? d.novo_total ?? 0);
  const p = parcela ? ` - Parcela ${parcela}${total ? `/${total}` : ""}` : "";
  let texto: string;
  if (acao === "baixou_parcela_manual") texto = `Pagamento confirmado${p}`;
  else if (acao === "confirmou_comprovante") texto = `Comprovante confirmado${p}`;
  else if (acao === "rejeitou_comprovante") texto = `Comprovante rejeitado${p}`;
  else if (acao.includes("comprovante")) texto = `Comprovante anexado${p}`;
  else if (acao === "excluiu_parcela") texto = parcela ? `Parcela ${parcela} excluída` : "Parcela excluída";
  else if (acao === "editou_parcela") texto = parcela ? `Parcela ${parcela} editada` : "Parcela editada";
  else if (acao === "reabriu_parcela") texto = parcela ? `Parcela ${parcela} reaberta` : "Parcela reaberta";
  else if (acao === "suspendeu_parcelas") texto = "Parcelas suspensas";
  else if (acao === "gerou_parcelas") texto = "Plano financeiro criado";
  else if (acao === "ajustou_plano_financeiro") texto = "Plano financeiro atualizado";
  else if (acao === "alterou_status_contrato") texto = `Status alterado${d.para ? ` para ${String(d.para)}` : ""}`;
  else if (acao === "liberou_acesso_app") texto = "Acesso ao aplicativo liberado";
  else texto = acao.replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase());
  const tipo: HistoricoTipo = /pag|baix|confirmou_comprovante/.test(acao) ? "payment"
    : acao.includes("comprovante") ? "receipt"
    : acao.includes("status") ? "status"
    : /plano|parcela/.test(acao) ? "plan" : "other";
  return { tipo, texto, autor: String(h.usuario ?? "sistema").replace(/^admin:/, "") };
}

export function ehHistoricoFinanceiro(h: LogAlteracao) {
  return /parcela|baixa|comprovante|boleto|pagamento|quita|carne|financeir|custeio|plano|recebivel/.test(h.acao ?? "");
}
