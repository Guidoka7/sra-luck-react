import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_MAX_AGE_SECONDS,
  criarTokenAdmin,
  criarTokenSessao,
  setAdminSessionCookie,
  setSessionCookie,
  verificarTokenAdmin,
  verificarTokenSessao,
} from "./session";

const SEGREDO = "segredo-de-teste-com-entropia-suficiente";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sessões assinadas do Worker", () => {
  it("aceita token válido e rejeita token adulterado ou com segmento extra", async () => {
    const token = await criarTokenSessao("cliente-123", SEGREDO);
    expect((await verificarTokenSessao(token, SEGREDO))?.clienteId).toBe("cliente-123");
    expect(await verificarTokenSessao(token + "x", SEGREDO)).toBeNull();
    expect(await verificarTokenSessao(token + ".extra", SEGREDO)).toBeNull();
  });

  it("rejeita token expirado", async () => {
    const inicio = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(inicio);
    const token = await criarTokenAdmin("admin-123", SEGREDO);
    vi.spyOn(Date, "now").mockReturnValue(inicio + (ADMIN_MAX_AGE_SECONDS + 1) * 1000);
    expect(await verificarTokenAdmin(token, SEGREDO)).toBeNull();
  });

  it("rejeita iat excessivamente no futuro", async () => {
    const agora = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(agora + 10 * 60 * 1000);
    const token = await criarTokenSessao("cliente-123", SEGREDO);
    vi.spyOn(Date, "now").mockReturnValue(agora);
    expect(await verificarTokenSessao(token, SEGREDO)).toBeNull();
  });

  it("mantém cookies HttpOnly, Secure em HTTPS e escopo administrativo restrito", () => {
    expect(setSessionCookie("abc", true)).toContain("HttpOnly");
    expect(setSessionCookie("abc", true)).toContain("Secure");
    expect(setSessionCookie("abc", true)).toContain("SameSite=Lax");
    expect(setAdminSessionCookie("abc", true)).toContain("Path=/api/admin");
    expect(setAdminSessionCookie("abc", true)).toContain("HttpOnly");
  });
});

import { criarTokenStaff, verificarTokenStaff } from "./session";

describe("limites e separação das sessões", () => {
  it("rejeita adulteração e segmentos extras também para admin e equipe", async () => {
    const admin = await criarTokenAdmin("admin-test", SEGREDO);
    const staff = await criarTokenStaff("staff-test", "auth-test", "sdr", SEGREDO);
    expect(await verificarTokenAdmin(`${admin}.extra`, SEGREDO)).toBeNull();
    expect(await verificarTokenStaff(`${staff}.extra`, SEGREDO)).toBeNull();
    expect(await verificarTokenStaff(`${staff}x`, SEGREDO)).toBeNull();
    expect(await verificarTokenAdmin(staff, SEGREDO)).toBeNull();
    expect(await verificarTokenSessao(admin, SEGREDO)).toBeNull();
  });
  it("rejeita token grande antes de processá-lo", async () => {
    expect(await verificarTokenSessao("a".repeat(8193), SEGREDO)).toBeNull();
  });
  it("rejeita payload assinado sem iat", async () => {
    const payload = Buffer.from(JSON.stringify({ clienteId: "client-test" })).toString("base64url");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SEGREDO), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url");
    expect(await verificarTokenSessao(`${payload}.${signature}`, SEGREDO)).toBeNull();
  });
});
