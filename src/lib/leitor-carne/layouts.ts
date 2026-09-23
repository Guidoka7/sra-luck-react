import { chaveRotulo } from "./rotulos";
import { encontrarBoletos } from "./febraban";
import type { PaginaTexto } from "./tipos";

/**
 * Parsers por layout. Fluxo: documento → detector → parser especializado
 * (quando reconhecido) → parser genérico como fallback.
 *
 * Hoje só o genérico existe; um parser de banco entra aqui registrando
 * `detectar` (0..1) e, se precisar, ajustes próprios (pesos de rótulos,
 * regiões). Coordenadas podem AJUDAR um parser específico, mas nunca são a
 * única estratégia.
 */
export interface ParserLayout {
  id: string;
  nome: string;
  /** Aptidão do parser para o documento (0..1). */
  detectar(paginas: PaginaTexto[], banco: string | null): number;
}

export const PARSER_GENERICO: ParserLayout = { id: "generico", nome: "Carnê genérico (FEBRABAN)", detectar: () => 0.1 };

const REGISTRO: ParserLayout[] = [PARSER_GENERICO];

export function registrarParser(parser: ParserLayout) {
  if (!REGISTRO.some((p) => p.id === parser.id)) REGISTRO.unshift(parser);
}

export function escolherParser(paginas: PaginaTexto[], banco: string | null): ParserLayout {
  return [...REGISTRO].sort((a, b) => b.detectar(paginas, banco) - a.detectar(paginas, banco))[0] ?? PARSER_GENERICO;
}

const PALAVRAS_MODELO = ["recibo do pagador", "ficha de compensacao", "beneficiario", "cedente", "pagador", "sacado", "nosso numero", "numero do documento", "vencimento", "valor do documento", "parcela", "carne", "contrato", "venda", "autenticacao mecanica", "local de pagamento"];

/**
 * Impressão digital do modelo: banco + palavras recorrentes do layout + faixa
 * vertical em que elas aparecem na 1ª página. Carnês do mesmo modelo geram o
 * mesmo fingerprint, sem depender de coordenadas exatas.
 */
export function fingerprintLayout(paginas: PaginaTexto[]): { fingerprint: string; banco: string | null } {
  const primeira = paginas.find((p) => p.linhas.length) ?? paginas[0];
  let banco: string | null = null;
  for (const l of primeira?.linhas ?? []) {
    const b = encontrarBoletos(l.texto).validos[0];
    if (b) { banco = b.banco; break; }
  }
  const marcas: string[] = [];
  for (const l of primeira?.linhas ?? []) {
    const chave = chaveRotulo(l.texto);
    for (const palavra of PALAVRAS_MODELO) {
      if (chave.includes(palavra)) marcas.push(`${palavra}@${Math.floor(((l.caixa.y0 + l.caixa.y1) / 2) * 4)}`);
    }
  }
  const base = `${banco ?? "000"}|${[...new Set(marcas)].sort().join(",")}`;
  let h = 2166136261;
  for (let i = 0; i < base.length; i += 1) { h ^= base.charCodeAt(i); h = Math.imul(h, 16777619); }
  return { fingerprint: `fp-${(h >>> 0).toString(16).padStart(8, "0")}`, banco };
}
