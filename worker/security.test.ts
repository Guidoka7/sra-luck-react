import { describe, expect, it } from "vitest";
import {
  applyApiSecurityHeaders,
  enforceJsonBodySize,
  enforceMutationOrigin,
  hmacFingerprint,
  safePublicAppUrl,
  sanitizeApiErrorResponse,
} from "./security";

describe("security middleware", () => {
  const env = { PUBLIC_APP_URL: "https://app.sraluck.example" } as any;

  it("aceita mutação same-origin e rejeita origem externa", () => {
    const good = new Request("https://app.sraluck.example/api/cliente/agendar", { method: "POST", headers: { Origin: "https://app.sraluck.example" } });
    expect(enforceMutationOrigin(good, env)).toBeNull();
    const bad = new Request("https://app.sraluck.example/api/cliente/agendar", { method: "POST", headers: { Origin: "https://evil.example" } });
    expect(enforceMutationOrigin(bad, env)?.status).toBe(403);
  });

  it("falha fechada quando mutação cookie-auth não traz origem nem fetch metadata", () => {
    const request = new Request("https://app.sraluck.example/api/admin/clientes", { method: "PATCH" });
    expect(enforceMutationOrigin(request, env)?.status).toBe(403);
  });

  it("não aplica CSRF aos webhooks externos assinados", () => {
    const request = new Request("https://app.sraluck.example/api/integrations/mercado-pago/webhook", { method: "POST" });
    expect(enforceMutationOrigin(request, env)).toBeNull();
  });

  it("rejeita JSON acima do limite sem afetar multipart", () => {
    const oversized = new Request("https://app.sraluck.example/api/admin/clientes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(300 * 1024) },
      body: "{}",
    });
    expect(enforceJsonBodySize(oversized)?.status).toBe(413);

    const upload = new Request("https://app.sraluck.example/api/cliente/boletos/x/anexar", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": String(5 * 1024 * 1024) },
      body: "x",
    });
    expect(enforceJsonBodySize(upload)).toBeNull();
  });

  it("aplica headers defensivos e HSTS em HTTPS", () => {
    const request = new Request("https://app.sraluck.example/api/health");
    const response = applyApiSecurityHeaders(new Response("ok"), request);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("redige detalhes internos de respostas 5xx", async () => {
    const request = new Request("https://app.sraluck.example/api/admin/clientes");
    const response = await sanitizeApiErrorResponse(
      new Response(JSON.stringify({ erro: "relation clientes_secret does not exist" }), { status: 500, headers: { "Content-Type": "application/json" } }),
      request,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe(JSON.stringify({ erro: "Serviço temporariamente indisponível." }));
  });

  it("preserva regra de negócio 4xx mas redige erro SQL 4xx", async () => {
    const request = new Request("https://app.sraluck.example/api/admin/clientes");
    const negocio = await sanitizeApiErrorResponse(new Response(JSON.stringify({ erro: "Status de contrato inválido." }), { status: 400, headers: { "Content-Type": "application/json" } }), request);
    expect(await negocio.clone().json()).toEqual({ erro: "Status de contrato inválido." });

    const sql = await sanitizeApiErrorResponse(new Response(JSON.stringify({ erro: "duplicate key value violates unique constraint" }), { status: 400, headers: { "Content-Type": "application/json" } }), request);
    expect(await sql.json()).toEqual({ erro: "Não foi possível concluir a operação." });
  });

  it("gera fingerprint estável sem expor valor original", async () => {
    const a = await hmacFingerprint("12345678900", "secret-for-tests");
    const b = await hmacFingerprint("12345678900", "secret-for-tests");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toContain("12345678900");
  });

  it("não aceita PUBLIC_APP_URL insegura fora do localhost", () => {
    const request = new Request("https://secure.example/api/health");
    expect(safePublicAppUrl(request, { PUBLIC_APP_URL: "http://evil.example" } as any)).toBe("https://secure.example");
    expect(safePublicAppUrl(request, { PUBLIC_APP_URL: "http://localhost:5173" } as any)).toBe("http://localhost:5173");
  });
});
