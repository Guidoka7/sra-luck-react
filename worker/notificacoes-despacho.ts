/**
 * Entrega do Web Push dos avisos gravados pelo banco.
 *
 * `public.notificar_cliente()` (migration_093) grava o aviso no app e um
 * registro em notificacao_logs com push_status = 'pendente'. Este módulo
 * entrega esses pendentes: cada registro é "reservado" com um UPDATE
 * condicional (pendente → enviando), então duas passagens simultâneas nunca
 * mandam o mesmo push duas vezes.
 *
 * Quem chama:
 *   - o próprio banco, via pg_net, logo após gravar o aviso (quando o Vault
 *     tem sra_luck_app_url e sra_luck_cron_secret);
 *   - o Worker, em segundo plano, depois de ações do painel e do app;
 *   - as rotinas diárias do Vercel Cron.
 */
import { classificarStatusPush } from "./admin-notificacoes";
import { enviarWebPushParaCliente } from "./web-push-sender";
import { createServiceSupabaseClient, type Env } from "./supabase";

type Db = ReturnType<typeof createServiceSupabaseClient>;

/** Avisos mais antigos que isso não viram push (a cliente já os vê no app). */
const JANELA_HORAS = 48;

export function urlDoDestino(destino: string | null | undefined) {
  const d = String(destino ?? "").toLowerCase();
  if (["parcelas", "pagamentos", "financeiro"].includes(d)) return "/agenda?destino=parcelas";
  if (["clube", "premios"].includes(d)) return "/agenda?destino=clube";
  if (d === "jornada") return "/agenda?destino=jornada";
  return "/agenda?destino=agenda";
}

export async function despacharPushPendentes(env: Env, opcoes: { limite?: number; notificacaoId?: string } = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { processados: 0, enviados: 0 };
  const db = createServiceSupabaseClient(env);
  const limite = Math.min(50, Math.max(1, opcoes.limite ?? 20));
  const desde = new Date(Date.now() - JANELA_HORAS * 60 * 60 * 1000).toISOString();

  let consulta = db.from("notificacao_logs").select("id,cliente_id,notificacao_id,referencia_id")
    .eq("push_status", "pendente").gte("created_at", desde).order("created_at", { ascending: true }).limit(limite);
  if (opcoes.notificacaoId) consulta = consulta.eq("notificacao_id", opcoes.notificacaoId);
  const { data: pendentes, error } = await consulta;
  if (error || !pendentes?.length) return { processados: 0, enviados: 0 };

  let processados = 0, enviados = 0;
  for (const log of pendentes as { id: string; cliente_id: string; notificacao_id: string | null; referencia_id: string | null }[]) {
    const { data: reservado } = await db.from("notificacao_logs").update({ push_status: "enviando" })
      .eq("id", log.id).eq("push_status", "pendente").select("id").maybeSingle();
    if (!reservado) continue;
    processados++;
    await entregar(env, db, log).then((ok) => { if (ok) enviados++; }).catch(async (erro) => {
      await db.from("notificacao_logs").update({ push_status: "falhou", erro_mensagem: String(erro instanceof Error ? erro.message : erro).slice(0, 500) }).eq("id", log.id);
    });
  }
  return { processados, enviados };
}

async function entregar(env: Env, db: Db, log: { id: string; cliente_id: string; notificacao_id: string | null; referencia_id: string | null }) {
  const { data: aviso } = await db.from("notificacoes_cliente").select("id,titulo,mensagem,destino").eq("id", log.notificacao_id ?? "").maybeSingle();
  if (!aviso) {
    await db.from("notificacao_logs").update({ push_status: "sem_notificacao" }).eq("id", log.id);
    return false;
  }
  const push = await enviarWebPushParaCliente(env, db, log.cliente_id, {
    title: String(aviso.titulo),
    body: String(aviso.mensagem),
    url: urlDoDestino(aviso.destino),
    tag: `notificacao-${aviso.id}`,
    notificationId: aviso.id,
    installmentId: log.referencia_id,
    destino: aviso.destino ?? "agenda",
  });
  await db.from("notificacao_logs").update({
    push_enviadas: push.enviadas,
    push_falhas: push.falhas,
    push_status: classificarStatusPush(push),
    erro_mensagem: push.erros.length ? push.erros.join(" | ").slice(0, 1000) : null,
  }).eq("id", log.id);
  return push.enviadas > 0;
}

let ultimaPassagem = 0;

/**
 * Passagem em segundo plano depois de ações no painel/app. No máximo uma a
 * cada 15 s por instância; nunca atrasa nem quebra a resposta da requisição.
 */
export function agendarDespacho(env: Env, ctx?: { waitUntil?: (p: Promise<unknown>) => void }) {
  const agora = Date.now();
  if (agora - ultimaPassagem < 15_000) return;
  ultimaPassagem = agora;
  const tarefa = despacharPushPendentes(env, { limite: 15 }).catch(() => undefined);
  if (ctx?.waitUntil) ctx.waitUntil(tarefa);
}
