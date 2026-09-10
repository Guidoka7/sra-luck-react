import { type ClassValue, clsx } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatarMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function nomeMes(mes: number): string {
  return MESES_PT[mes - 1] ?? "";
}

export function formatarDataLonga(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia);
  return `${dia} de ${nomeMes(mes)} de ${ano}`;
}

export function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? nomeCompleto;
}

/**
 * Aplica máscara de moeda BRL enquanto a pessoa digita (só dígitos viram
 * centavos, ex: "150000" -> "1.500,00"). Usada em inputs de valor.
 */
export function mascararMoedaInput(valorDigitado: string): string {
  const digitos = valorDigitado.replace(/\D/g, "");
  if (!digitos) return "";
  const numero = Number(digitos) / 100;
  return numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Converte o valor mascarado ("1.500,00") de volta pra número puro (1500). */
export function desmascararMoeda(valorMascarado: string): number {
  const limpo = valorMascarado.replace(/\./g, "").replace(",", ".");
  return Number(limpo) || 0;
}

// ============================================================================
// Regras de liberação da agenda por quantidade de parcelas do contrato.
// Espelha exatamente a função `pode_agendar` em supabase/migration_003_boletos.sql —
// qualquer mudança de regra deve ser feita nos dois lugares.
// ============================================================================
export const REGRAS_LIBERACAO_AGENDA: { parcelas: number; percentual: number }[] = [
  { parcelas: 12, percentual: 60 },
  { parcelas: 18, percentual: 60 },
  { parcelas: 24, percentual: 60 },
  { parcelas: 36, percentual: 70 },
  { parcelas: 48, percentual: 80 },
  { parcelas: 60, percentual: 80 },
  { parcelas: 72, percentual: 80 },
];

/** Percentual mínimo de parcelas pagas para liberar a agenda, dado o total de parcelas do contrato. */
export function percentualNecessario(quantidadeParcelas: number | null | undefined): number {
  const regra = REGRAS_LIBERACAO_AGENDA.find((r) => r.parcelas === quantidadeParcelas);
  return regra?.percentual ?? 60;
}
