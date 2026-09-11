import { createServiceSupabaseClient, type Env } from "./supabase";
import {
  clearStaffSessionCookie,
  criarTokenStaff,
  getCookie,
  setStaffSessionCookie,
  verificarTokenAdmin,
  verificarTokenStaff,
  type StaffSessionPayload,
} from "./session";

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
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

async function staffSession(request: Request, env: Env): Promise<StaffSessionPayload | null> {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  return verificarTokenStaff(getCookie(request, "staff_session"), env.CLIENTE_SESSION_SECRET);
}

async function isAdmin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return false;
  return Boolean(await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET));
}

export async function staffApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const db = createServiceSupabaseClient(env);

  if (path === "/api/equipe/auth" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
    if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
    const b = await parseBody(request);
    const email = String(b.email ?? "").trim().toLowerCase();
    const password = String(b.senha ?? "");
    if (!email || !password) return json({ erro: "Informe e-mail e senha." }, 400);
    const { data: auth, error: authError } = await db.auth.signInWithPassword({ email, password });
    if (authError || !auth.user) return json({ erro: "E-mail ou senha incorretos." }, 401);
    const { data: staff, error } = await db.from("colaboradores").select("id,nome,email,perfil,ativo").eq("auth_user_id", auth.user.id).maybeSingle();
    if (error || !staff || !staff.ativo) return json({ erro: "Seu acesso ao portal da equipe não está ativo." }, 403);
    const role = staff.perfil as StaffSessionPayload["role"];
    const token = await criarTokenStaff(staff.id, auth.user.id, role, env.CLIENTE_SESSION_SECRET);
    const secure = url.protocol === "https:";
    return json({ ok: true, colaborador: { id: staff.id, nome: staff.nome, perfil: role } }, 200, { "Set-Cookie": setStaffSessionCookie(token, secure) });
  }

  if (path === "/api/equipe/session" && request.method === "GET") {
    const session = await staffSession(request, env);
    return json(session ? { autenticado: true, perfil: session.role, colaboradorId: session.staffId } : { autenticado: false }, 200);
  }

  if (path === "/api/equipe/logout" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
    return json({ ok: true }, 200, { "Set-Cookie": clearStaffSessionCookie(url.protocol === "https:") });
  }

  if (path.startsWith("/api/equipe/")) {
    const session = await staffSession(request, env);
    if (!session) return json({ erro: "Sessão da equipe expirada." }, 401);

    if (path === "/api/equipe/me" && request.method === "GET") {
      const month = new Date().toISOString().slice(0, 7) + "-01";
      const next = new Date(`${month}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const nextMonth = next.toISOString().slice(0, 10);
      const [staff, commissions, rules, training, progress] = await Promise.all([
        db.from("colaboradores").select("id,nome,email,perfil,ativo").eq("id", session.staffId).single(),
        db.from("comissao_eventos").select("*").eq("colaborador_id", session.staffId).gte("competencia", month).lt("competencia", nextMonth).order("created_at", { ascending: false }),
        db.from("comissao_regras").select("*").eq("perfil", session.role).eq("ativo", true).order("vigencia_inicio", { ascending: false }),
        db.from("treinamentos").select("*").eq("ativo", true).order("created_at", { ascending: false }),
        db.from("treinamento_progresso").select("*").eq("colaborador_id", session.staffId),
      ]);
      if (staff.error) return json({ erro: staff.error.message }, 500);
      const allowedTraining = (training.data ?? []).filter((item: any) => {
        const roles = Array.isArray(item.perfis) ? item.perfis : ["todos"];
        return roles.includes("todos") || roles.includes(session.role);
      });
      const progressMap = new Map((progress.data ?? []).map((item: any) => [item.treinamento_id, item]));
      const commissionTotal = (commissions.data ?? []).filter((item: any) => item.status !== "cancelada").reduce((sum: number, item: any) => sum + Number(item.valor_comissao ?? 0), 0);
      return json({
        colaborador: staff.data,
        regraAtual: rules.data?.[0] ?? null,
        comissaoPrevista: commissionTotal,
        comissoes: commissions.data ?? [],
        treinamentos: allowedTraining.map((item: any) => ({ ...item, progresso: progressMap.get(item.id)?.progresso ?? 0, concluidoEm: progressMap.get(item.id)?.concluido_em ?? null })),
      });
    }

    const trainingMatch = path.match(/^\/api\/equipe\/trainings\/([^/]+)\/progress$/);
    if (trainingMatch && request.method === "PATCH") {
      if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
      const b = await parseBody(request);
      const value = Math.max(0, Math.min(100, Number(b.progresso ?? 0)));
      const { data, error } = await db.from("treinamento_progresso").upsert({
        treinamento_id: decodeURIComponent(trainingMatch[1]),
        colaborador_id: session.staffId,
        progresso: value,
        concluido_em: value >= 100 ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ progresso: data });
    }

    return null;
  }

  if (path.startsWith("/api/admin/staff")) {
    if (!(await isAdmin(request, env))) return json({ erro: "Sessão administrativa expirada." }, 401);
    if (["POST", "PATCH", "DELETE"].includes(request.method) && !sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);

    if (path === "/api/admin/staff" && request.method === "GET") {
      const { data, error } = await db.from("colaboradores").select("*").order("nome");
      if (error) return json({ erro: error.message }, 500);
      return json({ colaboradores: data ?? [] });
    }

    if (path === "/api/admin/staff" && request.method === "POST") {
      const b = await parseBody(request);
      const nome = String(b.nome ?? "").trim();
      const email = String(b.email ?? "").trim().toLowerCase();
      const perfil = String(b.perfil ?? "");
      const senhaTemporaria = String(b.senhaTemporaria ?? "");
      if (!nome || !email || !["vendedora", "sdr", "financeiro", "gestao", "admin"].includes(perfil)) return json({ erro: "Nome, e-mail e perfil são obrigatórios." }, 400);
      if (senhaTemporaria.length < 8) return json({ erro: "A senha temporária deve ter ao menos 8 caracteres." }, 400);
      const { data: auth, error: authError } = await db.auth.admin.createUser({ email, password: senhaTemporaria, email_confirm: true, user_metadata: { nome, tipo: "colaborador", perfil } });
      if (authError || !auth.user) return json({ erro: authError?.message ?? "Não foi possível criar o acesso." }, 400);
      const { data, error } = await db.from("colaboradores").insert({ auth_user_id: auth.user.id, nome, email, perfil, ativo: true }).select("*").single();
      if (error) {
        await db.auth.admin.deleteUser(auth.user.id).catch(() => undefined);
        return json({ erro: error.message }, 400);
      }
      return json({ colaborador: data }, 201);
    }

    const staffMatch = path.match(/^\/api\/admin\/staff\/([^/]+)$/);
    if (staffMatch && request.method === "PATCH") {
      const b = await parseBody(request);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.nome !== undefined) patch.nome = String(b.nome).trim();
      if (b.perfil !== undefined && ["vendedora", "sdr", "financeiro", "gestao", "admin"].includes(String(b.perfil))) patch.perfil = b.perfil;
      if (b.ativo !== undefined) patch.ativo = Boolean(b.ativo);
      const { data, error } = await db.from("colaboradores").update(patch).eq("id", decodeURIComponent(staffMatch[1])).select("*").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ colaborador: data });
    }

    return null;
  }

  return null;
}
