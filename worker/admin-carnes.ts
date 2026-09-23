import { publicError } from "./http-security";
import { PDFDocument } from "pdf-lib";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { getCookie, verificarTokenAdmin } from "./session";
import { extrairTextosDoPdf, lerTextoDaPagina, paginaVazia, type PaginaLida } from "./carne-leitura";
import { agenteCarneDisponivel, lerFolhasComAgente } from "./carne-agente";
import { planejarVinculos, type DecisaoFolha, type ParcelaAlvo } from "./carne-vinculo";
import { agoraSaoPaulo } from "./surgery-release";

const BUCKET = "boletos-clientes";
const TAMANHO_MAXIMO = 30 * 1024 * 1024;
const MAXIMO_FOLHAS = 240;

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

type Db = ReturnType<typeof createServiceSupabaseClient>;

const MOTIVOS_LEGIVEIS: Record<string, string> = {
  mais_de_um_boleto_na_folha: "A folha tem mais de um boleto.",
  cpf_da_folha_diverge_da_cliente: "O CPF impresso na folha não é o desta cliente.",
  folha_sem_dados_legiveis: "Não foi possível ler os dados da folha.",
  boleto_repetido_no_arquivo: "Este boleto aparece mais de uma vez no arquivo.",
  nenhuma_parcela_livre_para_esta_folha: "Todas as parcelas já têm boleto.",
  nenhuma_parcela_confere_com_seguranca: "Nenhuma parcela confere com segurança; escolha manualmente.",
};

function resumoDecisao(decisao: DecisaoFolha) {
  if (decisao.acao !== "revisar") return null;
  return MOTIVOS_LEGIVEIS[decisao.motivos[0]] ?? "Revise e escolha a parcela manualmente.";
}

/**
 * Aplica o vínculo de uma folha importada a uma parcela: a parcela passa a ter
 * o PDF da folha como boleto (visível no app da cliente) e o identificador
 * lido. Idempotente e protegido contra corrida: sem `substituir`, só grava se
 * a parcela ainda não tiver boleto.
 */
async function aplicarVinculo(db: Db, importacao: any, boletoId: string, ator: string, opcoes: { automatico: boolean; substituir: boolean }) {
  const { data: boleto, error: erroBoleto } = await db.from("boletos")
    .select("id,cliente_id,numero_parcela,carne_id,instituicao_financeira,identificador_externo,boleto_url")
    .eq("id", boletoId)
    .maybeSingle();
  if (erroBoleto) return { ok: false as const, status: 500, erro: publicError(erroBoleto) };
  if (!boleto || boleto.cliente_id !== importacao.cliente_id) return { ok: false as const, status: 400, erro: "Parcela inválida para esta cliente." };
  const jaTemOutroBoleto = Boolean(boleto.boleto_url && boleto.boleto_url !== importacao.arquivo_storage_path);
  if (jaTemOutroBoleto && !opcoes.substituir) return { ok: false as const, status: 409, erro: `A parcela ${boleto.numero_parcela} já tem boleto anexado. Confirme a substituição para trocar.`, codigo: "PARCELA_JA_TEM_BOLETO" };

  const identificador = importacao.linha_digitavel ?? importacao.codigo_barras ?? importacao.nosso_numero ?? importacao.numero_documento ?? boleto.identificador_externo ?? null;
  let update = db.from("boletos").update({
    boleto_url: importacao.arquivo_storage_path,
    carne_id: importacao.carne_id ?? boleto.carne_id ?? null,
    instituicao_financeira: importacao.instituicao_financeira ?? boleto.instituicao_financeira ?? null,
    identificador_externo: identificador,
    origem_boleto: "externo",
  }).eq("id", boletoId);
  if (!opcoes.substituir) update = boleto.boleto_url ? update.eq("boleto_url", importacao.arquivo_storage_path) : update.is("boleto_url", null);
  const { data: atualizados, error: erroUpdate } = await update.select("id");
  if (erroUpdate) return { ok: false as const, status: 500, erro: publicError(erroUpdate) };
  if (!atualizados?.length) return { ok: false as const, status: 409, erro: "A parcela recebeu outro boleto enquanto esta folha era processada.", codigo: "PARCELA_JA_TEM_BOLETO" };

  if (jaTemOutroBoleto) {
    await db.from("importacoes_boletos").update({ status_vinculacao: "ignorado", erro_detalhes: "Substituída por outra folha." })
      .eq("boleto_vinculado_id", boletoId).neq("id", importacao.id);
  }
  const { data: atualizada, error: erroImportacao } = await db.from("importacoes_boletos").update({
    status: "vinculado",
    status_vinculacao: "vinculado",
    erro_detalhes: null,
    cliente_vinculado_id: importacao.cliente_id,
    carne_vinculado_id: importacao.carne_id,
    boleto_vinculado_id: boletoId,
    boleto_id: boletoId,
  }).eq("id", importacao.id).select("*").single();
  if (erroImportacao) return { ok: false as const, status: 500, erro: publicError(erroImportacao) };

  await db.from("logs_alteracoes").insert({
    usuario: ator,
    acao: opcoes.automatico ? "anexou_boleto_do_carne_automaticamente" : "vinculou_boleto_importado",
    entidade: "clientes",
    entidade_id: importacao.cliente_id,
    detalhes: { importacaoId: importacao.id, boletoId, numeroParcela: boleto.numero_parcela, substituiu: jaTemOutroBoleto, identificadorPersistido: Boolean(identificador) },
  });
  return { ok: true as const, importacao: atualizada, numeroParcela: boleto.numero_parcela };
}

/** Executa tarefas assíncronas com concorrência limitada, preservando a ordem. */
async function emParalelo<T, R>(itens: T[], limite: number, tarefa: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      const indice = proximo++;
      resultados[indice] = await tarefa(itens[indice]);
    }
  }));
  return resultados;
}

/**
 * Carnês (por instituição financeira) e importação de carnê em PDF.
 *
 * Motor de leitura e anexação (1 folha do PDF = 1 boleto):
 * 1. o PDF é cortado em folhas; cada folha vira um PDF próprio com hash
 *    (folhas já importadas antes são puladas, não bloqueiam o arquivo);
 * 2. leitura do texto nativo: linha digitável validada pelos DVs FEBRABAN
 *    (valor e vencimento saem dela) + rótulos impressos;
 * 3. folhas sem linha válida vão para o agente de leitura (Claude), quando
 *    configurado — o que ele lê também passa pela validação FEBRABAN;
 * 4. o carnê inteiro é casado com as parcelas (carne-vinculo.ts): folhas com
 *    evidência forte e única são anexadas automaticamente e aparecem no app
 *    da cliente; as demais ficam como sugestão ou revisão para a equipe.
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
      if (arquivo.size > TAMANHO_MAXIMO) return json({ erro: "Arquivo maior que 30MB." }, 400);
      const instituicao = String(form.get("instituicaoFinanceira") ?? "").trim();
      const carneId = form.get("carneId") ? String(form.get("carneId")) : null;
      const ator = atorFinanceiro ?? session.adminId;

      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      let documento: PDFDocument;
      try {
        documento = await PDFDocument.load(bytes);
      } catch {
        return json({ erro: "Não foi possível ler o PDF enviado. Verifique se o arquivo não está corrompido ou protegido por senha." }, 400);
      }
      const totalPaginas = documento.getPageCount();
      if (totalPaginas === 0) return json({ erro: "O PDF enviado não tem páginas." }, 400);
      if (totalPaginas > MAXIMO_FOLHAS) return json({ erro: `O carnê tem ${totalPaginas} folhas; o limite por arquivo é ${MAXIMO_FOLHAS}. Divida o PDF.` }, 400);

      // 1) Corte: cada folha vira um PDF próprio, com hash para detectar
      //    reimportação da mesma folha.
      const folhasPdf: { pagina: number; bytes: Uint8Array; sha256: string }[] = [];
      for (let indice = 0; indice < totalPaginas; indice += 1) {
        const paginaDoc = await PDFDocument.create();
        const [pagina] = await paginaDoc.copyPages(documento, [indice]);
        paginaDoc.addPage(pagina);
        const paginaBytes = await paginaDoc.save();
        folhasPdf.push({ pagina: indice + 1, bytes: paginaBytes, sha256: await sha256(paginaBytes) });
      }
      // Folhas já ANEXADAS são puladas. Folhas importadas antes e nunca
      // vinculadas (ex.: leitura antiga que falhou) são reprocessadas agora e
      // o registro anterior é encerrado como substituído.
      const { data: anterioresRows } = await db.from("importacoes_boletos")
        .select("id,arquivo_sha256,status_vinculacao")
        .eq("cliente_id", clienteId)
        .in("arquivo_sha256", folhasPdf.map((f) => f.sha256))
        .neq("status_vinculacao", "ignorado");
      const jaAnexadas = new Set((anterioresRows ?? []).filter((r: any) => r.status_vinculacao === "vinculado").map((r: any) => r.arquivo_sha256));
      const reprocessar = (anterioresRows ?? []).filter((r: any) => r.status_vinculacao !== "vinculado").map((r: any) => r.id as string);
      const novas = folhasPdf.filter((f) => !jaAnexadas.has(f.sha256));
      if (novas.length === 0) return json({ erro: "Todas as folhas deste PDF já estão anexadas às parcelas desta cliente." }, 409);

      // 2) Leitura do texto nativo (PDF lido uma vez só).
      const hoje = agoraSaoPaulo().data;
      const textos = await extrairTextosDoPdf(bytes);
      const leituras = new Map<number, PaginaLida>();
      for (const f of novas) leituras.set(f.pagina, textos ? lerTextoDaPagina(textos[f.pagina - 1] ?? "", f.pagina, hoje) : paginaVazia(f.pagina));

      // 3) Agente de leitura para as folhas sem linha digitável válida.
      const paraAgente = novas.map((f) => f.pagina).filter((p) => { const l = leituras.get(p)!; return !l.linhaValidada && l.boletosNaPagina <= 1; });
      const agenteDisponivel = agenteCarneDisponivel(env);
      let falhasAgente = 0;
      if (agenteDisponivel && paraAgente.length > 0) {
        const { folhas, falhas } = await lerFolhasComAgente(env, bytes, paraAgente, hoje);
        falhasAgente = falhas;
        for (const lida of folhas) {
          const atual = leituras.get(lida.pagina)!;
          const atualVazia = atual.valor == null && !atual.vencimento;
          if (lida.linhaValidada || (atualVazia && lida.fonte === "agente")) leituras.set(lida.pagina, lida);
          else if (lida.observacoes.length) atual.observacoes.push(...lida.observacoes.filter((o) => o.startsWith("agente_")));
        }
      }

      // 4) Casamento do carnê inteiro com as parcelas da cliente.
      const [{ data: boletosCliente, error: erroBoletos }, { data: clienteRow }] = await Promise.all([
        db.from("boletos")
          .select("id,numero_parcela,valor,data_vencimento,boleto_url,identificador_externo")
          .eq("cliente_id", clienteId)
          .order("numero_parcela", { ascending: true }),
        db.from("clientes").select("cpf").eq("id", clienteId).maybeSingle(),
      ]);
      if (erroBoletos) return json({ erro: publicError(erroBoletos) }, 500);
      const parcelas: ParcelaAlvo[] = (boletosCliente ?? []).map((b: any) => ({
        id: b.id,
        numero_parcela: Number(b.numero_parcela),
        valor: Number(b.valor),
        data_vencimento: b.data_vencimento ?? null,
        identificador_externo: b.identificador_externo ?? null,
        temBoleto: Boolean(b.boleto_url),
      }));
      const folhasLidas = novas.map((f) => leituras.get(f.pagina)!);
      const decisoes = planejarVinculos(folhasLidas, parcelas, clienteRow?.cpf ?? null);

      // 5) Armazena as folhas (privadas) e registra a análise de cada uma.
      const uploads = await emParalelo(novas, 6, async (f) => {
        const caminho = `importacoes/${clienteId}/${f.sha256}.pdf`;
        const { error } = await db.storage.from(BUCKET).upload(caminho, f.bytes, { contentType: "application/pdf", upsert: false });
        const jaExiste = error && /exist|duplicate/i.test(String((error as any).message ?? ""));
        return { caminho, erro: error && !jaExiste ? error : null };
      });
      const falhaUpload = uploads.find((u) => u.erro);
      if (falhaUpload) return json({ erro: publicError(falhaUpload.erro, "Não foi possível salvar as folhas do carnê.") }, 500);

      const registros = novas.map((f, indice) => {
        const lida = folhasLidas[indice];
        const decisao = decisoes[indice];
        return {
          cliente_id: clienteId,
          carne_id: carneId,
          instituicao_financeira: instituicao || null,
          numero_parcela: lida.numeroParcela,
          nosso_numero: lida.nossoNumero,
          numero_documento: lida.numeroDocumento,
          identificador_externo: lida.linhaDigitavel ?? lida.codigoBarras ?? lida.nossoNumero ?? lida.numeroDocumento ?? null,
          linha_digitavel: lida.linhaDigitavel,
          codigo_barras: lida.codigoBarras,
          nome_pagador_extraido: lida.nomePagador,
          valor_extraido: lida.valor,
          vencimento_extraido: lida.vencimento,
          cpf_pagador_extraido: lida.cpfs[0] ?? null,
          dados_extraidos: {
            fonte: lida.fonte, linhaValidada: lida.linhaValidada, valor: lida.valor, vencimento: lida.vencimento,
            numeroParcela: lida.numeroParcela, totalParcelas: lida.totalParcelas, linhaDigitavel: lida.linhaDigitavel,
            codigoBarras: lida.codigoBarras, nossoNumero: lida.nossoNumero, numeroDocumento: lida.numeroDocumento,
            nomePagador: lida.nomePagador, boletosNaPagina: lida.boletosNaPagina,
          },
          arquivo_nome: `${arquivo.name} (folha ${f.pagina}/${totalPaginas})`,
          arquivo_mime: "application/pdf",
          arquivo_tamanho: f.bytes.byteLength,
          arquivo_sha256: f.sha256,
          arquivo_storage_path: uploads[indice].caminho,
          status: decisao.acao === "revisar" ? "erro" : "aguardando_confirmacao",
          erro_detalhes: resumoDecisao(decisao),
          cliente_sugerido_id: decisao.boletoId ? clienteId : null,
          boleto_sugerido_id: decisao.boletoId,
          pontuacao_confianca: decisao.pontuacao,
          nivel_confianca: decisao.nivel,
          status_vinculacao: decisao.acao === "revisar" ? "revisar" : "aguardando_confirmacao",
          analise_detalhada: { totalPaginasArquivo: totalPaginas, numeroPagina: f.pagina, totalParcelasCliente: parcelas.length, fonte: lida.fonte, acao: decisao.acao, motivos: decisao.motivos },
        };
      });
      const { data: inseridas, error: erroInsert } = await db.from("importacoes_boletos").insert(registros).select("*");
      if (erroInsert) return json({ erro: publicError(erroInsert) }, 500);
      if (reprocessar.length) {
        await db.from("importacoes_boletos").update({ status_vinculacao: "ignorado", erro_detalhes: "Reprocessada em uma nova importação do mesmo carnê." }).in("id", reprocessar);
      }
      const porSha = new Map((inseridas ?? []).map((i: any) => [i.arquivo_sha256, i]));

      // 6) Anexação automática das folhas com evidência forte.
      let anexadas = 0;
      const finais: any[] = [];
      for (let indice = 0; indice < novas.length; indice += 1) {
        const importacao = porSha.get(novas[indice].sha256);
        if (!importacao) continue;
        const decisao = decisoes[indice];
        if (decisao.acao === "anexar" && decisao.boletoId) {
          const r = await aplicarVinculo(db, importacao, decisao.boletoId, ator, { automatico: true, substituir: false });
          if (r.ok) { anexadas += 1; finais.push(r.importacao); continue; }
        }
        finais.push(importacao);
      }
      const sugeridas = finais.filter((i) => i.status_vinculacao === "aguardando_confirmacao").length;
      const revisar = finais.filter((i) => i.status_vinculacao === "revisar").length;
      const lidasPeloAgente = folhasLidas.filter((l) => l.fonte === "agente").length;
      const resumo = {
        folhasNoArquivo: totalPaginas,
        folhasNovas: novas.length,
        jaImportadas: totalPaginas - novas.length,
        reprocessadas: reprocessar.length,
        anexadas, sugeridas, revisar,
        agente: { disponivel: agenteDisponivel, folhasLidas: lidasPeloAgente, falhas: falhasAgente, necessario: paraAgente.length },
      };

      await db.from("logs_alteracoes").insert({
        usuario: ator,
        acao: "importou_carne_pdf",
        entidade: "clientes",
        entidade_id: clienteId,
        detalhes: { tipo: "application/pdf", ...resumo, totalParcelasCliente: parcelas.length, importacaoIds: finais.map((i) => i.id) },
      });

      return json({ importacoes: finais, resumo }, 201);
    }
  }

  const confirmarSugestoes = path.match(/^\/api\/admin\/clientes\/([^/]+)\/importacoes-boletos\/confirmar-sugestoes$/);
  if (confirmarSugestoes && request.method === "POST") {
    const clienteId = decodeURIComponent(confirmarSugestoes[1]);
    const { data: pendentes, error } = await db.from("importacoes_boletos")
      .select("*")
      .eq("cliente_id", clienteId)
      .eq("status_vinculacao", "aguardando_confirmacao")
      .not("boleto_sugerido_id", "is", null)
      .order("created_at", { ascending: true });
    if (error) return json({ erro: publicError(error) }, 500);
    let vinculadas = 0;
    const falhas: { importacaoId: string; erro: string }[] = [];
    const usados = new Set<string>();
    for (const importacao of pendentes ?? []) {
      if (usados.has(importacao.boleto_sugerido_id)) { falhas.push({ importacaoId: importacao.id, erro: "Outra folha também foi sugerida para esta parcela." }); continue; }
      usados.add(importacao.boleto_sugerido_id);
      const r = await aplicarVinculo(db, importacao, importacao.boleto_sugerido_id, atorFinanceiro ?? session.adminId, { automatico: false, substituir: false });
      if (r.ok) vinculadas += 1; else falhas.push({ importacaoId: importacao.id, erro: r.erro });
    }
    return json({ vinculadas, falhas });
  }

  const arquivoImportacao = path.match(/^\/api\/admin\/importacoes-boletos\/([^/]+)\/arquivo$/);
  if (arquivoImportacao && request.method === "GET") {
    const id = decodeURIComponent(arquivoImportacao[1]);
    const { data: importacao, error } = await db.from("importacoes_boletos").select("arquivo_storage_path").eq("id", id).maybeSingle();
    if (error) return json({ erro: publicError(error) }, 500);
    if (!importacao?.arquivo_storage_path) return json({ erro: "Folha não encontrada." }, 404);
    const { data: assinada, error: erroUrl } = await db.storage.from(BUCKET).createSignedUrl(importacao.arquivo_storage_path, 300);
    if (erroUrl || !assinada?.signedUrl) return json({ erro: "Não foi possível abrir a folha." }, 500);
    return Response.redirect(assinada.signedUrl, 302);
  }

  const vincular = path.match(/^\/api\/admin\/importacoes-boletos\/([^/]+)\/vincular$/);
  if (vincular && request.method === "POST") {
    const id = decodeURIComponent(vincular[1]);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    const { data: importacao, error: erroImportacao } = await db.from("importacoes_boletos").select("*").eq("id", id).maybeSingle();
    if (erroImportacao) return json({ erro: publicError(erroImportacao) }, 500);
    if (!importacao) return json({ erro: "Importação não encontrada." }, 404);
    if (importacao.status_vinculacao === "vinculado") return json({ erro: "Esta folha já foi vinculada." }, 409);

    const boletoId = String(body.boletoId ?? importacao.boleto_sugerido_id ?? "");
    if (!boletoId) return json({ erro: "Selecione a parcela correspondente para vincular." }, 400);
    const r = await aplicarVinculo(db, importacao, boletoId, atorFinanceiro ?? session.adminId, { automatico: false, substituir: body.substituir === true });
    if (!r.ok) return json({ erro: r.erro, codigo: (r as any).codigo ?? null }, r.status);
    return json({ importacao: r.importacao });
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
