import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./supabase";

let estados: { provedor: string; ativo: boolean; atualizado_por: string | null; atualizado_em: string }[] = [];
let tabelaExiste = true;

vi.mock("./supabase", () => ({
  createServiceSupabaseClient: () => ({
    from: (tabela: string) => {
      if (tabela === "integracoes_estado") {
        return { select: async () => (tabelaExiste ? { data: estados, error: null } : { data: null, error: { code: "42P01" } }) };
      }
      // Sem credencial salva no painel: vale a variável de ambiente.
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) };
      return q;
    },
  }),
}));

const { estadosIntegracoes, integracaoDesativada, obterCredencial } = await import("./integrations-credenciais");

const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", CLIENTE_SESSION_SECRET: "s", GEMINI_API_KEY: "chave-env" } as unknown as Env;

describe("liga/desliga por integração", () => {
  beforeEach(async () => { estados = []; tabelaExiste = true; await estadosIntegracoes(env, true); });

  it("sem linha de estado: integração ativa e a chave da variável de ambiente continua valendo", async () => {
    expect(await integracaoDesativada(env, "gemini")).toBe(false);
    expect(await obterCredencial(env, "gemini", "api_key")).toBe("chave-env");
  });

  it("desligada no painel: nenhuma credencial é entregue, nem a da variável de ambiente", async () => {
    estados = [{ provedor: "gemini", ativo: false, atualizado_por: "x", atualizado_em: new Date().toISOString() }];
    await estadosIntegracoes(env, true);
    expect(await integracaoDesativada(env, "gemini")).toBe(true);
    expect(await obterCredencial(env, "gemini", "api_key")).toBeNull();
    // Outras integrações não são afetadas.
    expect(await integracaoDesativada(env, "mercado_pago")).toBe(false);
  });

  it("sem a tabela (migration_087 não aplicada): tudo segue ativo como antes", async () => {
    tabelaExiste = false;
    await estadosIntegracoes(env, true);
    expect(await obterCredencial(env, "gemini", "api_key")).toBe("chave-env");
  });
});
