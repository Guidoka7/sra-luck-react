import { describe, expect, it } from "vitest";
import { resolverTema } from "./temaCliente";

describe("tema do app da cliente", () => {
  it("respeita a escolha explícita e segue o celular no automático", () => {
    expect(resolverTema("claro", true)).toBe("claro");
    expect(resolverTema("escuro", false)).toBe("escuro");
    expect(resolverTema("sistema", true)).toBe("escuro");
    expect(resolverTema("sistema", false)).toBe("claro");
  });
});
