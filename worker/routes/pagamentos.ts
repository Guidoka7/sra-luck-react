import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../supabase.js";
import { createServiceSupabaseClient } from "../supabase.js";
import { requireAdmin, requireSameOrigin } from "../middleware/auth.js";
import type { StructuredLogger } from "../middleware/logger.js";
import { ProviderFactory } from "../providers/factory.js";
import type { BankProviderName, JsonObject, NormalizedWebhookEvent, PaymentProviderName, ProviderContext, ProviderName } from "../providers/types.js";
import { asJsonObject } from "../providers/http.js";
import { normalizeCpf, optionalString, parseJsonObject, requiredString, validateEmail, validateIsoDate, validateMoney, validateUuid, ValidationError } from "../validation.js";
import { recordAudit } from "../observability.js";

interface QueueRow {
  id: string;
  provider: ProviderName;
  event_id: string;
  request_url: string;
  headers: JsonObject;
  payload: JsonObject;
  attempts: number;
}

const BANKS = new Set<BankProviderName>(["brb", "bb", "santander", "sicredi", "efi"]);
const PAYMENTS = new Set<PaymentProviderName>(["mercado_pago", "conta_azul"]);

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function safeHeaders(request: Request): JsonObject {
  const allowed = ["x-signature", "x-request-id", "x-event-id", "x-webhook-token", "x-rd-webhook-token", "x-rd-webhook-key", "x-sra-luck-rd-key", "x-conta-azul-token"];
  const output: JsonObject = {};
  for (const key of allowed) {
    const value = request.headers.get(key);
    if (value) output[key] = value.slice(0, 2000);
  }
  return output;
}

function eventIdFromPayload(payload: JsonObject, request: Request): string {
  const value = payload.event_id ?? payload.eventId ?? payload.id;
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const queryId = new URL(request.url).searchParams.get("data.id");
  return (queryId || request.headers.get("x-event-id") || request.headers.get("x-request-id") || crypto.randomUUID()).slice(0, 240);
}

function context(requestId: string, actorType?: string, actorId?: string): ProviderContext {
  return { requestId, actorType, actorId };
}

function userError(error: unknown): { message: string; status: number } {
  if (error instanceof ValidationError) return { message: error.userMessage, status: 400 };
  return { message: "Não foi possível concluir a operação com o provedor. Tente novamente em instantes.", status: 502 };
}

async function providerForWebhook(factory: ProviderFactory, provider: string) {
  if (BANKS.has(provider as BankProviderName)) return factory.bank(provider as BankProviderName);
  if (PAYMENTS.has(provider as PaymentProviderName)) return factory.payment(provider as PaymentProviderName);
  if (provider === "rd_station") return factory.rd();
  return null;
}

export async function paymentRoutes(request: Request, env: Env, logger: StructuredLogger, requestId: string): Promise<Response | null> {
  const url = new URL(request.url);
  const factory = new ProviderFactory(env, logger);

  if (url.pathname === "/api/providers/health" && request.method === "GET") {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return auth.response;
    return json({ providers: factory.summary() });
  }

  const bankCharge = url.pathname.match(/^\/api\/providers\/banks\/(brb|bb|santander|sicredi|efi)\/charges$/);
  if (bankCharge && request.method === "POST") {
    const origin = requireSameOrigin(request);
    if (origin) return origin;
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return auth.response;
    try {
      const body = await parseJsonObject(request);
      const customerRaw = asJsonObject(body.customer);
      const providerName = bankCharge[1] as BankProviderName;
      const result = await factory.bank(providerName).createCharge({
        reference: requiredString(body.reference, "referência", 160),
        amount: validateMoney(body.amount, "valor da cobrança"),
        dueDate: validateIsoDate(body.dueDate, "data de vencimento"),
        description: requiredString(body.description, "descrição", 500),
        customer: {
          name: requiredString(customerRaw.name, "nome da cliente", 200),
          document: normalizeCpf(customerRaw.document),
          email: customerRaw.email ? validateEmail(customerRaw.email) : null,
          phone: optionalString(customerRaw.phone, "telefone", 30),
        },
        metadata: asJsonObject(body.metadata),
      }, context(requestId, auth.actor.type, auth.actor.id));
      const db = createServiceSupabaseClient(env);
      await recordAudit(db, logger, { actor: auth.actor, action: "provider.bank.create_charge", entityType: "external_charge", entityId: result.externalId, requestId, metadata: { provider: providerName, reference: result.raw.reference ?? null } });
      return json({ cobranca: result }, 201);
    } catch (error) {
      logger.error("bank_charge_failed", error, { provider: bankCharge[1], requestId });
      const failure = userError(error);
      return json({ erro: failure.message }, failure.status);
    }
  }

  const paymentCreate = url.pathname.match(/^\/api\/providers\/payments\/(mercado_pago|conta_azul)$/);
  if (paymentCreate && request.method === "POST") {
    const origin = requireSameOrigin(request);
    if (origin) return origin;
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return auth.response;
    try {
      const body = await parseJsonObject(request);
      const payer = asJsonObject(body.payer);
      const providerName = paymentCreate[1] as PaymentProviderName;
      const result = await factory.payment(providerName).createPayment({
        reference: requiredString(body.reference, "referência", 160),
        amount: validateMoney(body.amount, "valor"),
        description: requiredString(body.description, "descrição", 500),
        payer: {
          name: requiredString(payer.name, "nome", 200),
          document: normalizeCpf(payer.document),
          email: payer.email ? validateEmail(payer.email) : null,
          phone: optionalString(payer.phone, "telefone", 30),
        },
        successUrl: optionalString(body.successUrl, "URL de sucesso", 1000),
        pendingUrl: optionalString(body.pendingUrl, "URL de pendência", 1000),
        failureUrl: optionalString(body.failureUrl, "URL de falha", 1000),
        notificationUrl: optionalString(body.notificationUrl, "URL de notificação", 1000),
        metadata: asJsonObject(body.metadata),
      }, context(requestId, auth.actor.type, auth.actor.id));
      return json({ pagamento: result }, 201);
    } catch (error) {
      logger.error("payment_provider_create_failed", error, { provider: paymentCreate[1], requestId });
      const failure = userError(error);
      return json({ erro: failure.message }, failure.status);
    }
  }

  const webhook = url.pathname.match(/^\/api\/webhooks\/(rd_station|mercado_pago|conta_azul|brb|bb|santander|sicredi|efi)$/);
  if (webhook && request.method === "POST") {
    const providerName = webhook[1];
    const provider = await providerForWebhook(factory, providerName);
    if (!provider) return json({ erro: "Provedor de webhook inválido." }, 404);
    if (!(await provider.verifyWebhook(request))) {
      logger.warn("webhook_unauthorized", { provider: providerName, requestId });
      return json({ erro: "Assinatura do webhook inválida." }, 401);
    }
    let payload: JsonObject;
    try { payload = await parseJsonObject(request); } catch (error) {
      const failure = userError(error);
      return json({ erro: failure.message }, failure.status);
    }
    const eventId = eventIdFromPayload(payload, request);
    const db = createServiceSupabaseClient(env);
    const { data, error } = await db.from("webhook_queue").upsert({
      provider: providerName,
      event_id: eventId,
      event_type: typeof payload.type === "string" ? payload.type.slice(0, 160) : "webhook",
      request_url: request.url.slice(0, 2000),
      headers: safeHeaders(request),
      payload,
      status: "pendente",
      next_attempt_at: new Date().toISOString(),
    }, { onConflict: "provider,event_id", ignoreDuplicates: true }).select("id,status").maybeSingle();
    if (error) {
      logger.error("webhook_queue_write_failed", error, { provider: providerName, requestId });
      return json({ erro: "Não foi possível registrar o evento agora. O provedor pode reenviar a notificação." }, 503, { "Retry-After": "10" });
    }
    logger.info("webhook_queued", { provider: providerName, requestId, status: data?.status ?? "duplicado" });
    return json({ recebido: true, filaId: data?.id ?? null }, 202);
  }

  return null;
}

function rowFromUnknown(value: unknown): QueueRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const provider = String(row.provider ?? "") as ProviderName;
  if (!row.id || !provider || !row.event_id || !row.request_url) return null;
  return {
    id: String(row.id),
    provider,
    event_id: String(row.event_id),
    request_url: String(row.request_url),
    headers: asJsonObject(row.headers),
    payload: asJsonObject(row.payload),
    attempts: Number(row.attempts ?? 1),
  };
}

function requestFromQueue(row: QueueRow): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const [key, value] of Object.entries(row.headers)) if (typeof value === "string") headers.set(key, value);
  return new Request(row.request_url, { method: "POST", headers, body: JSON.stringify(row.payload) });
}

async function applyNormalizedEvent(db: SupabaseClient, event: NormalizedWebhookEvent, logger: StructuredLogger): Promise<void> {
  const { error: eventError } = await db.from("integracao_eventos").upsert({
    provedor: event.provider,
    event_id: event.eventId,
    event_type: event.type,
    referencia: event.reference ?? event.resourceId ?? null,
    payload: event.raw,
    status: "processado",
    processado_em: new Date().toISOString(),
  }, { onConflict: "provedor,event_id", ignoreDuplicates: true });
  if (eventError) throw eventError;

  if (event.type !== "payment_settled" && event.type !== "payment_failed") return;
  let boletoId: string | null = null;
  if (event.reference?.startsWith("boleto:")) boletoId = event.reference.slice(7);
  else if (event.reference && /^[0-9a-f-]{36}$/i.test(event.reference)) boletoId = event.reference;
  if (!boletoId && event.resourceId) {
    const { data: vinculo, error } = await db.from("integracao_vinculos")
      .select("entidade_id")
      .eq("provedor", event.provider)
      .eq("external_id", event.resourceId)
      .eq("entidade_tipo", "parcela")
      .maybeSingle();
    if (error) throw error;
    boletoId = vinculo?.entidade_id ? String(vinculo.entidade_id) : null;
  }
  if (!boletoId) {
    logger.warn("webhook_without_internal_reference", { provider: event.provider, eventId: event.eventId });
    return;
  }
  validateUuid(boletoId, "parcela");
  const { data: boleto, error: boletoError } = await db.from("boletos").select("id,cliente_id,contrato_credito_id,valor,status").eq("id", boletoId).maybeSingle();
  if (boletoError) throw boletoError;
  if (!boleto) return;
  const settled = event.type === "payment_settled";
  const now = new Date().toISOString();
  const amount = event.amount === null || event.amount === undefined ? Number(boleto.valor ?? 0) : validateMoney(event.amount, "valor recebido");
  const { error: updateError } = await db.from("boletos").update(settled ? {
    status: "pago",
    valor_recebido: amount,
    recebido_em: now,
    data_pagamento: now.slice(0, 10),
    origem_baixa: event.provider,
  } : { status: "rejeitado", observacoes: `Evento ${event.provider}: ${event.status ?? "falha"}` }).eq("id", boletoId);
  if (updateError) throw updateError;
  const { error: reconciliationError } = await db.from("conciliacao_financeira_eventos").insert({
    boleto_id: boletoId,
    contrato_credito_id: boleto.contrato_credito_id ?? null,
    origem: event.provider,
    tipo: settled ? "baixa_automatica" : "falha_pagamento",
    valor: amount,
    metadata: { eventId: event.eventId, status: event.status ?? null },
  });
  if (reconciliationError) throw reconciliationError;
}

export async function processWebhookQueue(env: Env, logger: StructuredLogger, limit = 25): Promise<void> {
  const db = createServiceSupabaseClient(env);
  const batchSize = Math.min(100, Math.max(1, Math.trunc(limit)));
  const { data, error } = await db.rpc("dequeue_webhook_events", { p_limit: batchSize });
  if (error) {
    logger.error("webhook_queue_dequeue_failed", error);
    return;
  }
  const factory = new ProviderFactory(env, logger);
  const rows = (Array.isArray(data) ? data : []).map(rowFromUnknown).filter((row): row is QueueRow => row !== null);
  for (const row of rows) {
    try {
      const provider = await providerForWebhook(factory, row.provider);
      if (!provider) throw new Error("Provider da fila não é reconhecido.");
      const request = requestFromQueue(row);
      const normalized = await provider.normalizeWebhook(row.payload, request);
      await applyNormalizedEvent(db, normalized, logger);
      const { error: doneError } = await db.from("webhook_queue").update({ status: "processado", processed_at: new Date().toISOString(), locked_at: null, last_error: null }).eq("id", row.id);
      if (doneError) throw doneError;
      logger.info("webhook_processed", { provider: row.provider, eventId: row.event_id, attempt: row.attempts });
    } catch (error) {
      const terminal = row.attempts >= 10;
      const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(row.attempts, 7));
      const next = new Date(Date.now() + delaySeconds * 1000).toISOString();
      await db.from("webhook_queue").update({
        status: terminal ? "falhou" : "pendente",
        last_error: error instanceof Error ? error.message.slice(0, 1000) : "Falha desconhecida",
        next_attempt_at: next,
        locked_at: null,
      }).eq("id", row.id);
      logger.error("webhook_processing_failed", error, { provider: row.provider, eventId: row.event_id, attempt: row.attempts, terminal });
    }
  }
}
