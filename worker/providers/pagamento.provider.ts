import type { Env } from "../supabase.js";
import { normalizeCpf, requiredString, validateEmail, validateMoney } from "../validation.js";
import type { StructuredLogger } from "../middleware/logger.js";
import type {
  NormalizedWebhookEvent,
  PagamentoProvider,
  PaymentRequest,
  PaymentResult,
  ProviderContext,
} from "./types.js";
import { asJsonObject, envValue, providerFetch, readNumber, readString, type ProviderHttpDependencies } from "./http.js";

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

function validatePaymentInput(input: PaymentRequest): void {
  requiredString(input.reference, "referência", 160);
  validateMoney(input.amount, "valor do pagamento");
  requiredString(input.description, "descrição", 500);
  requiredString(input.payer.name, "nome da cliente", 200);
  normalizeCpf(input.payer.document);
  if (input.payer.email) validateEmail(input.payer.email);
}

export class MercadoPagoProvider implements PagamentoProvider {
  readonly name = "mercado_pago" as const;
  private readonly baseUrl: string;
  private readonly accessToken: string | null;
  private readonly webhookToken: string | null;

  constructor(env: Env, private readonly dependencies: ProviderHttpDependencies) {
    this.baseUrl = (envValue(env, "MERCADO_PAGO_BASE_URL") ?? "https://api.mercadopago.com").replace(/\/$/, "");
    this.accessToken = envValue(env, "MERCADO_PAGO_ACCESS_TOKEN");
    this.webhookToken = envValue(env, "MERCADO_PAGO_WEBHOOK_TOKEN") ?? envValue(env, "MERCADO_PAGO_WEBHOOK_SECRET");
  }

  isConfigured(): boolean { return Boolean(this.accessToken); }

  async createPayment(input: PaymentRequest, context: ProviderContext): Promise<PaymentResult> {
    validatePaymentInput(input);
    if (!this.accessToken) throw new Error("Mercado Pago ainda não está configurado.");
    const payload = {
      items: [{ id: input.reference, title: input.description, quantity: 1, currency_id: "BRL", unit_price: input.amount }],
      external_reference: input.reference,
      payer: {
        name: input.payer.name,
        email: input.payer.email ?? undefined,
      },
      back_urls: {
        success: input.successUrl ?? undefined,
        pending: input.pendingUrl ?? undefined,
        failure: input.failureUrl ?? undefined,
      },
      auto_return: input.successUrl ? "approved" : undefined,
      notification_url: input.notificationUrl ?? undefined,
      metadata: { ...input.metadata, document: input.payer.document },
    };
    const { data } = await providerFetch(
      `${this.baseUrl}/checkout/preferences`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          "x-idempotency-key": input.reference,
        },
        body: JSON.stringify(payload),
      },
      context,
      this.dependencies,
      "mercado_pago.createPayment",
    );
    const externalId = readString(data, "id");
    if (!externalId) throw new Error("Mercado Pago retornou uma preferência sem identificador.");
    return {
      provider: this.name,
      externalId,
      status: readString(data, "status") ?? "created",
      checkoutUrl: readString(data, "init_point", "sandbox_init_point"),
      raw: data,
    };
  }

  async getPayment(externalId: string, context: ProviderContext): Promise<PaymentResult> {
    const id = requiredString(externalId, "identificador do pagamento", 200);
    if (!this.accessToken) throw new Error("Mercado Pago ainda não está configurado.");
    const { data } = await providerFetch(
      `${this.baseUrl}/v1/payments/${encodeURIComponent(id)}`,
      { method: "GET", headers: { Authorization: `Bearer ${this.accessToken}` } },
      context,
      this.dependencies,
      "mercado_pago.getPayment",
    );
    return {
      provider: this.name,
      externalId: readString(data, "id") ?? id,
      status: readString(data, "status") ?? "unknown",
      checkoutUrl: null,
      raw: data,
    };
  }

  async verifyWebhook(request: Request): Promise<boolean> {
    if (!this.webhookToken) return false;
    const signature = request.headers.get("x-signature") ?? "";
    const requestId = request.headers.get("x-request-id") ?? "";
    const url = new URL(request.url);
    const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("data_id") ?? "";
    const parts = Object.fromEntries(signature.split(",").map((part) => part.trim().split("=")).filter(([key, value]) => Boolean(key && value)));
    const ts = parts.ts ?? "";
    const v1 = parts.v1 ?? "";
    if (!ts || !v1) {
      const fallback = request.headers.get("x-webhook-token") ?? "";
      return fallback.length > 0 && constantTimeEqual(fallback, this.webhookToken);
    }
    let manifest = dataId ? `id:${dataId};` : "";
    if (requestId) manifest += `request-id:${requestId};`;
    manifest += `ts:${ts};`;
    return constantTimeEqual(await hmacHex(this.webhookToken, manifest), v1);
  }

  async normalizeWebhook(payload: unknown, request: Request): Promise<NormalizedWebhookEvent> {
    const data = asJsonObject(payload);
    const url = new URL(request.url);
    const resourceId = url.searchParams.get("data.id") ?? readString(data, "data.id", "id");
    const eventId = readString(data, "id") ?? request.headers.get("x-request-id") ?? crypto.randomUUID();
    const action = (readString(data, "action", "type") ?? "unknown").toLowerCase();
    const status = (readString(data, "status", "data.status") ?? action).toLowerCase();
    const settled = /(approved|paid|settled)/i.test(status);
    const failed = /(rejected|cancelled|refunded|charged_back|failed)/i.test(status);
    return {
      provider: this.name,
      eventId,
      type: settled ? "payment_settled" : failed ? "payment_failed" : "payment_pending",
      resourceId,
      reference: readString(data, "external_reference", "data.external_reference", "metadata.reference"),
      amount: readNumber(data, "transaction_amount", "data.transaction_amount", "amount"),
      occurredAt: readString(data, "date_created", "date_approved", "created_at"),
      status,
      raw: data,
    };
  }
}

export class ContaAzulProvider implements PagamentoProvider {
  readonly name = "conta_azul" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly webhookToken: string | null;
  private readonly createPath: string;
  private readonly getPath: string;

  constructor(env: Env, private readonly dependencies: ProviderHttpDependencies) {
    this.baseUrl = (envValue(env, "CONTA_AZUL_BASE_URL") ?? "https://api-v2.contaazul.com").replace(/\/$/, "");
    this.apiKey = envValue(env, "CONTA_AZUL_API_KEY") ?? envValue(env, "CONTA_AZUL_ACCESS_TOKEN");
    this.webhookToken = envValue(env, "CONTA_AZUL_WEBHOOK_TOKEN");
    this.createPath = envValue(env, "CONTA_AZUL_CREATE_RECEIVABLE_PATH") ?? "/v1/financial/accounts-receivable";
    this.getPath = envValue(env, "CONTA_AZUL_GET_RECEIVABLE_PATH") ?? "/v1/financial/accounts-receivable/{id}";
  }

  isConfigured(): boolean { return Boolean(this.baseUrl && this.apiKey); }

  async createPayment(input: PaymentRequest, context: ProviderContext): Promise<PaymentResult> {
    validatePaymentInput(input);
    if (!this.apiKey) throw new Error("Conta Azul ainda não está configurada.");
    const payload = {
      description: input.description,
      value: input.amount,
      external_reference: input.reference,
      customer: {
        name: input.payer.name,
        document: input.payer.document,
        email: input.payer.email ?? null,
      },
      metadata: input.metadata ?? {},
    };
    const { data } = await providerFetch(
      `${this.baseUrl}${this.createPath}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "x-idempotency-key": input.reference },
        body: JSON.stringify(payload),
      },
      context,
      this.dependencies,
      "conta_azul.createReceivable",
    );
    const externalId = readString(data, "id", "data.id", "financial_event_id");
    if (!externalId) throw new Error("Conta Azul retornou um lançamento sem identificador.");
    return { provider: this.name, externalId, status: readString(data, "status", "data.status") ?? "created", checkoutUrl: null, raw: data };
  }

  async getPayment(externalId: string, context: ProviderContext): Promise<PaymentResult> {
    const id = requiredString(externalId, "identificador do lançamento", 200);
    if (!this.apiKey) throw new Error("Conta Azul ainda não está configurada.");
    const path = this.getPath.replace("{id}", encodeURIComponent(id));
    const { data } = await providerFetch(
      `${this.baseUrl}${path}`,
      { method: "GET", headers: { Authorization: `Bearer ${this.apiKey}` } },
      context,
      this.dependencies,
      "conta_azul.getReceivable",
    );
    return { provider: this.name, externalId: readString(data, "id", "data.id") ?? id, status: readString(data, "status", "data.status") ?? "unknown", checkoutUrl: null, raw: data };
  }

  async verifyWebhook(request: Request): Promise<boolean> {
    if (!this.webhookToken) return false;
    const supplied = request.headers.get("x-webhook-token")
      ?? request.headers.get("x-conta-azul-token")
      ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
      ?? "";
    return supplied.length > 0 && constantTimeEqual(supplied, this.webhookToken);
  }

  async normalizeWebhook(payload: unknown, request: Request): Promise<NormalizedWebhookEvent> {
    const data = asJsonObject(payload);
    const status = (readString(data, "status", "data.status", "event.status") ?? "unknown").toLowerCase();
    const settled = /(paid|received|settled|liquid|pago|recebido)/i.test(status);
    const failed = /(cancel|reject|fail|estorn)/i.test(status);
    return {
      provider: this.name,
      eventId: readString(data, "event_id", "id", "event.id") ?? request.headers.get("x-event-id") ?? crypto.randomUUID(),
      type: settled ? "payment_settled" : failed ? "payment_failed" : "payment_pending",
      resourceId: readString(data, "financial_event_id", "data.id", "resource.id"),
      reference: readString(data, "external_reference", "reference", "data.external_reference"),
      amount: readNumber(data, "value", "amount", "data.value"),
      occurredAt: readString(data, "created_at", "occurred_at", "timestamp"),
      status,
      raw: data,
    };
  }
}

export function createMercadoPagoProvider(env: Env, logger: StructuredLogger, dependencies: Omit<ProviderHttpDependencies, "logger"> = {}): PagamentoProvider {
  return new MercadoPagoProvider(env, { ...dependencies, logger: logger.child({ provider: "mercado_pago" }) });
}

export function createContaAzulProvider(env: Env, logger: StructuredLogger, dependencies: Omit<ProviderHttpDependencies, "logger"> = {}): PagamentoProvider {
  return new ContaAzulProvider(env, { ...dependencies, logger: logger.child({ provider: "conta_azul" }) });
}
