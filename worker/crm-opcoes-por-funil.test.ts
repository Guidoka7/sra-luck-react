import { describe, expect, it } from "vitest";
import { camposDisponiveisDoFunil, type CampoCatalogoCrm } from "./crm-opcoes-por-funil";

const catalogo: CampoCatalogoCrm[] = [
  { entidade: "deal", slug: "sdr", nome: "SDR", tipo: "text" },
  { entidade: "deal", slug: "so_outro_funil", nome: "Só outro funil", tipo: "text" },
  { entidade: "contact", slug: "modalidade", nome: "Modalidade", tipo: "text" },
  { entidade: "contact", slug: "contato_global", nome: "Contato global", tipo: "text" },
];

describe("campos disponíveis do RD por funil", () => {
  it("inclui somente chaves presentes nas negociações e contatos ligados ao funil", () => {
    const deals = [{ id: "d1", name: "Venda A", status: "won", contact_ids: ["c1"], custom_fields: { sdr: "Ana" } }];
    const contatos = new Map([["c1", { id: "c1", name: "Cliente", phones: [], custom_fields: { modalidade: null } }]]);
    const r = camposDisponiveisDoFunil(deals, contatos, catalogo);

    expect(r.campos.map((c) => `${c.entidade}:${c.slug}`)).toEqual(["contact:modalidade", "deal:sdr"]);
    expect(r.campos.map((c) => c.slug)).not.toContain("so_outro_funil");
    expect(r.campos.map((c) => c.slug)).not.toContain("contato_global");
    expect(r.camposNativos.map((c) => c.fonte)).toContain("deal_field:name");
    expect(r.camposNativos.map((c) => c.fonte)).toContain("deal_field:status");
    expect(r.camposNativos.map((c) => c.fonte)).toContain("contact_field:name");
    expect(r.camposNativos.map((c) => c.fonte)).toContain("contact_field:phones");
    expect(r.totalNegociacoes).toBe(1);
    expect(r.totalContatos).toBe(1);
  });

  it("considera campo customizado disponível mesmo quando seu valor está vazio", () => {
    const r = camposDisponiveisDoFunil([{ custom_fields: { sdr: null } }], new Map(), catalogo);
    expect(r.campos).toEqual([{ slug: "sdr", nome: "SDR", entidade: "deal", tipo: "text" }]);
  });

  it("não inventa campos quando o funil não tem negociações", () => {
    const r = camposDisponiveisDoFunil([], new Map(), catalogo);
    expect(r.campos).toEqual([]);
    expect(r.camposNativos).toEqual([]);
  });
});
