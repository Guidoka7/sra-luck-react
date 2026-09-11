import type { Env } from "../supabase.js";
import { createServiceSupabaseClient } from "../supabase.js";
import { requireClient, requireSameOrigin } from "../middleware/auth.js";
import type { StructuredLogger } from "../middleware/logger.js";
import { ProviderFactory } from "../providers/factory.js";
import { parseJsonObject, validateMoney, validateUuid, ValidationError } from "../validation.js";
import { recordAudit } from "../observability.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function appUrl(request: Request, env: Env): string {
  const configured = env.PUBLIC_APP_URL?.trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { return new URL(request.url).origin; }
  }
  return new URL(request.url).origin;
}

export async function clientPaymentRoutes(request: Request, env: Env, logger: StructuredLogger, requestId: string): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/api/cliente/payments/mercado-pago/preference") return null;
  if (request.method !== "POST") return json({ erro: "Método não permitido." }, 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = await requireClient(request, env);
  if (!auth.ok) return auth.response;

  try {
    const body = await parseJsonObject(request);
    const boletoId = validateUuid(body.boletoId, "parcela");
    const db = createServiceSupabaseClient(env);
    const { data: boleto, error: boletoError } = await db.from("boletos")
      .select("id,cliente_id,contrato_credito_id,numero_parcela,total_parcelas,valor,status")
      .eq("id", boletoId)
      .eq("cliente_id", auth.actor.id)
      .maybeSingle();
    if (boletoError) throw boletoError;
    if (!boleto) return json({ erro: "Parcela não encontrada." }, 404);
    if (boleto.status === "pago") return json({ erro: "Esta parcela já está paga." }, 409);

    const { data: cliente, error: clienteError } = await db.from("clientes")
      .select("nome_completo,cpf,email,telefone")
      .eq("id", auth.actor.id)
      .maybeSingle();
    if (clienteError) throw clienteError;
    if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);

    const base = appUrl(request, env);
    const result = await new ProviderFactory(env, logger).payment("mercado_pago").createPayment({
      reference: `boleto:${boleto.id}`,
      amount: validateMoney(boleto.valor, "valor da parcela"),
      description: `Sra. Luck — Parcela ${boleto.numero_parcela}/${boleto.total_parcelas ?? ""}`,
      payer: {
        name: String(cliente.nome_completo ?? "Cliente"),
        document: String(cliente.cpf ?? ""),
        email: cliente.email ? String(cliente.email) : null,
        phone: cliente.telefone ? String(cliente.telefone) : null,
      },
      successUrl: `${base}/agenda?pagamento=sucesso`,
      pendingUrl: `${base}/agenda?pagamento=pendente`,
      failureUrl: `${base}/agenda?pagamento=falha`,
      notificationUrl: `${base}/api/webhooks/mercado_pago`,
      metadata: { boletoId: boleto.id, clienteId: auth.actor.id, contratoId: boleto.contrato_credito_id ?? null },
    }, { requestId, actorType: auth.actor.type, actorId: auth.actor.id });

    const { error: linkError } = await db.from("integracao_vinculos").upsert({
      entidade_tipo: "parcela",
      entidade_id: boleto.id,
      provedor: "mercado_pago",
      external_id: result.externalId,
      metadata: { status: result.status },
      updated_at: new Date().toISOString(),
    }, { onConflict: "entidade_tipo,entidade_id,provedor" });
    if (linkError) throw linkError;

    await recordAudit(db, logger, {
      actor: auth.actor,
      action: "payment.checkout.create",
      entityType: "boleto",
      entityId: boleto.id,
      requestId,
      metadata: { provider: "mercado_pago", externalId: result.externalId },
    });
    return json({ preferenceId: result.externalId, checkoutUrl: result.checkoutUrl });
  } catch (error) {
    logger.error("client_checkout_failed", error, { requestId, actorId: auth.actor.id });
    if (error instanceof ValidationError) return json({ erro: error.userMessage }, 400);
    return json({ erro: "Não foi possível abrir o pagamento por cartão agora. Tente novamente em instantes." }, 502);
  }
}
