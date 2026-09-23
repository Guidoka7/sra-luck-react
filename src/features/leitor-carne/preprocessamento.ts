import type { Caixa } from "@/lib/leitor-carne/tipos";

/**
 * Camada 5 — pré-processamento adaptativo da imagem antes do OCR.
 * Tudo em canvas, no aparelho: nenhuma imagem sai do navegador.
 *
 * Etapas: redimensionar (lado maior ≤ 2600 px, amplia fotos pequenas),
 * girar (0/90/180/270 quando a leitura falha), tons de cinza, esticar o
 * contraste, cortar margens vazias e, na segunda tentativa, limiarizar (Otsu)
 * com filtro de ruído. A inclinação pequena é corrigida pelo próprio OCR
 * (rotateAuto). Cada etapa devolve o mapeamento para as coordenadas da
 * página original, para a evidência visual apontar o lugar certo.
 */

export type Rotacao = 0 | 90 | 180 | 270;

export interface OpcoesPreparo {
  rotacao?: Rotacao;
  binarizar?: boolean;
}

export interface ImagemPreparada {
  canvas: HTMLCanvasElement;
  /** Área da imagem original (após a rotação) efetivamente enviada ao OCR, 0..1. */
  recorte: Caixa;
  rotacao: Rotacao;
  /** 0..1 — contraste × nitidez × resolução. Só métrica, nunca decide campo. */
  qualidade: number;
}

const LADO_MAXIMO = 2600;
const LADO_MINIMO = 1500;

const ceder = () => new Promise<void>((r) => setTimeout(r, 0));

function novoCanvas(largura: number, altura: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(largura));
  c.height = Math.max(1, Math.round(altura));
  return c;
}

function contexto(c: HTMLCanvasElement) {
  return c.getContext("2d", { willReadFrequently: true })!;
}

/** Libera a memória de um canvas (importante no celular). */
export function liberarCanvas(c: HTMLCanvasElement | null | undefined) {
  if (c) { c.width = 0; c.height = 0; }
}

/** Desenha a fonte girada e na escala de trabalho. */
function desenhar(fonte: HTMLCanvasElement | ImageBitmap, rotacao: Rotacao) {
  const w0 = fonte.width;
  const h0 = fonte.height;
  const girada = rotacao === 90 || rotacao === 270;
  const w = girada ? h0 : w0;
  const h = girada ? w0 : h0;
  const maior = Math.max(w, h);
  let escala = maior > LADO_MAXIMO ? LADO_MAXIMO / maior : 1;
  if (maior * escala < LADO_MINIMO) escala = Math.min(2, LADO_MINIMO / maior);
  const c = novoCanvas(w * escala, h * escala);
  const ctx = contexto(c);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotacao * Math.PI) / 180);
  ctx.drawImage(fonte, (-w0 * escala) / 2, (-h0 * escala) / 2, w0 * escala, h0 * escala);
  return c;
}

/** Luminância em tons de cinza (Uint8). */
function cinza(dados: ImageData): Uint8ClampedArray {
  const px = dados.data;
  const g = new Uint8ClampedArray(dados.width * dados.height);
  for (let i = 0, j = 0; j < g.length; i += 4, j += 1) g[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  return g;
}

function histograma(g: Uint8ClampedArray) {
  const h = new Uint32Array(256);
  for (let i = 0; i < g.length; i += 1) h[g[i]] += 1;
  return h;
}

function percentil(h: Uint32Array, total: number, p: number) {
  const alvo = total * p;
  let soma = 0;
  for (let v = 0; v < 256; v += 1) { soma += h[v]; if (soma >= alvo) return v; }
  return 255;
}

/** Estica o contraste entre os percentis 1 e 99 (documentos desbotados/escuros). */
function esticarContraste(g: Uint8ClampedArray) {
  const h = histograma(g);
  const lo = percentil(h, g.length, 0.01);
  const hi = percentil(h, g.length, 0.99);
  if (hi - lo < 16) return;
  const k = 255 / (hi - lo);
  for (let i = 0; i < g.length; i += 1) g[i] = (g[i] - lo) * k;
}

/** Limiar de Otsu. */
function limiarOtsu(g: Uint8ClampedArray) {
  const h = histograma(g);
  let somaTotal = 0;
  for (let v = 0; v < 256; v += 1) somaTotal += v * h[v];
  let somaFundo = 0, pesoFundo = 0, melhor = 0, limiar = 128;
  for (let v = 0; v < 256; v += 1) {
    pesoFundo += h[v];
    if (!pesoFundo) continue;
    const pesoFrente = g.length - pesoFundo;
    if (!pesoFrente) break;
    somaFundo += v * h[v];
    const m0 = somaFundo / pesoFundo;
    const m1 = (somaTotal - somaFundo) / pesoFrente;
    const entre = pesoFundo * pesoFrente * (m0 - m1) ** 2;
    if (entre > melhor) { melhor = entre; limiar = v; }
  }
  return limiar;
}

/** Filtro de mediana 3×3 (remove pontos isolados de digitalização). */
function mediana3(g: Uint8ClampedArray, w: number, h: number) {
  const saida = new Uint8ClampedArray(g);
  const viz = new Uint8Array(9);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) viz[k++] = g[(y + dy) * w + x + dx];
      viz.sort();
      saida[y * w + x] = viz[4];
    }
  }
  return saida;
}

/** Proporção de pixels escuros isolados (ruído "sal e pimenta"). */
function ruido(g: Uint8ClampedArray, w: number, h: number, limiar: number) {
  let isolados = 0, escuros = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      if (g[i] >= limiar) continue;
      escuros += 1;
      if (g[i - 1] >= limiar && g[i + 1] >= limiar && g[i - w] >= limiar && g[i + w] >= limiar) isolados += 1;
    }
  }
  return escuros ? isolados / escuros : 0;
}

/** Caixa do conteúdo (pixels escuros) com folga — corta margens vazias. */
function caixaConteudo(g: Uint8ClampedArray, w: number, h: number, limiar: number): Caixa {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (g[y * w + x] < limiar) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  const folga = Math.round(Math.min(w, h) * 0.02);
  return {
    x0: Math.max(0, x0 - folga) / w,
    y0: Math.max(0, y0 - folga) / h,
    x1: Math.min(w, x1 + folga) / w,
    y1: Math.min(h, y1 + folga) / h,
  };
}

/** Nitidez: média do gradiente absoluto (amostrado). */
function nitidez(g: Uint8ClampedArray, w: number, h: number) {
  let soma = 0, n = 0;
  for (let y = 1; y < h - 1; y += 3) for (let x = 1; x < w - 1; x += 3) {
    const i = y * w + x;
    soma += Math.abs(4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]);
    n += 1;
  }
  return n ? soma / n : 0;
}

function desvioPadrao(g: Uint8ClampedArray) {
  let soma = 0, soma2 = 0;
  for (let i = 0; i < g.length; i += 4) { soma += g[i]; soma2 += g[i] * g[i]; }
  const n = Math.ceil(g.length / 4);
  const media = soma / n;
  return Math.sqrt(Math.max(0, soma2 / n - media * media));
}

export async function prepararImagem(fonte: HTMLCanvasElement | ImageBitmap, opcoes: OpcoesPreparo = {}): Promise<ImagemPreparada> {
  const rotacao = opcoes.rotacao ?? 0;
  const base = desenhar(fonte, rotacao);
  const w = base.width;
  const h = base.height;
  const ctx = contexto(base);
  const dados = ctx.getImageData(0, 0, w, h);
  let g = cinza(dados);
  await ceder();

  const qualidade = Math.max(0, Math.min(1,
    Math.min(1, desvioPadrao(g) / 60) * 0.4
    + Math.min(1, nitidez(g, w, h) / 25) * 0.4
    + Math.min(1, Math.min(w, h) / 1400) * 0.2,
  ));

  esticarContraste(g);
  const limiar = limiarOtsu(g);
  if (opcoes.binarizar) {
    if (ruido(g, w, h, limiar) > 0.25) { g = mediana3(g, w, h); await ceder(); }
    for (let i = 0; i < g.length; i += 1) g[i] = g[i] < limiar ? 0 : 255;
  }
  await ceder();

  const px = dados.data;
  for (let i = 0, j = 0; j < g.length; i += 4, j += 1) { px[i] = px[i + 1] = px[i + 2] = g[j]; px[i + 3] = 255; }
  ctx.putImageData(dados, 0, 0);

  const recorte = caixaConteudo(g, w, h, Math.min(limiar, 200));
  const cw = Math.round((recorte.x1 - recorte.x0) * w);
  const ch = Math.round((recorte.y1 - recorte.y0) * h);
  if (cw >= w * 0.97 && ch >= h * 0.97) return { canvas: base, recorte: { x0: 0, y0: 0, x1: 1, y1: 1 }, rotacao, qualidade };
  const cortado = novoCanvas(cw, ch);
  contexto(cortado).drawImage(base, Math.round(recorte.x0 * w), Math.round(recorte.y0 * h), cw, ch, 0, 0, cw, ch);
  liberarCanvas(base);
  return { canvas: cortado, recorte, rotacao, qualidade };
}

/**
 * Converte uma caixa normalizada da imagem preparada (recortada e girada)
 * para a página original, como ela é exibida na miniatura.
 */
export function caixaNaPagina(c: Caixa, preparo: Pick<ImagemPreparada, "recorte" | "rotacao">): Caixa {
  const { recorte, rotacao } = preparo;
  const rw = recorte.x1 - recorte.x0;
  const rh = recorte.y1 - recorte.y0;
  // 1) desfaz o recorte → coordenadas da imagem girada
  const g = { x0: recorte.x0 + c.x0 * rw, y0: recorte.y0 + c.y0 * rh, x1: recorte.x0 + c.x1 * rw, y1: recorte.y0 + c.y1 * rh };
  // 2) desfaz a rotação (sentido horário) → coordenadas originais
  const ponto = (x: number, y: number): [number, number] => {
    switch (rotacao) {
      case 90: return [y, 1 - x];
      case 180: return [1 - x, 1 - y];
      case 270: return [1 - y, x];
      default: return [x, y];
    }
  };
  const [ax, ay] = ponto(g.x0, g.y0);
  const [bx, by] = ponto(g.x1, g.y1);
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}
