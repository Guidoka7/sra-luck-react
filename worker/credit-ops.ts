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
  try { return await request.json() as Record<string, unknown>; } catch { return {}; }
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function exigirCliente(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const token = getCookie(request, "cliente_session");
  const session = await verificarTokenSessao(token, env.CLIENTE_SESSION_SECRET);
  return session?.clienteId ?? null;
}

async function consumirLimite(
  db: ReturnType<typeof createServiceSupabaseClient>,
  chave: string,
  max: number,
  janela: number,
) {
  const { data, error } = await db.rpc("rate_limit_consumir", {
    p_chave: chave,
    p_max_tentativas: max,
    p_janela_segundos: janela,
  });
  if (error) throw error;
  return Boolean(data);
}

/**
 * Credit Ops antigo usava contratos_credito/agenda_janelas, estruturas que não
 * pertencem ao fluxo canônico. Mantemos apenas o Clube, que usa tabelas atuais.
 */
export async function creditOpsApi(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (path.startsWith("/api/admin/credit-ops/")) {
    return json({ erro: "Módulo legado desativado." }, 410);
  }

  if (!path.startsWith("/api/cliente/credit-ops/")) return null;

  const clienteId = await exigirCliente(request, env);
  if (!clienteId) return json({ erro: "Sessão expirada." }, 401);

  // O resumo antigo dependia de contratos_credito. Parcelas/Jornada atuais têm
  // endpoints próprios e não devem reativar uma segunda fonte de verdade.
  if (path === "/api/cliente/credit-ops/summary") {
    return json({ erro: "Fluxo legado desativado." }, 410);
  }

  const db = createServiceSupabaseClient(env);
  const actor = await pseudonymizeActorId(clienteId, env);
  const log = requestLogger(request).child({ actorType: "cliente", actorId: actor, action: "club.action" });

  if (path === "/api/cliente/credit-ops/club" && request.method === "GET") {
    const [saldoRes, rewardsRes, historyRes, beneficiosRes, indicacoesRes] = await Promise.all([
      db.from("cliente_pontos").select("saldo").eq("cliente_id", clienteId).maybeSingle(),
      db.from("clube_recompensas").select("id,titulo,descricao,categoria,pontos,estoque,ativo,ordem,icone_key,instrucoes_pos_resgate").eq("ativo", true).order("ordem").order("pontos"),
      db.from("cliente_pontos_eventos").select("id,tipo,pontos,referencia,metadata,created_at").eq("cliente_id", clienteId).order("created_at", { ascending: false }).limit(50),
      db.from("clube_beneficios_cliente").select("id,beneficio_key,status,origem,created_at").eq("cliente_id", clienteId),
      db.from("indicacoes_clientes").select("id,nome_indicado,status,pontos_creditados,created_at").eq("indicador_cliente_id", clienteId).order("created_at", { ascending: false }).limit(100),
    ]);

    const error = saldoRes.error ?? rewardsRes.error ?? historyRes.error ?? beneficiosRes.error ?? indicacoesRes.error;
    if (error) {
      log.error("Falha ao carregar Clube", { eventCode: "CLUB_LOAD_FAILED", error });
      return json({ erro: "Não foi possível carregar o Clube agora." }, 503);
    }

    const indicacoes = indicacoesRes.data ?? [];
    return json({
      saldo: Number(saldoRes.data?.saldo ?? 0),
      recompensas: rewardsRes.data ?? [],
      historico: historyRes.data ?? [],
      beneficios: beneficiosRes.data ?? [],
      indicacoes: {
        confirmadas: indicacoes.filter((item) => item.status === "venda").length,
        emAnalise: indicacoes.filter((item) => item.status === "enviada" || item.status === "qualificada").length,
        itens: indicacoes,
      },
    });
  }

  if (path === "/api/cliente/credit-ops/referrals" && request.method === "POST") {
    const b = await body(request);
    const nome = String(b.nome ?? "").trim().replace(/\s+/g, " ");
    const telefone = String(b.telefone ?? "").replace(/\D/g, "");
    if (nome.length < 2 || nome.length > 120) return json({ erro: "Informe um nome válido." }, 400);
    if (telefone && (telefone.length < 10 || telefone.length > 13)) return json({ erro: "Informe um telefone válido." }, 400);

    try {
      if (!(await consumirLimite(db, `club:referral:${actor}`, 12, 3600))) return json({ erro: "Limite de indicações atingido. Tente novamente mais tarde." }, 429);
      const { data, error } = await db.from("indicacoes_clientes").insert({
        indicador_cliente_id: clienteId,
        nome_indicado: nome,
        telefone_indicado: telefone || null,
      }).select("id,nome_indicado,status,pontos_creditados,created_at").single();
      if (error) throw error;
      log.info("Indicação criada", { eventCode: "CLUB_REFERRAL_CREATED", entityType: "indicacao", entityId: data.id });
      return json({ indicacao: data }, 201);
    } catch (error) {
      log.error("Falha ao criar indicação", { eventCode: "CLUB_REFERRAL_FAILED", error });
      return json({ erro: "Não foi possível enviar a indicação." }, 400);
    }
  }

  const usarBeneficio = path.match(/^\/api\/cliente\/credit-ops\/beneficios\/([^/]+)\/usar$/);
  if (usarBeneficio && request.method === "POST") {
    const beneficioId = decodeURIComponent(usarBeneficio[1]);
    if (!uuid(beneficioId)) return json({ erro: "Benefício inválido." }, 400);
    try {
      if (!(await consumirLimite(db, `club:benefit:${actor}`, 20, 3600))) return json({ erro: "Muitas tentativas. Tente novamente mais tarde." }, 429);
      const { data, error } = await db.from("clube_beneficios_cliente")
        .update({ status: "utilizado", updated_at: new Date().toISOString() })
        .eq("id", beneficioId)
        .eq("cliente_id", clienteId)
        .eq("status", "disponivel")
        .select("id,beneficio_key,status,origem,created_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ erro: "Benefício não encontrado ou já utilizado." }, 404);
      log.info("Benefício utilizado", { eventCode: "CLUB_BENEFIT_USED", entityType: "beneficio", entityId: beneficioId });
      return json({ beneficio: data });
    } catch (error) {
      log.error("Falha ao utilizar benefício", { eventCode: "CLUB_BENEFIT_FAILED", error });
      return json({ erro: "Não foi possível utilizar o benefício." }, 400);
    }
  }

  if (path === "/api/cliente/credit-ops/redeem" && request.method === "POST") {
    const b = await body(request);
    const rewardId = String(b.recompensaId ?? "");
    const idempotencyKey = String(b.idempotencyKey ?? "");
    if (!uuid(rewardId)) return json({ erro: "Recompensa inválida." }, 400);
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) return json({ erro: "Chave de idempotência inválida." }, 400);

    try {
      if (!(await consumirLimite(db, `club:redeem:${actor}`, 20, 3600))) return json({ erro: "Muitas tentativas de resgate. Tente novamente mais tarde." }, 429);
      const { data: resgate, error } = await db.rpc("clube_resgatar", {
        p_cliente_id: clienteId,
        p_recompensa_id: rewardId,
        p_idempotency_key: idempotencyKey,
      });
      if (error) {
        const msg = String(error.message || "");
        if (/saldo|pontos|estoque|indispon/i.test(msg)) return json({ erro: "Saldo insuficiente ou recompensa indisponível." }, 409);
        throw error;
      }
      const { data: pontos } = await db.from("cliente_pontos").select("saldo").eq("cliente_id", clienteId).maybeSingle();
      log.info("Resgate concluído", { eventCode: "CLUB_REDEEMED", entityType: "recompensa", entityId: rewardId });
      return json({ resgate, saldo: Number(pontos?.saldo ?? 0) }, 201);
    } catch (error) {
      log.error("Falha ao resgatar recompensa", { eventCode: "CLUB_REDEEM_FAILED", error });
      return json({ erro: "Não foi possível concluir o resgate." }, 400);
    }
  }

  return json({ erro: "Rota não encontrada." }, 404);
}
