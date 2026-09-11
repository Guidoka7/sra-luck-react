import type { Env } from "../supabase.js";
import { normalizeCpf, requiredString, validateEmail, validateMoney } from "../validation.js";
import type { StructuredLogger } from "../middleware/logger.js";
import type { LeadInput, LeadResult, NormalizedWebhookEvent, ProviderContext, RDProvider } from "./types.js";
import { asJsonObject, envValue, providerFetch, readNumber, readString, type ProviderHttpDependencies } from "./http.js";

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

export class HttpRDProvider implements RDProvider {
  readonly name = "rd_station" as const;
  private readonly baseUrl: string;
  private readonly accessToken: string | null;
  private readonly webhookToken: string | null;
  private readonly upsertPath: string;

  constructor(
    env: Env,
    private readonly dependencies: ProviderHttpDependencies,
  ) {
    this.baseUrl = (envValue(env, "RD_STATION_BASE_URL") ?? "https://api.rd.services").replace(/\/$/, "");
    this.accessToken = envValue(env, "RD_STATION_API_KEY") ?? envValue(env, "RD_API_ACCESS_TOKEN");
    this.webhookToken = envValue(env, "RD_STATION_WEBHOOK_TOKEN") ?? envValue(env, "RD_WEBHOOK_SECRET");
    this.upsertPath = envValue(env, "RD_STATION_UPSERT_PATH") ?? "/platform/contacts";
  }

  isConfigured(): boolean { return Boolean(this.baseUrl && this.accessToken); }

  async upsertLead(input: LeadInput, context: ProviderContext): Promise<LeadResult> {
    this.validateInput(input);
    if (!this.isConfigured() || !this.accessToken) throw new Error("RD Station ainda não está configurado.");
    const payload = {
      uuid: input.externalId ?? undefined,
      name: input.name,
      email: input.email ?? undefined,
      mobile_phone: input.phone ?? undefined,
      cf_cpf: input.document ?? undefined,
      cf_campanha: input.campaign ?? undefined,
      cf_origem: input.source ?? undefined,
      cf_valor_contrato: input.value ?? undefined,
      ...input.metadata,
    };
    const { data } = await providerFetch(
      `${this.baseUrl}${this.upsertPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          "x-idempotency-key": input.externalId ?? context.requestId,
        },
        body: JSON.stringify(payload),
      },
      context,
      this.dependencies,
      "rd_station.upsertLead",
    );
    const externalId = readString(data, "uuid", "id", "contact.uuid", "data.uuid");
    if (!externalId) throw new Error("O RD Station não retornou o identificador do contato.");
    return { provider: this.name, externalId, status: readString(data, "status") ?? "synced", raw: data };
  }

  async verifyWebhook(request: Request): Promise<boolean> {
    if (!this.webhookToken) return false;
    const supplied = request.headers.get("x-rd-webhook-token")
      ?? request.headers.get("x-rd-webhook-key")
      ?? request.headers.get("x-sra-luck-rd-key")
      ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
      ?? "";
    return supplied.length > 0 && constantTimeEqual(supplied, this.webhookToken);
  }

  async normalizeWebhook(payload: unknown, request: Request): Promise<NormalizedWebhookEvent> {
    const data = asJsonObject(payload);
    const eventName = (readString(data, "event_name", "event", "type") ?? "unknown").toLowerCase();
    const eventId = readString(data, "transaction_uuid", "event_id", "id")
      ?? request.headers.get("x-event-id")
      ?? crypto.randomUUID();
    const resourceId = readString(data, "document.id", "document.uuid", "data.id", "contact.uuid");
    const reference = readString(data, "document.deal_id", "deal_id", "data.deal_id", "reference");
    const amount = readNumber(data, "document.amount", "document.value", "amount", "value");
    const won = /(won|ganh|venda|converted|convertid)/i.test(eventName);
    const created = /(created|new|novo|criado)/i.test(eventName);
    return {
      provider: this.name,
      eventId,
      type: won ? "deal_won" : created ? "lead_created" : "lead_updated",
      resourceId,
      reference,
      amount,
      occurredAt: readString(data, "created_at", "timestamp", "event_timestamp"),
      status: eventName,
      raw: data,
    };
  }

  private validateInput(input: LeadInput): void {
    requiredString(input.name, "nome", 200);
    if (input.email) validateEmail(input.email);
    if (input.document) normalizeCpf(input.document);
    if (input.value !== null && input.value !== undefined) validateMoney(input.value, "valor do negócio");
  }
}

export function createRDProvider(env: Env, logger: StructuredLogger, dependencies: Omit<ProviderHttpDependencies, "logger"> = {}): RDProvider {
  return new HttpRDProvider(env, { ...dependencies, logger: logger.child({ provider: "rd_station" }) });
}
