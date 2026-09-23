/**
 * Normalização dos dados lidos. Nada aqui "completa" informação: entrada
 * ambígua ou inválida retorna null.
 */

/** Apenas dígitos. */
export function somenteDigitos(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\D/g, "");
}

// ── CPF ─────────────────────────────────────────────────────────────────────
export function normalizarCpf(valor: string | null | undefined): string | null {
  const d = somenteDigitos(valor);
  return d.length === 11 ? d : null;
}

export function cpfValido(valor: string | null | undefined): boolean {
  const cpf = normalizarCpf(valor);
  if (!cpf || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i += 1) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(cpf.slice(0, 9), 10) === Number(cpf[9]) && dv(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

/** CPF para exibição com máscara parcial (nunca em logs). */
export function mascararCpf(cpf: string | null | undefined): string {
  const d = normalizarCpf(cpf);
  return d ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : "";
}

// ── Dinheiro (centavos inteiros) ────────────────────────────────────────────
/**
 * Converte "R$ 427,78", "427,78", "427.78", "R$427,78", "1.234,56" em
 * centavos inteiros. Exige exatamente 2 casas decimais (formato de boleto);
 * "1.234" sem centavos é ambíguo e retorna null.
 */
export function parseCentavos(entrada: string | null | undefined): number | null {
  const texto = String(entrada ?? "").replace(/R\$\s*/i, "").replace(/\s/g, "");
  let m = texto.match(/^(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})$/);
  if (m) return Number(m[1].replace(/\./g, "")) * 100 + Number(m[2]);
  m = texto.match(/^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/);
  if (m) return Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
  return null;
}

export function formatarCentavos(centavos: number | null | undefined): string {
  if (centavos == null || !Number.isFinite(centavos)) return "—";
  const reais = Math.floor(Math.abs(centavos) / 100);
  const cent = String(Math.abs(centavos) % 100).padStart(2, "0");
  return `${centavos < 0 ? "-" : ""}R$ ${reais.toLocaleString("pt-BR")},${cent}`;
}

/** Procura valores monetários num texto (com ou sem R$). */
export function encontrarValores(texto: string): { centavos: number; bruto: string; indice: number }[] {
  const achados: { centavos: number; bruto: string; indice: number }[] = [];
  const re = /(?:R\$\s*)?(?<![\d.,])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?![\d,])/g;
  for (const m of texto.matchAll(re)) {
    const centavos = parseCentavos(m[1]);
    if (centavos != null) achados.push({ centavos, bruto: m[0].trim(), indice: m.index ?? 0 });
  }
  return achados;
}

// ── Datas ───────────────────────────────────────────────────────────────────
function dataReal(ano: number, mes: number, dia: number): boolean {
  if (ano < 1990 || ano > 2100 || mes < 1 || mes > 12 || dia < 1) return false;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** "15/08/2026", "15-08-2026", "15.08.2026", "15/08/26" → "2026-08-15" (ou null). */
export function parseData(entrada: string | null | undefined): string | null {
  const m = String(entrada ?? "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (!dataReal(ano, mes, dia)) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function encontrarDatas(texto: string): { iso: string; bruto: string; indice: number }[] {
  const achados: { iso: string; bruto: string; indice: number }[] = [];
  for (const m of texto.matchAll(/(?<!\d)(\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2}))(?!\d)/g)) {
    const iso = parseData(m[1]);
    if (iso) achados.push({ iso, bruto: m[1], indice: m.index ?? 0 });
  }
  return achados;
}

export function formatarData(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/** Diferença em meses entre duas datas ISO (ignora o dia). */
export function mesesEntre(de: string, ate: string): number {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = ate.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

// ── Número da parcela ───────────────────────────────────────────────────────
export interface NumeroParcela {
  numero: number;
  total: number | null;
  bruto: string;
  indice: number;
}

const MAX_PARCELAS = 480;

/**
 * Reconhece "1/12", "01/12", "1 de 12", "Parcela 1/12", "Parcela: 01",
 * "01-12", "18/36 - Venda 31416". Datas (15/08/2026) nunca são confundidas:
 * o trecho não pode estar colado a outra barra/número.
 */
export function encontrarNumerosParcela(texto: string): NumeroParcela[] {
  const achados: NumeroParcela[] = [];
  const re = /(?<![\d/.-])(\d{1,3})\s*(?:\/|\bde\b|-)\s*(\d{1,3})(?![\d/.-]|\s*[/.-]\s*\d)/gi;
  for (const m of texto.matchAll(re)) {
    const numero = Number(m[1]);
    const total = Number(m[2]);
    if (numero >= 1 && total >= 1 && numero <= total && total <= MAX_PARCELAS) {
      achados.push({ numero, total, bruto: m[0], indice: m.index ?? 0 });
    }
  }
  return achados;
}

/** "Parcela: 01" (sem total). */
export function encontrarNumeroIsolado(texto: string): { numero: number; bruto: string; indice: number } | null {
  const m = texto.match(/(?:parcela|presta[cç][aã]o|parc\.?)\s*(?:n[ºo°.]?\s*)?[:\-]?\s*(\d{1,3})(?![\d/.-])/i);
  if (!m) return null;
  const numero = Number(m[1]);
  return numero >= 1 && numero <= MAX_PARCELAS ? { numero, bruto: m[0], indice: m.index ?? 0 } : null;
}

// ── Nomes ───────────────────────────────────────────────────────────────────
export function normalizarTexto(valor: string | null | undefined): string {
  return String(valor ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PARTICULAS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let anterior = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = temp;
    }
  }
  return dp[b.length];
}

function similaridadePalavra(a: string, b: string): number {
  if (a === b) return 1;
  const maior = Math.max(a.length, b.length);
  return maior === 0 ? 0 : 1 - levenshtein(a, b) / maior;
}

/**
 * Similaridade entre dois nomes (0..1), por palavras significativas. Cada
 * palavra do nome mais curto precisa ter par parecido no outro; compartilhar
 * só o primeiro nome ("ANA") não basta.
 */
export function similaridadeNomes(a: string | null | undefined, b: string | null | undefined): number {
  const pa = normalizarTexto(a).split(" ").filter((p) => p && !PARTICULAS.has(p));
  const pb = normalizarTexto(b).split(" ").filter((p) => p && !PARTICULAS.has(p));
  if (!pa.length || !pb.length) return 0;
  const [curto, longo] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  const usados = new Set<number>();
  let soma = 0;
  for (const palavra of curto) {
    let melhor = 0;
    let indice = -1;
    longo.forEach((outra, i) => {
      if (usados.has(i)) return;
      const s = similaridadePalavra(palavra, outra);
      if (s > melhor) { melhor = s; indice = i; }
    });
    if (indice >= 0) usados.add(indice);
    soma += melhor;
  }
  const cobertura = curto.length / longo.length;
  return (soma / curto.length) * (0.7 + 0.3 * cobertura);
}
