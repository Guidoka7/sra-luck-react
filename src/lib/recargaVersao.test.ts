import { describe, expect, it } from "vitest";
import { ehFalhaDeVersao } from "./recargaVersao";

describe("falha de versão após deploy", () => {
  it("reconhece erros de arquivo de build ausente", () => {
    expect(ehFalhaDeVersao(new TypeError("Failed to fetch dynamically imported module: https://x/assets/AgendaPage-abc.js"))).toBe(true);
    expect(ehFalhaDeVersao(new Error("Unable to preload CSS for /assets/index-1.css"))).toBe(true);
    expect(ehFalhaDeVersao(new TypeError("Importing a module script failed."))).toBe(true);
    expect(ehFalhaDeVersao(new TypeError("'text/html' is not a valid JavaScript MIME type."))).toBe(true);
  });
  it("não confunde com erros comuns", () => {
    expect(ehFalhaDeVersao(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(ehFalhaDeVersao(null)).toBe(false);
  });
});
