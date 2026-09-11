import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderFactory } from "../../worker/providers/factory.js";
import { createLogger } from "../../worker/middleware/logger.js";
import type { Env } from "../../worker/supabase.js";

const env: Env = { INTEGRATION_MODE: "mock" };
const factory = new ProviderFactory(env, createLogger({ test: "integration-flow" }));
const context = { requestId: "flow-1", actorType: "admin", actorId: "test-admin" };

test("fluxo: providers mock funcionam sem qualquer credencial", async () => {
  const bank = factory.bank("brb");
  const rd = factory.rd();
  const payment = factory.payment("mercado_pago");

  assert.equal(factory.mode, "mock");
  assert.equal(bank.isConfigured(), true);
  assert.equal(rd.isConfigured(), true);
  assert.equal(payment.isConfigured(), true);

  const lead = await rd.upsertLead({ name: "Cliente Teste", email: "cliente@example.com" }, context);
  const charge = await bank.createCharge({
    reference: "boleto:550e8400-e29b-41d4-a716-446655440000",
    amount: 1200,
    dueDate: "2099-12-31",
    description: "Parcela Sra. Luck",
    customer: { name: "Cliente Teste", document: "52998224725", email: "cliente@example.com" },
  }, context);
  const checkout = await payment.createPayment({
    reference: "boleto:550e8400-e29b-41d4-a716-446655440000",
    amount: 1200,
    description: "Parcela Sra. Luck",
    payer: { name: "Cliente Teste", document: "52998224725", email: "cliente@example.com" },
  }, context);

  assert.match(lead.externalId, /^rd_/);
  assert.match(charge.externalId, /^bank_/);
  assert.match(checkout.externalId, /^pay_/);
});

test("fluxo: webhook mock vira evento financeiro normalizado", async () => {
  const provider = factory.payment("mercado_pago");
  const request = new Request("https://app.invalid/api/webhooks/mercado_pago?mock=1", {
    method: "POST",
    headers: { "x-mock-webhook": "1" },
  });
  assert.equal(await provider.verifyWebhook(request), true);
  const event = await provider.normalizeWebhook({ eventId: "evt-1", paymentId: "pay-1", reference: "boleto:550e8400-e29b-41d4-a716-446655440000", amount: 1200 }, request);
  assert.equal(event.type, "payment_settled");
  assert.equal(event.reference, "boleto:550e8400-e29b-41d4-a716-446655440000");
});
