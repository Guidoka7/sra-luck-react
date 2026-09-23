import { describe, expect, it } from "vitest";
import { codigoBarrasParaLinha, codigoBarrasValido, decodificarBoleto, encontrarBoletosNoTexto, linhaDigitavelValida, vencimentoDoFator } from "./boleto-febraban";

/** Monta um código de barras válido (calcula o DV geral) para os testes. */
export function montarBarras(banco: string, fator: number, valorCentavos: number, livre: string) {
  const semDv = `${banco}9${String(fator).padStart(4, "0")}${String(valorCentavos).padStart(10, "0")}${livre.padStart(25, "0")}`;
  for (let dv = 1; dv <= 9; dv += 1) {
    const barras = semDv.slice(0, 4) + dv + semDv.slice(4);
    if (codigoBarrasValido(barras)) return barras;
  }
  throw new Error("sem DV");
}

function formatarLinha(linha: string) {
  return `${linha.slice(0, 5)}.${linha.slice(5, 10)} ${linha.slice(10, 15)}.${linha.slice(15, 21)} ${linha.slice(21, 26)}.${linha.slice(26, 32)} ${linha[32]} ${linha.slice(33)}`;
}

describe("boleto FEBRABAN", () => {
  it("valida e decodifica linha digitável (valor e vencimento)", () => {
    // Fator 1000 no ciclo novo = 22/02/2025; +600 dias = 15/10/2026.
    const barras = montarBarras("748", 1600, 83333, "1234567890123456789012345");
    const linha = codigoBarrasParaLinha(barras);
    expect(linhaDigitavelValida(linha)).toBe(true);
    const d = decodificarBoleto(formatarLinha(linha), "2026-09-23")!;
    expect(d.banco).toBe("748");
    expect(d.valor).toBe(833.33);
    expect(d.vencimento).toBe("2026-10-15");
    expect(d.codigoBarras).toBe(barras);
  });

  it("rejeita linha com um dígito trocado", () => {
    const linha = codigoBarrasParaLinha(montarBarras("001", 1600, 10000, "9"));
    const trocada = linha.slice(0, 12) + ((Number(linha[12]) + 1) % 10) + linha.slice(13);
    expect(linhaDigitavelValida(trocada)).toBe(false);
    expect(decodificarBoleto(trocada)).toBeNull();
  });

  it("fator de vencimento usa o ciclo mais próximo da referência", () => {
    expect(vencimentoDoFator(1000, "2025-03-01")).toBe("2025-02-22");
    expect(vencimentoDoFator(1000, "2000-07-01")).toBe("2000-07-03");
    expect(vencimentoDoFator(0)).toBeNull();
  });

  it("encontra o boleto no texto da página e conta vias repetidas uma vez", () => {
    const linha = codigoBarrasParaLinha(montarBarras("748", 1631, 83333, "55"));
    const texto = `Recibo do pagador\nParcela 02/60 Vencimento 15/11/2026\n${formatarLinha(linha)}\nFicha de compensação\n${formatarLinha(linha)}\nCPF 123.456.789-09`;
    const achados = encontrarBoletosNoTexto(texto, "2026-09-23");
    expect(achados).toHaveLength(1);
    expect(achados[0].vencimento).toBe("2026-11-15");
  });

  it("não inventa boleto em números longos quaisquer", () => {
    expect(encontrarBoletosNoTexto("Protocolo 1234567890 1234567890 1234567890 1234567890 1234567890 99")).toHaveLength(0);
  });
});
