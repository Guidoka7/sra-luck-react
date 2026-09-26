type Env = Record<string, string | undefined>;
type ExecutionContextLike = { waitUntil?: (promise: Promise<unknown>) => void };
type WorkerLike = {
  fetch: (request: Request, env: Env, context?: ExecutionContextLike) => Response | Promise<Response>;
};

const DEV_TOKEN_HEADER = "x-dev-console-token";
const DEV_ACTOR_HEADER = "x-dev-actor-id";
const DEV_ROLE_HEADER = "x-dev-actor-role";
const DEV_CONSOLE_ADMIN_PREFIX = "dev-console:";
const BUILT_WORKER_PATH = "../dist/sra_luck_api/index.js";
let workerPromise: Promise<WorkerLike> | null = null;

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function canonicalProductionOrigin(request: Request): string {
  const explicit = firstEnv("PUBLIC_APP_URL", "NOTIFICACOES_APP_URL");
  if (explicit) {
    try {
      const url = new URL(explicit.startsWith("http") ? explicit : `https://${explicit}`);
      if (url.protocol === "https:") return url.origin;
    } catch {}
  }
  const vercelProductionUrl = firstEnv("VERCEL_PROJECT_PRODUCTION_URL");
  if (vercelProductionUrl) {
    try {
      const url = new URL(vercelProductionUrl.startsWith("http") ? vercelProductionUrl : `https://${vercelProductionUrl}`);
      if (url.protocol === "https:") return url.origin;
    } catch {}
  }
  return new URL(request.url).origin;
}

function buildEnv(request: Request): Env {
  return {
    SUPABASE_URL: firstEnv("SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: firstEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"),
    CLIENTE_SESSION_SECRET: firstEnv("CLIENTE_SESSION_SECRET"),
    NOTIFICACOES_CRON_SECRET: firstEnv("NOTIFICACOES_CRON_SECRET"),
    DEV_CONSOLE_SERVICE_TOKEN: firstEnv("DEV_CONSOLE_SERVICE_TOKEN"),
    WEB_PUSH_VAPID_PUBLIC_KEY: firstEnv("WEB_PUSH_VAPID_PUBLIC_KEY"),
    WEB_PUSH_VAPID_PRIVATE_KEY: firstEnv("WEB_PUSH_VAPID_PRIVATE_KEY"),
    WEB_PUSH_VAPID_SUBJECT: firstEnv("WEB_PUSH_VAPID_SUBJECT"),
    RD_WEBHOOK_SECRET: firstEnv("RD_WEBHOOK_SECRET"),
    RD_API_ACCESS_TOKEN: firstEnv("RD_API_ACCESS_TOKEN"),
    RD_CLIENT_ID: firstEnv("RD_CLIENT_ID"),
    RD_CLIENT_SECRET: firstEnv("RD_CLIENT_SECRET"),
    RD_REDIRECT_URI: firstEnv("RD_REDIRECT_URI"),
    RD_ACCESS_TOKEN: firstEnv("RD_ACCESS_TOKEN"),
    RD_REFRESH_TOKEN: firstEnv("RD_REFRESH_TOKEN"),
    RD_TOKEN_EXPIRES_AT: firstEnv("RD_TOKEN_EXPIRES_AT"),
    CONTA_AZUL_CLIENT_ID: firstEnv("CONTA_AZUL_CLIENT_ID"),
    CONTA_AZUL_CLIENT_SECRET: firstEnv("CONTA_AZUL_CLIENT_SECRET"),
    CONTA_AZUL_ACCESS_TOKEN: firstEnv("CONTA_AZUL_ACCESS_TOKEN"),
    CONTA_AZUL_REFRESH_TOKEN: firstEnv("CONTA_AZUL_REFRESH_TOKEN"),
    CONTA_AZUL_REDIRECT_URI: firstEnv("CONTA_AZUL_REDIRECT_URI"),
    MERCADO_PAGO_ACCESS_TOKEN: firstEnv("MERCADO_PAGO_ACCESS_TOKEN"),
    MERCADO_PAGO_WEBHOOK_SECRET: firstEnv("MERCADO_PAGO_WEBHOOK_SECRET"),
    PUBLIC_APP_URL: firstEnv("PUBLIC_APP_URL", "NOTIFICACOES_APP_URL") ?? new URL(request.url).origin,
    BRB_WEBHOOK_SECRET: firstEnv("BRB_WEBHOOK_SECRET"),
    BB_WEBHOOK_SECRET: firstEnv("BB_WEBHOOK_SECRET"),
    SANTANDER_WEBHOOK_SECRET: firstEnv("SANTANDER_WEBHOOK_SECRET"),
    SICREDI_WEBHOOK_SECRET: firstEnv("SICREDI_WEBHOOK_SECRET"),
    EFI_WEBHOOK_SECRET: firstEnv("EFI_WEBHOOK_SECRET"),
    GEMINI_API_KEY: firstEnv("GEMINI_API_KEY"),
    GEMINI_MODEL: firstEnv("GEMINI_MODEL"),
    GEMINI_PROMPT: firstEnv("GEMINI_PROMPT"),
    CRON_SECRET: firstEnv("CRON_SECRET"),
  };
}

function base64urlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Buffer.from(signature).toString("base64url");
}

async function criarTokenAdmin(adminId: string, secret: string): Promise<string> {
  const payload = base64urlEncode(JSON.stringify({ adminId, iat: Date.now() }));
  return `${payload}.${await hmac(payload, secret)}`;
}

async function safeEqual(a: string, b: string) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(a)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(b)),
  ]);
  const A = new Uint8Array(left), B = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < A.length; i += 1) diff |= A[i] ^ B[i];
  return diff === 0;
}

function normalizeActor(value: string | null) {
  const actor = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(actor) ? actor : "service";
}

function jsonError(erro: string, codigo: string, status: number) {
  return Response.json({ erro, codigo }, { status, headers: { "Cache-Control": "no-store" } });
}

async function authorizeDevConsoleRequest(request: Request, env: Env): Promise<Request | Response> {
  const presented = request.headers.get(DEV_TOKEN_HEADER);
  if (!presented) return request;
  const pathname = new URL(request.url).pathname;
  const headers = new Headers(request.headers);
  if (!pathname.startsWith("/api/admin/")) {
    headers.delete(DEV_TOKEN_HEADER);
    headers.delete(DEV_ACTOR_HEADER);
    headers.delete(DEV_ROLE_HEADER);
    return new Request(request, { headers });
  }
  const expected = String(env.DEV_CONSOLE_SERVICE_TOKEN || "").trim();
  const secret = String(env.CLIENTE_SESSION_SECRET || "").trim();
  if (expected.length < 32 || !secret) return jsonError("Integração técnica indisponível.", "DEV_CONSOLE_M2M_NOT_CONFIGURED", 503);
  if (!(await safeEqual(presented.trim(), expected))) return jsonError("Credencial técnica inválida.", "DEV_CONSOLE_TOKEN_INVALID", 401);
  const actor = normalizeActor(request.headers.get(DEV_ACTOR_HEADER));
  const token = await criarTokenAdmin(`${DEV_CONSOLE_ADMIN_PREFIX}${actor}`, secret);
  const cookies = String(headers.get("cookie") || "").split(";").map((v) => v.trim()).filter(Boolean).filter((v) => !v.startsWith("admin_session="));
  cookies.push(`admin_session=${token}`);
  headers.set("cookie", cookies.join("; "));
  headers.delete(DEV_TOKEN_HEADER);
  headers.delete(DEV_ACTOR_HEADER);
  headers.delete(DEV_ROLE_HEADER);
  return new Request(request, { headers });
}

async function loadWorker(): Promise<WorkerLike> {
  if (!workerPromise) {
    workerPromise = import(/* @vite-ignore */ BUILT_WORKER_PATH).then((mod) => mod.default as WorkerLike);
  }
  return workerPromise;
}

async function handleRequest(request: Request, context?: ExecutionContextLike) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/pwa/origin") {
    return Response.json({ origin: canonicalProductionOrigin(request) }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  }

  const headers = new Headers(request.headers);
  headers.delete("cf-connecting-ip");
  headers.delete("x-real-ip");
  const trustedRequest = new Request(request, { headers });
  const env = buildEnv(trustedRequest);
  const authorizedRequest = await authorizeDevConsoleRequest(trustedRequest, env);
  if (authorizedRequest instanceof Response) return authorizedRequest;

  const worker = await loadWorker();
  return worker.fetch(authorizedRequest, env, context);
}

export default { fetch: handleRequest };
