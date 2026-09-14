import { describe, expect, it } from "vitest";
import { calcularTaxaCartao } from "./cardPayment";

describe("calcularTaxaCartao", () => {
  it("calcula a taxa e o total a partir do valor e do percentual configurados", () => {
    const { feeAmount, total } = calcularTaxaCartao(1000, 5.4);
    expect(feeAmount).toBeCloseTo(54, 2);
    expect(total).toBeCloseTo(1054, 2);
  });

  it("não cobra taxa quando o percentual configurado é zero", () => {
    const { feeAmount, total } = calcularTaxaCartao(320.5, 0);
    expect(feeAmount).toBe(0);
    expect(total).toBe(320.5);
  });

  it("o total é sempre o valor original mais a taxa, arredondado a centavos", () => {
    const { feeAmount, total } = calcularTaxaCartao(199.99, 3.33);
    expect(total).toBeCloseTo(199.99 + feeAmount, 2);
  });
});
