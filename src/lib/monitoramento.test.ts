import { describe, expect, it } from "vitest";
import { ehCancelamento, respostaEsperada } from "./monitoramento";

describe("classificação do monitoramento", () => {
  it("chamada cancelada pelo app não é falha", () => {
    expect(ehCancelamento(new DOMException("signal is aborted without reason", "AbortError"))).toBe(true);
    expect(ehCancelamento({ name: "AbortError" })).toBe(true);
    expect(ehCancelamento(new TypeError("Load failed"))).toBe(false);
  });

  it("respostas do fluxo normal: credencial errada e importação já em andamento", () => {
    expect(respostaEsperada("/api/cliente/auth", 401)).toBe(true);
    expect(respostaEsperada("/api/admin/auth", 429)).toBe(true);
    expect(respostaEsperada("/api/admin/integrations/rd-station/importar", 409)).toBe(true);
    // Qualquer outro 401/404/500 continua sendo falha.
    expect(respostaEsperada("/api/cliente/agenda", 401)).toBe(false);
    expect(respostaEsperada("/api/cliente/auth", 500)).toBe(false);
    expect(respostaEsperada("/api/cliente/perfil/foto", 404)).toBe(false);
  });
});
