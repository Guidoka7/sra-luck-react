import { describe, expect, it } from "vitest";
import { calcularPrevisaoElegibilidade } from "./eligibility-forecast";

function parcelas12() {
  return Array.from({ length: 12 }, (_, index) => ({
    numero_parcela: index + 1,
    total_parcelas: 12,
    status: index < 3 ? "pago" : "nao_pago",
    data_vencimento: `2026-${String(index + 1).padStart(2, "0")}-15`,
    data_pagamento: index < 3 ? `2026-${String(index + 1).padStart(2, "0")}-15` : null,
    suspensa: false,
  }));
}

describe("previsão inteligente de elegibilidade", () => {
  it("usa a quantidade real de parcelas e a regra V46", () => {
    const resultado = calcularPrevisaoElegibilidade(parcelas12());
    expect(resultado.totalParcelas).toBe(12);
    expect(resultado.percentual).toBe(60);
    expect(resultado.parcelasNecessarias).toBe(8);
    expect(resultado.parcelasPagas).toBe(3);
    expect(resultado.parcelasRestantes).toBe(5);
    expect(resultado.data).toBe("2026-08-15");
    expect(resultado.fonte).toBe("cronograma");
  });

  it("recalcula quando uma parcela é suspensa e realocada para o final", () => {
    const parcelas = parcelas12();
    parcelas[3]!.suspensa = true; // abril sai da sequência ativa

    const resultado = calcularPrevisaoElegibilidade(parcelas);
    expect(resultado.suspensasConsideradas).toBe(1);
    expect(resultado.data).toBe("2026-09-15");
  });

  it("recalcula pela ordem real dos vencimentos após edição manual", () => {
    const parcelas = parcelas12();
    parcelas[3]!.data_vencimento = "2026-11-20";

    const resultado = calcularPrevisaoElegibilidade(parcelas);
    expect(resultado.data).toBe("2026-09-15");
  });

  it("usa a data real quando a elegibilidade já foi atingida", () => {
    const parcelas = parcelas12().map((parcela, index) => ({
      ...parcela,
      status: index < 8 ? "pago" : "nao_pago",
      data_pagamento: index < 8 ? `2026-${String(index + 1).padStart(2, "0")}-16` : null,
    }));

    const resultado = calcularPrevisaoElegibilidade(parcelas, "2026-08-18");
    expect(resultado.atingida).toBe(true);
    expect(resultado.data).toBe("2026-08-18");
    expect(resultado.parcelasRestantes).toBe(0);
  });

  it("não inventa previsão sem financeiro real", () => {
    const resultado = calcularPrevisaoElegibilidade([]);
    expect(resultado.data).toBeNull();
    expect(resultado.fonte).toBe("sem_base");
  });

  it("aplica 80% em 48 parcelas (39 pagamentos)", () => {
    const parcelas = Array.from({ length: 48 }, (_, index) => ({
      numero_parcela: index + 1,
      total_parcelas: 48,
      status: "nao_pago",
      data_vencimento: `${2026 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-10`,
      suspensa: false,
    }));
    const resultado = calcularPrevisaoElegibilidade(parcelas);
    expect(resultado.percentual).toBe(80);
    expect(resultado.parcelasNecessarias).toBe(39);
  });
});
