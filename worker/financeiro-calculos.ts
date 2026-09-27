/**
 * Cálculos financeiros puros compartilhados entre o Financeiro
 * (`admin-financeiro.ts`) e a Visão geral (`admin-visao-geral.ts`).
 * Uma única implementação para que os dois painéis nunca divirjam.
 */

export function dinheiro(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

export function relacao<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

type ContratoReceita = { valor_contrato?: unknown; custo_total?: unknown; taxa_administrativa_percentual?: unknown } | null | undefined;

/**
 * Parte da taxa administrativa (receita da Sra. Luck — BUSINESS-RULES §2)
 * contida em um valor pago/previsto de parcela. A taxa é proporcional ao
 * custo total do contrato: `valor × taxaTotal / custoTotal`.
 */
export function receitaAdministrativaDoValor(contrato: ContratoReceita, valor: number) {
  const base = dinheiro(contrato?.valor_contrato);
  const custo = dinheiro(contrato?.custo_total);
  const taxaTotal = Math.max(0, custo - base) || dinheiro(base * dinheiro(contrato?.taxa_administrativa_percentual) / 100);
  return custo > 0 ? dinheiro(valor * taxaTotal / custo) : 0;
}

/**
 * Recebimento vigente por parcela: o validado vence; senão, o mais recente.
 */
export function indiceRecebimentos<T extends { boleto_id?: unknown; status_validacao?: unknown; created_at?: unknown }>(recebimentos: T[]) {
  const result = new Map<string, T>();
  for (const recebimento of recebimentos) {
    const chave = String(recebimento.boleto_id ?? "");
    const atual = result.get(chave);
    if (!atual || recebimento.status_validacao === "validado" || new Date(String(recebimento.created_at)) > new Date(String(atual.created_at))) {
      result.set(chave, recebimento);
    }
  }
  return result;
}

/**
 * Data e valor efetivamente recebidos de uma parcela. Um recebimento validado
 * (com juros/multa/desconto) prevalece sobre o valor nominal da parcela paga.
 */
export function realizacaoDaParcela(
  boleto: { status?: unknown; valor?: unknown; data_pagamento?: unknown },
  recebimento?: { status_validacao?: unknown; data_pagamento?: unknown; valor_recebido?: unknown } | null,
): { data: string | null; valor: number } {
  if (recebimento?.status_validacao === "validado") {
    return { data: recebimento.data_pagamento ? String(recebimento.data_pagamento).slice(0, 10) : null, valor: dinheiro(recebimento.valor_recebido) };
  }
  const data = boleto.data_pagamento ? String(boleto.data_pagamento).slice(0, 10) : null;
  return { data, valor: boleto.status === "pago" ? dinheiro(boleto.valor) : 0 };
}
