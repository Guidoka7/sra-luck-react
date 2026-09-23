/**
 * Padrão FEBRABAN de boletos de cobrança (bloqueto): valida a linha digitável
 * (47 dígitos) e o código de barras (44 dígitos) pelos dígitos verificadores e
 * decodifica deles o banco, o valor e o vencimento.
 *
 * É a evidência mais forte que existe numa folha de carnê: os DVs garantem que
 * nenhum dígito foi lido errado (texto do PDF, OCR ou agente de IA), e o valor
 * e o vencimento saem do próprio número, não de um texto solto na página.
 */

export interface BoletoDecodificado {
  linhaDigitavel: string;
  codigoBarras: string;
  banco: string;
  /** Valor em reais; null quando o boleto não traz valor fixo (campo zerado). */
  valor: number | null;
  /** YYYY-MM-DD; null quando o fator de vencimento é zero (sem vencimento). */
  vencimento: string | null;
}

const DIA_MS = 86_400_000;
const BASE_FATOR_ANTIGA = Date.UTC(1997, 9, 7);
/** Fator 1000 voltou a valer em 22/02/2025 (reinício do ciclo). */
const BASE_FATOR_NOVA = Date.UTC(2025, 1, 22) - 1000 * DIA_MS;

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

function mod11Boleto(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

function isoUtc(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * O fator de vencimento reiniciou em 1000 em 22/02/2025. O mesmo fator aponta
 * para duas datas (ciclo antigo e novo); escolhe a mais próxima da referência.
 */
export function vencimentoDoFator(fator: number, referenciaIso?: string | null): string | null {
  if (!Number.isFinite(fator) || fator <= 0) return null;
  const antiga = BASE_FATOR_ANTIGA + fator * DIA_MS;
  const nova = BASE_FATOR_NOVA + fator * DIA_MS;
  const ref = referenciaIso && /^\d{4}-\d{2}-\d{2}$/.test(referenciaIso) ? Date.parse(`${referenciaIso}T00:00:00Z`) : Date.now();
  return isoUtc(Math.abs(nova - ref) <= Math.abs(antiga - ref) ? nova : antiga);
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
  return mod11Boleto(barras.slice(0, 4) + barras.slice(5)) === Number(barras[4]);
}

export function linhaDigitavelValida(linha: string): boolean {
  if (!/^\d{47}$/.test(linha)) return false;
  if (mod10(linha.slice(0, 9)) !== Number(linha[9])) return false;
  if (mod10(linha.slice(10, 20)) !== Number(linha[20])) return false;
  if (mod10(linha.slice(21, 31)) !== Number(linha[31])) return false;
  return codigoBarrasValido(linhaParaCodigoBarras(linha));
}

function decodificarBarras(barras: string, referenciaIso?: string | null): BoletoDecodificado {
  const valorCentavos = Number(barras.slice(9, 19));
  return {
    linhaDigitavel: codigoBarrasParaLinha(barras),
    codigoBarras: barras,
    banco: barras.slice(0, 3),
    valor: valorCentavos > 0 ? valorCentavos / 100 : null,
    vencimento: vencimentoDoFator(Number(barras.slice(5, 9)), referenciaIso),
  };
}

/** Aceita linha digitável ou código de barras (com ou sem pontuação). */
export function decodificarBoleto(entrada: string | null | undefined, referenciaIso?: string | null): BoletoDecodificado | null {
  const digitos = String(entrada ?? "").replace(/\D/g, "");
  if (digitos.length === 47 && linhaDigitavelValida(digitos)) return decodificarBarras(linhaParaCodigoBarras(digitos), referenciaIso);
  if (digitos.length === 44 && codigoBarrasValido(digitos)) return decodificarBarras(digitos, referenciaIso);
  return null;
}

/**
 * Procura, num texto qualquer (página de PDF), todas as linhas digitáveis e
 * códigos de barras VÁLIDOS. Sequências numéricas com espaços/pontos são
 * juntadas e varridas por janela, então funciona com os agrupamentos usuais
 * (00190.00009 01234.567890 ...) e com a linha quebrada em vários trechos.
 * Retorna um item por boleto distinto (as vias repetidas na mesma folha — recibo
 * do pagador e ficha de compensação — contam uma vez só).
 */
export function encontrarBoletosNoTexto(texto: string, referenciaIso?: string | null): BoletoDecodificado[] {
  const achados = new Map<string, BoletoDecodificado>();
  const blocos = String(texto ?? "").match(/\d[\d.\s-]{30,}\d/g) ?? [];
  for (const bloco of blocos) {
    const digitos = bloco.replace(/\D/g, "");
    // Linha digitável: 3 DVs módulo 10 + DV geral módulo 11 tornam um falso
    // positivo por janela praticamente impossível (~1 em 11 mil).
    for (let i = 0; i + 47 <= digitos.length; i += 1) {
      const trecho = digitos.slice(i, i + 47);
      if (trecho[3] !== "9") continue;
      const boleto = decodificarBoleto(trecho, referenciaIso);
      if (boleto && !achados.has(boleto.codigoBarras)) achados.set(boleto.codigoBarras, boleto);
    }
    // Código de barras (só um DV): aceito apenas quando o bloco inteiro tem
    // exatamente 44 dígitos, para não "achar" boleto dentro de outro número.
    if (digitos.length === 44 && digitos[3] === "9") {
      const boleto = decodificarBoleto(digitos, referenciaIso);
      if (boleto && !achados.has(boleto.codigoBarras)) achados.set(boleto.codigoBarras, boleto);
    }
  }
  return [...achados.values()];
}
