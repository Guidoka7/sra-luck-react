import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin, verificarTokenSessao } from "./session";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try { return await request.json(); } catch { return {}; }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

async function adminId(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  return session?.adminId ?? null;
}

async function clientId(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenSessao(getCookie(request, "cliente_session"), env.CLIENTE_SESSION_SECRET);
  return session?.clienteId ?? null;
}

async function activeContract(db: ReturnType<typeof createServiceSupabaseClient>, clienteId: string) {
  const { data, error } = await db
    .from("contratos_credito")
    .select("*")
    .eq("cliente_id", clienteId)
    .neq("etapa", "cancelado")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function financialProgress(db: ReturnType<typeof createServiceSupabaseClient>, contract: any) {
  const { data: parcelas, error } = await db
    .from("boletos")
    .select("id,status,valor,valor_recebido,data_vencimento,numero_parcela,total_parcelas,boleto_url,comprovante_url,banco_emissor")
    .eq("contrato_credito_id", contract.id)
    .order("numero_parcela");
  if (error) throw error;
  const paid = (parcelas ?? [])
    .filter((p: any) => p.status === "pago")
    .reduce((sum: number, p: any) => sum + Number(p.valor_recebido ?? p.valor ?? 0), 0);
  const total = Number(contract.valor_contrato ?? 0);
  const percent = total > 0 ? Math.round((paid / total) * 10000) / 100 : 0;
  return { parcelas: parcelas ?? [], paid, total, percent, remaining: Math.max(0, total - paid) };
}

export async function journeyApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const mutating = ["POST", "PATCH", "PUT", "DELETE"].includes(request.method);
  if (mutating && !sameOrigin(request) && (path.startsWith("/api/admin/journey/") || path.startsWith("/api/cliente/journey"))) {
    return json({ erro: "Requisição de origem não autorizada." }, 403);
  }

  if (path.startsWith("/api/admin/journey/")) {
    const userId = await adminId(request, env);
    if (!userId) return json({ erro: "Sessão administrativa expirada." }, 401);
    const db = createServiceSupabaseClient(env);

    if (path === "/api/admin/journey/windows" && request.method === "GET") {
      const tipo = url.searchParams.get("tipo");
      let query = db.from("agenda_janelas").select("*").gte("data", new Date().toISOString().slice(0, 10)).order("data").order("horario_inicio");
      if (tipo === "termos" || tipo === "cirurgia") query = query.eq("tipo", tipo);
      const { data, error } = await query;
      if (error) return json({ erro: error.message }, 500);
      return json({ janelas: data ?? [] });
    }

    if (path === "/api/admin/journey/windows" && request.method === "POST") {
      const b = await parseBody(request);
      const tipo = b.tipo === "cirurgia" ? "cirurgia" : "termos";
      const data = String(b.data ?? "");
      const inicio = String(b.horarioInicio ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(inicio)) return json({ erro: "Data e horário são obrigatórios." }, 400);
      const { data: created, error } = await db.from("agenda_janelas").insert({
        tipo,
        data,
        horario_inicio: inicio,
        horario_fim: b.horarioFim || null,
        vagas: Math.max(1, Number(b.vagas ?? 1)),
        status: "disponivel",
        observacao: b.observacao || null,
      }).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ janela: created }, 201);
    }

    const windowMatch = path.match(/^\/api\/admin\/journey\/windows\/([^/]+)$/);
    if (windowMatch && request.method === "PATCH") {
      const b = await parseBody(request);
      const patch: Record<string, unknown> = {};
      if (b.status !== undefined) patch.status = b.status;
      if (b.vagas !== undefined) patch.vagas = Math.max(0, Number(b.vagas));
      if (b.observacao !== undefined) patch.observacao = b.observacao || null;
      const { data, error } = await db.from("agenda_janelas").update(patch).eq("id", decodeURIComponent(windowMatch[1])).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ janela: data });
    }

    const financialReview = path.match(/^\/api\/admin\/journey\/contracts\/([^/]+)\/financial-review$/);
    if (financialReview && request.method === "PATCH") {
      const b = await parseBody(request);
      const contractId = decodeURIComponent(financialReview[1]);
      const forms = Array.isArray(b.formasQuitacao) ? b.formasQuitacao.filter((x): x is string => typeof x === "string") : [];
      const balance = Number(b.saldoFinal ?? 0);
      if (!(balance >= 0) || forms.length === 0) return json({ erro: "Informe o saldo final e ao menos uma forma de pagamento." }, 400);
      const { data, error } = await db.from("contratos_credito").update({
        saldo_final_apurado: balance,
        formas_quitacao_disponiveis: forms,
        levantamento_aprovado_em: new Date().toISOString(),
        observacao_levantamento: b.observacao || null,
        etapa: "forma_pagamento_liberada",
        updated_at: new Date().toISOString(),
      }).eq("id", contractId).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ contrato: data });
    }

    const termsSigned = path.match(/^\/api\/admin\/journey\/contracts\/([^/]+)\/terms-signed$/);
    if (termsSigned && request.method === "POST") {
      const contractId = decodeURIComponent(termsSigned[1]);
      const b = await parseBody(request);
      const signedAt = typeof b.assinadoEm === "string" ? b.assinadoEm : new Date().toISOString();
      const { data: current, error: currentError } = await db.from("contratos_credito").select("quitado_em").eq("id", contractId).single();
      if (currentError) return json({ erro: currentError.message }, 404);
      const { data, error } = await db.from("contratos_credito").update({
        termos_assinados_em: signedAt,
        etapa: current?.quitado_em ? "quitado" : "aguardando_quitacao",
        updated_at: new Date().toISOString(),
      }).eq("id", contractId).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ contrato: data });
    }

    const settle = path.match(/^\/api\/admin\/journey\/contracts\/([^/]+)\/settle$/);
    if (settle && request.method === "POST") {
      const contractId = decodeURIComponent(settle[1]);
      const b = await parseBody(request);
      const settledAt = typeof b.quitadoEm === "string" ? b.quitadoEm : new Date().toISOString();
      const { data, error } = await db.from("contratos_credito").update({
        quitado_em: settledAt,
        etapa: "quitado",
        updated_at: new Date().toISOString(),
      }).eq("id", contractId).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ contrato: data });
    }

    if (path === "/api/admin/journey/refresh-releases" && request.method === "POST") {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await db.from("contratos_credito").update({ etapa: "agenda_cirurgica_liberada", updated_at: new Date().toISOString() })
        .eq("etapa", "quitado").lte("agenda_cirurgica_liberar_em", today).select("id,cliente_id,agenda_cirurgica_liberar_em");
      if (error) return json({ erro: error.message }, 500);
      return json({ liberados: data ?? [] });
    }

    return null;
  }

  if (path === "/api/cliente/journey" || path.startsWith("/api/cliente/journey/")) {
    const clienteId = await clientId(request, env);
    if (!clienteId) return json({ erro: "Sessão expirada." }, 401);
    const db = createServiceSupabaseClient(env);
    let contract: any;
    try { contract = await activeContract(db, clienteId); } catch (error: any) { return json({ erro: error?.message ?? "Erro ao buscar contrato." }, 500); }
    if (!contract) return json({ contrato: null }, 404);

    if (path === "/api/cliente/journey" && request.method === "GET") {
      const today = new Date().toISOString().slice(0, 10);
      if (contract.etapa === "quitado" && contract.agenda_cirurgica_liberar_em && contract.agenda_cirurgica_liberar_em <= today) {
        const { data: refreshed } = await db.from("contratos_credito").update({ etapa: "agenda_cirurgica_liberada", updated_at: new Date().toISOString() }).eq("id", contract.id).select("*").single();
        if (refreshed) contract = refreshed;
      }
      try {
        const progress = await financialProgress(db, contract);
        return json({ contrato: contract, ...progress });
      } catch (error: any) { return json({ erro: error?.message ?? "Erro ao calcular progresso." }, 500); }
    }

    if (path === "/api/cliente/journey/request-terms" && request.method === "POST") {
      let progress;
      try { progress = await financialProgress(db, contract); } catch (error: any) { return json({ erro: error?.message ?? "Erro ao calcular progresso." }, 500); }
      if (progress.percent + 0.0001 < Number(contract.percentual_minimo)) {
        return json({ erro: `O percentual mínimo de ${contract.percentual_minimo}% ainda não foi atingido.` }, 409);
      }
      const today = new Date().toISOString().slice(0, 10);
      const { data: deadlineData } = await db.rpc("adicionar_dias_uteis", { p_data: today, p_dias: 5 });
      const { data, error } = await db.from("contratos_credito").update({
        etapa: "levantamento_financeiro",
        data_atingiu_percentual: contract.data_atingiu_percentual || new Date().toISOString(),
        levantamento_iniciado_em: new Date().toISOString(),
        levantamento_prazo_ate: deadlineData || null,
        updated_at: new Date().toISOString(),
      }).eq("id", contract.id).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ contrato: data, prazoAte: deadlineData });
    }

    if (path === "/api/cliente/journey/payment-choice" && request.method === "POST") {
      const b = await parseBody(request);
      const choice = String(b.forma ?? "");
      const allowed = Array.isArray(contract.formas_quitacao_disponiveis) ? contract.formas_quitacao_disponiveis : [];
      if (contract.etapa !== "forma_pagamento_liberada" && contract.etapa !== "termos_agendados") return json({ erro: "As formas de pagamento ainda não foram liberadas." }, 409);
      if (!allowed.includes(choice)) return json({ erro: "Forma de pagamento indisponível para este contrato." }, 400);
      const { data, error } = await db.from("contratos_credito").update({
        forma_quitacao: choice,
        pagar_no_dia_termos: b.quando === "dia_termos",
        escolha_forma_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", contract.id).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ contrato: data });
    }

    if (path === "/api/cliente/journey/windows" && request.method === "GET") {
      const tipo = url.searchParams.get("tipo") === "cirurgia" ? "cirurgia" : "termos";
      if (tipo === "termos" && !["forma_pagamento_liberada", "termos_agendados"].includes(contract.etapa)) return json({ janelas: [], bloqueado: true });
      if (tipo === "cirurgia") {
        const today = new Date().toISOString().slice(0, 10);
        if (!["agenda_cirurgica_liberada", "cirurgia_agendada"].includes(contract.etapa) || !contract.agenda_cirurgica_liberar_em || contract.agenda_cirurgica_liberar_em > today) {
          return json({ janelas: [], bloqueado: true, liberarEm: contract.agenda_cirurgica_liberar_em ?? null });
        }
      }
      const { data: windows, error } = await db.from("agenda_janelas").select("*").eq("tipo", tipo).eq("status", "disponivel").gte("data", new Date().toISOString().slice(0, 10)).order("data").order("horario_inicio");
      if (error) return json({ erro: error.message }, 500);
      const ids = (windows ?? []).map((w: any) => w.id);
      const { data: bookings } = ids.length ? await db.from("agenda_reservas_credito").select("janela_id").in("janela_id", ids).in("status", ["agendado", "confirmado"]) : { data: [] as any[] };
      const count = new Map<string, number>();
      for (const booking of bookings ?? []) count.set(booking.janela_id, (count.get(booking.janela_id) ?? 0) + 1);
      return json({ janelas: (windows ?? []).map((w: any) => ({ ...w, vagasRestantes: Math.max(0, Number(w.vagas) - (count.get(w.id) ?? 0)) })).filter((w: any) => w.vagasRestantes > 0) });
    }

    if (path === "/api/cliente/journey/schedule" && request.method === "POST") {
      const b = await parseBody(request);
      const tipo = b.tipo === "cirurgia" ? "cirurgia" : "termos";
      const janelaId = String(b.janelaId ?? "");
      if (!janelaId) return json({ erro: "Escolha uma data e horário." }, 400);
      const { data: reservaId, error } = await db.rpc("reservar_janela_credito", { p_contrato_id: contract.id, p_janela_id: janelaId, p_tipo: tipo });
      if (error) {
        const message = error.message || "";
        if (message.includes("VAGAS_ESGOTADAS")) return json({ erro: "Esse horário acabou de ser ocupado. Escolha outro." }, 409);
        if (message.includes("NAO_LIBERADA") || message.includes("NAO_LIBERADOS") || message.includes("PRAZO_CIRURGICO")) return json({ erro: "Esta agenda ainda não está liberada para o seu contrato." }, 409);
        return json({ erro: "Não foi possível confirmar o agendamento." }, 400);
      }
      return json({ ok: true, reservaId, tipo });
    }

    return null;
  }

  return null;
}
