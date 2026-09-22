import { describe, expect, it } from "vitest";
import { agendaSyncTipoFromRow } from "./agendaRealtime";

describe("agenda realtime sync", () => {
  it("reconhece sinais das duas agendas", () => {
    expect(agendaSyncTipoFromRow({ tipo: "termos", versao: 2 })).toBe("termos");
    expect(agendaSyncTipoFromRow({ tipo: "cirurgia", versao: 4 })).toBe("cirurgia");
  });

  it("ignora payloads que não pertencem ao sinal público da agenda", () => {
    expect(agendaSyncTipoFromRow(null)).toBeNull();
    expect(agendaSyncTipoFromRow({})).toBeNull();
    expect(agendaSyncTipoFromRow({ tipo: "clientes" })).toBeNull();
  });
});
