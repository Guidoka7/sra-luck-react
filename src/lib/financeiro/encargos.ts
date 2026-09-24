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
import { hojeSaoPaulo, ordinalDataCivil } from "@/lib/dataCivil";

export const JUROS_MORA_DIARIO = 0.002;
export const MULTA_ATRASO = 0.02;

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
