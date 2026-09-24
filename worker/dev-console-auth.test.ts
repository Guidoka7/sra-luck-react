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

  it("rejeita token inválido antes de autorizar a operação", async () => {
    const result = await authorizeDevConsoleRequest(
      request("/api/admin/visao-geral", { headers: { "x-dev-console-token": "token-incorreto" } }),
      env,
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("autoriza somente as duas rotinas automáticas seguras de notificações e preserva o body", async () => {
    for (const acao of ["verificar_atrasos", "verificar_momentos_especiais"]) {
      const result = await authorizeDevConsoleRequest(
        jsonPost("/api/admin/notificacoes/automacao", { acao }),
        env,
      );
      expect(result).toBeInstanceOf(Request);
      const authorized = result as Request;
      expect(await authorized.clone().json()).toEqual({ acao });
      expect(authorized.headers.get("x-dev-console-token")).toBeNull();
      expect((await verificarTokenAdmin(getCookie(authorized, "admin_session"), SESSION_SECRET))?.adminId)
        .toBe(`${DEV_CONSOLE_ADMIN_PREFIX}user-123`);
    }
  });

  it("bloqueia envio forçado em massa pelo contrato M2M", async () => {
    const result = await authorizeDevConsoleRequest(
      jsonPost("/api/admin/notificacoes/automacao", { acao: "enviar_agora_todas" }),
      env,
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(await (result as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_M2M_ACTION_NOT_ALLOWED" });
  });

  it("bloqueia campos extras mesmo em uma ação de notificação permitida", async () => {
    const result = await authorizeDevConsoleRequest(
      jsonPost("/api/admin/notificacoes/automacao", { acao: "verificar_atrasos", forcar: true }),
      env,
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(await (result as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_M2M_PAYLOAD_NOT_ALLOWED" });
  });

  it("autoriza teste técnico somente dos provedores implementados", async () => {
    for (const provedor of ["gemini", "mercado_pago"]) {
      const result = await authorizeDevConsoleRequest(
        jsonPost("/api/admin/integrations/testar-conexao", { provedor }),
        env,
      );
      expect(result).toBeInstanceOf(Request);
      expect(await (result as Request).clone().json()).toEqual({ provedor });
    }
  });

  it("bloqueia provedor fora da allowlist M2M", async () => {
    const result = await authorizeDevConsoleRequest(
      jsonPost("/api/admin/integrations/testar-conexao", { provedor: "conta_azul" }),
      env,
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(await (result as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_M2M_PROVIDER_NOT_ALLOWED" });
  });

  it("bloqueia outras mutações administrativas mesmo com token válido", async () => {
    const result = await authorizeDevConsoleRequest(request("/api/admin/clientes/abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo: false }),
    }), env);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(await (result as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_M2M_MUTATION_NOT_ALLOWED" });
  });

  it("bloqueia mutação M2M sem content-type JSON", async () => {
    const result = await authorizeDevConsoleRequest(request("/api/admin/notificacoes/automacao", {
      method: "POST",
      body: JSON.stringify({ acao: "verificar_atrasos" }),
    }), env);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(415);
    expect(await (result as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_M2M_CONTENT_TYPE_REQUIRED" });
  });

  it("bloqueia uma rota administrativa de leitura fora da allowlist", async () => {
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
