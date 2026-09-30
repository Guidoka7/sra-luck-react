import { describe, expect, it } from "vitest";
import { bancoFalso } from "./banco-falso.testutil";
import { avancarOrigemAmpliada, candidatas, filtrosTelefone, patchColunasOrigem } from "./crm-origem-ampliada";
import { montarOrigem } from "./crm-origem";
import { PADRAO_CRM, type ConfigCrm } from "./integracoes-registro";
import type { Env } from "./supabase";

const env = {} as Env;
const FUNIL = "a".repeat(24);
const config = (extra: Partial<ConfigCrm> = {}) => ({ ...PADRAO_CRM, ativo: true, funis: [{ pipelineId: FUNIL, etapas: [], mapeamento: { ...PADRAO_CRM.mapeamento } }], ...extra }) as ConfigCrm;
const refs = async () => ({
  fontes: [{ id: "src1", name: "Busca Paga | instagram" }], campanhas: [{ id: "camp1", name: "Black Friday" }], funis: [{ id: "pVendas", name: "Vendas" }],
});

const semRegistro = (id: string) => montarOrigem({ id, pipeline_id: FUNIL, contact_ids: ["ct1"], created_at: "2026-03-01T00:00:00Z" }, [], {}, { agora: "2026-09-01T00:00:00Z" });
const venda = (id: string, extra: Record<string, unknown> = {}) => ({
  id, rd_station_id: `D-${id}`, rd_pipeline_id: FUNIL, status: "aguardando_cadastro", telefone: "556184035758", email: null,
  origem_venda: "Não registrada no RD", campanha_local: "Não registrada no RD",
  rd_snapshot: {
    contact_ids: ["ct1"], outro: "mantido",
    _sra_contato: { dados: { id: "ct1", emails: [{ email: "ana@x.com" }], phones: [{ phone: "556184035758" }] }, lidoEm: "2026-09-01T00:00:00Z" },
    _sra_origem: semRegistro(`D-${id}`),
  },
  ...extra,
});

/** RD falso: aceita e-mail entre aspas e telefone em lista com aspas; as demais formas são recusadas. */
function rdFalso(opcoes: { ignoraFiltro?: boolean } = {}) {
  const consultas: string[] = [];
  const contatos = [
    { id: "ct1", emails: [{ email: "ana@x.com" }], phones: [{ phone: "556184035758" }] },
    { id: "ct9", emails: [{ email: "ana@x.com" }], phones: [] },
    { id: "ct7", emails: [], phones: [{ phone: "(61) 98403-5758" }] },
    // Devolvido pelo RD, mas com outro telefone: nunca é tratado como a mesma pessoa.
    { id: "ctX", emails: [], phones: [{ phone: "(61) 91111-2222" }] },
  ];
  const buscarContatos = async (filtro: string) => {
    consultas.push(filtro);
    if (opcoes.ignoraFiltro) return Array.from({ length: 100 }, (_, i) => ({ id: `qualquer-${i}` }));
    if (filtro === 'email:"ana@x.com"') return contatos.filter((c) => c.emails.some((e) => e.email === "ana@x.com"));
    if (filtro.startsWith("phone:(\"")) return filtro.includes('"556184035758"') ? contatos.filter((c) => c.id !== "ct9") : [];
    return null;
  };
  const dealsDosContatos = async (ids: string[]) => [
    { id: "L9", pipeline_id: "pVendas", contact_ids: ["ct9"], created_at: "2025-11-01T00:00:00Z", source_id: "src1", custom_fields: {} },
    { id: "L7", pipeline_id: "pVendas", contact_ids: ["ct7"], created_at: "2025-12-01T00:00:00Z", campaign_id: "camp1", custom_fields: { "como-ficou-sabendo-da-sra-luck": "TRÁFEGO PAGO META" } },
  ].filter((d) => d.contact_ids.some((c) => ids.includes(c)));
  return { consultas, buscarContatos, dealsDosContatos };
}

describe("busca ampliada da origem (outros cadastros com o mesmo e-mail/telefone)", () => {
  it("calibra o filtro com o próprio contato, acha os outros cadastros e completa fonte e campanha com a prova", async () => {
    const { db, tabela } = bancoFalso({ novas_vendas: [venda("nv-a")] });
    const rd = rdFalso();
    const r = await avancarOrigemAmpliada(env, { db, config: config(), refs, buscarContatos: rd.buscarContatos, dealsDosContatos: rd.dealsDosContatos, relogio: () => Date.parse("2026-09-30T12:00:00Z") });
    expect(r).toMatchObject({ executada: true, analisadas: 1, comOutrosContatos: 1, melhoradas: 1, colunas: 1, formas: { email: "aspas", telefone: "lista_aspas" } });
    const v = tabela("novas_vendas")[0];
    expect(v).toMatchObject({ origem_venda: "Busca Paga | instagram", campanha_local: "Black Friday" });
    expect(v.rd_snapshot.outro).toBe("mantido");
    const o = v.rd_snapshot._sra_origem;
    expect(o).toMatchObject({ situacao: "encontrada", fonte: "Busca Paga | instagram", campanha: "Black Friday", comoFicouSabendo: "TRÁFEGO PAGO META" });
    expect(o.ampliada.contatos).toEqual([{ id: "ct9", via: "email" }, { id: "ct7", via: "telefone" }]);
    expect(o.evidencias.find((e: any) => e.campo === "campanha").negociacao).toMatchObject({ id: "L7", funil: "Vendas", outroContato: { id: "ct7", via: "telefone" } });
    // Buscada há menos de 30 dias: não entra na rodada seguinte.
    const r2 = await avancarOrigemAmpliada(env, { db, config: config(), refs, buscarContatos: rd.buscarContatos, dealsDosContatos: rd.dealsDosContatos, relogio: () => Date.parse("2026-10-01T12:00:00Z") });
    expect(r2).toMatchObject({ executada: true, analisadas: 0, pendentes: 0 });
  });

  it("não mexe no que a equipe editou no Admin, nem em campo \"ignorar\", nem troca dado real", async () => {
    const { db, tabela } = bancoFalso({
      novas_vendas: [venda("nv-a"), venda("nv-b", { origem_venda: "Instagram (anotado pela equipe)" })],
      logs_alteracoes: [{ acao: "editou_venda_local_sem_sync_rd", entidade_id: "nv-a", detalhes: { campos: ["campanha_local"] } }],
    });
    const rd = rdFalso();
    await avancarOrigemAmpliada(env, { db, config: config(), refs, buscarContatos: rd.buscarContatos, dealsDosContatos: rd.dealsDosContatos });
    expect(tabela("novas_vendas").find((v) => v.id === "nv-a")).toMatchObject({ origem_venda: "Busca Paga | instagram", campanha_local: "Não registrada no RD" });
    expect(tabela("novas_vendas").find((v) => v.id === "nv-b")).toMatchObject({ origem_venda: "Instagram (anotado pela equipe)", campanha_local: "Black Friday" });
    const ignorar = config({ funis: [{ pipelineId: FUNIL, etapas: [], mapeamento: { ...PADRAO_CRM.mapeamento, campanha: "ignorar" } }] });
    const o = montarOrigem({ id: "x", campaign_id: "c" }, [], { campanhas: new Map([["c", { name: "Real" }]]) });
    expect(patchColunasOrigem({ origem_venda: null, campanha_local: null, rd_pipeline_id: FUNIL }, o, ignorar)).toEqual({ origem_venda: "Não registrada no RD" });
    expect(patchColunasOrigem({ origem_venda: "Desconhecido", campanha_local: null, rd_pipeline_id: FUNIL }, semRegistro("y"), config())).toEqual({ campanha_local: "Não registrada no RD" });
  });

  it("RD que ignora o filtro (página cheia): ninguém é misturado e a etapa avisa", async () => {
    const { db, tabela } = bancoFalso({ novas_vendas: [venda("nv-a")] });
    const rd = rdFalso({ ignoraFiltro: true });
    const r = await avancarOrigemAmpliada(env, { db, config: config(), refs, buscarContatos: rd.buscarContatos, dealsDosContatos: rd.dealsDosContatos });
    expect(r).toMatchObject({ executada: false, motivo: "busca_indisponivel" });
    expect(tabela("novas_vendas")[0].rd_snapshot._sra_origem.situacao).toBe("sem_registro_no_rd");
    expect(tabela("integracao_catalogos").find((c) => c.chave === "crm_origem_ampliada")!.dados.ultimaRodada.erro).toMatch(/não aceitou/);
  });

  it("não roda durante uma passada da importação", async () => {
    const { db } = bancoFalso({
      novas_vendas: [venda("nv-a")],
      integracao_catalogos: [{ provedor: "rd_station", chave: "crm_importacao_progresso", dados: { passada: "p", segmentos: [""], concluidaEm: null } }],
    });
    expect(await avancarOrigemAmpliada(env, { db })).toEqual({ executada: false, motivo: "importacao_em_andamento" });
  });

  it("fila: sem registro primeiro; encontradas e buscadas há menos de 30 dias ficam de fora", () => {
    const agora = Date.parse("2026-09-30T00:00:00Z");
    const parcial = montarOrigem({ id: "p", custom_fields: { "como-ficou-sabendo-da-sra-luck": "INSTAGRAM ORGÂNICO" } }, [], {});
    const encontrada = montarOrigem({ id: "e", source_id: "s", campaign_id: "c" }, [], { fontes: new Map([["s", { name: "F" }]]), campanhas: new Map([["c", { name: "C" }]]) });
    const recente = { ...semRegistro("r"), ampliada: { em: "2026-09-20T00:00:00Z", contatos: [], negociacoes: 0 } };
    const antiga = { ...semRegistro("a"), ampliada: { em: "2026-08-01T00:00:00Z", contatos: [], negociacoes: 0 } };
    const fila = candidatas([
      { id: "1", origem: parcial }, { id: "2", origem: encontrada }, { id: "3", origem: recente }, { id: "4", origem: antiga }, { id: "5", origem: semRegistro("n") }, { id: "6", origem: {} },
    ], agora);
    expect(fila.map((v) => v.id)).toEqual(["5", "4", "1"]);
    expect(filtrosTelefone(["556184035758", "(61) 98403-5758"], "lista")).toEqual(["phone:(556184035758)"]);
    expect(filtrosTelefone(["556184035758", "(61) 98403-5758"], "aspas")).toEqual(['phone:"556184035758"', 'phone:"(61) 98403-5758"']);
  });
});
