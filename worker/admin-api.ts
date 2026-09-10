import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin } from "./session";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

async function exigirAdmin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
  const token = getCookie(request, "admin_session");
  return (await verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET)) ? null : json({ erro: "Sessão administrativa expirada." }, 401);
}

export async function adminApi(request: Request, env: Env): Promise<Response | null> {
  const auth = await exigirAdmin(request, env);
  if (auth) return auth;
  const supabase = createServiceSupabaseClient(env);
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/admin/clientes" && request.method === "GET") {
    const { data, error } = await supabase.from("clientes").select("*").order("nome_completo", { ascending: true });
    if (error) return json({ erro: error.message }, 500);
    return json({ clientes: data ?? [] });
  }

  const clienteMatch = path.match(/^\/api\/admin\/clientes\/([^/]+)\/(boletos|parcelas)$/);
  if (clienteMatch && request.method === "GET") {
    const clienteId = decodeURIComponent(clienteMatch[1]);
    const { data, error } = await supabase.from("boletos").select("id, cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status, comprovante_url, boleto_url, data_pagamento, observacoes, suspensa, suspensa_em, suspensa_por, created_at, updated_at").eq("cliente_id", clienteId).order("numero_parcela", { ascending: true });
    if (error) return json({ erro: error.message }, 500);
    return json({ boletos: data ?? [], parcelas: data ?? [] });
  }

  if (path === "/api/admin/boletos" && request.method === "GET") {
    let query = supabase.from("boletos").select("id, cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status, comprovante_url, boleto_url, data_pagamento, observacoes, suspensa, suspensa_em, suspensa_por, created_at, updated_at, clientes ( id, nome_completo, cpf )").order("created_at", { ascending: false });
    const status = url.searchParams.get("status");
    const clienteId = url.searchParams.get("cliente_id");
    if (status && status !== "todos") query = query.eq("status", status);
    if (clienteId) query = query.eq("cliente_id", clienteId);
    const { data, error } = await query;
    if (error) return json({ erro: error.message }, 500);
    return json({ boletos: (data ?? []).map((item) => ({ ...item, valor: Number(item.valor) })) });
  }

  if (path === "/api/admin/datas" && request.method === "GET") {
    const ano = Number(url.searchParams.get("ano"));
    const mes = Number(url.searchParams.get("mes"));
    let query = supabase.from("datas").select("*").order("data", { ascending: true });
    if (Number.isInteger(ano) && Number.isInteger(mes) && mes >= 1 && mes <= 12) {
      const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
      const fim = new Date(ano, mes, 0).toISOString().slice(0, 10);
      query = query.gte("data", inicio).lte("data", fim);
    }
    const { data, error } = await query;
    if (error) return json({ erro: error.message }, 500);
    const datas = data ?? [];
    return json({ datas: datas.map((d) => ({ ...d, vagasOcupadas: 0, clientes: [] })) });
  }

  if (path === "/api/admin/configuracoes" && request.method === "GET") {
    const { data, error } = await supabase.from("configuracoes").select("*").eq("id", 1).maybeSingle();
    if (error) return json({ erro: error.message }, 500);
    return json({ configuracoes: data ?? null });
  }

  if (path === "/api/admin/agenda-mensal" && request.method === "GET") {
    const ano = Number(url.searchParams.get("ano")) || new Date().getFullYear();
    const mes = Number(url.searchParams.get("mes")) || new Date().getMonth() + 1;
    const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
    const fim = new Date(ano, mes, 0).toISOString().slice(0, 10);
    const { data, error } = await supabase.from("agendamentos").select("*, datas!inner(data), clientes(id,nome_completo,cpf)").gte("datas.data", inicio).lte("datas.data", fim).order("created_at", { ascending: true });
    if (error) return json({ erro: error.message }, 500);
    return json({ agendamentos: data ?? [], dados: data ?? [] });
  }

  if (path === "/api/admin/remarcacoes" && request.method === "GET") {
    const { data, error } = await supabase.from("remarcacoes").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) return json({ remarcacoes: [] });
    return json({ remarcacoes: data ?? [] });
  }

  if (path === "/api/admin/datas-liberacao-financeira" && request.method === "GET") {
    const { data, error } = await supabase.from("datas_liberacao_financeira").select("*").order("data", { ascending: true });
    if (error) return json({ erro: error.message }, 500);
    return json({ datas: data ?? [] });
  }

  if (path === "/api/admin/previsoes-liberacao" && request.method === "GET") {
    const { data, error } = await supabase.from("agendamentos").select("id, cliente_id, previsao_liberacao_financeira, status, clientes(id,nome_completo,cpf)").not("previsao_liberacao_financeira", "is", null).order("previsao_liberacao_financeira", { ascending: true });
    if (error) return json({ previsoes: [] });
    return json({ previsoes: data ?? [] });
  }

  return null;
}
