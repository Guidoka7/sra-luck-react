import { createServiceSupabaseClient, type Env } from "./supabase";
import {
  clearStaffSessionCookie,
  criarTokenStaff,
  getCookie,
  setStaffSessionCookie,
  verificarTokenStaff,
  type StaffSessionPayload,
} from "./session";
import { exigirPermissaoAdmin, PERMISSOES_ADMIN } from "./admin-auth";
import { hmacFingerprint, verifyTurnstile } from "./security";
import { pseudonymizeActorId, requestLogger } from "./logger";

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

const CARGOS = new Set<Cargo>(["vendedora", "sdr", "financeiro", "gestao", "administrativo"]);
const MAX_TENTATIVAS = 8;
const JANELA_SEGUNDOS = 15 * 60;

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try { return await request.json(); } catch { return {}; }
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
  const { data, error } = await db.from("colaboradores")
    .select("id,auth_user_id,nome,email,cargo,ativo,permissoes")
    .eq("id", session.staffId)
    .eq("auth_user_id", session.authUserId)
    .maybeSingle();
  if (error) {
    requestLogger(request).error("Falha ao revalidar sessão da equipe", { action: "staff.session.revalidate", actorType: "staff", actorId: await pseudonymizeActorId(session.staffId, env), eventCode: "STAFF_SESSION_REVALIDATE_FAILED", error });
    return null;
  }
  if (!data || data.ativo !== true) return null;
  const cargo = cargoValido(data.cargo);
  if (!cargo || cargo !== session.role) return null;
  return {
    session,
    staff: {
      id: String(data.id), auth_user_id: String(data.auth_user_id), nome: String(data.nome), email: String(data.email), cargo, ativo: true,
      permissoes: Array.isArray(data.permissoes) ? data.permissoes.filter((item): item is string => typeof item === "string") : [],
    },
  };
}

async function loginKeys(request: Request, env: Env, email: string) {
  const secret = env.CLIENTE_SESSION_SECRET!;
  const ip = request.headers.get("CF-Connecting-IP")?.trim() || request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return [
    `staff-login:ip:${await hmacFingerprint(ip, secret)}`,
    `staff-login:id:${await hmacFingerprint(email, secret)}`,
  ];
}

async function permitido(db: ReturnType<typeof createServiceSupabaseClient>, keys: string[]) {
  for (const key of keys) {
    const { data, error } = await db.rpc("login_pode_tentar", { p_chave: key, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
    if (error) throw error;
    if (!Boolean(data)) return false;
  }
  return true;
}
async function registrarFalha(db: ReturnType<typeof createServiceSupabaseClient>, keys: string[]) {
  for (const key of keys) await db.rpc("login_registrar_falha", { p_chave: key, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
}
async function limpar(db: ReturnType<typeof createServiceSupabaseClient>, keys: string[]) {
  for (const key of keys) await db.rpc("login_limpar_rate_limit", { p_chave: key });
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
    if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
    const b = await parseBody(request);
    const email = String(b.email ?? "").trim().toLowerCase();
    const password = String(b.senha ?? "");
    if (!email || !password || email.length > 320 || password.length > 1024) return json({ erro: "E-mail ou senha incorretos." }, 401);

    const bot = await verifyTurnstile(request, env, typeof b.turnstileToken === "string" ? b.turnstileToken : null);
    if (!bot.ok) return json({ erro: bot.erro }, bot.status);

    const log = requestLogger(request).child({ action: "staff.auth.login", actorType: "anonymous" });
    const keys = await loginKeys(request, env, email);
    try {
      if (!(await permitido(db, keys))) return json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, 429);
      const { data: auth, error: authError } = await db.auth.signInWithPassword({ email, password });
      if (authError || !auth.user) {
        await registrarFalha(db, keys);
        log.warn("Login da equipe recusado", { eventCode: "STAFF_LOGIN_DENIED", statusCode: 401 });
        return json({ erro: "E-mail ou senha incorretos." }, 401);
      }

      const { data: staff, error } = await db.from("colaboradores")
        .select("id,nome,email,cargo,ativo,permissoes")
        .eq("auth_user_id", auth.user.id)
        .maybeSingle();
      const cargo = cargoValido(staff?.cargo);
      if (error || !staff || !staff.ativo || !cargo) {
        await registrarFalha(db, keys);
        log.warn("Login da equipe sem autorização ativa", { eventCode: "STAFF_LOGIN_NOT_AUTHORIZED", statusCode: 401 });
        return json({ erro: "E-mail ou senha incorretos." }, 401);
      }

      await limpar(db, keys);
      const token = await criarTokenStaff(String(staff.id), auth.user.id, cargo, env.CLIENTE_SESSION_SECRET);
      log.child({ actorType: "staff", actorId: await pseudonymizeActorId(String(staff.id), env) }).info("Login da equipe concluído", { eventCode: "STAFF_LOGIN_OK" });
      return json({ ok: true, colaborador: { nome: staff.nome, cargo, permissoes: staff.permissoes ?? [] } }, 200, { "Set-Cookie": setStaffSessionCookie(token, url.protocol === "https:") });
    } catch (error) {
      log.error("Falha técnica no login da equipe", { eventCode: "STAFF_LOGIN_FAILED", statusCode: 503, error });
      return json({ erro: "Não foi possível validar o acesso agora." }, 503);
    }
  }

  if (path === "/api/equipe/session" && request.method === "GET") {
    const active = await staffSessionAtiva(request, env);
    return json(active ? { autenticado: true, cargo: active.staff.cargo } : { autenticado: false }, 200);
  }

  if (path === "/api/equipe/logout" && request.method === "POST") {
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
        requestLogger(request).error("Falha ao carregar portal da equipe", { action: "staff.portal.load", actorType: "staff", actorId: await pseudonymizeActorId(staff.id, env), eventCode: "STAFF_PORTAL_LOAD_FAILED", error: queryError });
        return json({ erro: "Não foi possível carregar os dados da equipe agora." }, 503);
      }
      const regraAtual = (rules.data ?? []).find((item: any) => !item.vigencia_fim || item.vigencia_fim >= hoje) ?? null;
      const allowedTraining = (training.data ?? []).filter((item: any) => { const cargos = Array.isArray(item.cargos) ? item.cargos : []; return cargos.length === 0 || cargos.includes(staff.cargo); });
      const progressMap = new Map((progress.data ?? []).map((item: any) => [item.treinamento_id, item]));
      const events = commissions.data ?? [];
      const validEvents = events.filter((item: any) => item.status !== "cancelada");
      return json({
        colaborador: { nome: staff.nome, cargo: staff.cargo, permissoes: staff.permissoes },
        regraAtual, competencia,
        comissaoPrevista: validEvents.reduce((sum: number, item: any) => sum + Number(item.valor_comissao ?? 0), 0),
        basePeriodo: validEvents.reduce((sum: number, item: any) => sum + Number(item.base_calculo ?? 0), 0),
        metricas: { eventos: validEvents.length, validados: validEvents.filter((item: any) => item.status === "validada").length, pagos: validEvents.filter((item: any) => item.status === "paga").length },
        comissoes: events,
        treinamentos: allowedTraining.map((item: any) => ({ ...item, progresso: Number(progressMap.get(item.id)?.progresso ?? 0), concluidoEm: progressMap.get(item.id)?.concluido_em ?? null })),
      });
    }

    const trainingMatch = path.match(/^\/api\/equipe\/trainings\/([^/]+)\/progress$/);
    if (trainingMatch && request.method === "PATCH") {
      const trainingId = decodeURIComponent(trainingMatch[1]);
      const { data: treinamento, error: trainingError } = await db.from("treinamentos").select("id,cargos,ativo").eq("id", trainingId).maybeSingle();
      if (trainingError) return json({ erro: "Não foi possível validar o treinamento." }, 500);
      const cargos = Array.isArray(treinamento?.cargos) ? treinamento.cargos : [];
      if (!treinamento || !treinamento.ativo || (cargos.length > 0 && !cargos.includes(staff.cargo))) return json({ erro: "Treinamento não disponível para seu acesso." }, 403);
      const b = await parseBody(request);
      const value = Math.max(0, Math.min(100, Number(b.progresso ?? 0)));
      if (!Number.isFinite(value)) return json({ erro: "Progresso inválido." }, 400);
      const { data, error } = await db.from("treinamento_progresso").upsert({ treinamento_id: trainingId, colaborador_id: staff.id, progresso: value, concluido_em: value >= 100 ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).select("*").single();
      if (error) return json({ erro: "Não foi possível atualizar o treinamento." }, 400);
      return json({ progresso: data });
    }
    return null;
  }

  if (path.startsWith("/api/admin/staff")) {
    const authorized = await exigirPermissaoAdmin(request, env, PERMISSOES_ADMIN.EQUIPE_GERENCIAR);
    if (authorized instanceof Response) return authorized;
    const adminId = authorized.session.adminId;

    if (path === "/api/admin/staff" && request.method === "GET") {
      const { data, error } = await db.from("colaboradores").select("id,nome,email,cargo,ativo,permissoes,created_at,updated_at").order("nome");
      if (error) return json({ erro: "Não foi possível carregar a equipe." }, 500);
      return json({ colaboradores: data ?? [] });
    }

    if (path === "/api/admin/staff" && request.method === "POST") {
      const b = await parseBody(request);
      const nome = String(b.nome ?? "").trim().slice(0, 160);
      const email = String(b.email ?? "").trim().toLowerCase().slice(0, 320);
      const cargo = cargoValido(b.cargo ?? b.perfil);
      const senhaTemporaria = String(b.senhaTemporaria ?? "");
      const permissoes = permissoesValidas(b.permissoes) ?? [];
      if (!nome || !email || !cargo) return json({ erro: "Nome, e-mail e cargo são obrigatórios." }, 400);
      if (senhaTemporaria.length < 12 || senhaTemporaria.length > 256) return json({ erro: "A senha temporária deve ter entre 12 e 256 caracteres." }, 400);

      const { data: auth, error: authError } = await db.auth.admin.createUser({ email, password: senhaTemporaria, email_confirm: true, user_metadata: { nome, tipo: "colaborador", cargo } });
      if (authError || !auth.user) return json({ erro: "Não foi possível criar o acesso." }, 400);
      const { data, error } = await db.from("colaboradores").insert({ auth_user_id: auth.user.id, nome, email, cargo, permissoes, ativo: true }).select("id,nome,email,cargo,ativo,permissoes,created_at,updated_at").single();
      if (error) {
        await db.auth.admin.deleteUser(auth.user.id).catch(() => undefined);
        return json({ erro: "Não foi possível concluir o cadastro da equipe." }, 400);
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
      if (String(atual.auth_user_id) === adminId && (!novoAtivo || (novoCargo && novoCargo !== "administrativo"))) return json({ erro: "Você não pode remover o próprio acesso administrativo." }, 409);

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.nome !== undefined) { const nome = String(b.nome).trim().slice(0, 160); if (!nome) return json({ erro: "Nome inválido." }, 400); patch.nome = nome; }
      if (novoCargo) patch.cargo = novoCargo;
      if (b.ativo !== undefined) patch.ativo = novoAtivo;
      const permissoes = permissoesValidas(b.permissoes); if (permissoes !== null) patch.permissoes = permissoes;
      const { data, error } = await db.from("colaboradores").update(patch).eq("id", id).select("id,nome,email,cargo,ativo,permissoes,created_at,updated_at").single();
      if (error) return json({ erro: "Não foi possível atualizar o colaborador." }, 400);
      return json({ colaborador: data });
    }
    return null;
  }

  return null;
}
