import { createServiceSupabaseClient, type Env } from "./supabase.js";
import {
  criarTokenAdmin,
  criarTokenSessao,
  getCookie,
  setAdminSessionCookie,
  setSessionCookie,
  clearAdminSessionCookie,
  clearSessionCookie,
  verificarTokenAdmin,
  verificarTokenSessao,
  verificarTokenStaff,
} from "./session.js";
import { agenda, agendar, agendarCirurgia, json as apiJson } from "./client-agenda.js";
import { clienteAgendamentoAcao, adminAgendamentoAcao } from "./agendamento-acoes.js";
import { handleClienteBoletos } from "./client-boletos.js";
import { adminVisaoGeral } from "./admin-visao-geral.js";
import { adminApi } from "./admin-api.js";
import { adminNotificacoes } from "./admin-notificacoes.js";
import { adminFinance } from "./admin-finance.js";
import { adminReports } from "./admin-reports.js";
import { monitoramentoErros } from "./monitoramento-erros.js";
import { creditOpsApi } from "./credit-ops.js";
import { journeyApi } from "./journey.js";
import { staffApi } from "./staff-api.js";
import { createLogger } from "./middleware/logger.js";
import type { Actor } from "./middleware/auth.js";
import { requireSameOrigin } from "./middleware/auth.js";
import { actorRateLimitKey, checkRateLimit, ipRateLimitKey, rateLimitResponse } from "./middleware/rateLimit.js";
import { paymentRoutes, processWebhookQueue } from "./routes/pagamentos.js";
import { clientPaymentRoutes } from "./routes/cliente-pagamentos.js";
import { clientIntegrationRoutes } from "./routes/clientes.js";
import { schedulingRoutes } from "./routes/agendamentos.js";
import { normalizeCpf, parseJsonObject, requiredString, validateBirthDate, validateEmail, ValidationError } from "./validation.js";
import { recordAudit, recordMetric } from "./observability.js";

const COOKIE_NAME = "cliente_session";
const ADMIN_COOKIE = "admin_session";
const STAFF_COOKIE = "staff_session";

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function formatCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function requestId(request: Request): string {
  return (request.headers.get("cf-ray") || request.headers.get("x-request-id") || crypto.randomUUID()).slice(0, 120);
}

async function actorFromRequest(request: Request, env: Env): Promise<Actor | null> {
  const secret = env.CLIENTE_SESSION_SECRET?.trim();
  if (!secret) return null;
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/admin/")) {
    const session = await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE), secret);
    return session ? { type: "admin", id: session.adminId } : null;
  }
  if (path.startsWith("/api/equipe/")) {
    const session = await verificarTokenStaff(getCookie(request, STAFF_COOKIE), secret);
    return session ? { type: "equipe", id: session.staffId, role: session.role } : null;
  }
  if (path.startsWith("/api/cliente/")) {
    const session = await verificarTokenSessao(getCookie(request, COOKIE_NAME), secret);
    return session ? { type: "cliente", id: session.clienteId } : null;
  }
  return null;
}

async function enforceRateLimits(request: Request, env: Env, logger: ReturnType<typeof createLogger>, actor: Actor | null): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/") || path === "/api/health") return null;
  const db = createServiceSupabaseClient(env);
  const isLogin = path.endsWith("/auth");
  const isWebhook = path.startsWith("/api/webhooks/");
  const ipPolicy = isLogin
    ? { scope: "login", limit: 8, windowSeconds: 900 }
    : isWebhook
      ? { scope: "webhook", limit: 240, windowSeconds: 60 }
      : { scope: "api", limit: 300, windowSeconds: 60 };
  const ipKey = await ipRateLimitKey(request, env, ipPolicy.scope);
  const ipDecision = await checkRateLimit(db, ipKey, ipPolicy, logger);
  if (!ipDecision.allowed) return rateLimitResponse(ipDecision);

  if (actor) {
    const actorPolicy = { scope: "actor", limit: 180, windowSeconds: 60 };
    const actorKey = await actorRateLimitKey(actor, env, actorPolicy.scope);
    const actorDecision = await checkRateLimit(db, actorKey, actorPolicy, logger);
    if (!actorDecision.allowed) return rateLimitResponse(actorDecision);
  }
  return null;
}

async function loginCliente(request: Request, env: Env, logger: ReturnType<typeof createLogger>, id: string): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const secret = env.CLIENTE_SESSION_SECRET?.trim();
  if (!secret) return json({ erro: "Serviço de autenticação temporariamente indisponível." }, 503);
  try {
    const body = await parseJsonObject(request);
    const cpf = normalizeCpf(body.cpf);
    const dataNascimento = validateBirthDate(body.dataNascimento);
    const db = createServiceSupabaseClient(env);
    const { data: cliente, error } = await db.from("clientes")
      .select("id,ativo")
      .in("cpf", [cpf, formatCpf(cpf)])
      .eq("data_nascimento", dataNascimento)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!cliente) return json({ erro: "CPF ou data de nascimento não encontrados. Confira os dados ou fale com a Sra. Luck." }, 401);
    if (!cliente.ativo) return json({ erro: "Seu acesso está temporariamente indisponível. Fale com a Sra. Luck." }, 403);
    const token = await criarTokenSessao(String(cliente.id), secret);
    const secure = new URL(request.url).protocol === "https:";
    await recordAudit(db, logger, { actor: { type: "cliente", id: String(cliente.id) }, action: "auth.login", entityType: "cliente", entityId: String(cliente.id), requestId: id });
    return json({ ok: true }, 200, { "Set-Cookie": setSessionCookie(token, secure) });
  } catch (error) {
    if (error instanceof ValidationError) return json({ erro: error.userMessage }, 400);
    logger.error("client_login_failed", error, { requestId: id });
    return json({ erro: "Não foi possível validar seu acesso agora. Tente novamente em instantes." }, 503);
  }
}

async function loginAdmin(request: Request, env: Env, logger: ReturnType<typeof createLogger>, id: string): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const secret = env.CLIENTE_SESSION_SECRET?.trim();
  if (!secret) return json({ erro: "Serviço de autenticação temporariamente indisponível." }, 503);
  try {
    const body = await parseJsonObject(request);
    const email = validateEmail(body.email);
    const senha = requiredString(body.senha, "senha", 1024);
    const db = createServiceSupabaseClient(env);
    const { data, error } = await db.auth.signInWithPassword({ email, password: senha });
    if (error || !data.session || !data.user) return json({ erro: "E-mail ou senha incorretos." }, 401);
    const token = await criarTokenAdmin(data.user.id, secret);
    const secure = new URL(request.url).protocol === "https:";
    await recordAudit(db, logger, { actor: { type: "admin", id: data.user.id }, action: "auth.login", entityType: "admin", entityId: data.user.id, requestId: id });
    return json({ ok: true }, 200, { "Set-Cookie": setAdminSessionCookie(token, secure) });
  } catch (error) {
    if (error instanceof ValidationError) return json({ erro: error.userMessage }, 400);
    logger.error("admin_login_failed", error, { requestId: id });
    return json({ erro: "Não foi possível validar o acesso administrativo agora." }, 503);
  }
}

async function dispatch(request: Request, env: Env, logger: ReturnType<typeof createLogger>, id: string): Promise<Response> {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";

  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, service: "sra-luck-api", runtime: "cloudflare-workers", supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY), integrationMode: env.INTEGRATION_MODE === "live" ? "live" : "mock" });
  }

  if (url.pathname === "/api/cliente/auth" && request.method === "POST") return loginCliente(request, env, logger, id);
  if (url.pathname === "/api/admin/auth" && request.method === "POST") return loginAdmin(request, env, logger, id);

  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    const secret = env.CLIENTE_SESSION_SECRET?.trim();
    if (!secret) return json({ autenticado: false }, 503);
    const session = await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE), secret);
    return json({ autenticado: Boolean(session) });
  }
  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    const originError = requireSameOrigin(request);
    if (originError) return originError;
    return json({ ok: true }, 200, { "Set-Cookie": clearAdminSessionCookie(secure) });
  }
  if (url.pathname === "/api/cliente/session" && request.method === "GET") {
    const secret = env.CLIENTE_SESSION_SECRET?.trim();
    if (!secret) return json({ autenticado: false }, 503);
    const session = await verificarTokenSessao(getCookie(request, COOKIE_NAME), secret);
    return json(session ? { autenticado: true, clienteId: session.clienteId } : { autenticado: false });
  }
  if (url.pathname === "/api/cliente/logout" && request.method === "POST") {
    const originError = requireSameOrigin(request);
    if (originError) return originError;
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(secure) });
  }

  const providerPayment = await paymentRoutes(request, env, logger, id);
  if (providerPayment) return providerPayment;
  const clientPayment = await clientPaymentRoutes(request, env, logger, id);
  if (clientPayment) return clientPayment;
  const clientIntegration = await clientIntegrationRoutes(request, env, logger, id);
  if (clientIntegration) return clientIntegration;
  const scheduling = await schedulingRoutes(request, env, logger, id);
  if (scheduling) return scheduling;

  const monitor = await monitoramentoErros(request, env);
  if (monitor) return monitor;
  const staff = await staffApi(request, env);
  if (staff) return staff;
  const creditOps = await creditOpsApi(request, env);
  if (creditOps) return creditOps;
  const journey = await journeyApi(request, env);
  if (journey) return journey;

  if (url.pathname === "/api/cliente/agenda" && request.method === "GET") return agenda(request, env);
  if (url.pathname === "/api/cliente/agendar" && request.method === "POST") {
    const originError = requireSameOrigin(request);
    if (originError) return originError;
    return agendar(request, env);
  }
  if (url.pathname === "/api/cliente/agendar-cirurgia" && request.method === "POST") {
    const originError = requireSameOrigin(request);
    if (originError) return originError;
    return agendarCirurgia(request, env);
  }

  const clienteAgendamento = await clienteAgendamentoAcao(request, env);
  if (clienteAgendamento) return clienteAgendamento;
  const adminAgendamento = await adminAgendamentoAcao(request, env);
  if (adminAgendamento) return adminAgendamento;

  if (url.pathname === "/api/cliente/boletos" && request.method === "GET") return handleClienteBoletos(request, env);
  const boletoMatch = url.pathname.match(/^\/api\/cliente\/boletos\/([^/]+)\/(anexar|arquivo|comprovante)$/);
  if (boletoMatch) {
    if (["POST", "DELETE"].includes(request.method)) {
      const originError = requireSameOrigin(request);
      if (originError) return originError;
    }
    return handleClienteBoletos(request, env, decodeURIComponent(boletoMatch[1]), boletoMatch[2] as "anexar" | "arquivo" | "comprovante");
  }

  if (url.pathname === "/api/admin/visao-geral" && request.method === "GET") {
    const secret = env.CLIENTE_SESSION_SECRET?.trim();
    if (!secret) return json({ erro: "Serviço de autenticação indisponível." }, 503);
    const session = await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE), secret);
    if (!session) return json({ erro: "Sua sessão administrativa expirou. Entre novamente." }, 401);
    return adminVisaoGeral(request, env);
  }

  const notif = await adminNotificacoes(request, env);
  if (notif) return notif;
  const finance = await adminFinance(request, env);
  if (finance) return finance;
  const reports = await adminReports(request, env);
  if (reports) return reports;
  const adminResponse = await adminApi(request, env);
  if (adminResponse) return adminResponse;

  return apiJson({ ok: false, error: "ROTA_NAO_ENCONTRADA", message: "A API solicitada não existe." }, 404);
}

async function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const id = requestId(request);
  const startedAt = Date.now();
  const baseLogger = createLogger({ service: "sra-luck-worker", requestId: id, route: new URL(request.url).pathname, method: request.method });
  let actor: Actor | null = null;
  let response: Response;

  try {
    actor = await actorFromRequest(request, env);
    const limited = await enforceRateLimits(request, env, baseLogger, actor);
    response = limited ?? await dispatch(request, env, baseLogger, id);
  } catch (error) {
    baseLogger.error("unhandled_request_error", error);
    response = json({ erro: "Ocorreu uma falha inesperada. Tente novamente em instantes." }, 500);
  }

  const durationMs = Date.now() - startedAt;
  baseLogger.info("request_completed", { status: response.status, durationMs, actorType: actor?.type, actorId: actor?.id });
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && new URL(request.url).pathname.startsWith("/api/")) {
    try {
      const db = createServiceSupabaseClient(env);
      ctx.waitUntil(recordMetric(db, baseLogger, {
        requestId: id,
        route: new URL(request.url).pathname,
        method: request.method,
        statusCode: response.status,
        durationMs,
        actor,
      }));
    } catch (error) {
      baseLogger.error("metric_schedule_failed", error);
    }
  }
  return response;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleFetch(request, env, ctx);
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const logger = createLogger({ service: "sra-luck-worker", operation: "webhook_queue_cron" });
    ctx.waitUntil(processWebhookQueue(env, logger, 50));
  },
} satisfies ExportedHandler<Env>;
