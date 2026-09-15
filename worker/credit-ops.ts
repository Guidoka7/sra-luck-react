import { exigirPermissaoAdmin, PERMISSOES_ADMIN } from "./admin-auth";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";
import { pseudonymizeActorId, requestLogger } from "./logger";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try { return await request.json() as Record<string, unknown>; }
  catch { return {}; }
}

function mesmaOrigem(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try { return origin === new URL(request.url).origin; }
  catch { return false; }
}

async function exigirCliente(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenSessao(getCookie(request, "cliente_session"), env.CLIENTE_SESSION_SECRET);
  return session?.clienteId ?? null;
}

function uuid(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function texto(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function telefoneBrasil(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  return digits;
}

function erroResgate(message: string): { erro: string; status: number } {
  const m = message.toLowerCase();
  if (m.includes("saldo de pontos insuficiente")) return { erro: "Você ainda não possui moedas suficientes para este resgate.", status: 409 };
  if (m.includes("sem estoque") || m.includes("recompensa indisponivel")) return { erro: "Este prêmio não está disponível no momento.", status: 409 };
  if (m.includes("idempotencia")) return { erro: "Este resgate já foi processado ou a solicitação é inválida.", status: 409 };
  return { erro: "Não foi possível concluir o resgate agora.", status: 409 };
}

export async function creditOpsApi(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (path.startsWith("/api/admin/credit-ops/")) {
    // O antigo módulo de contratos/finance/team dependia do subsistema paralelo
    // contratos_credito/conciliacao_financeira_eventos, que não faz parte do
    // runtime canônico. Mantê-lo acessível aumentava a superfície de ataque.
    if (path.startsWith("/api/admin/credit-ops/contracts")
      || path === "/api/admin/credit-ops/finance/daily"
      || path.startsWith("/api/admin/credit-ops/team")) {
      return json({ erro: "Endpoint legado desativado." }, 410);
    }

    if (path === "/api/admin/credit-ops/rewards" && (request.method === "GET" || request.method === "POST")) {
      const auth = await exigirPermissaoAdmin(request, env, PERMISSOES_ADMIN.CLUBE_GERENCIAR);
      if (auth instanceof Response) return auth;
      if (request.method === "POST" && !mesmaOrigem(request)) return json({ erro: "Origem não autorizada." }, 403);
      const db = createServiceSupabaseClient(env);

      if (request.method === "GET") {
        const { data, error } = await db.from("clube_recompensas")
          .select("id,titulo,descricao,categoria,pontos,estoque,ativo,ordem,icone_key,instrucoes_pos_resgate,created_at")
          .order("ordem").order("pontos");
        if (error) return json({ erro: "Não foi possível carregar os prêmios." }, 500);
        return json({ recompensas: data ?? [] });
      }

      const b = await body(request);
      const titulo = texto(b.titulo, 120);
      const descricao = texto(b.descricao, 500) || null;
      const categoria = texto(b.categoria, 80) || null;
      const pontos = Number(b.pontos);
      const estoque = b.estoque == null || b.estoque === "" ? null : Number(b.estoque);
      if (titulo.length < 2 || !Number.isInteger(pontos) || pontos < 1 || pontos > 1_000_000) return json({ erro: "Dados do prêmio inválidos." }, 400);
      if (estoque !== null && (!Number.isInteger(estoque) || estoque < 0 || estoque > 1_000_000)) return json({ erro: "Estoque inválido." }, 400);
      const { data, error } = await db.from("clube_recompensas").insert({ titulo, descricao, categoria, pontos, estoque, ativo: b.ativo !== false }).select("id,titulo,descricao,categoria,pontos,estoque,ativo,ordem,icone_key,instrucoes_pos_resgate,created_at").single();
      if (error) return json({ erro: "Não foi possível cadastrar o prêmio." }, 400);
      return json({ recompensa: data }, 201);
    }

    return null;
  }

  if (!path.startsWith("/api/cliente/credit-ops/")) return null;
  const clienteId = await exigirCliente(request, env);
  if (!clienteId) return json({ erro: "Sessão expirada." }, 401);
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method) && !mesmaOrigem(request)) return json({ erro: "Origem não autorizada." }, 403);
  const db = createServiceSupabaseClient(env);
  const log = requestLogger(request).child({ actorType: "cliente", actorId: await pseudonymizeActorId(clienteId, env), action: "client.club" });

  if (path === "/api/cliente/credit-ops/summary") {
    return json({ erro: "Endpoint legado desativado. Use as rotas atuais de parcelas e jornada." }, 410);
  }

  if (path === "/api/cliente/credit-ops/club" && request.method === "GET") {
    const [saldoResult, rewardsResult, historyResult, beneficiosResult, indicacoesResult] = await Promise.all([
      db.from("cliente_pontos").select("saldo").eq("cliente_id", clienteId).maybeSingle(),
      db.from("clube_recompensas").select("id,titulo,descricao,categoria,pontos,estoque,ativo,ordem,icone_key,instrucoes_pos_resgate").eq("ativo", true).order("ordem").order("pontos"),
      db.from("cliente_pontos_eventos").select("id,tipo,pontos,created_at").eq("cliente_id", clienteId).order("created_at", { ascending: false }).limit(50),
      db.from("clube_beneficios_cliente").select("id,beneficio_key,status,origem,created_at").eq("cliente_id", clienteId),
      db.from("indicacoes_clientes").select("id,status,pontos_creditados,created_at").eq("indicador_cliente_id", clienteId).order("created_at", { ascending: false }).limit(50),
    ]);
    const error = saldoResult.error ?? rewardsResult.error ?? historyResult.error ?? beneficiosResult.error ?? indicacoesResult.error;
    if (error) {
      log.error("Falha ao carregar Clube", { eventCode: "CLUB_LOAD_FAILED", statusCode: 500, error });
      return json({ erro: "Não foi possível carregar o Clube agora." }, 500);
    }
    const listaIndicacoes = indicacoesResult.data ?? [];
    return json({
      saldo: Number(saldoResult.data?.saldo ?? 0),
      recompensas: rewardsResult.data ?? [],
      historico: historyResult.data ?? [],
      beneficios: beneficiosResult.data ?? [],
      indicacoes: {
        confirmadas: listaIndicacoes.filter((item) => item.status === "venda").length,
        emAnalise: listaIndicacoes.filter((item) => item.status === "enviada" || item.status === "qualificada").length,
        itens: listaIndicacoes,
      },
    });
  }

  if (path === "/api/cliente/credit-ops/referrals" && request.method === "POST") {
    const b = await body(request);
    const nome = texto(b.nome, 120);
    const telefone = telefoneBrasil(b.telefone);
    const consentimento = b.consentimentoContato === true;
    if (nome.length < 2 || !telefone) return json({ erro: "Informe nome e telefone válidos da pessoa indicada." }, 400);
    if (!consentimento) return json({ erro: "Confirme que a pessoa indicada autorizou o contato antes de compartilhar os dados." }, 400);

    const { data, error } = await db.from("indicacoes_clientes").insert({
      indicador_cliente_id: clienteId,
      nome_indicado: nome,
      telefone_indicado: telefone,
      consentimento_contato: true,
      consentimento_registrado_em: new Date().toISOString(),
    }).select("id,status,pontos_creditados,created_at").single();
    if (error) {
      log.error("Falha ao registrar indicação", { eventCode: "CLUB_REFERRAL_CREATE_FAILED", statusCode: 500, error });
      return json({ erro: "Não foi possível registrar a indicação agora." }, 500);
    }
    return json({ indicacao: data }, 201);
  }

  const usarBeneficio = path.match(/^\/api\/cliente\/credit-ops\/beneficios\/([^/]+)\/usar$/);
  if (usarBeneficio && request.method === "POST") {
    const beneficioId = uuid(decodeURIComponent(usarBeneficio[1]));
    if (!beneficioId) return json({ erro: "Benefício inválido." }, 400);
    const { data, error } = await db.from("clube_beneficios_cliente")
      .update({ status: "utilizado", updated_at: new Date().toISOString() })
      .eq("id", beneficioId).eq("cliente_id", clienteId).eq("status", "disponivel")
      .select("id,beneficio_key,status,origem,created_at").maybeSingle();
    if (error) return json({ erro: "Não foi possível utilizar o benefício agora." }, 500);
    if (!data) return json({ erro: "Benefício não encontrado ou já utilizado." }, 404);
    return json({ beneficio: data });
  }

  if (path === "/api/cliente/credit-ops/redeem" && request.method === "POST") {
    const b = await body(request);
    const rewardId = uuid(b.recompensaId);
    const idempotencyKey = texto(b.idempotencyKey, 120);
    if (!rewardId) return json({ erro: "Recompensa inválida." }, 400);
    if (!/^[A-Za-z0-9:_-]{16,120}$/.test(idempotencyKey)) return json({ erro: "Chave de idempotência inválida." }, 400);

    const { data: resgate, error } = await db.rpc("clube_resgatar", { p_cliente_id: clienteId, p_recompensa_id: rewardId, p_idempotency_key: idempotencyKey });
    if (error) {
      const safe = erroResgate(error.message || "");
      return json({ erro: safe.erro }, safe.status);
    }
    const { data: pontos } = await db.from("cliente_pontos").select("saldo").eq("cliente_id", clienteId).maybeSingle();
    const row = resgate as any;
    return json({
      resgate: row ? { id: row.id, recompensa_id: row.recompensa_id, pontos: row.pontos, status: row.status, created_at: row.created_at } : null,
      saldo: Number(pontos?.saldo ?? 0),
    }, 201);
  }

  return null;
}
