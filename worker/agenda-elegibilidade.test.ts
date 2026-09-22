import { describe, expect, it } from "vitest";
import { missingToEligibility, percentualElegibilidade, requiredPaid } from "./agenda-elegibilidade";

/**
 * V46 — tabela de elegibilidade. Espelha public.pode_agendar
 * (migration_064): 12/18/24x=60%, 36x=70%, 48/60/72x=80%, ceil.
 */
describe("requiredPaid", () => {
  it("12x: 60% de 12 = 7.2 -> ceil 8", () => {
    expect(requiredPaid(12)).toBe(8);
  });
  it("18x: 60% de 18 = 10.8 -> ceil 11", () => {
    expect(requiredPaid(18)).toBe(11);
  });
  it("24x: 60% de 24 = 14.4 -> ceil 15", () => {
    expect(requiredPaid(24)).toBe(15);
  });
  it("36x: 70% de 36 = 25.2 -> ceil 26", () => {
    expect(requiredPaid(36)).toBe(26);
  });
  it("48x: 80% de 48 = 38.4 -> ceil 39", () => {
    expect(requiredPaid(48)).toBe(39);
  });
  it("60x: 80% de 60 = 48 -> ceil 48 (exato, sem arredondar para cima)", () => {
    expect(requiredPaid(60)).toBe(48);
  });
  it("72x: 80% de 72 = 57.6 -> ceil 58", () => {
    expect(requiredPaid(72)).toBe(58);
  });
  it("modalidade fora da tabela cai no fallback por faixa (ceil de 80%)", () => {
    expect(requiredPaid(84)).toBe(Math.ceil(84 * 0.8));
  });
});

/**
 * Caso A/C do teste especificado: "abaixo do threshold" vs "exatamente no
 * threshold" precisam ser distinguidos com exatidão — um erro de off-by-one
 * aqui classificaria erroneamente uma cliente como elegível ou não.
 */
describe("missingToEligibility — casos A) abaixo do threshold / C) exatamente no threshold", () => {
  it("A) 12x com 7 pagas (1 abaixo do mínimo de 8): falta exatamente 1", () => {
    expect(missingToEligibility(12, 7)).toBe(1);
  });
  it("C) 12x com 8 pagas (exatamente no mínimo): falta 0 -> elegível", () => {
    expect(missingToEligibility(12, 8)).toBe(0);
  });
  it("A) 36x com 25 pagas (1 abaixo do mínimo de 26): falta exatamente 1", () => {
    expect(missingToEligibility(36, 25)).toBe(1);
  });
  it("C) 36x com 26 pagas (exatamente no mínimo): falta 0 -> elegível", () => {
    expect(missingToEligibility(36, 26)).toBe(0);
  });
  it("C) 60x com 48 pagas (exatamente no mínimo, caso de 80% exato): falta 0 -> elegível", () => {
    expect(missingToEligibility(60, 48)).toBe(0);
  });
  it("A) 60x com 47 pagas (1 abaixo): falta exatamente 1", () => {
    expect(missingToEligibility(60, 47)).toBe(1);
  });
  it("mais parcelas pagas que o mínimo continua elegível (falta 0, nunca negativo)", () => {
    expect(missingToEligibility(12, 12)).toBe(0);
  });
  it("zero parcelas pagas nunca retorna negativo mesmo com total inválido", () => {
    expect(missingToEligibility(12, -5)).toBe(8);
  });
});

describe("percentualElegibilidade (exibição na Central V46)", () => {
  it("espelha a tabela da modalidade", () => {
    expect([12, 18, 24, 36, 48, 60, 72].map(percentualElegibilidade)).toEqual([60, 60, 60, 70, 80, 80, 80]);
  });
});
