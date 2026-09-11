import type { Fetcher } from "../worker/middleware/retry.js";

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function sequenceFetcher(responses: Response[]): Fetcher {
  let index = 0;
  return async () => responses[Math.min(index++, responses.length - 1)].clone();
}

export function timeoutFetcher(): Fetcher {
  return async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Abortado", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Abortado", "AbortError")), { once: true });
  });
}
