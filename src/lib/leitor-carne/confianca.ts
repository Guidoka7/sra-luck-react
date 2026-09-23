import type { Alerta, CampoExtraido, Candidato, FonteCampo, NivelConfianca } from "./tipos";

/**
 * Motor de confiança.
 *
 * 1) Confiança do CAMPO = pontuação do melhor candidato (rótulo × proximidade ×
 *    confiança da linha × contexto; ver candidatos.ts), ajustada por:
 *    - conflito: outro candidato com valor diferente a menos de 0,15 → ×0,85
 *      e alerta MULTIPLE_FIELD_CANDIDATES;
 *    - validação cruzada: linha digitável com DV válido que CONFIRMA o valor →
 *      mínimo 0,99; que CONTRADIZ o texto impresso → ×0,7 (o valor da linha
 *      prevalece por ter DV, mas vai para conferência);
 *    - coerência do documento (sequência de datas/valores das demais
 *      parcelas): anomalia → ×0,85.
 * 2) Confiança da PARCELA = o elo mais fraco entre número, vencimento e valor.
 * 3) Confiança do DOCUMENTO = média das parcelas × (1 − 0,03 por alerta de
 *    parcela ausente/duplicada/total conflitante), limitada a 0..1; páginas
 *    ilegíveis reduzem proporcionalmente.
 *
 * Faixas: ≥ 0,95 ALTA · ≥ 0,80 MÉDIA · < 0,80 BAIXA. Nenhuma faixa importa
 * sozinha: a equipe sempre confirma antes de gravar.
 */

export const LIMITE_ALTA = 0.95;
export const LIMITE_MEDIA = 0.8;
const MARGEM_CONFLITO = 0.15;

export function nivelDaConfianca(confianca: number): NivelConfianca {
  if (confianca >= LIMITE_ALTA) return "ALTA";
  if (confianca >= LIMITE_MEDIA) return "MEDIA";
  return "BAIXA";
}

export function arredondar(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
}

export function campoVazio<T>(fonte: FonteCampo = "PDF_TEXT"): CampoExtraido<T> {
  return { valor: null, confianca: 0, nivel: "BAIXA", fonte, candidatos: [] };
}

/** Monta o campo a partir dos candidatos (maior pontuação vence; conflito reduz). */
export function campoDeCandidatos<T>(candidatos: Candidato<T>[], opcoes: { minimo?: number; iguais?: (a: T, b: T) => boolean } = {}): { campo: CampoExtraido<T>; conflito: boolean } {
  const minimo = opcoes.minimo ?? 0.2;
  const iguais = opcoes.iguais ?? ((a: T, b: T) => a === b);
  const validos = candidatos.filter((c) => c.pontuacao >= minimo);
  if (!validos.length) return { campo: { ...campoVazio<T>(candidatos[0]?.fonte === "OCR" ? "OCR" : "PDF_TEXT"), candidatos }, conflito: false };
  const [melhor, ...resto] = validos;
  const rival = resto.find((c) => !iguais(c.valor, melhor.valor) && melhor.pontuacao - c.pontuacao < MARGEM_CONFLITO);
  const fatores = [`pontuacao_candidato=${melhor.pontuacao.toFixed(3)}`, ...melhor.motivos];
  let confianca = melhor.pontuacao;
  if (rival) { confianca *= 0.85; fatores.push(`conflito_com=${rival.bruto}`); }
  return {
    campo: {
      valor: melhor.valor,
      confianca: arredondar(confianca),
      nivel: nivelDaConfianca(confianca),
      fonte: melhor.fonte,
      pagina: melhor.pagina,
      caixa: melhor.caixa,
      bruto: melhor.bruto,
      candidatos: validos.slice(0, 5),
      fatores,
    },
    conflito: Boolean(rival),
  };
}

/** Aplica um ajuste multiplicativo (ou piso) registrando o fator. */
export function ajustar<T>(campo: CampoExtraido<T>, fator: { multiplicar?: number; piso?: number; motivo: string }): CampoExtraido<T> {
  if (campo.valor == null) return campo;
  let c = campo.confianca;
  if (fator.multiplicar != null) c *= fator.multiplicar;
  if (fator.piso != null) c = Math.max(c, fator.piso);
  return { ...campo, confianca: arredondar(c), nivel: nivelDaConfianca(c), fatores: [...(campo.fatores ?? []), fator.motivo] };
}

/** Confiança da parcela: o elo mais fraco dos campos essenciais. */
export function confiancaDaParcela(campos: CampoExtraido<unknown>[]): number {
  return arredondar(Math.min(...campos.map((c) => (c.valor == null ? 0 : c.confianca))));
}

export function confiancaDoDocumento(confiancasParcelas: number[], alertas: Alerta[], paginas: number, paginasIlegiveis: number): number {
  if (!confiancasParcelas.length) return 0;
  const media = confiancasParcelas.reduce((s, v) => s + v, 0) / confiancasParcelas.length;
  const estruturais = alertas.filter((a) => ["MISSING_INSTALLMENT", "DUPLICATE_INSTALLMENT", "TOTAL_INSTALLMENTS_CONFLICT"].includes(a.codigo)).length;
  const legiveis = paginas > 0 ? (paginas - paginasIlegiveis) / paginas : 1;
  return arredondar(media * Math.max(0, 1 - 0.03 * estruturais) * legiveis);
}
