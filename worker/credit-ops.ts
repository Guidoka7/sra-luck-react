import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin, verificarTokenSessao } from "./session";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try { return await request.json(); } catch { return {}; }
}

function mesmaOrigem(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

async function exigirAdmin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const token = getCookie(request, "admin_session");
  const session = await verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET);
  return session?.adminId ?? null;
}

async function exigirCliente(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const token = getCookie(request, "cliente_session");
  const session = await verificarTokenSessao(token, env.CLIENTE_SESSION_SECRET);
  return session?.clienteId ?? null;
}

export async function creditOpsApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith("/api/admin/credit-ops/")) {
    const adminId = await exigirAdmin(request, env);
    if (!adminId) return json({ erro: "Sessão administrativa expirada." }, 401);
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method) && !mesmaOrigem(request)) {
      return json({ erro: "Requisição de origem não autorizada." }, 403);
    }
    const db = createServiceSupabaseClient(env);

    if (path === "/api/admin/credit-ops/contracts" && request.method === "GET") {
      const { data, error } = await db
        .from("contratos_credito")
        .select("*, clientes(id,nome_completo,cpf,telefone,email)")
        .order("created_at", { ascending: false });
      if (error) return json({ erro: error.message }, 500);
      return json({ contratos: data ?? [] });
    }

    if (path === "/api/admin/credit-ops/contracts" && request.method === "POST") {
      const b = await body(request);
      const clienteId = String(b.clienteId ?? "");
      const codigo = String(b.codigo ?? "").trim();
      const valor = Number(b.valorContrato ?? 0);
      if (!clienteId || !codigo || !(valor > 0)) return json({ erro: "Cliente, código e valor do contrato são obrigatórios." }, 400);
      const { data, error } = await db.from("contratos_credito").insert({
        cliente_id: clienteId,
        codigo,
        rd_deal_id: b.rdDealId || null,
        campanha: b.campanha || null,
        origem: b.origem || null,
        modalidade: b.modalidade === "100_boleto" ? "100_boleto" : "flex",
        valor_contrato: valor,
        percentual_minimo: Number(b.percentualMinimo ?? 60),
        etapa: "aguardando_conferencia",
      }).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ contrato: data }, 201);
    }

    const contract = path.match(/^\/api\/admin\/credit-ops\/contracts\/([^/]+)$/);
    if (contract && request.method === "PATCH") {
      const b = await body(request);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const map: Record<string, string> = {
        campanha: "campanha", origem: "origem", modalidade: "modalidade", etapa: "etapa",
        percentualMinimo: "percentual_minimo", saldoFinalApurado: "saldo_final_apurado",
        formaQuitacao: "forma_quitacao", pagarNoDiaTermos: "pagar_no_dia_termos",
        previsaoAtingirPercentual: "previsao_atingir_percentual", termosAssinadosEm: "termos_assinados_em",
        agendaCirurgicaLiberarEm: "agenda_cirurgica_liberar_em", cirurgiaEm: "cirurgia_em",
      };
      for (const [from, to] of Object.entries(map)) if (b[from] !== undefined) patch[to] = b[from];
      const { data, error } = await db.from("contratos_credito").update(patch).eq("id", decodeURIComponent(contract[1])).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ contrato: data });
    }

    if (path === "/api/admin/credit-ops/finance/daily" && request.method === "GET") {
      const day = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
      const start = `${day}T00:00:00.000Z`, end = `${day}T23:59:59.999Z`;
      const [paid, proofs, overdue, events] = await Promise.all([
        db.from("boletos").select("*, clientes(id,nome_completo)").gte("recebido_em", start).lte("recebido_em", end).order("recebido_em", { ascending: false }),
        db.from("comprovantes_pagamento").select("*, clientes(id,nome_completo), boletos(id,numero_parcela,total_parcelas,valor,banco_emissor)").in("status", ["aguardando_validacao", "em_analise"]).order("created_at", { ascending: false }).limit(200),
        db.from("boletos").select("*, clientes(id,nome_completo)").lt("data_vencimento", day).neq("status", "pago").order("data_vencimento", { ascending: true }).limit(200),
        db.from("conciliacao_financeira_eventos").select("*").gte("created_at", start).lte("created_at", end).order("created_at", { ascending: false }).limit(300),
      ]);
      const errors = [paid.error, proofs.error, overdue.error, events.error]
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
        .map((value) => value.message);
      return json({
        data: day,
        liquidados: paid.data ?? [],
        aguardandoValidacao: proofs.data ?? [],
        vencidos: overdue.data ?? [],
        eventos: events.data ?? [],
        erros: errors,
      });
    }

    if (path === "/api/admin/credit-ops/rewards" && request.method === "GET") {
      const { data, error } = await db.from("clube_recompensas").select("*").order("pontos", { ascending: true });
      if (error) return json({ erro: error.message }, 500);
      return json({ recompensas: data ?? [] });
    }

    if (path === "/api/admin/credit-ops/rewards" && request.method === "POST") {
      const b = await body(request);
      const { data, error } = await db.from("clube_recompensas").insert({
        titulo: b.titulo, descricao: b.descricao || null, categoria: b.categoria || null,
        pontos: Number(b.pontos), estoque: b.estoque === undefined ? null : Number(b.estoque), ativo: b.ativo !== false,
      }).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ recompensa: data }, 201);
    }

    if (path === "/api/admin/credit-ops/team" && request.method === "GET") {
      const [staff, rules, commissions, training] = await Promise.all([
        db.from("colaboradores").select("*").order("nome"),
        db.from("comissao_regras").select("*").eq("ativo", true).order("perfil"),
        db.from("comissao_eventos").select("*, colaboradores(nome,perfil)").order("created_at", { ascending: false }).limit(300),
        db.from("treinamentos").select("*").eq("ativo", true).order("created_at", { ascending: false }),
      ]);
      return json({ colaboradores: staff.data ?? [], regras: rules.data ?? [], comissoes: commissions.data ?? [], treinamentos: training.data ?? [] });
    }

    if (path === "/api/admin/credit-ops/team/commission-rules" && request.method === "POST") {
      const b = await body(request);
      const { data, error } = await db.from("comissao_regras").insert({
        perfil: b.perfil, nome: b.nome, tipo: b.tipo, valor: Number(b.valor),
        meta_base: b.metaBase === undefined ? null : Number(b.metaBase), configuracao: b.configuracao || {},
      }).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ regra: data }, 201);
    }

    if (path === "/api/admin/credit-ops/team/trainings" && request.method === "POST") {
      const b = await body(request);
      const { data, error } = await db.from("treinamentos").insert({
        titulo: b.titulo, descricao: b.descricao || null, tipo: b.tipo || "texto", conteudo_url: b.conteudoUrl || null,
        conteudo_texto: b.conteudoTexto || null, perfis: Array.isArray(b.perfis) ? b.perfis : ["todos"], obrigatorio: Boolean(b.obrigatorio),
      }).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ treinamento: data }, 201);
    }

    return null;
  }

  if (path.startsWith("/api/cliente/credit-ops/")) {
    const clienteId = await exigirCliente(request, env);
    if (!clienteId) return json({ erro: "Sessão expirada." }, 401);
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method) && !mesmaOrigem(request)) {
      return json({ erro: "Requisição de origem não autorizada." }, 403);
    }
    const db = createServiceSupabaseClient(env);

    if (path === "/api/cliente/credit-ops/summary" && request.method === "GET") {
      const { data: contrato, error } = await db.from("contratos_credito").select("*").eq("cliente_id", clienteId).neq("etapa", "cancelado").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) return json({ erro: error.message }, 500);
      if (!contrato) return json({ contrato: null });
      const { data: parcelas } = await db.from("boletos").select("id,numero_parcela,total_parcelas,valor,status,data_vencimento,data_pagamento,valor_recebido,comprovante_url,boleto_url,banco_emissor").eq("cliente_id", clienteId).order("numero_parcela");
      const recebidos = (parcelas ?? []).filter((p: any) => p.status === "pago").reduce((s: number, p: any) => s + Number(p.valor_recebido ?? p.valor ?? 0), 0);
      const percentual = Number(contrato.valor_contrato) > 0 ? Math.round((recebidos / Number(contrato.valor_contrato)) * 10000) / 100 : 0;
      return json({ contrato, parcelas: parcelas ?? [], recebido: recebidos, percentual });
    }

    if (path === "/api/cliente/credit-ops/club" && request.method === "GET") {
      const [{ data: saldo }, { data: rewards }, { data: history }] = await Promise.all([
        db.from("cliente_pontos").select("saldo").eq("cliente_id", clienteId).maybeSingle(),
        db.from("clube_recompensas").select("*").eq("ativo", true).order("pontos"),
        db.from("cliente_pontos_eventos").select("*").eq("cliente_id", clienteId).order("created_at", { ascending: false }).limit(50),
      ]);
      return json({ saldo: Number(saldo?.saldo ?? 0), recompensas: rewards ?? [], historico: history ?? [] });
    }

    if (path === "/api/cliente/credit-ops/referrals" && request.method === "POST") {
      const b = await body(request);
      const nome = String(b.nome ?? "").trim();
      if (!nome) return json({ erro: "Informe o nome da pessoa indicada." }, 400);
      const { data, error } = await db.from("indicacoes_clientes").insert({
        indicador_cliente_id: clienteId, nome_indicado: nome, telefone_indicado: b.telefone || null,
      }).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ indicacao: data }, 201);
    }

    if (path === "/api/cliente/credit-ops/redeem" && request.method === "POST") {
      const b = await body(request);
      const rewardId = String(b.recompensaId ?? "");
      if (!rewardId) return json({ erro: "Recompensa não informada." }, 400);
      const [{ data: reward, error: rewardError }, { data: points, error: pointsError }] = await Promise.all([
        db.from("clube_recompensas").select("*").eq("id", rewardId).eq("ativo", true).maybeSingle(),
        db.from("cliente_pontos").select("saldo").eq("cliente_id", clienteId).maybeSingle(),
      ]);
      if (rewardError || pointsError) return json({ erro: (rewardError ?? pointsError)?.message }, 500);
      if (!reward) return json({ erro: "Recompensa indisponível." }, 404);
      const current = Number(points?.saldo ?? 0), cost = Number(reward.pontos);
      if (current < cost) return json({ erro: "Saldo de pontos insuficiente." }, 400);
      const next = current - cost;
      const { error: upsertError } = await db.from("cliente_pontos").upsert({ cliente_id: clienteId, saldo: next, updated_at: new Date().toISOString() });
      if (upsertError) return json({ erro: upsertError.message }, 400);
      const { data: redeem, error: redeemError } = await db.from("clube_resgates").insert({ cliente_id: clienteId, recompensa_id: rewardId, pontos: cost }).select("*").single();
      if (redeemError) return json({ erro: redeemError.message }, 400);
      await db.from("cliente_pontos_eventos").insert({ cliente_id: clienteId, tipo: "resgate", pontos: -cost, referencia: redeem.id });
      return json({ resgate: redeem, saldo: next }, 201);
    }

    return null;
  }

  return null;
}
