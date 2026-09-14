import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";

const COOKIE_NAME = "cliente_session";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Configuração de pagamento visível pela cliente (PIX + cartão). Só expõe o
 * subconjunto seguro da tabela `configuracoes` — nunca a linha inteira, que
 * também guarda metas orçamentárias e outros dados internos do admin.
 */
export async function clientConfigApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/cliente/config" || request.method !== "GET") return null;
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);

  const sessao = await verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return json({ erro: "Sessão expirada." }, 401);

  const db = createServiceSupabaseClient(env);
  const { data, error } = await db
    .from("configuracoes")
    .select("pix_chave,pix_qrcode_base64,pix_desconto_percentual,whatsapp_contato,telefone_contato,cartao_habilitado,cartao_taxa_percentual,cartao_max_parcelas")
    .maybeSingle();
  if (error) return json({ erro: error.message }, 500);

  return json({
    pixChave: data?.pix_chave || null,
    pixQrCodeUrl: data?.pix_qrcode_base64 || null,
    pixDescontoPercentual: Number(data?.pix_desconto_percentual ?? 0),
    whatsappContato: data?.whatsapp_contato || null,
    telefoneContato: data?.telefone_contato || null,
    cartao: {
      habilitado: Boolean(data?.cartao_habilitado),
      taxaPercentual: Number(data?.cartao_taxa_percentual ?? 0),
      maxParcelas: data?.cartao_max_parcelas ?? null,
    },
  });
}
