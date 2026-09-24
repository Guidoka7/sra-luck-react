/**
 * Regra de atraso dos boletos Sra. Luck.
 *
 * Instrução bancária canônica:
 * - mora diária de 0,20%;
 * - multa única de 2,00% após o vencimento.
 *
 * O cálculo usa data civil de Brasília/São Paulo para não depender do timezone
 * do navegador ou do runtime serverless.
 */
export const JUROS_MORA_DIARIO = 0.002;
export const MULTA_ATRASO = 0.02;

export function hojeSaoPaulo(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

function ordinalDataCivil(iso: string): number {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("DATA_CIVIL_INVALIDA");
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}

export function calcularEncargosAtraso(valor: number, vencimentoIso: string, hojeIso = hojeSaoPaulo()) {
  const nominal = Number(valor);
  if (!Number.isFinite(nominal) || nominal < 0) throw new Error("VALOR_INVALIDO");
  const diasEmAtraso = Math.max(0, ordinalDataCivil(hojeIso) - ordinalDataCivil(String(vencimentoIso).slice(0, 10)));
  const juros = diasEmAtraso > 0 ? nominal * diasEmAtraso * JUROS_MORA_DIARIO : 0;
  const multa = diasEmAtraso > 0 ? nominal * MULTA_ATRASO : 0;
  return {
    diasEmAtraso,
    juros,
    multa,
    encargos: juros + multa,
    valorAtualizado: nominal + juros + multa,
  };
}
