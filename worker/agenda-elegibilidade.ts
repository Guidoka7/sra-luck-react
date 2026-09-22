/**
 * V46 — tabela de elegibilidade por quantidade de parcelas do plano.
 * Espelha exatamente a regra ativa em `public.pode_agendar` (migration_064:
 * `porcentagem_pagamento >= coalesce(clientes.percentual_minimo_agendar,
 * tiered fallback)`), usada aqui apenas para EXIBIÇÃO (ex.: "faltam N
 * parcelas" na Central e no app) — o gate real de elegibilidade é sempre a
 * RPC `pode_agendar`, nunca este cálculo em JS.
 */
export const PERCENTUAL_ELEGIBILIDADE: Record<number, number> = {
  12: 60,
  18: 60,
  24: 60,
  36: 70,
  48: 80,
  60: 80,
  72: 80,
};

const PARCELAS_MINIMAS: Record<number, number> = {
  12: 8,
  18: 11,
  24: 15,
  36: 26,
  48: 39,
  60: 48,
  72: 58,
};

/** Percentual mínimo da modalidade (somente exibição). */
export function percentualElegibilidade(totalParcelas: number): number {
  return percentualParaModalidade(totalParcelas);
}

function percentualParaModalidade(totalParcelas: number): number {
  if (PERCENTUAL_ELEGIBILIDADE[totalParcelas] != null) return PERCENTUAL_ELEGIBILIDADE[totalParcelas];
  return [12, 18, 24].includes(totalParcelas) ? 60 : totalParcelas === 36 ? 70 : 80;
}

/** Quantidade mínima de parcelas pagas (ceil) para uma dada modalidade. */
export function requiredPaid(totalParcelas: number): number {
  if (PARCELAS_MINIMAS[totalParcelas] != null) return PARCELAS_MINIMAS[totalParcelas];
  return Math.ceil((totalParcelas * percentualParaModalidade(totalParcelas)) / 100);
}

/** Quantas parcelas ainda faltam para atingir o mínimo (nunca negativo). */
export function missingToEligibility(totalParcelas: number, parcelasPagas: number): number {
  return Math.max(0, requiredPaid(totalParcelas) - Math.max(0, parcelasPagas));
}
