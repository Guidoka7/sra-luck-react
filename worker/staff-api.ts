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

type Cargo = StaffSessionPayload["role"];
type ColaboradorAtivo = {
  id: string;
  auth_user_id: string;
  nome: string;
  email: string;
  cargo: Cargo;
  ativo: true;
  permissoes: string[];
};

const CARGOS = new Set<Cargo>(["vendedora", "sdr", "financeiro", "administrativo"]);

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

function cargoValido(value: unknown): Cargo | null {
  const cargo = String(value ?? "") as Cargo;
  return CARGOS.has(cargo) ? cargo : null;
}

function permissoesValidas(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 100);
}

async function staffSessionAtiva(request: Request, env: Env): Promise<{ session: StaffSessionPayload; staff: ColaboradorAtivo } | null> {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenStaff(getCookie(request, "staff_session"), env.CLIENTE_SESSION_SECRET);
  if (!session) return null;

  const db = createServiceSupabaseClient(env);
  const { data, error } = await db
    .from("colaboradores")
    .select("id,auth_user_id,nome,email,cargo,ativo,permissoes")
    .eq("id", session.staffId)
    .eq("auth_user_id", session.authUserId)
    .maybeSingle();

  if (error) {
    console.error("Falha ao revalidar sessão da equipe:", error);
    return null;
  }
  if (!data || data.ativo !== true) return null;
  const cargo = cargoValido(data.cargo);
  if (!cargo || cargo !== session.role) return null;

  return {
    session,
    staff: {
      id: String(data.id),
      auth_user_id: String(data.auth_user_id),
      nome: String(data.nome),
      email: String(data.email),
      cargo,
      ativo: true,
      permissoes: Array.isArray(data.permissoes) ? data.permissoes.filter((item): item is string => typeof item === "string") : [],
    },
  };
}

async function adminAuthUserId(request: Request, env: Env): Promise<string | null> {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  return session?.adminId ?? null;
}

function proximoMes(competencia: string) {
  const date = new Date(`${competencia}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
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
    if (!email || !password || email.length > 320 || password.length > 1024) return json({ erro: "E-mail ou senha incorretos." }, 401);

    const { data: auth, error: authError } = await db.auth.signInWithPassword({ email, password });
    if (authError || !auth.user) return json({ erro: "E-mail ou senha incorretos." }, 401);

    const { data: staff, error } = await db
      .from("colaboradores")
      .select("id,nome,email,cargo,ativo,permissoes")
      .eq("auth_user_id", auth.user.id)
      .maybeSingle();
    const cargo = cargoValido(staff?.cargo);
    if (error || !staff || !staff.ativo || !cargo) return json({ erro: "Seu acesso ao portal da equipe não está ativo." }, 403);

    const token = await criarTokenStaff(String(staff.id), auth.user.id, cargo, env.CLIENTE_SESSION_SECRET);
    const secure = url.protocol === "https:";
    return json({
      ok: true,
      colaborador: { id: staff.id, nome: staff.nome, cargo, permissoes: staff.permissoes ?? [] },
    }, 200, { "Set-Cookie": setStaffSessionCookie(token, secure) });
  }

  if (path === "/api/equipe/session" && request.method === "GET") {
    const active = await staffSessionAtiva(request, env);
    return json(active ? {
      autenticado: true,
      cargo: active.staff.cargo,
      colaboradorId: active.staff.id,
    } : { autenticado: false }, 200);
  }

  if (path === "/api/equipe/logout" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
    return json({ ok: true }, 200, { "Set-Cookie": clearStaffSessionCookie(url.protocol === "https:") });
  }

  if (path.startsWith("/api/equipe/")) {
    const active = await staffSessionAtiva(request, env);
    if (!active) return json({ erro: "Sessão da equipe expirada ou acesso desativado." }, 401);
    const { staff } = active;

    if (path === "/api/equipe/me" && request.method === "GET") {
      const competencia = `${new Date().toISOString().slice(0, 7)}-01`;
      const fimCompetencia = proximoMes(competencia);
      const hoje = new Date().toISOString().slice(0, 10);

      const [commissions, rules, training, progress] = await Promise.all([
        db.from("comissao_eventos").select("id,regra_id,referencia_tipo,referencia_id,base_calculo,valor_comissao,status,competencia,metadata,created_at").eq("colaborador_id", staff.id).gte("competencia", competencia).lt("competencia", fimCompetencia).order("created_at", { ascending: false }),
        db.from("comissao_regras").select("id,cargo,nome,tipo,valor,meta_base,configuracao,ativo,vigencia_inicio,vigencia_fim").eq("cargo", staff.cargo).eq("ativo", true).lte("vigencia_inicio", hoje).order("vigencia_inicio", { ascending: false }),
        db.from("treinamentos").select("id,titulo,descricao,tipo,conteudo_url,conteudo_texto,cargos,obrigatorio,ativo,created_at,updated_at").eq("ativo", true).order("created_at", { ascending: false }),
        db.from("treinamento_progresso").select("treinamento_id,progresso,concluido_em,updated_at").eq("colaborador_id", staff.id),
      ]);

      const queryError = commissions.error ?? rules.error ?? training.error ?? progress.error;
      if (queryError) {
        console.error("Falha ao carregar portal da equipe:", queryError);
        return json({ erro: "Não foi possível carregar os dados da equipe agora." }, 503);
      }

      const regraAtual = (rules.data ?? []).find((item: any) => !item.vigencia_fim || item.vigencia_fim >= hoje) ?? null;
      const allowedTraining = (training.data ?? []).filter((item: any) => {
        const cargos = Array.isArray(item.cargos) ? item.cargos : [];
        return cargos.length === 0 || cargos.includes(staff.cargo);
      });
      const progressMap = new Map((progress.data ?? []).map((item: any) => [item.treinamento_id, item]));
      const events = commissions.data ?? [];
      const validEvents = events.filter((item: any) => item.status !== "cancelada");
      const commissionTotal = validEvents.reduce((sum: number, item: any) => sum + Number(item.valor_comissao ?? 0), 0);
      const basePeriodo = validEvents.reduce((sum: number, item: any) => sum + Number(item.base_calculo ?? 0), 0);

      return json({
        colaborador: {
          id: staff.id,
          nome: staff.nome,
          email: staff.email,
          cargo: staff.cargo,
          permissoes: staff.permissoes,
        },
        regraAtual,
        competencia,
        comissaoPrevista: commissionTotal,
        basePeriodo,
        metricas: {
          eventos: validEvents.length,
          validados: validEvents.filter((item: any) => item.status === "validada").length,
          pagos: validEvents.filter((item: any) => item.status === "paga").length,
        },
        comissoes: events,
        treinamentos: allowedTraining.map((item: any) => ({
          ...item,
          progresso: Number(progressMap.get(item.id)?.progresso ?? 0),
          concluidoEm: progressMap.get(item.id)?.concluido_em ?? null,
        })),
      });
    }

    const trainingMatch = path.match(/^\/api\/equipe\/trainings\/([^/]+)\/progress$/);
    if (trainingMatch && request.method === "PATCH") {
      if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
      const trainingId = decodeURIComponent(trainingMatch[1]);
      const { data: treinamento, error: trainingError } = await db.from("treinamentos").select("id,cargos,ativo").eq("id", trainingId).maybeSingle();
      if (trainingError) return json({ erro: "Não foi possível validar o treinamento." }, 500);
      const cargos = Array.isArray(treinamento?.cargos) ? treinamento.cargos : [];
      if (!treinamento || !treinamento.ativo || (cargos.length > 0 && !cargos.includes(staff.cargo))) return json({ erro: "Treinamento não disponível para seu acesso." }, 403);

      const b = await parseBody(request);
      const value = Math.max(0, Math.min(100, Number(b.progresso ?? 0)));
      if (!Number.isFinite(value)) return json({ erro: "Progresso inválido." }, 400);
      const { data, error } = await db.from("treinamento_progresso").upsert({
        treinamento_id: trainingId,
        colaborador_id: staff.id,
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
    const adminId = await adminAuthUserId(request, env);
    if (!adminId) return json({ erro: "Sessão administrativa expirada." }, 401);
    if (["POST", "PATCH", "DELETE"].includes(request.method) && !sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);

    if (path === "/api/admin/staff" && request.method === "GET") {
      const { data, error } = await db.from("colaboradores").select("id,nome,email,cargo,ativo,permissoes,created_at,updated_at").order("nome");
      if (error) return json({ erro: error.message }, 500);
      return json({ colaboradores: data ?? [] });
    }

    if (path === "/api/admin/staff" && request.method === "POST") {
      const b = await parseBody(request);
      const nome = String(b.nome ?? "").trim();
      const email = String(b.email ?? "").trim().toLowerCase();
      const cargo = cargoValido(b.cargo ?? b.perfil);
      const senhaTemporaria = String(b.senhaTemporaria ?? "");
      const permissoes = permissoesValidas(b.permissoes) ?? [];
      if (!nome || !email || !cargo) return json({ erro: "Nome, e-mail e cargo são obrigatórios." }, 400);
      if (senhaTemporaria.length < 8) return json({ erro: "A senha temporária deve ter ao menos 8 caracteres." }, 400);

      const { data: auth, error: authError } = await db.auth.admin.createUser({
        email,
        password: senhaTemporaria,
        email_confirm: true,
        user_metadata: { nome, tipo: "colaborador", cargo },
      });
      if (authError || !auth.user) return json({ erro: authError?.message ?? "Não foi possível criar o acesso." }, 400);

      const { data, error } = await db.from("colaboradores").insert({
        auth_user_id: auth.user.id,
        nome,
        email,
        cargo,
        permissoes,
        ativo: true,
      }).select("id,nome,email,cargo,ativo,permissoes,created_at,updated_at").single();
      if (error) {
        await db.auth.admin.deleteUser(auth.user.id).catch(() => undefined);
        return json({ erro: error.message }, 400);
      }
      return json({ colaborador: data }, 201);
    }

    const staffMatch = path.match(/^\/api\/admin\/staff\/([^/]+)$/);
    if (staffMatch && request.method === "PATCH") {
      const id = decodeURIComponent(staffMatch[1]);
      const b = await parseBody(request);
      const { data: atual, error: atualError } = await db.from("colaboradores").select("id,auth_user_id,cargo,ativo").eq("id", id).maybeSingle();
      if (atualError || !atual) return json({ erro: "Colaborador não encontrado." }, 404);

      const novoCargo = b.cargo !== undefined || b.perfil !== undefined ? cargoValido(b.cargo ?? b.perfil) : null;
      if ((b.cargo !== undefined || b.perfil !== undefined) && !novoCargo) return json({ erro: "Cargo inválido." }, 400);
      const novoAtivo = b.ativo !== undefined ? Boolean(b.ativo) : Boolean(atual.ativo);
      if (String(atual.auth_user_id) === adminId && (!novoAtivo || (novoCargo && novoCargo !== "administrativo"))) {
        return json({ erro: "Você não pode remover o próprio acesso administrativo." }, 409);
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.nome !== undefined) {
        const nome = String(b.nome).trim();
        if (!nome) return json({ erro: "Nome inválido." }, 400);
        patch.nome = nome;
      }
      if (novoCargo) patch.cargo = novoCargo;
      if (b.ativo !== undefined) patch.ativo = novoAtivo;
      const permissoes = permissoesValidas(b.permissoes);
      if (permissoes !== null) patch.permissoes = permissoes;

      const { data, error } = await db.from("colaboradores").update(patch).eq("id", id).select("id,nome,email,cargo,ativo,permissoes,created_at,updated_at").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ colaborador: data });
    }

    return null;
  }

  return null;
}
