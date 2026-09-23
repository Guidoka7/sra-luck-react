import { encontrarBoletos } from "./febraban";
import { encontrarNumerosParcela } from "./normalizadores";
import { rotulosNaLinha, type SegmentoTexto } from "./candidatos";
import { ROTULOS } from "./rotulos";
import type { Caixa, LinhaTexto, PaginaTexto } from "./tipos";

/**
 * Divide uma página em regiões, uma por parcela. Âncoras: linhas digitáveis
 * distintas (cada boleto tem a sua; as duas vias do mesmo boleto contam como
 * uma) ou, sem elas, números de parcela distintos ao lado do rótulo "Parcela".
 * Uma âncora só → a página inteira é uma parcela.
 */
export interface SegmentoParcela extends SegmentoTexto {
  segmento: number;
  regiao: Caixa;
}

interface Grupo { chave: string; xs: number[]; ys: number[] }

function centro(c: Caixa) {
  return { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 };
}

function media(v: number[]) {
  return v.reduce((s, x) => s + x, 0) / v.length;
}

function caixaDe(linhas: LinhaTexto[]): Caixa {
  return {
    x0: Math.min(...linhas.map((l) => l.caixa.x0)),
    y0: Math.min(...linhas.map((l) => l.caixa.y0)),
    x1: Math.max(...linhas.map((l) => l.caixa.x1)),
    y1: Math.max(...linhas.map((l) => l.caixa.y1)),
  };
}

function ancoras(pagina: PaginaTexto): Grupo[] {
  const porLinha = new Map<string, Grupo>();
  const add = (chave: string, l: LinhaTexto) => {
    const g = porLinha.get(chave) ?? { chave, xs: [], ys: [] };
    const c = centro(l.caixa);
    g.xs.push(c.x); g.ys.push(c.y);
    porLinha.set(chave, g);
  };
  for (const l of pagina.linhas) {
    const { validos, sugestoes } = encontrarBoletos(l.texto);
    for (const b of validos) add(`linha:${b.codigoBarras}`, l);
    for (const s of sugestoes) add(`linha:${s.sugerida.codigoBarras}`, l);
  }
  if (porLinha.size >= 2) return [...porLinha.values()];

  const porParcela = new Map<string, Grupo>();
  for (const l of pagina.linhas) {
    if (!rotulosNaLinha(l.texto, ROTULOS.parcela).length) continue;
    for (const p of encontrarNumerosParcela(l.texto)) {
      const chave = `parcela:${p.numero}/${p.total}`;
      const g = porParcela.get(chave) ?? { chave, xs: [], ys: [] };
      const c = centro(l.caixa);
      g.xs.push(c.x); g.ys.push(c.y);
      porParcela.set(chave, g);
    }
  }
  return porParcela.size >= 2 ? [...porParcela.values()] : [];
}

export function segmentarPagina(pagina: PaginaTexto): SegmentoParcela[] {
  const inteira = (): SegmentoParcela[] => [{
    pagina: pagina.pagina, fonte: pagina.fonte, linhas: pagina.linhas, segmento: 1,
    regiao: pagina.linhas.length ? caixaDe(pagina.linhas) : { x0: 0, y0: 0, x1: 1, y1: 1 },
  }];
  const grupos = ancoras(pagina);
  if (grupos.length < 2) return inteira();

  const centros = grupos.map((g) => ({ chave: g.chave, x: media(g.xs), y: media(g.ys) }));
  const porY = [...centros].sort((a, b) => a.y - b.y);
  const porX = [...centros].sort((a, b) => a.x - b.x);
  const menorDy = Math.min(...porY.slice(1).map((c, i) => c.y - porY[i].y));
  const menorDx = Math.min(...porX.slice(1).map((c, i) => c.x - porX[i].x));
  const eixo: "y" | "x" | "2d" = menorDy > 0.06 ? "y" : menorDx > 0.2 ? "x" : "2d";

  const destino = (l: LinhaTexto): number => {
    const c = centro(l.caixa);
    let melhor = 0;
    let menor = Infinity;
    centros.forEach((g, i) => {
      const d = eixo === "y" ? Math.abs(c.y - g.y) : eixo === "x" ? Math.abs(c.x - g.x) : Math.hypot(c.x - g.x, (c.y - g.y) * 1.5);
      if (d < menor) { menor = d; melhor = i; }
    });
    return melhor;
  };

  const baldes: LinhaTexto[][] = centros.map(() => []);
  for (const l of pagina.linhas) baldes[destino(l)].push(l);
  const ordem = centros.map((c, i) => ({ c, i })).sort((a, b) => (eixo === "x" ? a.c.x - b.c.x : a.c.y - b.c.y || a.c.x - b.c.x));
  return ordem
    .filter(({ i }) => baldes[i].length)
    .map(({ i }, n) => ({ pagina: pagina.pagina, fonte: pagina.fonte, linhas: baldes[i], segmento: n + 1, regiao: caixaDe(baldes[i]) }));
}
