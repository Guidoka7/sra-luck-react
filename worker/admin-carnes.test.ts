import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extrairTextosDoPdf, lerTextoDaPagina } from "./carne-leitura";
import { planejarVinculos, type ParcelaAlvo } from "./carne-vinculo";
import { formatarLinha, linhaDeTeste, vencimentoMensal } from "./__fixtures__/boletos";

/** Carnê em PDF (texto nativo), uma folha por boleto, como os bancos emitem. */
async function carnePdf(folhas: { vencimento: string; valor: number; rotulo: string }[]) {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  folhas.forEach((f, i) => {
    const pagina = doc.addPage([595, 842]);
    const [a, m, d] = f.vencimento.split("-");
    const linha = formatarLinha(linhaDeTeste(f.vencimento, f.valor, String(i + 1)));
    const linhas = [
      "RECIBO DO PAGADOR", "Pagador: MARIA LUZ  CPF: 123.456.789-09", `Parcela ${f.rotulo}`,
      `Vencimento ${d}/${m}/${a}`, `Valor do documento R$ ${f.valor.toFixed(2).replace(".", ",")}`, linha,
      "FICHA DE COMPENSAÇÃO".normalize("NFD").replace(/[̀-ͯ]/g, ""), linha,
    ];
    linhas.forEach((texto, j) => pagina.drawText(texto, { x: 40, y: 780 - j * 24, size: 11, font: fonte }));
  });
  return new Uint8Array(await doc.save());
}

describe("carnê em PDF: corte, leitura e vínculo de ponta a ponta", () => {
  it("lê as 60 folhas de um carnê e anexa cada uma na parcela certa", async () => {
    const folhas = Array.from({ length: 60 }, (_, i) => ({ vencimento: vencimentoMensal("2026-10", i), valor: 833.33, rotulo: `${String(i + 1).padStart(2, "0")}/60` }));
    const bytes = await carnePdf(folhas);
    const textos = await extrairTextosDoPdf(bytes);
    expect(textos).toHaveLength(60);
    const lidas = textos!.map((t, i) => lerTextoDaPagina(t, i + 1, "2026-09-23"));
    expect(lidas.every((l) => l.linhaValidada && l.valor === 833.33)).toBe(true);

    const parcelas: ParcelaAlvo[] = Array.from({ length: 72 }, (_, i) => ({ id: `p${i + 1}`, numero_parcela: i + 1, valor: 833.33, data_vencimento: vencimentoMensal("2026-10", i), identificador_externo: null, temBoleto: false }));
    const decisoes = planejarVinculos(lidas, parcelas, "12345678909");
    expect(decisoes.filter((d) => d.acao === "anexar")).toHaveLength(60);
    expect(decisoes.map((d) => d.boletoId)).toEqual(parcelas.slice(0, 60).map((p) => p.id));
  });

  it("PDF inválido não derruba a leitura (retorna null)", async () => {
    expect(await extrairTextosDoPdf(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
