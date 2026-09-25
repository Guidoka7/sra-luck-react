import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { getCookie, verificarTokenAdmin } from "./session";
import {
  HOME_CAMPAIGN_ARTES,
  HOME_CAMPAIGN_DESTINOS_CONFIGURAVEIS,
  HOME_CAMPAIGN_SLIDES,
  HOME_CAMPAIGN_TEMAS,
  HOME_CAMPAIGN_TEXTOS,
  type HomeCampaignOverride,
} from "../src/components/cliente/home/homeCampaigns";

// Cartões do carrossel da Home configuráveis pelo Admin/Dev Console.
// O app mescla estes ajustes com HOME_CAMPAIGN_SLIDES; sem ajustes, nada muda.

const LIMITES: Record<(typeof HOME_CAMPAIGN_TEXTOS)[number], number> = { eyebrow: 60, title: 80, destaque: 60, description: 220, cta: 40 };
const ID_CUSTOM = /^custom-[a-z0-9-]{3,40}$/;
const PADRAO = new Set(HOME_CAMPAIGN_SLIDES.map((s) => s.id));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

type Linha = { id: string; base_id: string | null; ativo: boolean | null; ordem: number | null; dados: Record<string, unknown> | null; atualizado_em?: string; atualizado_por?: string | null };

function paraOverride(l: Linha): HomeCampaignOverride {
  return { id: l.id, baseId: l.base_id, ativo: l.ativo, ordem: l.ordem, dados: (l.dados ?? {}) as HomeCampaignOverride["dados"] };
}

/** Valida e normaliza o corpo recebido; devolve erro legível ou a linha. */
export function validarCampanha(id: string, body: any): { erro: string } | { linha: Omit<Linha, "atualizado_em"> } {
  const custom = ID_CUSTOM.test(id);
  if (!custom && !PADRAO.has(id)) return { erro: "Cartão desconhecido." };
  const dados: Record<string, string> = {};
  for (const campo of HOME_CAMPAIGN_TEXTOS) {
    if (body?.[campo] === undefined || body[campo] === null || body[campo] === "") continue;
    const valor = String(body[campo]).trim();
    if (valor.length > LIMITES[campo]) return { erro: `O campo ${campo} passa de ${LIMITES[campo]} caracteres.` };
    dados[campo] = valor;
  }
  if (body?.action) {
    if (!HOME_CAMPAIGN_DESTINOS_CONFIGURAVEIS.includes(body.action)) return { erro: "Destino inválido." };
    dados.action = body.action;
  }
  if (body?.tema) {
    if (!HOME_CAMPAIGN_TEMAS.includes(body.tema)) return { erro: "Tema inválido." };
    dados.tema = body.tema;
  }
  if (body?.arte) {
    if (!HOME_CAMPAIGN_ARTES.includes(body.arte)) return { erro: "Arte inválida." };
    dados.arte = body.arte;
  }
  const ordem = body?.ordem === undefined || body.ordem === null || body.ordem === "" ? null : Number(body.ordem);
  if (ordem !== null && (!Number.isInteger(ordem) || ordem < -1000 || ordem > 1000)) return { erro: "Ordem inválida." };
  const baseId = custom ? String(body?.baseId || "") : null;
  if (custom) {
    if (!baseId || !PADRAO.has(baseId)) return { erro: "Escolha um cartão existente como modelo visual." };
    if (!dados.title || !dados.description || !dados.cta) return { erro: "Cartão novo precisa de título, descrição e botão." };
  }
  return { linha: { id, base_id: baseId, ativo: typeof body?.ativo === "boolean" ? body.ativo : null, ordem, dados } };
}

async function colaboradorComPermissao(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const sessao = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return null;
  const colaborador = await buscarColaboradorAdminAtivo(sessao.adminId, env).catch(() => null);
  return colaborador && temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.CONFIGURACOES_GERENCIAR) ? { colaborador, adminId: sessao.adminId } : null;
}

export async function homeCampanhasApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  // App da cliente: só lê os ajustes (a sessão já foi validada pelo roteador).
  if (path === "/api/cliente/home-campanhas" && request.method === "GET") {
    const db = createServiceSupabaseClient(env, request);
    const { data, error } = await db.from("home_campanhas_config").select("id,base_id,ativo,ordem,dados").is("excluido_em", null);
    // Sem tabela/erro: o app segue com o catálogo padrão.
    return json({ ajustes: error ? [] : (data ?? []).map(paraOverride) });
  }

  if (!path.startsWith("/api/admin/home-campanhas")) return null;
  const autorizado = await colaboradorComPermissao(request, env);
  if (!autorizado) return json({ erro: "Seu papel não tem permissão para configurar o carrossel." }, 403);
  const db = createServiceSupabaseClient(env);

  if (path === "/api/admin/home-campanhas" && request.method === "GET") {
    const { data, error } = await db.from("home_campanhas_config").select("id,base_id,ativo,ordem,dados,atualizado_em,atualizado_por").is("excluido_em", null);
    return json({
      persistenciaPronta: !error,
      padrao: HOME_CAMPAIGN_SLIDES.map((s) => ({ id: s.id, eyebrow: s.eyebrow ?? null, title: s.title, destaque: s.destaque ?? null, description: s.description, cta: s.cta, action: s.action, tema: s.tema ?? null, arte: s.arte ?? null, active: s.active, order: s.order, availability: s.availability ?? "always", backgroundColor: s.backgroundColor, textColor: s.textColor, accentColor: s.accentColor, buttonColor: s.buttonColor, buttonTextColor: s.buttonTextColor })),
      ajustes: error ? [] : (data ?? []),
      opcoes: { temas: HOME_CAMPAIGN_TEMAS, artes: HOME_CAMPAIGN_ARTES, destinos: HOME_CAMPAIGN_DESTINOS_CONFIGURAVEIS, limites: LIMITES },
    });
  }

  if (!sameOrigin(request)) return json({ erro: "Origem da requisição não autorizada." }, 403);
  const usuario = `admin:${autorizado.adminId}`;
  const match = path.match(/^\/api\/admin\/home-campanhas\/([^/]+)$/);

  if (path === "/api/admin/home-campanhas" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
    const v = validarCampanha(id, body);
    if ("erro" in v) return json({ erro: v.erro }, 400);
    const { data, error } = await db.from("home_campanhas_config").insert({ ...v.linha, atualizado_por: usuario }).select("*").single();
    if (error) return json({ erro: "Não foi possível salvar. Aplique a migration do carrossel." }, 503);
    await db.from("logs_alteracoes").insert({ usuario, acao: "criou_cartao_carrossel", entidade: "home_campanhas", entidade_id: null, detalhes: { id, base: v.linha.base_id } });
    return json({ ajuste: data }, 201);
  }

  if (match && request.method === "PUT") {
    const id = decodeURIComponent(match[1]);
    const body = await request.json().catch(() => ({}));
    const v = validarCampanha(id, body);
    if ("erro" in v) return json({ erro: v.erro }, 400);
    const { data, error } = await db.from("home_campanhas_config").upsert({ ...v.linha, atualizado_por: usuario, atualizado_em: new Date().toISOString(), excluido_em: null }, { onConflict: "id" }).select("*").single();
    if (error) return json({ erro: "Não foi possível salvar. Aplique a migration do carrossel." }, 503);
    await db.from("logs_alteracoes").insert({ usuario, acao: "alterou_cartao_carrossel", entidade: "home_campanhas", entidade_id: null, detalhes: { id, ativo: v.linha.ativo, ordem: v.linha.ordem, campos: Object.keys(v.linha.dados ?? {}) } });
    return json({ ajuste: data });
  }

  if (match && request.method === "DELETE") {
    const id = decodeURIComponent(match[1]);
    if (!ID_CUSTOM.test(id) && !PADRAO.has(id)) return json({ erro: "Cartão desconhecido." }, 400);
    // Cartão padrão: remove o ajuste (volta ao original). Cartão novo: exclusão lógica.
    const { error } = PADRAO.has(id)
      ? await db.from("home_campanhas_config").delete().eq("id", id)
      : await db.from("home_campanhas_config").update({ excluido_em: new Date().toISOString(), atualizado_por: usuario }).eq("id", id);
    if (error) return json({ erro: "Não foi possível remover." }, 503);
    await db.from("logs_alteracoes").insert({ usuario, acao: PADRAO.has(id) ? "restaurou_cartao_carrossel" : "excluiu_cartao_carrossel", entidade: "home_campanhas", entidade_id: null, detalhes: { id } });
    return json({ ok: true });
  }

  return json({ erro: "Rota do carrossel não encontrada." }, 404);
}
