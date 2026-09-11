import type { Env } from "../supabase.js";
import { requiredString, validateIsoDate, validateMoney, normalizeCpf, validateEmail } from "../validation.js";
import type { StructuredLogger } from "../middleware/logger.js";
import type {
  BancoProvider,
  BankProviderName,
  ChargeRequest,
  ChargeResult,
  JsonObject,
  NormalizedWebhookEvent,
  ProviderContext,
} from "./types.js";
import { asJsonObject, envValue, providerFetch, readNumber, readString, type ProviderHttpDependencies } from "./http.js";

interface BankRuntimeConfig {
  name: BankProviderName;
  baseUrl: string;
  authMode: "api_key" | "bearer" | "oauth2_client_credentials";
  apiKey?: string | null;
  apiKeyHeader: string;
  tokenUrl?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  scope?: string | null;
  createPath: string;
  getPath: string;
  webhookToken?: string | null;
  idField: string;
  statusField: string;
  barcodeField: string;
  digitableLineField: string;
  urlField: string;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function providerPrefix(name: BankProviderName): string {
  return `BANCO_${name === "bb" ? "BB" : name.toUpperCase()}`;
}

function bankConfig(name: BankProviderName, env: Env): BankRuntimeConfig {
  const prefix = providerPrefix(name);
  const baseUrl = envValue(env, `${prefix}_BASE_URL`) ?? "";
  const authRaw = envValue(env, `${prefix}_AUTH_MODE`) ?? "api_key";
  const authMode: BankRuntimeConfig["authMode"] = authRaw === "oauth2_client_credentials" || authRaw === "bearer" ? authRaw : "api_key";
  return {
    name,
    baseUrl: baseUrl.replace(/\/$/, ""),
    authMode,
    apiKey: envValue(env, `${prefix}_API_KEY`),
    apiKeyHeader: envValue(env, `${prefix}_API_KEY_HEADER`) ?? "x-api-key",
    tokenUrl: envValue(env, `${prefix}_TOKEN_URL`),
    clientId: envValue(env, `${prefix}_CLIENT_ID`),
    clientSecret: envValue(env, `${prefix}_CLIENT_SECRET`),
    scope: envValue(env, `${prefix}_SCOPE`),
    createPath: envValue(env, `${prefix}_CREATE_CHARGE_PATH`) ?? "/charges",
    getPath: envValue(env, `${prefix}_GET_CHARGE_PATH`) ?? "/charges/{id}",
    webhookToken: envValue(env, `${prefix}_WEBHOOK_TOKEN`),
    idField: envValue(env, `${prefix}_FIELD_ID`) ?? "id",
    statusField: envValue(env, `${prefix}_FIELD_STATUS`) ?? "status",
    barcodeField: envValue(env, `${prefix}_FIELD_BARCODE`) ?? "barcode",
    digitableLineField: envValue(env, `${prefix}_FIELD_DIGITABLE_LINE`) ?? "digitable_line",
    urlField: envValue(env, `${prefix}_FIELD_PAYMENT_URL`) ?? "payment_url",
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

export class ConfigurableBankProvider implements BancoProvider {
  readonly name: BankProviderName;
  private readonly config: BankRuntimeConfig;

  constructor(
    name: BankProviderName,
    env: Env,
    private readonly dependencies: ProviderHttpDependencies,
  ) {
    this.name = name;
    this.config = bankConfig(name, env);
  }

  isConfigured(): boolean {
    if (!this.config.baseUrl) return false;
    if (this.config.authMode === "oauth2_client_credentials") return Boolean(this.config.tokenUrl && this.config.clientId && this.config.clientSecret);
    return Boolean(this.config.apiKey);
  }

  async createCharge(input: ChargeRequest, context: ProviderContext): Promise<ChargeResult> {
    this.validateInput(input);
    this.ensureConfigured();
    const headers = await this.authorizationHeaders(context);
    const payload = {
      reference: input.reference,
      amount: input.amount,
      due_date: input.dueDate,
      description: input.description,
      customer: {
        name: input.customer.name,
        document: input.customer.document,
        email: input.customer.email ?? null,
        phone: input.customer.phone ?? null,
      },
      metadata: input.metadata ?? {},
    };
    const { data } = await providerFetch(
      `${this.config.baseUrl}${this.config.createPath}`,
      { method: "POST", headers: { ...headers, "Content-Type": "application/json", "x-idempotency-key": input.reference }, body: JSON.stringify(payload) },
      context,
      this.dependencies,
      `${this.name}.createCharge`,
    );
    return this.adaptCharge(data, input.amount, input.dueDate);
  }

  async getCharge(externalId: string, context: ProviderContext): Promise<ChargeResult> {
    const id = requiredString(externalId, "identificador da cobrança", 200);
    this.ensureConfigured();
    const headers = await this.authorizationHeaders(context);
    const path = this.config.getPath.replace("{id}", encodeURIComponent(id));
    const { data } = await providerFetch(
      `${this.config.baseUrl}${path}`,
      { method: "GET", headers },
      context,
      this.dependencies,
      `${this.name}.getCharge`,
    );
    return this.adaptCharge(data, readNumber(data, "amount", "value", "valor") ?? 0, readString(data, "due_date", "dueDate", "vencimento"));
  }

  async verifyWebhook(request: Request): Promise<boolean> {
    if (!this.config.webhookToken) return false;
    const supplied = request.headers.get("x-webhook-token")
      ?? request.headers.get("x-api-key")
      ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
      ?? "";
    return supplied.length > 0 && constantTimeEqual(supplied, this.config.webhookToken);
  }

  async normalizeWebhook(payload: unknown, request: Request): Promise<NormalizedWebhookEvent> {
    const data = asJsonObject(payload);
    const eventId = readString(data, "event_id", "eventId", "id")
      ?? request.headers.get("x-event-id")
      ?? crypto.randomUUID();
    const resourceId = readString(data, "charge_id", "chargeId", "resource.id", "data.id", this.config.idField);
    const reference = readString(data, "reference", "external_reference", "data.reference", "metadata.reference");
    const status = (readString(data, "status", "data.status", this.config.statusField) ?? "unknown").toLowerCase();
    const amount = readNumber(data, "amount", "value", "data.amount", "valor");
    const settled = /(paid|settled|liquid|recebid|confirmad|pago)/i.test(status);
    const failed = /(fail|cancel|reject|recus|estorn)/i.test(status);
    return {
      provider: this.name,
      eventId,
      type: settled ? "payment_settled" : failed ? "payment_failed" : "charge_updated",
      resourceId,
      reference,
      amount,
      occurredAt: readString(data, "occurred_at", "created_at", "date_created", "data.created_at"),
      status,
      raw: data,
    };
  }

  private validateInput(input: ChargeRequest): void {
    requiredString(input.reference, "referência", 160);
    validateMoney(input.amount, "valor da cobrança");
    validateIsoDate(input.dueDate, "data de vencimento");
    requiredString(input.description, "descrição", 500);
    requiredString(input.customer.name, "nome da cliente", 200);
    normalizeCpf(input.customer.document);
    if (input.customer.email) validateEmail(input.customer.email);
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) throw new Error(`O provider bancário ${this.name.toUpperCase()} ainda não possui configuração completa.`);
  }

  private async authorizationHeaders(context: ProviderContext): Promise<Record<string, string>> {
    if (this.config.authMode === "oauth2_client_credentials") {
      return { Authorization: `Bearer ${await this.oauthToken(context)}` };
    }
    if (!this.config.apiKey) throw new Error("Credencial bancária não configurada.");
    return this.config.authMode === "bearer"
      ? { Authorization: `Bearer ${this.config.apiKey}` }
      : { [this.config.apiKeyHeader]: this.config.apiKey };
  }

  private async oauthToken(context: ProviderContext): Promise<string> {
    const cacheKey = `${this.name}:${this.config.clientId ?? ""}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
    if (!this.config.tokenUrl || !this.config.clientId || !this.config.clientSecret) throw new Error("OAuth do banco não está configurado.");
    const form = new URLSearchParams({ grant_type: "client_credentials" });
    if (this.config.scope) form.set("scope", this.config.scope);
    const authorization = btoa(`${this.config.clientId}:${this.config.clientSecret}`);
    const { data } = await providerFetch(
      this.config.tokenUrl,
      { method: "POST", headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/x-www-form-urlencoded", "x-idempotency-key": context.requestId }, body: form.toString() },
      context,
      this.dependencies,
      `${this.name}.oauthToken`,
    );
    const token = readString(data, "access_token", "token");
    if (!token) throw new Error("O banco não retornou um token de acesso válido.");
    const expiresIn = Math.min(86_400, Math.max(60, readNumber(data, "expires_in") ?? 300));
    tokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresIn * 1000 });
    return token;
  }

  private adaptCharge(data: JsonObject, fallbackAmount: number, fallbackDueDate?: string | null): ChargeResult {
    const externalId = readString(data, this.config.idField, "charge.id", "data.id", "external_id");
    if (!externalId) throw new Error("O banco retornou uma cobrança sem identificador.");
    return {
      provider: this.name,
      externalId,
      status: readString(data, this.config.statusField, "charge.status", "data.status") ?? "created",
      amount: readNumber(data, "amount", "value", "valor", "charge.amount", "data.amount") ?? fallbackAmount,
      dueDate: readString(data, "due_date", "dueDate", "vencimento", "charge.due_date") ?? fallbackDueDate ?? null,
      barcode: readString(data, this.config.barcodeField, "charge.barcode", "data.barcode"),
      digitableLine: readString(data, this.config.digitableLineField, "digitableLine", "linha_digitavel"),
      paymentUrl: readString(data, this.config.urlField, "url", "charge.url", "data.url"),
      raw: data,
    };
  }
}

export function createBankProvider(name: BankProviderName, env: Env, logger: StructuredLogger, dependencies: Omit<ProviderHttpDependencies, "logger"> = {}): BancoProvider {
  return new ConfigurableBankProvider(name, env, { ...dependencies, logger: logger.child({ provider: name }) });
}
