import type { LinhaTexto, PalavraTexto } from "@/lib/leitor-carne/tipos";
import { caixaNaPagina, liberarCanvas, prepararImagem, type ImagemPreparada, type Rotacao } from "./preprocessamento";
import { textoSuficiente } from "./pdf";

/**
 * Camada 4 — OCR local e gratuito (tesseract.js, português, modelo LSTM).
 * Motor, núcleo WASM e modelo são servidos pelo próprio app em /vendor/ocr
 * (scripts/copiar-ocr.mjs): nenhum documento vai para serviço externo.
 * O texto reconhecido nunca é registrado em log.
 */
type Tesseract = typeof import("tesseract.js");
type WorkerOcr = Awaited<ReturnType<Tesseract["createWorker"]>>;

const BASE = `${import.meta.env.BASE_URL ?? "/"}vendor/ocr`.replace(/\/{2,}/g, "/");

let workerPromise: Promise<WorkerOcr> | null = null;

async function obterWorker(): Promise<WorkerOcr> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(async (t) => {
      const worker = await t.createWorker("por", t.OEM.LSTM_ONLY, {
        workerPath: `${BASE}/worker.min.js`,
        corePath: BASE,
        langPath: BASE,
        gzip: true,
        workerBlobURL: false,
        // O modelo (não o documento) pode ficar em cache no navegador.
        cacheMethod: "write",
      });
      await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: t.PSM.AUTO });
      return worker;
    }).catch((erro) => {
      workerPromise = null;
      throw erro;
    });
  }
  return workerPromise;
}

/** Encerra o OCR (libera memória; também é o modo de cancelar uma leitura em andamento). */
export async function encerrarOcr() {
  const atual = workerPromise;
  workerPromise = null;
  if (atual) {
    try { (await atual).terminate(); } catch { /* já encerrado */ }
  }
}

export interface ResultadoOcr {
  linhas: LinhaTexto[];
  /** Confiança média ponderada pelas palavras (0..1). */
  confianca: number;
  qualidadeImagem: number;
  tentativas: number;
  /** Rotação (sentido horário) que deixou a página em pé para a leitura. */
  rotacao: Rotacao;
}

interface BboxOcr { x0: number; y0: number; x1: number; y1: number }

/**
 * Coordenadas na imagem EM PÉ (já girada para a leitura): o parser depende da
 * ordem de cima para baixo, e a miniatura e a folha guardada usam a mesma
 * orientação. Só o recorte de margens é desfeito.
 */
function normalizar(b: BboxOcr, w: number, h: number, preparo: ImagemPreparada) {
  return caixaNaPagina({ x0: b.x0 / w, y0: b.y0 / h, x1: b.x1 / w, y1: b.y1 / h }, { recorte: preparo.recorte, rotacao: 0 });
}

async function reconhecer(preparo: ImagemPreparada): Promise<{ linhas: LinhaTexto[]; confianca: number }> {
  const worker = await obterWorker();
  const { width: w, height: h } = preparo.canvas;
  const { data } = await worker.recognize(preparo.canvas, { rotateAuto: true }, { blocks: true, text: false });
  const linhas: LinhaTexto[] = [];
  let somaConf = 0;
  let somaPeso = 0;
  for (const bloco of data.blocks ?? []) {
    for (const paragrafo of bloco.paragraphs) {
      for (const linha of paragrafo.lines) {
        const palavras: PalavraTexto[] = linha.words
          .filter((p) => p.text.trim())
          .map((p) => ({ texto: p.text, caixa: normalizar(p.bbox, w, h, preparo), confianca: Math.max(0, Math.min(1, p.confidence / 100)) }));
        if (!palavras.length) continue;
        for (const p of palavras) { somaConf += p.confianca * p.texto.length; somaPeso += p.texto.length; }
        const confianca = palavras.reduce((s, p) => s + p.confianca * p.texto.length, 0) / Math.max(1, palavras.reduce((s, p) => s + p.texto.length, 0));
        linhas.push({ texto: palavras.map((p) => p.texto).join(" "), caixa: normalizar(linha.bbox, w, h, preparo), confianca, palavras });
      }
    }
  }
  linhas.sort((a, b) => a.caixa.y0 - b.caixa.y0 || a.caixa.x0 - b.caixa.x0);
  return { linhas, confianca: somaPeso ? somaConf / somaPeso : 0 };
}

/** Nota de uma tentativa: confiança × quanto texto útil (letras e dígitos) apareceu. */
function nota(r: { linhas: LinhaTexto[]; confianca: number }) {
  if (!r.linhas.length) return 0;
  const texto = r.linhas.map((l) => l.texto).join(" ");
  const digitos = (texto.match(/\d/g) ?? []).length;
  return r.confianca * Math.min(1, digitos / 40) * (textoSuficiente(r.linhas) ? 1 : 0.5);
}

const BOA = 0.72;

/**
 * Lê uma página/imagem com tentativas adaptativas:
 * 1) tons de cinza + contraste; 2) binarizada (Otsu) + filtro de ruído;
 * 3) se ainda ruim, tenta 180°, 90° e 270° (foto de lado ou de cabeça para baixo).
 * Fica com a melhor tentativa; nada é "completado".
 */
export async function lerComOcr(fonte: HTMLCanvasElement | ImageBitmap, sinal?: AbortSignal): Promise<ResultadoOcr> {
  const tentativas: { rotacao: Rotacao; binarizar: boolean }[] = [
    { rotacao: 0, binarizar: false },
    { rotacao: 0, binarizar: true },
    { rotacao: 180, binarizar: false },
    { rotacao: 90, binarizar: false },
    { rotacao: 270, binarizar: false },
  ];
  let melhor: { linhas: LinhaTexto[]; confianca: number; qualidade: number; rotacao: Rotacao } | null = null;
  let melhorNota = -1;
  let feitas = 0;
  for (const t of tentativas) {
    if (sinal?.aborted) throw new DOMException("Leitura cancelada", "AbortError");
    if (melhorNota >= BOA) break;
    // As rotações só são tentadas quando a leitura normal ficou muito ruim.
    if (t.rotacao !== 0 && melhorNota >= 0.45) break;
    const preparo = await prepararImagem(fonte, t);
    try {
      const r = await reconhecer(preparo);
      feitas += 1;
      const n = nota(r);
      if (n > melhorNota) { melhorNota = n; melhor = { ...r, qualidade: preparo.qualidade, rotacao: preparo.rotacao }; }
    } finally {
      liberarCanvas(preparo.canvas);
    }
  }
  return { linhas: melhor?.linhas ?? [], confianca: melhor?.confianca ?? 0, qualidadeImagem: melhor?.qualidade ?? 0, tentativas: feitas, rotacao: melhor?.rotacao ?? 0 };
}
