import { describe, expect, it } from "vitest";
import { adicionarDiasCivil, dataCivilValida, hojeSaoPaulo, intervaloDiaOperacionalUtc } from "./dataCivil";

describe("data civil operacional", () => {
  it("usa o dia de Brasília/São Paulo na virada UTC", () => {
    expect(hojeSaoPaulo(new Date("2026-09-24T01:30:00.000Z"))).toBe("2026-09-23");
  });
  it("rejeita datas civis impossíveis", () => {
    expect(dataCivilValida("2026-02-28")).toBe(true);
    expect(dataCivilValida("2026-02-31")).toBe(false);
  });
  it("soma dias civis sem depender do timezone do runtime", () => {
    expect(adicionarDiasCivil("2026-09-23", 2)).toBe("2026-09-25");
  });
  it("converte o dia operacional em intervalo UTC exclusivo", () => {
    expect(intervaloDiaOperacionalUtc("2026-09-23")).toEqual({
      inicio: "2026-09-23T03:00:00.000Z",
      fimExclusivo: "2026-09-24T03:00:00.000Z",
    });
  });
});
