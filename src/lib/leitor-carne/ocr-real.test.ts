import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createWorker } from "tesseract.js";
import { CPF_FICTICIO, NOME_FICTICIO } from "./__fixtures__/sinteticos";
import { lerCarne } from "./leitor";
import type { LinhaTexto, PalavraTexto } from "./tipos";

/**
 * OCR REAL (tesseract.js local, modelo português do pacote) sobre a imagem
 * de um boleto SINTÉTICO (dados fictícios gerados para teste), passando pelo
 * mesmo parser usado no navegador.
 */
const require = createRequire(import.meta.url);
const langPath = join(dirname(require.resolve("@tesseract.js-data/por/package.json")), "4.0.0_best_int");
const imagem = readFileSync(join(__dirname, "__fixtures__/boleto-sintetico-4de6.png"));
const largura = imagem.readUInt32BE(16);
const altura = imagem.readUInt32BE(20);

describe("OCR real em imagem sintética", () => {
  it("lê parcela, vencimento, valor e pagador sem alertas de divergência", async () => {
    const worker = await createWorker("por", 1, { langPath, gzip: true, cacheMethod: "none" });
    try {
      const { data } = await worker.recognize(imagem, {}, { blocks: true });
      const linhas: LinhaTexto[] = [];
      const caixa = (b: { x0: number; y0: number; x1: number; y1: number }) => ({ x0: b.x0 / largura, y0: b.y0 / altura, x1: b.x1 / largura, y1: b.y1 / altura });
      for (const bloco of data.blocks ?? []) for (const par of bloco.paragraphs) for (const l of par.lines) {
        const palavras: PalavraTexto[] = l.words.filter((w) => w.text.trim()).map((w) => ({ texto: w.text, caixa: caixa(w.bbox), confianca: w.confidence / 100 }));
        if (palavras.length) linhas.push({ texto: palavras.map((p) => p.texto).join(" "), caixa: caixa(l.bbox), confianca: palavras.reduce((s, p) => s + p.confianca, 0) / palavras.length, palavras });
      }
      const carne = lerCarne([{ pagina: 1, fonte: "OCR", linhas, confiancaOcr: data.confidence / 100 }], {
        tipoDocumento: "IMAGE", totalPaginas: 1, paginasIlegiveis: [], cliente: { nome: NOME_FICTICIO, cpf: CPF_FICTICIO }, referenciaIso: "2026-01-10",
      });
      expect(carne.parcelas).toHaveLength(1);
      const p = carne.parcelas[0];
      expect(p.numero.valor).toBe(4);
      expect(p.total.valor).toBe(6);
      expect(p.vencimento.valor).toBe("2026-05-16");
      expect(p.valorCentavos.valor).toBe(42778);
      expect(carne.nomeCliente.valor).toBe(NOME_FICTICIO);
      expect(carne.alertas.map((a) => a.codigo)).not.toContain("CLIENT_NAME_MISMATCH");
      expect(carne.alertas.map((a) => a.codigo)).not.toContain("CLIENT_CPF_MISMATCH");
      // OCR nunca vira importação silenciosa: sem confirmação da linha digitável, não é ALTA.
      if (!p.linhaDigitavel.valor) expect(p.nivel).not.toBe("ALTA");
    } finally {
      await worker.terminate();
    }
  }, 60_000);
});
