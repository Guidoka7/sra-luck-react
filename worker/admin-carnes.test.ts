import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extrairDadosBoleto, pontuarCandidatos, type BoletoCandidato, type DadosExtraidosBoleto } from "./pdf-boleto-parser";

const candidatos: BoletoCandidato[] = [
  { id: "boleto-1", numero_parcela: 1, valor: 520.83, data_vencimento: "2026-10-10", identificador_externo: "00190500954014481606906809350314337370000052083", instituicao_financeira: "BRB" },
  { id: "boleto-2", numero_parcela: 2, valor: 520.83, data_vencimento: "2026-11-10", identificador_externo: "23793381286000000000300000000000000000000000", instituicao_financeira: "BRB" },
  { id: "boleto-3", numero_parcela: 3, valor: 520.83, data_vencimento: "2026-12-10", identificador_externo: "NOSSO12345", instituicao_financeira: "BRB" },
];

function dados(overrides: Partial<DadosExtraidosBoleto> = {}): DadosExtraidosBoleto {
  return {
    valor: null,
    vencimento: null,
    numeroParcela: null,
    linhaDigitavel: null,
    codigoBarras: null,
    nossoNumero: null,
    numeroDocumento: null,
    nomePagador: null,
    cpf: null,
    textoBruto: "",
    ...overrides,
  };
}

describe("pontuarCandidatos (matching conservador por conteúdo)", () => {
  it("sem nenhum dado extraído, não sugere vínculo — mesmo se a página coincidir com uma parcela existente", () => {
    const r = pontuarCandidatos(dados(), candidatos, 1, null);
    expect(r.boletoId).toBeNull();
    expect(r.statusVinculacao).toBe("revisar");
  });

  it("ordem de página sozinha nunca é suficiente para sugerir vínculo", () => {
    const r = pontuarCandidatos(dados(), candidatos, 2, null);
    expect(r.boletoId).toBeNull();
    expect(r.pontuacaoConfianca).toBeLessThan(55);
  });

  it("valor + vencimento extraídos e conferindo => confiança alta, mesmo em página fora de ordem", () => {
    const r = pontuarCandidatos(dados({ valor: 520.83, vencimento: "2026-12-10" }), candidatos, 1, null);
    expect(r.boletoId).toBe("boleto-3");
    expect(r.nivelConfianca).toBe("alta");
    expect(r.statusVinculacao).toBe("aguardando_confirmacao");
  });

  it("só valor conferindo em várias parcelas é ambíguo e força revisão", () => {
    const r = pontuarCandidatos(dados({ valor: 520.83 }), candidatos, 99, null);
    expect(r.boletoId).toBeNull();
    expect(r.statusVinculacao).toBe("revisar");
  });

  it("ordem da página não desempata candidatos ambíguos que têm a mesma evidência forte", () => {
    const r = pontuarCandidatos(dados({ valor: 520.83 }), candidatos, 2, null);
    expect(r.boletoId).toBeNull();
    expect(r.motivos).toContain("mais_de_um_candidato_plausivel");
  });

  it("CPF extraído divergente do CPF da cliente força revisão mesmo com outros dados batendo", () => {
    const r = pontuarCandidatos(dados({ valor: 520.83, vencimento: "2026-10-10", cpf: "11122233344" }), candidatos, 1, "99988877766");
    expect(r.boletoId).toBeNull();
    expect(r.statusVinculacao).toBe("revisar");
    expect(r.motivos).toContain("cpf_extraido_diverge_do_cliente");
  });

  it("numero da parcela + valor extraídos direcionam a sugestão corretamente", () => {
    const r = pontuarCandidatos(dados({ numeroParcela: 3, valor: 520.83 }), candidatos, 1, null);
    expect(r.boletoId).toBe("boleto-3");
    expect(r.statusVinculacao).toBe("aguardando_confirmacao");
  });

  it("identificador externo exato identifica a parcela sem depender da ordem", () => {
    const r = pontuarCandidatos(dados({ nossoNumero: "NOSSO-12345" }), candidatos, 1, null);
    expect(r.boletoId).toBe("boleto-3");
    expect(r.nivelConfianca).toBe("alta");
    expect(r.motivos).toContain("identificador_externo_confere");
  });
});

describe("extrairDadosBoleto (smoke test com PDF gerado em memória)", () => {
  it("extrai valor, vencimento, parcela, CPF, nosso número, documento e pagador de texto nativo", async () => {
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([420, 260]);
    const fonte = await doc.embedFont(StandardFonts.Helvetica);
    pagina.drawText("Boleto - Parcela 2/12", { x: 20, y: 220, size: 10, font: fonte });
    pagina.drawText("Vencimento: 10/10/2026", { x: 20, y: 200, size: 10, font: fonte });
    pagina.drawText("Valor: R$ 520,83", { x: 20, y: 180, size: 10, font: fonte });
    pagina.drawText("Nosso numero: NOSSO-12345", { x: 20, y: 160, size: 10, font: fonte });
    pagina.drawText("Documento: DOC-9988", { x: 20, y: 140, size: 10, font: fonte });
    pagina.drawText("Pagador: Maria Teste - CPF 123.456.789-00", { x: 20, y: 120, size: 10, font: fonte });
    const bytes = await doc.save();

    const extraidos = await extrairDadosBoleto(bytes);
    expect(extraidos.valor).toBe(520.83);
    expect(extraidos.vencimento).toBe("2026-10-10");
    expect(extraidos.numeroParcela).toBe(2);
    expect(extraidos.cpf).toBe("12345678900");
    expect(extraidos.nossoNumero).toBe("NOSSO12345");
    expect(extraidos.numeroDocumento).toBe("DOC9988");
    expect(extraidos.nomePagador).toContain("Maria Teste");
  });
});
