import { describe, expect, it } from "vitest";
import { agruparPorContato, montarOrigem, origemParaColunas } from "./crm-origem";

const FONTES = new Map([["src1", { id: "src1", name: "Busca Paga | instagram" }]]);
const CAMPANHAS = new Map([["camp1", { id: "camp1", name: "Aniversário da Chefa" }]]);
const FUNIS = new Map([["pVendas", "Vendas"], ["pContratos", "Arquivos de Contratos Brasília"]]);
const refs = { fontes: FONTES, campanhas: CAMPANHAS, funis: FUNIS };

const contrato = (extra: Record<string, unknown> = {}) => ({ id: "D-CONTRATO", pipeline_id: "pContratos", contact_ids: ["ct1"], created_at: "2026-03-01T10:00:00Z", custom_fields: {}, ...extra });

describe("origem da cliente (somente dado real do RD)", () => {
  it("própria negociação sem origem: usa a negociação de entrada mais antiga do mesmo contato, com a prova", () => {
    const entrada = { id: "D-LEAD", pipeline_id: "pVendas", contact_ids: ["ct1"], created_at: "2026-01-10T10:00:00Z", source_id: "src1", campaign_id: "camp1", custom_fields: { "como-ficou-sabendo-da-sra-luck": "TRÁFEGO PAGO META" } };
    const depois = { id: "D-OUTRA", pipeline_id: "pVendas", contact_ids: ["ct1"], created_at: "2026-02-10T10:00:00Z", source_id: null, custom_fields: { "como-ficou-sabendo-da-sra-luck": "INDICAÇÃO" } };
    const o = montarOrigem(contrato(), [depois, contrato(), entrada], refs, { agora: "2026-09-29T00:00:00Z" });
    expect(o).toMatchObject({ fonte: "Busca Paga | instagram", campanha: "Aniversário da Chefa", comoFicouSabendo: "TRÁFEGO PAGO META", situacao: "encontrada", negociacoesAnalisadas: 3 });
    expect(o.evidencias[0]).toMatchObject({ campo: "fonte", negociacao: { id: "D-LEAD", funil: "Vendas", propria: false } });
    // O valor mais novo também fica registrado (para conferência), sem substituir o primeiro contato.
    expect(o.evidencias.some((e) => e.valor === "INDICAÇÃO")).toBe(true);
    expect(origemParaColunas(o)).toEqual({ origem: "Busca Paga | instagram", campanha: "Aniversário da Chefa" });
  });

  it("a própria negociação vem primeiro quando tem o dado", () => {
    const o = montarOrigem(contrato({ custom_fields: { "nome-da-influencer": "Gabi Sampaio", "como-ficou-sabendo-da-sra-luck": "INFLUENCER" } }), [], refs);
    expect(o).toMatchObject({ fonte: null, campanha: null, comoFicouSabendo: "INFLUENCER", influencer: "Gabi Sampaio", situacao: "encontrada" });
    expect(origemParaColunas(o)).toEqual({ origem: "INFLUENCER", campanha: "Influencer: Gabi Sampaio" });
  });

  it("sem nenhum registro no RD: nada é inventado", () => {
    expect(montarOrigem(contrato(), [], refs)).toMatchObject({ fonte: null, campanha: null, comoFicouSabendo: null, influencer: null, situacao: "sem_registro_no_rd" });
    expect(montarOrigem(contrato({ contact_ids: [] }), [], refs, { semContato: true }).situacao).toBe("sem_contato");
    expect(origemParaColunas(montarOrigem(contrato(), [], refs))).toEqual({ origem: null, campanha: null });
  });

  it("agrupa negociações por contato sem repetir", () => {
    const g = agruparPorContato([{ id: "a", contact_ids: ["c1", "c2"] }, { id: "b", contact_ids: ["c1"] }, { id: "a", contact_ids: ["c1"] }]);
    expect(g.get("c1")!.map((d) => d.id)).toEqual(["a", "b"]);
    expect(g.get("c2")!.map((d) => d.id)).toEqual(["a"]);
  });
});
