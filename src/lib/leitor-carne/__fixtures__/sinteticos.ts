/**
 * Documentos SINTÉTICOS para testes — nenhum dado real (CPF gerado com DV
 * válido para teste, nomes fictícios, linhas digitáveis montadas aqui).
 */
import { codigoBarrasParaLinha, codigoBarrasValido } from "../febraban";
import type { LinhaTexto, PaginaTexto, PalavraTexto } from "../tipos";

export const CPF_FICTICIO = "52998224725"; // CPF de teste com DV válido (não pertence a cliente)
export const CPF_FICTICIO_2 = "11144477735";
export const NOME_FICTICIO = "ANA EXEMPLO DA SILVA";

const DIA_MS = 86_400_000;
const BASE_NOVA = Date.UTC(2025, 1, 22) - 1000 * DIA_MS;

export function linhaDigitavelSintetica(vencimentoIso: string, centavos: number, livre: string, banco = "070") {
  const fator = Math.round((Date.parse(`${vencimentoIso}T00:00:00Z`) - BASE_NOVA) / DIA_MS);
  const semDv = `${banco}9${String(fator).padStart(4, "0")}${String(centavos).padStart(10, "0")}${livre.padStart(25, "0")}`;
  for (let dv = 1; dv <= 9; dv += 1) {
    const barras = semDv.slice(0, 4) + dv + semDv.slice(4);
    if (codigoBarrasValido(barras)) return codigoBarrasParaLinha(barras);
  }
  throw new Error("DV");
}

export function formatarLinha(l: string) {
  return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
}

export function dataBr(iso: string) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export function valorBr(centavos: number) {
  const reais = Math.floor(centavos / 100).toLocaleString("pt-BR");
  return `R$ ${reais},${String(centavos % 100).padStart(2, "0")}`;
}

export function mensal(inicio: string, indice: number) {
  const [a, m, d] = inicio.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + indice, d)).toISOString().slice(0, 10);
}

const LARGURA_CHAR = 0.0105;

/** Linha com palavras posicionadas: segmentos [texto, x0]. */
export function linha(y: number, segmentos: [string, number][], confianca = 1): LinhaTexto {
  const palavras: PalavraTexto[] = [];
  for (const [texto, x0] of segmentos) {
    let x = x0;
    for (const p of texto.split(" ").filter(Boolean)) {
      palavras.push({ texto: p, caixa: { x0: x, y0: y, x1: x + p.length * LARGURA_CHAR, y1: y + 0.018 }, confianca });
      x += (p.length + 1) * LARGURA_CHAR;
    }
  }
  const x0 = Math.min(...palavras.map((p) => p.caixa.x0));
  const x1 = Math.max(...palavras.map((p) => p.caixa.x1));
  return { texto: segmentos.map(([t]) => t).join("   "), caixa: { x0, y0: y, x1, y1: y + 0.018 }, confianca, palavras };
}

export interface OpcoesParcela {
  numero: number;
  total: number;
  vencimento: string | null;
  centavos: number;
  cpf?: string;
  nome?: string;
  venda?: string;
  emissao?: string;
  outraCobranca?: number;
  semLinhaDigitavel?: boolean;
  linhaCorrompida?: (linha: string) => string;
  vencimentoIlegivel?: boolean;
  valorImpresso?: number;
  confianca?: number;
  livre?: string;
}

/** Linhas de UM boleto a partir de y0 (altura ~0,3). */
export function linhasBoleto(o: OpcoesParcela, y0 = 0.05): LinhaTexto[] {
  const c = o.confianca ?? 1;
  const vencimento = o.vencimento ?? "2026-01-01";
  const ld = linhaDigitavelSintetica(vencimento, o.centavos, o.livre ?? `${o.numero}${o.total}`);
  const linhaTexto = o.linhaCorrompida ? o.linhaCorrompida(formatarLinha(ld)) : formatarLinha(ld);
  const linhas: LinhaTexto[] = [
    linha(y0, [["Beneficiário: SRA LUCK INTERMEDIACAO LTDA", 0.05]], c),
    linha(y0 + 0.03, [[`Pagador: ${o.nome ?? NOME_FICTICIO}`, 0.05], [`CPF: ${(o.cpf ?? CPF_FICTICIO).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}`, 0.6]], c),
    linha(y0 + 0.06, [[`Parcela ${String(o.numero).padStart(2, "0")}/${o.total}`, 0.05], [`Venda ${o.venda ?? "31416"}`, 0.4]], c),
  ];
  if (o.emissao) linhas.push(linha(y0 + 0.09, [["Data de emissão", 0.05], [dataBr(o.emissao), 0.3]], c));
  linhas.push(linha(y0 + 0.12, [["Vencimento", 0.05], ["Valor do documento", 0.4], ["Nosso número", 0.7]], c));
  const vencTexto = o.vencimentoIlegivel ? "1?/0?/2??6" : dataBr(vencimento);
  linhas.push(linha(y0 + 0.145, [[vencTexto, 0.05], [valorBr(o.valorImpresso ?? o.centavos), 0.4], [`${o.numero}000${o.total}`, 0.7]], c));
  if (o.outraCobranca != null) linhas.push(linha(y0 + 0.18, [["(-) Desconto", 0.05], [valorBr(o.outraCobranca), 0.4]], c));
  if (!o.semLinhaDigitavel) linhas.push(linha(y0 + 0.21, [[linhaTexto, 0.05]], c));
  return linhas;
}

export function pagina(n: number, linhas: LinhaTexto[], fonte: "PDF_TEXT" | "OCR" = "PDF_TEXT"): PaginaTexto {
  const conf = linhas.length ? linhas.reduce((s, l) => s + l.confianca, 0) / linhas.length : 0;
  return { pagina: n, fonte, linhas, confiancaOcr: fonte === "OCR" ? conf : null };
}

/** Carnê de N parcelas, uma por página. */
export function carne(total: number, opcoes: Partial<OpcoesParcela> & { inicio?: string; numeros?: number[]; fonte?: "PDF_TEXT" | "OCR" } = {}): PaginaTexto[] {
  const numeros = opcoes.numeros ?? Array.from({ length: total }, (_, i) => i + 1);
  return numeros.map((numero, i) => pagina(i + 1, linhasBoleto({ centavos: 42778, ...opcoes, numero, total, vencimento: mensal(opcoes.inicio ?? "2026-02-16", numero - 1) }), opcoes.fonte ?? "PDF_TEXT"));
}
