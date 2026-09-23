import { extractText, getDocumentProxy } from "unpdf";
import { decodificarBoleto, encontrarBoletosNoTexto } from "./boleto-febraban";

/**
 * Leitura de uma folha de carnê (1 folha = 1 boleto). A fonte principal é a
 * linha digitável validada pelos DVs FEBRABAN (valor e vencimento saem dela);
 * os rótulos impressos ("Vencimento", "Valor do documento", "Parcela 01/60")
 * complementam e servem de conferência.
 */
export interface PaginaLida {
  /** Número da folha no PDF enviado (1 = primeira). */
  pagina: number;
  fonte: "texto" | "agente" | "nenhuma";
  /** Quantidade de boletos distintos com linha digitável válida na folha. */
  boletosNaPagina: number;
  linhaDigitavel: string | null;
  codigoBarras: string | null;
  /** true quando valor/vencimento vieram de uma linha digitável com DVs conferidos. */
  linhaValidada: boolean;
  valor: number | null;
  vencimento: string | null;
  numeroParcela: number | null;
  totalParcelas: number | null;
  nossoNumero: string | null;
  numeroDocumento: string | null;
  nomePagador: string | null;
  cpfs: string[];
  observacoes: string[];
}

export function paginaVazia(pagina: number): PaginaLida {
  return {
    pagina, fonte: "nenhuma", boletosNaPagina: 0, linhaDigitavel: null, codigoBarras: null, linhaValidada: false,
    valor: null, vencimento: null, numeroParcela: null, totalParcelas: null, nossoNumero: null, numeroDocumento: null,
    nomePagador: null, cpfs: [], observacoes: [],
  };
}

const RE_VENCIMENTO = /vencimento\s*[:\-]?\s*(\d{2})\/(\d{2})\/(\d{4})/i;
const RE_VALOR_DOCUMENTO = /(?:valor\s+(?:do\s+)?documento|\(=\)\s*valor(?:\s+cobrado)?|valor\s+a\s+pagar)\s*[:\-]?\s*(?:R\$)?\s*([\d.]{1,12},\d{2})/i;
const RE_VALOR_SOLTO = /R\$\s*([\d.]{1,12},\d{2})/;
const RE_PARCELA = /(?:parcela|parc\.?|presta[cç][aã]o|plano)\s*(?:n[ºo°.]?\s*)?[:\-]?\s*(\d{1,3})\s*(?:\/|de)\s*(\d{1,3})\b/i;
const RE_NOSSO_NUMERO = /nosso\s+n[uú]mero\s*[:\-]?\s*([0-9A-Z][0-9A-Z.\-/]{2,39})/i;
const RE_DOCUMENTO = /n[ºo°.]?\s*(?:do\s+)?documento\s*[:\-]?\s*([0-9A-Z][0-9A-Z.\-/]{2,39})/i;
const RE_PAGADOR = /(?:pagador|sacado)\s*[:\-]?\s*([A-ZÀ-Ú][A-Za-zÀ-ú' ]{3,100})/;
const RE_CPF = /\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/g;
const RE_CPF_ROTULADO = /CPF\s*[:\-]?\s*(\d{11})\b/gi;

function valorBr(texto: string) {
  return Number(texto.replace(/\./g, "").replace(",", "."));
}

function identificador(valor: string | null | undefined) {
  const normalizado = String(valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return normalizado || null;
}

/** Interpreta o texto nativo de UMA folha. */
export function lerTextoDaPagina(texto: string, pagina: number, referenciaIso?: string | null): PaginaLida {
  const lida = paginaVazia(pagina);
  const bruto = String(texto ?? "");
  if (!bruto.trim()) return lida;
  lida.fonte = "texto";

  const boletos = encontrarBoletosNoTexto(bruto, referenciaIso);
  lida.boletosNaPagina = boletos.length;
  if (boletos.length === 1) {
    const [b] = boletos;
    lida.linhaDigitavel = b.linhaDigitavel;
    lida.codigoBarras = b.codigoBarras;
    lida.linhaValidada = true;
    lida.valor = b.valor;
    lida.vencimento = b.vencimento;
  } else if (boletos.length > 1) {
    lida.observacoes.push("mais_de_um_boleto_na_folha");
  }

  const venc = bruto.match(RE_VENCIMENTO);
  const vencImpresso = venc ? `${venc[3]}-${venc[2]}-${venc[1]}` : null;
  const valorMatch = bruto.match(RE_VALOR_DOCUMENTO) ?? bruto.match(RE_VALOR_SOLTO);
  const valorImpresso = valorMatch ? valorBr(valorMatch[1]) : null;
  if (!lida.vencimento) lida.vencimento = vencImpresso;
  else if (vencImpresso && vencImpresso !== lida.vencimento) lida.observacoes.push("vencimento_impresso_diverge_da_linha");
  if (lida.valor == null) lida.valor = valorImpresso;
  else if (valorImpresso != null && Math.abs(valorImpresso - lida.valor) >= 0.01) lida.observacoes.push("valor_impresso_diverge_da_linha");

  const parcela = bruto.match(RE_PARCELA);
  if (parcela) {
    const numero = Number(parcela[1]);
    const total = Number(parcela[2]);
    if (numero > 0 && total > 0 && numero <= total) {
      lida.numeroParcela = numero;
      lida.totalParcelas = total;
    }
  }
  lida.nossoNumero = identificador(bruto.match(RE_NOSSO_NUMERO)?.[1]);
  lida.numeroDocumento = identificador(bruto.match(RE_DOCUMENTO)?.[1]);
  lida.nomePagador = bruto.match(RE_PAGADOR)?.[1]?.trim() || null;
  const cpfs = new Set<string>();
  for (const m of bruto.matchAll(RE_CPF)) cpfs.add(m[1].replace(/\D/g, ""));
  for (const m of bruto.matchAll(RE_CPF_ROTULADO)) cpfs.add(m[1]);
  lida.cpfs = [...cpfs];
  return lida;
}

/**
 * Texto nativo de cada folha, lendo o PDF uma única vez. Retorna null quando
 * o PDF não pôde ser interpretado (as folhas seguem para o agente/revisão).
 */
export async function extrairTextosDoPdf(bytes: Uint8Array): Promise<string[] | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return Array.isArray(text) ? text : [String(text ?? "")];
  } catch (error) {
    console.error("Falha ao extrair texto do carnê em PDF:", error instanceof Error ? error.message : "erro desconhecido");
    return null;
  }
}

/** Aplica a validação FEBRABAN a um dado vindo de fora (ex.: agente de IA). */
export function consolidarLeituraExterna(base: PaginaLida, linhaInformada: string | null, referenciaIso?: string | null): PaginaLida {
  const decodificado = decodificarBoleto(linhaInformada, referenciaIso);
  if (!decodificado) {
    if (linhaInformada) base.observacoes.push("linha_digitavel_lida_nao_confere_dv");
    return base;
  }
  if (base.valor != null && decodificado.valor != null && Math.abs(base.valor - decodificado.valor) >= 0.01) base.observacoes.push("valor_lido_diverge_da_linha");
  if (base.vencimento && decodificado.vencimento && base.vencimento !== decodificado.vencimento) base.observacoes.push("vencimento_lido_diverge_da_linha");
  return {
    ...base,
    boletosNaPagina: Math.max(1, base.boletosNaPagina),
    linhaDigitavel: decodificado.linhaDigitavel,
    codigoBarras: decodificado.codigoBarras,
    linhaValidada: true,
    valor: decodificado.valor ?? base.valor,
    vencimento: decodificado.vencimento ?? base.vencimento,
  };
}
