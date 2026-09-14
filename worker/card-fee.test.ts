import { describe, expect, it } from "vitest";
import { calcularTaxaCartao } from "./card-fee";

describe("calcularTaxaCartao (servidor)", () => {
  it("recalcula taxa e total a partir do valor real da parcela e da config administrativa", () => {
    const { feeAmount, total } = calcularTaxaCartao(500, 5.4);
    expect(feeAmount).toBeCloseTo(27, 2);
    expect(total).toBeCloseTo(527, 2);
  });

  it("nunca aceita um total diferente de valor + taxa", () => {
    const { feeAmount, total } = calcularTaxaCartao(1234.56, 2.9);
    expect(total).toBeCloseTo(1234.56 + feeAmount, 2);
  });
});
