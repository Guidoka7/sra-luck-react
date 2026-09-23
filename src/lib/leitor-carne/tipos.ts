/**
 * Leitor de carnês — contratos de dados.
 *
 * O núcleo (src/lib/leitor-carne) é TypeScript puro, sem DOM nem rede: roda
 * no navegador (leitura), no Worker (validação da importação) e nos testes.
 * Regra de ouro: nenhum campo é inventado. Sem evidência no documento, o
 * valor é null e a confiança é baixa; sugestões ficam separadas do valor.
 */

export type NivelConfianca = "ALTA" | "MEDIA" | "BAIXA";

/** De onde veio o valor de um campo. USER_CORRECTED = corrigido pela equipe na revisão. */
export type FonteCampo = "PDF_TEXT" | "OCR" | "USER_CORRECTED";

export type TipoDocumento = "PDF_TEXT" | "PDF_SCANNED" | "IMAGE" | "MIXED_PDF";

/** Retângulo normalizado (0..1) na página, origem no canto superior esquerdo. */
export interface Caixa {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PalavraTexto {
  texto: string;
  caixa: Caixa;
  /** 0..1 (texto nativo do PDF = 1). */
  confianca: number;
}

export interface LinhaTexto {
  texto: string;
  caixa: Caixa;
  confianca: number;
  palavras?: PalavraTexto[];
}

/** Texto de uma página, já com posição e confiança — entrada do parser. */
export interface PaginaTexto {
  /** 1 = primeira página do arquivo. */
  pagina: number;
  fonte: "PDF_TEXT" | "OCR";
  linhas: LinhaTexto[];
  /** Confiança média do OCR (0..1); null para texto nativo. */
  confiancaOcr: number | null;
  /** Qualidade estimada da imagem (0..1); null quando não se aplica. */
  qualidadeImagem?: number | null;
}

export interface Candidato<T> {
  valor: T;
  bruto: string;
  pontuacao: number;
  motivos: string[];
  pagina: number;
  caixa?: Caixa;
  fonte: "PDF_TEXT" | "OCR";
}

export interface Sugestao<T> {
  valor: T;
  motivo: string;
}

export interface CampoExtraido<T> {
  valor: T | null;
  confianca: number;
  nivel: NivelConfianca;
  fonte: FonteCampo;
  pagina?: number;
  caixa?: Caixa;
  bruto?: string;
  /** Outros candidatos considerados (para revisão), em ordem de pontuação. */
  candidatos?: Candidato<T>[];
  /** Sugestão que NÃO foi aplicada ao valor (ex.: correção provável de OCR). */
  sugestao?: Sugestao<T>;
  /** Fatores que compuseram a confiança (auditável). */
  fatores?: string[];
}

export type CodigoAlerta =
  | "MISSING_INSTALLMENT"
  | "DUPLICATE_INSTALLMENT"
  | "DATE_SEQUENCE_ANOMALY"
  | "VALUE_OUTLIER"
  | "INVALID_CPF"
  | "CLIENT_CPF_MISMATCH"
  | "CLIENT_NAME_MISMATCH"
  | "INVALID_BARCODE"
  | "LOW_OCR_CONFIDENCE"
  | "MULTIPLE_FIELD_CANDIDATES"
  | "UNREADABLE_PAGE"
  | "DOCUMENT_DUPLICATE"
  | "INSTALLMENT_ALREADY_EXISTS"
  | "TOTAL_INSTALLMENTS_CONFLICT"
  | "FIELD_NOT_FOUND"
  | "PRINTED_VALUE_DIVERGES"
  | "PARTIAL_DOCUMENT";

/** Erro impede a importação daquele item; alerta pede conferência; info só informa. */
export type Severidade = "ERRO" | "ALERTA" | "INFO";

export interface Alerta {
  codigo: CodigoAlerta;
  severidade: Severidade;
  mensagem: string;
  parcela?: number | null;
  /** id da parcela lida (ParcelaLida.id), quando o alerta é de uma parcela. */
  item?: string;
  campo?: CampoParcela | CampoDocumento;
  pagina?: number;
  detalhes?: Record<string, string | number | boolean | null>;
}

export type CampoParcela = "numero" | "total" | "vencimento" | "valorCentavos" | "linhaDigitavel" | "nossoNumero" | "numeroDocumento";
export type CampoDocumento = "nomeCliente" | "cpf" | "contrato" | "venda" | "carne" | "banco" | "beneficiario";

export interface ParcelaLida {
  /** Identificador estável dentro da leitura: "p<pagina>-s<segmento>". */
  id: string;
  pagina: number;
  segmento: number;
  /** Região da página ocupada por esta parcela (evidência visual). */
  regiao?: Caixa;
  numero: CampoExtraido<number>;
  total: CampoExtraido<number>;
  vencimento: CampoExtraido<string>;
  valorCentavos: CampoExtraido<number>;
  linhaDigitavel: CampoExtraido<string>;
  codigoBarras: CampoExtraido<string>;
  nossoNumero: CampoExtraido<string>;
  numeroDocumento: CampoExtraido<string>;
  alertas: Alerta[];
  confianca: number;
  nivel: NivelConfianca;
}

export type Periodicidade = "MENSAL" | "IRREGULAR" | "INDETERMINADA";

export interface ResumoCarne {
  totalInformado: number | null;
  encontradas: number;
  faixa: { primeira: number | null; ultima: number | null };
  primeiroVencimento: string | null;
  ultimoVencimento: string | null;
  valorPredominanteCentavos: number | null;
  valorTotalCentavos: number;
  periodicidade: Periodicidade;
  ausentes: number[];
  duplicadas: number[];
}

export interface LayoutDetectado {
  parser: string;
  fingerprint: string;
  banco: string | null;
}

export interface CarneLido {
  tipoDocumento: TipoDocumento;
  paginas: number;
  paginasTexto: number;
  paginasOcr: number;
  paginasIlegiveis: number[];
  layout: LayoutDetectado;
  nomeCliente: CampoExtraido<string>;
  cpf: CampoExtraido<string>;
  contrato: CampoExtraido<string>;
  venda: CampoExtraido<string>;
  carne: CampoExtraido<string>;
  banco: CampoExtraido<string>;
  beneficiario: CampoExtraido<string>;
  parcelas: ParcelaLida[];
  resumo: ResumoCarne;
  confiancaDocumento: number;
  nivelDocumento: NivelConfianca;
  alertas: Alerta[];
}

/** Cliente selecionada no admin, para validar o documento contra o cadastro. */
export interface ClienteReferencia {
  nome: string | null;
  cpf: string | null;
}

/** Parcela já cadastrada (para detectar duplicidade antes de importar). */
export interface ParcelaExistente {
  id: string;
  numero: number;
  total: number;
  vencimento: string | null;
  valorCentavos: number;
  temBoleto: boolean;
  identificador: string | null;
  status: string;
}

export type SituacaoParcela =
  | "NOVA"
  | "JA_EXISTE_IGUAL"
  | "JA_EXISTE_DIFERENTE"
  | "JA_TEM_BOLETO"
  | "MESMO_BOLETO_JA_ANEXADO";

export interface ComparacaoParcela {
  item: string;
  situacao: SituacaoParcela;
  existente: ParcelaExistente | null;
  diferencas: ("valor" | "vencimento" | "total")[];
  /** Parcela existente que corresponde por vencimento+valor. `exata` só é true quando data completa, valor e total (se lido) batem de forma única. */
  correspondenciaProvavel: { numero: number; motivo: string; exata: boolean } | null;
}

/** Contrato para provedores de leitura (local hoje; externo opcional no futuro). */
export interface ProvedorLeituraDocumento {
  readonly id: string;
  analisar(paginas: PaginaTexto[], contexto: ContextoLeitura): CarneLido;
}

export interface ContextoLeitura {
  tipoDocumento: TipoDocumento;
  totalPaginas: number;
  paginasIlegiveis: number[];
  cliente?: ClienteReferencia | null;
  /** Data de referência para resolver o ciclo do fator de vencimento (YYYY-MM-DD). */
  referenciaIso?: string;
}
