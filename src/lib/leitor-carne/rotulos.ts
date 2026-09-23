/**
 * Rótulos equivalentes por campo (já normalizados: sem acento, minúsculos).
 * `peso` mede o quanto o rótulo identifica o campo (1 = inequívoco).
 * `negativos` são contextos que DESQUALIFICAM um valor para aquele campo
 * (ex.: uma data ao lado de "data de emissão" não é vencimento).
 */
export interface Rotulo {
  alias: string;
  peso: number;
}

export type CampoRotulado = "vencimento" | "valor" | "parcela" | "cpf" | "nome" | "contrato" | "venda" | "carne" | "nossoNumero" | "numeroDocumento" | "beneficiario";

export const ROTULOS: Record<CampoRotulado, Rotulo[]> = {
  vencimento: [
    { alias: "data de vencimento", peso: 1 },
    { alias: "data do vencimento", peso: 1 },
    { alias: "vencimento", peso: 1 },
    { alias: "vencto", peso: 0.95 },
    { alias: "dt venc", peso: 0.95 },
    { alias: "dt. venc", peso: 0.95 },
    { alias: "data venc", peso: 0.95 },
    { alias: "venc", peso: 0.85 },
  ],
  valor: [
    { alias: "valor do documento", peso: 1 },
    { alias: "valor documento", peso: 1 },
    { alias: "valor nominal", peso: 1 },
    { alias: "valor da parcela", peso: 1 },
    { alias: "valor da prestacao", peso: 1 },
    { alias: "valor a pagar", peso: 0.95 },
    { alias: "valor do boleto", peso: 0.95 },
    { alias: "vlr documento", peso: 0.95 },
    { alias: "valor", peso: 0.7 },
  ],
  parcela: [
    { alias: "parcela", peso: 1 },
    { alias: "prestacao", peso: 1 },
    { alias: "parc", peso: 0.9 },
    { alias: "plano", peso: 0.7 },
  ],
  cpf: [
    { alias: "cpf/cnpj", peso: 1 },
    { alias: "cpf", peso: 1 },
    { alias: "cpf do pagador", peso: 1 },
  ],
  nome: [
    { alias: "nome do pagador", peso: 1 },
    { alias: "pagador", peso: 0.95 },
    { alias: "sacado", peso: 0.95 },
    { alias: "cliente", peso: 0.7 },
  ],
  contrato: [
    { alias: "numero do contrato", peso: 1 },
    { alias: "n do contrato", peso: 1 },
    { alias: "contrato", peso: 0.95 },
  ],
  venda: [
    { alias: "numero da venda", peso: 1 },
    { alias: "venda", peso: 0.9 },
  ],
  carne: [
    { alias: "numero do carne", peso: 1 },
    { alias: "carne", peso: 0.8 },
  ],
  nossoNumero: [
    { alias: "nosso numero", peso: 1 },
    { alias: "nosso n", peso: 0.95 },
  ],
  numeroDocumento: [
    { alias: "numero do documento", peso: 1 },
    { alias: "n do documento", peso: 1 },
    { alias: "no documento", peso: 0.95 },
    { alias: "num doc", peso: 0.95 },
    { alias: "n documento", peso: 0.95 },
  ],
  beneficiario: [
    { alias: "beneficiario", peso: 1 },
    { alias: "cedente", peso: 0.95 },
  ],
};

/** Contextos que desqualificam um valor para o campo. */
export const NEGATIVOS: Partial<Record<CampoRotulado, string[]>> = {
  vencimento: ["data de emissao", "emissao", "data do documento", "data documento", "data de processamento", "processamento", "data da operacao", "data do pagamento", "data de pagamento", "pagamento em", "data de nascimento", "nascimento", "data da venda"],
  valor: ["desconto", "abatimento", "juros", "multa", "mora", "outros acrescimos", "outras deducoes", "acrescimos", "deducoes", "encargos", "valor pago", "total pago", "valor cobrado", "tarifa", "taxa"],
  parcela: ["vencimento", "emissao", "data"],
};

/** Texto normalizado para comparar com os aliases (sem acento, minúsculo, pontuação vira espaço, exceto "/"). */
export function chaveRotulo(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[º°ª]/g, "").replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Ocorrências de um alias como palavra inteira. */
export function contemAlias(chave: string, alias: string): number {
  const re = new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}([^a-z0-9]|$)`);
  const m = chave.match(re);
  return m ? (m.index ?? 0) + m[1].length : -1;
}
