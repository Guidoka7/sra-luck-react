import { describe, expect, it } from "vitest";
import { sanitizeErrorResponse } from "./response-security";

async function body(response: Response) { return response.json() as Promise<Record<string, unknown>>; }

describe("API error sanitization", () => {
  it("substitui erro interno 5xx e remove detalhes inesperados", async () => {
    const input = new Response(JSON.stringify({ erro: "relation clientes_secret does not exist", stack: "secret stack", hint: "schema public" }), { status: 500, headers: { "Content-Type": "application/json" } });
    const output = await sanitizeErrorResponse(input);
    const json = await body(output);
    expect(json.erro).toBe("Não foi possível concluir a operação agora. Tente novamente.");
    expect(json).not.toHaveProperty("stack");
    expect(json).not.toHaveProperty("hint");
  });

  it("mantém mensagem de negócio segura em 409", async () => {
    const input = new Response(JSON.stringify({ erro: "Essa parcela já está paga." }), { status: 409, headers: { "Content-Type": "application/json" } });
    const output = await sanitizeErrorResponse(input);
    expect((await body(output)).erro).toBe("Essa parcela já está paga.");
  });

  it("redige mensagem técnica do Postgres mesmo em 400", async () => {
    const input = new Response(JSON.stringify({ erro: "duplicate key value violates unique constraint users_email_key" }), { status: 400, headers: { "Content-Type": "application/json" } });
    const output = await sanitizeErrorResponse(input);
    expect((await body(output)).erro).not.toContain("constraint");
  });
});
