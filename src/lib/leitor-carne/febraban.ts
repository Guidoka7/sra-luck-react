/**
 * Boleto de cobrança (padrão FEBRABAN): linha digitável (47 dígitos) e código
 * de barras (44). Os dígitos verificadores garantem que nenhum dígito foi lido
 * errado; valor e vencimento decodificados do número são a evidência mais forte
 * de uma parcela.
 */

export interface BoletoDecodificado {
  linhaDigitavel: string;
  codigoBarras: string;
  banco: string;
  /** Centavos; null quando o boleto não traz valor fixo. */
  valorCentavos: number | null;
  /** YYYY-MM-DD; null quando o fator é zero. */
  vencimento: string | null;
}

const DIA_MS = 86_400_000;
const BASE_FATOR_ANTIGA = Date.UTC(1997, 9, 7);
/** O fator voltou a 1000 em 22/02/2025. */
const BASE_FATOR_NOVA = Date.UTC(2025, 1, 22) - 1000 * DIA_MS;

export const BANCOS: Record<string, string> = {
  "001": "Banco do Brasil",
  "033": "Santander",
  "070": "BRB",
  "104": "Caixa",
  "237": "Bradesco",
  "341": "Itaú",
  "364": "Efí",
  "748": "Sicredi",
  "756": "Sicoob",
};

function mod10(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    let produto = Number(numero[i]) * peso;
    if (produto > 9) produto = Math.floor(produto / 10) + (produto % 10);
    soma += produto;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

function mod11(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

export function vencimentoDoFator(fator: number, referenciaIso?: string | null): string | null {
  if (!Number.isFinite(fator) || fator <= 0) return null;
  const antiga = BASE_FATOR_ANTIGA + fator * DIA_MS;
  const nova = BASE_FATOR_NOVA + fator * DIA_MS;
  const ref = referenciaIso && /^\d{4}-\d{2}-\d{2}$/.test(referenciaIso) ? Date.parse(`${referenciaIso}T00:00:00Z`) : Date.now();
  return new Date(Math.abs(nova - ref) <= Math.abs(antiga - ref) ? nova : antiga).toISOString().slice(0, 10);
}

export function linhaParaCodigoBarras(linha: string): string {
  return linha.slice(0, 4) + linha[32] + linha.slice(33, 47) + linha.slice(4, 9) + linha.slice(10, 20) + linha.slice(21, 31);
}

export function codigoBarrasParaLinha(barras: string): string {
  const livre = barras.slice(19);
  const c1 = barras.slice(0, 4) + livre.slice(0, 5);
  const c2 = livre.slice(5, 15);
  const c3 = livre.slice(15, 25);
  return `${c1}${mod10(c1)}${c2}${mod10(c2)}${c3}${mod10(c3)}${barras[4]}${barras.slice(5, 19)}`;
}

export function codigoBarrasValido(barras: string): boolean {
  if (!/^\d{44}$/.test(barras) || barras[0] === "8") return false;
  return mod11(barras.slice(0, 4) + barras.slice(5)) === Number(barras[4]);
}

export function linhaDigitavelValida(linha: string): boolean {
  if (!/^\d{47}$/.test(linha)) return false;
  if (mod10(linha.slice(0, 9)) !== Number(linha[9])) return false;
  if (mod10(linha.slice(10, 20)) !== Number(linha[20])) return false;
  if (mod10(linha.slice(21, 31)) !== Number(linha[31])) return false;
  return codigoBarrasValido(linhaParaCodigoBarras(linha));
}

function decodificarBarras(barras: string, referenciaIso?: string | null): BoletoDecodificado {
  const centavos = Number(barras.slice(9, 19));
  return {
    linhaDigitavel: codigoBarrasParaLinha(barras),
    codigoBarras: barras,
    banco: barras.slice(0, 3),
    valorCentavos: centavos > 0 ? centavos : null,
    vencimento: vencimentoDoFator(Number(barras.slice(5, 9)), referenciaIso),
  };
}

/** Linha digitável ou código de barras, com ou sem pontuação. */
export function decodificarBoleto(entrada: string | null | undefined, referenciaIso?: string | null): BoletoDecodificado | null {
  const d = String(entrada ?? "").replace(/\D/g, "");
  if (d.length === 47 && linhaDigitavelValida(d)) return decodificarBarras(linhaParaCodigoBarras(d), referenciaIso);
  if (d.length === 44 && codigoBarrasValido(d)) return decodificarBarras(d, referenciaIso);
  return null;
}

/** Trecho com cara de linha digitável: 47 caracteres entre dígitos e letras que o OCR confunde. */
export interface TrechoLinha {
  bruto: string;
  /** Somente dígitos (sem as letras). */
  digitos: string;
  indice: number;
  temConfusaoOcr: boolean;
}

/** Letras que o OCR costuma trocar por dígitos. */
export const CONFUSOES_OCR: Record<string, string> = { O: "0", o: "0", Q: "0", D: "0", I: "1", l: "1", i: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2", z: "2", G: "6", b: "6", T: "7" };

/**
 * Procura boletos válidos num texto. Blocos com dígitos (e as letras típicas
 * de confusão de OCR) separados por espaço/ponto são juntados e varridos em
 * janelas de 47 posições. Boletos com DV válido vão em `validos`; janelas que
 * só fecham o DV trocando letras por dígitos vão em `sugestoes` (NUNCA
 * aplicadas automaticamente).
 */
export function encontrarBoletos(texto: string, referenciaIso?: string | null): {
  validos: BoletoDecodificado[];
  sugestoes: { original: string; sugerida: BoletoDecodificado; trocas: string[] }[];
  quaseLinhas: string[];
} {
  const validos = new Map<string, BoletoDecodificado>();
  const sugestoes = new Map<string, { original: string; sugerida: BoletoDecodificado; trocas: string[] }>();
  const quase: string[] = [];
  const letras = Object.keys(CONFUSOES_OCR).map((c) => c.replace(/[|]/g, "\\|")).join("");
  const reBloco = new RegExp(`[0-9${letras}][0-9${letras}.\\s-]{30,}[0-9${letras}]`, "g");
  for (const m of String(texto ?? "").matchAll(reBloco)) {
    const compacto = m[0].replace(/[.\s-]/g, "");
    if ((compacto.match(/\d/g) ?? []).length < 36) continue;
    let achouNoBloco = false;
    for (let i = 0; i + 47 <= compacto.length; i += 1) {
      const janela = compacto.slice(i, i + 47);
      if (/^\d{47}$/.test(janela)) {
        if (janela[3] !== "9") continue;
        const b = decodificarBoleto(janela, referenciaIso);
        if (b) { validos.set(b.codigoBarras, b); achouNoBloco = true; }
        continue;
      }
      const trocas: string[] = [];
      const corrigida = [...janela].map((c, pos) => {
        if (/\d/.test(c)) return c;
        const d = CONFUSOES_OCR[c];
        if (d) trocas.push(`posição ${pos + 1}: "${c}" → "${d}"`);
        return d ?? "?";
      }).join("");
      if (!/^\d{47}$/.test(corrigida) || corrigida[3] !== "9") continue;
      const b = decodificarBoleto(corrigida, referenciaIso);
      if (b && !validos.has(b.codigoBarras)) { sugestoes.set(b.codigoBarras, { original: janela, sugerida: b, trocas }); achouNoBloco = true; }
    }
    if (!achouNoBloco && compacto.length >= 44 && compacto.length <= 50) quase.push(compacto);
  }
  // Código de barras impresso (44 dígitos exatos, um único bloco).
  for (const m of String(texto ?? "").matchAll(/(?<!\d)(\d{44})(?!\d)/g)) {
    const b = decodificarBoleto(m[1], referenciaIso);
    if (b && !validos.has(b.codigoBarras)) validos.set(b.codigoBarras, b);
  }
  for (const k of validos.keys()) sugestoes.delete(k);
  return { validos: [...validos.values()], sugestoes: [...sugestoes.values()], quaseLinhas: quase };
}
