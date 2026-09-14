import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";
import { calcularTaxaCartao } from "./card-fee";

const COOKIE_NAME = "cliente_session";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function mesmaOrigem(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * Cria a "sessão" de pagamento no cartão para uma parcela específica.
 *
 * Nenhum gateway de cartão está integrado ainda (ver docs/app-cliente-redesign-integracoes.md).
 * Este endpoint implementa o CONTRATO do servidor — busca a parcela e a
 * configuração real, recalcula taxa/total sempre no servidor (nunca confia
 * no valor vindo do navegador) — mas devolve `checkoutUrl: null` até que um
 * provedor seja contratado. Nenhuma parcela é marcada como paga aqui.
 */
export async function clientPagamentosApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/cliente/pagamentos/cartao/sessao" || request.method !== "POST") return null;
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);

  const sessao = await verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return json({ erro: "Sessão expirada." }, 401);
  if (!mesmaOrigem(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);

  const body = await request.json().catch(() => ({})) as { boletoId?: string };
  const boletoId = String(body.boletoId ?? "").trim();
  if (!boletoId) return json({ erro: "Informe a parcela a pagar." }, 400);

  const db = createServiceSupabaseClient(env);

  const [{ data: boleto, error: boletoError }, { data: config, error: configError }] = await Promise.all([
    db.from("boletos").select("id,cliente_id,numero_parcela,valor,status").eq("id", boletoId).maybeSingle(),
    db.from("configuracoes").select("cartao_habilitado,cartao_taxa_percentual,cartao_max_parcelas,cartao_provider").maybeSingle(),
  ]);
  if (boletoError) return json({ erro: boletoError.message }, 500);
  if (!boleto || boleto.cliente_id !== sessao.clienteId) return json({ erro: "Parcela não encontrada." }, 404);
  if (boleto.status === "pago") return json({ erro: "Esta parcela já está paga." }, 409);
  if (configError) return json({ erro: configError.message }, 500);
  if (!config?.cartao_habilitado) return json({ erro: "Pagamento no cartão indisponível para o seu contrato." }, 409);

  const amount = Number(boleto.valor);
  const feePercent = Number(config.cartao_taxa_percentual ?? 0);
  const { feeAmount, total } = calcularTaxaCartao(amount, feePercent);

  return json({
    sessionId: crypto.randomUUID(),
    checkoutUrl: null,
    provider: config.cartao_provider ?? null,
    amount,
    feeAmount,
    total,
    feePercent,
    maxParcelas: config.cartao_max_parcelas ?? null,
    disponivel: false,
    mensagem: "O checkout de cartão ainda não está conectado a um provedor de pagamento. A equipe entrará em contato para concluir esta forma de pagamento.",
  });
}
