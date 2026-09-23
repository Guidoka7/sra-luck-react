import { beforeEach, describe, expect, it, vi } from "vitest";
import { monitoramentoAcessos } from "./monitoramento-acessos";
import { adminReadPermissions } from "./admin-route-permissions";
import { PERMISSOES_ADMIN as P } from "./admin-auth";
import { criarTokenAdmin, criarTokenSessao } from "./session";
import { pseudonymizeActorId } from "./logger";

const state = vi.hoisted(() => ({
  handler: (_table: string, _ops: any[]): any => ({ data: null, error: null }),
  queries: [] as { table: string; ops: any[] }[],
  rpc: vi.fn(),
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
  }),
}));

const env = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-key", CLIENTE_SESSION_SECRET: "test-secret-for-access-monitoring-only" };
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const ADMIN_AUTH = "22222222-2222-4222-8222-222222222222";
const colaborador = { id: "33333333-3333-4333-8333-333333333333", auth_user_id: ADMIN_AUTH, nome: "Ana Admin", email: "ana@example.invalid", cargo: "administrativo", ativo: true, permissoes: [] as string[] };
let actor: any = colaborador;

const req = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => new Request(`https://app.test${path}`, {
  method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const clientCookie = async () => ({ cookie: `cliente_session=${await criarTokenSessao(CLIENTE, env.CLIENTE_SESSION_SECRET)}` });
const adminCookie = async () => ({ cookie: `admin_session=${await criarTokenAdmin(ADMIN_AUTH, env.CLIENTE_SESSION_SECRET)}` });
const inserts = () => state.queries.filter((q) => q.ops.some((o) => o[0] === "insert"));

beforeEach(() => {
  state.queries = [];
  actor = { ...colaborador };
  state.rpc.mockResolvedValue({ data: true, error: null });
  state.handler = (table) => ({ data: table === "colaboradores" ? actor : null, error: null });
});

describe("registro de acesso", () => {
  it("grava a aba aberta pela cliente com aparelho e modo de exibição", async () => {
    const res = await monitoramentoAcessos(req("/api/monitoramento/acesso", "POST", { tela: "app:parcelas", rota: "/agenda", deviceKey: "dev-1", deviceType: "mobile", displayMode: "standalone", isPwaInstalled: true, sessaoId: "s-1" }, await clientCookie()), env);
    expect(res?.status).toBe(201);
    const insert = inserts()[0];
    expect(insert.table).toBe("monitoramento_acessos");
    expect(insert.ops.find((o) => o[0] === "insert")[1]).toMatchObject({ actor_type: "cliente", actor_id: CLIENTE, tela: "app:parcelas", display_mode: "standalone", is_pwa_installed: true, device_key: "dev-1" });
  });

  it("grava a tela do Admin com a sessão administrativa", async () => {
    const res = await monitoramentoAcessos(req("/api/monitoramento/acesso", "POST", { tela: "/admin/clientes", rota: "/admin/clientes" }, await adminCookie()), env);
    expect(res?.status).toBe(201);
    expect(inserts()[0].ops.find((o) => o[0] === "insert")[1]).toMatchObject({ actor_type: "admin", actor_id: ADMIN_AUTH, tela: "/admin/clientes" });
  });

  it("ignora sem sessão, sem gerar erro nem gravar", async () => {
    const res = await monitoramentoAcessos(req("/api/monitoramento/acesso", "POST", { tela: "app:inicio", rota: "/agenda" }), env);
    expect(res?.status).toBe(200);
    expect(await res!.json()).toMatchObject({ ignored: true });
    expect(inserts()).toHaveLength(0);
  });

  it("não aceita sessão de cliente para telas do Admin", async () => {
    const res = await monitoramentoAcessos(req("/api/monitoramento/acesso", "POST", { tela: "/admin/financeiro", rota: "/admin/financeiro" }, await clientCookie()), env);
    expect(await res!.json()).toMatchObject({ ignored: true });
    expect(inserts()).toHaveLength(0);
  });

  it("bloqueia origem externa", async () => {
    const res = await monitoramentoAcessos(req("/api/monitoramento/acesso", "POST", { tela: "app:inicio", rota: "/agenda" }, { ...(await clientCookie()), origin: "https://evil.test" }), env);
    expect(res?.status).toBe(403);
  });

  it("respeita o rate limit sem quebrar a navegação", async () => {
    state.rpc.mockResolvedValue({ data: false, error: null });
    const res = await monitoramentoAcessos(req("/api/monitoramento/acesso", "POST", { tela: "app:inicio", rota: "/agenda" }, await clientCookie()), env);
    expect(res?.status).toBe(200);
    expect(inserts()).toHaveLength(0);
  });
});

describe("leitura do monitoramento", () => {
  it("histórico da cliente cruza erros pelo pseudônimo, nunca pelo id bruto", async () => {
    state.handler = (table) => {
      if (table === "colaboradores") return { data: actor, error: null };
      if (table === "clientes") return { data: { id: CLIENTE, nome_completo: "Bia", ativo: true, acesso_app_liberado: true }, error: null };
      if (table === "monitoramento_acessos") return { data: [{ criado_em: new Date().toISOString(), tela: "app:inicio", display_mode: "standalone", sessao_id: "s" }], error: null };
      return { data: [], error: null };
    };
    const res = await monitoramentoAcessos(req(`/api/admin/monitoramento-cliente/${CLIENTE}`, "GET", undefined, await adminCookie()), env);
    expect(res?.status).toBe(200);
    const body: any = await res!.json();
    expect(body.resumo).toMatchObject({ acessos7d: 1, viaApp: 1, sessoes7d: 1 });
    const erros = state.queries.find((q) => q.table === "monitoramento_erros")!;
    const filtroAtor = erros.ops.find((o) => o[0] === "eq" && o[1] === "actor_id");
    expect(filtroAtor[2]).toBe(await pseudonymizeActorId(CLIENTE, env as any));
    expect(filtroAtor[2]).not.toBe(CLIENTE);
  });

  it("exige permissão de monitoramento", async () => {
    actor = { ...colaborador, cargo: "financeiro", permissoes: [] };
    const res = await monitoramentoAcessos(req(`/api/admin/monitoramento-cliente/${CLIENTE}`, "GET", undefined, await adminCookie()), env);
    expect(res?.status).toBe(403);
  });

  it("atividade do Admin agrega acessos, erros e alterações por pessoa", async () => {
    const pseudo = await pseudonymizeActorId(ADMIN_AUTH, env as any);
    state.handler = (table, ops) => {
      if (table === "colaboradores") return { data: ops.some((o) => o[0] === "maybeSingle") ? actor : [colaborador], error: null };
      if (table === "monitoramento_acessos") return { data: [{ criado_em: new Date().toISOString(), actor_id: ADMIN_AUTH, tela: "/admin/clientes" }], error: null };
      if (table === "monitoramento_erros") return { data: [{ criado_em: new Date().toISOString(), actor_id: pseudo, codigo: "API_HTTP_ERROR" }], error: null };
      if (table === "logs_alteracoes") return { data: [{ created_at: new Date().toISOString(), usuario: colaborador.id, acao: "editou_cliente" }], error: null };
      return { data: null, error: null };
    };
    const res = await monitoramentoAcessos(req("/api/admin/monitoramento-admin?dias=7", "GET", undefined, await adminCookie()), env);
    expect(res?.status).toBe(200);
    const body: any = await res!.json();
    expect(body.pessoas[0]).toMatchObject({ nome: "Ana Admin", acessos: 1 });
    expect(body.pessoas[0].erros).toHaveLength(1);
    expect(body.pessoas[0].alteracoes).toHaveLength(1);
    expect(body.feed[0]).toMatchObject({ nome: "Ana Admin" });
  });

  it("rotas novas exigem monitoramento no roteador", () => {
    expect(adminReadPermissions(`/api/admin/monitoramento-cliente/${CLIENTE}`)).toEqual([P.MONITORAMENTO_VISUALIZAR]);
    expect(adminReadPermissions("/api/admin/monitoramento-admin")).toEqual([P.MONITORAMENTO_VISUALIZAR]);
  });
});
