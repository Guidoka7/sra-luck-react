import { describe, expect, it } from "vitest";
import { bancoFalso } from "./banco-falso.testutil";
import {
  aplicarMapeamento, chaveTelefone, filtroRdql, importacaoAgendadaSeDevida, importarCrm, importarDoWebhook, importarMesmoAssim, passaNoFiltro, usarPerfilDaDuplicata,
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
    expect(filtroRdql(config({ todosFunis: true, funis: [{ pipelineId: FUNIL, etapas: [ETAPA], mapeamento: { ...PADRAO_CRM.mapeamento } }] }))).toBe("");
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

  it("todos os funis mantêm o mapeamento próprio e usam nome da vendedora, sem herdar o responsável", () => {
    const mapa = { ...PADRAO_CRM.mapeamento, vendedora: "deal:nome-da-vendedora" };
    const cfg = config({ todosFunis: true, status: "won", mapeamento: mapa, funis: [{ pipelineId: FUNIL, etapas: [ETAPA], mapeamento: mapa }] });
    const fora = deal("V1", { pipeline_id: FUNIL2, stage_id: OUTRA, status: "lost", owner_name: "Responsável RD", custom_fields: { "nome-da-vendedora": "Ana Comercial" } });
    const semNome = deal("V2", { owner_name: "Responsável RD" });
    const reuniao = deal("V3", { owner_name: "Responsável RD", custom_fields: { "nome-da-vendedora": "", "vendedora-que-realizou-a-reuniao": "Carla Comercial" } });
    expect(passaNoFiltro(normalizarDealRd(fora)!, cfg)).toBeNull();
    expect(aplicarMapeamento(normalizarDealRd(fora)!, fora, undefined, cfg).vendedora).toBe("Ana Comercial");
    expect(aplicarMapeamento(normalizarDealRd(reuniao)!, reuniao, undefined, cfg).vendedora).toBe("Carla Comercial");
    expect(aplicarMapeamento(normalizarDealRd(semNome)!, semNome, undefined, cfg).vendedora).toBeNull();
  });

  it("telefone: +55, 0055, zero, operadora e DDD normalizados; sem DDD não vira chave", () => {
    const k = "61985701349";
    for (const v of ["+55 (61) 98570-1349", "5561985701349", "0055 61 98570-1349", "(061) 98570-1349", "0 15 61 98570-1349", "61 8570-1349", "+55 61 8570 1349"]) expect(chaveTelefone(v)).toBe(k);
    expect(chaveTelefone("98570-1349")).toBeNull();
    expect(chaveTelefone("")).toBeNull();
  });

  it("telefone: celular com e sem o 9 e com +55 viram a mesma chave; fixo não colide com celular", () => {
    expect(chaveTelefone("(61) 99876-5432")).toBe(chaveTelefone("+55 61 9876-5432"));
    expect(chaveTelefone("5561998765432")).toBe("61998765432");
    expect(chaveTelefone("(61) 3333-4444")).toBe("6133334444");
    expect(chaveTelefone("61 93333-4444")).not.toBe(chaveTelefone("(61) 3333-4444"));
    expect(chaveTelefone("9876")).toBeNull();
  });

  it("preenchimento explícito com origens nativas do RD (responsável, fonte, telefone e e-mail do contato)", () => {
    const U = "1".repeat(24), S = "2".repeat(24);
    const cfg = config({
      funis: [{ pipelineId: FUNIL, etapas: [], mapeamento: {
        ...PADRAO_CRM.mapeamento, vendedora: "deal_field:owner_id", origem: "deal_field:source_id", telefone: "contact_field:phones",
        email: "contact_field:emails", valor_contrato: "deal_field:one_time_price",
      } }],
    });
    const c = contato("N", "Cliente N", "61 99999-1234", "n@x.com");
    const d = deal("N", { owner_id: U, source_id: S, one_time_price: 7777, contact_ids: ["ctN"] });
    const s = normalizarDealRd(d, { contatos: new Map([["ctN", c]]), usuarios: new Map([[U, { id: U, name: "Raissa" }]]), fontes: new Map([[S, { id: S, name: "Instagram" }]]) })!;
    expect(aplicarMapeamento(s, d, c, cfg)).toMatchObject({ vendedora: "Raissa", origem: "Instagram", telefone: "61 99999-1234", email: "n@x.com", valor_contrato: 7777 });
  });

  it("filtros do funil: só importa a vendedora e a opção marcadas", () => {
    const RAISSA = "1".repeat(24), GIOVANA = "2".repeat(24);
    const cfg = config({
      funis: [{ pipelineId: FUNIL, etapas: [], mapeamento: { ...PADRAO_CRM.mapeamento }, filtros: [
        { fonte: "deal_field:owner_id", valores: [RAISSA] },
        { fonte: "deal:tipo-de-venda", valores: ["Consórcio"] },
      ] }],
    });
    const s = (extra: Record<string, unknown>) => normalizarDealRd(deal("X", extra))!;
    expect(passaNoFiltro(s({ owner_id: RAISSA, custom_fields: { "tipo-de-venda": "Consórcio" } }), cfg)).toBeNull();
    expect(passaNoFiltro(s({ owner_id: RAISSA, custom_fields: { "tipo-de-venda": ["Outro", "Consórcio"] } }), cfg)).toBeNull();
    expect(passaNoFiltro(s({ owner_id: GIOVANA, custom_fields: { "tipo-de-venda": "Consórcio" } }), cfg)).toMatch(/responsável/);
    expect(passaNoFiltro(s({ owner_id: RAISSA, custom_fields: { "tipo-de-venda": "Outro" } }), cfg)).toMatch(/tipo-de-venda/);
    expect(passaNoFiltro(s({ custom_fields: { "tipo-de-venda": "Consórcio" } }), cfg)).toMatch(/responsável/);
  });

  it("valida filtros por funil e origens nativas", () => {
    const base = (funil: Record<string, unknown>) => validarConfigCrm({ funis: [{ pipelineId: FUNIL, etapas: [], ...funil }] });
    const ok = base({ filtros: [{ fonte: "deal_field:owner_id", valores: ["a", "a", "b"] }, { fonte: "deal:banco", valores: [] }], mapeamento: { vendedora: "deal_field:owner_id", telefone: "contact_field:phones" } });
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) {
      expect(ok.config.funis[0].filtros).toEqual([{ fonte: "deal_field:owner_id", valores: ["a", "b"] }]);
      expect(ok.config.funis[0].mapeamento).toMatchObject({ vendedora: "deal_field:owner_id", telefone: "contact_field:phones" });
    }
    expect(base({ filtros: [{ fonte: "contact:cpf", valores: ["1"] }] })).toMatchObject({ ok: false });
    expect(base({ filtros: [{ fonte: "deal_field:owner_id", valores: ["a"] }, { fonte: "deal_field:owner_id", valores: ["b"] }] })).toMatchObject({ ok: false });
    expect(base({ filtros: [{ fonte: "deal_field:owner_id", valores: "a" }] })).toMatchObject({ ok: false });
    expect(base({ mapeamento: { cpf: "deal_field:pipeline_id" } })).toMatchObject({ ok: false });
    expect(base({ mapeamento: { cpf: "deal_field:qualquer" } })).toMatchObject({ ok: false });
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

  it("corrige a vendedora no pré cadastro e limpa o valor antigo quando o campo RD está vazio", async () => {
    const { db, tabela } = cenario();
    const venda = tabela("novas_vendas").find((v) => v.id === "nv-1")!;
    venda.vendedora_responsavel = "Responsável antigo";
    const cfg = config({ todosFunis: true, mapeamento: { ...PADRAO_CRM.mapeamento, vendedora: "deal:nome-da-vendedora" } });
    const f = (custom_fields: Record<string, unknown>) => fontes([deal("D-PEND", { owner_name: "Responsável RD", custom_fields })], [contato("D-PEND", "Caio", "61 98888-7777", "")]);
    await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: cfg, fontes: f({ "nome-da-vendedora": "Beatriz Comercial" }) });
    expect(venda.vendedora_responsavel).toBe("Beatriz Comercial");
    await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: cfg, fontes: f({}) });
    expect(venda.vendedora_responsavel).toBeNull();
  });

  it("não conta venda antiga fora dos filtros como atualizada", async () => {
    const { db, tabela } = cenario();
    const cfg = config({ funis: [{ pipelineId: FUNIL, etapas: [ETAPA], mapeamento: { ...PADRAO_CRM.mapeamento }, filtros: [{ fonte: "deal_field:owner_id", valores: ["1".repeat(24)] }] }] });
    const r = await importarCrm(env, { origem: "manual", ator: "admin:1" }, {
      db, config: cfg,
      fontes: fontes([deal("D-PEND", { owner_id: "2".repeat(24) })], [contato("D-PEND", "Caio", "61 98888-7777", "")]),
    });
    expect(r).toMatchObject({ ok: true, totalRd: 1, ignoradas: 1, atualizadas: 0 });
    expect(tabela("novas_vendas").find((v) => v.id === "nv-1")?.rd_snapshot).toBeUndefined();
  });

  it("duplicata é SÓ mesmo telefone: CPF, e-mail e nome iguais não bastam; +55 e zero não enganam", async () => {
    const { db, tabela } = cenario();
    const r = await importarCrm(env, { origem: "manual", ator: "admin:1" }, {
      db, config: config({ deduplicarPor: { cpf: true, telefone: true, email: true } }),
      fontes: fontes(
        [deal("NOVA"), deal("CPF"), deal("FIXO"), deal("D-ANTIGA", { name: "Mudou no RD" }), deal("EMAIL1"), deal("EMAIL2")],
        [contato("NOVA", "Duda Nova", "61 97777-1111", "duda@x.com"), contato("CPF", "Bia de Novo", "61 90000-0000", "outra@x.com", "987.654.321-00"),
          contato("FIXO", "Bia pelo fixo", "+55 (61) 3333-4444", "bia2@x.com"), contato("D-ANTIGA", "Nome RD", "", ""),
          contato("EMAIL1", "Eva Um", "61 91111-2222", "eva@x.com"), contato("EMAIL2", "Eva Dois", "061 93333-4444", "EVA@x.com")],
      ),
    });
    // CPF igual ao de uma cliente e e-mail repetido NÃO são duplicata; telefone fixo com +55 é.
    expect(r).toMatchObject({ ok: true, criadas: 4, clienteExistente: 1, duplicadas: 0, atualizadas: 1, erros: 0 });
    const vendas = tabela("novas_vendas");
    expect(vendas.filter((v) => ["NOVA", "CPF", "EMAIL1", "EMAIL2"].includes(v.rd_station_id)).map((v) => v.status)).toEqual(Array(4).fill("aguardando_cadastro"));
    expect(vendas.find((v) => v.rd_station_id === "FIXO")).toBeUndefined();
    // Venda já cadastrada (tem cliente): status e dados locais preservados, só o snapshot rd_* muda.
    const antiga = vendas.find((v) => v.rd_station_id === "D-ANTIGA")!;
    expect(antiga).toMatchObject({ status: "aguardando_boletos", nome_completo: "Editada no Admin", rd_nome_original: "Nome RD" });
    expect(tabela("clientes")).toHaveLength(1);
    const itens = tabela("integracao_importacao_itens");
    expect(itens.find((i) => i.external_id === "FIXO")).toMatchObject({ resultado: "cliente_existente", correspondencias: [{ tipo: "cliente", id: "cli-1", por: ["telefone"] }] });
  });

  it("mesmo telefone no RD: fica o contato mais completo; os outros viram duplicata dele", async () => {
    const { db, tabela } = cenario();
    const r = await importarCrm(env, { origem: "manual", ator: "admin:1" }, {
      db, config: config(),
      fontes: fontes(
        [deal("P1", { total_price: 0 }), deal("P2", { total_price: 9000, custom_fields: { "quantidade-de-parcelas": "12" } }), deal("P3", { total_price: 0 })],
        [contato("P1", "Karla", "+55 (61) 98570-1349", ""), contato("P2", "Karla", "5561985701349", "karla@x.com", "52998224725"), contato("P3", "Karla", "061 98570 1349", "")],
      ),
    });
    expect(r).toMatchObject({ ok: true, criadas: 1, duplicadas: 2, erros: 0 });
    const criada = tabela("novas_vendas").filter((v) => ["P1", "P2", "P3"].includes(v.rd_station_id));
    expect(criada).toHaveLength(1);
    expect(criada[0]).toMatchObject({ rd_station_id: "P2", email: "karla@x.com", cpf: "52998224725", valor_contrato: 9000, quantidade_parcelas: 12 });
    for (const id of ["P1", "P3"]) {
      expect(tabela("integracao_importacao_itens").find((i) => i.external_id === id)).toMatchObject({ resultado: "duplicada", correspondencias: [{ tipo: "venda", id: criada[0].id, por: ["telefone"] }] });
    }
  });

  it("duplicata vai para a revisão com o perfil mais completo indicado; a venda pendente não muda sozinha", async () => {
    const { db, tabela } = cenario();
    await importarCrm(env, { origem: "manual", ator: "admin:1" }, {
      db, config: config(),
      fontes: fontes([deal("TEL", { total_price: 7000 })], [contato("TEL", "Caio de Novo", "(61) 8888-7777", "caio@x.com", "52998224725")]),
    });
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "TEL")).toBeUndefined();
    expect(tabela("novas_vendas").find((v) => v.id === "nv-1")).toMatchObject({ nome_completo: "Caio Pendente", telefone: "61 98888-7777", email: null, cpf: null });
    const item = tabela("integracao_importacao_itens")[0];
    expect(item).toMatchObject({ resultado: "duplicada", motivo: expect.stringMatching(/mais completa/), correspondencias: [{ tipo: "venda", id: "nv-1", completude: 2 }] });
    expect(item.dados.completude).toBeGreaterThan(2);
    // A equipe escolhe ESTE perfil: os dados dele vão para a venda pendente e os anteriores ficam no log.
    expect(await usarPerfilDaDuplicata(db, item.id, "admin:2")).toMatchObject({ ok: true, vendaId: "nv-1" });
    expect(tabela("novas_vendas").find((v) => v.id === "nv-1")).toMatchObject({ nome_completo: "Caio de Novo", email: "caio@x.com", cpf: "52998224725", valor_contrato: 7000 });
    expect(tabela("logs_alteracoes").find((l) => l.acao === "usou_perfil_duplicata_crm")).toMatchObject({ entidade_id: "nv-1", detalhes: { antes: { nome_completo: "Caio Pendente", email: null } } });
    expect(tabela("integracao_importacao_itens")[0]).toMatchObject({ revisado_por: "admin:2" });
    expect(await usarPerfilDaDuplicata(db, item.id, "admin:2")).toMatchObject({ ok: false, status: 409 });
  });

  it("venda pendente reflete o preenchimento do Console a cada sincronização; edição feita no Admin é preservada", async () => {
    const { db, tabela } = cenario();
    const cfg = (banco: string) => config({ funis: [{ pipelineId: FUNIL, etapas: [], mapeamento: { ...PADRAO_CRM.mapeamento, banco, email: "contact_field:emails" } }] });
    const src = fontes([deal("D-PEND", { custom_fields: { banco: "Banco A", outro_banco: "Banco B" } })], [contato("D-PEND", "Caio Pendente", "61 98888-7777", "caio@rd.com")]);
    await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: cfg("deal:banco"), fontes: src });
    const nv1 = () => tabela("novas_vendas").find((v) => v.id === "nv-1")!;
    expect(nv1()).toMatchObject({ banco_local: "Banco A", email: "caio@rd.com" });
    // A equipe corrige o e-mail no Admin; depois o Console troca a origem do banco.
    nv1().email = "certo@x.com";
    tabela("logs_alteracoes").push({ acao: "editou_venda_local_sem_sync_rd", entidade: "novas_vendas", entidade_id: "nv-1", detalhes: { campos: ["email"] } });
    await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: cfg("deal:outro_banco"), fontes: src });
    expect(nv1()).toMatchObject({ banco_local: "Banco B", email: "certo@x.com" });
  });

  it("contato guardado evita reler no RD: só negociações novas são lidas; o cache fica na venda", async () => {
    const { db, tabela } = cenario();
    const lidos: string[][] = [];
    const base = fontes([deal("C1"), deal("C2")], [contato("C1", "Ana", "61 91111-0001", "a@x.com"), contato("C2", "Bea", "61 91111-0002", "b@x.com")]);
    const todos = new Map([contato("C1", "Ana", "61 91111-0001", "a@x.com"), contato("C2", "Bea", "61 91111-0002", "b@x.com"), contato("C3", "Cris", "61 91111-0003", "c@x.com")].map((c) => [c.id, c]));
    const comLeitura = (deals: Record<string, unknown>[]) => ({ ...base, deals: async () => deals as never[], contatos: async (ids: string[]) => { lidos.push(ids); return { contatos: new Map(ids.filter((i) => todos.has(i)).map((i) => [i, todos.get(i)!])), falhas: new Set<string>() }; } });
    await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: config(), fontes: comLeitura([deal("C1"), deal("C2")]) });
    expect(lidos[0].sort()).toEqual(["ctC1", "ctC2"]);
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "C1")!.rd_snapshot._sra_contato).toMatchObject({ dados: { id: "ctC1", name: "Ana" }, lidoEm: expect.any(String) });
    await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: config(), fontes: comLeitura([deal("C1"), deal("C2"), deal("C3")]) });
    expect(lidos[1]).toEqual(["ctC3"]);
    // A venda existente continua com telefone/e-mail (vindos do cache), não apagados.
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "C1")).toMatchObject({ telefone: "61 91111-0001", email: "a@x.com" });
  });

  it("limite do RD (429) não vira erro nem pendência: nova fica para a próxima sincronização, existente mantém os dados", async () => {
    const { db, tabela } = cenario();
    const f = { ...fontes([deal("NOVA429"), deal("D-PEND")], []), contatos: async (ids: string[]) => ({ contatos: new Map(), falhas: new Set<string>(), limitadas: new Set(ids) }) };
    const r = await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: config(), fontes: f });
    expect(r).toMatchObject({ ok: true, criadas: 0, erros: 0, adiadas: 1 });
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "NOVA429")).toBeUndefined();
    expect(tabela("novas_vendas").find((v) => v.id === "nv-1")).toMatchObject({ telefone: "61 98888-7777", nome_completo: "Caio Pendente" });
    expect(tabela("integracao_pendencias")).toHaveLength(0);
  });

  it("contato removido no RD (404) não impede a importação da negociação; nada se perde", async () => {
    const { db, tabela } = cenario();
    const f = { ...fontes([deal("SEMCT", { contact_name: "Nome na negociação" }), deal("D-PEND")], []), contatos: async () => ({ contatos: new Map(), falhas: new Set(["ctSEMCT", "ctD-PEND"]) }) };
    const r = await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: config(), fontes: f });
    expect(r).toMatchObject({ ok: true, criadas: 1, erros: 0 });
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "SEMCT")).toMatchObject({ status: "aguardando_cadastro", nome_completo: "Nome na negociação" });
    // Venda existente sem contato: mantém o que tinha.
    expect(tabela("novas_vendas").find((v) => v.id === "nv-1")).toMatchObject({ telefone: "61 98888-7777", nome_completo: "Caio Pendente" });
  });

  it("lê TODOS os contatos pendentes (sem cota) e adia só o que não coube no prazo", async () => {
    const { db, tabela } = cenario();
    const deals = Array.from({ length: 150 }, (_, i) => deal(`L${i}`));
    const pedidos: string[][] = [];
    const f = { ...fontes(deals, []), contatos: async (ids: string[]) => { pedidos.push(ids); return { contatos: new Map(ids.map((id) => [id, contato(id.slice(2), `Pessoa ${id}`, `61 9${String(10000000 + Number(id.slice(3))).slice(0, 8)}`, "")])), falhas: new Set<string>() }; } };
    const r = await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: config(), fontes: f });
    // Uma leitura por página de 100 negociações, sem cota.
    expect(pedidos.map((p) => p.length)).toEqual([100, 50]);
    expect(r).toMatchObject({ ok: true, criadas: 150, adiadas: 0, passada: { concluida: true, lidas: 150 } });
    expect(tabela("novas_vendas").filter((v) => String(v.rd_station_id).startsWith("L"))).toHaveLength(150);
  });

  describe("importação em etapas (todos os funis, milhares de negociações)", () => {
    const criadaEm = (i: number) => new Date(Date.UTC(2024, 0, 1) + Math.floor(i / 3) * 1000).toISOString();
    const muitas = (n: number) => Array.from({ length: n }, (_, i) => deal(`E${i}`, { created_at: criadaEm(i), contact_ids: [] }));
    /** Fonte paginada como o RD: ordem de criação, `created_at >= desde` com precisão de segundo. */
    const paginado = (deals: Record<string, unknown>[], aoLer: (filtro: string, desde: string | null, pagina: number) => void = () => undefined) => ({
      ...fontes([], []),
      pagina: async (filtro: string, desde: string | null, pagina: number) => {
        aoLer(filtro, desde, pagina);
        const seg = (v: unknown) => new Date(String(v)).toISOString().slice(0, 19).replace("T", " ");
        const a = desde ? deals.filter((d) => seg(d.created_at) >= desde) : deals;
        return a.slice((pagina - 1) * 100, pagina * 100) as never[];
      },
    });

    it("continua de onde parou, sem pular nem repetir negociações, e fecha a passada", async () => {
      const { db, tabela } = cenario();
      const deals = muitas(350);
      let t = 0;
      const consultas: (string | null)[] = [];
      // Cada página "custa" 90 s: cabem 3 páginas por execução de 200 s.
      const f = paginado(deals, (_f, desde) => { consultas.push(desde); t += 90_000; });
      const cfg = config({ todosFunis: true, status: "qualquer" });
      const r1 = await importarCrm(env, { origem: "agendada", ator: "sistema" }, { db, config: cfg, fontes: f, relogio: () => t });
      // Páginas seguintes começam no segundo da última lida (3 por segundo): 100 + 99 + 99.
      expect(r1).toMatchObject({ ok: true, criadas: 298, passada: { concluida: false, lidas: 298 } });
      t = 0;
      const r2 = await importarCrm(env, { origem: "agendada", ator: "sistema" }, { db, config: cfg, fontes: f, relogio: () => t });
      expect(r2).toMatchObject({ ok: true, criadas: 52, passada: { concluida: true, lidas: 350, execucoes: 2 } });
      const importadas = tabela("novas_vendas").filter((v) => String(v.rd_station_id).startsWith("E"));
      expect(importadas).toHaveLength(350);
      expect(new Set(importadas.map((v) => v.rd_station_id)).size).toBe(350);
      // Cada consulta começa na data da última lida: nunca passa do limite de 10 mil do RD.
      expect(consultas[0]).toBeNull();
      expect(consultas[1]).toBe(criadaEm(99).slice(0, 19).replace("T", " "));
      // Passada fechada: a próxima recomeça do início e só atualiza.
      t = 0;
      const r3 = await importarCrm(env, { origem: "agendada", ator: "sistema" }, { db, config: cfg, fontes: f, relogio: () => t });
      expect(r3).toMatchObject({ ok: true, criadas: 0, passada: { concluida: false, execucoes: 1 } });
    });

    it("mais de 100 negociações no mesmo segundo: avança pela página, sem laço infinito", async () => {
      const { db, tabela } = cenario();
      const deals = Array.from({ length: 250 }, (_, i) => deal(`S${i}`, { created_at: "2025-05-05T05:05:05.000Z", contact_ids: [] }));
      const r = await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: config({ todosFunis: true, status: "qualquer" }), fontes: paginado(deals) });
      expect(r).toMatchObject({ ok: true, criadas: 250, passada: { concluida: true } });
      expect(tabela("novas_vendas").filter((v) => String(v.rd_station_id).startsWith("S"))).toHaveLength(250);
    });

    it("contato de negociação nova não lido (limite do RD): a página é relida na próxima execução, nada se perde", async () => {
      const { db, tabela } = cenario();
      const deals = [deal("N1", { created_at: "2026-01-01T00:00:00Z" }), deal("N2", { created_at: "2026-01-02T00:00:00Z" })];
      const todos = new Map([contato("N1", "Ana", "61 91111-1111", ""), contato("N2", "Bia", "61 92222-2222", "")].map((c) => [c.id, c]));
      let limitar = true;
      const f = { ...paginado(deals), contatos: async (ids: string[]) => limitar
        ? { contatos: new Map([["ctN1", todos.get("ctN1")!]]), falhas: new Set<string>(), limitadas: new Set(ids.filter((i) => i !== "ctN1")) }
        : { contatos: new Map(ids.map((i) => [i, todos.get(i)!])), falhas: new Set<string>() } };
      const cfg = config({ todosFunis: true, status: "qualquer" });
      const r1 = await importarCrm(env, { origem: "agendada", ator: "sistema" }, { db, config: cfg, fontes: f });
      expect(r1).toMatchObject({ ok: true, criadas: 1, adiadas: 1, passada: { concluida: false } });
      limitar = false;
      const r2 = await importarCrm(env, { origem: "agendada", ator: "sistema" }, { db, config: cfg, fontes: f });
      expect(r2).toMatchObject({ ok: true, criadas: 1, adiadas: 0, passada: { concluida: true } });
      expect(tabela("novas_vendas").find((v) => v.rd_station_id === "N2")).toMatchObject({ telefone: "61 92222-2222" });
    });

    it("RD recusa o filtro por data: segue pelo número da página", async () => {
      const { db, tabela } = cenario();
      const deals = muitas(150);
      const base = paginado(deals);
      const f = { ...base, pagina: async (filtro: string, desde: string | null, pagina: number) => {
        if (desde) throw new Error("RD_HTTP_400");
        return base.pagina(filtro, null, pagina);
      } };
      const r = await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: config({ todosFunis: true, status: "qualquer" }), fontes: f });
      expect(r).toMatchObject({ ok: true, criadas: 150, passada: { concluida: true } });
      expect(tabela("novas_vendas").filter((v) => String(v.rd_station_id).startsWith("E"))).toHaveLength(150);
    });

    it("configuração nova recomeça a passada; agendador continua passada em andamento sem esperar a frequência", async () => {
      const { db, tabela } = cenario();
      const { limparCacheConfig } = await import("./integracoes-registro");
      tabela("integracoes_config").push({ provedor: "rd_station", funcao: "importacao", config: { ativo: true, frequenciaMinutos: 60, todosFunis: true, status: "qualquer" }, versao: 1 });
      limparCacheConfig();
      expect(await importacaoAgendadaSeDevida(env, { db, fontes: paginado([]), somenteContinuacao: true })).toMatchObject({ executada: false, motivo: "sem_passada_em_andamento" });
      tabela("integracao_catalogos").push({ provedor: "rd_station", chave: "crm_importacao_progresso", dados: { passada: "p1", iniciadaEm: "2026-09-24T12:00:00Z", concluidaEm: null, assinatura: "", segmentos: [""], indice: 0, desde: null, pagina: 1, tentativas: 0, lidas: 0, execucoes: 1 } });
      tabela("integracao_importacoes").push({ id: "imp-0", provedor: "rd_station", origem: "agendada", status: "concluida", iniciado_em: new Date().toISOString() });
      expect(await importacaoAgendadaSeDevida(env, { db, fontes: paginado([deal("CONT", { contact_ids: [] })]), somenteContinuacao: true })).toMatchObject({ executada: true });
      expect(tabela("novas_vendas").find((v) => v.rd_station_id === "CONT")).toBeTruthy();
      // Outra configuração (outro filtro): a passada antiga não é reaproveitada.
      tabela("integracao_catalogos")[0].dados = { ...tabela("integracao_catalogos")[0].dados, concluidaEm: null, assinatura: "pipeline_id:x", indice: 0 };
      const r = await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: config({ todosFunis: true, status: "qualquer" }), fontes: paginado([]) });
      expect(r).toMatchObject({ ok: true, passada: { concluida: true, execucoes: 1 } });
      limparCacheConfig();
    });
  });

  it("origem da cliente: completa fonte e campanha com a negociação de entrada do mesmo contato; nada inventado", async () => {
    const { db, tabela } = cenario();
    const SRC = "f".repeat(24), CAMP = "9".repeat(24);
    const refsComNomes = async () => ({ contatos: [contato("O1", "Olga", "61 95555-0001", ""), contato("O2", "Otília", "61 95555-0002", "")] as never[], usuarios: [], campanhas: [{ id: CAMP, name: "Black Friday" }] as never[], fontes: [{ id: SRC, name: "Redes Sociais" }] as never[], funis: [{ id: FUNIL2, name: "Vendas" }] as never[] });
    const lead = { id: "LEAD-O1", pipeline_id: FUNIL2, contact_ids: ["ctO1"], created_at: "2025-01-01T00:00:00Z", source_id: SRC, campaign_id: CAMP, custom_fields: {} };
    const pedidos: string[][] = [];
    const f = {
      ...fontes([deal("O1"), deal("O2")], []),
      refs: refsComNomes,
      dealsDosContatos: async (ids: string[]) => { pedidos.push(ids); return [lead, deal("O1"), deal("O2")] as never[]; },
    };
    const cfg = config({ status: "qualquer", mapeamento: { ...PADRAO_CRM.mapeamento, origem: "deal_field:source_id", campanha: "deal_field:campaign_id" } });
    const r = await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: cfg, fontes: f });
    expect(r).toMatchObject({ ok: true, criadas: 2, origens: { encontrada: 1, sem_registro_no_rd: 1 } });
    // Uma consulta em lote para os contatos da página.
    expect(pedidos).toEqual([["ctO1", "ctO2"]]);
    const o1 = tabela("novas_vendas").find((v) => v.rd_station_id === "O1")!;
    expect(o1).toMatchObject({ origem_venda: "Redes Sociais", campanha_local: "Black Friday" });
    expect(o1.rd_snapshot._sra_origem).toMatchObject({ situacao: "encontrada", evidencias: [expect.objectContaining({ negociacao: expect.objectContaining({ id: "LEAD-O1", funil: "Vendas" }) }), expect.anything()] });
    const o2 = tabela("novas_vendas").find((v) => v.rd_station_id === "O2")!;
    expect(o2).toMatchObject({ origem_venda: null, campanha_local: null });
    expect(o2.rd_snapshot._sra_origem).toMatchObject({ situacao: "sem_registro_no_rd" });
    // Falha na consulta das outras negociações: mantém a origem já guardada.
    const falha = { ...f, dealsDosContatos: async () => { throw new Error("RD_HTTP_500"); } };
    const r2 = await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: cfg, fontes: falha });
    expect(r2).toMatchObject({ ok: true, origens: { nao_verificada: 2 } });
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "O1")!.rd_snapshot._sra_origem).toMatchObject({ situacao: "encontrada", fonte: "Redes Sociais" });
    // "Ignorar" no Console é respeitado.
    const { db: db2, tabela: t2 } = cenario();
    await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db: db2, config: config({ status: "qualquer", mapeamento: { ...PADRAO_CRM.mapeamento, origem: "ignorar", campanha: "ignorar" } }), fontes: f });
    expect(t2("novas_vendas").find((v) => v.rd_station_id === "O1")).toMatchObject({ origem_venda: null, campanha_local: null });
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
    await importarCrm(env, { origem: "manual", ator: "admin:1" }, { db, config: config(), fontes: fontes([deal("CPF")], [contato("CPF", "Bia de Novo", "+55 61 3333-4444", "", "98765432100")]) });
    const item = tabela("integracao_importacao_itens")[0];
    expect(item).toMatchObject({ resultado: "cliente_existente" });
    expect(await importarMesmoAssim(db, item.id, "admin:2")).toMatchObject({ ok: true });
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "CPF")).toMatchObject({ status: "aguardando_cadastro", nome_completo: "Bia de Novo" });
    expect(tabela("integracao_importacao_itens")[0]).toMatchObject({ resultado: "importada_apos_revisao", revisado_por: "admin:2" });
    expect(await importarMesmoAssim(db, item.id, "admin:2")).toMatchObject({ ok: false, status: 409 });
  });

  it("webhook no formato antigo do RD (v1): relê a negociação na v2 e respeita só os funis marcados", async () => {
    const { db, tabela } = cenario();
    const { limparCacheConfig } = await import("./integracoes-registro");
    tabela("integracoes_config").push({ provedor: "rd_station", funcao: "importacao", config: { status: "qualquer", funis: [{ pipelineId: FUNIL, etapas: [], mapeamento: { ...PADRAO_CRM.mapeamento, banco: "deal:banco" } }] }, versao: 1 });
    limparCacheConfig();
    const v1 = (id: string, funil: string) => ({ id, name: `V1 ${id}`, deal_pipeline: { id: funil, name: "Funil" }, deal_stage: { id: ETAPA }, user: { id: "u".repeat(24), name: "Raissa" }, deal_custom_fields: [{ value: "BRB", custom_field: { id: "x", label: "Banco" } }] });
    const contatos = async (ids: string[]) => ({ contatos: new Map(ids.map((i) => [i, contato(i.slice(2), "Pessoa V1", "61 97777-0000", "")])), falhas: new Set<string>() });
    // Outro funil (ex.: Inadimplentes), com a leitura v2 indisponível: o funil vem do evento e a negociação é ignorada.
    const fora = await importarDoWebhook(env, db, v1("V1FORA", FUNIL2), "t1", { contatos, lerDeal: async () => null });
    expect(fora?.item).toMatchObject({ resultado: "ignorada", motivo: "Fora dos funis configurados." });
    // Funil marcado: usa a negociação da v2 (campos por slug e contato).
    const dentro = await importarDoWebhook(env, db, v1("V1DENTRO", FUNIL), "t2", { contatos, lerDeal: async (id) => deal(id, { status: "ongoing", custom_fields: { banco: "Banco V2" } }) });
    expect(dentro?.item.resultado).toBe("criada");
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "V1DENTRO")).toMatchObject({ rd_pipeline_id: FUNIL, banco_local: "Banco V2", telefone: "61 97777-0000" });
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "V1FORA")).toBeUndefined();
    limparCacheConfig();
  });

  it("webhook usa o mesmo filtro e a mesma deduplicação", async () => {
    const { db, tabela } = cenario();
    const cfgRow = { provedor: "rd_station", funcao: "importacao", config: { pipelineId: FUNIL, etapas: [ETAPA] }, versao: 1 };
    tabela("integracoes_config").push(cfgRow);
    const lidos: string[][] = [];
    const contatos = async (ids: string[]) => { lidos.push(ids); return { contatos: new Map(ids.filter((id) => id === "ctW2").map((id) => [id, contato("W2", "Gabi Webhook", "+55 61 99999-8888", "gabi@x.com")])), falhas: new Set(ids.filter((id) => id === "ctW3")) }; };
    const fora = await importarDoWebhook(env, db, deal("W1", { stage_id: OUTRA, name: "Fora" }), "t1", { contatos });
    expect(fora?.item.resultado).toBe("ignorada");
    const dentro = await importarDoWebhook(env, db, deal("W2"), "t2", { contatos });
    expect(dentro?.item.resultado).toBe("criada");
    expect(tabela("novas_vendas").find((v) => v.rd_station_id === "W2")).toMatchObject({ status: "aguardando_cadastro", nome_completo: "Gabi Webhook", telefone: "+55 61 99999-8888" });
    // O evento só traz a negociação: o contato é lido pelo id; sem ele, nada é gravado.
    expect(lidos).toContainEqual(["ctW2"]);
    // Contato removido no RD: a negociação entra mesmo assim, com os dados dela.
    expect((await importarDoWebhook(env, db, deal("W3", { contact_name: "W3 sem contato" }), "t3", { contatos }))?.item.resultado).toBe("criada");
    // Mesmo telefone em outro formato: duplicata.
    const w4 = await importarDoWebhook(env, db, deal("W4"), "t4", { contatos: async () => ({ contatos: new Map([["ctW4", contato("W4", "Gabi", "061 99999 8888", "")]]), falhas: new Set() }) });
    expect(w4?.item.resultado).toBe("duplicada");
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
