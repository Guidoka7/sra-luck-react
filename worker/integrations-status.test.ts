import { describe, expect, it, vi } from "vitest";
import type { Env } from "./supabase";

const consultas = vi.hoisted(() => [] as { tabela: string; coluna: string }[]);
const rpcs = vi.hoisted(() => [] as string[]);

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
  credenciaisParaStatus: async () => new Map([["gemini:api_key", "chave-teste"]]),
  estadosIntegracoes: async () => new Map(),
}));
vi.mock("./web-push-config", () => ({
  validarConfiguracaoVapid: async () => ({ valido: false }),
}));
vi.mock("./supabase", () => ({
  createServiceSupabaseClient: () => ({
    rpc: async (nome: string) => {
      rpcs.push(nome);
      return { data: {
        estados: [],
        disponibilidade: { push: true, eventos: true, pagamentos: true, contaAzul: false, crm: true, vendas: true, frases: true },
        contagens: { push: 0, pagamentos: 0, contaAzul: null, vendas: 0, frasesIa: 1 },
        rd: { ultimaSincronizacao: null, erros: 0, ultimoWebhook: null },
        verificacoes: {},
      }, error: null };
    },
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

describe("snapshot do painel de integrações", () => {
  it("reconhece a persistência da Gemini sem repetir consultas REST", async () => {
    consultas.length = 0;
    rpcs.length = 0;
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
    expect(rpcs).toEqual(["loadtest_admin_integration_snapshot"]);
    expect(consultas).toHaveLength(0);
  });
});
