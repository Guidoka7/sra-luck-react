import { NEGATIVOS, ROTULOS, type CampoRotulado } from "./rotulos";
import type { Caixa, Candidato, LinhaTexto } from "./tipos";

/**
 * Extração por candidatos: para cada campo, reúne TODOS os valores plausíveis
 * com uma pontuação baseada em rótulo + posição + contexto + qualidade da
 * leitura. Nada de "primeira data encontrada": quem decide é a pontuação.
 *
 * pontuacao = pesoDoRotulo × proximidade × confiancaDaLinha × penalidades
 *   - pesoDoRotulo: 1 para rótulo inequívoco ("Vencimento"), menor para
 *     genéricos ("Valor"); valores SEM rótulo entram com peso baixo.
 *   - proximidade: mesma linha logo após o rótulo (1,0) > linha de baixo na
 *     mesma coluna (0,93) > duas linhas abaixo (0,85).
 *   - contexto negativo ("Data de emissão", "Desconto"...) multiplica por 0,15.
 *   - repetição do mesmo valor (vias do boleto) soma até +0,06.
 */

export interface Achado<T> {
  valor: T;
  bruto: string;
  indice: number;
}

export type Extrator<T> = (trecho: string) => Achado<T>[];

export interface SegmentoTexto {
  pagina: number;
  fonte: "PDF_TEXT" | "OCR";
  linhas: LinhaTexto[];
}

export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function regexAlias(alias: string): RegExp {
  const partes = alias.split(" ").map((p) => p.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
  return new RegExp(`(?<![a-z0-9])${partes.join("[^a-z0-9]{0,3}")}(?![a-z0-9])`, "gi");
}

const CACHE_RE = new Map<string, RegExp>();
function re(alias: string) {
  let r = CACHE_RE.get(alias);
  if (!r) { r = regexAlias(alias); CACHE_RE.set(alias, r); }
  r.lastIndex = 0;
  return r;
}

interface Ocorrencia { alias: string; peso: number; inicio: number; fim: number }

/** Ocorrências de rótulos na linha, sem sobreposição (alias mais longo vence). */
export function rotulosNaLinha(texto: string, aliases: { alias: string; peso: number }[]): Ocorrencia[] {
  const base = semAcento(texto).toLowerCase();
  const achados: Ocorrencia[] = [];
  for (const { alias, peso } of [...aliases].sort((a, b) => b.alias.length - a.alias.length)) {
    for (const m of base.matchAll(re(alias))) {
      const inicio = m.index ?? 0;
      const fim = inicio + m[0].length;
      if (achados.some((o) => inicio < o.fim && fim > o.inicio)) continue;
      achados.push({ alias, peso, inicio, fim });
    }
  }
  return achados.sort((a, b) => a.inicio - b.inicio);
}

/**
 * Faixa horizontal de um trecho da linha. Com caixas de palavra (OCR e texto
 * nativo), usa a posição real das palavras; sem elas, estima pela proporção
 * de caracteres.
 */
function faixaDoTrecho(linha: LinhaTexto, inicio: number, fim: number): [number, number] {
  if (linha.palavras?.length) {
    const base = semAcento(linha.texto).toLowerCase();
    let cursor = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const p of linha.palavras) {
      const i = base.indexOf(semAcento(p.texto).toLowerCase(), cursor);
      if (i < 0) continue;
      const f = i + p.texto.length;
      cursor = f;
      if (i < fim && f > inicio) { x0 = Math.min(x0, p.caixa.x0); x1 = Math.max(x1, p.caixa.x1); }
    }
    if (x0 !== Infinity) return [x0, x1];
  }
  const largura = linha.caixa.x1 - linha.caixa.x0;
  const n = Math.max(1, linha.texto.length);
  return [linha.caixa.x0 + (inicio / n) * largura, linha.caixa.x0 + (fim / n) * largura];
}

/** Texto da linha cuja posição horizontal cai dentro de [x0, x1]. */
export function trechoNaFaixa(linha: LinhaTexto, x0: number, x1: number): string {
  if (linha.palavras?.length) {
    return linha.palavras.filter((p) => {
      const centro = (p.caixa.x0 + p.caixa.x1) / 2;
      return centro >= x0 && centro <= x1;
    }).map((p) => p.texto).join(" ");
  }
  const largura = linha.caixa.x1 - linha.caixa.x0;
  if (largura <= 0) return linha.texto;
  const n = linha.texto.length;
  const i0 = Math.max(0, Math.floor(((x0 - linha.caixa.x0) / largura) * n));
  const i1 = Math.min(n, Math.ceil(((x1 - linha.caixa.x0) / largura) * n));
  return i1 > i0 ? linha.texto.slice(i0, i1) : "";
}

function altura(c: Caixa) {
  return Math.max(0.004, c.y1 - c.y0);
}

/** Existe contexto negativo entre o rótulo positivo mais próximo e o valor? */
function contextoNegativo(campo: CampoRotulado, linha: LinhaTexto, indiceValor: number, acima: LinhaTexto | null, xValor: [number, number]): string | null {
  const negativos = NEGATIVOS[campo];
  if (!negativos?.length) return null;
  const aliases = negativos.map((alias) => ({ alias, peso: 1 }));
  const positivos = rotulosNaLinha(linha.texto, ROTULOS[campo]).filter((o) => o.fim <= indiceValor);
  const ultimoPositivo = positivos.length ? positivos[positivos.length - 1].fim : -1;
  const negativo = rotulosNaLinha(linha.texto, aliases).filter((o) => o.fim <= indiceValor && o.inicio > ultimoPositivo);
  if (negativo.length) return negativo[negativo.length - 1].alias;
  if (acima && positivos.length === 0) {
    const cabecalho = trechoNaFaixa(acima, xValor[0] - 0.02, xValor[1] + 0.02);
    const negAcima = rotulosNaLinha(cabecalho, aliases);
    const posAcima = rotulosNaLinha(cabecalho, ROTULOS[campo]);
    if (negAcima.length && !posAcima.length) return negAcima[0].alias;
  }
  return null;
}

/** Todos os rótulos conhecidos (de qualquer campo, inclusive os de contexto negativo). */
let TODOS_ROTULOS: { alias: string; peso: number }[] | null = null;
function todosRotulos() {
  if (!TODOS_ROTULOS) {
    const vistos = new Set<string>();
    TODOS_ROTULOS = [];
    for (const lista of Object.values(ROTULOS)) for (const r of lista) if (!vistos.has(r.alias)) { vistos.add(r.alias); TODOS_ROTULOS.push({ alias: r.alias, peso: 1 }); }
    for (const lista of Object.values(NEGATIVOS)) for (const alias of lista ?? []) if (!vistos.has(alias)) { vistos.add(alias); TODOS_ROTULOS.push({ alias, peso: 1 }); }
  }
  return TODOS_ROTULOS;
}

/** Trecho formado só por rótulos (linha de cabeçalho de outra célula), sem valor. */
export function soRotulos(trecho: string): boolean {
  const ocorrencias = rotulosNaLinha(trecho, todosRotulos());
  if (!ocorrencias.length) return false;
  let resto = semAcento(trecho).toLowerCase();
  for (const o of [...ocorrencias].reverse()) resto = resto.slice(0, o.inicio) + " " + resto.slice(o.fim);
  return resto.replace(/[^a-z0-9]/g, "").length < 3;
}

interface Bruto<T> { achado: Achado<T>; pontuacao: number; motivo: string; linha: LinhaTexto }

/** Caixa das palavras que formam o valor (evidência precisa); sem palavras, a linha. */
function caixaDoValor(linha: LinhaTexto, bruto: string): Caixa {
  const alvo = semAcento(bruto).toLowerCase().replace(/\s+/g, " ").trim();
  const palavras = (linha.palavras ?? []).filter((p) => {
    const t = semAcento(p.texto).toLowerCase().replace(/[:;]+$/, "");
    return t.length > 0 && alvo.includes(t) && (t.length >= 2 || alvo === t);
  });
  if (!palavras.length) return linha.caixa;
  return {
    x0: Math.min(...palavras.map((p) => p.caixa.x0)),
    y0: Math.min(...palavras.map((p) => p.caixa.y0)),
    x1: Math.max(...palavras.map((p) => p.caixa.x1)),
    y1: Math.max(...palavras.map((p) => p.caixa.y1)),
  };
}

/**
 * Candidatos de um campo dentro de um segmento (uma parcela ou página).
 * `semRotulo`: peso para valores encontrados sem rótulo algum (0 = ignorar).
 */
export function extrairCandidatos<T>(
  seg: SegmentoTexto,
  campo: CampoRotulado,
  extrator: Extrator<T>,
  opcoes: { semRotulo: number; chave?: (v: T) => string },
): Candidato<T>[] {
  const brutos: Bruto<T>[] = [];
  const linhas = [...seg.linhas].sort((a, b) => a.caixa.y0 - b.caixa.y0 || a.caixa.x0 - b.caixa.x0);
  const vistos = new Set<string>();
  const registrar = (linha: LinhaTexto, achado: Achado<T>, pontuacao: number, motivo: string) => {
    brutos.push({ achado, pontuacao: pontuacao * linha.confianca, motivo, linha });
    vistos.add(`${linhas.indexOf(linha)}:${achado.indice}:${achado.bruto}`);
  };

  linhas.forEach((linha, i) => {
    const texto = semAcento(linha.texto);
    for (const rotulo of rotulosNaLinha(linha.texto, ROTULOS[campo])) {
      // 1) mesma linha, logo após o rótulo
      const cauda = texto.slice(rotulo.fim);
      for (const a of extrator(cauda)) {
        const distancia = a.indice;
        const achado = { ...a, indice: rotulo.fim + a.indice };
        const neg = contextoNegativo(campo, linha, achado.indice, null, [0, 0]);
        const prox = distancia <= 24 ? 1 : distancia <= 60 ? 0.9 : 0.75;
        registrar(linha, achado, rotulo.peso * prox * (neg ? 0.15 : 1), neg ? `contexto_negativo:${neg}` : `rotulo:${rotulo.alias}:mesma_linha`);
      }
      // 2) linhas abaixo, na mesma coluna do rótulo
      const [lx0, lx1] = faixaDoTrecho(linha, rotulo.inicio, rotulo.fim);
      // A coluna do rótulo vai até o próximo rótulo da mesma linha (de qualquer campo) ou até o fim da linha.
      const proximo = rotulosNaLinha(linha.texto, todosRotulos()).find((o) => o.inicio >= rotulo.fim);
      const fimColuna = proximo ? Math.max(lx1 + 0.02, faixaDoTrecho(linha, proximo.inicio, proximo.fim)[0] - 0.01) : Math.max(lx1 + 0.12, lx0 + 0.18, linha.caixa.x1 + 0.02);
      const limite = linha.caixa.y1 + altura(linha.caixa) * 3.2;
      let degrau = 0;
      for (let j = i + 1; j < linhas.length && degrau < 2; j += 1) {
        const abaixo = linhas[j];
        if (abaixo.caixa.y0 > limite) break;
        if (abaixo.caixa.y0 < linha.caixa.y1 - altura(linha.caixa) * 0.4) continue;
        const trecho = trechoNaFaixa(abaixo, lx0 - 0.03, fimColuna);
        if (!trecho.trim()) continue;
        degrau += 1;
        // Se a linha de baixo é outro rótulo do mesmo campo, ou só cabeçalhos de
        // outras células, a coluna já mudou de dono: não há valor ali.
        if (rotulosNaLinha(trecho, ROTULOS[campo]).length || soRotulos(trecho)) break;
        for (const a of extrator(semAcento(trecho))) {
          const neg = contextoNegativo(campo, abaixo, abaixo.texto.indexOf(a.bruto), null, [lx0, lx1]);
          registrar(abaixo, a, rotulo.peso * (degrau === 1 ? 0.93 : 0.85) * (neg ? 0.15 : 1), neg ? `contexto_negativo:${neg}` : `rotulo:${rotulo.alias}:abaixo`);
        }
      }
    }
  });

  if (opcoes.semRotulo > 0) {
    linhas.forEach((linha, i) => {
      const texto = semAcento(linha.texto);
      for (const a of extrator(texto)) {
        if (vistos.has(`${i}:${a.indice}:${a.bruto}`)) continue;
        const [x0, x1] = faixaDoTrecho(linha, a.indice, a.indice + a.bruto.length);
        const neg = contextoNegativo(campo, linha, a.indice, i > 0 ? linhas[i - 1] : null, [x0, x1]);
        registrar(linha, a, opcoes.semRotulo * (neg ? 0.15 : 1), neg ? `contexto_negativo:${neg}` : "sem_rotulo");
      }
    });
  }

  const chave = opcoes.chave ?? ((v: T) => String(v));
  const porValor = new Map<string, Candidato<T> & { ocorrencias: number }>();
  for (const b of brutos) {
    const k = chave(b.achado.valor);
    const atual = porValor.get(k);
    if (!atual) {
      porValor.set(k, { valor: b.achado.valor, bruto: b.achado.bruto, pontuacao: b.pontuacao, motivos: [b.motivo], pagina: seg.pagina, caixa: caixaDoValor(b.linha, b.achado.bruto), fonte: seg.fonte, ocorrencias: 1 });
      continue;
    }
    atual.ocorrencias += 1;
    if (!atual.motivos.includes(b.motivo)) atual.motivos.push(b.motivo);
    if (b.pontuacao > atual.pontuacao) { atual.pontuacao = b.pontuacao; atual.caixa = caixaDoValor(b.linha, b.achado.bruto); atual.bruto = b.achado.bruto; }
  }
  return [...porValor.values()]
    .map(({ ocorrencias, ...c }) => ({ ...c, pontuacao: Math.min(1, c.pontuacao + Math.min(0.06, (ocorrencias - 1) * 0.02)) }))
    .sort((a, b) => b.pontuacao - a.pontuacao);
}
