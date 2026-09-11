import type { Env } from "../supabase.js";
import { requireAdmin, requireSameOrigin } from "../middleware/auth.js";
import type { StructuredLogger } from "../middleware/logger.js";
import { ProviderFactory } from "../providers/factory.js";
import { asJsonObject } from "../providers/http.js";
import { optionalString, parseJsonObject, requiredString, validateEmail, validateMoney, ValidationError } from "../validation.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function clientIntegrationRoutes(request: Request, env: Env, logger: StructuredLogger, requestId: string): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/providers/rd/sync-client") return null;
  if (request.method !== "POST") return json({ erro: "Método não permitido." }, 405);
  const origin = requireSameOrigin(request);
  if (origin) return origin;
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const body = await parseJsonObject(request);
    const result = await new ProviderFactory(env, logger).rd().upsertLead({
      externalId: optionalString(body.externalId, "identificador externo", 200),
      name: requiredString(body.name, "nome", 200),
      email: body.email ? validateEmail(body.email) : null,
      phone: optionalString(body.phone, "telefone", 30),
      document: optionalString(body.document, "documento", 30),
      campaign: optionalString(body.campaign, "campanha", 200),
      source: optionalString(body.source, "origem", 200),
      value: body.value === undefined ? null : validateMoney(body.value, "valor"),
      metadata: asJsonObject(body.metadata),
    }, { requestId, actorType: auth.actor.type, actorId: auth.actor.id });
    return json({ sincronizado: true, rd: result });
  } catch (error) {
    logger.error("rd_sync_client_failed", error, { requestId });
    if (error instanceof ValidationError) return json({ erro: error.userMessage }, 400);
    return json({ erro: "Não foi possível sincronizar os dados com o RD Station agora." }, 502);
  }
}
