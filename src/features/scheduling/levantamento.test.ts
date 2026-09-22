import { describe, expect, it } from "vitest";
import { exigeTaxaCartao, formatarValor, lerValor, normalizarFormas, validarLevantamento } from "./levantamento";

describe("Etapa 2 — leitura de valores", () => {
  it("entende pt-BR, ponto decimal e o valor persistido sem multiplicar por 100", () => {
    expect(lerValor("9.333,30")).toBe(9333.3);
    expect(lerValor("9333.30")).toBe(9333.3);
    expect(lerValor("4000.5")).toBe(4000.5);
    expect(lerValor("4.000")).toBe(4000);
    expect(lerValor("R$ 1.250,00")).toBe(1250);
    expect(Number.isNaN(lerValor(""))).toBe(true);
    expect(formatarValor(4000)).toBe("4.000,00");
  });
});

describe("Etapa 2 — formas de pagamento", () => {
  it("mantém só formas conhecidas, sem repetição, na ordem de FORMAS_CUSTEIO", () => {
    expect(normalizarFormas(["boleto_100", "pix", "pix", "dinheiro"])).toEqual(["pix", "boleto_100"]);
  });
  it("taxa do cartão só é exigida quando o cartão está entre as formas", () => {
    expect(exigeTaxaCartao(["pix"])).toBe(false);
    expect(exigeTaxaCartao(["pix", "cartao"])).toBe(true);
  });
});

describe("Etapa 2 — validação antes de confirmar", () => {
  it("sem forma selecionada não confirma", () => {
    expect(validarLevantamento({ saldo: "4.000,00", taxa: "5,4", formas: [] })).toEqual({ erro: "Selecione ao menos uma forma de pagamento." });
  });
  it("saldo inválido ou negativo não confirma", () => {
    expect(validarLevantamento({ saldo: "", taxa: "", formas: ["pix"] })).toHaveProperty("erro");
    expect(validarLevantamento({ saldo: "abc", taxa: "", formas: ["pix"] })).toHaveProperty("erro");
    expect(validarLevantamento({ saldo: "-10", taxa: "", formas: ["pix"] })).toHaveProperty("erro");
  });
  it("cartão exige taxa válida", () => {
    expect(validarLevantamento({ saldo: "100", taxa: "", formas: ["cartao"] })).toHaveProperty("erro");
    expect(validarLevantamento({ saldo: "100", taxa: "150", formas: ["cartao"] })).toHaveProperty("erro");
  });
  it("monta o payload real do levantamento (sem taxa quando não há cartão)", () => {
    expect(validarLevantamento({ saldo: "4.000,00", taxa: "5,4", formas: ["boleto_100", "pix"] })).toEqual({
      payload: { decisao: "aprovada", saldoRestante: 4000, formasCusteio: ["pix", "boleto_100"] },
    });
    expect(validarLevantamento({ saldo: "9333.30", taxa: "5,4", formas: ["cartao", "pix"] })).toEqual({
      payload: { decisao: "aprovada", saldoRestante: 9333.3, formasCusteio: ["cartao", "pix"], taxaCartao: 5.4 },
    });
  });
});
