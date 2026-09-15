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

function hostnameOf(value: string | undefined | null): string | null {
  if (!value) return null;
  try { return new URL(value).hostname.toLowerCase(); } catch { return null; }
}

function ipDoRequest(request: Request): string {
  return request.headers.get("CF-Connecting-IP")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function productionLike(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

export function trustedOrigins(request: Request, env: Env): Set<string> {
  const origins = new Set<string>([new URL(request.url).origin]);
  const configured = originOf(env.PUBLIC_APP_URL);
  if (configured) origins.add(configured);
  return origins;
}

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
  if (fetchSite === "same-origin") return null;
  return json({ erro: "Origem da requisição não pôde ser validada." }, 403);
}

export function requestSizeLimit(path: string): number {
  if (/\/api\/cliente\/boletos\/[^/]+\/(anexar|comprovante)$/.test(path)) return 6 * 1024 * 1024;
  if (path.includes("/carne") || path.includes("/carnes")) return 22 * 1024 * 1024;
  if (path.includes("/comprovante")) return 7 * 1024 * 1024;
  if (EXTERNAL_MUTATION_PATHS.has(path)) return 1024 * 1024;
  return 512 * 1024;
}

/** Fast-path pelo Content-Length. A barreira streaming do secure-entry cobre requisições chunked/sem Content-Length. */
export function enforceRequestSize(request: Request): Response | null {
  const method = request.method.toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return null;
  const rawLength = request.headers.get("content-length");
  if (rawLength === null) return null;
  const declared = Number(rawLength);
  if (!Number.isFinite(declared) || declared < 0) return json({ erro: "Tamanho da requisição inválido." }, 400);
  return declared > requestSizeLimit(new URL(request.url).pathname)
    ? json({ erro: "Requisição excede o tamanho permitido." }, 413)
    : null;
}

export type StreamingSizeGuardResult = { request: Request; denied: Response | null };

/**
 * Segunda barreira de tamanho: mede o stream ORIGINAL quando Content-Length não existe,
 * interrompe cedo no teto e reconstrói a Request apenas se o corpo for válido. Assim não
 * existe o backpressure do tee/clone e o handler recebe exatamente os mesmos bytes.
 */
export async function enforceStreamingRequestSize(request: Request): Promise<StreamingSizeGuardResult> {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase()) || request.headers.get("content-length") !== null || !request.body) {
    return { request, denied: null };
  }

  const max = requestSizeLimit(new URL(request.url).pathname);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > max) {
          await reader.cancel().catch(() => undefined);
          return { request, denied: json({ erro: "Requisição excede o tamanho permitido." }, 413) };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { request, denied: json({ erro: "Não foi possível validar o corpo da requisição." }, 400) };
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const rebuilt = new Request(request.url, {
    method: request.method,
    headers: new Headers(request.headers),
    body: bytes,
    redirect: request.redirect,
  });
  return { request: rebuilt, denied: null };
}

function canonicalRateAction(request: Request): { action: string; max: number; window: number } | null {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return null;
  const path = new URL(request.url).pathname;
  if (AUTH_PATHS.has(path) || EXTERNAL_MUTATION_PATHS.has(path)) return null;

  if (/^\/api\/cliente\/boletos\/[^/]+\/(anexar|comprovante)$/.test(path)) return { action: "client-proof-upload", max: 12, window: 15 * 60 };
  if (path === "/api/cliente/payments/mercado-pago/preference") return { action: "client-mp-preference", max: 10, window: 5 * 60 };
  if (path === "/api/cliente/credit-ops/redeem") return { action: "client-club-redeem", max: 12, window: 10 * 60 };
  if (path === "/api/cliente/credit-ops/referrals") return { action: "client-referral", max: 10, window: 60 * 60 };
  if (path.includes("/push")) return { action: "client-push", max: 20, window: 10 * 60 };
  if (path.startsWith("/api/cliente/")) return { action: "client-mutation", max: 40, window: 10 * 60 };
  if (path.startsWith("/api/equipe/")) return { action: "staff-mutation", max: 120, window: 10 * 60 };
  if (path.startsWith("/api/admin/")) return { action: "admin-mutation", max: 240, window: 10 * 60 };
  return null;
}

export async function enforceActionRateLimit(request: Request, env: Env): Promise<Response | null> {
  const rule = canonicalRateAction(request);
  if (!rule) return null;
  if (!env.CLIENTE_SESSION_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ erro: "Serviço temporariamente indisponível." }, 503);

  const path = new URL(request.url).pathname;
  const cookieName = path.startsWith("/api/admin/") ? "admin_session" : path.startsWith("/api/equipe/") ? "staff_session" : "cliente_session";
  const token = getCookie(request, cookieName) || "anonymous";
  const actorFp = await hmacFingerprint(`${cookieName}:${token}`, env.CLIENTE_SESSION_SECRET);
  const ipFp = await hmacFingerprint(ipDoRequest(request), env.CLIENTE_SESSION_SECRET);
  const keys = [`action:${rule.action}:actor:${actorFp}`, `action:${rule.action}:ip:${ipFp}`];

  const db = createServiceSupabaseClient(env);
  for (const key of keys) {
    const { data, error } = await db.rpc("rate_limit_consumir", { p_chave: key, p_max_tentativas: rule.max, p_janela_segundos: rule.window });
    if (error) {
      requestLogger(request).error("Falha no rate limit de ação", { action: "security.rate_limit", eventCode: "ACTION_RATE_LIMIT_FAILED", statusCode: 503, error });
      return json({ erro: "Não foi possível validar a operação agora." }, 503);
    }
    if (!Boolean(data)) {
      requestLogger(request).warn("Ação bloqueada por rate limit", { action: "security.rate_limit", eventCode: "ACTION_RATE_LIMITED", statusCode: 429, rateAction: rule.action });
      return json({ erro: "Muitas ações em pouco tempo. Aguarde alguns minutos e tente novamente." }, 429, { "Retry-After": String(rule.window) });
    }
  }
  return null;
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

export type ClientAccess = { clienteId: string; statusContrato: string; ativo: boolean };

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

type TurnstileVerifyResult = { success?: boolean; hostname?: string; action?: string; "error-codes"?: string[] };

function turnstileAllowedHostnames(request: Request, env: Env): Set<string> {
  const hosts = new Set<string>([new URL(request.url).hostname.toLowerCase()]);
  const configured = hostnameOf(env.PUBLIC_APP_URL);
  if (configured) hosts.add(configured);
  return hosts;
}

export async function verifyTurnstile(
  request: Request,
  env: Env,
  token: string | null | undefined,
  expectedAction?: string,
): Promise<{ ok: true } | { ok: false; status: number; erro: string }> {
  const configuredFlag = String(env.TURNSTILE_REQUIRED || "").trim().toLowerCase();
  const required = configuredFlag === "true" || (configuredFlag !== "false" && productionLike(request));
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return required ? { ok: false, status: 503, erro: "Proteção anti-bot não configurada." } : { ok: true };
  if (!token) return { ok: false, status: 400, erro: "Confirme a verificação de segurança." };

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  const ip = ipDoRequest(request);
  if (ip && ip !== "unknown") form.set("remoteip", ip);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const result = await response.json().catch(() => null) as TurnstileVerifyResult | null;
    if (!response.ok || result?.success !== true) return { ok: false, status: 403, erro: "Verificação de segurança inválida ou expirada." };

    const hostname = String(result.hostname || "").toLowerCase();
    if (productionLike(request) && (!hostname || !turnstileAllowedHostnames(request, env).has(hostname))) {
      requestLogger(request).warn("Turnstile recusado por hostname divergente", { action: "security.turnstile.verify", eventCode: "TURNSTILE_HOSTNAME_MISMATCH", statusCode: 403 });
      return { ok: false, status: 403, erro: "Verificação de segurança inválida ou expirada." };
    }

    if (expectedAction && String(result.action || "") !== expectedAction) {
      requestLogger(request).warn("Turnstile recusado por action divergente", { action: "security.turnstile.verify", eventCode: "TURNSTILE_ACTION_MISMATCH", statusCode: 403 });
      return { ok: false, status: 403, erro: "Verificação de segurança inválida ou expirada." };
    }
    return { ok: true };
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
