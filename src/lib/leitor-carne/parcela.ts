import { extrairCandidatos, type Achado } from "./candidatos";
import { ajustar, campoDeCandidatos, campoVazio, confiancaDaParcela, nivelDaConfianca, arredondar } from "./confianca";
import { encontrarBoletos } from "./febraban";
import { encontrarDatas, encontrarNumeroIsolado, encontrarNumerosParcela, encontrarValores, formatarCentavos, formatarData } from "./normalizadores";
import type { SegmentoParcela } from "./segmentador";
import type { Alerta, CampoExtraido, Candidato, ParcelaLida } from "./tipos";

/**
 * Lê UMA parcela (um segmento de página): número/total, vencimento, valor,
 * linha digitável, nosso número e número do documento — cada um com
 * candidatos, confiança e origem. A linha digitável com DV válido é usada
 * para CONFIRMAR ou questionar valor e vencimento impressos.
 */

const extratorData = (t: string): Achado<string>[] => encontrarDatas(t).map((d) => ({ valor: d.iso, bruto: d.bruto, indice: d.indice }));
const extratorValor = (t: string): Achado<number>[] => encontrarValores(t).map((v) => ({ valor: v.centavos, bruto: v.bruto, indice: v.indice }));
const extratorParcela = (t: string): Achado<string>[] => {
  const pares = encontrarNumerosParcela(t).map((p) => ({ valor: `${p.numero}/${p.total}`, bruto: p.bruto, indice: p.indice }));
  if (pares.length) return pares;
  const isolado = encontrarNumeroIsolado(t);
  return isolado ? [{ valor: `${isolado.numero}/`, bruto: isolado.bruto, indice: isolado.indice }] : [];
};
const extratorToken = (t: string): Achado<string>[] => {
  const m = t.match(/^\s*[:\-]?\s*([0-9A-Za-z][0-9A-Za-z./-]{2,39})/);
  return m ? [{ valor: m[1].toUpperCase().replace(/[^0-9A-Z]/g, ""), bruto: m[1], indice: t.indexOf(m[1]) }] : [];
};

function confiancaMedia(seg: SegmentoParcela) {
  if (!seg.linhas.length) return 0;
  return seg.linhas.reduce((s, l) => s + l.confianca, 0) / seg.linhas.length;
}

function alerta(parcela: ParcelaLida | { id: string; pagina: number }, a: Omit<Alerta, "item" | "pagina">): Alerta {
  return { ...a, item: parcela.id, pagina: parcela.pagina };
}

function mapearCampo<A, B>(campo: CampoExtraido<A>, f: (v: A) => B | null): CampoExtraido<B> {
  const valor = campo.valor == null ? null : f(campo.valor);
  return { ...campo, valor, candidatos: campo.candidatos?.map((c) => ({ ...c, valor: f(c.valor) })).filter((c): c is Candidato<B> => c.valor != null) } as CampoExtraido<B>;
}

export function lerParcela(seg: SegmentoParcela, referenciaIso?: string): ParcelaLida {
  const id = `p${seg.pagina}-s${seg.segmento}`;
  const base = { id, pagina: seg.pagina };
  const alertas: Alerta[] = [];
  const texto = seg.linhas.map((l) => l.texto).join("\n");

  // Número e total da parcela
  const candParcela = extrairCandidatos(seg, "parcela", extratorParcela, { semRotulo: 0.45 });
  const { campo: campoParcela, conflito: conflitoParcela } = campoDeCandidatos(candParcela);
  let numero = mapearCampo(campoParcela, (v) => Number(v.split("/")[0]) || null);
  let total = mapearCampo(campoParcela, (v) => Number(v.split("/")[1]) || null);
  if (conflitoParcela) alertas.push(alerta(base, { codigo: "MULTIPLE_FIELD_CANDIDATES", severidade: "ALERTA", campo: "numero", mensagem: "Mais de um número de parcela possível nesta folha.", parcela: numero.valor }));

  // Vencimento e valor
  const { campo: campoVenc, conflito: conflitoVenc } = campoDeCandidatos(extrairCandidatos(seg, "vencimento", extratorData, { semRotulo: 0.35 }));
  let vencimento = campoVenc;
  if (conflitoVenc) alertas.push(alerta(base, { codigo: "MULTIPLE_FIELD_CANDIDATES", severidade: "ALERTA", campo: "vencimento", mensagem: "Mais de uma data possível para o vencimento.", parcela: numero.valor }));
  const { campo: campoValor, conflito: conflitoValor } = campoDeCandidatos(extrairCandidatos(seg, "valor", extratorValor, { semRotulo: 0.3 }));
  let valorCentavos = campoValor;
  if (conflitoValor) alertas.push(alerta(base, { codigo: "MULTIPLE_FIELD_CANDIDATES", severidade: "ALERTA", campo: "valorCentavos", mensagem: "Mais de um valor possível nesta folha.", parcela: numero.valor }));

  // Linha digitável (DV) — confirma ou questiona o que está impresso
  let linhaDigitavel = campoVazio<string>(seg.fonte);
  let codigoBarras = campoVazio<string>(seg.fonte);
  const { validos, sugestoes, quaseLinhas } = encontrarBoletos(texto, referenciaIso);
  if (validos.length === 1) {
    const b = validos[0];
    const linhaOrigem = seg.linhas.find((l) => l.texto.replace(/\D/g, "").includes(b.linhaDigitavel.slice(0, 10)));
    const conf = Math.max(0.99, linhaOrigem?.confianca ?? 0.99);
    linhaDigitavel = { valor: b.linhaDigitavel, confianca: arredondar(conf), nivel: nivelDaConfianca(conf), fonte: seg.fonte, pagina: seg.pagina, caixa: linhaOrigem?.caixa, fatores: ["digitos_verificadores_validos"] };
    codigoBarras = { ...linhaDigitavel, valor: b.codigoBarras };

    if (b.valorCentavos != null) {
      if (valorCentavos.valor == null) {
        valorCentavos = { valor: b.valorCentavos, confianca: 0.97, nivel: "ALTA", fonte: seg.fonte, pagina: seg.pagina, caixa: linhaOrigem?.caixa, fatores: ["valor_decodificado_da_linha_digitavel"] };
      } else if (valorCentavos.valor === b.valorCentavos) {
        valorCentavos = ajustar(valorCentavos, { piso: 0.99, motivo: "confirmado_pela_linha_digitavel" });
      } else {
        alertas.push(alerta(base, { codigo: "PRINTED_VALUE_DIVERGES", severidade: "ALERTA", campo: "valorCentavos", parcela: numero.valor, mensagem: `Valor lido (${formatarCentavos(valorCentavos.valor)}) difere do valor da linha digitável (${formatarCentavos(b.valorCentavos)}). Confira no documento.`, detalhes: { lidoCentavos: valorCentavos.valor, linhaCentavos: b.valorCentavos } }));
        valorCentavos = ajustar({ ...valorCentavos, valor: b.valorCentavos, fatores: [...(valorCentavos.fatores ?? []), "valor_da_linha_digitavel_prevalece"] }, { multiplicar: 0.7, motivo: "texto_impresso_diverge" });
      }
    }
    if (b.vencimento) {
      if (vencimento.valor == null) {
        vencimento = { valor: b.vencimento, confianca: 0.93, nivel: "MEDIA", fonte: seg.fonte, pagina: seg.pagina, caixa: linhaOrigem?.caixa, fatores: ["vencimento_decodificado_do_fator"] };
      } else if (vencimento.valor === b.vencimento) {
        vencimento = ajustar(vencimento, { piso: 0.99, motivo: "confirmado_pela_linha_digitavel" });
      } else {
        alertas.push(alerta(base, { codigo: "PRINTED_VALUE_DIVERGES", severidade: "ALERTA", campo: "vencimento", parcela: numero.valor, mensagem: `Vencimento lido (${formatarData(vencimento.valor)}) difere do vencimento da linha digitável (${formatarData(b.vencimento)}). Confira no documento.`, detalhes: { lido: vencimento.valor, linha: b.vencimento } }));
        vencimento = ajustar({ ...vencimento, valor: b.vencimento, fatores: [...(vencimento.fatores ?? []), "vencimento_da_linha_digitavel_prevalece"] }, { multiplicar: 0.7, motivo: "texto_impresso_diverge" });
      }
    }
  } else if (validos.length > 1) {
    alertas.push(alerta(base, { codigo: "MULTIPLE_FIELD_CANDIDATES", severidade: "ALERTA", campo: "linhaDigitavel", parcela: numero.valor, mensagem: "Mais de uma linha digitável válida no mesmo trecho da página." }));
  } else if (sugestoes.length === 1) {
    const s = sugestoes[0];
    linhaDigitavel = { ...campoVazio<string>(seg.fonte), pagina: seg.pagina, sugestao: { valor: s.sugerida.linhaDigitavel, motivo: `Leitura provável corrigindo ${s.trocas.length} caractere(s) confundido(s) pelo OCR (${s.trocas.slice(0, 3).join("; ")}).` } };
    alertas.push(alerta(base, { codigo: "INVALID_BARCODE", severidade: "ALERTA", campo: "linhaDigitavel", parcela: numero.valor, mensagem: "A linha digitável tem caracteres confundidos na leitura. Há uma correção provável para você conferir." }));
  } else if (quaseLinhas.length) {
    alertas.push(alerta(base, { codigo: "INVALID_BARCODE", severidade: "ALERTA", campo: "linhaDigitavel", parcela: numero.valor, mensagem: "Linha digitável encontrada, mas os dígitos verificadores não conferem (leitura incompleta ou incorreta)." }));
  }

  // Nosso número e número do documento
  const { campo: nossoNumero } = campoDeCandidatos(extrairCandidatos(seg, "nossoNumero", extratorToken, { semRotulo: 0 }));
  const { campo: numeroDocumento } = campoDeCandidatos(extrairCandidatos(seg, "numeroDocumento", extratorToken, { semRotulo: 0 }));

  // Campos essenciais ausentes: nunca preenchidos por dedução
  if (numero.valor == null) alertas.push(alerta(base, { codigo: "FIELD_NOT_FOUND", severidade: "ALERTA", campo: "numero", mensagem: "Número da parcela não identificado.", parcela: null }));
  if (vencimento.valor == null) alertas.push(alerta(base, { codigo: "FIELD_NOT_FOUND", severidade: "ALERTA", campo: "vencimento", mensagem: "Vencimento não identificado com segurança.", parcela: numero.valor }));
  if (valorCentavos.valor == null) alertas.push(alerta(base, { codigo: "FIELD_NOT_FOUND", severidade: "ALERTA", campo: "valorCentavos", mensagem: "Valor não identificado com segurança.", parcela: numero.valor }));
  if (seg.fonte === "OCR" && confiancaMedia(seg) < 0.7) alertas.push(alerta(base, { codigo: "LOW_OCR_CONFIDENCE", severidade: "ALERTA", mensagem: "Trecho com baixa qualidade de leitura. Confira no documento.", parcela: numero.valor, detalhes: { confiancaOcr: Math.round(confiancaMedia(seg) * 100) / 100 } }));
  if (total.valor == null && numero.valor != null) total = { ...total, valor: null, confianca: 0, nivel: "BAIXA" };

  const confianca = confiancaDaParcela([numero, vencimento, valorCentavos]);
  return {
    id, pagina: seg.pagina, segmento: seg.segmento, regiao: seg.regiao,
    numero, total, vencimento, valorCentavos, linhaDigitavel, codigoBarras, nossoNumero, numeroDocumento,
    alertas, confianca, nivel: nivelDaConfianca(confianca),
  };
}

