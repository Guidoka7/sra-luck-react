import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";

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

  const supabase = createServiceSupabaseClient(env);

  if (!boletoId && request.method === "GET") {
    const { data: cliente, error: erroCliente } = await supabase
      .from("clientes")
      .select("id, quantidade_parcelas, status_revisao_financeira, data_atingiu_percentual, observacao_revisao_financeira")
      .eq("id", sessao.clienteId).single();
    if (erroCliente || !cliente) return json({ erro: "Cliente não encontrada." }, 404);

    const { data: boletos, error: erroBoletos } = await supabase.from("boletos").select("*").eq("cliente_id", cliente.id).order("numero_parcela", { ascending: true });
    if (erroBoletos) return json({ erro: "Erro ao buscar boletos." }, 500);

    const { data: porcentagem } = await supabase.rpc("porcentagem_pagamento", { p_cliente_id: cliente.id });
    const { data: podeAgendar } = await supabase.rpc("pode_agendar", { p_cliente_id: cliente.id });
    const { data: agendaLiberada } = await supabase.rpc("agenda_liberada", { p_cliente_id: cliente.id });
    const parcelasPagas = (boletos ?? []).filter((b: { status: string }) => b.status === "pago").length;

    return json({
      cliente_id: cliente.id,
      quantidade_parcelas: cliente.quantidade_parcelas ?? (boletos?.[0]?.total_parcelas ?? 12),
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
    if (error || !data?.signedUrl) return json({ erro: "Não foi possível gerar o link do boleto." }, 500);
    return Response.redirect(data.signedUrl, 302);
  }

  if (action === "comprovante" && request.method === "GET") {
    const { data: boleto } = await supabase.from("boletos").select("cliente_id, comprovante_url").eq("id", boletoId).single();
    if (!boleto || boleto.cliente_id !== sessao.clienteId || !boleto.comprovante_url) return json({ erro: "Comprovante não encontrado." }, 404);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(boleto.comprovante_url, 300);
    if (error || !data?.signedUrl) return json({ erro: "Não foi possível gerar o link do comprovante." }, 500);
    return Response.redirect(data.signedUrl, 302);
  }

  if (action === "comprovante" && request.method === "DELETE") {
    const { data: boleto } = await supabase.from("boletos").select("id, cliente_id, comprovante_url, status").eq("id", boletoId).single();
    if (!boleto || boleto.cliente_id !== sessao.clienteId) return json({ erro: "Boleto não encontrado." }, 404);
    if (!boleto.comprovante_url) return json({ erro: "Esta parcela não possui comprovante." }, 404);
    const { error: updateError } = await supabase.from("boletos").update({ comprovante_url: null, status: "nao_pago", data_pagamento: null, observacoes: null }).eq("id", boletoId).eq("cliente_id", sessao.clienteId);
    if (updateError) return json({ erro: "Não foi possível remover o comprovante." }, 500);
    const { error } = await supabase.storage.from(BUCKET).remove([boleto.comprovante_url]);
    if (error) console.error("Erro ao remover arquivo do comprovante:", error);
    return json({ sucesso: true, status: "nao_pago" });
  }

  if (action === "anexar" && request.method === "POST") {
    const { data: boleto } = await supabase.from("boletos").select("id, cliente_id, numero_parcela, status, comprovante_url").eq("id", boletoId).single();
    if (!boleto || boleto.cliente_id !== sessao.clienteId) return json({ erro: "Boleto não encontrado." }, 404);
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
    if (uploadError) { console.error("Erro upload comprovante:", uploadError); return json({ erro: "Erro ao enviar o arquivo." }, 500); }

    const { error: updateError } = await supabase.from("boletos").update({ status: "pendente_confirmacao", comprovante_url: caminho, data_pagamento: null, observacoes: null }).eq("id", boletoId).eq("cliente_id", sessao.clienteId);
    if (updateError) {
      await supabase.storage.from(BUCKET).remove([caminho]);
      return json({ erro: "Erro ao salvar o comprovante." }, 500);
    }
    if (boleto.comprovante_url && boleto.comprovante_url !== caminho) await supabase.storage.from(BUCKET).remove([boleto.comprovante_url]);

    if (clienteAntes?.status_revisao_financeira === "recusada") {
      const { data: podeAgendar } = await supabase.rpc("pode_agendar", { p_cliente_id: sessao.clienteId });
      if (Boolean(podeAgendar)) await supabase.from("clientes").update({ status_revisao_financeira: "pendente", data_atingiu_percentual: new Date().toISOString(), observacao_revisao_financeira: null }).eq("id", sessao.clienteId);
    }
    return json({ sucesso: true, boleto_id: boletoId, status: "pendente_confirmacao" });
  }

  return json({ erro: "ROTA_NAO_ENCONTRADA" }, 404);
}
