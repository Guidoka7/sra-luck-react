import { describe, expect, it } from "vitest";
import { contaAzulTravadaNasRotasGerais } from "./integrations-core";
import type { Env } from "./supabase";

const PRODUCAO = { VERCEL_ENV: "production" } as Env;
const post = (path: string, body: unknown) => new Request(`https://app.test${path}`, { method: "POST", body: JSON.stringify(body) });

async function trava(env: Env, path: string, body: unknown) {
  return contaAzulTravadaNasRotasGerais(post(path, body), env, path);
}

describe("Conta Azul desligada no ambiente: telas gerais de integração", () => {
  it("Production recusa gravar credencial, configuração, teste e ativação da Conta Azul", async () => {
    for (const [path, body] of [
      ["/api/admin/integrations/credenciais", { provedor: "conta_azul", chave: "client_id", valor: "x" }],
      ["/api/admin/integrations/config", { provedor: "conta_azul", funcao: "conexao", config: {} }],
      ["/api/admin/integrations/testar-conexao", { provedor: "conta_azul" }],
      ["/api/admin/integrations/estado", { provedor: "conta_azul", ativo: true }],
    ] as const) {
      const r = await trava(PRODUCAO, path, body);
      expect(r?.status, path).toBe(503);
      expect(await r!.json()).toMatchObject({ codigo: "CONTA_AZUL_AMBIENTE_DESLIGADO" });
    }
  });

  it("remover credencial e desativar continuam permitidos (voltam ao estado seguro)", async () => {
    expect(await trava(PRODUCAO, "/api/admin/integrations/credenciais", { provedor: "conta_azul", chave: "client_id", remover: true })).toBeNull();
    expect(await trava(PRODUCAO, "/api/admin/integrations/credenciais", { provedor: "conta_azul", ativo: false })).toBeNull();
    expect(await trava(PRODUCAO, "/api/admin/integrations/estado", { provedor: "conta_azul", ativo: false })).toBeNull();
  });

  it("outros provedores e ambientes liberados seguem o fluxo normal", async () => {
    expect(await trava(PRODUCAO, "/api/admin/integrations/credenciais", { provedor: "rd_station", chave: "token", valor: "x" })).toBeNull();
    const liberado = { VERCEL_ENV: "production", CONTA_AZUL_PRODUCAO_PERMITIDA: "1" } as Env;
    expect(await trava(liberado, "/api/admin/integrations/credenciais", { provedor: "conta_azul", chave: "client_id", valor: "x" })).toBeNull();
  });

  it("a trava não consome o corpo da requisição", async () => {
    const path = "/api/admin/integrations/credenciais";
    const req = post(path, { provedor: "rd_station", chave: "token", valor: "x" });
    await contaAzulTravadaNasRotasGerais(req, PRODUCAO, path);
    expect(await req.json()).toMatchObject({ provedor: "rd_station" });
  });
});
