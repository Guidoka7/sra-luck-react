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

function jsonPost(path: string, body: Record<string, unknown>) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("autenticação do Dev (acesso total)", () => {
  it("mantém o fluxo normal quando o header técnico não existe", async () => {
    const original = new Request("https://sra-luck-react.vercel.app/api/admin/visao-geral");
    expect(await authorizeDevConsoleRequest(original, env)).toBe(original);
  });

  it("autoriza, remove o segredo e injeta sessão efêmera assinada", async () => {
    const result = await authorizeDevConsoleRequest(request("/api/admin/visao-geral"), env);
    expect(result).toBeInstanceOf(Request);
    const authorized = result as Request;
    expect(authorized.headers.get("x-dev-console-token")).toBeNull();
    expect(authorized.headers.get("x-dev-actor-id")).toBeNull();
    expect(authorized.headers.get("x-dev-actor-role")).toBeNull();
    const session = await verificarTokenAdmin(getCookie(authorized, "admin_session"), SESSION_SECRET);
    expect(session?.adminId).toBe(`${DEV_CONSOLE_ADMIN_PREFIX}user-123`);
  });

  const ROTAS_LEITURA = [
    "/api/admin/integrations/credenciais",
    "/api/admin/monitoramento-admin",
    "/api/admin/staff",
  ];
  const ESCRITAS = [
    ["/api/admin/integrations/credenciais", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provedor: "mercado_pago", chave: "access_token", valor: "x".repeat(50) }) }],
    ["/api/admin/clientes/abc", { method: "PATCH", body: "{}" }],
    ["/api/admin/boletos/abc", { method: "DELETE" }],
  ] as const;

  it("leitura em qualquer rota do Admin para qualquer papel do Dev", async () => {
    for (const papel of ["owner", "developer", "operator", "viewer", ""]) {
      for (const rota of ROTAS_LEITURA) {
        const result = await authorizeDevConsoleRequest(request(rota, { method: "GET", headers: { "x-dev-actor-role": papel } }), env);
        expect(result, `${papel} GET ${rota}`).toBeInstanceOf(Request);
      }
    }
  });

  it("escrita só para owner, developer e operator", async () => {
    for (const papel of ["owner", "developer", "operator"]) {
      for (const [rota, init] of ESCRITAS) {
        const result = await authorizeDevConsoleRequest(request(rota, { ...init, headers: { ...(init as RequestInit).headers, "x-dev-actor-role": papel } }), env);
        expect(result, `${papel} ${init.method} ${rota}`).toBeInstanceOf(Request);
      }
    }
  });

  it("viewer, papel ausente ou desconhecido não escrevem (403 DEV_CONSOLE_ROLE_INSUFFICIENT)", async () => {
    for (const papel of ["viewer", "", "admin", "OWNER-fake"]) {
      for (const [rota, init] of ESCRITAS) {
        const result = await authorizeDevConsoleRequest(request(rota, { ...init, headers: { ...(init as RequestInit).headers, "x-dev-actor-role": papel } }), env);
        expect(result, `${papel} ${init.method} ${rota}`).toBeInstanceOf(Response);
        expect((result as Response).status).toBe(403);
        expect(await (result as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_ROLE_INSUFFICIENT" });
      }
    }
  });

  it("token inválido continua 401 mesmo para escrita de viewer (token é checado antes)", async () => {
    const result = await authorizeDevConsoleRequest(request("/api/admin/boletos/abc", { method: "DELETE", headers: { "x-dev-console-token": "token-incorreto", "x-dev-actor-role": "viewer" } }), env);
    expect((result as Response).status).toBe(401);
  });

  it("preserva o corpo da requisição", async () => {
    const result = await authorizeDevConsoleRequest(jsonPost("/api/admin/notificacoes/automacao", { acao: "enviar_agora_todas" }), env) as Request;
    expect(await result.json()).toEqual({ acao: "enviar_agora_todas" });
  });

  it("rejeita token inválido antes de qualquer operação", async () => {
    const result = await authorizeDevConsoleRequest(request("/api/admin/visao-geral", { headers: { "x-dev-console-token": "token-incorreto" } }), env);
    expect((result as Response).status).toBe(401);
  });

  it("recusa quando o token do Dev não está configurado", async () => {
    const result = await authorizeDevConsoleRequest(request("/api/admin/visao-geral"), { CLIENTE_SESSION_SECRET: SESSION_SECRET } as Env);
    expect((result as Response).status).toBe(503);
  });

  it("remove headers técnicos de probes públicos sem exigir autenticação", async () => {
    const result = await authorizeDevConsoleRequest(request("/api/health"), env);
    expect(result).toBeInstanceOf(Request);
    expect((result as Request).headers.get("x-dev-console-token")).toBeNull();
  });

  it("resolve a identidade técnica como administrativo, sem consultar colaboradores", async () => {
    const colaborador = await buscarColaboradorAdminAtivo(`${DEV_CONSOLE_ADMIN_PREFIX}user-123`, {} as Env);
    expect(colaborador).toMatchObject({ id: DEV_CONSOLE_SYNTHETIC_COLABORADOR_ID, cargo: "administrativo", ativo: true });
  });
});
