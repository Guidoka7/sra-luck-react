import { describe, expect, it } from "vitest";
import { cpfValido, dataNascimentoValida, getAppAccessRequirements } from "./app-access";

const HOJE = "2026-09-22";

describe("dataNascimentoValida", () => {
  it("aceita datas ISO reais e a própria data de hoje", () => {
    expect(dataNascimentoValida("1990-01-01", HOJE)).toBe(true);
    expect(dataNascimentoValida("2000-02-29", HOJE)).toBe(true);
    expect(dataNascimentoValida(HOJE, HOJE)).toBe(true);
  });

  it("rejeita datas futuras, impossíveis, vazias e formatos diferentes de ISO", () => {
    expect(dataNascimentoValida("2026-09-23", HOJE)).toBe(false);
    expect(dataNascimentoValida("2025-02-30", HOJE)).toBe(false);
    expect(dataNascimentoValida("", HOJE)).toBe(false);
    expect(dataNascimentoValida(null, HOJE)).toBe(false);
    expect(dataNascimentoValida("31/12/1990", HOJE)).toBe(false);
    expect(dataNascimentoValida("abc", HOJE)).toBe(false);
  });
});

describe("requisitos para acesso ao app", () => {
  const cpf = "52998224725";

  it("mantém a validação de CPF e exige nascimento válido + financeiro persistido", () => {
    expect(cpfValido(cpf)).toBe(true);
    const ok = getAppAccessRequirements({ name: "Cliente Teste", cpf, birthDate: "1990-01-01", installmentCount: 1 }, HOJE);
    expect(ok.canRelease).toBe(true);
    expect(ok.missing).toEqual([]);
  });

  it("marca data futura como requisito ausente e impede a liberação", () => {
    const r = getAppAccessRequirements({ name: "Cliente Teste", cpf, birthDate: "2026-09-23", installmentCount: 1 }, HOJE);
    expect(r.hasBirthDate).toBe(false);
    expect(r.canRelease).toBe(false);
    expect(r.missing).toContain("data_nascimento");
  });
});
