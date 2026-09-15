import { describe, expect, it } from "vitest";
import { percentualNecessario, primeiroNome } from "./utils";

describe("percentualNecessario", () => {
  it("segue a tabela de regras por quantidade de parcelas do contrato", () => {
    expect(percentualNecessario(12)).toBe(60);
    expect(percentualNecessario(18)).toBe(60);
    expect(percentualNecessario(24)).toBe(60);
    expect(percentualNecessario(36)).toBe(70);
    expect(percentualNecessario(48)).toBe(80);
    expect(percentualNecessario(60)).toBe(80);
    expect(percentualNecessario(72)).toBe(80);
  });

  it("usa 60% como padrão seguro para planos fora da tabela", () => {
    expect(percentualNecessario(99)).toBe(60);
    expect(percentualNecessario(null)).toBe(60);
    expect(percentualNecessario(undefined)).toBe(60);
  });
});

describe("primeiroNome", () => {
  it("extrai o primeiro nome de um nome completo", () => {
    expect(primeiroNome("Ana Paula Souza")).toBe("Ana");
  });
});
