import { describe, expect, it } from "vitest";
import { buscarColaboradorAdminAtivo } from "./admin-auth";
import {
  DEV_CONSOLE_ADMIN_PREFIX,
  DEV_CONSOLE_SYNTHETIC_COLABORADOR_ID,
  authorizeDevConsoleRequest,
} from "./dev-console-auth";
import { getCookie, verificarTokenAdmin } from "./session";
import type { Env } from "./supabase";

const SERVICE_TOKEN = "m2m-service-token-com-mais-de-trinta-e-dois-caracteres";
const SESSION_SECRET = "session-secret-com-mais-de-trinta-e-dois-caracteres";

const env: Env = {
  DEV_CONSOLE_SERVICE_TOKEN: SERVICE_TOKEN,
  CLIENTE_SESSION_SECRET: SESSION_SECRET,
};

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://sra-luck-react.vercel.app${path}`, {
    ...init,
    headers: {
      "x-dev-console-token": SERVICE_TOKEN,
      "x-dev-actor-id": "user-123",
      "x-dev-actor-role": "owner",
      ...(init.headers || {}),
    },
  });
}

describe("autenticação M2M do Dev Console", () => {
  it("mantém o fluxo normal quando o header técnico não existe", async () => {
    const original = new Request("https://sra-luck-react.vercel.app/api/admin/visao-geral");
    expect(await authorizeDevConsoleRequest(original, env)).toBe(original);
  });

  it("autoriza consulta allowlisted, remove o segredo e injeta sessão efêmera assinada", async () => {
    const result = await authorizeDevConsoleRequest(request("/api/admin/visao-geral"), env);
    expect(result).toBeInstanceOf(Request);
    const authorized = result as Request;
    expect(authorized.headers.get("x-dev-console-token")).toBeNull();
    expect(authorized.headers.get("x-dev-actor-id")).toBeNull();

    const token = getCookie(authorized, "admin_session");
    const session = await verificarTokenAdmin(token, SESSION_SECRET);
    expect(session?.adminId).toBe(`${DEV_CONSOLE_ADMIN_PREFIX}user-123`);
  });

  it("rejeita token inválido", async () => {
    const result = await authorizeDevConsoleRequest(
      request("/api/admin/visao-geral", { headers: { "x-dev-console-token": "token-incorreto" } }),
      env,
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("bloqueia mutações mesmo com token válido quando a escrita está desligada", async () => {
    const result = await authorizeDevConsoleRequest(request("/api/admin/notificacoes/automacao", { method: "POST" }), env);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(await (result as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_M2M_READ_ONLY" });
  });

  describe("correções com DEV_CONSOLE_M2M_WRITE ligado", () => {
    const writeEnv: Env = { ...env, DEV_CONSOLE_M2M_WRITE: "1" };

    it("autoriza correção allowlisted para operator e injeta sessão técnica", async () => {
      const result = await authorizeDevConsoleRequest(
        request("/api/admin/clientes/abc/liberar-acesso-app", { method: "POST", headers: { "x-dev-actor-role": "operator" } }),
        writeEnv,
      );
      expect(result).toBeInstanceOf(Request);
      const authorized = result as Request;
      expect(authorized.headers.get("x-dev-console-token")).toBeNull();
      expect(authorized.headers.get("x-dev-actor-role")).toBeNull();
      const session = await verificarTokenAdmin(getCookie(authorized, "admin_session"), SESSION_SECRET);
      expect(session?.adminId).toBe(`${DEV_CONSOLE_ADMIN_PREFIX}user-123`);
    });

    it.each([
      ["POST", "/api/admin/central/prazo/liberar-agora"],
      ["POST", "/api/admin/financeiro/validacoes/rec-1/confirmar"],
      ["POST", "/api/admin/financeiro/recebiveis/rec-1/baixa"],
      ["PATCH", "/api/admin/financeiro/recebiveis/rec-1"],
      ["POST", "/api/admin/notificacoes/automacao"],
      ["POST", "/api/admin/integrations/testar-conexao"],
      ["POST", "/api/admin/credit-ops/club/referrals/ind-1"],
      ["POST", "/api/admin/integrations/rd-station/test"],
      ["POST", "/api/admin/integrations/rd-station/sync"],
      ["PATCH", "/api/admin/notificacoes/automacao"],
      ["POST", "/api/admin/notificacoes/templates"],
      ["PATCH", "/api/admin/notificacoes/templates"],
      ["POST", "/api/admin/notificacoes/enviar"],
      ["PATCH", "/api/admin/configuracoes"],
      ["PATCH", "/api/admin/credit-ops/rewards/rw-1"],
      ["DELETE", "/api/admin/credit-ops/rewards/rw-1"],
      ["POST", "/api/admin/home-campanhas"],
      ["PUT", "/api/admin/home-campanhas/clube-vantagens"],
      ["DELETE", "/api/admin/home-campanhas/custom-abc123"],
    ])("aceita %s %s", async (method, path) => {
      const result = await authorizeDevConsoleRequest(request(path, { method }), writeEnv);
      expect(result).toBeInstanceOf(Request);
    });

    it.each([
      ["POST", "/api/admin/staff"],
      ["PATCH", "/api/admin/staff/abc"],
      ["POST", "/api/admin/integrations/credenciais"],
      ["POST", "/api/admin/integrations/web-push/vapid"],
      ["POST", "/api/admin/configuracoes"],
      ["POST", "/api/admin/credit-ops/contracts"],
      ["POST", "/api/admin/integrations/conta-azul/create-receivable"],
      ["DELETE", "/api/admin/notificacoes/templates"],
      ["DELETE", "/api/admin/credit-ops/rewards"],
      ["DELETE", "/api/admin/credit-ops/club/config"],
      ["DELETE", "/api/admin/financeiro/recebiveis/rec-1"],
      ["POST", "/api/admin/financeiro/recebiveis/rec-1/baixa/extra"],
      ["PATCH", "/api/admin/clientes/abc"],
    ])("bloqueia %s %s fora da allowlist de correções", async (method, path) => {
      const result = await authorizeDevConsoleRequest(request(path, { method }), writeEnv);
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
      expect(await (result as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_MUTATION_NOT_ALLOWED" });
    });

    it("bloqueia correção para viewer ou papel ausente", async () => {
      for (const role of ["viewer", "", "admin"]) {
        const result = await authorizeDevConsoleRequest(
          request("/api/admin/notificacoes/automacao", { method: "POST", headers: { "x-dev-actor-role": role } }),
          writeEnv,
        );
        expect(result).toBeInstanceOf(Response);
        expect(await (result as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_ROLE_INSUFFICIENT" });
      }
    });

    it("exige developer para configurações gerais e sync do RD", async () => {
      for (const [method, path] of [["PATCH", "/api/admin/configuracoes"], ["POST", "/api/admin/integrations/rd-station/sync"]]) {
        const operator = await authorizeDevConsoleRequest(request(path, { method, headers: { "x-dev-actor-role": "operator" } }), writeEnv);
        expect(await (operator as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_ROLE_INSUFFICIENT" });
        const developer = await authorizeDevConsoleRequest(request(path, { method, headers: { "x-dev-actor-role": "developer" } }), writeEnv);
        expect(developer).toBeInstanceOf(Request);
      }
    });

    it("valida o token antes de considerar o papel", async () => {
      const result = await authorizeDevConsoleRequest(
        request("/api/admin/notificacoes/automacao", { method: "POST", headers: { "x-dev-console-token": "token-incorreto" } }),
        writeEnv,
      );
      expect((result as Response).status).toBe(401);
    });
  });

  it("autoriza leitura do carrossel", async () => {
    expect(await authorizeDevConsoleRequest(request("/api/admin/home-campanhas"), env)).toBeInstanceOf(Request);
  });

  it("bloqueia uma rota administrativa fora da allowlist", async () => {
    const result = await authorizeDevConsoleRequest(request("/api/admin/rota-nao-autorizada"), env);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("remove headers técnicos de probes públicos sem exigir autenticação M2M", async () => {
    const result = await authorizeDevConsoleRequest(request("/api/health"), env);
    expect(result).toBeInstanceOf(Request);
    expect((result as Request).headers.get("x-dev-console-token")).toBeNull();
  });

  it("resolve a identidade técnica sem consultar a tabela de colaboradores", async () => {
    const colaborador = await buscarColaboradorAdminAtivo(`${DEV_CONSOLE_ADMIN_PREFIX}user-123`, {} as Env);
    expect(colaborador).toMatchObject({
      id: DEV_CONSOLE_SYNTHETIC_COLABORADOR_ID,
      cargo: "administrativo",
      ativo: true,
    });
  });
});
