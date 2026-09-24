import { percentualDoPlano } from "@/lib/regrasOperacionais";
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
/** Planos e percentual mínimo de parcelas pagas de cada um (valores de regras_operacionais). */
export function regrasLiberacaoAgenda(): { parcelas: number; percentual: number }[] {
  return [12, 18, 24, 36, 48, 60, 72].map((parcelas) => ({ parcelas, percentual: percentualDoPlano(parcelas) }));
}

/** Percentual mínimo de parcelas pagas para liberar a agenda, dado o total de parcelas do contrato. */
export function percentualNecessario(quantidadeParcelas: number | null | undefined): number {
  // Plano fora da tabela: mantém o padrão histórico do app (faixa 12x–24x).
  return [12, 18, 24, 36, 48, 60, 72].includes(Number(quantidadeParcelas)) ? percentualDoPlano(quantidadeParcelas) : percentualDoPlano(12);
}
