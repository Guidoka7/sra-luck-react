import type { CarneLido } from "@/lib/leitor-carne/tipos";
import type { ItemRevisao } from "@/lib/leitor-carne/revisao";
import type { ArquivoRecebido } from "./intake";
import { desenharGirada, type MetricasLeitura } from "./processador";
import { abrirPdf, fecharPdf, renderizarPagina } from "./pdf";
import { liberarCanvas, type Rotacao } from "./preprocessamento";

/**
 * Importação — só depois de "Confirmar importação".
 * 1) Separa, no aparelho, apenas as folhas das parcelas aprovadas (a folha
 *    inteira é guardada, com código de barras e linha digitável intactos);
 * 2) envia em lotes pequenos (limite do servidor) para o bucket privado;
 * 3) pede ao servidor a importação transacional. A chave de idempotência é
 *    a mesma em novas tentativas: repetir nunca duplica parcelas.
 */

const FOLHA_MAXIMA = 3_400_000;
const LOTE_MAXIMO = 3_200_000;

export interface ProgressoImportacao {
  mensagem: string;
  percentual: number;
}

export interface ResultadoImportacao {
  importacaoId: string;
  criadas: number;
  anexadas: number;
  substituidas: number;
  ignoradas: number;
  repetida?: boolean;
}

export class ErroImportacao extends Error {
  constructor(mensagem: string, readonly status?: number) {
    super(mensagem);
    this.name = "ErroImportacao";
  }
}

function jpeg(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ErroImportacao("Não foi possível preparar a folha."))), "image/jpeg", qualidade));
}

async function imagemParaJpeg(fonte: CanvasImageSource & { width: number; height: number }, larguraMax: number): Promise<Blob> {
  const escala = Math.min(1, larguraMax / fonte.width);
  const c = document.createElement("canvas");
  c.width = Math.round(fonte.width * escala);
  c.height = Math.round(fonte.height * escala);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(fonte, 0, 0, c.width, c.height);
  try {
    for (const q of [0.85, 0.72, 0.6]) {
      const b = await jpeg(c, q);
      if (b.size <= FOLHA_MAXIMA) return b;
    }
    throw new ErroImportacao("A folha ficou grande demais para enviar.");
  } finally {
    liberarCanvas(c);
  }
}

/** Imagem em pé (girada como na leitura) em JPEG dentro do limite de tamanho. */
async function jpegEmPe(fonte: HTMLCanvasElement | ImageBitmap, rotacao: Rotacao, larguraMax: number): Promise<Blob> {
  const girada = desenharGirada(fonte, rotacao, larguraMax);
  try {
    return await imagemParaJpeg(girada, larguraMax);
  } finally {
    liberarCanvas(girada);
  }
}

/**
 * Gera um arquivo por folha aprovada: f<página>.pdf|jpg|png. Páginas lidas
 * giradas (foto de cabeça para baixo, escaneado de lado) são guardadas em pé,
 * para a cliente ver o boleto na posição certa.
 */
export async function separarFolhas(arquivo: ArquivoRecebido, paginas: number[], sinal?: AbortSignal, rotacoes: Record<number, Rotacao> = {}): Promise<Map<number, File>> {
  const folhas = new Map<number, File>();
  const unicas = [...new Set(paginas)].sort((a, b) => a - b);
  if (arquivo.tipo === "application/pdf") {
    const { PDFDocument } = await import("pdf-lib");
    const original = await PDFDocument.load(arquivo.bytes, { ignoreEncryption: false });
    let pdfjs: Awaited<ReturnType<typeof abrirPdf>> | null = null;
    try {
      for (const n of unicas) {
        if (sinal?.aborted) throw new DOMException("Importação cancelada", "AbortError");
        const rotacao = rotacoes[n] ?? 0;
        if (rotacao) {
          pdfjs ??= await abrirPdf(arquivo.bytes);
          const canvas = await renderizarPagina(await pdfjs.getPage(n), 1800);
          try {
            folhas.set(n, new File([await jpegEmPe(canvas, rotacao, 1800)], `f${n}.jpg`, { type: "image/jpeg" }));
          } finally {
            liberarCanvas(canvas);
          }
          continue;
        }
        const doc = await PDFDocument.create();
        const [pagina] = await doc.copyPages(original, [n - 1]);
        doc.addPage(pagina);
        const bytes = await doc.save();
        if (bytes.byteLength <= FOLHA_MAXIMA) {
          folhas.set(n, new File([bytes as BlobPart], `f${n}.pdf`, { type: "application/pdf" }));
          continue;
        }
        // Folha escaneada pesada: guarda uma imagem nítida da página.
        pdfjs ??= await abrirPdf(arquivo.bytes);
        const canvas = await renderizarPagina(await pdfjs.getPage(n), 1800);
        try {
          folhas.set(n, new File([await imagemParaJpeg(canvas, 1800)], `f${n}.jpg`, { type: "image/jpeg" }));
        } finally {
          liberarCanvas(canvas);
        }
      }
    } finally {
      if (pdfjs) await fecharPdf(pdfjs);
    }
    return folhas;
  }
  // Imagem: uma folha só.
  const rotacao = rotacoes[1] ?? 0;
  if (arquivo.tamanho <= FOLHA_MAXIMA && !rotacao) {
    const ext = arquivo.tipo === "image/png" ? "png" : "jpg";
    folhas.set(1, new File([arquivo.bytes as BlobPart], `f1.${ext}`, { type: arquivo.tipo }));
  } else {
    const bitmap = await createImageBitmap(new Blob([arquivo.bytes as BlobPart], { type: arquivo.tipo }), { imageOrientation: "from-image" });
    try {
      folhas.set(1, new File([await jpegEmPe(bitmap, rotacao, 2400)], "f1.jpg", { type: "image/jpeg" }));
    } finally {
      bitmap.close();
    }
  }
  return folhas;
}

async function lerErro(r: Response) {
  const d = await r.json().catch(() => ({})) as { erro?: string };
  return new ErroImportacao(d.erro ?? "Não foi possível concluir a importação.", r.status);
}

export interface DadosImportacao {
  clienteId: string;
  chave: string;
  arquivo: Omit<ArquivoRecebido, "bytes">;
  bytes: Uint8Array;
  carne: CarneLido;
  metricas: MetricasLeitura;
  rotacoes: Record<number, Rotacao>;
  itens: ItemRevisao[];
  permitirReimportacao: boolean;
  cpfDivergenteConfirmado: boolean;
}

export async function importarCarne(d: DadosImportacao, aoProgredir?: (p: ProgressoImportacao) => void, sinal?: AbortSignal): Promise<ResultadoImportacao> {
  const aplicar = d.itens.filter((i) => i.acao && i.acao !== "ignorar");
  aoProgredir?.({ mensagem: "Separando as folhas aprovadas…", percentual: 5 });
  const folhas = await separarFolhas({ ...d.arquivo, bytes: d.bytes }, aplicar.map((i) => i.pagina), sinal, d.rotacoes);

  // Lotes pequenos (limite de corpo do servidor).
  const lotes: File[][] = [];
  let atual: File[] = [];
  let tamanho = 0;
  for (const f of folhas.values()) {
    if (atual.length && tamanho + f.size > LOTE_MAXIMO) { lotes.push(atual); atual = []; tamanho = 0; }
    atual.push(f);
    tamanho += f.size;
  }
  if (atual.length) lotes.push(atual);

  const base = `/api/admin/clientes/${encodeURIComponent(d.clienteId)}/leitor-carne`;
  for (let i = 0; i < lotes.length; i += 1) {
    if (sinal?.aborted) throw new DOMException("Importação cancelada", "AbortError");
    aoProgredir?.({ mensagem: `Enviando folhas (${i + 1} de ${lotes.length})…`, percentual: 10 + Math.round((70 * i) / lotes.length) });
    const form = new FormData();
    form.set("sha256", d.arquivo.sha256);
    for (const f of lotes[i]) form.append("folha", f, f.name);
    const r = await fetch(`${base}/folhas`, { method: "POST", body: form, signal: sinal });
    if (!r.ok) throw await lerErro(r);
  }

  aoProgredir?.({ mensagem: "Gravando as parcelas…", percentual: 85 });
  const prefixo = `carnes/${d.clienteId}/${d.arquivo.sha256}/`;
  const itens = d.itens.map((i) => ({
    item: i.id,
    acao: i.acao,
    boletoId: i.boletoId,
    numero: i.numero,
    total: i.total,
    vencimento: i.vencimento,
    valorCentavos: i.valorCentavos,
    identificador: i.linhaDigitavel,
    corrigidos: i.corrigidos,
    arquivoPath: i.acao && i.acao !== "ignorar" ? `${prefixo}${folhas.get(i.pagina)!.name}` : null,
  }));
  const r = await fetch(`${base}/importar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: sinal,
    body: JSON.stringify({
      chave: d.chave,
      cpfDocumento: d.carne.cpf.valor,
      documento: {
        sha256: d.arquivo.sha256,
        nome: d.arquivo.nome,
        tipo: d.arquivo.tipo,
        tamanho: d.arquivo.tamanho,
        paginas: d.carne.paginas,
        tipoDocumento: d.carne.tipoDocumento,
        parser: d.carne.layout.parser,
        fingerprint: d.carne.layout.fingerprint,
        banco: d.carne.banco.valor ?? d.carne.layout.banco,
        confianca: d.carne.confiancaDocumento,
        nivel: d.carne.nivelDocumento,
        alertas: [...new Set(d.carne.alertas.map((a) => a.codigo))],
        metricas: d.metricas,
        permitirReimportacao: d.permitirReimportacao,
        cpfDivergenteConfirmado: d.cpfDivergenteConfirmado,
      },
      itens,
    }),
  });
  if (!r.ok) throw await lerErro(r);
  const { resultado } = await r.json() as { resultado: ResultadoImportacao };
  aoProgredir?.({ mensagem: "Importação concluída", percentual: 100 });
  return resultado;
}
