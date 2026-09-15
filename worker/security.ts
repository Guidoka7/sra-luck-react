import { createServiceSupabaseClient, type Env } from "./supabase";
import { clearSessionCookie, getCookie, verificarTokenSessao } from "./session";
import { pseudonymizeActorId, requestLogger } from "./logger";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const COOKIE_API_PREFIXES = ["/api/cliente/", "/api/admin/", "/api/equipe/"];
const EXTERNAL_MUTATION_PATHS = new Set([
  "/api/integrations/mercado-pago/webhook",
  "/api/integrations/rd-station/webhook",
]);
const AUTH_PATHS = new Set(["/api/cliente/auth", "/api/admin/auth", "/api/equipe/auth"]);
const DEFAULT_JSON_LIMIT = 256 * 1024;

function json(data: unknown, status: number, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function originOf(value: string | undefined | null): string | null {
  if (!value) return null;
  try { return new URL(value).origin; } catch { return null; }
}

export function trustedOrigins(request: Request, env: Env): Set<string> {
  const origins = new Set<string>([new URL(request.url).origin]);
  const configured = originOf(env.PUBLIC_APP_URL);
  if (configured) origins.add(configured);
  return origins;
}

/** Defesa CSRF central para toda mutação autenticada por cookie. */
export function enforceMutationOrigin(request: Request, env: Env): Response | null {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return null;
  const path = new URL(request.url).pathname;
  if (EXTERNAL_MUTATION_PATHS.has(path)) return null;
  if (!COOKIE_API_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;

  const origin = request.headers.get("Origin");
  if (origin) {
    if (!trustedOrigins(request, env).has(originOf(origin) ?? "")) return json({ erro: "Origem não autorizada." }, 403);
    return null;
  }

  const fetchSite = (request.headers.get("Sec-Fetch-Site") || "").toLowerCase();
  if (fetchSite === "same-origin" || fetchSite === "same-site") return null;
  return json({ erro: "Origem da requisição não pôde ser validada." }, 403);
}

/**
 * Bloqueia JSONs anormalmente grandes antes do parser das rotas. Uploads
 * multipart têm validação própria de bytes e Storage e não passam por aqui.
 */
export function enforceJsonBodySize(request: Request, maxBytes = DEFAULT_JSON_LIMIT): Response | null {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return null;
  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return null;
  const raw = request.headers.get("Content-Length");
  if (!raw) return null;
  const length = Number(raw);
  if (!Number.isFinite(length) || length < 0) return json({ erro: "Tamanho da requisição inválido." }, 400);
  if (length > maxBytes) return json({ erro: "Requisição muito grande." }, 413);
  return null;
}

/**
 * Limite global de mutações autenticadas. Login possui política própria por
 * IP + identificador; webhooks usam assinatura e ficam fora deste contador.
 */
export async function enforceMutationRateLimit(request: Request, env: Env): Promise<Response | null> {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return null;
  const path = new URL(request.url).pathname;
  if (EXTERNAL_MUTATION_PATHS.has(path) || AUTH_PATHS.has(path)) return null;
  if (!COOKIE_API_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);

  const ip = request.headers.get("CF-Connecting-IP")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  const area = path.startsWith("/api/admin/") ? "admin" : path.startsWith("/api/equipe/") ? "equipe" : "cliente";
  const key = `mutation:${area}:ip:${await hmacFingerprint(ip, env.CLIENTE_SESSION_SECRET)}`;

  try {
    const db = createServiceSupabaseClient(env);
    const { data, error } = await db.rpc("rate_limit_consumir", {
      p_chave: key,
      p_max_tentativas: 180,
      p_janela_segundos: 60,
    });
    if (error) {
      requestLogger(request).error("Falha no rate limit de mutação", { action: "security.rate_limit", eventCode: "MUTATION_RATE_LIMIT_FAILED", error });
      return json({ erro: "Não foi possível validar a requisição agora." }, 503);
    }
    if (!Boolean(data)) return json({ erro: "Muitas ações em pouco tempo. Aguarde um instante e tente novamente." }, 429);
    return null;
  } catch (error) {
    requestLogger(request).error("Exceção no rate limit de mutação", { action: "security.rate_limit", eventCode: "MUTATION_RATE_LIMIT_EXCEPTION", error });
    return json({ erro: "Não foi possível validar a requisição agora." }, 503);
  }
}

export function applyApiSecurityHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const secure = new URL(request.url).protocol === "https:";
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if (secure) headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const BACKEND_LEAK = /(PGRST|SQLSTATE|duplicate key|violates|relation\s+[^ ]+\s+does not exist|column\s+[^ ]+\s+does not exist|permission denied|invalid input syntax|schema cache|JWT|DETAIL:|HINT:|PostgREST)/i;

/**
 * Banco/provedor detalhado vai ao logger sanitizado, nunca ao navegador.
 * Mantém respostas 4xx de regra de negócio, mas redige sinais típicos de DB.
 */
export async function sanitizeApiErrorResponse(response: Response, request: Request): Promise<Response> {
  if (response.status < 400) return response;
  const path = new URL(request.url).pathname;
  if (path === "/api/health" || path === "/api/ready") return response;

  if (response.status >= 500) {
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("Cache-Control", "no-store");
    return new Response(JSON.stringify({ erro: "Serviço temporariamente indisponível." }), { status: response.status, statusText: response.statusText, headers });
  }

  const type = response.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) return response;
  let text = "";
  try { text = await response.clone().text(); } catch { return response; }
  if (!BACKEND_LEAK.test(text)) return response;

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify({ erro: "Não foi possível concluir a operação." }), { status: response.status, statusText: response.statusText, headers });
}

/** Revalida cadastro/contrato em toda requisição da cliente. */
export async function enforceClientAccountState(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/cliente/")) return null;
  if (path === "/api/cliente/auth" || path === "/api/cliente/logout") return null;
  if (!env.CLIENTE_SESSION_SECRET) return null;

  const sessao = await verificarTokenSessao(getCookie(request, "cliente_session"), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return null;

  const db = createServiceSupabaseClient(env);
  const { data, error } = await db.from("clientes").select("id,ativo,status_contrato").eq("id", sessao.clienteId).maybeSingle();
  const log = requestLogger(request).child({ actorType: "cliente", actorId: await pseudonymizeActorId(sessao.clienteId, env), action: "client.account.revalidate" });

  if (error) {
    log.error("Falha ao revalidar situação da cliente", { eventCode: "CLIENT_ACCOUNT_REVALIDATE_FAILED", statusCode: 503, error });
    return json({ erro: "Não foi possível validar seu acesso agora." }, 503);
  }

  const status = String(data?.status_contrato || "ativo").toLowerCase();
  if (!data || data.ativo !== true || status === "cancelado") {
    log.warn("Sessão de cliente revogada pela situação cadastral", { eventCode: "CLIENT_SESSION_REVOKED", statusCode: 401 });
    return json({ erro: "Seu acesso não está ativo." }, 401, { "Set-Cookie": clearSessionCookie(new URL(request.url).protocol === "https:") });
  }

  if (status === "suspenso" && UNSAFE_METHODS.has(request.method.toUpperCase())) {
    log.warn("Mutação bloqueada para contrato suspenso", { eventCode: "CLIENT_SUSPENDED_MUTATION_BLOCKED", statusCode: 423 });
    return json({ erro: "Seu contrato está suspenso. As ações da jornada estão temporariamente bloqueadas." }, 423);
  }
  return null;
}

export async function hmacFingerprint(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyTurnstile(request: Request, env: Env, token: string | null | undefined): Promise<{ ok: true } | { ok: false; status: number; erro: string }> {
  const required = String(env.TURNSTILE_REQUIRED || "").toLowerCase() === "true";
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return required ? { ok: false, status: 503, erro: "Proteção anti-bot não configurada." } : { ok: true };
  if (!token) return { ok: false, status: 400, erro: "Confirme a verificação de segurança." };

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  if (ip) form.set("remoteip", ip);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const result = await response.json().catch(() => null) as { success?: boolean } | null;
    return response.ok && result?.success === true ? { ok: true } : { ok: false, status: 403, erro: "Verificação de segurança inválida ou expirada." };
  } catch {
    return { ok: false, status: 503, erro: "Não foi possível validar a proteção anti-bot agora." };
  }
}

export function safePublicAppUrl(request: Request, env: Env): string {
  const fallback = new URL(request.url).origin;
  const configured = originOf(env.PUBLIC_APP_URL);
  if (!configured) return fallback;
  if (configured.startsWith("https://") || configured.startsWith("http://localhost") || configured.startsWith("http://127.0.0.1")) return configured;
  return fallback;
}
