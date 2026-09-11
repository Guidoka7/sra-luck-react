import type { StructuredLogger } from "./logger.js";

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  retryStatuses?: readonly number[];
  logger?: StructuredLogger;
  operation?: string;
}

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const;
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value ?? fallback)));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const at = Date.parse(header);
  if (!Number.isFinite(at)) return null;
  return Math.min(Math.max(0, at - Date.now()), 60_000);
}

function shouldRetryMethod(method: string, init: RequestInit): boolean {
  if (IDEMPOTENT_METHODS.has(method)) return true;
  return init.headers instanceof Headers
    ? init.headers.get("x-idempotency-key") !== null
    : Boolean((init.headers as Record<string, string> | undefined)?.["x-idempotency-key"]);
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: RetryOptions = {},
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const attempts = clampInteger(options.attempts, 3, 1, 6);
  const baseDelayMs = clampInteger(options.baseDelayMs, 250, 50, 10_000);
  const maxDelayMs = clampInteger(options.maxDelayMs, 5_000, 250, 60_000);
  const timeoutMs = clampInteger(options.timeoutMs, 10_000, 500, 120_000);
  const retryStatuses = new Set(options.retryStatuses ?? DEFAULT_RETRY_STATUSES);
  const method = String(init.method ?? "GET").toUpperCase();
  const canRetry = shouldRetryMethod(method, init);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Tempo limite excedido.", "TimeoutError")), timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetcher(input, { ...init, signal: controller.signal });
      const durationMs = Date.now() - startedAt;
      options.logger?.info("external_http_completed", {
        operation: options.operation,
        method,
        durationMs,
        status: response.status,
        attempt,
      });
      if (!canRetry || attempt >= attempts || !retryStatuses.has(response.status)) return response;
      const retryAfter = parseRetryAfter(response);
      const jitter = Math.floor(Math.random() * Math.max(50, baseDelayMs));
      const waitMs = retryAfter ?? Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1) + jitter);
      await delay(waitMs);
    } catch (error) {
      lastError = error;
      const durationMs = Date.now() - startedAt;
      options.logger?.warn("external_http_failed", {
        operation: options.operation,
        method,
        durationMs,
        attempt,
        reason: error instanceof Error ? error.message : "Falha de rede desconhecida",
      });
      if (!canRetry || attempt >= attempts) throw error;
      const jitter = Math.floor(Math.random() * Math.max(50, baseDelayMs));
      await delay(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1) + jitter));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Não foi possível concluir a requisição externa.");
}

export async function withRetry<T>(operation: () => Promise<T>, options: Omit<RetryOptions, "timeoutMs"> = {}): Promise<T> {
  const attempts = clampInteger(options.attempts, 3, 1, 6);
  const baseDelayMs = clampInteger(options.baseDelayMs, 250, 50, 10_000);
  const maxDelayMs = clampInteger(options.maxDelayMs, 5_000, 250, 60_000);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const jitter = Math.floor(Math.random() * Math.max(50, baseDelayMs));
      await delay(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1) + jitter));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("A operação falhou após novas tentativas.");
}
