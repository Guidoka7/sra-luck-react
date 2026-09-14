import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { REPORT_CATALOG, moeda, dataBr, dentroPeriodo, combinaBusca, gerarPdfBuffer, gerarXlsxBuffer } from "./admin-relatorios";

describe("catálogo de relatórios (Fase 10)", () => {
  it("cobre os 7 módulos do ZIP com ids únicos", () => {
    const modulos = new Set(REPORT_CATALOG.map((r) => r.modulo));
    expect(modulos).toEqual(new Set(["clientes", "financeiro", "agenda", "previsoes", "operacao", "equipe", "integracoes"]));
    const ids = REPORT_CATALOG.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("nenhum relatório tem nome ou descrição vazios", () => {
    for (const r of REPORT_CATALOG) {
      expect(r.nome.trim().length).toBeGreaterThan(0);
      expect(r.desc.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("helpers de formatação e filtro", () => {
  it("moeda formata em pt-BR/BRL", () => {
    expect(moeda(1234.5)).toContain("1.234,50");
    expect(moeda(null)).toContain("0,00");
  });

  it("dataBr converte ISO para dd/mm/yyyy", () => {
    expect(dataBr("2026-10-05")).toBe("05/10/2026");
    expect(dataBr(null)).toBe("—");
  });

  it("dentroPeriodo respeita início e fim, e trata data nula sem filtro como dentro", () => {
    expect(dentroPeriodo("2026-10-05", { periodoInicio: "2026-10-01", periodoFim: "2026-10-31" })).toBe(true);
    expect(dentroPeriodo("2026-09-30", { periodoInicio: "2026-10-01", periodoFim: "2026-10-31" })).toBe(false);
    expect(dentroPeriodo(null, {})).toBe(true);
    expect(dentroPeriodo(null, { periodoInicio: "2026-10-01" })).toBe(false);
  });

  it("combinaBusca é case-insensitive e aceita busca vazia", () => {
    expect(combinaBusca(["Maria Eduarda"], { busca: "eduarda" })).toBe(true);
    expect(combinaBusca(["Maria Eduarda"], { busca: "carla" })).toBe(false);
    expect(combinaBusca(["Maria Eduarda"], {})).toBe(true);
  });
});

describe("geração real de arquivo (Fase 10 — PDF e XLSX de verdade, não fictício)", () => {
  it("gera um PDF válido (assinatura %PDF) a partir de colunas e linhas reais", async () => {
    const bytes = await gerarPdfBuffer("Parcelas em aberto", "Outubro/2026", ["Cliente", "Valor"], [["Maria Eduarda", "R$ 520,83"]]);
    const assinatura = new TextDecoder().decode(bytes.slice(0, 5));
    expect(assinatura).toBe("%PDF-");
  });

  it("gera um XLSX válido que a própria SheetJS consegue reabrir com os dados corretos", () => {
    const bytes = gerarXlsxBuffer(["Cliente", "Valor"], [["Maria Eduarda", "520.83"], ["Juliana Costa", "1200.00"]]);
    const livro = XLSX.read(bytes, { type: "array" });
    const planilha = livro.Sheets[livro.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(planilha, { header: 1 }) as string[][];
    expect(linhas[0]).toEqual(["Cliente", "Valor"]);
    expect(linhas[1]).toEqual(["Maria Eduarda", "520.83"]);
    expect(linhas.length).toBe(3);
  });
});
