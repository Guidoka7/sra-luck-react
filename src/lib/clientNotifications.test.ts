import { describe, expect, it } from "vitest";
import { abaDoDestino, destinoDaUrl } from "./clientNotifications";

describe("destino das notificações", () => {
  it("mapeia o destino para a aba do app", () => {
    expect(abaDoDestino("agenda")).toEqual({ aba: "agenda" });
    expect(abaDoDestino("pagamentos")).toEqual({ aba: "parcelas" });
    expect(abaDoDestino("clube")).toEqual({ aba: "premios" });
    expect(abaDoDestino("jornada")).toEqual({ aba: "mais", maisSubTela: "jornada" });
    expect(abaDoDestino("qualquer")).toBeNull();
  });

  it("lê o destino da URL do push", () => {
    expect(destinoDaUrl("https://x/agenda?abrirComprovante=abc")).toBe("pagamentos");
    expect(destinoDaUrl("/agenda?destino=clube")).toBe("clube");
    expect(destinoDaUrl("/agenda")).toBeNull();
  });
});
