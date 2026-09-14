import { describe, expect, it } from "vitest";
import { sugerirVinculo } from "./admin-carnes";

describe("sugerirVinculo (Fase 3 — importação de carnê)", () => {
  const boletos = new Map([
    [1, { id: "boleto-1" }],
    [2, { id: "boleto-2" }],
    [3, { id: "boleto-3" }],
  ]);

  it("sem parcela na posição correspondente, não sugere vínculo", () => {
    const r = sugerirVinculo(5, boletos, false);
    expect(r).toEqual({ boletoId: null, pontuacaoConfianca: null, nivelConfianca: null, criterio: "sem_parcela_correspondente" });
  });

  it("com parcela correspondente e contagem de páginas igual à de parcelas, confiança alta", () => {
    const r = sugerirVinculo(2, boletos, true);
    expect(r.boletoId).toBe("boleto-2");
    expect(r.pontuacaoConfianca).toBe(90);
    expect(r.nivelConfianca).toBe("alta");
  });

  it("com parcela correspondente mas contagem divergente, confiança média (não automática)", () => {
    const r = sugerirVinculo(1, boletos, false);
    expect(r.boletoId).toBe("boleto-1");
    expect(r.pontuacaoConfianca).toBe(60);
    expect(r.nivelConfianca).toBe("media");
  });
});
