import { describe, expect, it } from "vitest";
import { codigoErroExecucao, pendenciaDoItem } from "./integracao-pendencias";
import { customFieldValue, statusEntradaWebhook } from "./rd-station-readonly";

const item = (resultado: string, motivo: string, rdStatus?: string) => ({ external_id: "d1", resultado, motivo, nova_venda_id: null, dados: { rdStatus } });

describe("pendências do RD — o que cada resultado exige", () => {
  it("erro de uma negociação vira pendência (antes não aparecia em lugar nenhum)", () => {
    expect(pendenciaDoItem(item("erro", "Falha inesperada ao processar."))?.tipo).toBe("negociacao_com_erro");
  });
  it("negociação GANHA fora do funil exige ação; em andamento/perdida fora do funil não", () => {
    expect(pendenciaDoItem(item("ignorada", "Fora dos funis configurados.", "won"))?.tipo).toBe("ganha_fora_do_funil");
    expect(pendenciaDoItem(item("ignorada", "Fora dos funis configurados.", "ongoing"))).toBeNull();
    expect(pendenciaDoItem(item("ignorada", "Fora do funil configurado.", "lost"))).toBeNull();
  });
  it("duplicidade e cliente existente viram duplicidade_possivel", () => {
    expect(pendenciaDoItem(item("duplicada", "Já existe venda…"))?.tipo).toBe("duplicidade_possivel");
    expect(pendenciaDoItem(item("cliente_existente", "Já existe cliente…"))?.tipo).toBe("duplicidade_possivel");
  });
  it("venda criada/atualizada não é decidida aqui (regra única no banco)", () => {
    expect(pendenciaDoItem(item("criada", "ok", "won"))).toBeNull();
    expect(pendenciaDoItem(item("atualizada", "ok", "won"))).toBeNull();
  });
  it("falha de execução agrupa por código estável", () => {
    expect(codigoErroExecucao("RD_ACCESS_TOKEN_MISSING")).toBe("RD_ACCESS_TOKEN_MISSING");
    expect(codigoErroExecucao("RD_HTTP_429")).toBe("RD_HTTP_429");
    expect(codigoErroExecucao("EXECUTION_TIMEOUT_504")).toBe("EXECUTION_TIMEOUT");
    expect(codigoErroExecucao("Falha ao ler o RD Station.")).toBe("RD_FALHA_LEITURA");
  });
});

describe("RD v2 — campos personalizados", () => {
  it("lê o formato objeto { slug: valor } (antes ficava vazio)", () => {
    const deal = { custom_fields: { "quantidade-de-parcelas": "24", "valor-parcela-lp": "500" } };
    expect(customFieldValue(deal, ["quantidade de parcelas", "parcelas"])).toBe("24");
  });
  it("continua lendo o formato lista", () => {
    const deal = { custom_fields: [{ custom_field: { label: "CPF" }, value: "529.982.247-25" }] };
    expect(customFieldValue(deal, ["cpf"])).toBe("529.982.247-25");
  });
  it("nome exato ganha de nome parecido e valor vazio é ignorado", () => {
    const deal = { custom_fields: { "parcelas-pagas": "3", "quantidade-de-parcelas": "24", parcelas: "" } };
    expect(customFieldValue(deal, ["quantidade de parcelas", "parcelas"])).toBe("24");
  });
  it("sem campo correspondente devolve undefined", () => {
    expect(customFieldValue({ custom_fields: { banco: "BRB" } }, ["cpf"])).toBeUndefined();
  });
});

describe("webhook — status do registro bruto", () => {
  it("reflete o resultado em vez de 'aguardando_conferencia' para tudo", () => {
    expect(statusEntradaWebhook("criada")).toBe("convertido");
    expect(statusEntradaWebhook("atualizada")).toBe("convertido");
    expect(statusEntradaWebhook("ignorada")).toBe("ignorado");
    expect(statusEntradaWebhook("erro")).toBe("erro");
    expect(statusEntradaWebhook("duplicada")).toBe("aguardando_conferencia");
  });
});
