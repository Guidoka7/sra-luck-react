import { extractText, getDocumentProxy } from "unpdf";

export interface DadosExtraidosBoleto {
  valor: number | null;
  vencimento: string | null;
  numeroParcela: number | null;
  linhaDigitavel: string | null;
  cpf: string | null;
  textoBruto: string;
}

const RE_VALOR = /R\$\s*([\d.]{1,12},\d{2})/;
const RE_DATA = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const RE_CPF = /\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/;
const RE_PARCELA = /\bparcela\s*n?[ºo°]?\s*(\d{1,3})\s*(?:\/|de)\s*(\d{1,3})\b/i;
/** Linha digitável de boleto: 47-48 dígitos, tipicamente agrupados em blocos separados por espaço/ponto. */
const RE_LINHA_DIGITAVEL = /\b(\d{5}[.\s]?\d{5}[.\s]?\d{5}[.\s]?\d{6}[.\s]?\d{5}[.\s]?\d{6}[.\s]?\d{1}[.\s]?\d{14})\b/;

function normalizarValor(valor: string) {
  return Number(valor.replace(/\./g, "").replace(",", "."));
}

function normalizarData(dia: string, mes: string, ano: string) {
  return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

/**
 * Extrai texto nativo de uma página de PDF (boleto) e tenta reconhecer os
 * campos usados para conciliar com a parcela correta. Não faz OCR — só lê o
 * texto embutido no PDF. Quando o PDF é escaneado como imagem (sem texto
 * nativo), a extração retorna campos nulos e a página cai em revisão manual.
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
  const cpfMatch = texto.match(RE_CPF);
  const parcelaMatch = texto.match(RE_PARCELA);
  const linhaMatch = texto.match(RE_LINHA_DIGITAVEL);

  return {
    valor: valorMatch ? normalizarValor(valorMatch[1]) : null,
    vencimento: dataMatch ? normalizarData(dataMatch[1], dataMatch[2], dataMatch[3]) : null,
    numeroParcela: parcelaMatch ? Number(parcelaMatch[1]) : null,
    linhaDigitavel: linhaMatch ? linhaMatch[1].replace(/[.\s]/g, "") : null,
    cpf: cpfMatch ? cpfMatch[1].replace(/\D/g, "") : null,
    textoBruto: texto.slice(0, 4000),
  };
}

export interface BoletoCandidato {
  id: string;
  numero_parcela: number;
  valor: number;
  data_vencimento: string | null;
}

export interface ResultadoPontuacao {
  boletoId: string | null;
  pontuacaoConfianca: number;
  nivelConfianca: "alta" | "media" | "baixa";
  statusVinculacao: "aguardando_confirmacao" | "revisar";
  motivos: string[];
}

/**
 * Pontua cada boleto candidato da cliente contra os dados extraídos da
 * página. Ordem de página é usada apenas como sinal auxiliar de baixo peso
 * (5 pontos) — nunca é suficiente, por si só, para confiança alta ou média.
 * Confirmação humana é sempre exigida antes de qualquer vínculo real
 * (nenhum vínculo é aplicado aqui; isto só calcula a sugestão).
 */
export function pontuarCandidatos(
  dados: DadosExtraidosBoleto,
  candidatos: BoletoCandidato[],
  numeroDaPagina: number,
  cpfCliente: string | null,
): ResultadoPontuacao {
  const cpfDivergente = Boolean(dados.cpf && cpfCliente && dados.cpf !== cpfCliente.replace(/\D/g, ""));

  let melhor: { boleto: BoletoCandidato; pontuacao: number; motivos: string[] } | null = null;

  for (const boleto of candidatos) {
    let pontuacao = 0;
    const motivos: string[] = [];

    if (dados.valor != null && Math.abs(dados.valor - Number(boleto.valor)) < 0.01) {
      pontuacao += 40; motivos.push("valor_extraido_confere");
    }
    if (dados.vencimento && boleto.data_vencimento && dados.vencimento === boleto.data_vencimento) {
      pontuacao += 30; motivos.push("vencimento_extraido_confere");
    }
    if (dados.numeroParcela != null && dados.numeroParcela === boleto.numero_parcela) {
      pontuacao += 20; motivos.push("numero_parcela_extraido_confere");
    }
    if (dados.linhaDigitavel) {
      pontuacao += 5; motivos.push("linha_digitavel_presente");
    }
    if (numeroDaPagina === boleto.numero_parcela) {
      pontuacao += 5; motivos.push("ordem_da_pagina_coincide_auxiliar");
    }

    if (!melhor || pontuacao > melhor.pontuacao) melhor = { boleto, pontuacao, motivos };
  }

  if (cpfDivergente) {
    return { boletoId: null, pontuacaoConfianca: 0, nivelConfianca: "baixa", statusVinculacao: "revisar", motivos: ["cpf_extraido_diverge_do_cliente"] };
  }
  if (!melhor || melhor.pontuacao < 40) {
    return { boletoId: null, pontuacaoConfianca: melhor?.pontuacao ?? 0, nivelConfianca: "baixa", statusVinculacao: "revisar", motivos: melhor?.motivos ?? ["dados_insuficientes_para_sugestao"] };
  }

  const nivel: "alta" | "media" = melhor.pontuacao >= 70 ? "alta" : "media";
  return { boletoId: melhor.boleto.id, pontuacaoConfianca: melhor.pontuacao, nivelConfianca: nivel, statusVinculacao: "aguardando_confirmacao", motivos: melhor.motivos };
}
