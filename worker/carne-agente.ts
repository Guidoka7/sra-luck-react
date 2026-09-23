import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { consolidarLeituraExterna, paginaVazia, type PaginaLida } from "./carne-leitura";
import type { Env } from "./supabase";

/**
 * Agente de leitura de carnês (Claude). Só é acionado para as folhas em que a
 * leitura do texto nativo não encontrou uma linha digitável válida — PDF
 * escaneado, texto desenhado como imagem, layout fora do padrão.
 *
 * O agente NÃO decide o vínculo: ele só transcreve o que está impresso. Toda
 * linha digitável que ele devolve passa pela validação FEBRABAN (DVs); se não
 * conferir, a folha não é anexada automaticamente e vai para revisão.
 *
 * Configuração (secrets do Worker): ANTHROPIC_API_KEY (obrigatória para ligar
 * o agente) e CARNE_AGENTE_MODELO (opcional, padrão claude-opus-5).
 */

const MODELO_PADRAO = "claude-opus-5";
const FOLHAS_POR_LOTE = 20;
const LOTES_EM_PARALELO = 3;

const FERRAMENTA: Anthropic.Beta.BetaTool = {
  name: "registrar_folhas_do_carne",
  description: "Registra, para cada folha (página) do PDF recebido, os dados do boleto impressos nela, exatamente como aparecem.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["folhas"],
    properties: {
      folhas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["folha", "legivel", "boletos_na_folha", "linha_digitavel", "valor", "vencimento", "parcela_numero", "parcela_total", "nosso_numero", "numero_documento", "nome_pagador", "cpf_pagador"],
          properties: {
            folha: { type: "integer", description: "Número da folha dentro deste PDF, começando em 1." },
            legivel: { type: "boolean", description: "false quando a folha está ilegível, em branco ou não é um boleto." },
            boletos_na_folha: { type: "integer", description: "Quantos boletos DIFERENTES há na folha (vias repetidas do mesmo boleto contam 1)." },
            linha_digitavel: { type: ["string", "null"], description: "Linha digitável completa (47 dígitos), só números, sem espaços nem pontos. null se não estiver legível por completo." },
            valor: { type: ["number", "null"], description: "Valor do documento em reais (ex.: 833.33)." },
            vencimento: { type: ["string", "null"], description: "Data de vencimento no formato AAAA-MM-DD." },
            parcela_numero: { type: ["integer", "null"], description: "Número da parcela impresso (ex.: 2 em 'Parcela 02/60')." },
            parcela_total: { type: ["integer", "null"], description: "Total de parcelas impresso (ex.: 60 em 'Parcela 02/60')." },
            nosso_numero: { type: ["string", "null"] },
            numero_documento: { type: ["string", "null"] },
            nome_pagador: { type: ["string", "null"] },
            cpf_pagador: { type: ["string", "null"], description: "CPF do pagador, só os 11 dígitos." },
          },
        },
      },
    },
  },
};

const INSTRUCOES = [
  "Você é o leitor de carnês de boletos bancários da Sra. Luck. O PDF recebido é um carnê em que cada folha contém um boleto de uma parcela da cliente.",
  "Transcreva os dados de TODAS as folhas, na ordem, chamando a ferramenta registrar_folhas_do_carne uma única vez.",
  "Copie os números exatamente como estão impressos. Nunca complete, estime ou corrija dígitos: se algum dígito da linha digitável não estiver legível, devolva linha_digitavel null.",
  "Uma mesma folha costuma trazer o mesmo boleto em duas vias (recibo do pagador e ficha de compensação); isso conta como 1 boleto.",
].join("\n");

function codificarBase64(bytes: Uint8Array) {
  let binario = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) binario += String.fromCharCode(...bytes.subarray(i, i + passo));
  return btoa(binario);
}

export function agenteCarneDisponivel(env: Env) {
  return Boolean(env.ANTHROPIC_API_KEY);
}

type FolhaAgente = {
  folha: number; legivel: boolean; boletos_na_folha: number; linha_digitavel: string | null; valor: number | null; vencimento: string | null;
  parcela_numero: number | null; parcela_total: number | null; nosso_numero: string | null; numero_documento: string | null;
  nome_pagador: string | null; cpf_pagador: string | null;
};

async function lerLote(client: Anthropic, modelo: string, documento: PDFDocument, paginas: number[], referenciaIso: string): Promise<PaginaLida[]> {
  const lote = await PDFDocument.create();
  const copiadas = await lote.copyPages(documento, paginas.map((p) => p - 1));
  copiadas.forEach((pagina) => lote.addPage(pagina));
  const base64 = codificarBase64(await lote.save());

  const stream = client.beta.messages.stream({
    model: modelo,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high" },
    system: INSTRUCOES,
    tools: [FERRAMENTA],
    tool_choice: { type: "auto" },
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: `Este PDF tem ${paginas.length} folha(s). Registre todas.` },
      ],
    }],
  });
  const resposta = await stream.finalMessage();
  if (resposta.stop_reason === "refusal") throw new Error("O agente recusou a leitura deste lote.");
  const chamada = resposta.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === FERRAMENTA.name);
  if (!chamada) throw new Error("O agente não registrou a leitura das folhas.");
  const folhas = ((chamada?.input as { folhas?: FolhaAgente[] } | undefined)?.folhas ?? []);

  return paginas.map((paginaOriginal, indice) => {
    const f = folhas.find((item) => item.folha === indice + 1);
    const lida = paginaVazia(paginaOriginal);
    if (!f) { lida.observacoes.push("agente_nao_retornou_a_folha"); return lida; }
    if (!f.legivel) { lida.fonte = "agente"; lida.observacoes.push("agente_folha_ilegivel"); return lida; }
    lida.fonte = "agente";
    lida.boletosNaPagina = Math.max(0, Math.trunc(f.boletos_na_folha));
    if (lida.boletosNaPagina > 1) lida.observacoes.push("mais_de_um_boleto_na_folha");
    lida.valor = typeof f.valor === "number" && f.valor > 0 ? Math.round(f.valor * 100) / 100 : null;
    lida.vencimento = f.vencimento && /^\d{4}-\d{2}-\d{2}$/.test(f.vencimento) ? f.vencimento : null;
    if (f.parcela_numero && f.parcela_total && f.parcela_numero <= f.parcela_total) {
      lida.numeroParcela = f.parcela_numero;
      lida.totalParcelas = f.parcela_total;
    }
    lida.nossoNumero = f.nosso_numero?.toUpperCase().replace(/[^0-9A-Z]/g, "") || null;
    lida.numeroDocumento = f.numero_documento?.toUpperCase().replace(/[^0-9A-Z]/g, "") || null;
    lida.nomePagador = f.nome_pagador?.trim() || null;
    const cpf = String(f.cpf_pagador ?? "").replace(/\D/g, "");
    lida.cpfs = cpf.length === 11 ? [cpf] : [];
    return lida.boletosNaPagina > 1 ? lida : consolidarLeituraExterna(lida, f.linha_digitavel, referenciaIso);
  });
}

/**
 * Lê as folhas indicadas (números 1-based do PDF original) com o agente, em
 * lotes paralelos. Falha de um lote não derruba a importação: as folhas desse
 * lote voltam sem leitura e seguem para revisão.
 */
export async function lerFolhasComAgente(env: Env, pdf: Uint8Array, paginas: number[], referenciaIso: string): Promise<{ folhas: PaginaLida[]; falhas: number }> {
  if (!env.ANTHROPIC_API_KEY || paginas.length === 0) return { folhas: [], falhas: 0 };
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  const modelo = env.CARNE_AGENTE_MODELO?.trim() || MODELO_PADRAO;
  const documento = await PDFDocument.load(pdf);
  const lotes: number[][] = [];
  for (let i = 0; i < paginas.length; i += FOLHAS_POR_LOTE) lotes.push(paginas.slice(i, i + FOLHAS_POR_LOTE));

  const folhas: PaginaLida[] = [];
  let falhas = 0;
  for (let i = 0; i < lotes.length; i += LOTES_EM_PARALELO) {
    const resultados = await Promise.allSettled(lotes.slice(i, i + LOTES_EM_PARALELO).map((lote) => lerLote(client, modelo, documento, lote, referenciaIso)));
    resultados.forEach((resultado, indice) => {
      const lote = lotes[i + indice];
      if (resultado.status === "fulfilled") { folhas.push(...resultado.value); return; }
      falhas += 1;
      const motivo = resultado.reason instanceof Anthropic.APIError ? `agente_indisponivel_${resultado.reason.status ?? "rede"}` : "agente_falhou";
      console.error("Agente de carnê falhou em um lote:", resultado.reason instanceof Error ? resultado.reason.message : motivo);
      for (const pagina of lote) { const vazia = paginaVazia(pagina); vazia.observacoes.push(motivo); folhas.push(vazia); }
    });
  }
  return { folhas, falhas };
}
