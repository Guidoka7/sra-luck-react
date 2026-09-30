import { describe, expect, it } from "vitest";
import { agruparPorContato, ampliarOrigem, emailsValidos, manterAmpliada, montarOrigem, origemParaColunas, valorDescritivoDeOrigem, variacoesTelefone } from "./crm-origem";

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
    expect(origemParaColunas(montarOrigem(contrato(), [], refs))).toEqual({ origem: "Não registrada no RD", campanha: "Não registrada no RD" });
  });

  it("\"Desconhecido\" não vence o dado real; sem campanha, descreve o canal com as palavras do RD", () => {
    const fontes = new Map([["srcX", { id: "srcX", name: "Desconhecido" }], ["src1", { id: "src1", name: "Busca Paga | instagram" }]]);
    const propria = contrato({ source_id: "srcX", custom_fields: { "como-ficou-sabendo-da-sra-luck": "TRÁFEGO PAGO META" } });
    const o = montarOrigem(propria, [], { ...refs, fontes });
    expect(o).toMatchObject({ fonte: "Desconhecido", comoFicouSabendo: "TRÁFEGO PAGO META", situacao: "parcial" });
    expect(o.evidencias.find((e) => e.valor === "Desconhecido")?.fraca).toBe(true);
    expect(origemParaColunas(o)).toEqual({ origem: "TRÁFEGO PAGO META", campanha: "Tráfego pago Meta — campanha não registrada no RD" });
    // Um valor informativo em negociação mais antiga vence o "Desconhecido" da própria.
    const antiga = { id: "D-LEAD", pipeline_id: "pVendas", contact_ids: ["ct1"], created_at: "2026-01-01T00:00:00Z", source_id: "src1" };
    expect(montarOrigem(propria, [antiga], { ...refs, fontes }).fonte).toBe("Busca Paga | instagram");
    const organico = montarOrigem(contrato({ custom_fields: { "como-ficou-sabendo-da-sra-luck": "INSTAGRAM ORGÂNICO" } }), [], refs);
    expect(origemParaColunas(organico)).toEqual({ origem: "INSTAGRAM ORGÂNICO", campanha: "Orgânico — sem campanha paga" });
    const indicacao = montarOrigem(contrato({ custom_fields: { "como-ficou-sabendo-da-sra-luck": "INDICAÇÃO" } }), [], refs);
    expect(origemParaColunas(indicacao).campanha).toBe("Indicação — sem campanha paga");
    expect(valorDescritivoDeOrigem("Indicação — sem campanha paga")).toBe(true);
    expect(valorDescritivoDeOrigem("Black Friday")).toBe(false);
  });

  it("cupom e formulário da landing page são registros reais de origem", () => {
    const o = montarOrigem(contrato({ custom_fields: { cupom: "Noivavip", "procedimento-lp": "Cirurgias plástica" } }), [], refs);
    expect(o).toMatchObject({ cupom: "Noivavip", landingPage: true, situacao: "encontrada" });
    expect(origemParaColunas(o)).toEqual({ origem: "Landing page (formulário do site)", campanha: "Cupom: Noivavip" });
    // "Não tenho" no campo de cupom não é cupom.
    expect(montarOrigem(contrato({ custom_fields: { cupom: "Não tenho" } }), [], refs).situacao).toBe("sem_registro_no_rd");
  });

  it("busca ampliada: soma negociações de outro cadastro com o mesmo e-mail/telefone, depois das próprias, e a importação não as perde", () => {
    const base = montarOrigem(contrato({ custom_fields: { "como-ficou-sabendo-da-sra-luck": "INSTAGRAM ORGÂNICO" } }), [], refs, { agora: "2026-09-01T00:00:00Z" });
    const lead = { id: "D-OUTRO", pipeline_id: "pVendas", contact_ids: ["ct9"], created_at: "2025-12-01T00:00:00Z", source_id: "src1", campaign_id: "camp1", custom_fields: { "como-ficou-sabendo-da-sra-luck": "TRÁFEGO PAGO META" } };
    const busca = { em: "2026-09-30T00:00:00Z", contatos: [{ id: "ct9", via: "telefone" as const }] };
    const a = ampliarOrigem(base, [{ deal: lead, contato: busca.contatos[0] }], refs, busca);
    // O registro do próprio cadastro continua em primeiro; o outro cadastro completa o que faltava.
    expect(a).toMatchObject({ comoFicouSabendo: "INSTAGRAM ORGÂNICO", fonte: "Busca Paga | instagram", campanha: "Aniversário da Chefa", situacao: "encontrada", negociacoesAnalisadas: 2 });
    expect(a.ampliada).toEqual({ em: busca.em, contatos: busca.contatos, negociacoes: 1 });
    expect(a.evidencias.find((e) => e.campo === "campanha")?.negociacao.outroContato).toEqual({ id: "ct9", via: "telefone" });
    // Nova passada da importação (só o próprio contato): as evidências do outro cadastro são mantidas.
    const recalculada = montarOrigem(contrato({ custom_fields: { "como-ficou-sabendo-da-sra-luck": "INSTAGRAM ORGÂNICO" } }), [], refs, { agora: "2026-10-01T00:00:00Z" });
    const mantida = manterAmpliada(recalculada, a);
    expect(mantida).toMatchObject({ campanha: "Aniversário da Chefa", situacao: "encontrada", negociacoesAnalisadas: 2, checadoEm: "2026-10-01T00:00:00Z" });
    expect(mantida.ampliada?.em).toBe(busca.em);
    expect(manterAmpliada(recalculada, base)).toBe(recalculada);
    // Refazer a busca substitui o resultado anterior dela (sem contar duas vezes).
    expect(ampliarOrigem(a, [], refs, { em: "2026-10-30T00:00:00Z", contatos: [] })).toMatchObject({ campanha: null, negociacoesAnalisadas: 1, situacao: "parcial" });
  });

  it("variações de telefone na ordem dos formatos mais usados na conta", () => {
    expect(variacoesTelefone("61984035758")).toEqual([
      "556184035758", "5561984035758", "(61) 98403-5758", "+55 (61) 98403-5758", "+5561984035758", "61984035758",
      "+556184035758", "6184035758", "(61) 8403-5758", "+55 (61) 8403-5758",
    ]);
    expect(variacoesTelefone("6133334444")).toEqual(["556133334444", "(61) 3333-4444", "+55 (61) 3333-4444", "+556133334444", "6133334444"]);
    expect(variacoesTelefone("123")).toEqual([]);
    expect(emailsValidos([{ email: " Ana@X.com " }, "ana@x.com", "sem-arroba", { email: "b@y.com.br" }])).toEqual(["ana@x.com", "b@y.com.br"]);
  });

  it("agrupa negociações por contato sem repetir", () => {
    const g = agruparPorContato([{ id: "a", contact_ids: ["c1", "c2"] }, { id: "b", contact_ids: ["c1"] }, { id: "a", contact_ids: ["c1"] }]);
    expect(g.get("c1")!.map((d) => d.id)).toEqual(["a", "b"]);
    expect(g.get("c2")!.map((d) => d.id)).toEqual(["a"]);
  });
});
