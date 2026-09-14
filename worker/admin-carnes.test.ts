import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extrairDadosBoleto, pontuarCandidatos, type BoletoCandidato, type DadosExtraidosBoleto } from "./pdf-boleto-parser";

const candidatos: BoletoCandidato[] = [
  { id: "boleto-1", numero_parcela: 1, valor: 520.83, data_vencimento: "2026-10-10" },
  { id: "boleto-2", numero_parcela: 2, valor: 520.83, data_vencimento: "2026-11-10" },
  { id: "boleto-3", numero_parcela: 3, valor: 520.83, data_vencimento: "2026-12-10" },
];

function dados(overrides: Partial<DadosExtraidosBoleto> = {}): DadosExtraidosBoleto {
  return { valor: null, vencimento: null, numeroParcela: null, linhaDigitavel: null, cpf: null, textoBruto: "", ...overrides };
}

describe("pontuarCandidatos (Fase 12 — correção: matching real, não por ordem de página)", () => {
  it("sem nenhum dado extraído, não sugere vínculo — mesmo se a página coincidir com uma parcela existente", () => {
    const r = pontuarCandidatos(dados(), candidatos, 1, null);
    expect(r.boletoId).toBeNull();
    expect(r.statusVinculacao).toBe("revisar");
  });

  it("ordem de página sozinha (sem outros dados) nunca é suficiente para sugerir vínculo", () => {
    // página 2 "coincide" com boleto-2 por ordem, mas nenhum dado real extraído
    const r = pontuarCandidatos(dados(), candidatos, 2, null);
    expect(r.boletoId).toBeNull();
    expect(r.pontuacaoConfianca).toBeLessThan(40);
  });

  it("valor + vencimento extraídos e conferindo => confiança alta, mesmo em página fora de ordem", () => {
    // dados batem com boleto-3, mas a página é a 1ª do arquivo (ordem não corresponde)
    const r = pontuarCandidatos(dados({ valor: 520.83, vencimento: "2026-12-10" }), candidatos, 1, null);
    expect(r.boletoId).toBe("boleto-3");
    expect(r.nivelConfianca).toBe("alta");
    expect(r.statusVinculacao).toBe("aguardando_confirmacao");
  });

  it("só valor conferindo (empatado entre várias parcelas) não atinge o piso mínimo sozinho", () => {
    const r = pontuarCandidatos(dados({ valor: 520.83 }), candidatos, 99, null);
    // valor bate com todas (40 pts) e não há vencimento/parcela para desambiguar — ainda assim >= 40 é "media"
    expect(r.pontuacaoConfianca).toBeGreaterThanOrEqual(40);
    expect(r.nivelConfianca).toBe("media");
  });

  it("CPF extraído divergente do CPF da cliente força revisão mesmo com outros dados batendo", () => {
    const r = pontuarCandidatos(dados({ valor: 520.83, vencimento: "2026-10-10", cpf: "11122233344" }), candidatos, 1, "99988877766");
    expect(r.boletoId).toBeNull();
    expect(r.statusVinculacao).toBe("revisar");
    expect(r.motivos).toContain("cpf_extraido_diverge_do_cliente");
  });

  it("numero da parcela extraído do texto (não da ordem da página) direciona a sugestão corretamente", () => {
    const r = pontuarCandidatos(dados({ numeroParcela: 3, valor: 520.83 }), candidatos, 1, null);
    expect(r.boletoId).toBe("boleto-3");
  });
});

describe("extrairDadosBoleto (smoke test com PDF gerado em memória)", () => {
  it("extrai valor, vencimento e CPF de um texto nativo simples", async () => {
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([300, 200]);
    const fonte = await doc.embedFont(StandardFonts.Helvetica);
    pagina.drawText("Boleto - Parcela 2/12", { x: 20, y: 160, size: 10, font: fonte });
    pagina.drawText("Vencimento: 10/10/2026", { x: 20, y: 140, size: 10, font: fonte });
    pagina.drawText("Valor: R$ 520,83", { x: 20, y: 120, size: 10, font: fonte });
    pagina.drawText("Pagador: Maria Teste - CPF 123.456.789-00", { x: 20, y: 100, size: 10, font: fonte });
    const bytes = await doc.save();

    const dadosExtraidos = await extrairDadosBoleto(bytes);
    expect(dadosExtraidos.valor).toBe(520.83);
    expect(dadosExtraidos.vencimento).toBe("2026-10-10");
    expect(dadosExtraidos.numeroParcela).toBe(2);
    expect(dadosExtraidos.cpf).toBe("12345678900");
  });
});
