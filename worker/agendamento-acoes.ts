import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin, verificarTokenSessao } from "./session";

const CLIENTE_COOKIE = "cliente_session";
const ADMIN_COOKIE = "admin_session";
const HORARIOS_VALIDOS = new Set(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function clienteSessao(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  return verificarTokenSessao(getCookie(request, CLIENTE_COOKIE), env.CLIENTE_SESSION_SECRET);
}

async function adminSessao(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  return verificarTokenAdmin(getCookie(request, ADMIN_COOKIE), env.CLIENTE_SESSION_SECRET);
}

function erroRpc(error: any) {
  const mensagem = String(error?.message ?? "");
  if (mensagem.includes("AGENDAMENTO_NAO_DISPONIVEL")) return json({ erro: "O agendamento não está mais disponível para alteração." }, 409);
  if (mensagem.includes("DATA_INDISPONIVEL")) return json({ erro: "Essa data não está mais disponível." }, 409);
  if (mensagem.includes("VAGAS_ESGOTADAS")) return json({ erro: "As vagas dessa data acabaram de se esgotar." }, 409);
  if (mensagem.includes("HORARIO_INVALIDO")) return json({ erro: "Escolha um horário válido para a assinatura." }, 400);
  console.error("Falha na ação do agendamento:", error);
  return json({ erro: "Não foi possível atualizar o agendamento." }, 500);
}

export async function clienteAgendamentoAcao(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/cliente/agendamento/reagendar" && url.pathname !== "/api/cliente/agendamento/cancelar") return null;
  const sessao = await clienteSessao(request, env);
  if (!sessao) return json({ erro: "Sessão expirada." }, 401);
  const db = createServiceSupabaseClient(env);

  const { data: agendamento, error: buscaError } = await db
    .from("agendamentos")
    .select("id")
    .eq("cliente_id", sessao.clienteId)
    .eq("status", "confirmado")
    .maybeSingle();
  if (buscaError) return json({ erro: "Não foi possível localizar seu agendamento." }, 500);
  if (!agendamento) return json({ erro: "Não existe um agendamento confirmado para alterar." }, 409);

  if (url.pathname.endsWith("/cancelar")) {
    if (request.method !== "POST") return json({ erro: "Método não permitido." }, 405);
    const { error } = await db.rpc("cancelar_agendamento", { p_agendamento_id: agendamento.id });
    if (error) return erroRpc(error);
    return json({ ok: true, agendamentoId: agendamento.id, status: "cancelado" });
  }

  if (request.method !== "POST") return json({ erro: "Método não permitido." }, 405);
  let body: any;
  try { body = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const dataId = typeof body?.dataId === "string" ? body.dataId : "";
  const horario = typeof body?.horario === "string" ? body.horario : "";
  if (!dataId || !HORARIOS_VALIDOS.has(horario)) return json({ erro: "Escolha a nova data e o horário da assinatura." }, 400);

  const { data: id, error } = await db.rpc("remarcar_agendamento_termos", {
    p_agendamento_id: agendamento.id,
    p_data_id: dataId,
    p_horario_termos: horario,
  });
  if (error) return erroRpc(error);
  return json({ ok: true, agendamentoId: id, dataId, horario, status: "confirmado" });
}

export async function adminAgendamentoAcao(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/admin\/agendamentos\/([^/]+)$/);
  if (!match) return null;
  if (request.method !== "PATCH") return json({ erro: "Método não permitido." }, 405);
  if (!(await adminSessao(request, env))) return json({ erro: "Sessão administrativa expirada." }, 401);

  const agendamentoId = decodeURIComponent(match[1]);
  let body: any;
  try { body = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const acao = body?.acao;
  const db = createServiceSupabaseClient(env);

  if (acao === "confirmar_presenca") {
    const { error } = await db.rpc("confirmar_presenca_agendamento", { p_agendamento_id: agendamentoId });
    if (error) return erroRpc(error);
    return json({ ok: true, agendamentoId, status: "confirmado", presencaConfirmada: true });
  }

  if (acao === "cancelar") {
    const { error } = await db.rpc("cancelar_agendamento", { p_agendamento_id: agendamentoId });
    if (error) return erroRpc(error);
    return json({ ok: true, agendamentoId, status: "cancelado" });
  }

  if (acao === "reagendar") {
    const dataId = typeof body?.dataId === "string" ? body.dataId : "";
    const horario = typeof body?.horario === "string" ? body.horario : "";
    if (!dataId || !HORARIOS_VALIDOS.has(horario)) return json({ erro: "Escolha a nova data e o horário da assinatura." }, 400);
    const { data: id, error } = await db.rpc("remarcar_agendamento_termos", {
      p_agendamento_id: agendamentoId,
      p_data_id: dataId,
      p_horario_termos: horario,
    });
    if (error) return erroRpc(error);
    return json({ ok: true, agendamentoId: id, dataId, horario, status: "confirmado" });
  }

  return json({ erro: "Ação de agendamento inválida." }, 400);
}
