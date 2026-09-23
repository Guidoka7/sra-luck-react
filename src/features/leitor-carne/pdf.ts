import type { LinhaTexto, PalavraTexto } from "@/lib/leitor-carne/tipos";

/**
 * Camadas 2 e 3 — PDF no navegador (pdfjs-dist): texto nativo com posição e,
 * quando a página não tem texto útil, renderização para o OCR.
 * Carregado sob demanda para não pesar o restante do admin. Usa o build
 * "legacy" do pdfjs, compatível com navegadores sem as APIs JS mais novas.
 */
type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type DocumentoPdf = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;
type PaginaPdf = Awaited<ReturnType<DocumentoPdf["getPage"]>>;

let pdfjsPromise: Promise<Pdfjs> | null = null;
async function pdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function abrirPdf(bytes: Uint8Array): Promise<DocumentoPdf> {
  const lib = await pdfjs();
  // Cópia: o pdfjs transfere o buffer para o worker.
  return lib.getDocument({ data: bytes.slice() }).promise;
}

interface Item { texto: string; x: number; y: number; w: number; h: number }

/** Texto nativo da página agrupado em linhas visuais, coordenadas normalizadas 0..1. */
export async function textoNativo(pagina: PaginaPdf): Promise<LinhaTexto[]> {
  const viewport = pagina.getViewport({ scale: 1 });
  const conteudo = await pagina.getTextContent();
  const itens: Item[] = [];
  for (const item of conteudo.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const [, , , d, e, f] = item.transform as number[];
    const altura = Math.abs(d) || item.height || 8;
    itens.push({ texto: item.str, x: e / viewport.width, y: (viewport.height - f - altura) / viewport.height, w: (item.width || item.str.length * altura * 0.5) / viewport.width, h: altura / viewport.height });
  }
  itens.sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas: Item[][] = [];
  for (const it of itens) {
    const atual = linhas[linhas.length - 1];
    if (atual && Math.abs(atual[0].y - it.y) <= Math.max(atual[0].h, it.h) * 0.5) atual.push(it);
    else linhas.push([it]);
  }
  return linhas.map((grupo) => {
    grupo.sort((a, b) => a.x - b.x);
    const palavras: PalavraTexto[] = [];
    let texto = "";
    let fimAnterior = -1;
    for (const it of grupo) {
      const lacuna = fimAnterior < 0 ? 0 : it.x - fimAnterior;
      texto += fimAnterior < 0 ? it.texto : lacuna > it.h * 0.9 ? `   ${it.texto}` : lacuna > it.h * 0.15 ? ` ${it.texto}` : it.texto;
      fimAnterior = it.x + it.w;
      let x = it.x;
      const porChar = it.w / Math.max(1, it.texto.length);
      for (const p of it.texto.split(/(\s+)/)) {
        if (p.trim()) palavras.push({ texto: p, caixa: { x0: x, y0: it.y, x1: x + p.length * porChar, y1: it.y + it.h }, confianca: 1 });
        x += p.length * porChar;
      }
    }
    return {
      texto,
      confianca: 1,
      palavras,
      caixa: { x0: Math.min(...grupo.map((g) => g.x)), y0: Math.min(...grupo.map((g) => g.y)), x1: Math.max(...grupo.map((g) => g.x + g.w)), y1: Math.max(...grupo.map((g) => g.y + g.h)) },
    };
  });
}

/** Página com texto nativo útil (senão vai para o OCR). */
export function textoSuficiente(linhas: LinhaTexto[]): boolean {
  const texto = linhas.map((l) => l.texto).join(" ");
  const letras = (texto.match(/[A-Za-zÀ-ú]/g) ?? []).length;
  const digitos = (texto.match(/\d/g) ?? []).length;
  return letras >= 25 && digitos >= 8;
}

/** Renderiza a página num canvas com ~largura px (para OCR e miniatura). */
export async function renderizarPagina(pagina: PaginaPdf, largura: number): Promise<HTMLCanvasElement> {
  const base = pagina.getViewport({ scale: 1 });
  const escala = Math.min(4, largura / base.width);
  const viewport = pagina.getViewport({ scale: escala });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pagina.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

export type { DocumentoPdf, PaginaPdf };
