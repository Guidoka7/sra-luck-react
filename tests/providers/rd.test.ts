import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpRDProvider } from "../../worker/providers/rd.provider.js";
import { createLogger } from "../../worker/middleware/logger.js";
import { jsonResponse, sequenceFetcher } from "../setup.js";
import type { Env } from "../../worker/supabase.js";

const env: Env = {
  RD_STATION_BASE_URL: "https://rd.invalid",
  RD_STATION_API_KEY: "test-token",
  RD_STATION_WEBHOOK_TOKEN: "webhook-token",
};

test("RD: sincroniza contato sem credencial real", async () => {
  const provider = new HttpRDProvider(env, {
    logger: createLogger({ test: "rd-success" }),
    fetcher: sequenceFetcher([jsonResponse({ uuid: "contact-1", status: "ok" }, 201)]),
  });
  const result = await provider.upsertLead({
    name: "Cliente Teste",
    email: "cliente@example.com",
    document: "52998224725",
    value: 50000,
  }, { requestId: "rd-test" });
  assert.equal(result.externalId, "contact-1");
  assert.equal(result.provider, "rd_station");
});

test("RD: valida e normaliza webhook", async () => {
  const provider = new HttpRDProvider(env, { logger: createLogger({ test: "rd-webhook" }) });
  const request = new Request("https://app.invalid/api/webhooks/rd_station", {
    method: "POST",
    headers: { "x-rd-webhook-token": "webhook-token", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(await provider.verifyWebhook(request), true);
  const event = await provider.normalizeWebhook({
    transaction_uuid: "evt-1",
    event_name: "deal_won",
    document: { id: "lead-1", deal_id: "deal-1", amount: 12000 },
  }, request);
  assert.equal(event.type, "deal_won");
  assert.equal(event.eventId, "evt-1");
  assert.equal(event.amount, 12000);
});

test("RD: rejeita e-mail inválido", async () => {
  const provider = new HttpRDProvider(env, {
    logger: createLogger({ test: "rd-validation" }),
    fetcher: sequenceFetcher([jsonResponse({ uuid: "unused" })]),
  });
  await assert.rejects(() => provider.upsertLead({ name: "Cliente", email: "email-invalido" }, { requestId: "rd-invalid" }), /e-mail válido/i);
});
