import { describe, expect, it } from "vitest";
import { inventariarCamposPorFunil } from "./crm-opcoes-funil";

const A = "a".repeat(24);
const B = "b".repeat(24);

describe("campos de origem por funil", () => {
  it("não mistura campos entre funis e associa campos de contato pela negociação", () => {
    const deals = [
      { id: "d1", pipeline_id: A, name: "A1", status: "won", total_price: 100, contact_ids: ["c1"], custom_fields: { sdr: "Ana", comum: false, vazio: "" } },
      { id: "d2", pipeline_id: A, name: "A2", status: "ongoing", total_price: 0, contact_ids: ["c2"], custom_fields: { sdr: "Bia", comum: true } },
      { id: "d3", pipeline_id: B, name: "B1", status: "won", contact_ids: ["c3"], custom_fields: { ticket: 0, comum: "sim" } },
    ];
    const contatos = [
      { id: "c1", name: "C1", emails: [{ email: "a@teste.com" }], custom_fields: { modalidade: "Online" } },
      { id: "c2", name: "C2", custom_fields: { modalidade: "Presencial" } },
      { id: "c3", name: "C3", phones: [{ phone: "61999999999" }], custom_fields: { canal: "Indicação" } },
    ];
    const definicoes = [
      { entity: "deal", slug: "sdr", name: "SDR", type: "text", options: [] },
      { entity: "deal", slug: "ticket", name: "Ticket", type: "number", options: [] },
      { entity: "deal", slug: "comum", name: "Origem comercial", type: "option", options: ["sim", "não"] },
      { entity: "contact", slug: "modalidade", name: "Modalidade", type: "option", options: ["Online", "Presencial"] },
      { entity: "contact", slug: "canal", name: "Canal", type: "text", options: [] },
    ];

    const inv = inventariarCamposPorFunil(deals, contatos, definicoes);
    expect(inv[A].campos.map((c) => c.fonte)).toEqual(expect.arrayContaining(["deal:sdr", "deal:comum", "contact:modalidade"]));
    expect(inv[A].campos.map((c) => c.fonte)).not.toContain("deal:ticket");
    expect(inv[A].campos.map((c) => c.fonte)).not.toContain("contact:canal");
    expect(inv[B].campos.map((c) => c.fonte)).toEqual(expect.arrayContaining(["deal:ticket", "deal:comum", "contact:canal"]));
    expect(inv[B].campos.map((c) => c.fonte)).not.toContain("deal:sdr");
    expect(inv[B].campos.map((c) => c.fonte)).not.toContain("contact:modalidade");
    expect(inv[A].campos.find((c) => c.fonte === "deal:comum")?.opcoes).toEqual(["sim", "não"]);
    expect(inv[A].campos.find((c) => c.fonte === "contact:modalidade")?.opcoes).toEqual(["Online", "Presencial"]);
  });

  it("considera zero e falso como preenchidos e ignora vazio", () => {
    const inv = inventariarCamposPorFunil([
      { pipeline_id: A, name: "QA", total_price: 0, custom_fields: { zero: 0, falso: false, vazio: "", nulo: null } },
    ], [], [
      { entity: "deal", slug: "zero", name: "Zero", type: "number" },
      { entity: "deal", slug: "falso", name: "Falso", type: "text" },
      { entity: "deal", slug: "vazio", name: "Vazio", type: "text" },
      { entity: "deal", slug: "nulo", name: "Nulo", type: "text" },
    ]);
    expect(inv[A].campos.map((c) => c.fonte)).toEqual(["deal:falso", "deal:zero"]);
    expect(inv[A].camposNativos.some((c) => c.fonte === "deal_field:total_price")).toBe(true);
  });
});
