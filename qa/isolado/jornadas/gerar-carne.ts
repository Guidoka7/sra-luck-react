// Gera um carnê PDF fictício (texto nativo) com o gerador sintético do próprio repo.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { writeFileSync } from "node:fs";
import { carne } from "/home/user/sra-luck-react/src/lib/leitor-carne/__fixtures__/sinteticos";

const TOTAL = 12;
const paginas = carne(TOTAL, { cpf: "90000000760", nome: "GIOVANA FICTICIA QA CARNE", centavos: 50000, inicio: "2026-10-15", venda: "QA777" });
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const W = 595, H = 842;
for (const p of paginas) {
  const page = doc.addPage([W, H]);
  for (const l of p.linhas) for (const w of l.palavras) page.drawText(w.texto, { x: w.caixa.x0 * W, y: H - w.caixa.y0 * H - 12, size: 9, font });
}
writeFileSync("/home/user/qa-supabase/qa/fixtures/carne-qa-giovana-12x.pdf", await doc.save());
console.log("ok", paginas.length);
