/**
 * Camada 1 — recepção do arquivo. O tipo é detectado pelo CONTEÚDO (assinatura
 * binária), não pela extensão; o hash SHA-256 identifica o arquivo para
 * evitar importação duplicada.
 */
export type TipoArquivo = "application/pdf" | "image/jpeg" | "image/png";

export interface ArquivoRecebido {
  nome: string;
  tipo: TipoArquivo;
  extensao: string;
  tamanho: number;
  sha256: string;
  recebidoEm: string;
  bytes: Uint8Array;
}

export const TAMANHO_MAXIMO = 30 * 1024 * 1024;
export const PAGINAS_MAXIMAS = 240;

export class ErroArquivo extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroArquivo";
  }
}

export function detectarTipo(bytes: Uint8Array): TipoArquivo | null {
  const b = (i: number) => bytes[i];
  if (bytes.length >= 5 && b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46 && b(4) === 0x2d) return "application/pdf";
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) return "image/png";
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function receberArquivo(arquivo: File): Promise<ArquivoRecebido> {
  if (arquivo.size === 0) throw new ErroArquivo("O arquivo está vazio.");
  if (arquivo.size > TAMANHO_MAXIMO) throw new ErroArquivo("Arquivo maior que 30 MB. Divida o carnê em partes menores.");
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const tipo = detectarTipo(bytes);
  if (!tipo) throw new ErroArquivo("Formato não reconhecido. Envie o carnê em PDF, JPG ou PNG.");
  const extensao = (arquivo.name.split(".").pop() ?? "").toLowerCase();
  return { nome: arquivo.name, tipo, extensao, tamanho: arquivo.size, sha256: await sha256Hex(bytes), recebidoEm: new Date().toISOString(), bytes };
}
