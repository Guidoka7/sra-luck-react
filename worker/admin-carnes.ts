import { publicError } from "./http-security";
import { PDFDocument } from "pdf-lib";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
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

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
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
 * A importação extrai texto NATIVO de cada página: vencimento, valor, número
 * da parcela, linha digitável/código de barras, nosso número, documento,
 * pagador e CPF. Esses sinais são comparados aos dados persistidos da parcela.
 * Ordem de página é apenas evidência auxiliar de peso mínimo e NUNCA desempata
 * um caso ambíguo. PDF escaneado/ilegível, CPF divergente ou mais de um
 * candidato plausível => status_vinculacao="revisar" e boleto_sugerido_id=null.
 *
 * Nenhum vínculo é aplicado durante a importação. O vínculo real só ocorre em
 * POST .../vincular, sempre por ação humana explícita.
 */
export async function adminCarnes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/clientes/") && !path.startsWith("/api/admin/importacoes-boletos/")) return null;

  const session = await exigirAdmin(request, env);
  if (!session) return json({ erro: "Sessão administrativa expirada." }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  let atorFinanceiro: string | null = null;
  if (request.method !== "GET") {
    const colaborador = await buscarColaboradorAdminAtivo(session.adminId, env).catch(() => null);
    if (!colaborador || !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL)) {
      return json({ erro: "Seu papel não tem permissão para alterar carnês ou vínculos financeiros." }, 403);
    }
    atorFinanceiro = colaborador.id;
  }
  const db = createServiceSupabaseClient(env);

  const carnesCliente = path.match(/^\/api\/admin\/clientes\/([^/]+)\/carnes$/);
  if (carnesCliente) {
    const clienteId = decodeURIComponent(carnesCliente[1]);

    if (request.method === "GET") {
      const { data, error } = await db.from("carnes").select("*").eq("cliente_id", clienteId).order("data_geracao", { ascending: false });
      if (error) return json({ erro: publicError(error) }, 500);
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
      if (error) return json({ erro: error.code === "23505" ? "Já existe um carnê com esse identificador para esta instituição." : publicError(error) }, 400);

      await db.from("logs_alteracoes").insert({
        usuario: atorFinanceiro ?? session.adminId,
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
      if (error) return json({ erro: publicError(error) }, 500);
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

      // Cada página vira um arquivo próprio e recebe hash individual para que a
      // reimportação de uma página já processada seja detectada com segurança.
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
        db.from("boletos")
          .select("id,numero_parcela,total_parcelas,valor,data_vencimento,boleto_url,identificador_externo,instituicao_financeira")
          .eq("cliente_id", clienteId)
          .order("numero_parcela", { ascending: true }),
        db.from("clientes").select("cpf").eq("id", clienteId).maybeSingle(),
      ]);
      const candidatos: BoletoCandidato[] = (boletosCliente ?? []).map((b: any) => ({
        id: b.id,
        numero_parcela: Number(b.numero_parcela),
        valor: Number(b.valor),
        data_vencimento: b.data_vencimento,
        identificador_externo: b.identificador_externo ?? null,
        instituicao_financeira: b.instituicao_financeira ?? null,
      }));

      const importacoes: any[] = [];
      for (let indice = 0; indice < totalPaginas; indice += 1) {
        const numeroPagina = indice + 1;
        const { bytes: paginaBytes, sha256: paginaSha256 } = paginas[indice];
        const caminho = `importacoes/${clienteId}/${paginaSha256}.pdf`;

        const { error: erroUpload } = await db.storage.from(BUCKET).upload(caminho, paginaBytes, { contentType: "application/pdf", upsert: false });
        if (erroUpload) return json({ erro: publicError(erroUpload, "Não foi possível salvar a página do boleto.") }, 500);

        const dadosExtraidos = await extrairDadosBoleto(paginaBytes);
        const sugestao = pontuarCandidatos(dadosExtraidos, candidatos, numeroPagina, clienteRow?.cpf ?? null, instituicao || null);
        const identificadorExtraido = dadosExtraidos.linhaDigitavel
          ?? dadosExtraidos.codigoBarras
          ?? dadosExtraidos.nossoNumero
          ?? dadosExtraidos.numeroDocumento
          ?? null;

        importacoes.push({
          cliente_id: clienteId,
          carne_id: carneId,
          instituicao_financeira: instituicao || null,
          numero_parcela: dadosExtraidos.numeroParcela ?? null,
          nosso_numero: dadosExtraidos.nossoNumero,
          numero_documento: dadosExtraidos.numeroDocumento,
          identificador_externo: identificadorExtraido,
          linha_digitavel: dadosExtraidos.linhaDigitavel,
          codigo_barras: dadosExtraidos.codigoBarras,
          nome_pagador_extraido: dadosExtraidos.nomePagador,
          valor_extraido: dadosExtraidos.valor,
          vencimento_extraido: dadosExtraidos.vencimento,
          cpf_pagador_extraido: dadosExtraidos.cpf,
          dados_extraidos: {
            valor: dadosExtraidos.valor,
            vencimento: dadosExtraidos.vencimento,
            numeroParcela: dadosExtraidos.numeroParcela,
            linhaDigitavel: dadosExtraidos.linhaDigitavel,
            codigoBarras: dadosExtraidos.codigoBarras,
            nossoNumero: dadosExtraidos.nossoNumero,
            numeroDocumento: dadosExtraidos.numeroDocumento,
            nomePagador: dadosExtraidos.nomePagador,
            cpf: dadosExtraidos.cpf,
          },
          arquivo_nome: `${arquivo.name} (página ${numeroPagina}/${totalPaginas})`,
          arquivo_mime: "application/pdf",
          arquivo_tamanho: paginaBytes.byteLength,
          arquivo_sha256: paginaSha256,
          arquivo_storage_path: caminho,
          status: sugestao.statusVinculacao === "revisar" ? "erro" : "aguardando_confirmacao",
          erro_detalhes: sugestao.statusVinculacao === "revisar"
            ? (sugestao.motivos.includes("mais_de_um_candidato_plausivel")
              ? "Mais de uma parcela é plausível; revise e escolha manualmente."
              : "Não foi possível extrair dados suficientes do PDF para sugerir a parcela com segurança.")
            : null,
          cliente_sugerido_id: sugestao.boletoId ? clienteId : null,
          boleto_sugerido_id: sugestao.boletoId,
          pontuacao_confianca: sugestao.pontuacaoConfianca,
          nivel_confianca: sugestao.nivelConfianca,
          status_vinculacao: sugestao.statusVinculacao,
          analise_detalhada: { totalPaginasArquivo: totalPaginas, totalParcelasCliente: candidatos.length, numeroPagina, motivos: sugestao.motivos },
        });
      }

      const { data: inseridas, error: erroInsert } = await db.from("importacoes_boletos").insert(importacoes).select("*");
      if (erroInsert) return json({ erro: publicError(erroInsert) }, 500);

      await db.from("logs_alteracoes").insert({
        usuario: atorFinanceiro ?? session.adminId,
        acao: "importou_carne_pdf",
        entidade: "clientes",
        entidade_id: clienteId,
        detalhes: { tipo: "application/pdf", totalPaginas, totalParcelasCliente: candidatos.length, importacaoIds: (inseridas ?? []).map((i: any) => i.id) },
      });

      return json({ importacoes: inseridas ?? [] }, 201);
    }
  }

  const vincular = path.match(/^\/api\/admin\/importacoes-boletos\/([^/]+)\/vincular$/);
  if (vincular && request.method === "POST") {
    const id = decodeURIComponent(vincular[1]);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    const { data: importacao, error: erroImportacao } = await db.from("importacoes_boletos").select("*").eq("id", id).maybeSingle();
    if (erroImportacao) return json({ erro: publicError(erroImportacao) }, 500);
    if (!importacao) return json({ erro: "Importação não encontrada." }, 404);
    if (importacao.status_vinculacao === "vinculado") return json({ erro: "Esta página já foi vinculada." }, 409);

    const boletoId = String(body.boletoId ?? importacao.boleto_sugerido_id ?? "");
    if (!boletoId) return json({ erro: "Selecione a parcela correspondente para vincular." }, 400);

    const { data: boleto, error: erroBoleto } = await db.from("boletos")
      .select("id,cliente_id,numero_parcela,carne_id,instituicao_financeira,identificador_externo")
      .eq("id", boletoId)
      .maybeSingle();
    if (erroBoleto) return json({ erro: publicError(erroBoleto) }, 500);
    if (!boleto || boleto.cliente_id !== importacao.cliente_id) return json({ erro: "Parcela inválida para esta cliente." }, 400);

    const identificador = importacao.linha_digitavel
      ?? importacao.codigo_barras
      ?? importacao.nosso_numero
      ?? importacao.numero_documento
      ?? importacao.identificador_externo
      ?? boleto.identificador_externo
      ?? null;
    const { error: erroUpdateBoleto } = await db.from("boletos").update({
      boleto_url: importacao.arquivo_storage_path,
      carne_id: importacao.carne_id ?? boleto.carne_id ?? null,
      instituicao_financeira: importacao.instituicao_financeira ?? boleto.instituicao_financeira ?? null,
      identificador_externo: identificador,
    }).eq("id", boletoId);
    if (erroUpdateBoleto) return json({ erro: publicError(erroUpdateBoleto) }, 500);

    const { data: atualizada, error: erroUpdate } = await db.from("importacoes_boletos").update({
      status: "vinculado",
      status_vinculacao: "vinculado",
      cliente_vinculado_id: importacao.cliente_id,
      carne_vinculado_id: importacao.carne_id,
      boleto_vinculado_id: boletoId,
    }).eq("id", id).select("*").single();
    if (erroUpdate) return json({ erro: publicError(erroUpdate) }, 500);

    await db.from("logs_alteracoes").insert({
      usuario: atorFinanceiro ?? session.adminId,
      acao: "vinculou_boleto_importado",
      entidade: "clientes",
      entidade_id: importacao.cliente_id,
      detalhes: { importacaoId: id, boletoId, numeroParcela: boleto.numero_parcela, identificadorPersistido: Boolean(identificador) },
    });

    return json({ importacao: atualizada });
  }

  const ignorar = path.match(/^\/api\/admin\/importacoes-boletos\/([^/]+)\/ignorar$/);
  if (ignorar && request.method === "POST") {
    const id = decodeURIComponent(ignorar[1]);
    const { data, error } = await db.from("importacoes_boletos").update({ status_vinculacao: "ignorado" }).eq("id", id).select("*").single();
    if (error) return json({ erro: publicError(error) }, 400);
    return json({ importacao: data });
  }

  return null;
}
