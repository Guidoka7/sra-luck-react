import { lerCarne } from "@/lib/leitor-carne/leitor";
import type { CarneLido, ClienteReferencia, PaginaTexto, TipoDocumento } from "@/lib/leitor-carne/tipos";
import { PAGINAS_MAXIMAS, ErroArquivo, type ArquivoRecebido } from "./intake";
import { encerrarOcr, lerComOcr } from "./ocr";
import { liberarCanvas, type Rotacao } from "./preprocessamento";
import { abrirPdf, fecharPdf, renderizarPagina, textoNativo, textoSuficiente } from "./pdf";

/**
 * Orquestra a leitura no navegador: texto nativo do PDF → OCR local só nas
 * páginas sem texto → parser determinístico → validações. Processa uma
 * página por vez (seguro no celular), informa o progresso e pode ser
 * cancelado. Nada é gravado aqui: o resultado vai para a revisão humana.
 */

export interface ProgressoLeitura {
  etapa: "abrindo" | "lendo" | "analisando" | "concluido";
  mensagem: string;
  percentual: number;
  pagina?: number;
  totalPaginas?: number;
}

export interface MiniaturaPagina {
  pagina: number;
  /** URL local (blob:) da imagem da página — evidência visual na revisão. */
  url: string;
  largura: number;
  altura: number;
}

/** Métricas sem dado pessoal (observabilidade). */
export interface MetricasLeitura {
  paginas: number;
  paginasTexto: number;
  paginasOcr: number;
  paginasIlegiveis: number;
  tentativasOcr: number;
  duracaoMs: number;
  parcelas: number;
}

export interface ResultadoLeitura {
  arquivo: Omit<ArquivoRecebido, "bytes">;
  carne: CarneLido;
  miniaturas: MiniaturaPagina[];
  metricas: MetricasLeitura;
  /** Páginas lidas giradas (foto/escaneado de lado ou de cabeça para baixo). */
  rotacoes: Record<number, Rotacao>;
  /** Libera as miniaturas da memória (chamar ao fechar a revisão). */
  liberar: () => void;
}

export interface OpcoesLeitura {
  cliente?: ClienteReferencia | null;
  sinal?: AbortSignal;
  aoProgredir?: (p: ProgressoLeitura) => void;
}

const LARGURA_MINIATURA = 1000;
const LARGURA_OCR = 2400;

function verificarCancelamento(sinal?: AbortSignal) {
  if (sinal?.aborted) throw new DOMException("Leitura cancelada", "AbortError");
}

function paraBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao gerar a miniatura"))), "image/jpeg", 0.72));
}

/** Desenha a imagem girada (sentido horário) num canvas de largura ≤ larguraMax. */
export function desenharGirada(fonte: HTMLCanvasElement | ImageBitmap, rotacao: Rotacao, larguraMax: number): HTMLCanvasElement {
  const deitada = rotacao === 90 || rotacao === 270;
  const w0 = deitada ? fonte.height : fonte.width;
  const h0 = deitada ? fonte.width : fonte.height;
  const escala = Math.min(1, larguraMax / w0);
  const c = document.createElement("canvas");
  c.width = Math.round(w0 * escala);
  c.height = Math.round(h0 * escala);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotacao * Math.PI) / 180);
  ctx.drawImage(fonte, (-fonte.width * escala) / 2, (-fonte.height * escala) / 2, fonte.width * escala, fonte.height * escala);
  return c;
}

async function miniatura(fonte: HTMLCanvasElement | ImageBitmap, pagina: number, rotacao: Rotacao = 0): Promise<MiniaturaPagina> {
  const c = desenharGirada(fonte, rotacao, LARGURA_MINIATURA);
  const blob = await paraBlob(c);
  const r = { pagina, url: URL.createObjectURL(blob), largura: c.width, altura: c.height };
  liberarCanvas(c);
  return r;
}

function hojeIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function lerDocumento(arquivo: ArquivoRecebido, opcoes: OpcoesLeitura = {}): Promise<ResultadoLeitura> {
  const { sinal, aoProgredir } = opcoes;
  const inicio = performance.now();
  const miniaturas: MiniaturaPagina[] = [];
  const liberar = () => { for (const m of miniaturas) URL.revokeObjectURL(m.url); };
  const paginas: PaginaTexto[] = [];
  const ilegiveis: number[] = [];
  const rotacoes: Record<number, Rotacao> = {};
  let tentativasOcr = 0;
  let totalPaginas = 1;
  let tipoDocumento: TipoDocumento = "IMAGE";

  // Cancelar interrompe o OCR em andamento (o motor é reiniciado na próxima leitura).
  const aoCancelar = () => { void encerrarOcr(); };
  sinal?.addEventListener("abort", aoCancelar);

  const progresso = (p: ProgressoLeitura) => aoProgredir?.(p);
  const faixaPaginas = (i: number) => Math.round(20 + (55 * i) / Math.max(1, totalPaginas));

  try {
    progresso({ etapa: "abrindo", mensagem: "Abrindo o documento…", percentual: 5 });
    if (arquivo.tipo === "application/pdf") {
      let pdf;
      try {
        pdf = await abrirPdf(arquivo.bytes);
      } catch {
        throw new ErroArquivo("Não foi possível abrir o PDF. Ele pode estar corrompido ou protegido por senha.");
      }
      try {
        totalPaginas = pdf.numPages;
        if (totalPaginas > PAGINAS_MAXIMAS) throw new ErroArquivo(`O PDF tem ${totalPaginas} páginas; o limite é ${PAGINAS_MAXIMAS}. Divida o carnê em partes.`);
        progresso({ etapa: "lendo", mensagem: `Documento com ${totalPaginas} página${totalPaginas > 1 ? "s" : ""}`, percentual: 20, totalPaginas });
        let comTexto = 0;
        let comOcr = 0;
        for (let n = 1; n <= totalPaginas; n += 1) {
          verificarCancelamento(sinal);
          const pagina = await pdf.getPage(n);
          const linhas = await textoNativo(pagina).catch(() => []);
          const precisaOcr = !textoSuficiente(linhas);
          progresso({ etapa: "lendo", mensagem: precisaOcr ? `Reconhecendo o texto da página ${n} de ${totalPaginas}…` : `Lendo a página ${n} de ${totalPaginas}…`, percentual: faixaPaginas(n - 1), pagina: n, totalPaginas });
          const imagem = await renderizarPagina(pagina, precisaOcr ? LARGURA_OCR : LARGURA_MINIATURA);
          try {
            if (!precisaOcr) {
              miniaturas.push(await miniatura(imagem, n));
              comTexto += 1;
              paginas.push({ pagina: n, fonte: "PDF_TEXT", linhas, confiancaOcr: null, qualidadeImagem: null });
            } else {
              comOcr += 1;
              const r = await lerComOcr(imagem, sinal);
              tentativasOcr += r.tentativas;
              if (r.rotacao) rotacoes[n] = r.rotacao;
              miniaturas.push(await miniatura(imagem, n, r.rotacao));
              if (!r.linhas.length) ilegiveis.push(n);
              paginas.push({ pagina: n, fonte: "OCR", linhas: r.linhas, confiancaOcr: r.confianca, qualidadeImagem: r.qualidadeImagem });
            }
          } finally {
            liberarCanvas(imagem);
            pagina.cleanup();
          }
        }
        tipoDocumento = comOcr === 0 ? "PDF_TEXT" : comTexto === 0 ? "PDF_SCANNED" : "MIXED_PDF";
      } finally {
        await fecharPdf(pdf);
      }
    } else {
      progresso({ etapa: "lendo", mensagem: "Reconhecendo o texto da imagem…", percentual: 20, pagina: 1, totalPaginas: 1 });
      let bitmap: ImageBitmap;
      try {
        // imageOrientation respeita a orientação EXIF de fotos do celular.
        bitmap = await createImageBitmap(new Blob([arquivo.bytes as BlobPart], { type: arquivo.tipo }), { imageOrientation: "from-image" });
      } catch {
        throw new ErroArquivo("Não foi possível abrir a imagem.");
      }
      try {
        const r = await lerComOcr(bitmap, sinal);
        tentativasOcr += r.tentativas;
        if (r.rotacao) rotacoes[1] = r.rotacao;
        miniaturas.push(await miniatura(bitmap, 1, r.rotacao));
        if (!r.linhas.length) ilegiveis.push(1);
        paginas.push({ pagina: 1, fonte: "OCR", linhas: r.linhas, confiancaOcr: r.confianca, qualidadeImagem: r.qualidadeImagem });
      } finally {
        bitmap.close();
      }
    }

    verificarCancelamento(sinal);
    progresso({ etapa: "analisando", mensagem: "Conferindo parcelas, datas e valores…", percentual: 80 });
    await new Promise((r) => setTimeout(r, 0));
    const carne = lerCarne(paginas, { tipoDocumento, totalPaginas, paginasIlegiveis: ilegiveis, cliente: opcoes.cliente ?? null, referenciaIso: hojeIso() });
    progresso({ etapa: "concluido", mensagem: "Leitura concluída", percentual: 100 });

    const { bytes: _bytes, ...semBytes } = arquivo;
    void _bytes;
    return {
      arquivo: semBytes,
      carne,
      miniaturas,
      rotacoes,
      liberar,
      metricas: {
        paginas: totalPaginas,
        paginasTexto: carne.paginasTexto,
        paginasOcr: carne.paginasOcr,
        paginasIlegiveis: ilegiveis.length,
        tentativasOcr,
        duracaoMs: Math.round(performance.now() - inicio),
        parcelas: carne.parcelas.length,
      },
    };
  } catch (erro) {
    liberar();
    throw erro;
  } finally {
    sinal?.removeEventListener("abort", aoCancelar);
  }
}
