import { beforeEach, describe, expect, it } from "vitest";
import { bancoFalso } from "./banco-falso.testutil";
import { atualizarCatalogoCrm, atualizarCatalogoSeVencido, catalogoCrm, CATALOGO_VALIDADE_MS, limparCatalogoEmMemoria, montarCatalogoCrm, type LeitorRd } from "./crm-catalogo";
import { PADRAO_CRM } from "./integracoes-registro";
import type { Env } from "./supabase";

const env = {} as Env;
const F1 = "a".repeat(24), F2 = "b".repeat(24);
const U1 = "1".repeat(24), U2 = "2".repeat(24), U3 = "3".repeat(24), S1 = "4".repeat(24), C1 = "5".repeat(24);
const K1 = "6".repeat(24), K2 = "7".repeat(24);

type Chamada = { tipo: "get" | "listar"; alvo: string };

function rdFalso(opcoes: { semOrdenacao?: boolean; falhar?: boolean } = {}) {
  const chamadas: Chamada[] = [];
  const listas: Record<string, any[]> = {
    pipelines: [{ id: F1, name: "Comercial" }, { id: F2, name: "Pós-venda" }],
    custom_fields: [
      { entity: "deal", slug: "valor-da-carta", name: "Valor da carta", type: "number" },
      { entity: "deal", slug: "banco", name: "Banco", type: "option", options: ["Itaú", "Bradesco"] },
      // Exibido só no Pós-venda pelo próprio RD, mesmo sem valor ainda.
      { entity: "deal", slug: "motivo-retorno", name: "Motivo do retorno", type: "text", display_rules: [{ property: "deal_pipeline_id", value: F2 }] },
      // Restrito ao Comercial: no Pós-venda a chave aparece vazia e não deve entrar.
      { entity: "deal", slug: "sdr", name: "SDR", type: "text", display_rules: [{ property: "deal_pipeline_id", value: F1 }] },
      { entity: "contact", slug: "cpf", name: "CPF", type: "text" },
    ],
    users: [{ id: U1, name: "Raissa" }, { id: U2, name: "Giovana" }, { id: U3, name: "Paula" }],
    sources: [{ id: S1, name: "Instagram" }],
    campaigns: [{ id: C1, name: "Setembro" }],
  };
  const deals: Record<string, any[]> = {
    [F1]: [
      { id: "d1", name: "A", pipeline_id: F1, owner_id: U1, source_id: S1, total_price: 1000, contact_ids: [K1], custom_fields: { "valor-da-carta": 50000, banco: "Itaú", sdr: "Ana", "motivo-retorno": null } },
      { id: "d2", name: "B", pipeline_id: F1, owner_id: U1, total_price: 2000, contact_ids: [K2], custom_fields: { "valor-da-carta": null, banco: "Bradesco", sdr: null, "motivo-retorno": null } },
      { id: "d3", name: "C", pipeline_id: F1, owner_id: U2, total_price: 3000, contact_ids: [], custom_fields: { banco: "Itaú" } },
    ],
    [F2]: [{ id: "d4", name: "D", pipeline_id: F2, owner_id: U2, total_price: 0, contact_ids: [], custom_fields: { sdr: null } }],
  };
  const contatos = [
    { id: K1, name: "Maria", phones: [{ phone: "61999990000", type: "mobile" }], emails: [{ email: "m@x.com" }], whatsapp_username: "maria", custom_fields: { cpf: "12345678901" } },
    { id: K2, name: "Joana", phones: [], emails: [], custom_fields: { cpf: null } },
  ];
  const rd: LeitorRd = {
    listar: async (recurso) => { chamadas.push({ tipo: "listar", alvo: recurso }); if (opcoes.falhar) throw new Error("RD_HTTP_401"); return listas[recurso] ?? []; },
    get: async (path) => {
      chamadas.push({ tipo: "get", alvo: path });
      const stages = path.match(/^\/pipelines\/([0-9a-f]{24})\/stages/);
      if (stages) return { data: [{ id: "e2", name: "Fechado", order: 2 }, { id: "e1", name: "Novo", order: 1 }] };
      if (path.startsWith("/deals")) {
        if (opcoes.semOrdenacao && path.includes("sort")) throw new Error("RD_HTTP_400");
        const pid = decodeURIComponent(path).match(/pipeline_id:([0-9a-f]{24})/)![1];
        return { data: deals[pid] };
      }
      const umContato = path.match(/^\/contacts\/([0-9a-f]{24})$/);
      if (umContato) {
        const c = contatos.find((x) => x.id === umContato[1]);
        if (!c) throw new Error("RD_HTTP_404");
        return { data: c };
      }
      throw new Error("RD_HTTP_404");
    },
  };
  return { rd, chamadas };
}

beforeEach(() => limparCatalogoEmMemoria());

describe("catálogo do RD por funil", () => {
  it("lê poucas páginas: nunca lista todos os contatos nem todas as negociações", async () => {
    const { rd, chamadas } = rdFalso();
    await montarCatalogoCrm(env, { rd });
    expect(chamadas.filter((c) => c.tipo === "listar").map((c) => c.alvo).sort()).toEqual(["campaigns", "custom_fields", "pipelines", "sources", "users"]);
    const gets = chamadas.filter((c) => c.tipo === "get").map((c) => c.alvo);
    expect(gets.filter((g) => g.startsWith("/deals"))).toHaveLength(2);
    expect(gets.every((g) => !g.startsWith("/deals") || g.includes("page[size]=100") && g.includes("sort[updated_at]=desc"))).toBe(true);
    // Contatos lidos um a um pelo id (o RDQL de contatos não filtra por id), só os da amostra.
    expect(gets.filter((g) => g.startsWith("/contacts")).sort()).toEqual([`/contacts/${K1}`, `/contacts/${K2}`]);
  });

  it("campos de cada funil vêm das regras do RD e da amostra, sem catálogo global", async () => {
    const { rd } = rdFalso();
    const [comercial, posVenda] = await montarCatalogoCrm(env, { rd });
    const fontes = (f: typeof comercial) => f.fontes.map((x) => x.fonte);
    expect(fontes(comercial)).toEqual(expect.arrayContaining(["deal:valor-da-carta", "deal:banco", "deal:sdr", "contact:cpf", "deal_field:owner_id", "contact_field:phones", "contact_field:emails", "contact_field:name", "contact_field:whatsapp_username"]));
    expect(comercial.fontes.find((f) => f.fonte === "contact_field:whatsapp_username")).toMatchObject({ rotulo: "Contato: Nome de usuário no WhatsApp", grupo: "contact_nativo", preenchidas: 1 });
    expect(fontes(comercial)).not.toContain("deal:motivo-retorno");
    expect(fontes(posVenda)).toContain("deal:motivo-retorno");
    expect(fontes(posVenda)).not.toContain("deal:sdr");
    expect(fontes(posVenda)).not.toContain("deal:valor-da-carta");
    expect(comercial.etapas.map((e) => e.nome)).toEqual(["Novo", "Fechado"]);
    expect(comercial.fontes.find((f) => f.fonte === "deal:valor-da-carta")).toMatchObject({ rotulo: "Negociação: Valor da carta", preenchidas: 1, mapeavel: true });
    expect(comercial.fontes.find((f) => f.fonte === "deal_field:owner_id")?.rotulo).toBe("Negociação: Responsável (vendedora)");
    expect(comercial.amostra).toEqual({ negociacoes: 3, contatos: 2, contatosIndisponiveis: false });
  });

  it("valores selecionáveis: vendedoras, fonte, campanha e campos de opção, com contagem da amostra", async () => {
    const { rd } = rdFalso();
    const [comercial] = await montarCatalogoCrm(env, { rd });
    const donos = comercial.filtros.find((f) => f.fonte === "deal_field:owner_id")!;
    expect(donos.rotulo).toBe("Responsável (vendedora)");
    expect(donos.valores).toEqual([
      { valor: U1, rotulo: "Raissa", negociacoes: 2 },
      { valor: U2, rotulo: "Giovana", negociacoes: 1 },
      { valor: U3, rotulo: "Paula", negociacoes: 0 },
    ]);
    expect(comercial.filtros.find((f) => f.fonte === "deal:banco")!.valores).toEqual([
      { valor: "Itaú", rotulo: "Itaú", negociacoes: 2 },
      { valor: "Bradesco", rotulo: "Bradesco", negociacoes: 1 },
    ]);
    expect(comercial.filtros.map((f) => f.fonte)).toEqual(["deal_field:owner_id", "deal_field:source_id", "deal_field:campaign_id", "deal:banco"]);
  });

  it("sugere uma origem concreta para cada dado do Sra Luck", async () => {
    const { rd } = rdFalso();
    const [comercial, posVenda] = await montarCatalogoCrm(env, { rd });
    expect(comercial.sugestoes).toMatchObject({
      cpf: "contact:cpf", telefone: "contact_field:phones", email: "contact_field:emails", vendedora: "deal_field:owner_id",
      origem: "deal_field:source_id", valor_contrato: "deal:valor-da-carta", banco: "deal:banco",
    });
    expect(posVenda.sugestoes.valor_contrato).toBe("deal_field:total_price");
    expect(posVenda.sugestoes.cpf).toBeUndefined();
  });

  it("aceita conta sem ordenação por updated_at", async () => {
    const { rd, chamadas } = rdFalso({ semOrdenacao: true });
    const [comercial] = await montarCatalogoCrm(env, { rd });
    expect(comercial.amostra.negociacoes).toBe(3);
    expect(chamadas.some((c) => c.alvo.startsWith("/deals") && !c.alvo.includes("sort"))).toBe(true);
  });
});

describe("catálogo guardado", () => {
  it("a tela lê o catálogo guardado sem chamar o RD", async () => {
    const { rd } = rdFalso();
    const { db, tabela } = bancoFalso();
    await atualizarCatalogoCrm(env, { db, rd });
    limparCatalogoEmMemoria();
    const outro = rdFalso();
    const r = await catalogoCrm(env, { db, rd: outro.rd });
    expect(outro.chamadas).toHaveLength(0);
    expect(r.funis.map((f) => f.nome)).toEqual(["Comercial", "Pós-venda"]);
    expect(r.catalogo).toMatchObject({ origem: "armazenado", vencido: false, persistido: true, erro: null });
  });

  it("sem catálogo guardado, monta na primeira leitura e guarda", async () => {
    const { rd, chamadas } = rdFalso();
    const { db, tabela } = bancoFalso();
    const r = await catalogoCrm(env, { db, rd });
    expect(chamadas.length).toBeGreaterThan(0);
    expect(r.catalogo.origem).toBe("recalculado");
    expect(tabela("integracao_catalogos")).toHaveLength(1);
  });

  it("pedidos simultâneos reaproveitam a mesma leitura do RD", async () => {
    const { rd, chamadas } = rdFalso();
    const { db, tabela } = bancoFalso();
    await Promise.all([atualizarCatalogoCrm(env, { db, rd }), atualizarCatalogoCrm(env, { db, rd })]);
    expect(chamadas.filter((c) => c.alvo === "pipelines")).toHaveLength(1);
  });

  it("falha do RD mantém o catálogo anterior e registra o erro", async () => {
    const { db, tabela } = bancoFalso();
    await atualizarCatalogoCrm(env, { db, rd: rdFalso().rd });
    await expect(atualizarCatalogoCrm(env, { db, rd: rdFalso({ falhar: true }).rd })).rejects.toThrow("RD_HTTP_401");
    limparCatalogoEmMemoria();
    const r = await catalogoCrm(env, { db, rd: rdFalso({ falhar: true }).rd });
    expect(r.funis).toHaveLength(2);
    expect(r.catalogo.erro).toBe("RD_HTTP_401");
  });

  it("agendador renova só quando vence e não lê o RD com a importação desligada e sem catálogo", async () => {
    const { db, tabela } = bancoFalso();
    expect(await atualizarCatalogoSeVencido(env, { db, rd: rdFalso().rd, config: PADRAO_CRM })).toEqual({ atualizado: false, motivo: "importacao_desligada" });
    await atualizarCatalogoCrm(env, { db, rd: rdFalso().rd });
    const emDia = rdFalso();
    expect(await atualizarCatalogoSeVencido(env, { db, rd: emDia.rd })).toEqual({ atualizado: false, motivo: "em_dia" });
    expect(emDia.chamadas).toHaveLength(0);
    const vencido = rdFalso();
    const r = await atualizarCatalogoSeVencido(env, { db, rd: vencido.rd, agora: Date.now() + CATALOGO_VALIDADE_MS + 60_000 });
    expect(r).toMatchObject({ atualizado: true, funis: 2 });
    expect(vencido.chamadas.length).toBeGreaterThan(0);
  });
});
