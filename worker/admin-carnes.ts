import { PDFDocument } from "pdf-lib";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin } from "./session";
import { extrairDadosBoleto, pontuarCandidatos, type BoletoCandidato } from "./pdf-boleto-parser";

const BUCKET = "boletos-clientes";
const TAMANHO_MAXIMO = 20 * 1024 * 1024;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function exigirAdmin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const token = getCookie(request, "admin_session");
  const session = await verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET);
  return session ?? null;
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Carnês (por instituição financeira) e importação de carnê em PDF.
 *
 * A importação extrai texto NATIVO de cada página (vencimento, valor,
 * número da parcela, linha digitável — ver worker/pdf-boleto-parser.ts) e
 * usa esses dados, não a ordem da página, como evidência principal para
 * sugerir a qual parcela cada página corresponde. Ordem de página é só um
 * sinal auxiliar de baixo peso. Quando a extração não é suficiente (PDF
 * escaneado como imagem, campos ilegíveis, CPF divergente), a página fica
 * com status_vinculacao="revisar" e NENHUMA sugestão de vínculo é feita —
 * a confirmação humana decide manualmente. Nenhum vínculo é aplicado aqui;
 * isso só acontece em POST .../vincular, sempre por ação explícita.
 */
export async function adminCarnes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/clientes/") && !path.startsWith("/api/admin/importacoes-boletos/")) return null;

  const session = await exigirAdmin(request, env);
  if (!session) return json({ erro: "Sessão administrativa expirada." }, 401);
  const db = createServiceSupabaseClient(env);

  const carnesCliente = path.match(/^\/api\/admin\/clientes\/([^/]+)\/carnes$/);
  if (carnesCliente) {
    const clienteId = decodeURIComponent(carnesCliente[1]);

    if (request.method === "GET") {
      const { data, error } = await db.from("carnes").select("*").eq("cliente_id", clienteId).order("data_geracao", { ascending: false });
      if (error) return json({ erro: error.message }, 500);
      return json({ carnes: data ?? [] });
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const instituicao = String(body.instituicaoFinanceira ?? "").trim();
      const identificador = String(body.identificadorExterno ?? "").trim();
      const dataGeracao = String(body.dataGeracao ?? "");
      const quantidadeParcelas = Number(body.quantidadeParcelas ?? 0);
      const valorParcela = Number(body.valorParcela ?? 0);
      const valorTotal = Number(body.valorTotal ?? 0);
      if (!instituicao || !identificador) return json({ erro: "Informe a instituição financeira e o identificador do carnê." }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataGeracao)) return json({ erro: "Informe a data de geração do carnê." }, 400);
      if (quantidadeParcelas <= 0 || valorParcela < 0 || valorTotal < 0) return json({ erro: "Valores do carnê inválidos." }, 400);

      const { data, error } = await db.from("carnes").insert({
        cliente_id: clienteId,
        instituicao_financeira: instituicao,
        identificador_externo: identificador,
        data_geracao: dataGeracao,
        quantidade_parcelas: quantidadeParcelas,
        valor_parcela: valorParcela,
        valor_total: valorTotal,
      }).select("*").single();
      if (error) return json({ erro: error.code === "23505" ? "Já existe um carnê com esse identificador para esta instituição." : error.message }, 400);

      await db.from("logs_alteracoes").insert({
        usuario: session.adminId,
        acao: "criou_carne",
        entidade: "clientes",
        entidade_id: clienteId,
        detalhes: { carneId: data.id, instituicao, identificador, quantidadeParcelas },
      });
      return json({ carne: data }, 201);
    }
  }

  const importacoesCliente = path.match(/^\/api\/admin\/clientes\/([^/]+)\/importacoes-boletos$/);
  if (importacoesCliente) {
    const clienteId = decodeURIComponent(importacoesCliente[1]);

    if (request.method === "GET") {
      const { data, error } = await db.from("importacoes_boletos").select("*").eq("cliente_id", clienteId).order("created_at", { ascending: false });
      if (error) return json({ erro: error.message }, 500);
      return json({ importacoes: data ?? [] });
    }

    if (request.method === "POST") {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return json({ erro: "Requisição inválida." }, 400);
      }
      const arquivo = form.get("arquivo");
      if (!(arquivo instanceof File)) return json({ erro: "Arquivo não fornecido." }, 400);
      if (arquivo.type !== "application/pdf") return json({ erro: "O carnê precisa ser um arquivo PDF." }, 400);
      if (arquivo.size > TAMANHO_MAXIMO) return json({ erro: "Arquivo maior que 20MB." }, 400);
      const instituicao = String(form.get("instituicaoFinanceira") ?? "").trim();
      const carneId = form.get("carneId") ? String(form.get("carneId")) : null;

      const bytes = new Uint8Array(await arquivo.arrayBuffer());

      let documento: PDFDocument;
      try {
        documento = await PDFDocument.load(bytes);
      } catch {
        return json({ erro: "Não foi possível ler o PDF enviado. Verifique se o arquivo não está corrompido." }, 400);
      }
      const totalPaginas = documento.getPageCount();
      if (totalPaginas === 0) return json({ erro: "O PDF enviado não tem páginas." }, 400);

      // Cada página vira um arquivo próprio (mesma técnica do protótipo legado que
      // dividia o carnê com pdf-lib); o hash é calculado por página, não do arquivo
      // combinado, para que a constraint de unicidade detecte reimportação de uma
      // página específica já processada antes.
      const paginas: { bytes: Uint8Array; sha256: string }[] = [];
      for (let indice = 0; indice < totalPaginas; indice += 1) {
        const paginaDoc = await PDFDocument.create();
        const [pagina] = await paginaDoc.copyPages(documento, [indice]);
        paginaDoc.addPage(pagina);
        const paginaBytes = await paginaDoc.save();
        paginas.push({ bytes: paginaBytes, sha256: await sha256(paginaBytes) });
      }

      const { data: duplicadas } = await db.from("importacoes_boletos").select("arquivo_sha256").in("arquivo_sha256", paginas.map((p) => p.sha256));
      if (duplicadas && duplicadas.length > 0) {
        return json({ erro: `${duplicadas.length} página(s) deste PDF já foram importadas anteriormente.` }, 409);
      }

      const [{ data: boletosCliente }, { data: clienteRow }] = await Promise.all([
        db.from("boletos").select("id,numero_parcela,total_parcelas,valor,data_vencimento,boleto_url").eq("cliente_id", clienteId).order("numero_parcela", { ascending: true }),
        db.from("clientes").select("cpf").eq("id", clienteId).maybeSingle(),
      ]);
      const candidatos: BoletoCandidato[] = (boletosCliente ?? []).map((b: any) => ({ id: b.id, numero_parcela: Number(b.numero_parcela), valor: Number(b.valor), data_vencimento: b.data_vencimento }));

      const importacoes: any[] = [];
      for (let indice = 0; indice < totalPaginas; indice += 1) {
        const numeroPagina = indice + 1;
        const { bytes: paginaBytes, sha256: paginaSha256 } = paginas[indice];
        const caminho = `importacoes/${clienteId}/${paginaSha256}.pdf`;

        const { error: erroUpload } = await db.storage.from(BUCKET).upload(caminho, paginaBytes, { contentType: "application/pdf", upsert: false });
        if (erroUpload) return json({ erro: `Falha ao salvar a página ${numeroPagina}: ${erroUpload.message}` }, 500);

        const dadosExtraidos = await extrairDadosBoleto(paginaBytes);
        const sugestao = pontuarCandidatos(dadosExtraidos, candidatos, numeroPagina, clienteRow?.cpf ?? null);

        importacoes.push({
          cliente_id: clienteId,
          carne_id: carneId,
          instituicao_financeira: instituicao || null,
          numero_parcela: dadosExtraidos.numeroParcela ?? null,
          identificador_externo: dadosExtraidos.linhaDigitavel,
          linha_digitavel: dadosExtraidos.linhaDigitavel,
          valor_extraido: dadosExtraidos.valor,
          vencimento_extraido: dadosExtraidos.vencimento,
          cpf_pagador_extraido: dadosExtraidos.cpf,
          dados_extraidos: { valor: dadosExtraidos.valor, vencimento: dadosExtraidos.vencimento, numeroParcela: dadosExtraidos.numeroParcela, linhaDigitavel: dadosExtraidos.linhaDigitavel, cpf: dadosExtraidos.cpf },
          arquivo_nome: `${arquivo.name} (página ${numeroPagina}/${totalPaginas})`,
          arquivo_mime: "application/pdf",
          arquivo_tamanho: paginaBytes.byteLength,
          arquivo_sha256: paginaSha256,
          arquivo_storage_path: caminho,
          status: sugestao.statusVinculacao === "revisar" ? "erro" : "aguardando_confirmacao",
          erro_detalhes: sugestao.statusVinculacao === "revisar" ? "Não foi possível extrair dados suficientes do PDF para sugerir a parcela com segurança." : null,
          cliente_sugerido_id: sugestao.boletoId ? clienteId : null,
          boleto_sugerido_id: sugestao.boletoId,
          pontuacao_confianca: sugestao.pontuacaoConfianca,
          nivel_confianca: sugestao.nivelConfianca,
          status_vinculacao: sugestao.statusVinculacao,
          analise_detalhada: { totalPaginasArquivo: totalPaginas, totalParcelasCliente: candidatos.length, numeroPagina, motivos: sugestao.motivos },
        });
      }

      const { data: inseridas, error: erroInsert } = await db.from("importacoes_boletos").insert(importacoes).select("*");
      if (erroInsert) return json({ erro: erroInsert.message }, 500);

      await db.from("logs_alteracoes").insert({
        usuario: session.adminId,
        acao: "importou_carne_pdf",
        entidade: "clientes",
        entidade_id: clienteId,
        detalhes: { arquivo: arquivo.name, totalPaginas, totalParcelasCliente: candidatos.length, importacaoIds: (inseridas ?? []).map((i: any) => i.id) },
      });

      return json({ importacoes: inseridas ?? [] }, 201);
    }
  }

  const vincular = path.match(/^\/api\/admin\/importacoes-boletos\/([^/]+)\/vincular$/);
  if (vincular && request.method === "POST") {
    const id = decodeURIComponent(vincular[1]);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    const { data: importacao, error: erroImportacao } = await db.from("importacoes_boletos").select("*").eq("id", id).maybeSingle();
    if (erroImportacao) return json({ erro: erroImportacao.message }, 500);
    if (!importacao) return json({ erro: "Importação não encontrada." }, 404);
    if (importacao.status_vinculacao === "vinculado") return json({ erro: "Esta página já foi vinculada." }, 409);

    const boletoId = String(body.boletoId ?? importacao.boleto_sugerido_id ?? "");
    if (!boletoId) return json({ erro: "Selecione a parcela correspondente para vincular." }, 400);

    const { data: boleto, error: erroBoleto } = await db.from("boletos").select("id,cliente_id,numero_parcela").eq("id", boletoId).maybeSingle();
    if (erroBoleto) return json({ erro: erroBoleto.message }, 500);
    if (!boleto || boleto.cliente_id !== importacao.cliente_id) return json({ erro: "Parcela inválida para esta cliente." }, 400);

    const { error: erroUpdateBoleto } = await db.from("boletos").update({ boleto_url: importacao.arquivo_storage_path }).eq("id", boletoId);
    if (erroUpdateBoleto) return json({ erro: erroUpdateBoleto.message }, 500);

    const { data: atualizada, error: erroUpdate } = await db.from("importacoes_boletos").update({
      status: "vinculado",
      status_vinculacao: "vinculado",
      cliente_vinculado_id: importacao.cliente_id,
      carne_vinculado_id: importacao.carne_id,
      boleto_vinculado_id: boletoId,
    }).eq("id", id).select("*").single();
    if (erroUpdate) return json({ erro: erroUpdate.message }, 500);

    await db.from("logs_alteracoes").insert({
      usuario: session.adminId,
      acao: "vinculou_boleto_importado",
      entidade: "clientes",
      entidade_id: importacao.cliente_id,
      detalhes: { importacaoId: id, boletoId, numeroParcela: boleto.numero_parcela },
    });

    return json({ importacao: atualizada });
  }

  const ignorar = path.match(/^\/api\/admin\/importacoes-boletos\/([^/]+)\/ignorar$/);
  if (ignorar && request.method === "POST") {
    const id = decodeURIComponent(ignorar[1]);
    const { data, error } = await db.from("importacoes_boletos").update({ status_vinculacao: "ignorado" }).eq("id", id).select("*").single();
    if (error) return json({ erro: error.message }, 400);
    return json({ importacao: data });
  }

  return null;
}
