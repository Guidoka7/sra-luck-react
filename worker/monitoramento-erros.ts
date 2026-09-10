import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin } from "./session";

const ADMIN_COOKIE = "admin_session";
const MAX_BODY = 12_000;

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

async function admin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return false;
  return Boolean(await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE), env.CLIENTE_SESSION_SECRET));
}

function limparTexto(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

export async function monitoramentoErros(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/monitoramento/erro" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Origem não autorizada." }, 403);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY) return json({ erro: "Evento muito grande." }, 413);
    let body: any;
    try { body = await request.json(); } catch { return json({ erro: "Evento inválido." }, 400); }
    const mensagem = limparTexto(body?.mensagem, 1200);
    if (!mensagem) return json({ erro: "Mensagem ausente." }, 400);
    const origem = body?.origem === "api" ? "api" : "frontend";
    const nivel = body?.nivel === "critical" ? "critical" : body?.nivel === "warning" ? "warning" : "error";
    const db = createServiceSupabaseClient(env);
    const { error } = await db.from("monitoramento_erros").insert({
      origem, nivel, mensagem,
      rota: limparTexto(body?.rota, 500),
      metodo: limparTexto(body?.metodo, 12),
      status_http: Number.isInteger(body?.status_http) ? body.status_http : null,
      codigo: limparTexto(body?.codigo, 120),
      stack: limparTexto(body?.stack, 5000),
      componente: limparTexto(body?.componente, 200),
      request_id: limparTexto(body?.request_id, 120),
      user_agent: limparTexto(request.headers.get("User-Agent"), 500),
      ambiente: limparTexto(body?.ambiente, 40) || "production",
      detalhes: body?.detalhes && typeof body.detalhes === "object" ? body.detalhes : {},
    });
    if (error) return json({ erro: "Não foi possível registrar o evento." }, 503);
    return json({ ok: true }, 201);
  }

  if (url.pathname === "/api/admin/monitoramento-erros" && request.method === "GET") {
    if (!(await admin(request, env))) return json({ erro: "Sessão administrativa expirada." }, 401);
    const db = createServiceSupabaseClient(env);
    const limite = Math.min(Math.max(Number(url.searchParams.get("limite") || 100), 1), 300);
    const { data: recentes, error } = await db.from("monitoramento_erros")
      .select("id,criado_em,origem,nivel,rota,metodo,status_http,codigo,mensagem,stack,componente,request_id,ambiente,detalhes")
      .order("criado_em", { ascending: false }).limit(limite);
    if (error) return json({ erro: "Não foi possível carregar o monitoramento." }, 503);
    const agora = Date.now();
    const eventos = recentes ?? [];
    const dentro = (ms: number) => eventos.filter((e: any) => agora - new Date(e.criado_em).getTime() <= ms);
    const ult24 = dentro(24 * 60 * 60 * 1000);
    const ult1h = dentro(60 * 60 * 1000);
    const criticos = ult24.filter((e: any) => e.nivel === "critical").length;
    const porRota = ult24.reduce((acc: Record<string, number>, e: any) => { const k = e.rota || "sem rota"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const topRotas = Object.entries(porRota).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([rota, total]) => ({ rota, total }));
    return json({
      geradoEm: new Date().toISOString(),
      resumo: { ultimaHora: ult1h.length, ultimas24h: ult24.length, criticos24h: criticos, totalCarregado: eventos.length },
      topRotas,
      eventos,
    });
  }

  if (url.pathname === "/api/admin/diagnostico" && request.method === "GET") {
    if (!(await admin(request, env))) return json({ erro: "Sessão administrativa expirada." }, 401);
    const db = createServiceSupabaseClient(env);
    const checks: Array<{ nome: string; ok: boolean; detalhe: string; ms: number }> = [];
    const probe = async (nome: string, fn: () => Promise<{ error: any }>) => {
      const inicio = Date.now();
      try {
        const result = await fn();
        checks.push({ nome, ok: !result.error, detalhe: result.error?.message || "OK", ms: Date.now() - inicio });
      } catch (e) {
        checks.push({ nome, ok: false, detalhe: e instanceof Error ? e.message : "Falha desconhecida", ms: Date.now() - inicio });
      }
    };
    await probe("Supabase · clientes", async () => db.from("clientes").select("id", { count: "exact", head: true }));
    await probe("Supabase · boletos", async () => db.from("boletos").select("id", { count: "exact", head: true }));
    await probe("Supabase · agendamentos", async () => db.from("agendamentos").select("id", { count: "exact", head: true }));
    await probe("Supabase · datas", async () => db.from("datas").select("id", { count: "exact", head: true }));
    await probe("Supabase · liberações financeiras", async () => db.from("datas_liberacao_financeira").select("id", { count: "exact", head: true }));
    await probe("Supabase · monitoramento", async () => db.from("monitoramento_erros").select("id", { count: "exact", head: true }));
    return json({
      ok: checks.every((c) => c.ok),
      geradoEm: new Date().toISOString(),
      runtime: "cloudflare-workers",
      supabaseConfigurado: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
      checks,
    });
  }
  return null;
}
