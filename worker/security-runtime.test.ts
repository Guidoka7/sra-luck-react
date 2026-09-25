import { remarcarAgendamento } from "./client-agenda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { File } from "node:buffer";
import worker from "./index";
import { staffApi } from "./staff-api";
import { handleClienteBoletos } from "./client-boletos";
import { clientNotificacoesApi } from "./client-notificacoes";
import { creditOpsApi } from "./credit-ops";
import { clientPushApi } from "./client-push";
import { enviarWebPushParaCliente } from "./web-push-sender";
import { criarTokenAdmin, criarTokenSessao } from "./session";
import { protectRequest } from "./http-security";
import { PERMISSOES_ADMIN as P } from "./admin-auth";
import { obterCredencial, salvarCredencialInterna } from "./integrations-credenciais";
import { rdStationReadonlyApi } from "./rd-station-readonly";

const state = vi.hoisted(() => ({
  handler: (_table: string, _ops: any[]): any => ({ data: null, error: null }),
  queries: [] as { table: string; ops: any[] }[],
  rpc: vi.fn(), signIn: vi.fn(), createUser: vi.fn(), remove: vi.fn(), upload: vi.fn(), signedUrl: vi.fn(),
}));
vi.mock("./supabase", () => ({
  createServiceSupabaseClient: () => ({
    from(table: string) {
      const ops: any[] = [];
      const query: any = new Proxy({}, { get(_t, key) {
        if (key === "then") return (resolve: any, reject: any) => {
          state.queries.push({ table, ops });
          return Promise.resolve(state.handler(table, ops)).then(resolve, reject);
        };
        return (...args: any[]) => { ops.push([key, ...args]); return query; };
      } });
      return query;
    },
    rpc: state.rpc,
    auth: { signInWithPassword: state.signIn, admin: { createUser: state.createUser, deleteUser: vi.fn() } },
    storage: { from: () => ({ remove: state.remove, upload: state.upload, createSignedUrl: state.signedUrl }) },
  }),
}));
vi.mock("./web-push-bootstrap", () => ({ garantirWebPushConfigurado: async () => ({ publicKey: "public-test", privateKey: "private-test", subject: "mailto:test@example.invalid" }) }));
const env = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-key", CLIENTE_SESSION_SECRET: "test-secret-for-runtime-security-only" };
const admin = { id: "staff-test", auth_user_id: "admin-test", cargo: "administrativo", ativo: true, permissoes: [] as string[] };
let actor = { ...admin };
const req = (path: string, method = "GET", body?: unknown, cookie?: string) => new Request(`https://app.test${path}`, {
  method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const adminCookie = async () => `admin_session=${await criarTokenAdmin("admin-test", env.CLIENTE_SESSION_SECRET)}`;
const clientCookie = async () => `cliente_session=${await criarTokenSessao("client-a", env.CLIENTE_SESSION_SECRET)}`;
const mutated = () => state.queries.filter(q => q.ops.some(o => ["insert", "update", "upsert", "delete"].includes(o[0])));

beforeEach(() => {
  vi.clearAllMocks(); actor = { ...admin, permissoes: [] }; state.queries = [];
  state.handler = (table) => ({ data: table === "colaboradores" ? actor : table === "clientes" ? { id: "client-a", ativo: true, acesso_app_liberado: true } : null, error: null });
  state.rpc.mockResolvedValue({ data: true, error: null });
  state.signIn.mockResolvedValue({ data: { user: { id: "admin-test" }, session: {} }, error: null });
  state.remove.mockResolvedValue({ error: null }); state.upload.mockResolvedValue({ error: null });
  Object.defineProperty(globalThis, "File", { value: File, configurable: true });
});

describe("HTTP ingress and real router", () => {
  it("shares the authorized client with the agenda and returns grouped availability", async () => {
    state.handler = table => ({
      data: table === "clientes" ? { id: "client-a", ativo: true, acesso_app_liberado: true, nome_completo: "Cliente sintética", valor_contrato: 100 } : [],
      error: null,
    });
    state.rpc.mockImplementation(async (fn: string) => ({ data: fn === "loadtest_cliente_agenda_snapshot"
      ? { agendamentos: [], elegivel: true, solicitacao: null, remarcacoes: [], datas_disponiveis: [], datas_cirurgia: [], data_minima: null, comprometido_por_mes: {} }
      : true, error: null }));
    const response = await worker.fetch(req("/api/cliente/agenda", "GET", undefined, await clientCookie()), env);
    expect(response.status).toBe(200);
    expect(state.queries.filter(q => q.table === "clientes")).toHaveLength(1);
    expect(state.queries.filter(q => q.table === "agendamentos")).toHaveLength(0);
    expect(state.rpc.mock.calls).toHaveLength(1);
    expect(state.rpc.mock.calls[0][0]).toBe("loadtest_cliente_agenda_snapshot");
    expect(state.rpc.mock.calls[0][1].p_cliente_id).toBe("client-a");
  });
  it("keeps the surgery date and monthly credit rules inside a single agenda snapshot", async () => {
    state.handler = table => ({ data: table === "clientes"
      ? { id: "client-a", ativo: true, acesso_app_liberado: true, nome_completo: "Cliente sintética", valor_contrato: 100 }
      : [], error: null });
    state.rpc.mockResolvedValue({ data: {
      agendamentos: [{ id: "schedule-a", status: "confirmado", agenda_cirurgica_liberada_em: "2026-09-20", valor_contrato: 100 }],
      elegivel: true, solicitacao: null, remarcacoes: [], datas_disponiveis: [],
      datas_cirurgia: [{ id: "before", data: "2030-01-01", vagas_restantes: 1 }, { id: "allowed", data: "2030-02-01", vagas_restantes: 1 }, { id: "full", data: "2030-02-02", vagas_restantes: 0 }],
      data_minima: "2030-01-02", comprometido_por_mes: { "2030-01": 0, "2030-02": 80000 },
    }, error: null });
    const response = await worker.fetch(req("/api/cliente/agenda", "GET", undefined, await clientCookie()), env);
    expect(response.status).toBe(200);
    expect((await response.json() as any).datasCirurgiaDisponiveis).toEqual([{ id: "allowed", data: "2030-02-01", vagasRestantes: 1 }]);
    expect(state.queries.filter(q => q.table === "clientes")).toHaveLength(1);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it("bounds the boletos read to one client lookup and one finance snapshot RPC", async () => {
    state.handler = table => ({ data: table === "clientes"
      ? { id: "client-a", ativo: true, acesso_app_liberado: true, quantidade_parcelas: 12 }
      : [], error: null });
    const response = await worker.fetch(req("/api/cliente/boletos", "GET", undefined, await clientCookie()), env);
    expect(response.status).toBe(200);
    expect(state.queries.filter(q => q.table === "clientes")).toHaveLength(1);
    expect(state.queries.filter(q => q.table === "boletos")).toHaveLength(0);
    expect(state.rpc.mock.calls.map(c => c[0])).toContain("loadtest_cliente_financeiro_snapshot");
  });
  it("revalidates each client even when global interface configuration is cached", async () => {
    state.handler = (table, ops) => ({ data: table === "clientes"
      ? { id: ops.find((op: any[]) => op[0] === "eq" && op[1] === "id")?.[2], ativo: true, acesso_app_liberado: true }
      : table === "configuracoes" ? { whatsapp_contato: "0000" } : [], error: null });
    const a = await clientCookie();
    const b = `cliente_session=${await criarTokenSessao("client-b", env.CLIENTE_SESSION_SECRET)}`;
    expect((await worker.fetch(req("/api/cliente/config", "GET", undefined, a), env)).status).toBe(200);
    expect((await worker.fetch(req("/api/cliente/config", "GET", undefined, b), env)).status).toBe(200);
    expect(state.queries.filter(q => q.table === "clientes")).toHaveLength(2);
    expect(state.queries.filter(q => q.table === "configuracoes")).toHaveLength(1);
  });
  it("reuses a single active collaborator lookup across admin authorization layers", async () => {
    state.handler = table => ({ data: table === "colaboradores" ? actor : [], error: null });
    const response = await worker.fetch(req("/api/admin/clientes", "GET", undefined, await adminCookie()), env);
    expect(response.status).toBe(200);
    expect(state.queries.filter(q => q.table === "colaboradores")).toHaveLength(1);
  });
  it("pages admin clients with a single bounded RPC and one active collaborator lookup", async () => {
    state.rpc.mockResolvedValue({ data: [{ id: "11111111-1111-4111-8111-111111111111", created_at: "2026-09-25T00:00:00Z" }], error: null });
    const response = await worker.fetch(req("/api/admin/clientes/pagina?limite=0&funil=cadastradas", "GET", undefined, await adminCookie()), env);
    expect(response.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
    const bounded = await worker.fetch(req("/api/admin/clientes/pagina?limite=500&funil=cadastradas", "GET", undefined, await adminCookie()), env);
    expect(bounded.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls[0][0]).toBe("loadtest_admin_clientes_pagina_recent");
    expect(state.rpc.mock.calls[0][1].p_limite).toBe(50);
    expect(state.queries.filter(q => q.table === "colaboradores")).toHaveLength(2);
    expect(state.queries.filter(q => q.table === "clientes")).toHaveLength(0);
  });
  it("builds the admin overview from two bounded domain snapshots", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "loadtest_admin_dashboard_stats"
      ? { clientes: { ativas: 2, valor_ativo: 100 }, boletos: { total: 12 }, financeiroMensal: [],
          dispositivos: {}, novasClientesRecentes: [], comprovantesPendentes: [], clientesAguardandoLiberacao: [] }
      : { termosMes: [], termosProximos: [], cirurgiasMes: [], cirurgiasProximas: [] }, error: null }));
    const response = await worker.fetch(req("/api/admin/visao-geral", "GET", undefined, await adminCookie()), env);
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).carteira.totalParcelas).toBe(12);
    expect(state.rpc.mock.calls.map(c => c[0]).sort()).toEqual(["loadtest_admin_dashboard_agenda", "loadtest_admin_dashboard_stats"]);
    expect(state.queries.filter(q => q.table === "colaboradores")).toHaveLength(1);
    expect(state.queries.filter(q => q.table === "boletos" || q.table === "clientes")).toHaveLength(0);
  });
  it("pages the Central in one RPC without sending client ID lists to PostgREST", async () => {
    state.rpc.mockResolvedValue({ data: { filas: { preEligibility: [{
      cliente: { id: "client-a", nome_completo: "Cliente de teste", cpf: "80000000001", quantidade_parcelas: 12, ativo: true },
      agendamento: null, parcelas: { total: 12, pagas: 1, proxima: "2026-10-01" }, solicitacao: null,
    }] }, totais: { preEligibility: 8000 }, cursores: { preEligibility: { nome: "Cliente de teste", id: "client-a" } } }, error: null });
    const response = await worker.fetch(req("/api/admin/central/visao-geral", "GET", undefined, await adminCookie()), env);
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.totais.preEligibility).toBe(8000);
    expect(result.cursores.preEligibility.nome).toBe("Cliente de teste");
    expect(result.filas.preEligibility).toHaveLength(1);
    expect(state.rpc.mock.calls.map(c => c[0])).toEqual(["loadtest_admin_central_snapshot"]);
    expect(state.queries.map(q => q.table)).toEqual(["colaboradores"]);
    const next = await worker.fetch(req("/api/admin/central/visao-geral?estagio=preEligibility&aposNome=Cliente%20de%20teste&aposId=11111111-1111-4111-8111-111111111111", "GET", undefined, await adminCookie()), env);
    expect(next.status).toBe(200);
    expect(state.rpc.mock.calls[1][1].p_apos_nome).toBe("Cliente de teste");
  });
  it("rejects a malformed Central cursor before querying the snapshot", async () => {
    const response = await worker.fetch(req("/api/admin/central/visao-geral?estagio=preEligibility&aposId=invalid", "GET", undefined, await adminCookie()), env);
    expect(response.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("bounds the forecast to one database page while reporting the real total", async () => {
    state.rpc.mockResolvedValue({ data: { itens: [], total: 10000, cursor: null }, error: null });
    const response = await worker.fetch(req("/api/admin/previsao-liberacoes", "GET", undefined, await adminCookie()), env);
    expect(response.status).toBe(200);
    expect((await response.json() as any).paginacao.total).toBe(10000);
    expect(state.rpc.mock.calls.map(c => c[0])).toEqual(["loadtest_admin_forecast_page"]);
    expect(state.queries.map(q => q.table)).toEqual(["colaboradores"]);
  });
  it("rejects an invalid admin page cursor without querying client data", async () => {
    const response = await worker.fetch(req("/api/admin/clientes/pagina?cursor=not-a-valid-cursor", "GET", undefined, await adminCookie()), env);
    expect(response.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each([undefined, "admin_session=invalid", "admin_session=a.b.extra"])("rejects missing or invalid admin cookie %s", async cookie => {
    expect((await worker.fetch(req("/api/admin/clientes", "GET", undefined, cookie), env)).status).toBe(401);
    expect(state.queries).toHaveLength(0);
  });
  it("rejects inactive collaborator before accessing clients", async () => {
    actor.ativo = false;
    expect((await worker.fetch(req("/api/admin/clientes", "GET", undefined, await adminCookie()), env)).status).toBe(403);
    expect(state.queries.every(q => q.table === "colaboradores")).toBe(true);
  });
  it.each(["/api/admin/clientes", "/api/admin/financeiro/resumo", "/api/admin/staff", "/api/admin/credit-ops/contracts", "/api/admin/credit-ops/team", "/api/admin/central/termos", "/api/admin/notificacoes", "/api/admin/monitoramento-app", "/api/admin/configuracoes", "/api/admin/integrations/status", "/api/admin/relatorios/historico"])("denies unprivileged read %s", async path => {
    actor.cargo = "financeiro";
    expect((await worker.fetch(req(path, "GET", undefined, await adminCookie()), env)).status).toBe(403);
    expect(state.queries.every(q => q.table === "colaboradores")).toBe(true);
  });
  it.each(["POST", "PUT", "PATCH", "DELETE"])("blocks cross-origin %s for each cookie namespace", async method => {
    for (const path of ["/api/admin/staff", "/api/cliente/config", "/api/equipe/trainings/test/progress"]) {
      const r = req(path, method, {}); r.headers.set("Origin", "https://evil.test");
      expect((await worker.fetch(r, env)).status).toBe(403);
    }
    expect(state.queries).toHaveLength(0);
  });
  it.each([undefined, "text/plain", "application/json", "multipart/form-data; boundary=x"])("bounds body without relying on MIME or Content-Length: %s", async contentType => {
    const r = new Request("https://app.test/api/admin/auth", { method: "POST", headers: contentType ? { "content-type": contentType } : {}, body: "x".repeat(16_385) });
    expect((await worker.fetch(r, env)).status).toBe(413);
    expect(state.signIn).not.toHaveBeenCalled();
  });
  it("counts streamed chunks even with forged small Content-Length", async () => {
    const r = new Request("https://app.test/api/equipe/auth", { method: "POST", headers: { "content-length": "1" }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10_000)); c.enqueue(new Uint8Array(10_000)); c.close(); } }), duplex: "half" } as RequestInit);
    expect((await worker.fetch(r, env)).status).toBe(413);
  });
  it("preserves multipart receipt uploads and permits absent Origin", async () => {
    const form = new FormData(); form.append("arquivo", new Blob([new Uint8Array(400_000)], { type: "application/pdf" }), "proof.pdf");
    const safe = await protectRequest(new Request("https://app.test/api/cliente/boletos/test/anexar", { method: "POST", body: form }));
    expect(safe).toBeInstanceOf(Request);
    expect(((await (safe as Request).formData()).get("arquivo") as File).size).toBe(400_000);
  });
  it("does not apply cookie CSRF to independently authenticated webhooks", async () => {
    const r = req("/api/integrations/rd-station/webhook", "POST", {}); r.headers.set("Origin", "https://provider.test");
    expect(await protectRequest(r)).toBeInstanceOf(Request);
  });
  it("returns 404 for nonexistent endpoint", async () => {
    expect((await worker.fetch(req("/api/does-not-exist"), env)).status).toBe(404);
  });
  it("sanitizes raw DB errors from authorized handler", async () => {
    state.handler = table => ({ data: table === "colaboradores" ? actor : null, error: table === "clientes" ? { message: "duplicate key value violates secret_table constraint CPF 123" } : null });
    const response = await worker.fetch(req("/api/admin/clientes", "GET", undefined, await adminCookie()), env);
    expect(response.status).toBe(500); expect(await response.text()).not.toMatch(/duplicate|secret_table|constraint|CPF/);
  });
  it("keeps authorized configuration read working", async () => {
    actor.cargo = "financeiro"; actor.permissoes = [P.CONFIGURACOES_GERENCIAR];
    state.handler = table => ({ data: table === "colaboradores" ? actor : [], error: null });
    expect((await worker.fetch(req("/api/admin/configuracoes", "GET", undefined, await adminCookie()), env)).status).toBe(200);
  });
});

describe("staff privilege escalation", () => {
  it.each(["gestao", "administrativo"])("manager cannot create %s", async cargo => {
    actor.cargo = "financeiro"; actor.permissoes = [P.EQUIPE_GERENCIAR];
    const response = await staffApi(req("/api/admin/staff", "POST", { nome: "Test", email: "test@example.invalid", cargo, senhaTemporaria: "temporary-test-password" }, await adminCookie()), env);
    expect(response?.status).toBe(403); expect(state.createUser).not.toHaveBeenCalled();
  });
  it("manager cannot grant even a known permission", async () => {
    actor.cargo = "financeiro"; actor.permissoes = [P.EQUIPE_GERENCIAR];
    const response = await staffApi(req("/api/admin/staff", "POST", { nome: "Test", email: "test@example.invalid", cargo: "sdr", permissoes: [P.EQUIPE_GERENCIAR], senhaTemporaria: "temporary-test-password" }, await adminCookie()), env);
    expect(response?.status).toBe(403); expect(state.createUser).not.toHaveBeenCalled();
  });
  it.each([{ cargo: "administrativo" }, { permissoes: [P.INTEGRACOES_GERENCIAR_CREDENCIAIS] }])("blocks PATCH escalation %j", async body => {
    actor.cargo = "financeiro"; actor.permissoes = [P.EQUIPE_GERENCIAR];
    state.handler = (_t, ops) => ({ data: ops.some(o => o[0] === "eq" && o[1] === "auth_user_id") ? actor : { id: "target", cargo: "sdr", auth_user_id: "other", ativo: true }, error: null });
    expect((await staffApi(req("/api/admin/staff/target", "PATCH", body, await adminCookie()), env))?.status).toBe(403);
    expect(mutated()).toHaveLength(0);
  });
  it("refuses short password and unknown role", async () => {
    for (const body of [{ cargo: "sdr", senhaTemporaria: "short" }, { cargo: "superadmin", senhaTemporaria: "long-test-password" }]) {
      expect((await staffApi(req("/api/admin/staff", "POST", { nome: "Test", email: "t@example.invalid", ...body }, await adminCookie()), env))?.status).toBe(400);
    }
    expect(state.createUser).not.toHaveBeenCalled();
  });
  it("filters unknown permissions and audits valid creation without PII", async () => {
    state.createUser.mockResolvedValue({ data: { user: { id: "new-auth" } }, error: null });
    state.handler = (table, ops) => ({ data: table === "colaboradores" && ops.some(o => o[0] === "insert") ? { id: "new-staff", cargo: "sdr", ativo: true, permissoes: [P.CLIENTES_EDITAR] } : table === "colaboradores" ? actor : null, error: null });
    expect((await staffApi(req("/api/admin/staff", "POST", { nome: "Test Person", email: "t@example.invalid", cargo: "sdr", permissoes: ["god-mode", P.CLIENTES_EDITAR], senhaTemporaria: "long-test-password" }, await adminCookie()), env))?.status).toBe(201);
    const call = state.rpc.mock.calls.find(c => c[0] === "admin_salvar_colaborador_auditado");
    expect(call?.[1].p_actor_auth_id).toBe("admin-test");
    expect(call?.[1].p_dados.permissoes).toEqual([P.CLIENTES_EDITAR]);
    expect(call?.[1].p_dados).not.toHaveProperty("senhaTemporaria");
    // The DB RPC writes the minimized audit in the same transaction (SQL regression).
    expect(mutated()).toHaveLength(0);
  });
});

describe("IDOR and receipt concurrency", () => {
  it.each([["arquivo", "GET"], ["comprovante", "GET"], ["comprovante", "DELETE"], ["anexar", "POST"]] as const)("blocks another client's receipt %s %s", async (action, method) => {
    state.handler = () => ({ data: { id: "bill-b", cliente_id: "client-b", comprovante_url: "private/b.pdf", boleto_url: "private/b.pdf" }, error: null });
    expect((await handleClienteBoletos(req(`/api/cliente/boletos/bill-b/${action}`, method, undefined, await clientCookie()), env, "bill-b", action)).status).toBe(404);
    expect(state.signedUrl).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled(); expect(mutated()).toHaveLength(0);
  });
  it("does not remove a receipt if concurrent payment prevents DB mutation", async () => {
    state.handler = (_table, ops) => ({ data: ops.some(o => o[0] === "update") ? null : { id: "bill-a", cliente_id: "client-a", status: "pendente_confirmacao", comprovante_url: "private/a.pdf" }, error: null });
    const response = await handleClienteBoletos(req("/api/cliente/boletos/bill-a/comprovante", "DELETE", undefined, await clientCookie()), env, "bill-a", "comprovante");
    expect(response.status).toBe(409); expect(state.remove).not.toHaveBeenCalled();
  });
  it("scopes benefit mutation to the session client", async () => {
    const response = await creditOpsApi(req("/api/cliente/credit-ops/beneficios/benefit-b/usar", "POST", { cliente_id: "client-b" }, await clientCookie()), env);
    expect(response?.status).toBe(404);
    expect(mutated()[0].ops).toContainEqual(["eq", "cliente_id", "client-a"]);
  });
  it("scopes notification mutation to the session client", async () => {
    await clientNotificacoesApi(req("/api/cliente/notificacoes/n-b/ler", "POST", { cliente_id: "client-b" }, await clientCookie()), env);
    expect(mutated()[0].ops).toContainEqual(["eq", "cliente_id", "client-a"]);
  });
});

describe("atomic login quotas", () => {
  it.each(["admin", "cliente", "equipe"])("reserves IP and identifier before %s authentication", async area => {
    state.rpc.mockResolvedValue({ data: false, error: null });
    const body = area === "cliente" ? { cpf: "12345678900", dataNascimento: "1990-01-01" } : { email: "test@example.invalid", senha: "wrong-password" };
    const response = await worker.fetch(req(`/api/${area}/auth`, "POST", body), env);
    expect(response.status).toBe(429); expect(state.signIn).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledTimes(2);
    for (const [name, args] of state.rpc.mock.calls) {
      expect(name).toBe("rate_limit_consumir"); expect(args.p_chave).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(args.p_chave).not.toContain("12345678900");
    }
  });
  it("successful authentication does not clear shared IP quota", async () => {
    expect((await worker.fetch(req("/api/admin/auth", "POST", { email: "test@example.invalid", senha: "password" }), env)).status).toBe(200);
    expect(state.rpc.mock.calls.every(([name]) => name === "rate_limit_consumir")).toBe(true);
  });
});

describe("webhook, OAuth, push and credentials", () => {
  it("RD secret in URL cannot authorize a webhook", async () => {
    const response = await rdStationReadonlyApi(req("/api/integrations/rd-station/webhook?key=test-webhook", "POST", {}), { ...env, RD_WEBHOOK_SECRET: "test-webhook" });
    expect(response?.status).toBe(401); expect(mutated()).toHaveLength(0);
  });
  it("rejects arbitrary push host before storing a subscription", async () => {
    const response = await clientPushApi(req("/api/cliente/push/subscribe", "POST", { subscription: { endpoint: "https://127.0.0.1/private", keys: { auth: "auth", p256dh: "key" } } }, await clientCookie()), env);
    expect(response?.status).toBe(400); expect(mutated()).toHaveLength(0);
  });
  it("sender rejects arbitrary host already present in database", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    const db: any = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ id: "test-sub", endpoint: "https://evil.test" }], error: null }) }), delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) };
    const result = await enviarWebPushParaCliente({ ...env, WEB_PUSH_VAPID_PUBLIC_KEY: "public", WEB_PUSH_VAPID_PRIVATE_KEY: "private", WEB_PUSH_VAPID_SUBJECT: "mailto:test@example.invalid" }, db, "client-a", { title: "Test", body: "Test" });
    expect(result.removidas).toBe(1); expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
  });
  it("writes AES-GCM with domain-separated v2 key and reads it", async () => {
    let stored: any;
    state.handler = (_table, ops) => {
      const write = ops.find(o => o[0] === "upsert"); if (write) stored = write[1];
      return { data: ops.some(o => o[0] === "maybeSingle") ? stored : null, error: null };
    };
    await salvarCredencialInterna(env, "mercado_pago", "access_token", "secret-value-test", "test-actor");
    expect(stored.valor_cifrado).not.toContain("secret-value-test");
    expect(await obterCredencial(env, "mercado_pago", "access_token")).toBe("secret-value-test");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.CLIENTE_SESSION_SECRET));
    const legacy = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
    await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(stored.valor_iv, "base64") }, legacy, Buffer.from(stored.valor_cifrado, "base64"))).rejects.toThrow();
  });
});

async function signedState(payload: unknown) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.CLIENTE_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${encoded}.${Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded))).toString("base64url")}`;
}

describe("OAuth callback authorization", () => {
  it.each(["tampered", "extra", "expired", "missing-exp"])("rejects %s state before token exchange", async kind => {
    let token = await signedState({ adminId: "admin-test", ...(kind !== "missing-exp" ? { exp: Date.now() + (kind === "expired" ? -1000 : 60000) } : {}) });
    if (kind === "tampered") token += "x";
    if (kind === "extra") token += ".extra";
    const response = await rdStationReadonlyApi(req(`/api/integrations/rd-station/oauth/callback?code=test&state=${token}`), env);
    expect(response?.status).toBe(400); expect(state.queries).toHaveLength(0);
  });
  it.each(["inactive", "no-permission"])("rejects %s collaborator with correctly signed state", async kind => {
    if (kind === "inactive") actor.ativo = false;
    else actor.cargo = "financeiro";
    const token = await signedState({ adminId: "admin-test", exp: Date.now() + 60000 });
    const response = await rdStationReadonlyApi(req(`/api/integrations/rd-station/oauth/callback?code=test&state=${token}`), env);
    expect(response?.status).toBe(403); expect(mutated()).toHaveLength(0);
  });
});

describe("receipt storage safeguards", () => {
  it("rolls back only its own upload on concurrent DB conflict, ignores the user filename", async () => {
    state.handler = (table, ops) => ({ data: table === "boletos" && !ops.some(o => o[0] === "update") ? { id: "bill-a", cliente_id: "client-a", status: "nao_pago", comprovante_url: "client-a/old.pdf" } : null, error: null });
    const form = new FormData(); form.append("arquivo", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "../../evil.html");
    const r = new Request("https://app.test/api/cliente/boletos/bill-a/anexar", { method: "POST", headers: { cookie: await clientCookie() }, body: form });
    expect((await handleClienteBoletos(r, env, "bill-a", "anexar")).status).toBe(409);
    const path = state.upload.mock.calls[0][0];
    expect(path).toMatch(/^client-a\/bill-a\/[0-9a-f-]+\.pdf$/);
    expect(state.upload.mock.calls[0][2]).toEqual({ contentType: "application/pdf", upsert: false });
    expect(state.remove).toHaveBeenCalledTimes(1); expect(state.remove).toHaveBeenCalledWith([path]);
  });
  it("issues a five-minute URL only after ownership validation", async () => {
    state.handler = () => ({ data: { id: "bill-a", cliente_id: "client-a", comprovante_url: "client-a/a.pdf" }, error: null });
    state.signedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.test/signed" }, error: null });
    expect((await handleClienteBoletos(req("/api/cliente/boletos/bill-a/comprovante", "GET", undefined, await clientCookie()), env, "bill-a", "comprovante")).status).toBe(302);
    expect(state.signedUrl).toHaveBeenCalledWith("client-a/a.pdf", 300);
  });
});

import vercelHandler from "../api/index";
import { integrationsApi } from "./integrations-core";

describe("trusted ingress and signed webhook resource", () => {
  it("Vercel ignores forged Cloudflare IP for rate limiting", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    try {
      state.rpc.mockResolvedValue({ data: false, error: null });
      for (const ip of ["forged-one", "forged-two"]) {
        const r = req("/api/admin/auth", "POST", { email: "qa@example.invalid", senha: "test-password" });
        r.headers.set("cf-connecting-ip", ip); r.headers.set("x-real-ip", ip); r.headers.set("x-forwarded-for", "192.0.2.1");
        expect((await vercelHandler(r)).status).toBe(429);
      }
      expect(state.rpc.mock.calls[0][1].p_chave).toBe(state.rpc.mock.calls[2][1].p_chave);
    } finally { vi.unstubAllEnvs(); }
  });
  it.each(["data.id", "data_id", "missing"])("MP binds provider lookup to signed %s, never unsigned body", async param => {
    const secret = "webhook-test-secret";
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const manifest = `${param === "missing" ? "" : "id:123;"}request-id:test;ts:123;`;
    const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest))).toString("hex");
    const r = req(`/api/integrations/mercado-pago/webhook${param === "missing" ? "" : `?${param}=123`}`, "POST", { data: { id: "999-unsigned" } });
    r.headers.set("x-signature", `ts=123,v1=${signature}`); r.headers.set("x-request-id", "test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: 123, status: "pending" }));
    try {
      const response = await integrationsApi(r, { ...env, MERCADO_PAGO_ACCESS_TOKEN: "test", MERCADO_PAGO_WEBHOOK_SECRET: secret });
      if (param === "missing") { expect(response?.status).toBe(401); expect(fetchSpy).not.toHaveBeenCalled(); }
      else { expect(response?.status).toBe(200); expect(fetchSpy.mock.calls[0][0]).toBe("https://api.mercadopago.com/v1/payments/123"); }
    } finally { fetchSpy.mockRestore(); }
  });
});

it("telemetry persists sanitized metadata, discards supplied stacks and enforces quota", async () => {
  const response = await worker.fetch(req("/api/monitoramento/erro", "POST", {
    mensagem: "Erro test@example.invalid", stack: "sensitive-stack",
    detalhes: { email: "test@example.invalid", token: "secret-test", stack: "nested-sensitive-stack", codigo: "TEST" },
  }), env);
  expect(response.status).toBe(201);
  const event = mutated().find(q => q.table === "monitoramento_erros")!.ops.find(o => o[0] === "insert")[1];
  expect(event.stack).toBeNull(); expect(JSON.stringify(event)).not.toMatch(/test@example|secret-test|sensitive-stack/);
  state.rpc.mockResolvedValue({ data: false, error: null });
  expect((await worker.fetch(req("/api/monitoramento/erro", "POST", { mensagem: "Test" }), env)).status).toBe(429);
});

describe("Client surgery date is read-only after confirmation", () => {
  it("rejects surgery rescheduling without writing a request or invoking an RPC", async () => {
    const response = await remarcarAgendamento(req("/api/cliente/remarcar-agendamento", "POST", { tipo: "cirurgia", data: "2026-09-25" }, await clientCookie()), env);
    expect(response.status).toBe(409);
    expect((await response.json() as { erro: string }).erro).toContain("não pode ser alterada pelo aplicativo");
    expect(state.queries).toHaveLength(0);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("still authenticates before reporting the surgery rule", async () => {
    const response = await remarcarAgendamento(req("/api/cliente/remarcar-agendamento", "POST", { tipo: "cirurgia", data: "2026-09-25" }), env);
    expect(response.status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("preserves validation of term rescheduling", async () => {
    const response = await remarcarAgendamento(req("/api/cliente/remarcar-agendamento", "POST", { tipo: "termos" }, await clientCookie()), env);
    expect(response.status).toBe(400);
    expect((await response.json() as { erro: string }).erro).toContain("horário da assinatura");
  });
});
