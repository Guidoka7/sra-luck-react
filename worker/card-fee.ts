/**
 * Cálculo da taxa/total do pagamento no cartão. Extraído em função pura para
 * ser testável isoladamente — o valor final cobrado é sempre recalculado
 * aqui no servidor a partir da parcela e da configuração administrativa,
 * nunca aceito do navegador.
 */
export function calcularTaxaCartao(valor: number, taxaPercentual: number) {
  const feeAmount = Math.round(valor * (taxaPercentual / 100) * 100) / 100;
  const total = Math.round((valor + feeAmount) * 100) / 100;
  return { feeAmount, total };
}
