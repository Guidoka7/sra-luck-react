import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { obterCredencial, salvarCredencialInterna } from "./integrations-credenciais";
import { getCookie, verificarTokenAdmin } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";

const RD_CRM_BASE = "https://api.rd.services/crm/v2";
const RD_OAUTH_TOKEN = "https://api.rd.services/oauth2/token";
const RD_OAUTH_AUTHORIZE = "https://accounts.rdstation.com/oauth/authorize";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

type Json = Record<string, any>;
type Db = ReturnType<typeof createServiceSupabaseClient>;

export interface RdDealSnapshot {
  rdStationId: string;
  rdContactId: string | null;
  rdCampaignId: string | null;
  rdSourceId: string | null;
  rdOwnerId: string | null;
  rdPipelineId: string | null;
  rdStageId: string | null;
  rdStatus: string | null;
  rdUpdatedAt: string | null;
  nomeOriginal: string;
  cpfOriginal: string | null;
  telefoneOriginal: string | null;
  emailOriginal: string | null;
  campanhaOriginal: string | null;
  origemOriginal: string | null;
  vendedoraOriginal: string | null;
  valorOriginal: number;
  quantidadeParcelasOriginal: number | null;
  valorParcelaOriginal: number | null;
  taxaAdministrativaOriginal: number | null;
  tipoVendaOriginal: string | null;
  dataVenda: string;
  raw: Json;
}

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

function objectValue(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = stringValue(value).replace(/\s/g, "").replace(/R\$/gi, "");
  if (!raw) return null;
  const normalizado = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function semAcentos(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function deepEntries(value: unknown, out: Array<[string, unknown]> = [], prefix = ""): Array<[string, unknown]> {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => deepEntries(item, out, `${prefix}[${index}]`));
    return out;
  }
  for (const [key, child] of Object.entries(value as Json)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child !== "object") out.push([path.toLowerCase(), child]);
    else deepEntries(child, out, path);
  }
  return out;
}

function firstDeep(value: unknown, hints: string[]): unknown {
  const entries = deepEntries(value);
  const normalizadas = hints.map((hint) => hint.toLowerCase());
  const exata = entries.find(([key]) => normalizadas.includes(key.split(".").pop() || ""));
  if (exata) return exata[1];
  return entries.find(([key]) => normalizadas.some((hint) => key.includes(hint)))?.[1];
}

function firstString(value: unknown, hints: string[]) {
  return stringValue(firstDeep(value, hints));
}

function firstNumber(value: unknown, hints: string[]) {
  return numberValue(firstDeep(value, hints));
}

function customFieldValue(value: unknown, hints: string[]): unknown {
  const procurados = hints.map(semAcentos);
  for (const field of arrayValue(objectValue(value).custom_fields)) {
    const item = objectValue(field);
    const meta = objectValue(item.custom_field);
    const nome = semAcentos(stringValue(meta.label) || stringValue(meta.name) || stringValue(meta.slug) || stringValue(item.label) || stringValue(item.name) || stringValue(item.slug));
    if (nome && procurados.some((hint) => nome === hint || nome.includes(hint) || hint.includes(nome))) return item.value;
  }
  return undefined;
}

function firstId(value: unknown): string | null {
  const direto = stringValue(value);
  if (direto && !direto.includes("[object Object]")) return direto;
  if (Array.isArray(value)) {
    const primeiro = value[0];
    if (typeof primeiro === "string" || typeof primeiro === "number") return String(primeiro);
    const id = stringValue(objectValue(primeiro).id);
    return id || null;
  }
  return stringValue(objectValue(value).id) || null;
}

function idDe(obj: Json, singular: string, plural?: string): string | null {
  const direto = firstId(obj[`${singular}_id`]);
  if (direto) return direto;
  const singularObj = firstId(obj[singular]);
  if (singularObj) return singularObj;
  if (plural) return firstId(obj[plural]);
  return null;
}

function mapById(items: Json[]) {
  const mapa = new Map<string, Json>();
  for (const item of items) {
    const id = stringValue(item.id);
    if (id) mapa.set(id, item);
  }
  return mapa;
}

/**
 * Guarda arquitetural: a camada comercial RD Station é SOMENTE LEITURA.
 * POST/PATCH/PUT/DELETE são permitidos somente no endpoint OAuth, nunca em
 * /crm/v2/*. Esta função também é exercitada por teste para impedir regressão.
 */
export function assertRdCommercialReadOnly(method: string) {
  if (method.toUpperCase() !== "GET") throw new Error("RD_COMMERCIAL_WRITE_FORBIDDEN");
}

function base64Url(texto: string) {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(valor: string) {
  const normal = valor.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normal + "=".repeat((4 - (normal.length % 4)) % 4);
  const bin = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function hmacBase64Url(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  let bin = "";
  assinatura.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function criarState(adminId: string, segredo: string) {
  const payload = base64Url(JSON.stringify({ adminId, exp: Date.now() + 10 * 60_000 }));
  return `${payload}.${await hmacBase64Url(segredo, payload)}`;
}

async function validarState(state: string, segredo: string) {
  if (state.length > 8192 || state.split(".").length !== 2) return null;
  const [payload, assinatura] = state.split(".");
  if (!payload || !assinatura) return null;
  const esperado = await hmacBase64Url(segredo, payload);
  if (assinatura.length !== esperado.length) return null;
  let diff = 0;
  for (let i = 0; i < assinatura.length; i++) diff |= assinatura.charCodeAt(i) ^ esperado.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as { adminId?: string; exp?: number };
    if (typeof parsed.adminId !== "string" || !parsed.adminId || !Number.isFinite(parsed.exp) || parsed.exp! < Date.now() || parsed.exp! > Date.now() + 10 * 60_000) return null;
    return parsed.adminId;
  } catch { return null; }
}

async function requireAdminComPermissao(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!session) return null;
  const colaborador = await buscarColaboradorAdminAtivo(session.adminId, env);
  if (!colaborador || !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS)) return null;
  return session.adminId;
}

async function rdCredential(env: Env, chave: string, legado?: string) {
  return (await obterCredencial(env, "rd_station", chave)) || (legado ? await obterCredencial(env, "rd_station", legado) : null);
}

async function persistirTokens(env: Env, actor: string, token: Json) {
  const access = stringValue(token.access_token);
  const refresh = stringValue(token.refresh_token);
  if (!access || !refresh) throw new Error("RD_TOKEN_RESPONSE_INVALID");
  await salvarCredencialInterna(env, "rd_station", "access_token", access, actor);
  await salvarCredencialInterna(env, "rd_station", "refresh_token", refresh, actor);
  const expiresIn = Number(token.expires_in || 7200);
  const expiraEm = new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString();
  await salvarCredencialInterna(env, "rd_station", "token_expires_at", expiraEm, actor);
  return access;
}

async function tokenRequest(env: Env, params: Record<string, string>) {
  const clientId = await rdCredential(env, "client_id");
  const clientSecret = await rdCredential(env, "client_secret");
  if (!clientId || !clientSecret) throw new Error("RD_OAUTH_CLIENT_NOT_CONFIGURED");
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params });
  const response = await fetch(RD_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new Error(`RD_OAUTH_HTTP_${response.status}`);
  return data;
}

async function renovarToken(env: Env) {
  const refresh = await rdCredential(env, "refresh_token");
  if (!refresh) throw new Error("RD_REFRESH_TOKEN_MISSING");
  const token = await tokenRequest(env, { refresh_token: refresh, grant_type: "refresh_token" });
  return persistirTokens(env, "sistema:rd_station_refresh", token);
}

async function accessToken(env: Env) {
  return rdCredential(env, "access_token", "api_access_token");
}

async function rdGet(env: Env, path: string): Promise<Json> {
  assertRdCommercialReadOnly("GET");
  let token = await accessToken(env);
  if (!token) throw new Error("RD_ACCESS_TOKEN_MISSING");
  const executar = (access: string) => fetch(`${RD_CRM_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
  });
  let response = await executar(token);
  if (response.status === 401) {
    token = await renovarToken(env);
    response = await executar(token);
  }
  const data = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new Error(`RD_HTTP_${response.status}`);
  return data;
}

async function listarTudo(env: Env, resource: string, filter?: string) {
  const itens: Json[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams();
    q.set("page[number]", String(page));
    q.set("page[size]", String(PAGE_SIZE));
    if (filter) q.set("filter", filter);
    const resposta = await rdGet(env, `/${resource}?${q.toString()}`);
    const atual = arrayValue(resposta.data).map(objectValue);
    if (atual.length === 0) break;
    itens.push(...atual);
    const next = stringValue(objectValue(resposta.links).next);
    const total = Number(resposta.total ?? objectValue(resposta.meta).total ?? 0);
    if (next) continue;
    if (Number.isFinite(total) && total > itens.length) continue;
    if (atual.length >= PAGE_SIZE) continue;
    break;
  }
  return itens;
}

async function listarSeguro(env: Env, resource: string) {
  try { return await listarTudo(env, resource); } catch { return [] as Json[]; }
}

export function normalizarDealRd(deal: Json, refs: {
  contatos?: Map<string, Json>; usuarios?: Map<string, Json>; campanhas?: Map<string, Json>; fontes?: Map<string, Json>;
} = {}): RdDealSnapshot | null {
  const rdStationId = stringValue(deal.id);
  if (!rdStationId) return null;
  const rdContactId = idDe(deal, "contact", "contact_ids") || firstId(deal.contacts);
  const rdCampaignId = idDe(deal, "campaign");
  const rdSourceId = idDe(deal, "source");
  const rdOwnerId = idDe(deal, "owner") || idDe(deal, "user");
  const rdPipelineId = idDe(deal, "pipeline");
  const rdStageId = idDe(deal, "stage") || idDe(deal, "deal_stage");
  const contato = rdContactId ? refs.contatos?.get(rdContactId) : undefined;
  const campanha = rdCampaignId ? refs.campanhas?.get(rdCampaignId) : undefined;
  const fonte = rdSourceId ? refs.fontes?.get(rdSourceId) : undefined;
  const usuario = rdOwnerId ? refs.usuarios?.get(rdOwnerId) : undefined;
  const ownerInline = objectValue(deal.owner);
  const campaignInline = objectValue(deal.campaign);
  const sourceInline = objectValue(deal.source);
  const nomeOriginal = stringValue(contato?.name) || firstString(deal, ["contact_name", "nome_cliente", "customer_name"]) || stringValue(deal.name) || "Cliente RD Station";
  const cpfOriginal = (stringValue(customFieldValue(contato, ["cpf", "documento", "cpf cliente"])) || firstString(contato, ["cpf", "document", "documento"]) || stringValue(customFieldValue(deal, ["cpf", "documento", "cpf cliente"])) || firstString(deal, ["cpf", "document", "documento"])).replace(/\D/g, "") || null;
  const telefoneOriginal = firstString(contato, ["phone", "telefone", "mobile_phone", "celular"]) || firstString(deal, ["phone", "telefone", "celular"]) || null;
  const emailOriginal = firstString(contato, ["email"]) || firstString(deal, ["email"]) || null;
  const campanhaOriginal = stringValue(campanha?.name) || stringValue(campaignInline.name) || firstString(deal, ["campaign_name", "campanha"]) || null;
  const origemOriginal = stringValue(fonte?.name) || stringValue(sourceInline.name) || firstString(deal, ["source_name", "origem"]) || null;
  const vendedoraOriginal = stringValue(usuario?.name) || stringValue(ownerInline.name) || firstString(deal, ["owner_name", "user_name", "vendedor", "responsavel"]) || null;
  const valorOriginal = firstNumber(deal, ["total_price", "amount", "value", "valor_contrato"]) ?? numberValue(customFieldValue(deal, ["valor da carta", "carta de credito", "valor contrato"])) ?? 0;
  const quantidadeParcelasOriginal = numberValue(customFieldValue(deal, ["quantidade parcelas", "numero parcelas", "parcelas"])) ?? firstNumber(deal, ["quantidade_parcelas", "numero_parcelas"]);
  const valorParcelaOriginal = numberValue(customFieldValue(deal, ["valor parcela", "parcela valor"])) ?? firstNumber(deal, ["valor_parcela", "parcela_valor"]);
  const taxaAdministrativaOriginal = numberValue(customFieldValue(deal, ["taxa administrativa", "taxa adm"])) ?? firstNumber(deal, ["taxa_administrativa", "taxa_adm"]);
  const tipoVendaOriginal = stringValue(customFieldValue(deal, ["tipo venda", "modalidade", "tipo contrato"])) || firstString(deal, ["tipo_venda", "modalidade", "contract_type"]) || null;
  const dataVenda = stringValue(deal.closed_at) || stringValue(deal.date_closed) || stringValue(deal.created_at) || new Date().toISOString();
  return {
    rdStationId, rdContactId, rdCampaignId, rdSourceId, rdOwnerId, rdPipelineId, rdStageId,
    rdStatus: stringValue(deal.status).toLowerCase() || null,
    rdUpdatedAt: stringValue(deal.updated_at) || null,
    nomeOriginal, cpfOriginal, telefoneOriginal, emailOriginal, campanhaOriginal, origemOriginal, vendedoraOriginal,
    valorOriginal,
    quantidadeParcelasOriginal: quantidadeParcelasOriginal == null ? null : Math.max(1, Math.round(quantidadeParcelasOriginal)),
    valorParcelaOriginal, taxaAdministrativaOriginal, tipoVendaOriginal, dataVenda, raw: deal,
  };
}

export function snapshotUpdatePreservandoLocal(snapshot: RdDealSnapshot) {
  return {
    payload_original: snapshot.raw,
    rd_snapshot: snapshot.raw,
    rd_contact_id: snapshot.rdContactId,
    rd_campaign_id: snapshot.rdCampaignId,
    rd_source_id: snapshot.rdSourceId,
    rd_owner_id: snapshot.rdOwnerId,
    rd_pipeline_id: snapshot.rdPipelineId,
    rd_stage_id: snapshot.rdStageId,
    rd_status: snapshot.rdStatus,
    rd_nome_original: snapshot.nomeOriginal,
    rd_cpf_original: snapshot.cpfOriginal,
    rd_telefone_original: snapshot.telefoneOriginal,
    rd_email_original: snapshot.emailOriginal,
    rd_campanha_original: snapshot.campanhaOriginal,
    rd_origem_original: snapshot.origemOriginal,
    rd_vendedora_original: snapshot.vendedoraOriginal,
    rd_valor_original: snapshot.valorOriginal,
    rd_updated_at: snapshot.rdUpdatedAt,
    sincronizado_rd_em: new Date().toISOString(),
    rd_excluido_em: null,
    updated_at: new Date().toISOString(),
  };
}

async function persistirNovaVenda(db: Db, snapshot: RdDealSnapshot) {
  const { data: existente, error: erroBusca } = await db.from("novas_vendas").select("id,cliente_id,status").eq("rd_station_id", snapshot.rdStationId).maybeSingle();
  if (erroBusca) throw erroBusca;
  if (existente) {
    const { error } = await db.from("novas_vendas").update(snapshotUpdatePreservandoLocal(snapshot)).eq("id", existente.id);
    if (error) throw error;
    return { criada: false, atualizada: true, ignorada: false, id: existente.id };
  }
  if (snapshot.rdStatus && snapshot.rdStatus !== "won") return { criada: false, atualizada: false, ignorada: true, id: null };
  const insert = {
    rd_station_id: snapshot.rdStationId,
    nome_completo: snapshot.nomeOriginal,
    cpf: snapshot.cpfOriginal,
    telefone: snapshot.telefoneOriginal,
    email: snapshot.emailOriginal,
    data_venda: snapshot.dataVenda,
    vendedora_responsavel: snapshot.vendedoraOriginal,
    valor_contrato: snapshot.valorOriginal,
    quantidade_parcelas: snapshot.quantidadeParcelasOriginal,
    valor_parcela: snapshot.valorParcelaOriginal,
    taxa_administrativa: snapshot.taxaAdministrativaOriginal,
    tipo_venda: snapshot.tipoVendaOriginal,
    origem_venda: snapshot.origemOriginal,
    campanha_local: snapshot.campanhaOriginal,
    status: "aguardando_cadastro",
    ...snapshotUpdatePreservandoLocal(snapshot),
  };
  const { data, error } = await db.from("novas_vendas").insert(insert).select("id").single();
  if (error) throw error;
  return { criada: true, atualizada: false, ignorada: false, id: data.id };
}

async function registrarEvento(db: Db, input: { eventId?: string | null; eventType: string; referencia?: string | null; payload?: unknown; status?: string; erro?: string | null }) {
  const row = {
    provedor: "rd_station",
    event_id: input.eventId || null,
    event_type: input.eventType,
    referencia: input.referencia || null,
    payload: input.payload || {},
    status: input.status || "processado",
    erro: input.erro || null,
    processado_em: input.status === "erro" ? null : new Date().toISOString(),
  };
  if (row.event_id) return db.from("integracao_eventos").upsert(row, { onConflict: "provedor,event_id", ignoreDuplicates: true });
  return db.from("integracao_eventos").insert(row);
}

async function handleWebhook(request: Request, env: Env) {
  const secret = await rdCredential(env, "webhook_secret");
  if (!secret) return json({ erro: "Webhook RD Station não configurado." }, 503);
  const supplied = request.headers.get("x-sra-luck-rd-key") || request.headers.get("x-rd-webhook-key") || "";
  if (!supplied || supplied.length !== secret.length) return json({ erro: "Webhook não autorizado." }, 401);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1_000_000) return json({ erro: "Evento muito grande." }, 413);
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) diff |= supplied.charCodeAt(i) ^ secret.charCodeAt(i);
  if (diff !== 0) return json({ erro: "Webhook não autorizado." }, 401);

  const payload = await request.json().catch(() => null) as Json | null;
  if (!payload) return json({ erro: "JSON inválido." }, 400);
  const eventType = stringValue(payload.event_name) || "unknown";
  const transaction = stringValue(payload.transaction_uuid) || null;
  const document = objectValue(payload.document);
  const dealId = stringValue(document.id) || null;
  const db = createServiceSupabaseClient(env);

  if (transaction) {
    const { data: duplicado } = await db.from("crm_vendas_entrada").select("id").eq("provedor", "rd_station").eq("transaction_uuid", transaction).maybeSingle();
    if (duplicado) return json({ ok: true, duplicate: true, id: duplicado.id });
  }

  const snapshot = eventType.startsWith("crm_deal_") ? normalizarDealRd(document) : null;
  let persistencia: any = null;
  try {
    if (eventType === "crm_deal_deleted" && dealId) {
      await db.from("novas_vendas").update({ rd_status: "deleted", rd_excluido_em: new Date().toISOString(), rd_snapshot: document, payload_original: document, sincronizado_rd_em: new Date().toISOString() }).eq("rd_station_id", dealId);
    } else if (snapshot) {
      persistencia = await persistirNovaVenda(db, snapshot);
    }

    await db.from("crm_vendas_entrada").insert({
      provedor: "rd_station",
      external_deal_id: dealId,
      transaction_uuid: transaction,
      event_name: eventType,
      cliente_nome: snapshot?.nomeOriginal ?? null,
      cliente_cpf: snapshot?.cpfOriginal ?? null,
      cliente_email: snapshot?.emailOriginal ?? null,
      cliente_telefone: snapshot?.telefoneOriginal ?? null,
      campanha: snapshot?.campanhaOriginal ?? null,
      origem: snapshot?.origemOriginal ?? null,
      vendedor: snapshot?.vendedoraOriginal ?? null,
      valor_contrato: snapshot?.valorOriginal ?? null,
      payload,
      status: "aguardando_conferencia",
    });
    await registrarEvento(db, { eventId: transaction, eventType, referencia: dealId, payload, status: "processado" });
    return json({ ok: true, recebido: true, venda: persistencia });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "Falha ao persistir webhook RD";
    await registrarEvento(db, { eventId: transaction, eventType, referencia: dealId, payload, status: "erro", erro: mensagem });
    return json({ erro: "Não foi possível processar o evento do RD Station." }, 500);
  }
}

async function sincronizar(request: Request, env: Env, adminId: string) {
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const db = createServiceSupabaseClient(env);
  try {
    const deals = await listarTudo(env, "deals", "status:won");
    const [contatos, usuarios, campanhas, fontes] = await Promise.all([
      listarSeguro(env, "contacts"), listarSeguro(env, "users"), listarSeguro(env, "campaigns"), listarSeguro(env, "sources"),
    ]);
    const refs = { contatos: mapById(contatos), usuarios: mapById(usuarios), campanhas: mapById(campanhas), fontes: mapById(fontes) };
    let criadas = 0, atualizadas = 0, ignoradas = 0, erros = 0;
    for (const deal of deals) {
      const snapshot = normalizarDealRd(deal, refs);
      if (!snapshot) { ignoradas++; continue; }
      try {
        const r = await persistirNovaVenda(db, snapshot);
        if (r.criada) criadas++;
        else if (r.atualizada) atualizadas++;
        else ignoradas++;
      } catch { erros++; }
    }
    const resumo = { totalRd: deals.length, criadas, atualizadas, ignoradas, erros, somenteLeitura: true };
    await registrarEvento(db, { eventType: "sync_manual", payload: resumo, status: erros ? "parcial" : "processado" });
    await db.from("logs_alteracoes").insert({ usuario: `admin:${adminId}`, acao: "sincronizou_rd_station_somente_leitura", entidade: "integracoes", entidade_id: "rd_station", detalhes: resumo });
    return json(resumo, erros ? 207 : 200);
  } catch (error) {
    console.error("Falha ao sincronizar RD Station em modo somente leitura:", error);
    await registrarEvento(db, { eventType: "sync_manual", status: "erro", erro: "Falha na sincronização RD Station", payload: {} });
    return json({ erro: "Falha ao sincronizar o RD Station em modo somente leitura." }, 502);
  }
}

async function testar(env: Env, adminId: string) {
  const db = createServiceSupabaseClient(env);
  try {
    const resposta = await rdGet(env, "/users?page[number]=1&page[size]=1");
    const conectado = Array.isArray(resposta.data);
    const resultado = { conectado, detalhe: conectado ? "OAuth/API v2 respondeu em modo somente leitura." : "Resposta inesperada do RD Station." };
    await db.from("logs_alteracoes").insert({ usuario: `admin:${adminId}`, acao: "testou_conexao_integracao", entidade: "integracoes", entidade_id: "rd_station", detalhes: resultado });
    return json(resultado, conectado ? 200 : 502);
  } catch (error) {
    console.error("Falha ao testar conexão com RD Station:", error);
    const resultado = { conectado: false, detalhe: "Não foi possível validar a conexão com o RD Station agora." };
    await db.from("logs_alteracoes").insert({ usuario: `admin:${adminId}`, acao: "testou_conexao_integracao", entidade: "integracoes", entidade_id: "rd_station", detalhes: resultado });
    return json(resultado, 502);
  }
}

async function authorizationUrl(env: Env, adminId: string) {
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Segredo de sessão não configurado." }, 503);
  const clientId = await rdCredential(env, "client_id");
  const redirectUri = await rdCredential(env, "redirect_uri") || `${(env.PUBLIC_APP_URL || "").replace(/\/$/, "")}/api/integrations/rd-station/oauth/callback`;
  if (!clientId || !redirectUri.startsWith("https://")) return json({ erro: "Configure Client ID e Redirect URI HTTPS do RD Station." }, 409);
  const state = await criarState(adminId, env.CLIENTE_SESSION_SECRET);
  const url = new URL(RD_OAUTH_AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return json({ url: url.toString(), redirectUri, somenteLeitura: true });
}

async function oauthCallback(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço indisponível." }, 503);
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const adminId = await validarState(state, env.CLIENTE_SESSION_SECRET);
  if (!code || !adminId) return json({ erro: "Retorno OAuth inválido ou expirado." }, 400);

  // O cookie administrativo usa Path=/api/admin e, por desenho, não é
  // enviado ao callback OAuth em /api/integrations. O state assinado e
  // expirável identifica quem iniciou o fluxo; aqui revalidamos que esse
  // colaborador continua ativo e autorizado antes de persistir tokens.
  const colaborador = await buscarColaboradorAdminAtivo(adminId, env).catch(() => null);
  if (!colaborador || !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS)) {
    return json({ erro: "Sem permissão para concluir a autorização do RD Station." }, 403);
  }

  const redirectUri = await rdCredential(env, "redirect_uri") || `${(env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "")}/api/integrations/rd-station/oauth/callback`;
  try {
    const token = await tokenRequest(env, { code, redirect_uri: redirectUri, grant_type: "authorization_code" });
    await persistirTokens(env, colaborador.id, token);
    const db = createServiceSupabaseClient(env);
    await db.from("logs_alteracoes").insert({ usuario: colaborador.id, acao: "autorizou_oauth_rd_station", entidade: "integracoes", entidade_id: "rd_station", detalhes: { somenteLeitura: true } });
    const destino = `${(env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "")}/admin/integracoes?rd=conectado`;
    return Response.redirect(destino, 302);
  } catch (error) {
    console.error("Falha ao concluir OAuth do RD Station:", error);
    return json({ erro: "Não foi possível concluir a autorização OAuth do RD Station." }, 502);
  }
}

export async function rdStationReadonlyApi(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/integrations/rd-station/webhook" && request.method === "POST") return handleWebhook(request, env);
  if (path === "/api/integrations/rd-station/oauth/callback" && request.method === "GET") return oauthCallback(request, env);
  if (!path.startsWith("/api/admin/integrations/rd-station/")) return null;
  const adminId = await requireAdminComPermissao(request, env);
  if (!adminId) return json({ erro: "Sem permissão para gerenciar a integração RD Station." }, 403);
  if (path.endsWith("/authorize-url") && request.method === "GET") return authorizationUrl(env, adminId);
  if (path.endsWith("/sync") && request.method === "POST") return sincronizar(request, env, adminId);
  if (path.endsWith("/test") && request.method === "POST") return testar(env, adminId);
  return json({ erro: "Rota RD Station não encontrada." }, 404);
}
