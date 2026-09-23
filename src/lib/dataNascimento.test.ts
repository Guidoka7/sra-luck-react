import { describe, expect, it } from "vitest";
import { completarComZero, distribuirData, juntarData, normalizarParte } from "./dataNascimento";

describe("data de nascimento em três campos", () => {
  it("avança sozinho quando o dia ou o mês já estão completos", () => {
    expect(normalizarParte("dia", "1")).toEqual({ valor: "1", completo: false });
    expect(normalizarParte("dia", "12")).toEqual({ valor: "12", completo: true });
    expect(normalizarParte("dia", "5")).toEqual({ valor: "05", completo: true });
    expect(normalizarParte("mes", "3")).toEqual({ valor: "03", completo: true });
    expect(normalizarParte("mes", "1")).toEqual({ valor: "1", completo: false });
    expect(normalizarParte("ano", "19a90")).toEqual({ valor: "1990", completo: true });
  });

  it("completa com zero ao sair do campo", () => {
    expect(completarComZero("dia", "3")).toBe("03");
    expect(completarComZero("mes", "1")).toBe("01");
    expect(completarComZero("ano", "199")).toBe("199");
  });

  it("reconhece a data inteira colada em vários formatos", () => {
    const esperado = { dia: "12", mes: "03", ano: "1990" };
    expect(distribuirData("12/03/1990")).toEqual(esperado);
    expect(distribuirData("12-3-1990")).toEqual(esperado);
    expect(distribuirData("12031990")).toEqual(esperado);
    expect(distribuirData("1990-03-12")).toEqual(esperado);
    expect(distribuirData("12/03")).toBeNull();
  });

  it("entrega o formato validado pelo login", () => {
    expect(juntarData({ dia: "12", mes: "03", ano: "1990" })).toBe("12/03/1990");
  });
});
