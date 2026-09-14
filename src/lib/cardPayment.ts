/** Configuração de pagamento com cartão exposta pelo painel administrativo. */
export interface CardPaymentConfig {
  habilitado: boolean;
  taxaPercentual: number;
  maxParcelas: number | null;
}

export interface CardCheckoutSession {
  sessionId: string;
  checkoutUrl: string | null;
  provider: string | null;
  amount: number;
  feeAmount: number;
  total: number;
  feePercent: number;
  disponivel: boolean;
  mensagem: string;
}

/** Prévia client-side da taxa/total (o valor final é sempre recalculado pelo servidor). */
export function calcularTaxaCartao(valor: number, taxaPercentual: number) {
  const feeAmount = Math.round(valor * (taxaPercentual / 100) * 100) / 100;
  const total = Math.round((valor + feeAmount) * 100) / 100;
  return { feeAmount, total };
}

export async function criarSessaoCartao(boletoId: string): Promise<CardCheckoutSession> {
  const resposta = await fetch("/api/cliente/pagamentos/cartao/sessao", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boletoId }),
  });
  const dados = await resposta.json().catch(() => ({})) as CardCheckoutSession & { erro?: string };
  if (!resposta.ok) throw new Error(dados.erro ?? "Não foi possível iniciar o pagamento no cartão.");
  return dados;
}
