import { describe, expect, it } from "vitest";
import { calcularEncargosAtraso } from "./encargos";

describe("calcularEncargosAtraso", () => {
  it("não cobra encargos no vencimento", () => {
    expect(calcularEncargosAtraso(1000, "2026-09-23", "2026-09-23")).toEqual({
      diasEmAtraso: 0, juros: 0, multa: 0, encargos: 0, valorAtualizado: 1000,
    });
  });

  it("aplica mora diária de 0,20% e multa única de 2%", () => {
    const r = calcularEncargosAtraso(1000, "2026-09-22", "2026-09-23");
    expect(r.diasEmAtraso).toBe(1);
    expect(r.juros).toBeCloseTo(2);
    expect(r.multa).toBeCloseTo(20);
    expect(r.valorAtualizado).toBeCloseTo(1022);
  });

  it.each([
    ["2026-08-24", 30, 60, 20],
    ["2026-08-23", 31, 62, 20],
    ["2026-07-25", 60, 120, 20],
  ])("não reaplica a multa após %s", (vencimento, dias, juros, multa) => {
    const r = calcularEncargosAtraso(1000, vencimento, "2026-09-23");
    expect(r.diasEmAtraso).toBe(dias);
    expect(r.juros).toBeCloseTo(juros);
    expect(r.multa).toBeCloseTo(multa);
  });
});
