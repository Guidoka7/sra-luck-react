import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { getCookie, verificarTokenAdmin, verificarTokenSessao } from "./session";
import { pseudonymizeActorId, requestLogger, sanitizeLogValue } from "./logger";

const ADMIN_COOKIE = "admin_session";
const CLIENT_COOKIE = "cliente_session";
const MAX_BODY = 4_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA_MS = 86_400_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

function texto(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

async function podeVerMonitoramento(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return false;
  const sessao = await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return false;
  const colaborador = await buscarColaboradorAdminAtivo(sessao.adminId, env).catch(() => null);
  return Boolean(colaborador && temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.MONITORAMENTO_VISUALIZAR));
}

/** Quem está navegando: telas /admin exigem sessão admin; o resto, sessão da cliente. */
async function identificarAtor(request: Request, env: Env, rota: string | null) {
  const secret = env.CLIENTE_SESSION_SECRET!;
  if (rota?.startsWith("/admin")) {
    const admin = await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE), secret);
    return admin?.adminId && UUID_RE.test(admin.adminId) ? { tipo: "admin" as const, id: admin.adminId } : null;
  }
  const cliente = await verificarTokenSessao(getCookie(request, CLIENT_COOKIE), secret);
  return cliente?.clienteId && UUID_RE.test(cliente.clienteId) ? { tipo: "cliente" as const, id: cliente.clienteId } : null;
}

function contarPor<T>(itens: T[], chave: (item: T) => string) {
  const mapa = new Map<string, number>();
  for (const item of itens) mapa.set(chave(item), (mapa.get(chave(item)) ?? 0) + 1);
  return [...mapa].sort((a, b) => b[1] - a[1]).map(([nome, total]) => ({ nome, total }));
}

export async function monitoramentoAcessos(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/monitoramento/acesso" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Origem não autorizada." }, 403);
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return json({ erro: "Evento muito grande." }, 413);
    // Roda também antes do login: sem sessão o evento é ignorado sem erro.
    if (!env.CLIENTE_SESSION_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ ok: true, ignored: true });
    let body: any;
    try { body = await request.json(); } catch { return json({ erro: "Evento inválido." }, 400); }
    const tela = texto(sanitizeLogValue(body?.tela), 200);
    const rota = texto(sanitizeLogValue(body?.rota), 300);
    if (!tela) return json({ erro: "Tela ausente." }, 400);
    const ator = await identificarAtor(request, env, rota);
    if (!ator) return json({ ok: true, ignored: true });
    const db = createServiceSupabaseClient(env);
    const { data: permitido, error: rateError } = await db.rpc("rate_limit_consumir", {
      p_chave: `acessos:${ator.tipo}:${await pseudonymizeActorId(ator.id, env)}`,
      p_max_tentativas: 240,
      p_janela_segundos: 900,
    });
    if (rateError) return json({ ok: true, ignored: true });
    if (!Boolean(permitido)) return json({ ok: true, ignored: true });
    const { error } = await db.from("monitoramento_acessos").insert({
      actor_type: ator.tipo,
      actor_id: ator.id,
      tela,
      rota,
      sessao_id: texto(body?.sessaoId, 80),
      device_key: texto(body?.deviceKey, 200),
      device_type: texto(body?.deviceType, 40),
      display_mode: texto(body?.displayMode, 40),
      is_pwa_installed: typeof body?.isPwaInstalled === "boolean" ? body.isPwaInstalled : null,
      user_agent: texto(sanitizeLogValue(request.headers.get("User-Agent")), 300),
    });
    if (error) {
      // Tabela ainda não migrada ou indisponível: nunca atrapalha a navegação.
      requestLogger(request).warn("Falha ao registrar acesso", { action: "observability.access.persist", eventCode: "ACCESS_LOG_PERSIST_FAILED", error });
      return json({ ok: true, ignored: true });
    }
    return json({ ok: true }, 201);
  }

  const clienteMatch = path.match(/^\/api\/admin\/monitoramento-cliente\/([^/]+)$/);
  if (clienteMatch && request.method === "GET") {
    if (!(await podeVerMonitoramento(request, env))) return json({ erro: "Sem permissão para visualizar o monitoramento." }, 403);
    const clienteId = decodeURIComponent(clienteMatch[1]);
    if (!UUID_RE.test(clienteId)) return json({ erro: "Cliente inválida." }, 400);
    const db = createServiceSupabaseClient(env);
    const pseudonimo = await pseudonymizeActorId(clienteId, env);
    const [cliente, dispositivos, acessos, erros] = await Promise.all([
      db.from("clientes").select("id,nome_completo,ativo,acesso_app_liberado,acesso_app_liberado_em").eq("id", clienteId).maybeSingle(),
      db.from("cliente_app_devices").select("device_key,device_type,display_mode,is_pwa_installed,notification_permission,push_active,user_agent,first_access_at,last_access_at,pwa_installed_at,notifications_activated_at").eq("cliente_id", clienteId).order("last_access_at", { ascending: false }),
      db.from("monitoramento_acessos").select("criado_em,tela,rota,sessao_id,device_key,device_type,display_mode,is_pwa_installed,user_agent").eq("actor_type", "cliente").eq("actor_id", clienteId).order("criado_em", { ascending: false }).limit(300),
      db.from("monitoramento_erros").select("criado_em,origem,nivel,codigo,mensagem,rota,metodo,status_http,request_id,componente,detalhes").eq("actor_type", "cliente").eq("actor_id", pseudonimo).order("criado_em", { ascending: false }).limit(100),
    ]);
    if (cliente.error) return json({ erro: "Não foi possível carregar a cliente." }, 503);
    if (!cliente.data) return json({ erro: "Cliente não encontrada." }, 404);
    const listaAcessos = acessos.error ? [] : acessos.data ?? [];
    const listaErros = erros.error ? [] : erros.data ?? [];
    const agora = Date.now();
    const ultimos7 = listaAcessos.filter((a: any) => agora - new Date(a.criado_em).getTime() <= 7 * DIA_MS);
    return json({
      geradoEm: new Date().toISOString(),
      historicoDisponivel: !acessos.error,
      cliente: cliente.data,
      dispositivos: dispositivos.error ? [] : dispositivos.data ?? [],
      acessos: listaAcessos,
      erros: listaErros,
      resumo: {
        ultimoAcesso: listaAcessos[0]?.criado_em ?? null,
        acessos7d: ultimos7.length,
        sessoes7d: new Set(ultimos7.map((a: any) => a.sessao_id).filter(Boolean)).size,
        telasMaisVistas: contarPor(ultimos7, (a: any) => a.tela).slice(0, 6),
        viaApp: listaAcessos.filter((a: any) => a.display_mode === "standalone").length,
        viaNavegador: listaAcessos.filter((a: any) => a.display_mode && a.display_mode !== "standalone").length,
        erros7d: listaErros.filter((e: any) => agora - new Date(e.criado_em).getTime() <= 7 * DIA_MS).length,
      },
    });
  }

  if (path === "/api/admin/monitoramento-admin" && request.method === "GET") {
    if (!(await podeVerMonitoramento(request, env))) return json({ erro: "Sem permissão para visualizar o monitoramento." }, 403);
    const dias = Math.min(Math.max(Number(url.searchParams.get("dias") || 7), 1), 90);
    const desde = new Date(Date.now() - dias * DIA_MS).toISOString();
    const db = createServiceSupabaseClient(env);
    const [colaboradores, acessos, erros, alteracoes] = await Promise.all([
      db.from("colaboradores").select("id,auth_user_id,nome,email,cargo,ativo,permissoes").order("nome"),
      db.from("monitoramento_acessos").select("criado_em,actor_id,tela,rota,sessao_id,device_type,display_mode,user_agent").eq("actor_type", "admin").gte("criado_em", desde).order("criado_em", { ascending: false }).limit(2000),
      db.from("monitoramento_erros").select("criado_em,actor_id,nivel,codigo,mensagem,rota,metodo,status_http,request_id").eq("actor_type", "admin").gte("criado_em", desde).order("criado_em", { ascending: false }).limit(500),
      db.from("logs_alteracoes").select("created_at,usuario,acao,entidade,entidade_id").gte("created_at", desde).order("created_at", { ascending: false }).limit(1000),
    ]);
    if (colaboradores.error) return json({ erro: "Não foi possível carregar a equipe." }, 503);
    const listaAcessos = acessos.error ? [] : acessos.data ?? [];
    const listaErros = erros.error ? [] : erros.data ?? [];
    const listaAlteracoes = alteracoes.error ? [] : alteracoes.data ?? [];
    const pessoas = await Promise.all((colaboradores.data ?? []).map(async (c: any) => {
      const pseudonimo = c.auth_user_id ? await pseudonymizeActorId(c.auth_user_id, env) : null;
      const meusAcessos = listaAcessos.filter((a: any) => a.actor_id === c.auth_user_id);
      const meusErros = pseudonimo ? listaErros.filter((e: any) => e.actor_id === pseudonimo) : [];
      const usuarios = new Set([c.id, c.auth_user_id, `admin:${c.auth_user_id}`].filter(Boolean));
      const minhasAlteracoes = listaAlteracoes.filter((l: any) => usuarios.has(l.usuario));
      return {
        id: c.id, nome: c.nome, email: c.email, cargo: c.cargo, ativo: c.ativo,
        // O Dev acompanha o que cada pessoa pode fazer ao lado do que ela fez.
        permissoes: c.cargo === "administrativo" ? ["acesso_total"] : Array.isArray(c.permissoes) ? c.permissoes : [],
        ultimoAcesso: meusAcessos[0]?.criado_em ?? null,
        acessos: meusAcessos.length,
        telas: contarPor(meusAcessos, (a: any) => a.tela).slice(0, 8),
        erros: meusErros.slice(0, 50),
        alteracoes: minhasAlteracoes.slice(0, 50),
        ultimosAcessos: meusAcessos.slice(0, 50),
      };
    }));
    const nomePorAuth = new Map((colaboradores.data ?? []).map((c: any) => [c.auth_user_id, c.nome]));
    return json({
      geradoEm: new Date().toISOString(),
      dias,
      historicoDisponivel: !acessos.error,
      resumo: {
        acessos: listaAcessos.length,
        pessoasAtivas: pessoas.filter((p) => p.acessos > 0).length,
        erros: listaErros.length,
        alteracoes: listaAlteracoes.length,
        telasMaisVistas: contarPor(listaAcessos, (a: any) => a.tela).slice(0, 8),
      },
      pessoas,
      feed: listaAcessos.slice(0, 200).map((a: any) => ({ ...a, nome: nomePorAuth.get(a.actor_id) ?? null })),
      errosRecentes: listaErros.slice(0, 100),
    });
  }

  return null;
}
