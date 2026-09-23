import { codigoBarrasParaLinha, codigoBarrasValido } from "../boleto-febraban";

const DIA_MS = 86_400_000;
const BASE_FATOR_NOVA = Date.UTC(2025, 1, 22) - 1000 * DIA_MS;

/** Monta uma linha digitável válida (DVs calculados) para testes. */
export function linhaDeTeste(vencimentoIso: string, valor: number, livre = "1", banco = "748") {
  const fator = Math.round((Date.parse(`${vencimentoIso}T00:00:00Z`) - BASE_FATOR_NOVA) / DIA_MS);
  const semDv = `${banco}9${String(fator).padStart(4, "0")}${String(Math.round(valor * 100)).padStart(10, "0")}${livre.padStart(25, "0")}`;
  for (let dv = 1; dv <= 9; dv += 1) {
    const barras = semDv.slice(0, 4) + dv + semDv.slice(4);
    if (codigoBarrasValido(barras)) return codigoBarrasParaLinha(barras);
  }
  throw new Error("não foi possível montar o DV");
}

export function formatarLinha(linha: string) {
  return `${linha.slice(0, 5)}.${linha.slice(5, 10)} ${linha.slice(10, 15)}.${linha.slice(15, 21)} ${linha.slice(21, 26)}.${linha.slice(26, 32)} ${linha[32]} ${linha.slice(33)}`;
}

/** Vencimento mensal (dia fixo) a partir de um mês inicial. */
export function vencimentoMensal(inicio: string, indice: number, dia = 10) {
  const [ano, mes] = inicio.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + indice, dia));
  return d.toISOString().slice(0, 10);
}
