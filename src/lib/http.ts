export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  retryUnsafe?: boolean;
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function friendlyMessage(status: number): string {
  if (status === 400) return "Revise os dados informados e tente novamente.";
  if (status === 401) return "Sua sessão expirou. Entre novamente.";
  if (status === 403) return "Você não tem permissão para realizar esta ação.";
  if (status === 404) return "A informação solicitada não foi encontrada.";
  if (status === 409) return "Os dados foram alterados por outra operação. Atualize a tela e tente novamente.";
  if (status === 429) return "Muitas tentativas em pouco tempo. Aguarde alguns instantes.";
  if (status >= 500) return "O serviço está temporariamente indisponível. Tente novamente em instantes.";
  return "Não foi possível concluir a operação.";
}

function errorFromPayload(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = (payload as Record<string, unknown>).erro;
    if (typeof error === "string" && error.trim()) return error.trim().slice(0, 500);
    const message = (payload as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 500);
  }
  return friendlyMessage(status);
}

export async function requestJson<T>(path: string, init: RequestInit = {}, options: HttpOptions = {}): Promise<T> {
  const timeoutMs = Math.min(120_000, Math.max(500, options.timeoutMs ?? 10_000));
  const retries = Math.min(3, Math.max(0, options.retries ?? 2));
  const method = String(init.method ?? "GET").toUpperCase();
  const canRetry = IDEMPOTENT.has(method) || options.retryUnsafe === true;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        ...init,
        signal: controller.signal,
        credentials: "same-origin",
        headers: {
          ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...(init.headers ?? {}),
        },
      });
      let payload: unknown = null;
      const text = await response.text();
      if (text) {
        try { payload = JSON.parse(text); } catch { payload = null; }
      }
      if (response.ok) return payload as T;
      const error = new HttpError(response.status, errorFromPayload(payload, response.status));
      lastError = error;
      const retryable = canRetry && attempt < retries && [408, 425, 429, 500, 502, 503, 504].includes(response.status);
      if (!retryable) throw error;
    } catch (error) {
      lastError = error;
      if (!canRetry || attempt >= retries || error instanceof HttpError && error.status < 500 && error.status !== 429) throw error;
    } finally {
      window.clearTimeout(timer);
    }
    const delay = Math.min(4_000, 250 * 2 ** attempt + Math.floor(Math.random() * 150));
    await sleep(delay);
  }

  if (lastError instanceof DOMException && lastError.name === "AbortError") throw new Error("A conexão demorou mais que o esperado. Tente novamente.");
  if (lastError instanceof Error) throw lastError;
  throw new Error("Não foi possível conectar ao servidor.");
}
