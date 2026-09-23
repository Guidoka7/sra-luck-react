/** Shared ingress protections, before any JSON parser or cookie-authenticated mutation. */
const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function denied(erro: string, status: number) {
  return Response.json({ erro }, { status, headers: { "Cache-Control": "no-store" } });
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

export function requestBodyLimit(path: string, contentType: string): number {
  if (/^\/api\/(admin|cliente|equipe)\/auth$/.test(path)) return 16_384;
  if (path === "/api/monitoramento/erro" || path === "/api/cliente/app-telemetry") return 16_384;
  // Multipart is allowed only on the existing upload endpoints, with envelope headroom.
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    if (/^\/api\/admin\/clientes\/[^/]+\/importacoes-boletos$/.test(path)) return 21 * 1024 * 1024;
    if (/^\/api\/admin\/clientes\/[^/]+\/leitor-carne\/folhas$/.test(path)) return 4 * 1024 * 1024 + 65_536;
    if (/^\/api\/admin\/financeiro\/recebiveis\/[^/]+\/comprovante$/.test(path)) return 9 * 1024 * 1024;
    if (/^\/api\/cliente\/boletos\/[^/]+\/anexar$/.test(path)) return 6 * 1024 * 1024;
    if (path === "/api/cliente/perfil/foto") return 5 * 1024 * 1024;
  }
  if (path === "/api/integrations/rd-station/webhook") return 1_000_000;
  if (/^\/api\/admin\/clientes\/[^/]+\/leitor-carne\/importar$/.test(path)) return 1_000_000;
  return path.startsWith("/api/integrations/") ? 512_000 : 262_144;
}

export async function protectRequest(request: Request): Promise<Request | Response> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/") || !MUTATIONS.has(request.method)) return request;
  if ((/^\/api\/(admin|cliente|equipe)\//.test(path) || path === "/api/monitoramento/erro") && !sameOrigin(request)) {
    return denied("Requisição de origem não autorizada.", 403);
  }
  const limit = requestBodyLimit(path, request.headers.get("content-type") || "");
  if (Number(request.headers.get("content-length") || 0) > limit) return denied("Requisição muito grande.", 413);
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => undefined);
        return denied("Requisição muito grande.", 413);
      }
      chunks.push(value);
    }
  } catch {
    return denied("Requisição inválida.", 400);
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return new Request(request, { body });
}

/** Never use the database/provider error message as an HTTP response. */
export function publicError(error: unknown, fallback = "Não foi possível concluir a operação agora."): string {
  console.error("Falha interna na operação:", error);
  return fallback;
}
