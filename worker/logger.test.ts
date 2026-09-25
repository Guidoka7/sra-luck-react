import { describe, expect, it } from "vitest";
import { pseudonymizeActorId, sanitizeLogValue } from "./logger";

describe("observability logger", () => {
  it("redige PII e segredos inclusive em objetos aninhados", () => {
    const sanitized = sanitizeLogValue({
      cpf: "123.456.789-00",
      cliente: {
        email: "ana@example.com",
        telefone: "+55 11 99999-0000",
        nested: { authorization: "Bearer abcdefghijklmnop" },
      },
      mensagem: "CPF 123.456.789-00 email ana@example.com Bearer abcdefghijklmnop",
    }) as any;

    expect(sanitized.cpf).toBe("[REDACTED]");
    expect(sanitized.cliente.email).toBe("[REDACTED]");
    expect(sanitized.cliente.telefone).toBe("[REDACTED]");
    expect(sanitized.cliente.nested.authorization).toBe("[REDACTED]");
    expect(JSON.stringify(sanitized)).not.toContain("123.456.789-00");
    expect(JSON.stringify(sanitized)).not.toContain("ana@example.com");
    expect(JSON.stringify(sanitized)).not.toContain("abcdefghijklmnop");
  });

  it("pseudonimiza o mesmo ator de forma estável sem expor o id original", async () => {
    const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", LOG_PSEUDONYM_KEY: "observability-secret" } as any;
    const original = "f645fab2-3d5f-4ad4-98ab-4ff96fdb2980";
    const first = await pseudonymizeActorId(original, env);
    const second = await pseudonymizeActorId(original, env);
    expect(first).toBe(second);
    expect(first).toMatch(/^usr_[0-9a-f]{16}$/);
    expect(first).not.toContain(original);
  });
  it("preserva request_id válido e suprime o identificador da entidade em logs", () => {
    const requestId = "93fabdb1-3e2f-4c05-8111-6b1535e38be4";
    expect(sanitizeLogValue({ requestId, entityId: "client-secret-id" })).toEqual({
      requestId, entityId: "[REDACTED]",
    });
  });
});
