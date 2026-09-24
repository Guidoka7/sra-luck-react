import { beforeEach, describe, expect, it } from "vitest";
import { ESQUEMAS_CONFIG, REGISTRO_INTEGRACOES, catalogo, configDaFuncao, consumirUso, limparCacheConfig, salvarConfig } from "./integracoes-registro";
import type { Env } from "./supabase";

type Linha = Record<string, unknown>;

/** Banco em memória só com o que o registro usa (integracoes_config, integracao_uso, logs e rpc). */
function bancoFalso(inicial: Linha[] = [], rpc: (args: Record<string, unknown>) => { data: unknown; error: unknown } = () => ({ data: 1, error: null })) {
  const tabelas = new Map<string, Linha[]>([["integracoes_config", inicial.map((l) => ({ ...l }))], ["integracao_uso", []], ["logs_alteracoes", []]]);
  const rpcs: Record<string, unknown>[] = [];
  const db = {
    rpc: async (_nome: string, args: Record<string, unknown>) => { rpcs.push(args); return rpc(args); },
    from: (tabela: string) => {
      const linhas = tabelas.get(tabela) ?? [];
      const filtros: ((l: Linha) => boolean)[] = [];
      let patch: Linha | null = null;
      const aplicar = () => linhas.filter((l) => filtros.every((f) => f(l)));
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q; },
        maybeSingle: async () => ({ data: aplicar()[0] ?? null, error: null }),
        update: (p: Linha) => { patch = p; return q; },
        insert: async (l: Linha) => { linhas.push({ ...l }); return { error: null }; },
        then: (ok: (v: { data: Linha[] | null; error: null }) => unknown) => {
          if (patch) { const alvo = aplicar(); alvo.forEach((l) => Object.assign(l, patch)); return Promise.resolve({ data: null, error: alvo.length ? null : { message: "nada" } as never }).then(ok); }
          return Promise.resolve({ data: aplicar(), error: null }).then(ok);
        },
      };
      return q;
    },
  };
  return { db: db as never, tabelas, rpcs };
}

const env = {} as Env;

beforeEach(() => limparCacheConfig());

describe("registro de integrações", () => {
  it("toda função que não está disponível explica por quê", () => {
    for (const i of REGISTRO_INTEGRACOES) for (const f of i.funcoes) {
      if (f.situacao !== "disponivel") expect(f.motivo, `${i.id}.${f.id}`).toBeTruthy();
    }
    for (const i of REGISTRO_INTEGRACOES) for (const w of i.webhooks) {
      if (w.situacao !== "disponivel") expect(w.motivo, `${i.id} webhook`).toBeTruthy();
    }
  });

  it("não promete o que a API da Conta Azul não tem (webhook, cancelamento)", () => {
    const ca = REGISTRO_INTEGRACOES.find((i) => i.id === "conta_azul")!;
    expect(ca.funcoes.find((f) => f.id === "webhook_baixa")?.situacao).toBe("api_nao_permite");
    expect(ca.funcoes.find((f) => f.id === "cancelar_renegociar")?.situacao).toBe("api_nao_permite");
    expect(ca.webhooks.every((w) => w.situacao === "api_nao_permite")).toBe(true);
  });

  it("função configurável tem esquema e o esquema não aceita segredos", () => {
    for (const i of REGISTRO_INTEGRACOES) for (const f of i.funcoes.filter((x) => x.configuravel)) {
      expect(ESQUEMAS_CONFIG[i.id]?.[f.id], `${i.id}.${f.id}`).toBeTruthy();
    }
    const r = ESQUEMAS_CONFIG.gemini.mensagem_diaria.validar({ ativo: true, api_key: "x" });
    expect(r).toMatchObject({ ok: false });
  });
});

describe("configuração do Gemini por função", () => {
  const validar = ESQUEMAS_CONFIG.gemini.notificacoes.validar;

  it("valida e normaliza", () => {
    expect(validar({ ativo: false, modelo: "models/Gemini-2.5-Flash", temperatura: 0.4, maxTokens: 1024, limiteDiario: 50, prompt: "  tom leve  " }))
      .toEqual({ ok: true, config: { ativo: false, modelo: "gemini-2.5-flash", temperatura: 0.4, maxTokens: 1024, limiteDiario: 50, prompt: "tom leve" } });
    expect(validar({ temperatura: 3 })).toMatchObject({ ok: false });
    expect(validar({ modelo: "gemini 2.5" })).toMatchObject({ ok: false });
    expect(validar({ limiteDiario: 1.5 })).toMatchObject({ ok: false });
    expect(validar({ prompt: "x".repeat(1501) })).toMatchObject({ ok: false });
  });

  it("sem linha salva vale o padrão (comportamento anterior)", async () => {
    const { db } = bancoFalso();
    const c = await configDaFuncao(env, "gemini", "mensagem_diaria", { db });
    expect(c).toMatchObject({ ativo: true, modelo: null, prompt: null, limiteDiario: null, versao: 0 });
  });

  it("aplica a configuração salva", async () => {
    const { db } = bancoFalso([{ provedor: "gemini", funcao: "notificacoes", config: { ativo: false, limiteDiario: 10 }, versao: 3 }]);
    const c = await configDaFuncao<{ ativo: boolean; limiteDiario: number }>(env, "gemini", "notificacoes", { db });
    expect(c).toMatchObject({ ativo: false, limiteDiario: 10, versao: 3 });
  });

  it("salvar exige versão atual, registra auditoria e rejeita função desconhecida", async () => {
    const { db, tabelas } = bancoFalso([{ provedor: "gemini", funcao: "mensagem_diaria", config: {}, versao: 2 }]);
    expect(await salvarConfig(env, { provedor: "gemini", funcao: "mensagem_diaria", config: { ativo: false }, versao: 1 }, "col-1", { db }))
      .toMatchObject({ ok: false, codigo: "conflito_versao" });
    expect(await salvarConfig(env, { provedor: "gemini", funcao: "mensagem_diaria", config: { ativo: false }, versao: 2 }, "col-1", { db }))
      .toMatchObject({ ok: true, versao: 3, config: { ativo: false } });
    expect(tabelas.get("logs_alteracoes")).toHaveLength(1);
    expect(await salvarConfig(env, { provedor: "conta_azul", funcao: "criar_conta_receber", config: {} }, "col-1", { db }))
      .toMatchObject({ ok: false, codigo: "funcao_desconhecida" });
  });

  it("limite diário: -1 do banco bloqueia; erro do banco não bloqueia", async () => {
    const cheio = bancoFalso([], () => ({ data: -1, error: null }));
    expect(await consumirUso(env, "gemini", "notificacoes", 5, { db: cheio.db, agora: new Date("2026-09-24T02:00:00Z") })).toBe(false);
    expect(cheio.rpcs[0]).toMatchObject({ p_provedor: "gemini", p_funcao: "notificacoes", p_dia: "2026-09-23", p_limite: 5 });
    const ok = bancoFalso([], () => ({ data: 3, error: null }));
    expect(await consumirUso(env, "gemini", "notificacoes", 5, { db: ok.db })).toBe(true);
    const semTabela = bancoFalso([], () => ({ data: null, error: { message: "function does not exist" } }));
    expect(await consumirUso(env, "gemini", "notificacoes", 5, { db: semTabela.db })).toBe(true);
  });

  it("catálogo traz credenciais sem valores e a config de cada função", async () => {
    const { db } = bancoFalso([{ provedor: "gemini", funcao: "notificacoes", config: { ativo: false }, versao: 1 }]);
    const c = await catalogo(env, { db });
    const gemini = c.integracoes.find((i) => i.id === "gemini")!;
    expect(gemini.credenciais.map((x) => x.chave)).toContain("api_key");
    for (const i of c.integracoes) for (const cred of i.credenciais) expect(Object.keys(cred).sort()).toEqual(["chave", "label", "obrigatorio"]);
    expect(gemini.funcoes.find((f) => f.id === "notificacoes")).toMatchObject({ config: { ativo: false }, versao: 1 });
  });
});
