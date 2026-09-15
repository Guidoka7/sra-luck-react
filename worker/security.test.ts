import { describe, expect, it } from "vitest";
import { applyApiSecurityHeaders, enforceMutationOrigin, enforceRequestSize, hmacFingerprint, safePublicAppUrl, verifyTurnstile } from "./security";

describe("security middleware", () => {
  const env = { PUBLIC_APP_URL: "https://app.sraluck.example" } as any;

  it("aceita mutação same-origin e rejeita origem externa", () => {
    const good = new Request("https://app.sraluck.example/api/cliente/agendar", { method: "POST", headers: { Origin: "https://app.sraluck.example" } });
    expect(enforceMutationOrigin(good, env)).toBeNull();

    const bad = new Request("https://app.sraluck.example/api/cliente/agendar", { method: "POST", headers: { Origin: "https://evil.example" } });
    expect(enforceMutationOrigin(bad, env)?.status).toBe(403);
  });

  it("não considera same-site suficiente para mutação cookie-auth", () => {
    const request = new Request("https://app.sraluck.example/api/cliente/agendar", { method: "POST", headers: { "Sec-Fetch-Site": "same-site" } });
    expect(enforceMutationOrigin(request, env)?.status).toBe(403);
  });

  it("falha fechada quando mutação cookie-auth não traz origem nem fetch metadata", () => {
    const request = new Request("https://app.sraluck.example/api/admin/clientes", { method: "PATCH" });
    expect(enforceMutationOrigin(request, env)?.status).toBe(403);
  });

  it("não aplica CSRF aos webhooks externos assinados", () => {
    const request = new Request("https://app.sraluck.example/api/integrations/mercado-pago/webhook", { method: "POST" });
    expect(enforceMutationOrigin(request, env)).toBeNull();
  });

  it("bloqueia payload JSON declarado acima do teto", () => {
    const request = new Request("https://app.sraluck.example/api/cliente/agendar", { method: "POST", headers: { "Content-Length": String(600 * 1024) } });
    expect(enforceRequestSize(request)?.status).toBe(413);
  });

  it("mantém teto maior para upload de comprovante", () => {
    const ok = new Request("https://app.sraluck.example/api/cliente/boletos/abc/anexar", { method: "POST", headers: { "Content-Length": String(5 * 1024 * 1024) } });
    const bad = new Request("https://app.sraluck.example/api/cliente/boletos/abc/anexar", { method: "POST", headers: { "Content-Length": String(7 * 1024 * 1024) } });
    expect(enforceRequestSize(ok)).toBeNull();
    expect(enforceRequestSize(bad)?.status).toBe(413);
  });

  it("aplica headers defensivos e HSTS em HTTPS", () => {
    const request = new Request("https://app.sraluck.example/api/health");
    const response = applyApiSecurityHeaders(new Response("ok"), request);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("gera fingerprint estável sem expor valor original", async () => {
    const a = await hmacFingerprint("12345678900", "secret-for-tests");
    const b = await hmacFingerprint("12345678900", "secret-for-tests");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toContain("12345678900");
  });

  it("Turnstile falha fechado por padrão em HTTPS público quando segredo está ausente", async () => {
    const request = new Request("https://app.sraluck.example/api/cliente/auth", { method: "POST" });
    const result = await verifyTurnstile(request, {} as any, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it("permite ambiente local sem Turnstile quando não forçado", async () => {
    const request = new Request("http://localhost:5173/api/cliente/auth", { method: "POST" });
    await expect(verifyTurnstile(request, {} as any, null)).resolves.toEqual({ ok: true });
  });

  it("não aceita PUBLIC_APP_URL insegura fora do localhost", () => {
    const request = new Request("https://secure.example/api/health");
    expect(safePublicAppUrl(request, { PUBLIC_APP_URL: "http://evil.example" } as any)).toBe("https://secure.example");
    expect(safePublicAppUrl(request, { PUBLIC_APP_URL: "http://localhost:5173" } as any)).toBe("http://localhost:5173");
  });
});
