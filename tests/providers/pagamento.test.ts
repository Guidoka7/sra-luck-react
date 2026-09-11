import { test } from "node:test";
import assert from "node:assert/strict";
import { ContaAzulProvider, MercadoPagoProvider } from "../../worker/providers/pagamento.provider.js";
import { createLogger } from "../../worker/middleware/logger.js";
import { jsonResponse, sequenceFetcher } from "../setup.js";
import type { Env } from "../../worker/supabase.js";

const input = {
  reference: "boleto:550e8400-e29b-41d4-a716-446655440000",
  amount: 1500,
  description: "Parcela Sra. Luck",
  payer: { name: "Cliente Teste", document: "52998224725", email: "cliente@example.com" },
  successUrl: "https://app.invalid/agenda?pagamento=sucesso",
  notificationUrl: "https://app.invalid/api/webhooks/mercado_pago",
};

const context = { requestId: "payment-test" };

test("Mercado Pago: cria preferência com adapter tipado", async () => {
  const env: Env = { MERCADO_PAGO_ACCESS_TOKEN: "token", MERCADO_PAGO_BASE_URL: "https://mp.invalid" };
  const provider = new MercadoPagoProvider(env, {
    logger: createLogger({ test: "mp-success" }),
    fetcher: sequenceFetcher([jsonResponse({ id: "pref-1", init_point: "https://checkout.invalid/1" }, 201)]),
  });
  const result = await provider.createPayment(input, context);
  assert.equal(result.externalId, "pref-1");
  assert.equal(result.checkoutUrl, "https://checkout.invalid/1");
});

test("Mercado Pago: normaliza pagamento aprovado", async () => {
  const provider = new MercadoPagoProvider({ MERCADO_PAGO_ACCESS_TOKEN: "token" }, { logger: createLogger({ test: "mp-event" }) });
  const request = new Request("https://app.invalid/api/webhooks/mercado_pago?data.id=pay-1", { method: "POST" });
  const event = await provider.normalizeWebhook({ id: "evt-1", action: "payment.updated", status: "approved", external_reference: "boleto:1", transaction_amount: 1500 }, request);
  assert.equal(event.type, "payment_settled");
  assert.equal(event.resourceId, "pay-1");
});

test("Conta Azul: cria conta a receber usando configuração injetada", async () => {
  const env: Env = { CONTA_AZUL_API_KEY: "token", CONTA_AZUL_BASE_URL: "https://ca.invalid" };
  const provider = new ContaAzulProvider(env, {
    logger: createLogger({ test: "ca-success" }),
    fetcher: sequenceFetcher([jsonResponse({ id: "receivable-1", status: "open" }, 201)]),
  });
  const result = await provider.createPayment(input, context);
  assert.equal(result.externalId, "receivable-1");
  assert.equal(result.provider, "conta_azul");
});

test("Pagamento: bloqueia valor acima do limite", async () => {
  const provider = new MercadoPagoProvider({ MERCADO_PAGO_ACCESS_TOKEN: "token" }, {
    logger: createLogger({ test: "mp-validation" }),
    fetcher: sequenceFetcher([jsonResponse({ id: "unused" })]),
  });
  await assert.rejects(() => provider.createPayment({ ...input, amount: 999_000_000_000 }, context), /limite permitido/i);
});
