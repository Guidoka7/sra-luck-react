import { describe, it, expect } from "vitest";
import { PADRAO_CRM, validarConfigCrm, salvarConfig, configDaFuncao, limparCacheConfig, type ConfigCrm } from "./integracoes-registro";
import { extrairCamposSelecionados, importarCrm } from "./crm-importacao";
import { normalizarDealRd } from "./rd-station-readonly";
import { bancoFalso } from "./banco-falso.testutil";
import type { Env } from "./supabase";
const A = "a".repeat(24), B = "b".repeat(24);
const campo = (fonte: string, rotulo = fonte) => ({ fonte, rotulo });
const funil = (pipelineId: string, camposSelecionados: ReturnType<typeof campo>[]) => ({ pipelineId, etapas: [], mapeamento: { ...PADRAO_CRM.mapeamento }, camposSelecionados });
const config: ConfigCrm = { ...PADRAO_CRM, funis: [funil(A, [campo("deal:sdr", "Responsável SDR"), campo("deal:compareceu"), campo("deal:valor"), campo("contact:modalidades"), campo("deal:ausente")]), funil(B, [campo("deal_field:status", "Situação")])] };
const deal = { id: "D1", name: "QA", pipeline_id: A, status: "won", contact_ids: ["C1"], custom_fields: { sdr: "Fernanda", compareceu: false, valor: 0 } };
const contato = { id: "C1", name: "QA", custom_fields: { modalidades: ["Online", "Presencial"] } };
const snapshot = normalizarDealRd(deal)!;

describe("campos escolhidos por funil", () => {
  it("persiste e recarrega seleções independentes sem configurar campos automaticamente", async () => {
    const { db } = bancoFalso();
    const env = {} as Env;
    const resultado = await salvarConfig(env, { provedor: "rd_station", funcao: "importacao", config, versao: 0 }, "qa", { db });
    expect(resultado).toMatchObject({ ok: true });
    limparCacheConfig();
    const salvo = await configDaFuncao<ConfigCrm>(env, "rd_station", "importacao", { db });
    expect(salvo.funis).toEqual(config.funis);
    expect(validarConfigCrm({ ...PADRAO_CRM, funis: [funil(A, [])] })).toMatchObject({ ok: true, config: { funis: [{ camposSelecionados: [] }] } });
  });
  it("rejeita fonte inválida, duplicada, nome vazio e seleção excessiva", () => {
    for (const campos of [[campo("deal:__proto__.x")], [campo("deal:sdr"), campo("deal:sdr")], [campo("deal:sdr", " ")], Array.from({ length: 101 }, (_, i) => campo(`deal:c${i}`))]) {
      expect(validarConfigCrm({ ...config, funis: [funil(A, campos)] }).ok).toBe(false);
    }
  });
  it("preserva falso, zero e listas; não infere valores ausentes", () => {
    const campos = extrairCamposSelecionados(snapshot, deal, contato, config);
    expect(campos.map((c) => c.valor)).toEqual(["Fernanda", false, 0, ["Online", "Presencial"], null]);
    expect(campos.at(-1)?.situacao).toBe("ausente");
    expect(extrairCamposSelecionados(snapshot, deal, undefined, config)[3].situacao).toBe("origem_nao_carregada");
    const outro = { ...deal, pipeline_id: B };
    expect(extrairCamposSelecionados(normalizarDealRd(outro)!, outro, contato, config)).toEqual([{ fonte: "deal_field:status", rotulo: "Situação", valor: "won", situacao: "presente" }]);
  });
  it("importa e atualiza snapshot sem duplicar ou sobrescrever edição local", async () => {
    const { db, tabela } = bancoFalso();
    const fontes = { deals: async () => [deal], refs: async () => ({ contatos: [contato], usuarios: [], campanhas: [], fontes: [] }) };
    await importarCrm({} as Env, { origem: "manual", ator: "qa" }, { db, config, fontes });
    const venda = tabela("novas_vendas")[0];
    expect(venda.rd_snapshot._sra_mapeamento.campos[0].valor).toBe("Fernanda");
    venda.nome_completo = "Nome editado localmente";
    deal.custom_fields.sdr = "Outra SDR";
    await importarCrm({} as Env, { origem: "manual", ator: "qa" }, { db, config, fontes });
    expect(tabela("novas_vendas")).toHaveLength(1);
    expect(venda.nome_completo).toBe("Nome editado localmente");
    expect(venda.rd_snapshot._sra_mapeamento.campos[0].valor).toBe("Outra SDR");
  });
});
