import { describe, expect, it } from "vitest";
import { getAppAccessRequirements, shouldShowPlanningFallback } from "../src/lib/appAccess";

const VALID_CPF = "529.982.247-25";

describe("requisitos para liberar acesso ao app da cliente", () => {
  const complete = {
    name: "Maria da Silva",
    cpf: VALID_CPF,
    birthDate: "1992-04-18",
    installmentCount: 1,
  };

  it("rejeita liberação sem nome", () => {
    const result = getAppAccessRequirements({ ...complete, name: " " });
    expect(result.canRelease).toBe(false);
    expect(result.missing).toContain("nome");
  });

  it("rejeita liberação sem CPF", () => {
    const result = getAppAccessRequirements({ ...complete, cpf: null });
    expect(result.canRelease).toBe(false);
    expect(result.missing).toContain("cpf");
  });

  it("rejeita liberação com CPF inválido", () => {
    const result = getAppAccessRequirements({ ...complete, cpf: "111.111.111-11" });
    expect(result.canRelease).toBe(false);
    expect(result.hasCpf).toBe(false);
    expect(result.missing).toContain("cpf");
  });

  it("rejeita liberação sem data de nascimento", () => {
    const result = getAppAccessRequirements({ ...complete, birthDate: null });
    expect(result.canRelease).toBe(false);
    expect(result.missing).toContain("data_nascimento");
  });

  it("rejeita liberação sem parcelas reais persistidas", () => {
    const result = getAppAccessRequirements({ ...complete, installmentCount: 0 });
    expect(result.canRelease).toBe(false);
    expect(result.hasFinancial).toBe(false);
    expect(result.missing).toContain("financeiro");
  });

  it("libera com nome, CPF válido, nascimento e ao menos uma parcela", () => {
    const result = getAppAccessRequirements(complete);
    expect(result.canRelease).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("procedimento não participa da regra de liberação", () => {
    const result = getAppAccessRequirements(complete);
    expect(result).not.toHaveProperty("procedure");
    expect(result.canRelease).toBe(true);
  });

  it("mantém fallback defensivo quando cliente autenticada não possui parcelas", () => {
    expect(shouldShowPlanningFallback(0)).toBe(true);
    expect(shouldShowPlanningFallback(null)).toBe(true);
  });

  it("usa experiência normal quando existem parcelas", () => {
    expect(shouldShowPlanningFallback(1)).toBe(false);
    expect(shouldShowPlanningFallback(12)).toBe(false);
  });
});
