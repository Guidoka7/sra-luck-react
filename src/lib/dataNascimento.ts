/**
 * Regras de digitação da data de nascimento em três campos (dia, mês, ano).
 * O resultado final continua no formato "DD/MM/AAAA" validado no login.
 */

export type PartesData = { dia: string; mes: string; ano: string };
export type ParteData = keyof PartesData;

const MAXIMO: Record<ParteData, number> = { dia: 2, mes: 2, ano: 4 };

/**
 * Limpa o que foi digitado em uma parte e diz se ela já está completa.
 * Dia começando com 4–9 e mês começando com 2–9 só podem ter um dígito,
 * então viram "04"/"02" na hora e o cursor já pode avançar.
 */
export function normalizarParte(parte: ParteData, bruto: string): { valor: string; completo: boolean } {
  const digitos = bruto.replace(/\D/g, "").slice(0, MAXIMO[parte]);
  if (parte === "dia" && digitos.length === 1 && Number(digitos) > 3) return { valor: `0${digitos}`, completo: true };
  if (parte === "mes" && digitos.length === 1 && Number(digitos) > 1) return { valor: `0${digitos}`, completo: true };
  return { valor: digitos, completo: digitos.length === MAXIMO[parte] };
}

/** Completa "5" → "05" ao sair do campo de dia/mês. */
export function completarComZero(parte: ParteData, valor: string) {
  return parte !== "ano" && valor.length === 1 && valor !== "0" ? `0${valor}` : valor;
}

/**
 * Reconhece uma data inteira colada ou preenchida automaticamente:
 * "12/03/1990", "12-03-1990", "12.03.1990", "12031990" ou "1990-03-12".
 */
export function distribuirData(texto: string): PartesData | null {
  const limpo = texto.trim();
  const iso = limpo.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { dia: iso[3].padStart(2, "0"), mes: iso[2].padStart(2, "0"), ano: iso[1] };
  const separado = limpo.match(/^(\d{1,2})\D+(\d{1,2})\D+(\d{4})$/);
  if (separado) return { dia: separado[1].padStart(2, "0"), mes: separado[2].padStart(2, "0"), ano: separado[3] };
  const digitos = limpo.replace(/\D/g, "");
  if (digitos.length === 8) return { dia: digitos.slice(0, 2), mes: digitos.slice(2, 4), ano: digitos.slice(4) };
  return null;
}

export function juntarData({ dia, mes, ano }: PartesData) {
  return `${dia}/${mes}/${ano}`;
}
