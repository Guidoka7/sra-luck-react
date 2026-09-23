import { describe, expect, it } from "vitest";
import { doValorCalendario, formatarDataDigitada, paraValorCalendario } from "./CampoDataNascimento";

describe("data de nascimento: digitar ou escolher no calendário", () => {
  it("mantém a máscara DD/MM/AAAA ao digitar", () => {
    expect(formatarDataDigitada("1")).toBe("1");
    expect(formatarDataDigitada("1203")).toBe("12/03");
    expect(formatarDataDigitada("12031990")).toBe("12/03/1990");
    expect(formatarDataDigitada("12/03/19901")).toBe("12/03/1990");
  });

  it("converte entre o campo e o calendário nativo", () => {
    expect(paraValorCalendario("12/03/1990")).toBe("1990-03-12");
    expect(paraValorCalendario("12/03")).toBe("");
    expect(doValorCalendario("1990-03-12")).toBe("12/03/1990");
    expect(doValorCalendario("")).toBe("");
  });
});
