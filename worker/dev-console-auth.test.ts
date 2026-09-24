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

describe("M2M da mensagem diária do Gemini", () => {
  it("libera preparar, sugerir e publicar com payload fechado", async () => {
    const casos: [string, Record<string, unknown>][] = [
      ["/api/admin/integrations/gemini/mensagem-do-dia", {}],
      ["/api/admin/integrations/gemini/sugerir", { pedido: "mais curta e acolhedora" }],
      ["/api/admin/integrations/gemini/definir", { texto: "Seu caminho *segue firme* hoje.", origem: "ia", modelo: "gemini-x" }],
    ];
    for (const [path, body] of casos) {
      const result = await authorizeDevConsoleRequest(jsonPost(path, body), env);
      expect(result, path).toBeInstanceOf(Request);
    }
  });

  it("bloqueia campos extras, origem inválida e texto excessivo", async () => {
    const casos: [string, Record<string, unknown>][] = [
      ["/api/admin/integrations/gemini/mensagem-do-dia", { forcar: true }],
      ["/api/admin/integrations/gemini/sugerir", { pedido: "x".repeat(201) }],
      ["/api/admin/integrations/gemini/definir", { texto: "ok", origem: "cron" }],
      ["/api/admin/integrations/gemini/definir", { texto: "x".repeat(301), origem: "admin" }],
    ];
    for (const [path, body] of casos) {
      const result = await authorizeDevConsoleRequest(jsonPost(path, body), env);
      expect(result, path).toBeInstanceOf(Response);
      expect((result as Response).status, path).toBe(403);
      expect(await (result as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_M2M_GEMINI_NOT_ALLOWED" });
    }
  });
});

describe("M2M da configuração de funções de integração", () => {
  const comPapel = (body: Record<string, unknown>, papel: string) => request("/api/admin/integrations/config", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dev-console-token": env.DEV_CONSOLE_SERVICE_TOKEN!, "x-dev-actor-id": "dev:1", "x-dev-actor-role": papel },
    body: JSON.stringify(body),
  });

  it("owner/developer podem configurar funções conhecidas", async () => {
    for (const papel of ["owner", "developer"]) {
      const result = await authorizeDevConsoleRequest(comPapel({ provedor: "gemini", funcao: "notificacoes", config: { ativo: false, limiteDiario: 20 }, versao: 1 }, papel), env);
      expect(result, papel).toBeInstanceOf(Request);
    }
  });

  it("owner/developer configuram a importação do CRM; Conta Azul só no Admin", async () => {
    for (const papel of ["owner", "developer"]) {
      const result = await authorizeDevConsoleRequest(comPapel({ provedor: "rd_station", funcao: "importacao", config: { ativo: true, frequenciaMinutos: 60, etapas: [], mapeamento: { cpf: "contact:cpf" } }, versao: 2 }, papel), env);
      expect(result, papel).toBeInstanceOf(Request);
    }
  });

  it("importação manual do CRM: owner/developer, corpo vazio; rotas da Conta Azul bloqueadas", async () => {
    const post = (path: string, body: Record<string, unknown>, papel: string) => request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dev-console-token": env.DEV_CONSOLE_SERVICE_TOKEN!, "x-dev-actor-id": "dev:1", "x-dev-actor-role": papel },
      body: JSON.stringify(body),
    });
    expect(await authorizeDevConsoleRequest(post("/api/admin/integrations/rd-station/importar", {}, "developer"), env)).toBeInstanceOf(Request);
    for (const [path, body, papel] of [
      ["/api/admin/integrations/rd-station/importar", {}, "operator"],
      ["/api/admin/integrations/rd-station/importar", { tudo: true }, "owner"],
      ["/api/admin/integrations/conta-azul/sincronizar", {}, "owner"],
      ["/api/admin/integrations/conta-azul/enviar-cliente", { clienteId: "x" }, "owner"],
      ["/api/admin/integrations/conta-azul/conflitos/0b7c2a1e-1111-4222-8333-444455556666/resolver", { acao: "manter" }, "owner"],
      ["/api/admin/integrations/rd-station/importacoes/itens/0b7c2a1e-1111-4222-8333-444455556666/importar", {}, "owner"],
    ] as [string, Record<string, unknown>, string][]) {
      const result = await authorizeDevConsoleRequest(post(path, body, papel), env);
      expect(result, path).toBeInstanceOf(Response);
      expect((result as Response).status, path).toBe(403);
    }
  });

  it("bloqueia operador, função desconhecida, segredo e campos extras", async () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ provedor: "gemini", funcao: "notificacoes", config: { ativo: false } }, "operator"],
      [{ provedor: "conta_azul", funcao: "criar_conta_receber", config: {} }, "owner"],
      [{ provedor: "conta_azul", funcao: "sincronizacao", config: { ativo: true } }, "owner"],
      [{ provedor: "rd_station", funcao: "importacao", config: { ativo: true } }, "operator"],
      [{ provedor: "rd_station", funcao: "importacao", config: { client_secret: "x" } }, "owner"],
      [{ provedor: "gemini", funcao: "mensagem_diaria", config: { api_key: "segredo" } }, "owner"],
      [{ provedor: "gemini", funcao: "mensagem_diaria", config: {}, extra: 1 }, "owner"],
      [{ provedor: "gemini", funcao: "mensagem_diaria", config: [] }, "owner"],
    ];
    for (const [body, papel] of casos) {
      const result = await authorizeDevConsoleRequest(comPapel(body, papel), env);
      expect(result, JSON.stringify(body)).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
    }
  });
});

describe("M2M da Central de Notificações (escopos explícitos)", () => {
  const LOTE = "0b7c2a1e-1111-4222-8333-444455556666";
  const ITEM = "1c8d3b2f-2222-4333-8444-555566667777";
  const comPapel = (path: string, body: Record<string, unknown>, papel: string) => request(path, {
    method: "POST", headers: { "Content-Type": "application/json", "x-dev-actor-role": papel }, body: JSON.stringify(body),
  });

  it("libera preparar, gerar, editar, chat, aprovar, reprocessar e cancelar com payload fechado", async () => {
    const casos: [string, Record<string, unknown>][] = [
      ["/api/admin/notificacoes/lotes/preparar", {}],
      [`/api/admin/notificacoes/lotes/${LOTE}/gerar`, { instrucao: "mais acolhedora", segmento: "atraso_6_10" }],
      [`/api/admin/notificacoes/lotes/${LOTE}/itens/${ITEM}/editar`, { mensagem: "texto" }],
      [`/api/admin/notificacoes/lotes/${LOTE}/chat`, { mensagem: "quem vai receber?", historico: [] }],
      [`/api/admin/notificacoes/lotes/${LOTE}/explicar`, {}],
      [`/api/admin/notificacoes/lotes/${LOTE}/aprovar`, {}],
      [`/api/admin/notificacoes/lotes/${LOTE}/reprocessar-falhas`, {}],
      [`/api/admin/notificacoes/lotes/${LOTE}/cancelar`, {}],
    ];
    for (const [path, body] of casos) {
      const result = await authorizeDevConsoleRequest(comPapel(path, body, "operator"), env);
      expect(result, path).toBeInstanceOf(Request);
    }
  });

  it("viewer não prepara, não aprova nem cancela", async () => {
    for (const path of ["/api/admin/notificacoes/lotes/preparar", `/api/admin/notificacoes/lotes/${LOTE}/aprovar`, `/api/admin/notificacoes/lotes/${LOTE}/cancelar`]) {
      const result = await authorizeDevConsoleRequest(comPapel(path, {}, "viewer"), env);
      expect((result as Response).status).toBe(403);
      expect(await (result as Response).json()).toMatchObject({ codigo: "DEV_CONSOLE_M2M_ROLE_NOT_ALLOWED" });
    }
  });

  it("configuração da central exige developer ou owner", async () => {
    expect(await authorizeDevConsoleRequest(comPapel("/api/admin/notificacoes/lotes/config", { ativa: true }, "operator"), env)).toBeInstanceOf(Response);
    expect(await authorizeDevConsoleRequest(comPapel("/api/admin/notificacoes/lotes/config", { ativa: true }, "developer"), env)).toBeInstanceOf(Request);
  });

  it("rejeita campo extra, texto longo e rotas fora da allowlist (inclusive financeiras)", async () => {
    const recusadas: [string, Record<string, unknown>][] = [
      [`/api/admin/notificacoes/lotes/${LOTE}/aprovar`, { forcar: true }],
      [`/api/admin/notificacoes/lotes/${LOTE}/gerar`, { instrucao: "x".repeat(301) }],
      [`/api/admin/notificacoes/lotes/${LOTE}/itens/${ITEM}/editar`, {}],
      ["/api/admin/notificacoes/lotes/config", { ativa: true, max_tentativas: 9 }],
      ["/api/admin/notificacoes/enviar", { clienteId: "x", titulo: "t", mensagem: "m" }],
      ["/api/admin/financeiro/recebiveis/abc/baixa", {}],
      ["/api/admin/central/prazo/liberar-agora", {}],
      [`/api/admin/notificacoes/lotes/nao-e-uuid/aprovar`, {}],
    ];
    for (const [path, body] of recusadas) {
      const result = await authorizeDevConsoleRequest(comPapel(path, body, "owner"), env);
      expect(result, path).toBeInstanceOf(Response);
      expect((result as Response).status, path).toBe(403);
    }
  });
});
