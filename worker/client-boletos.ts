import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";
import { pseudonymizeActorId, requestLogger } from "./logger";

const COOKIE_NAME = "cliente_session";
const BUCKET = "boletos-clientes";
const MAX_UPLOAD = 5 * 1024 * 1024;
const TIPOS_PERMITIDOS = ["application/pdf", "image/jpeg", "image/png"] as const;
type TipoPermitido = (typeof TIPOS_PERMITIDOS)[number];

type Sessao = { clienteId: string };

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

async function sessaoCliente(request: Request, env: Env): Promise<Sessao | null> {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  return verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
}

function detectarTipoArquivo(bytes: Uint8Array): TipoPermitido | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  return null;
}

function extensao(tipo: TipoPermitido) {
  return tipo === "application/pdf" ? "pdf" : tipo === "image/jpeg" ? "jpg" : "png";
}

export async function handleClienteBoletos(request: Request, env: Env, boletoId?: string, action?: "anexar" | "arquivo" | "comprovante") {
  const sessao = await sessaoCliente(request, env);
  if (!sessao) return json({ erro: "Sessão expirada." }, 401);
  const log = requestLogger(request).child({ actorType: "cliente", actorId: await pseudonymizeActorId(sessao.clienteId, env), entityType: boletoId ? "boleto" : undefined, entityId: boletoId ?? null });

  const supabase = createServiceSupabaseClient(env);

  if (!boletoId && request.method === "GET") {
    const { data: cliente, error: erroCliente } = await supabase.from("clientes").select("id, quantidade_parcelas, status_revisao_financeira, data_atingiu_percentual, observacao_revisao_financeira").eq("id", sessao.clienteId).single();
    if (erroCliente || !cliente) {
      if (erroCliente) log.error("Falha ao carregar cliente para boletos", { action: "client.boletos.list", eventCode: "BOLETOS_CLIENT_LOOKUP_FAILED", statusCode: 404, error: erroCliente });
      return json({ erro: "Cliente não encontrada." }, 404);
    }

    const { data: boletos, error: erroBoletos } = await supabase.from("boletos").select("*").eq("cliente_id", cliente.id).order("numero_parcela", { ascending: true });
    if (erroBoletos) {
      log.error("Falha ao carregar boletos", { action: "client.boletos.list", eventCode: "BOLETOS_LIST_FAILED", statusCode: 500, error: erroBoletos });
      return json({ erro: "Erro ao buscar boletos." }, 500);
    }

    const { data: porcentagem } = await supabase.rpc("porcentagem_pagamento", { p_cliente_id: cliente.id });
    const { data: podeAgendar } = await supabase.rpc("pode_agendar", { p_cliente_id: cliente.id });
    const { data: agendaLiberada } = await supabase.rpc("agenda_liberada", { p_cliente_id: cliente.id });
    const parcelasPagas = (boletos ?? []).filter((b: { status: string }) => b.status === "pago").length;

    return json({
      cliente_id: cliente.id,
      quantidade_parcelas: cliente.quantidade_parcelas ?? (boletos?.[0]?.total_parcelas ?? null),
      porcentagem_pagamento: Number(porcentagem ?? 0),
      pode_agendar: Boolean(podeAgendar), agenda_liberada: Boolean(agendaLiberada),
      status_revisao_financeira: cliente.status_revisao_financeira ?? null,
      data_atingiu_percentual: cliente.data_atingiu_percentual ?? null,
      observacao_revisao_financeira: cliente.observacao_revisao_financeira ?? null,
      parcelas_pagas: parcelasPagas, parcelas_nao_pagas: (boletos ?? []).length - parcelasPagas,
      boletos: (boletos ?? []).map((b: { valor: number }) => ({ ...b, valor: Number(b.valor) })),
    }, 200, { "Cache-Control": "private, no-store" });
  }

  if (!boletoId) return json({ erro: "Boleto não informado." }, 400);

  if (action === "arquivo" && request.method === "GET") {
    const { data: boleto } = await supabase.from("boletos").select("cliente_id, boleto_url").eq("id", boletoId).single();
    if (!boleto || boleto.cliente_id !== sessao.clienteId || !boleto.boleto_url) return json({ erro: "Boleto ainda não disponível." }, 404);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(boleto.boleto_url, 300);
    if (error || !data?.signedUrl) {
      if (error) log.error("Falha ao gerar URL assinada do boleto", { action: "client.boleto.file", eventCode: "BOLETO_SIGNED_URL_FAILED", statusCode: 500, error });
      return json({ erro: "Não foi possível gerar o link do boleto." }, 500);
    }
    return Response.redirect(data.signedUrl, 302);
  }

  if (action === "comprovante" && request.method === "GET") {
    const { data: boleto } = await supabase.from("boletos").select("cliente_id, comprovante_url").eq("id", boletoId).single();
    if (!boleto || boleto.cliente_id !== sessao.clienteId || !boleto.comprovante_url) return json({ erro: "Comprovante não encontrado." }, 404);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(boleto.comprovante_url, 300);
    if (error || !data?.signedUrl) {
      if (error) log.error("Falha ao gerar URL assinada do comprovante", { action: "client.receipt.file", eventCode: "RECEIPT_SIGNED_URL_FAILED", statusCode: 500, error });
      return json({ erro: "Não foi possível gerar o link do comprovante." }, 500);
    }
    return Response.redirect(data.signedUrl, 302);
  }

  if (action === "comprovante" && request.method === "DELETE") {
    const { data: boleto } = await supabase.from("boletos").select("id, cliente_id, comprovante_url, status").eq("id", boletoId).single();
    if (!boleto || boleto.cliente_id !== sessao.clienteId) return json({ erro: "Boleto não encontrado." }, 404);
    if (!boleto.comprovante_url) return json({ erro: "Esta parcela não possui comprovante." }, 404);
    if (boleto.status === "pago") return json({ erro: "Comprovante de parcela paga não pode ser removido." }, 409);
    const { error: updateError } = await supabase.from("boletos").update({ comprovante_url: null, comprovante_enviado_em: null, status: "nao_pago", data_pagamento: null, observacoes: null }).eq("id", boletoId).eq("cliente_id", sessao.clienteId).neq("status", "pago");
    if (updateError) {
      log.error("Falha ao remover referência do comprovante", { action: "client.receipt.delete", eventCode: "RECEIPT_DB_DELETE_FAILED", statusCode: 500, error: updateError });
      return json({ erro: "Não foi possível remover o comprovante." }, 500);
    }
    const { error } = await supabase.storage.from(BUCKET).remove([boleto.comprovante_url]);
    if (error) log.warn("Banco atualizado, mas arquivo do comprovante não foi removido", { action: "client.receipt.delete", eventCode: "RECEIPT_STORAGE_DELETE_FAILED", error });
    else log.info("Comprovante removido", { action: "client.receipt.delete", eventCode: "RECEIPT_DELETED" });
    return json({ sucesso: true, status: "nao_pago" });
  }

  if (action === "anexar" && request.method === "POST") {
    const { data: boleto } = await supabase.from("boletos").select("id, cliente_id, numero_parcela, status, comprovante_url").eq("id", boletoId).single();
    if (!boleto || boleto.cliente_id !== sessao.clienteId) return json({ erro: "Boleto não encontrado." }, 404);
    if (boleto.status === "pago") return json({ erro: "Parcela já paga não aceita novo comprovante." }, 409);
    const { data: clienteAntes } = await supabase.from("clientes").select("status_revisao_financeira").eq("id", sessao.clienteId).single();

    let formData: FormData;
    try { formData = await request.formData(); } catch { return json({ erro: "Requisição inválida." }, 400); }
    const arquivo = formData.get("arquivo");
    if (!(arquivo instanceof File)) return json({ erro: "Arquivo não fornecido." }, 400);
    if (!TIPOS_PERMITIDOS.includes(arquivo.type as TipoPermitido)) return json({ erro: "Tipo de arquivo não permitido. Use PDF, JPG ou PNG." }, 400);
    if (arquivo.size === 0 || arquivo.size > MAX_UPLOAD) return json({ erro: "O arquivo deve ter até 5MB e não pode estar vazio." }, 400);
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const tipo = detectarTipoArquivo(bytes);
    if (!tipo || tipo !== arquivo.type) return json({ erro: "O conteúdo do arquivo não corresponde ao tipo informado. Envie um PDF, JPG ou PNG válido." }, 400);

    const caminho = `${sessao.clienteId}/${boletoId}/${Date.now()}.${extensao(tipo)}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: tipo, upsert: false });
    if (uploadError) {
      log.error("Falha no upload do comprovante", { action: "client.receipt.upload", eventCode: "RECEIPT_UPLOAD_FAILED", statusCode: 500, error: uploadError });
      return json({ erro: "Erro ao enviar o arquivo." }, 500);
    }

    const { error: updateError } = await supabase.from("boletos").update({ status: "pendente_confirmacao", comprovante_url: caminho, comprovante_enviado_em: new Date().toISOString(), data_pagamento: null, observacoes: null }).eq("id", boletoId).eq("cliente_id", sessao.clienteId).neq("status", "pago");
    if (updateError) {
      const { error: rollbackError } = await supabase.storage.from(BUCKET).remove([caminho]);
      if (rollbackError) log.error("Falha no rollback do arquivo após erro de banco", { action: "client.receipt.upload.rollback", eventCode: "RECEIPT_UPLOAD_ROLLBACK_FAILED", error: rollbackError });
      log.error("Arquivo enviado, mas comprovante não foi salvo no banco", { action: "client.receipt.upload", eventCode: "RECEIPT_DB_SAVE_FAILED", statusCode: 500, error: updateError });
      return json({ erro: "Erro ao salvar o comprovante." }, 500);
    }
    if (boleto.comprovante_url && boleto.comprovante_url !== caminho) {
      const { error: oldFileError } = await supabase.storage.from(BUCKET).remove([boleto.comprovante_url]);
      if (oldFileError) log.warn("Novo comprovante salvo, mas arquivo anterior não foi removido", { action: "client.receipt.upload.cleanup", eventCode: "RECEIPT_OLD_FILE_DELETE_FAILED", error: oldFileError });
    }

    if (clienteAntes?.status_revisao_financeira === "recusada") {
      const { data: podeAgendar } = await supabase.rpc("pode_agendar", { p_cliente_id: sessao.clienteId });
      if (Boolean(podeAgendar)) await supabase.from("clientes").update({ status_revisao_financeira: "pendente", data_atingiu_percentual: new Date().toISOString(), observacao_revisao_financeira: null }).eq("id", sessao.clienteId);
    }
    log.info("Comprovante enviado para conferência", { action: "client.receipt.upload", eventCode: "RECEIPT_UPLOADED" });
    return json({ sucesso: true, boleto_id: boletoId, status: "pendente_confirmacao" });
  }

  return json({ erro: "ROTA_NAO_ENCONTRADA" }, 404);
}
