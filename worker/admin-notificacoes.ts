import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin } from "./session";

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }); }
async function parse(request: Request) { try { return await request.json() as Record<string, any>; } catch { return {}; } }
async function auth(request: Request, env: Env) { if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503); return (await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET)) ? null : json({ erro: "Sessão administrativa expirada." }, 401); }

export async function adminNotificacoes(request: Request, env: Env): Promise<Response | null> {
 const path = new URL(request.url).pathname;
 if (path.match(/^\/api\/admin\/boletos\/[^/]+\/comprovante$/) && request.method === "GET") {
  const denied = await auth(request, env); if (denied) return denied;
  const match = path.match(/^\/api\/admin\/boletos\/([^/]+)\/comprovante$/); const id = decodeURIComponent(match![1]);
  const db = createServiceSupabaseClient(env);
  const { data: boleto, error: boletoError } = await db.from("boletos").select("comprovante_url").eq("id", id).maybeSingle();
  if (boletoError) { console.error("Erro ao buscar comprovante administrativo:", boletoError); return json({ erro: "Não foi possível localizar o comprovante." }, 500); }
  if (!boleto?.comprovante_url) return json({ erro: "Comprovante não encontrado." }, 404);
  const { data, error } = await db.storage.from("boletos-clientes").createSignedUrl(boleto.comprovante_url, 300);
  if (error || !data?.signedUrl) { console.error("Erro ao gerar URL assinada do comprovante:", error); return json({ erro: "Não foi possível gerar o link do comprovante." }, 500); }
  return Response.redirect(data.signedUrl, 302);
 }
 if (!path.startsWith("/api/admin/notificacoes")) return null;
 const denied = await auth(request, env); if (denied) return denied;
 const db = createServiceSupabaseClient(env);
 if (path === "/api/admin/notificacoes/automacao") {
  if (request.method === "GET") {
   const [cfg, templates, logs, clientes, atrasadas, aVencer] = await Promise.all([
    db.from("notificacoes_config").select("chave,valor,tipo"),
    db.from("notificacao_templates").select("id,tipo,dias_referencia,titulo,corpo,emoji,is_active,updated_at").order("tipo").order("dias_referencia"),
    db.from("notificacao_logs").select("id,cliente_id,tipo,titulo,corpo,status,erro_mensagem,created_at,clientes(nome_completo)").order("created_at", { ascending: false }).limit(200),
    db.from("clientes").select("id,nome_completo,telefone,ativo").eq("ativo", true).order("nome_completo"),
    db.from("boletos").select("id", { count: "exact", head: true }).lt("data_vencimento", new Date().toISOString().slice(0, 10)).neq("status", "pago"),
    db.from("boletos").select("id", { count: "exact", head: true }).gte("data_vencimento", new Date().toISOString().slice(0, 10)).lte("data_vencimento", new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)).neq("status", "pago"),
   ]);
   if (cfg.error || templates.error || logs.error || clientes.error || atrasadas.error) return json({ erro: "Não foi possível carregar o painel de notificações." }, 500);
   const raw = Object.fromEntries((cfg.data ?? []).map((x:any) => [x.chave, x.valor]));
   return json({ config: { atraso_habilitado: raw.atraso_habilitado !== "false", frequencia_atraso_horas: Number(raw.frequencia_atraso_horas ?? 24), max_tentativas: Number(raw.max_tentativas ?? 3) }, templates: templates.data ?? [], logs: logs.data ?? [], clientes: clientes.data ?? [], atrasadas: atrasadas.count ?? 0, aVencer: aVencer.count ?? 0 });
  }
  if (request.method === "PATCH") {
   const b = await parse(request);
   if (b.acao === "salvar_config" || b.atraso_habilitado !== undefined) {
    const values = { atraso_habilitado: Boolean(b.atraso_habilitado), frequencia_atraso_horas: Math.max(1, Number(b.frequencia_atraso_horas) || 24), max_tentativas: Math.max(1, Number(b.max_tentativas) || 3) };
    for (const [chave, valor] of Object.entries(values)) { const { error } = await db.from("notificacoes_config").upsert({ chave, valor: String(valor), tipo: typeof valor === "boolean" ? "boolean" : "number" }, { onConflict: "chave" }); if (error) return json({ erro: error.message }, 400); }
    return json({ config: values, mensagem: "Configurações salvas." });
   }
   return json({ erro: "Configuração inválida." }, 400);
  }
  if (request.method === "POST") {
   const b = await parse(request);
   if (!["verificar_atrasos", "verificar_momentos_especiais", "enviar_agora_todas"].includes(String(b.acao))) return json({ erro: "Ação inválida." }, 400);

   if (b.acao === "verificar_momentos_especiais") {
    // Régua D-2 / D-1 / D0: parcela ainda não vencida, dentro da janela dos
    // próximos 2 dias. Cancelamento é automático por desenho: a query já
    // exclui parcelas pagas (neq status pago), então uma parcela paga entre
    // execuções simplesmente deixa de aparecer — nenhum lembrete "pendente"
    // fica registrado para ser cancelado.
    const hoje = new Date().toISOString().slice(0, 10);
    const limite = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const { data: templates } = await db.from("notificacao_templates").select("id,dias_referencia,titulo,corpo,emoji").eq("tipo", "parcela_vencer").eq("is_active", true);
    const { data: boletos } = await db.from("boletos").select("id,cliente_id,numero_parcela,total_parcelas,valor,data_vencimento,clientes(nome_completo)").gte("data_vencimento", hoje).lte("data_vencimento", limite).neq("status", "pago");
    let enviados = 0, ignoradas = 0;
    for (const boleto of (boletos ?? []) as any[]) {
     const diasParaVencer = Math.round((new Date(`${boleto.data_vencimento}T12:00:00`).getTime() - new Date(`${hoje}T12:00:00`).getTime()) / 86400000);
     const template = (templates ?? []).find((t: any) => Number(t.dias_referencia) === diasParaVencer);
     if (!template) continue;
     const { data: recent } = await db.from("notificacao_logs").select("id").eq("cliente_id", boleto.cliente_id).eq("tipo", "parcela_vencer").eq("referencia_id", boleto.id).eq("titulo", template.titulo).limit(1);
     if (recent?.length) { ignoradas++; continue; }
     const nome = Array.isArray(boleto.clientes) ? boleto.clientes[0]?.nome_completo : boleto.clientes?.nome_completo;
     const corpo = String(template.corpo).replaceAll("{{cliente}}", nome ?? "cliente").replaceAll("{{parcela}}", String(boleto.numero_parcela ?? "—")).replaceAll("{{total}}", String(boleto.total_parcelas ?? "—")).replaceAll("{{vencimento}}", String(boleto.data_vencimento ?? "—")).replaceAll("{{valor}}", `R$ ${Number(boleto.valor ?? 0).toFixed(2).replace(".", ",")}`);
     const { error } = await db.from("notificacao_logs").insert({ cliente_id: boleto.cliente_id, tipo: "parcela_vencer", titulo: template.titulo, corpo, status: "enviada", referencia_id: boleto.id });
     if (!error) enviados++;
    }
    return json({ enviadas: enviados, ignoradas, falhas: 0, mensagem: `${enviados} lembrete(s) de vencimento registrado(s).` });
   }

   const { data: templates } = await db.from("notificacao_templates").select("id,dias_referencia,titulo,corpo,emoji").eq("tipo", "parcela_atrasada").eq("is_active", true).order("dias_referencia", { ascending: true });
   const { data: boletos } = await db.from("boletos").select("id,cliente_id,numero_parcela,total_parcelas,data_vencimento,clientes(nome_completo)").lt("data_vencimento", new Date().toISOString().slice(0, 10)).neq("status", "pago");
   let enviados = 0, ignoradas = 0;
   for (const boleto of (boletos ?? []) as any[]) {
    const dias = Math.floor((Date.now() - new Date(`${boleto.data_vencimento}T12:00:00`).getTime()) / 86400000);
    const template = (templates ?? []).filter((t:any) => Number(t.dias_referencia) <= dias).at(-1);
    if (!template) continue;
    if (b.acao === "verificar_atrasos") { const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); const { data: recent } = await db.from("notificacao_logs").select("id").eq("cliente_id", boleto.cliente_id).eq("tipo", "parcela_atrasada").eq("referencia_id", boleto.id).gte("created_at", cutoff).limit(1); if (recent?.length) { ignoradas++; continue; } }
    const nome = Array.isArray(boleto.clientes) ? boleto.clientes[0]?.nome_completo : boleto.clientes?.nome_completo;
    const corpo = String(template.corpo).replaceAll("{{cliente}}", nome ?? "cliente").replaceAll("{{parcela}}", String(boleto.numero_parcela ?? "—")).replaceAll("{{total}}", String(boleto.total_parcelas ?? "—")).replaceAll("{{vencimento}}", String(boleto.data_vencimento ?? "—")).replaceAll("{{dias_atraso}}", String(Math.max(dias, 0)));
    const { error } = await db.from("notificacao_logs").insert({ cliente_id: boleto.cliente_id, tipo: "parcela_atrasada", titulo: template.titulo, corpo, status: "enviada", referencia_id: boleto.id });
    if (!error) enviados++;
   }
   return json({ enviadas: enviados, ignoradas, falhas: 0, mensagem: `${enviados} notificação(ões) registrada(s).` });
  }
 }
 if (path === "/api/admin/notificacoes/templates" && request.method === "PATCH") {
  const b = await parse(request); if (!b.id) return json({ erro: "Template não informado." }, 400);
  const patch:any = {}; for (const k of ["titulo", "corpo", "emoji", "is_active"]) if (b[k] !== undefined) patch[k] = b[k];
  const { data, error } = await db.from("notificacao_templates").update(patch).eq("id", b.id).select("*").single(); if (error) return json({ erro: error.message }, 400); return json({ template: data, mensagem: "Template atualizado." });
 }
 if (path === "/api/admin/notificacoes/templates" && request.method === "POST") {
  const b = await parse(request);
  const tipo = String(b.tipo ?? "").trim(); const titulo = String(b.titulo ?? "").trim(); const corpo = String(b.corpo ?? "").trim();
  if (!tipo || !titulo || !corpo) return json({ erro: "Tipo, título e corpo são obrigatórios." }, 400);
  const { data, error } = await db.from("notificacao_templates").insert({ tipo, dias_referencia: b.diasReferencia != null ? Number(b.diasReferencia) : null, titulo, corpo, emoji: b.emoji ?? "💬", is_active: b.isActive !== false }).select("*").single();
  if (error) return json({ erro: error.message }, 400);
  return json({ template: data, mensagem: "Template criado." }, 201);
 }
 if (path === "/api/admin/notificacoes/enviar" && request.method === "POST") {
  const b = await parse(request); if (!b.clienteId || !b.titulo || !b.mensagem) return json({ erro: "Cliente, título e mensagem são obrigatórios." }, 400);
  const { data: cliente, error: ce } = await db.from("clientes").select("id,nome_completo").eq("id", b.clienteId).maybeSingle(); if (ce || !cliente) return json({ erro: "Cliente não encontrada." }, 404);
  const { data, error } = await db.from("notificacao_logs").insert({ cliente_id: b.clienteId, tipo: "manual", titulo: String(b.titulo).slice(0, 200), corpo: String(b.mensagem).slice(0, 5000), status: "enviada" }).select("*").single(); if (error) return json({ erro: error.message }, 400);
  return json({ notificacao: data, cliente: { nome: cliente.nome_completo }, push: { enviadas: 0, falhas: 0, removidas: 0, erros: [] }, mensagem: "Notificação registrada." });
 }
 return null;
}
