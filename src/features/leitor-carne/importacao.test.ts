import { describe, expect, it } from "vitest";
import { lotearFolhas } from "./importacao";

describe("lotes de folhas do leitor de carnê", () => {
  it("divide 60 folhas pequenas em 40 + 20 para respeitar o limite do endpoint", () => {
    const folhas = Array.from({ length: 60 }, () => ({ size: 10_000 }));
    const lotes = lotearFolhas(folhas);
    expect(lotes.map((l) => l.length)).toEqual([40, 20]);
  });

  it("também quebra o lote antes de ultrapassar o limite de tamanho", () => {
    const folhas = [{ size: 1_700_000 }, { size: 1_700_000 }, { size: 100_000 }];
    const lotes = lotearFolhas(folhas);
    expect(lotes.map((l) => l.length)).toEqual([1, 2]);
  });

  it("não cria lotes vazios", () => {
    expect(lotearFolhas([])).toEqual([]);
  });
});
