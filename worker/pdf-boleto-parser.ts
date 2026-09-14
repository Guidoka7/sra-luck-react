import { extractText, getDocumentProxy } from "unpdf";

export interface DadosExtraidosBoleto {
  valor: number | null;
  vencimento: string | null;
  numeroParcela: number | null;
  linhaDigitavel: string | null;
  codigoBarras: string | null;
  nossoNumero: string | null;
  numeroDocumento: string | null;
  nomePagador: string | null;
  cpf: string | null;
  textoBruto: string;
}

const RE_VALOR = /R\$\s*([\d.]{1,12},\d{2})/;
const RE_DATA = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const RE_CPF = /\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/;
const RE_CPF_SO_DIGITOS = /\b(\d{11})\b/;
const RE_PARCELA = /\bparcela\s*n?[ºo°]?\s*(\d{1,3})\s*(?:\/|de)\s*(\d{1,3})\b/i;
/** Linha digitável de boleto: 47-48 dígitos, tipicamente agrupados em blocos separados por espaço/ponto. */
const RE_LINHA_DIGITAVEL = /\b(\d{5}[.\s]?\d{5}[.\s]?\d{5}[.\s]?\d{6}[.\s]?\d{5}[.\s]?\d{6}[.\s]?\d{1}[.\s]?\d{14})\b/;
const RE_CODIGO_BARRAS = /(?:c[oó]digo\s+(?:de\s+)?barras?\s*[:\-]?\s*)?\b(\d{44})\b/i;
const RE_NOSSO_NUMERO = /nosso\s+n[uú]mero\s*[:\-]?\s*([0-9A-Z][0-9A-Z.\-/]{2,39})/i;
const RE_DOCUMENTO = /(?:n(?:[ºo°]|úmero)?\s*(?:do\s+)?)?documento\s*[:\-]?\s*([0-9A-Z][0-9A-Z.\-/]{2,39})/i;
const RE_PAGADOR = /(?:pagador|sacado)\s*[:\-]\s*([^\n\r]{3,120})/i;

function normalizarValor(valor: string) {
  return Number(valor.replace(/\./g, "").replace(",", "."));
}

function normalizarData(dia: string, mes: string, ano: string) {
  return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

function normalizarIdentificador(valor: string | null | undefined) {
  const normalizado = String(valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return normalizado || null;
}

function normalizarTexto(valor: string | null | undefined) {
  return String(valor ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Extrai texto nativo de uma página de PDF (boleto) e reconhece os campos que
 * podem identificar uma parcela. Não faz OCR: PDF escaneado/sem texto nativo
 * cai em revisão humana em vez de receber vínculo por posição de página.
 */
export async function extrairDadosBoleto(paginaBytes: Uint8Array): Promise<DadosExtraidosBoleto> {
  let texto = "";
  try {
    const pdf = await getDocumentProxy(paginaBytes);
    const resultado = await extractText(pdf, { mergePages: true });
    texto = Array.isArray(resultado.text) ? resultado.text.join("\n") : resultado.text;
  } catch {
    texto = "";
  }

  const valorMatch = texto.match(RE_VALOR);
  const dataMatch = texto.match(RE_DATA);
  const cpfMatch = texto.match(RE_CPF) ?? texto.match(RE_CPF_SO_DIGITOS);
  const parcelaMatch = texto.match(RE_PARCELA);
  const linhaMatch = texto.match(RE_LINHA_DIGITAVEL);
  const codigoMatch = texto.match(RE_CODIGO_BARRAS);
  const nossoNumeroMatch = texto.match(RE_NOSSO_NUMERO);
  const documentoMatch = texto.match(RE_DOCUMENTO);
  const pagadorMatch = texto.match(RE_PAGADOR);

  const linhaDigitavel = linhaMatch ? linhaMatch[1].replace(/[^0-9]/g, "") : null;
  const codigoBarras = codigoMatch ? codigoMatch[1].replace(/[^0-9]/g, "") : null;
  const cpf = cpfMatch ? cpfMatch[1].replace(/\D/g, "") : null;
  let nomePagador = pagadorMatch?.[1]?.trim() || null;
  if (nomePagador) {
    nomePagador = nomePagador.replace(/\s*(?:CPF|CNPJ)\s*[:\-]?.*$/i, "").trim() || null;
  }

  return {
    valor: valorMatch ? normalizarValor(valorMatch[1]) : null,
    vencimento: dataMatch ? normalizarData(dataMatch[1], dataMatch[2], dataMatch[3]) : null,
    numeroParcela: parcelaMatch ? Number(parcelaMatch[1]) : null,
    linhaDigitavel,
    codigoBarras,
    nossoNumero: normalizarIdentificador(nossoNumeroMatch?.[1]),
    numeroDocumento: normalizarIdentificador(documentoMatch?.[1]),
    nomePagador,
    cpf,
    textoBruto: texto.slice(0, 4000),
  };
}

export interface BoletoCandidato {
  id: string;
  numero_parcela: number;
  valor: number;
  data_vencimento: string | null;
  identificador_externo?: string | null;
  instituicao_financeira?: string | null;
}

export interface ResultadoPontuacao {
  boletoId: string | null;
  pontuacaoConfianca: number;
  nivelConfianca: "alta" | "media" | "baixa";
  statusVinculacao: "aguardando_confirmacao" | "revisar";
  motivos: string[];
}

type CandidatoPontuado = {
  boleto: BoletoCandidato;
  pontuacao: number;
  pontuacaoForte: number;
  identificadorExato: boolean;
  motivos: string[];
};

function identificadoresExtraidos(dados: DadosExtraidosBoleto) {
  return [dados.linhaDigitavel, dados.codigoBarras, dados.nossoNumero, dados.numeroDocumento]
    .map(normalizarIdentificador)
    .filter((valor): valor is string => Boolean(valor));
}

/**
 * Matching conservador. Evidências de conteúdo (identificador, valor,
 * vencimento e número da parcela) decidem; posição da página vale apenas 2
 * pontos auxiliares e nunca transforma um caso ambíguo em sugestão.
 *
 * IMPORTANTE: isto só gera uma sugestão para revisão. O vínculo real continua
 * exigindo POST explícito em .../vincular. Se dois candidatos permanecem
 * plausíveis, retorna REVIEW sem boleto sugerido.
 */
export function pontuarCandidatos(
  dados: DadosExtraidosBoleto,
  candidatos: BoletoCandidato[],
  numeroDaPagina: number,
  cpfCliente: string | null,
  instituicaoArquivo?: string | null,
): ResultadoPontuacao {
  const cpfNormalizado = String(cpfCliente ?? "").replace(/\D/g, "");
  const cpfDivergente = Boolean(dados.cpf && cpfNormalizado && dados.cpf !== cpfNormalizado);
  if (cpfDivergente) {
    return { boletoId: null, pontuacaoConfianca: 0, nivelConfianca: "baixa", statusVinculacao: "revisar", motivos: ["cpf_extraido_diverge_do_cliente"] };
  }

  const idsExtraidos = identificadoresExtraidos(dados);
  const instituicaoNormalizada = normalizarTexto(instituicaoArquivo);
  const pontuados: CandidatoPontuado[] = candidatos.map((boleto) => {
    let pontuacao = 0;
    let pontuacaoForte = 0;
    let identificadorExato = false;
    const motivos: string[] = [];
    const somarForte = (pontos: number, motivo: string) => { pontuacao += pontos; pontuacaoForte += pontos; motivos.push(motivo); };

    const identificador = normalizarIdentificador(boleto.identificador_externo);
    if (identificador && idsExtraidos.includes(identificador)) {
      somarForte(80, "identificador_externo_confere");
      identificadorExato = true;
    }
    if (dados.valor != null && Math.abs(dados.valor - Number(boleto.valor)) < 0.01) {
      somarForte(40, "valor_extraido_confere");
    }
    if (dados.vencimento && boleto.data_vencimento && dados.vencimento === boleto.data_vencimento) {
      somarForte(35, "vencimento_extraido_confere");
    }
    if (dados.numeroParcela != null && dados.numeroParcela === boleto.numero_parcela) {
      somarForte(25, "numero_parcela_extraido_confere");
    }
    if (dados.cpf && cpfNormalizado && dados.cpf === cpfNormalizado) {
      somarForte(10, "cpf_extraido_confere");
    }
    const bancoCandidato = normalizarTexto(boleto.instituicao_financeira);
    if (instituicaoNormalizada && bancoCandidato && instituicaoNormalizada === bancoCandidato) {
      somarForte(8, "instituicao_financeira_confere");
    }
    if (numeroDaPagina === boleto.numero_parcela) {
      pontuacao += 2;
      motivos.push("ordem_da_pagina_coincide_auxiliar");
    }

    return { boleto, pontuacao, pontuacaoForte, identificadorExato, motivos };
  }).sort((a, b) => b.pontuacao - a.pontuacao || b.pontuacaoForte - a.pontuacaoForte || a.boleto.numero_parcela - b.boleto.numero_parcela);

  const melhor = pontuados[0];
  if (!melhor) {
    return { boletoId: null, pontuacaoConfianca: 0, nivelConfianca: "baixa", statusVinculacao: "revisar", motivos: ["dados_insuficientes_para_sugestao"] };
  }

  const segundo = pontuados[1];
  if (segundo) {
    // A ambiguidade é avaliada ANTES do piso mínimo. Assim, valor/banco/CPF
    // compartilhados por várias parcelas nunca são tratados apenas como
    // "dados insuficientes" e, sobretudo, a posição da página não os desempata.
    const empateForte = segundo.pontuacaoForte === melhor.pontuacaoForte && segundo.pontuacaoForte > 0;
    if (empateForte) {
      return {
        boletoId: null,
        pontuacaoConfianca: melhor.pontuacao,
        nivelConfianca: "baixa",
        statusVinculacao: "revisar",
        motivos: [...melhor.motivos, "mais_de_um_candidato_plausivel"],
      };
    }
  }

  if (melhor.pontuacaoForte < 55) {
    return { boletoId: null, pontuacaoConfianca: melhor.pontuacao, nivelConfianca: "baixa", statusVinculacao: "revisar", motivos: melhor.motivos.length ? melhor.motivos : ["dados_insuficientes_para_sugestao"] };
  }

  if (segundo) {
    const muitoProximo = !melhor.identificadorExato && segundo.pontuacaoForte > 0 && (melhor.pontuacaoForte - segundo.pontuacaoForte) < 15;
    if (muitoProximo) {
      return {
        boletoId: null,
        pontuacaoConfianca: melhor.pontuacao,
        nivelConfianca: "baixa",
        statusVinculacao: "revisar",
        motivos: [...melhor.motivos, "mais_de_um_candidato_plausivel"],
      };
    }
  }

  const nivel: "alta" | "media" = melhor.identificadorExato || melhor.pontuacaoForte >= 75 ? "alta" : "media";
  return { boletoId: melhor.boleto.id, pontuacaoConfianca: melhor.pontuacao, nivelConfianca: nivel, statusVinculacao: "aguardando_confirmacao", motivos: melhor.motivos };
}
