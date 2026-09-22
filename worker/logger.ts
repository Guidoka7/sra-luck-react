import type { Env } from "./supabase";

export type LogLevel = "info" | "warn" | "error" | "fatal";
export type ActorType = "cliente" | "admin" | "staff" | "system" | "anonymous";

type LogContext = {
  requestId?: string;
  action?: string;
  actorType?: ActorType;
  actorId?: string | null;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  entityType?: string;
  entityId?: string | null;
  provider?: string;
  eventCode?: string;
  environment?: string;
  [key: string]: unknown;
};

const SENSITIVE_KEY = /(password|senha|authorization|cookie|set-cookie|session|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|webhook[_-]?secret|service[_-]?role|api[_-]?key|cpf|data[_-]?nascimento|birth|email|telefone|phone|whatsapp|endereco|address|pix|qr[_-]?code|card|pan|cvv|p256dh|endpoint|auth|nome[_-]?completo|full[_-]?name|private[_-]?key|credential|credencial|segredo|chave[_-]?privada|stack)/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const PHONE_RE = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-\s]?\d{4}/g;
const MAX_DEPTH = 6;
const MAX_ARRAY = 30;
const MAX_STRING = 3000;
const REQUEST_IDS = new WeakMap<Request, string>();
const NATIVE_CONSOLE = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
let consoleSanitizerInstalled = false;

function sanitizeString(value: string): string {
  return value
    .replace(/([?&](?:token|access_token|refresh_token|secret|key|code)=)[^&\s]+/gi, "$1[SECRET_REDACTED]")
    .replace(BEARER_RE, "[SECRET_REDACTED]")
    .replace(JWT_RE, "[SECRET_REDACTED]")
    .replace(EMAIL_RE, "[PII_REDACTED]")
    .replace(CPF_RE, "[PII_REDACTED]")
    .replace(PHONE_RE, "[PII_REDACTED]")
    .slice(0, MAX_STRING);
}

export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeString(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message || "Erro desconhecido"),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((item) => sanitizeLogValue(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 60)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeLogValue(item, depth + 1);
    }
    return out;
  }
  return sanitizeString(String(value));
}

async function hmacId(value: string, secret?: string): Promise<string> {
  if (!value) return "anonymous";
  if (!secret) return "usr_unavailable";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return `usr_${Array.from(new Uint8Array(sig)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function pseudonymizeActorId(value: string | null | undefined, env: Env): Promise<string | null> {
  if (!value) return null;
  return hmacId(value, env.LOG_PSEUDONYM_KEY || env.CLIENTE_SESSION_SECRET);
}

function normalizeRequestId(value: string | null): string {
  const trimmed = value?.trim() || "";
  return UUID_RE.test(trimmed) ? trimmed : crypto.randomUUID();
}

export function getRequestId(request: Request): string {
  const cached = REQUEST_IDS.get(request);
  if (cached) return cached;
  const id = normalizeRequestId(request.headers.get("x-request-id"));
  REQUEST_IDS.set(request, id);
  return id;
}

function emit(level: LogLevel, message: string, context: LogContext) {
  const payload = sanitizeLogValue({
    timestamp: new Date().toISOString(),
    level,
    service: "sra-luck-worker",
    message,
    ...context,
  }) as Record<string, unknown>;
  const line = JSON.stringify(payload);
  if (level === "fatal" || level === "error") NATIVE_CONSOLE.error(line);
  else if (level === "warn") NATIVE_CONSOLE.warn(line);
  else NATIVE_CONSOLE.info(line);
}

function legacyConsoleLine(level: "info" | "warn" | "error", args: unknown[]) {
  const sanitized = sanitizeLogValue(args);
  const first = Array.isArray(sanitized) ? sanitized[0] : undefined;
  const message = typeof first === "string" ? first : `Legacy console.${level}`;
  const payload = sanitizeLogValue({
    timestamp: new Date().toISOString(),
    level,
    service: "sra-luck-worker",
    action: "legacy.console",
    eventCode: "LEGACY_CONSOLE_LOG",
    message,
    args: Array.isArray(sanitized) ? sanitized.slice(1) : [],
  });
  return JSON.stringify(payload);
}

/**
 * Defesa de última linha: módulos legados ainda podem usar console.* diretamente.
 * Todo output passa a ser JSON e sofre redaction antes de chegar aos logs do runtime.
 * Logs novos devem usar requestLogger/createLogger para incluir requestId/action/actorId.
 */
export function installConsoleSanitizer() {
  if (consoleSanitizerInstalled) return;
  consoleSanitizerInstalled = true;
  console.log = (...args: unknown[]) => NATIVE_CONSOLE.log(legacyConsoleLine("info", args));
  console.info = (...args: unknown[]) => NATIVE_CONSOLE.info(legacyConsoleLine("info", args));
  console.warn = (...args: unknown[]) => NATIVE_CONSOLE.warn(legacyConsoleLine("warn", args));
  console.error = (...args: unknown[]) => NATIVE_CONSOLE.error(legacyConsoleLine("error", args));
}

export type Logger = {
  child(bindings: LogContext): Logger;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
};

export function createLogger(base: LogContext = {}): Logger {
  const write = (level: LogLevel, message: string, context: LogContext = {}) => emit(level, message, { ...base, ...context });
  return {
    child: (bindings) => createLogger({ ...base, ...bindings }),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
    fatal: (message, context) => write("fatal", message, context),
  };
}

export function requestLogger(request: Request, requestId = getRequestId(request)): Logger {
  const url = new URL(request.url);
  return createLogger({ requestId, route: url.pathname, method: request.method });
}

export function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-ID", requestId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
