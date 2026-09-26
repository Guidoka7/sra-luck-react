import { afterEach, describe, expect, it, vi } from "vitest";
import { ehFalhaDeVersao, recarregarParaVersaoNova } from "./recargaVersao";

afterEach(() => vi.unstubAllGlobals());

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
  it("tenta recuperar uma única vez por build e permite um build posterior", () => {
    const valores = new Map<string, string>();
    const reload = vi.fn();
    let script = "https://app.test/assets/index-antigo.js";
    vi.stubGlobal("document", { querySelector: () => ({ src: script }) });
    vi.stubGlobal("sessionStorage", {
      getItem: (chave: string) => valores.get(chave) ?? null,
      setItem: (chave: string, valor: string) => valores.set(chave, valor),
    });
    vi.stubGlobal("window", { location: { reload } });

    expect(recarregarParaVersaoNova()).toBe(true);
    expect(recarregarParaVersaoNova()).toBe(false);
    script = "https://app.test/assets/index-novo.js";
    expect(recarregarParaVersaoNova()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
