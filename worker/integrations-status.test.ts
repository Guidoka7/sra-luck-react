import { describe, expect, it, vi } from "vitest";
import type { Env } from "./supabase";

const consultas = vi.hoisted(() => [] as { tabela: string; coluna: string }[]);

vi.mock("./admin-auth", () => ({
  buscarColaboradorAdminAtivo: async () => ({ id: "admin" }),
  PERMISSOES_ADMIN: { INTEGRACOES_GERENCIAR_CREDENCIAIS: "integracoes" },
  temPermissaoAdmin: () => true,
}));
vi.mock("./session", () => ({
  getCookie: () => "sessao",
  verificarTokenAdmin: async () => ({ adminId: "admin" }),
}));
vi.mock("./integrations-credenciais", () => ({
  obterCredencial: async (_env: Env, provedor: string, chave: string) =>
    provedor === "gemini" && chave === "api_key" ? "chave-teste" : null,
}));
vi.mock("./web-push-config", () => ({
  validarConfiguracaoVapid: async () => ({ valido: false }),
}));
vi.mock("./supabase", () => ({
  createServiceSupabaseClient: () => ({
    from: (tabela: string) => ({
      select: (coluna: string) => {
        consultas.push({ tabela, coluna });
        const query = {
          eq: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve({
            count: tabela === "mensagens_do_dia" ? 1 : 0,
            error: tabela === "mensagens_do_dia" && coluna === "id" ? { code: "42703" } : null,
          }).then(resolve),
        };
        return query;
      },
    }),
  }),
}));

const { integrationsStatusApi } = await import("./integrations-status");

describe("status da integração Gemini", () => {
  it("reconhece a persistência pela chave data da tabela de mensagens", async () => {
    consultas.length = 0;
    const resposta = await integrationsStatusApi(
      new Request("https://exemplo.com/api/admin/integrations/status"),
      { CLIENTE_SESSION_SECRET: "segredo-teste" } as Env,
    );
    expect(resposta?.status).toBe(200);
    const corpo = await resposta!.json() as { integracoes: { id: string; estado: string; persistenciaPronta: boolean }[] };
    expect(corpo.integracoes.find((item) => item.id === "gemini")).toMatchObject({
      estado: "credenciais_presentes",
      persistenciaPronta: true,
    });
    expect(consultas).toContainEqual({ tabela: "mensagens_do_dia", coluna: "data" });
  });
});
