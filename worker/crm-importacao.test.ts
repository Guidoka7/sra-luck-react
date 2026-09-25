import { describe, expect, it } from "vitest";
import { bancoFalso } from "./banco-falso.testutil";
import {
  aplicarMapeamento, chaveTelefone, filtroRdql, importacaoAgendadaSeDevida, importarCrm, importarDoWebhook, importarMesmoAssim, passaNoFiltro,
} from "./crm-importacao";
import { PADRAO_CRM, validarConfigCrm, type ConfigCrm } from "./integracoes-registro";
import { normalizarDealRd } from "./rd-station-readonly";
import type { Env } from "./supabase";

const env = {} as Env;
const FUNIL = "a".repeat(24), ETAPA = "b".repeat(24), OUTRA = "c".repeat(24), FUNIL2 = "d".repeat(24), ETAPA2 = "e".repeat(24);
const config = (parcial: Partial<ConfigCrm> = {}): ConfigCrm => ({ ...PADRAO_CRM, mapeamento: { ...PADRAO_CRM.mapeamento }, deduplicarPor: { ...PADRAO_CRM.deduplicarPor }, ...parcial });

const deal = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `Negociação ${id}`, status: "won", pipeline_id: FUNIL, stage_id: ETAPA, contact_ids: [`ct${id}`], total_price: 5000,
  created_at: "2026-09-20T10:00:00Z", custom_fields: {}, ...extra,
});
const contato = (id: string, nome: string, telefone: string, email: string, cpf?: string) => ({
  id: `ct${id}`, name: nome, phones: [{ phone: telefone }], emails: [{ email }], custom_fields: cpf ? { cpf } : {},
});
const fontes = (deals: Record<string, unknown>[], contatos: Record<string, unknown>[]) => ({
  deals: async () => deals as never[],
  refs: async () => ({ contatos: contatos as never[], usuarios: [], campanhas: [], fontes: [] }),
});

describe("configuração do CRM", () => {
  it("filtro RDQL com funil, etapas e status", () => {
    expect(filtroRdql(config({ pipelineId: FUNIL, etapas: [ETAPA, OUTRA] }))).toBe(`pipeline_id:${FUNIL} stage_id:(${ETAPA},${OUTRA}) status:won`);
    expect(filtroRdql(config({ status: "qualquer" }))).toBe("");
  });

  it("valida funil, etapas, fontes e frequência", () => {
    expect(validarConfigCrm({ etapas: [ETAPA] })).toMatchObject({ ok: false });
    expect(validarConfigCrm({ pipelineId: "x" })).toMatchObject({ ok: false });
    expect(validarConfigCrm({ mapeamento: { cpf: "deal:cpf; drop" } })).toMatchObject({ ok: false });
    expect(validarConfigCrm({ mapeamento: { senha: "auto" } })).toMatchObject({ ok: false });
    expect(validarConfigCrm({ frequenciaMinutos: 7 })).toMatchObject({ ok: false });
    const ok = validarConfigCrm({ ativo: true, frequenciaMinutos: 30, pipelineId: FUNIL, etapas: [ETAPA], mapeamento: { cpf: "contact:cpf", banco: "ignorar" } });
    expect(ok).toMatchObject({ ok: true, config: { ativo: true, frequenciaMinutos: 30, mapeamento: { cpf: "contact:cpf", banco: "ignorar", email: "auto" } } });
  });

  it("mapeamento: campo personalizado da negociação/contato, ignorar e automático", () => {
    const d = deal("1", { custom_fields: { parcelas_contrato: "12", banco_cliente: "BRB" } });
    const c = contato("1", "Ana Souza", "61 99876-5432", "ANA@EXEMPLO.COM", "123.456.789-09");
    const s = normalizarDealRd(d, { contatos: new Map([["ct1", c]]) })!;
    const v = aplicarMapeamento(s, d, c, config({ mapeamento: { ...PADRAO_CRM.mapeamento, quantidade_parcelas: "deal:parcelas_contrato", cpf: "contact:cpf", telefone: "ignorar" } }));
    expect(v).toMatchObject({ nome: "Ana Souza", cpf: "12345678909", telefone: null, email: "ana@exemplo.com", quantidade_parcelas: 12, banco: "BRB", valor_contrato: 5000 });
  });

  it("aceita vários funis com etapas e preenchimentos independentes", () => {
    const base = { ...PADRAO_CRM.mapeamento };
    const r = validarConfigCrm({
      ativo: true,
      frequenciaMinutos: 15,
      status: "won",
      mapeamento: base,
      funis: [
        { pipelineId: FUNIL, etapas: [ETAPA], mapeamento: { cpf: "contact:cpf", banco: "ignorar" } },
        { pipelineId: FUNIL2, etapas: [ETAPA2], mapeamento: { cpf: "ignorar", banco: "deal:banco_especial" } },
      ],
      deduplicarPor: { cpf: true, telefone: true, email: true },
    });
    expect(r).toMatchObject({
      ok: true,
      config: {
        pipelineId: null,
        etapas: [],
        funis: [
          { pipelineId: FUNIL, etapas: [ETAPA], mapeamento: { cpf: "contact:cpf", banco: "ignorar", email: "auto" } },
          { pipelineId: FUNIL2, etapas: [ETAPA2], mapeamento: { cpf: "ignorar", banco: "deal:banco_especial", email: "auto" } },
        ],
      },
    });
    expect(validarConfigCrm({
      funis: [
        { pipelineId: FUNIL, etapas: [], mapeamento: {} },
        { pipelineId: FUNIL, etapas: [], mapeamento: {} },
      ],
    })).toMatchObject({ ok: false });
  });

  it("aplica o preenchimento específico do funil da negociação", () => {
    const cfg = config({
      funis: [
        { pipelineId: FUNIL, etapas: [ETAPA], mapeamento: { ...PADRAO_CRM.mapeamento, cpf: "contact:cpf", banco: "ignorar" } },
        { pipelineId: FUNIL2, etapas: [ETAPA2], mapeamento: { ...PADRAO_CRM.mapeamento, cpf: "ignorar", banco: "deal:banco_especial" } },
      ],
    });
    const c1 = contato("F1", "Cliente Um", "61 99999-0001", "um@x.com", "12345678909");
    const d1 = deal("F1");
    const s1 = normalizarDealRd(d1, { contatos: new Map([["ctF1", c1]]) })!;
    expect(aplicarMapeamento(s1, d1, c1, cfg)).toMatchObject({ cpf: "12345678909", banco: null });

    const d2 = deal("F2", {
      pipeline_id: FUNIL2,
      stage_id: ETAPA2,
      contact_ids: ["ctF2"],
      custom_fields: { banco_especial: "Banco Dois" },
    });
    const c2 = contato("F2", "Cliente Dois", "61 99999-0002", "dois@x.com", "98765432100");
    const s2 = normalizarDealRd(d2, { contatos: new Map([["ctF2", c2]]) })!;
    expect(aplicarMapeamento(s2, d2, c2, cfg)).toMatchObject({ cpf: null, banco: "Banco Dois" });
    expect(passaNoFiltro(s2, cfg)).toBeNull();
    expect(passaNoFiltro(normalizarDealRd(deal("F3", { pipeline_id: "f".repeat(24) }))!, cfg)).toMatch(/funis/);
  });

  it("telefone: celular com e sem o 9 e com +55 viram a mesma chave; fixo não colide com celular", () => {
    expect(chaveTelefone("(61) 99876-5432")).toBe(chaveTelefone("+55 61 9876-5432"));
    expect(chaveTelefone("5561998765432")).toBe("61998765432");
    expect(chaveTelefone("(61) 3333-4444")).toBe("6133334444");
    expect(chaveTelefone("61 93333-4444")).not.toBe(chaveTelefone("(61) 3333-4444"));
    expect(chaveTelefone("9876")).toBeNull();
  });

  it("webhook fora do funil ou da etapa é ignorado", () => {
    const s = normalizarDealRd(deal("9", { stage_id: OUTRA }))!;
    expect(passaNoFiltro(s, config({ pipelineId: FUNIL, etapas: [ETAPA] }))).toMatch(/etapas/);
  });
});

describe("importação", () => {
  const cenario = () => bancoFalso({
    clientes: [{ id: "cli-1", nome_completo: "Bia Existente", cpf: "98765432100", telefone: "(61) 3333-4444", email: "bia@x.com", arquivado_em: null }],
    novas_vendas: [
      { id: "nv-1", rd_station_id: "D-PEND", cliente_id: null, nome_completo: "Caio Pendente", cpf: null, telefone: "61 98888-7777", email: null, status: "aguardando_cadastro" },
      { id: "nv-2", rd_station_id: "D-ANTIGA", cliente_id: "cli-9", nome_completo: "Editada no Admin", cpf: null, telefone: null, email: null, status: "aguardando_boletos" },
    ],
  });

  it("nova vai para Aguardando cadastro; duplicidades não viram venda e nada é sobrescrito", async () => {
    const { db, tabela } = cenario();
    const r = await importarCrm(env, { origem: "manual", ator: "admin:1" }, {
      db, config: config(),
      fontes: fontes(
        [deal("NOVA"), deal("CPF"), deal("TEL"), deal("D-ANTIGA", { name: "Mudou no RD" }), deal("EMAIL1"), deal("EMAIL2")],
        [contato("NOVA", "Duda Nova", "61 97777-1111", "duda@x.com"), contato("CPF", "Bia de Novo", "61 90000-0000", "outra@x.com", "987.654.321-00"),
          contato("TEL", "Caio de Novo", "(61) 8888-7777", "caio@x.com"), contato("D-ANTIGA", "Nome RD", "", ""),
          contato("EMAIL1", "Eva Um", "61 91111-2222", "eva@x.com"), contato("EMAIL2", "Eva Dois", "61 93333-4444", "EVA@x.com")],
      ),
    });
    expect(r).toMatchObject({ ok: true, criadas: 2, clienteExistente: 1, duplicadas: 2, atualizadas: 1, erros: 0 });
    const vendas = tabela("novas_vendas");
    const novas = vendas.filter((v) => ["NOVA", "EMAIL1"].includes(v.rd_station_id));
    expect(novas.map((v) => v.status)).toEqual(["aguardando_cadastro", "aguardando_cadastro"]);
    expect(vendas.find((v) => v.rd_station_id === "CPF")).toBeUndefined();
    expect(vendas.find((v) => v.rd_station_id === "TEL")).toBeUndefined();
    expect(vendas.find((v) => v.rd_station_id === "EMAIL2")).toBeUndefined();
    // Venda existente: status e dados locais preservados, só o snapshot rd_* muda.
    const antiga = vendas.find((v) => v.rd_station_id === "D-ANTIGA")!;
    expect(antiga).toMatchObject({ status: "aguardando_boletos", nome_completo: "Editada no Admin", rd_nome_original: "Nome RD" });
    // Nunca cria cliente.
    expect(tabela("clientes")).toHaveLength(1);
    const itens = tabela("integracao_importacao_itens");
    expect(itens.find((i) => i.external_id === "CPF")).toMatchObject({ resultado: "cliente_existente", correspondencias: [{ tipo: "cliente", id: "cli-1", por: ["cpf"] }] });
    expect(itens.find((i) => i.external_id === "TEL")).toMatchObject({ resultado: "duplicada", correspondencias: [{ tipo: "venda", id: "nv-1", por: ["telefone"] }] });
    expect(tabela("integracao_importacoes")[0]).toMatchObject({ origem: "manual", status: "concluida", totais: { criadas: 2 } });
  });

  it("consulta vários funis e preserva o mapeamento de cada um", async () => {
    const { db, tabela } = cenario();
    const chamados: string[] = [];
    const cfg = config({
      funis: [
        { pipelineId: FUNIL, etapas: [ETAPA], mapeamento: { ...PADRAO_CRM.mapeamento, banco: "ignorar" } },
        { pipelineId: FUNIL2, etapas: [ETAPA2], mapeamento: { ...PADRAO_CRM.mapeamento, banco: "deal:banco_especial" } },
      ],
    });
    const f = {
      deals: async (filtro: string) => {
        chamados.push(filtro);
        return filtro.includes(FUNIL2)
          ? [deal("MF2", { pipeline_id: FUNIL2, stage_id: ETAPA2, contact_ids: [], custom_fields: { banco_especial: "Banco Funil 2" } })] as never[]
          : [deal("MF1", { contact_ids: [], custom_fields: { banco_especial: "Ignorado" } })] as never[];
      },
      refs: async () => ({ contatos: [], usuarios: [], campanhas: [], fontes: [] }),
    };
    const r = await importarCrm(env, { origem: "manual", ator: "admin:multi" }, { db, config: cfg, fontes: f });
    expect(r).toMatchObject({ ok: true, criadas: 2, erros: 0 });
    expect(chamados).toHaveLength(2);
    expect(chamados).toContain(`pipeline_id:${FUNIL} stage_id:(${ETAPA}) status:won`);
    expect(chamados).toContain(`pipeline_id:${FUNIL2} stage_id:(${ETAPA2}) status:won`);
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "MF1")).toMatchObject({ banco_local: null });
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "MF2")).toMatchObject({ banco_local: "Banco Funil 2" });
  });

  it("deduplicação desligada por chave", async () => {
    const { db, tabela } = cenario();
    await importarCrm(env, { origem: "manual", ator: "admin:1" }, {
      db, config: config({ deduplicarPor: { cpf: true, telefone: false, email: true } }),
      fontes: fontes([deal("TEL")], [contato("TEL", "Caio de Novo", "(61) 8888-7777", "caio@x.com")]),
    });
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "TEL")).toMatchObject({ status: "aguardando_cadastro" });
  });

  it("revisão humana: importar mesmo assim cria em Aguardando cadastro", async () => {
    const { db, tabela } = cenario();
    await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: config(), fontes: fontes([deal("CPF")], [contato("CPF", "Bia de Novo", "", "", "98765432100")]) });
    const item = tabela("integracao_importacao_itens")[0];
    expect(await importarMesmoAssim(db, item.id, "admin:2")).toMatchObject({ ok: true });
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "CPF")).toMatchObject({ status: "aguardando_cadastro", nome_completo: "Bia de Novo" });
    expect(tabela("integracao_importacao_itens")[0]).toMatchObject({ resultado: "importada_apos_revisao", revisado_por: "admin:2" });
    expect(await importarMesmoAssim(db, item.id, "admin:2")).toMatchObject({ ok: false, status: 409 });
  });

  it("webhook usa o mesmo filtro e a mesma deduplicação", async () => {
    const { db, tabela } = cenario();
    const cfgRow = { provedor: "rd_station", funcao: "importacao", config: { pipelineId: FUNIL, etapas: [ETAPA] }, versao: 1 };
    tabela("integracoes_config").push(cfgRow);
    const fora = await importarDoWebhook(env, db, deal("W1", { stage_id: OUTRA, name: "Fora" }), "t1");
    expect(fora?.item.resultado).toBe("ignorada");
    const dentro = await importarDoWebhook(env, db, deal("W2", { contact_name: "Gabi Webhook" }), "t2");
    expect(dentro?.item.resultado).toBe("criada");
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "W2")).toMatchObject({ status: "aguardando_cadastro" });
  });

  it("agendada: só roda ligada e quando a frequência venceu", async () => {
    const { db, tabela } = cenario();
    const f = fontes([], []);
    expect(await importacaoAgendadaSeDevida(env, { db, fontes: f })).toMatchObject({ executada: false, motivo: "desligada" });
    tabela("integracoes_config").push({ provedor: "rd_station", funcao: "importacao", config: { ativo: true, frequenciaMinutos: 60 }, versao: 1 });
    tabela("integracao_importacoes").push({ id: "imp-0", provedor: "rd_station", origem: "agendada", iniciado_em: "2026-09-24T12:00:00.000Z" });
    const { limparCacheConfig } = await import("./integracoes-registro");
    limparCacheConfig();
    expect(await importacaoAgendadaSeDevida(env, { db, fontes: f, agora: new Date("2026-09-24T12:30:00Z") })).toMatchObject({ executada: false, motivo: "ainda_nao_venceu" });
    expect(await importacaoAgendadaSeDevida(env, { db, fontes: f, agora: new Date("2026-09-24T13:00:00Z") })).toMatchObject({ executada: true });
  });
});
