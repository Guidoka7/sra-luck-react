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
  obterCredencialParaValidacao: async (_env: Env, provedor: string, chave: string) =>
    provedor === "gemini" && chave === "api_key" ? "chave-teste" : null,
  estadosIntegracoes: async () => new Map(),
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
          neq: () => query,
          in: () => query,
          gte: () => query,
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

describe("agendador de integrações autorizado pelo cofre do banco", () => {
  it("aceita só token longo confirmado pela RPC; qualquer falha nega", async () => {
    const { cronAutorizadoPeloBanco } = await import("./integrations-core");
    const req = (t?: string) => new Request("https://app/api/cron/integracoes", { method: "POST", headers: t ? { Authorization: `Bearer ${t}` } : {} });
    const env = {} as never;
    const chamadas: unknown[] = [];
    const db = (ok: unknown, erro: unknown = null) => ({ rpc: async (fn: string, args: Record<string, unknown>) => { chamadas.push([fn, args]); return { data: ok, error: erro }; } });
    const longo = "x".repeat(64);
    expect(await cronAutorizadoPeloBanco(req(longo), env, db(true))).toBe(true);
    expect(chamadas[0]).toEqual(["integracoes_cron_autorizado", { p_token: longo }]);
    expect(await cronAutorizadoPeloBanco(req(longo), env, db(false))).toBe(false);
    expect(await cronAutorizadoPeloBanco(req(longo), env, db(null, { message: "função não existe" }))).toBe(false);
    expect(await cronAutorizadoPeloBanco(req("curto"), env, db(true))).toBe(false);
    expect(await cronAutorizadoPeloBanco(req(), env, db(true))).toBe(false);
  });
});
