import { describe, expect, it } from "vitest";
import { bancoFalso } from "./banco-falso.testutil";
import {
  agruparPessoas, assinaturaOrigem, avancarOrigemGeral, coberturaPorFunil, listarNegociacoesDoFunil, patchColunasOrigem, resolverEspelho,
  type ContatoEspelho, type NegEspelho,
} from "./crm-origem-geral";
import { manterAmpliada, montarOrigem } from "./crm-origem";
import { PADRAO_CRM, type ConfigCrm } from "./integracoes-registro";
import type { Env } from "./supabase";

const env = {} as Env;
const CONTRATOS = "c".repeat(24), VENDAS = "v".repeat(24);
const refsBrutas = { fontes: [{ id: "src1", name: "Busca Paga | instagram" }, { id: "srcX", name: "Desconhecido" }], campanhas: [{ id: "camp1", name: "Black Friday" }], funis: [{ id: CONTRATOS, name: "Contratos" }, { id: VENDAS, name: "Vendas" }] };
const refs = { fontes: new Map(refsBrutas.fontes.map((f) => [f.id, f])), campanhas: new Map(refsBrutas.campanhas.map((c) => [c.id, c])), funis: new Map(refsBrutas.funis.map((f) => [f.id, f.name])) };
const config = () => ({ ...PADRAO_CRM, ativo: true, funis: [{ pipelineId: CONTRATOS, etapas: [], mapeamento: { ...PADRAO_CRM.mapeamento } }] }) as ConfigCrm;

const neg = (id: string, extra: Partial<NegEspelho> = {}): NegEspelho => ({ id, pipeline_id: CONTRATOS, criada_em: "2026-03-01T00:00:00.000Z", contact_ids: ["ctA"], source_id: null, campaign_id: null, campos_origem: {}, ...extra });
const ct = (id: string, emails: string[], telefones: string[]): ContatoEspelho => ({ id, emails, telefones });

/** Cliente com contrato sem origem; o lead dela é OUTRO cadastro (mesmo telefone) com fonte e campanha. */
const cenario = () => ({
  negs: [
    neg("D-CONTRATO"),
    neg("D-VENDAS-A", { pipeline_id: VENDAS, criada_em: "2026-01-10T00:00:00.000Z", campos_origem: { "como-ficou-sabendo-da-sra-luck": "INSTAGRAM ORGÂNICO" } }),
    neg("D-LEAD-B", { pipeline_id: VENDAS, criada_em: "2025-12-01T00:00:00.000Z", contact_ids: ["ctB"], source_id: "src1", campaign_id: "camp1" }),
    neg("D-OUTRA-PESSOA", { contact_ids: ["ctZ"], source_id: "srcX" }),
    neg("D-SEM-CONTATO", { contact_ids: [] }),
  ],
  contatos: [ct("ctA", ["ana@x.com"], ["61984035758"]), ct("ctB", [], ["61984035758"]), ct("ctZ", ["zeca@x.com"], ["61911112222"])],
});

describe("origem de todas as negociações do RD (espelho)", () => {
  it("reconhece cadastros da mesma pessoa por e-mail ou telefone, de forma transitiva, sem ligar telefone genérico", () => {
    const g = agruparPessoas([
      ct("a", ["a@x.com"], []), ct("b", ["a@x.com"], ["61900000001"]), ct("c", [], ["61900000001"]), ct("d", ["d@x.com"], []),
      ...Array.from({ length: 6 }, (_, i) => ct(`gen${i}`, [], ["6133330000"])),
    ]);
    expect(new Set([g.get("a"), g.get("b"), g.get("c")]).size).toBe(1);
    expect(g.get("d")).not.toBe(g.get("a"));
    // Mesmo número em 6 cadastros: telefone da clínica/teste, não é a mesma pessoa.
    expect(new Set(Array.from({ length: 6 }, (_, i) => g.get(`gen${i}`))).size).toBe(6);
  });

  it("cada negociação: própria → mesmo contato (qualquer funil) → outro cadastro da mesma pessoa, com a prova", () => {
    const { negs, contatos } = cenario();
    const { origens, pessoaDaNegociacao } = resolverEspelho(negs, contatos, refs, "2026-09-30T12:00:00.000Z");
    const o = origens.get("D-CONTRATO")!;
    expect(o).toMatchObject({ comoFicouSabendo: "INSTAGRAM ORGÂNICO", fonte: "Busca Paga | instagram", campanha: "Black Friday", situacao: "encontrada", negociacoesAnalisadas: 3 });
    expect(o.evidencias[0]).toMatchObject({ valor: "INSTAGRAM ORGÂNICO", negociacao: { id: "D-VENDAS-A", funil: "Vendas", propria: false } });
    expect(o.evidencias.find((e) => e.campo === "campanha")!.negociacao).toMatchObject({ id: "D-LEAD-B", outroContato: { id: "ctB", via: "telefone" } });
    expect(o.ampliada).toMatchObject({ contatos: [{ id: "ctB", via: "telefone" }], negociacoes: 1 });
    expect(origens.get("D-OUTRA-PESSOA")).toMatchObject({ fonte: "Desconhecido", situacao: "parcial" });
    expect(origens.get("D-SEM-CONTATO")!.situacao).toBe("sem_contato");
    expect(pessoaDaNegociacao.get("D-CONTRATO")).toBe(pessoaDaNegociacao.get("D-LEAD-B"));
    // Cobertura por funil conta cada pessoa uma vez.
    const cob = coberturaPorFunil(negs, origens, pessoaDaNegociacao);
    expect(cob[CONTRATOS]).toMatchObject({ negociacoes: 3, clientes: 3, porSituacao: { encontrada: 1, parcial: 1, sem_contato: 1 }, comFonte: 1, comCampanha: 1 });
    expect(cob[VENDAS]).toMatchObject({ negociacoes: 2, clientes: 1 });
  });

  it("a importação (só o próprio contato) + o que veio de outros cadastros dá a mesma origem: nada é regravado à toa", () => {
    const { negs, contatos } = cenario();
    const resolvida = resolverEspelho(negs, contatos, refs, "2026-09-30T12:00:00.000Z").origens.get("D-CONTRATO")!;
    const deal = (n: NegEspelho) => ({ id: n.id, pipeline_id: n.pipeline_id, created_at: n.criada_em, contact_ids: n.contact_ids, custom_fields: n.campos_origem, source_id: n.source_id, campaign_id: n.campaign_id });
    const fresca = montarOrigem(deal(negs[0]), [deal(negs[0]), deal(negs[1])], refs, { agora: "2026-10-01T00:00:00.000Z" });
    expect(assinaturaOrigem(manterAmpliada(fresca, resolvida))).toBe(assinaturaOrigem(resolvida));
  });

  it("colunas da venda: completa vazio/descrição/\"Desconhecido\", nunca troca dado real por descrição, respeita edição e \"ignorar\"", () => {
    const { negs, contatos } = cenario();
    const { origens } = resolverEspelho(negs, contatos, refs, "2026-09-30T12:00:00.000Z");
    const o = origens.get("D-CONTRATO")!;
    const base = { rd_pipeline_id: CONTRATOS };
    expect(patchColunasOrigem({ ...base, origem_venda: "Não registrada no RD", campanha_local: null }, o, config())).toEqual({ origem_venda: "Busca Paga | instagram", campanha_local: "Black Friday" });
    expect(patchColunasOrigem({ ...base, origem_venda: "Desconhecido", campanha_local: "Promo da equipe" }, o, config())).toEqual({ origem_venda: "Busca Paga | instagram" });
    expect(patchColunasOrigem({ ...base, origem_venda: null, campanha_local: null }, o, config(), new Set(["origem_venda"]))).toEqual({ campanha_local: "Black Friday" });
    const semNada = origens.get("D-SEM-CONTATO")!;
    expect(patchColunasOrigem({ ...base, origem_venda: "Instagram", campanha_local: null }, semNada, config())).toEqual({ campanha_local: "Não registrada no RD" });
    const ignorar = { ...config(), funis: [{ pipelineId: CONTRATOS, etapas: [], mapeamento: { ...PADRAO_CRM.mapeamento, campanha: "ignorar" } }] } as ConfigCrm;
    expect(patchColunasOrigem({ ...base, origem_venda: null, campanha_local: null }, o, ignorar)).toEqual({ origem_venda: "Busca Paga | instagram" });
  });

  it("etapas A e B: grava a origem de todas as negociações, a cobertura por funil e as vendas do Admin; a segunda rodada não regrava nada", async () => {
    const { negs, contatos } = cenario();
    const { db, tabela } = bancoFalso({
      crm_rd_negociacoes: negs.map((n) => ({ ...n })),
      crm_rd_contatos: contatos.map((c) => ({ ...c, nome: c.id === "ctA" ? "Ana" : c.id })),
      integracao_catalogos: [{ provedor: "rd_station", chave: "crm_contagens", dados: { passada: "p", funis: [], espelho: { concluidoEm: "2026-09-30T11:00:00.000Z" } } }],
      novas_vendas: [{ id: "nv-1", rd_station_id: "D-CONTRATO", rd_pipeline_id: CONTRATOS, origem_venda: "INSTAGRAM ORGÂNICO", campanha_local: "Orgânico — sem campanha paga", rd_snapshot: { outro: 1, _sra_origem: { situacao: "parcial" } } }],
    });
    const deps = { db, config: config(), refs: async () => refsBrutas };
    const r = await avancarOrigemGeral(env, deps);
    expect(r).toMatchObject({ executada: true, espelho: { negociacoes: 5, alteradas: 5, completa: true, vendasPendentes: 1 }, vendasGravadas: 1, vendasPendentes: 0 });
    const d = tabela("crm_rd_negociacoes").find((n) => n.id === "D-CONTRATO")!;
    expect(d).toMatchObject({ fonte: "Busca Paga | instagram", campanha: "Black Friday", situacao: "encontrada" });
    expect(d.origem.assinatura).toBeTruthy();
    expect(tabela("crm_rd_negociacoes").find((n) => n.id === "D-SEM-CONTATO")).toMatchObject({ fonte: "Não registrada no RD", campanha: "Não registrada no RD" });
    const cob = tabela("integracao_catalogos").find((c) => c.chave === "crm_origem_funis")!.dados;
    expect(cob.porFunil[CONTRATOS]).toMatchObject({ negociacoes: 3, clientes: 3 });
    const v = tabela("novas_vendas")[0];
    // "INSTAGRAM ORGÂNICO" é dado real: fica; a descrição da campanha dá lugar à campanha real.
    expect(v).toMatchObject({ origem_venda: "INSTAGRAM ORGÂNICO", campanha_local: "Black Friday" });
    expect(v.rd_snapshot.outro).toBe(1);
    expect(v.rd_snapshot._sra_origem).toMatchObject({ situacao: "encontrada", campanha: "Black Friday" });
    expect(v.rd_snapshot._sra_origem.assinatura).toBeUndefined();
    // Mesma varredura: não resolve de novo. Varredura nova sem mudança: nada regravado.
    expect(await avancarOrigemGeral(env, deps)).toMatchObject({ executada: true, espelho: null, vendasGravadas: 0 });
    tabela("integracao_catalogos").find((c) => c.chave === "crm_contagens")!.dados.espelho.concluidoEm = "2026-09-30T17:00:00.000Z";
    expect(await avancarOrigemGeral(env, deps)).toMatchObject({ espelho: { alteradas: 0, vendasPendentes: 0 } });
    // Lista do funil para o Console: nome da cliente, fonte, campanha e a prova.
    const lista = await listarNegociacoesDoFunil(db, CONTRATOS, { situacao: "encontrada" });
    expect(lista).toMatchObject({ total: 1, itens: [{ id: "D-CONTRATO", cliente: "Ana", fonte: "Busca Paga | instagram", campanha: "Black Friday", situacao: "encontrada" }] });
    expect(lista.itens[0].provas[0]).toMatchObject({ valor: "INSTAGRAM ORGÂNICO", funil: "Vendas" });
  });

  it("vendas são gravadas entre as etapas da importação; nunca enquanto uma etapa está gravando (trava)", async () => {
    const { negs, contatos } = cenario();
    const inicial = () => ({
      crm_rd_negociacoes: negs.map((n) => ({ ...n })), crm_rd_contatos: contatos,
      integracao_catalogos: [
        { provedor: "rd_station", chave: "crm_contagens", dados: { passada: "p", funis: [], espelho: { concluidoEm: "2026-09-30T11:00:00.000Z" } } },
        // Passada longa em andamento (todos os funis): antes isso bloqueava as vendas para sempre.
        { provedor: "rd_station", chave: "crm_importacao_progresso", dados: { passada: "x", segmentos: [""], concluidaEm: null } },
      ],
      novas_vendas: [{ id: "nv-1", rd_station_id: "D-CONTRATO", rd_pipeline_id: CONTRATOS, origem_venda: null, campanha_local: null, rd_snapshot: {} }],
    });
    const ocupado = bancoFalso(inicial(), { integracao_tentar_trava: (a) => a.p_nome !== "crm_importacao" });
    expect(await avancarOrigemGeral(env, { db: ocupado.db, config: config(), refs: async () => refsBrutas })).toMatchObject({ vendasGravadas: 0, vendasPendentes: 1, motivo: "importacao_em_andamento" });
    expect(ocupado.tabela("novas_vendas")[0].campanha_local).toBeNull();
    const livre = bancoFalso(inicial());
    expect(await avancarOrigemGeral(env, { db: livre.db, config: config(), refs: async () => refsBrutas })).toMatchObject({ vendasGravadas: 1, vendasPendentes: 0 });
    expect(livre.tabela("novas_vendas")[0]).toMatchObject({ origem_venda: "Busca Paga | instagram", campanha_local: "Black Friday" });
  });
});
