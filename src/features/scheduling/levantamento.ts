import { FORMAS_CUSTEIO, type FormaCusteio } from "./api";

/**
 * Regras puras do Levantamento financeiro (Etapa 2): leitura do saldo/taxa
 * digitados, validação e payload enviado a `centralApi.concluirLevantamento`.
 * O backend repete a validação (`montarPatchRevisaoFinanceira`).
 */

/** "9.333,30" (pt-BR), "9333.30" e "4000.5" (persistido) → número. */
export function lerValor(texto: string): number {
  const v = String(texto ?? "").trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
  if (!v) return Number.NaN;
  if (v.includes(",")) return Number(v.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(v)) return Number(v.replace(/\./g, ""));
  return Number(v);
}

export function formatarValor(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatarTaxa(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return String(Number(n)).replace(".", ",");
}

/** Somente formas conhecidas, sem repetição, na ordem de FORMAS_CUSTEIO. */
export function normalizarFormas(formas: readonly string[] | null | undefined): FormaCusteio[] {
  const set = new Set((formas ?? []).map(String));
  return FORMAS_CUSTEIO.map((f) => f.value).filter((f) => set.has(f));
}

export function exigeTaxaCartao(formas: readonly string[]): boolean {
  return formas.includes("cartao");
}

export interface PayloadLevantamento {
  decisao: "aprovada";
  saldoRestante: number;
  formasCusteio: FormaCusteio[];
  taxaCartao?: number;
}

export function validarLevantamento(form: { saldo: string; taxa: string; formas: readonly string[] }): { erro: string } | { payload: PayloadLevantamento } {
  const saldo = lerValor(form.saldo);
  if (!Number.isFinite(saldo) || saldo < 0) return { erro: "Informe um saldo restante válido." };
  const formasCusteio = normalizarFormas(form.formas);
  if (!formasCusteio.length) return { erro: "Selecione ao menos uma forma de pagamento." };
  const payload: PayloadLevantamento = { decisao: "aprovada", saldoRestante: Math.round(saldo * 100) / 100, formasCusteio };
  if (exigeTaxaCartao(formasCusteio)) {
    const taxa = Number(String(form.taxa ?? "").trim().replace(",", "."));
    if (!String(form.taxa ?? "").trim() || !Number.isFinite(taxa) || taxa < 0 || taxa > 100) return { erro: "Informe uma taxa de cartão válida (0 a 100%)." };
    payload.taxaCartao = taxa;
  }
  return { payload };
}
