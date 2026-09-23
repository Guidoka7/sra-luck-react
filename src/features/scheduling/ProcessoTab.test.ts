import { describe, expect, it } from "vitest";
import { DIAS_PREVISAO_CIRURGICA, sugerirPrevisaoCirurgica } from "./ProcessoTab";

describe("ProcessoTab — previsão cirúrgica sugerida", () => {
  it("pré-preenche 90 dias corridos após a data dos termos", () => {
    expect(DIAS_PREVISAO_CIRURGICA).toBe(90);
    expect(sugerirPrevisaoCirurgica({
      dataTermos: "2026-09-23",
      previsaoCirurgia: null,
    })).toBe("2026-12-22");
  });

  it("preserva uma previsão já persistida em vez de recalcular", () => {
    expect(sugerirPrevisaoCirurgica({
      dataTermos: "2026-09-23",
      previsaoCirurgia: "2027-01-15",
    })).toBe("2027-01-15");
  });

  it("não inventa previsão quando ainda não existe data dos termos", () => {
    expect(sugerirPrevisaoCirurgica({
      dataTermos: null,
      previsaoCirurgia: null,
    })).toBe("");
  });
});
