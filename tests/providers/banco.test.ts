import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigurableBankProvider } from "../../worker/providers/banco.provider.js";
import { createLogger } from "../../worker/middleware/logger.js";
import { jsonResponse, sequenceFetcher, timeoutFetcher } from "../setup.js";
import type { Env } from "../../worker/supabase.js";

const env: Env = {
  BANCO_BRB_BASE_URL: "https://bank.invalid",
  BANCO_BRB_API_KEY: "test-key",
  BANCO_BRB_CREATE_CHARGE_PATH: "/charges",
  BANCO_BRB_GET_CHARGE_PATH: "/charges/{id}",
};

const input = {
  reference: "boleto:123",
  amount: 1250.5,
  dueDate: "2099-12-31",
  description: "Parcela Sra. Luck",
  customer: { name: "Cliente Teste", document: "52998224725", email: "cliente@example.com" },
};

const context = { requestId: "test-bank" };

test("banco: cria cobrança e adapta resposta", async () => {
  const provider = new ConfigurableBankProvider("brb", env, {
    logger: createLogger({ test: "bank-success" }),
    fetcher: sequenceFetcher([jsonResponse({ id: "ext-1", status: "created", barcode: "123", digitable_line: "456" }, 201)]),
  });
  const result = await provider.createCharge(input, context);
  assert.equal(result.externalId, "ext-1");
  assert.equal(result.provider, "brb");
  assert.equal(result.amount, 1250.5);
  assert.equal(result.digitableLine, "456");
});

test("banco: rejeita entrada inválida antes da rede", async () => {
  const provider = new ConfigurableBankProvider("brb", env, {
    logger: createLogger({ test: "bank-validation" }),
    fetcher: async () => jsonResponse({ id: "should-not-run" }),
  });
  await assert.rejects(
    () => provider.createCharge({ ...input, amount: 999_000_000_000 }, context),
    /limite permitido/i,
  );
});

test("banco: propaga erro HTTP como falha do provedor", async () => {
  const provider = new ConfigurableBankProvider("brb", env, {
    logger: createLogger({ test: "bank-error" }),
    fetcher: sequenceFetcher([
      jsonResponse({ message: "indisponível" }, 503),
      jsonResponse({ message: "indisponível" }, 503),
      jsonResponse({ message: "indisponível" }, 503),
    ]),
  });
  await assert.rejects(() => provider.createCharge(input, context), /provedor recusou/i);
});

test("banco: aplica timeout explícito", async () => {
  const provider = new ConfigurableBankProvider("brb", env, {
    logger: createLogger({ test: "bank-timeout" }),
    fetcher: timeoutFetcher(),
    timeoutMs: 500,
  });
  await assert.rejects(() => provider.createCharge(input, context));
});
