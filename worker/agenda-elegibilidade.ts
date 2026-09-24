import { percentualMinimoPlano } from "./regras-operacionais";

/**
 * V46 — tabela de elegibilidade por quantidade de parcelas do plano.
 * Espelha exatamente a regra ativa em `public.pode_agendar` (migration_094:
 * `porcentagem_pagamento >= coalesce(clientes.percentual_minimo_agendar,
 * percentuais de regras_operacionais)`), usada aqui apenas para EXIBIÇÃO (ex.: "faltam N
 * parcelas" na Central e no app) — o gate real de elegibilidade é sempre a
 * RPC `pode_agendar`, nunca este cálculo em JS.
 */
/** Planos existentes; o percentual de cada faixa vem de regras_operacionais (migration_094). */
export const PLANOS_PARCELAS = [12, 18, 24, 36, 48, 60, 72] as const;

/** Percentual mínimo da modalidade (somente exibição). */
export function percentualElegibilidade(totalParcelas: number): number {
  return percentualMinimoPlano(totalParcelas);
}

/** Quantidade mínima de parcelas pagas (ceil) para uma dada modalidade. */
export function requiredPaid(totalParcelas: number): number {
  return Math.ceil((totalParcelas * percentualMinimoPlano(totalParcelas)) / 100 - 1e-9);
}

/** Quantas parcelas ainda faltam para atingir o mínimo (nunca negativo). */
export function missingToEligibility(totalParcelas: number, parcelasPagas: number): number {
  return Math.max(0, requiredPaid(totalParcelas) - Math.max(0, parcelasPagas));
}
