import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { obterCredencial, obterCredencialParaValidacao, salvarCredencialInterna } from "./integrations-credenciais";
import { getCookie, verificarTokenAdmin } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { atualizarCatalogoCrm } from "./crm-catalogo";
import { descartarRevisao, importarCrm, importarDoWebhook, importarMesmoAssim, itensDaImportacao, listarImportacoes, opcoesCrm, usarPerfilDaDuplicata } from "./crm-importacao";

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

export function objectValue(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

export function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function numberValue(value: unknown): number | null {
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

/**
 * Campo personalizado do RD por nome aproximado. O CRM v2 devolve `custom_fields` como OBJETO
 * `{ slug: valor }` (visto em 1.207 de 1.209 negociações em 28/09); a versão antiga, como lista.
 * Antes só a lista era lida, e campos como `quantidade-de-parcelas` ficavam vazios.
 * Nome exato ganha de nome parecido, para não trocar um campo por outro.
 */
export function customFieldValue(value: unknown, hints: string[]): unknown {
  const procurados = hints.map(semAcentos);
  const cf = objectValue(value).custom_fields;
  const campos: { nome: string; valor: unknown }[] = cf && typeof cf === "object" && !Array.isArray(cf)
    ? Object.entries(cf as Json).map(([slug, valor]) => ({ nome: semAcentos(slug), valor }))
    : arrayValue(cf).map((field) => {
      const item = objectValue(field);
      const meta = objectValue(item.custom_field);
      return { nome: semAcentos(stringValue(meta.label) || stringValue(meta.name) || stringValue(meta.slug) || stringValue(item.label) || stringValue(item.name) || stringValue(item.slug)), valor: item.value };
    });
  const preenchido = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  const exato = campos.find((c) => c.nome && procurados.includes(c.nome) && preenchido(c.valor));
  if (exato) return exato.valor;
  const parecido = campos.find((c) => c.nome && preenchido(c.valor) && procurados.some((hint) => c.nome.includes(hint) || hint.includes(c.nome)));
  return parecido?.valor;
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

export function mapById(items: Json[]) {
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

export async function criarState(adminId: string, segredo: string) {
  const payload = base64Url(JSON.stringify({ adminId, exp: Date.now() + 10 * 60_000 }));
  return `${payload}.${await hmacBase64Url(segredo, payload)}`;
}

export async function validarState(state: string, segredo: string) {
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
async function rdCredentialConfiguracao(env: Env, chave: string, legado?: string) {
  return (await obterCredencialParaValidacao(env, "rd_station", chave))
    || (legado ? await obterCredencialParaValidacao(env, "rd_station", legado) : null);
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
  const clientId = await rdCredentialConfiguracao(env, "client_id");
  const clientSecret = await rdCredentialConfiguracao(env, "client_secret");
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

// Agrupa a renovação das chamadas paralelas da mesma conexão, sem expor tokens.
const renovacoesEmCurso = new Map<string, Promise<string>>();
async function tokenApos401(env: Env, anterior: string) {
  const atual = await accessToken(env);
  if (atual && atual !== anterior) return atual;
  const existente = renovacoesEmCurso.get(anterior);
  if (existente) return existente;
  const tarefa = renovarToken(env);
  renovacoesEmCurso.set(anterior, tarefa);
  try { return await tarefa; }
  finally { if (renovacoesEmCurso.get(anterior) === tarefa) renovacoesEmCurso.delete(anterior); }
}

export function erroOpcoesRd(error: unknown) {
  const mensagem = error instanceof Error ? error.message : "";
  const codigo = /^RD_[A-Z0-9_]+$/.test(mensagem) ? mensagem : "RD_OPTIONS_UNAVAILABLE";
  const acao = /OAUTH|TOKEN|HTTP_401|HTTP_403/.test(codigo)
    ? "Confira a conexão OAuth do RD no painel Dev e reconecte se necessário."
    : codigo === "RD_HTTP_429" ? "O RD limitou as consultas. Aguarde um momento e tente novamente."
    : "Tente carregar novamente. Se persistir, confira a conexão do RD no painel Dev.";
  return { erro: `Não foi possível carregar funis e campos. ${acao} (${codigo})`, codigo };
}

async function accessToken(env: Env) {
  return rdCredential(env, "access_token", "api_access_token");
}

/**
 * O CRM v2 aceita 120 requisições por minuto por CONTA (importação, webhook, catálogo e
 * reprocessamento somam no mesmo limite). Todas as chamadas desta instância passam por este
 * ritmo (~90/min, com folga) e, num 429, esperam o Retry-After antes de tentar de novo.
 */
const RD_INTERVALO_MS = typeof process !== "undefined" && process.env?.VITEST ? 0 : 650;
const RD_TENTATIVAS_429 = 2;
const RD_ESPERA_MAX_MS = 30_000;
let rdProximaVez = 0;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reserva a próxima vez livre para chamar o RD (chamadas paralelas ficam em fila). */
async function vezDoRd() {
  const agora = Date.now();
  const minha = Math.max(agora, rdProximaVez);
  rdProximaVez = minha + RD_INTERVALO_MS;
  if (minha > agora) await esperar(minha - agora);
}

/** Retry-After do RD em ms (segundos ou data HTTP); sem cabeçalho, espera um intervalo prudente. */
export function esperaDoRetryAfter(valor: string | null, padraoMs = 5_000) {
  if (!valor) return padraoMs;
  const segundos = Number(valor);
  const ms = Number.isFinite(segundos) ? segundos * 1000 : Date.parse(valor) - Date.now();
  return Math.min(RD_ESPERA_MAX_MS, Math.max(1_000, Number.isFinite(ms) ? ms : padraoMs));
}

export async function rdGet(env: Env, path: string): Promise<Json> {
  assertRdCommercialReadOnly("GET");
  let token = await accessToken(env);
  if (!token) throw new Error("RD_ACCESS_TOKEN_MISSING");
  const executar = async (access: string) => {
    await vezDoRd();
    return fetch(`${RD_CRM_BASE}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
    });
  };
  let response = await executar(token);
  for (let tentativa = 0; response.status === 429 && tentativa < RD_TENTATIVAS_429; tentativa++) {
    // Pausa TODAS as chamadas desta instância até o RD liberar.
    const espera = esperaDoRetryAfter(response.headers?.get?.("Retry-After") ?? null);
    rdProximaVez = Math.max(rdProximaVez, Date.now() + espera);
    response = await executar(token);
  }
  if (response.status === 401) {
    token = await tokenApos401(env, token);
    response = await executar(token);
  }
  const data = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new Error(`RD_HTTP_${response.status}`);
  return data;
}

async function rdWebhookRequest(env: Env, method: "GET" | "POST" | "PUT", path: string, body?: Json): Promise<Json> {
  if (!path.startsWith("/webhooks")) throw new Error("RD_WEBHOOK_PATH_INVALID");
  let token = await rdCredentialConfiguracao(env, "access_token", "api_access_token");
  if (!token) throw new Error("RD_ACCESS_TOKEN_MISSING");
  const executar = async (access: string) => { await vezDoRd(); return fetch(`${RD_CRM_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${access}`,
      Accept: "application/json",
      ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  }); };
  let response = await executar(token);
  if (response.status === 401) {
    token = await tokenApos401(env, token);
    response = await executar(token);
  }
  const data = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new Error(`RD_WEBHOOK_HTTP_${response.status}`);
  return data;
}

function gerarSegredoWebhook() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const RD_WEBHOOK_EVENTS = ["crm_deal_created", "crm_deal_updated", "crm_deal_deleted"] as const;
const RD_WEBHOOK_HEADER = "x-sra-luck-rd-key";

export async function garantirWebhooksRd(env: Env, actor = "sistema:rd_station_webhook_setup") {
  const db = createServiceSupabaseClient(env);
  let secret = await rdCredentialConfiguracao(env, "webhook_secret");
  let segredoCriado = false;
  if (!secret) {
    secret = gerarSegredoWebhook();
    await salvarCredencialInterna(env, "rd_station", "webhook_secret", secret, actor);
    segredoCriado = true;
  }

  const base = (env.PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!base.startsWith("https://")) throw new Error("RD_WEBHOOK_PUBLIC_URL_MISSING");
  const callbackUrl = `${base}/api/integrations/rd-station/webhook`;

  const listagem = await rdWebhookRequest(env, "GET", "/webhooks?page[number]=1&page[size]=100");
  const existentes = arrayValue(listagem.data).map(objectValue);
  const resultados: Array<{ event: string; id: string | null; acao: "criado" | "atualizado" | "mantido" }> = [];

  for (const event of RD_WEBHOOK_EVENTS) {
    const nome = `Sra. Luck · ${event}`;
    const existente = existentes.find((item) => {
      const mesmoEvento = stringValue(item.event_name) === event;
      const mesmaUrl = stringValue(item.url) === callbackUrl;
      const mesmoNome = stringValue(item.name) === nome;
      return mesmoEvento && (mesmaUrl || mesmoNome);
    });

    const data = {
      name: nome,
      event_name: event,
      http_method: "POST",
      url: callbackUrl,
      status: "active",
      auth_header: RD_WEBHOOK_HEADER,
      auth_key: secret,
    };

    if (!existente) {
      const criado = await rdWebhookRequest(env, "POST", "/webhooks", { data });
      resultados.push({ event, id: stringValue(objectValue(criado.data).id) || null, acao: "criado" });
      continue;
    }

    const id = stringValue(existente.id);
    const precisaAtualizar = segredoCriado
      || stringValue(existente.url) !== callbackUrl
      || stringValue(existente.status) !== "active"
      || stringValue(existente.http_method).toUpperCase() !== "POST"
      || stringValue(existente.auth_header).toLowerCase() !== RD_WEBHOOK_HEADER;

    if (precisaAtualizar && id) {
      const atualizado = await rdWebhookRequest(env, "PUT", `/webhooks/${encodeURIComponent(id)}`, { data });
      resultados.push({ event, id: stringValue(objectValue(atualizado.data).id) || id, acao: "atualizado" });
    } else {
      resultados.push({ event, id: id || null, acao: "mantido" });
    }
  }

  await db.from("logs_alteracoes").insert({
    usuario: actor,
    acao: "configurou_webhooks_rd_station",
    entidade: "integracoes",
    entidade_id: "rd_station",
    detalhes: {
      callbackUrl,
      authHeader: RD_WEBHOOK_HEADER,
      segredoCriado,
      eventos: resultados,
    },
  });

  return {
    ok: true as const,
    callbackUrl,
    authHeader: RD_WEBHOOK_HEADER,
    segredoConfigurado: true,
    segredoCriado,
    eventos: resultados,
  };
}

export async function listarTudo(env: Env, resource: string, filter?: string) {
  const itens: Json[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams();
    q.set("page[number]", String(page));
    q.set("page[size]", String(PAGE_SIZE));
    // Negociações mudam de posição na ordenação padrão durante a leitura de várias páginas.
    // Uma ordem por criação evita pular ou repetir registros quando são atualizadas no RD.
    if (resource === "deals") q.set("sort[created_at]", "asc");
    if (filter) q.set("filter", filter);
    const resposta = await rdGet(env, `/${resource}?${q.toString()}`);
    const atual = arrayValue(resposta.data).map(objectValue);
    if (atual.length === 0) break;
    itens.push(...atual);
    const next = stringValue(objectValue(resposta.links).next);
    const total = Number(resposta.total ?? objectValue(resposta.meta).total ?? 0);
    // A API do RD só permite acessar os 10 mil primeiros registros de um filtro.
    // Nunca apresentar uma leitura interrompida como importação completa.
    if (page === MAX_PAGES && (next || total > itens.length || atual.length >= PAGE_SIZE)) {
      throw new Error("RD_RESULT_LIMIT_10000");
    }
    if (next) continue;
    if (Number.isFinite(total) && total > itens.length) continue;
    if (atual.length >= PAGE_SIZE) continue;
    break;
  }
  return itens;
}

/**
 * A API só permite navegar os primeiros 10 mil resultados de CADA filtro.
 * Quando um funil excede esse limite, divide a busca por intervalos de criação
 * sem sobreposição (início inclusivo, fim exclusivo).
 */
export async function listarDealsPorPeriodos(
  filtro: string,
  listar: (filtro: string) => Promise<Json[]>,
  inicio = Date.UTC(1970, 0, 1),
  fim = Date.UTC(2100, 0, 1),
): Promise<Json[]> {
  const formatar = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  const intervalo = `${filtro} created_at:>="${formatar(inicio)}" created_at:<"${formatar(fim)}"`.trim();
  try {
    return await listar(intervalo);
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "RD_RESULT_LIMIT_10000") throw e;
    const meio = Math.floor((inicio + fim) / 2000) * 1000;
    if (meio <= inicio || meio >= fim) throw new Error("RD_RESULT_LIMIT_SAME_SECOND");
    const anterior = await listarDealsPorPeriodos(filtro, listar, inicio, meio);
    const posterior = await listarDealsPorPeriodos(filtro, listar, meio, fim);
    return [...anterior, ...posterior];
  }
}

export async function listarDealsTodosFunis(env: Env): Promise<Json[]> {
  const funis = await listarTudo(env, "pipelines");
  const ids = [...new Set(funis.map((f) => stringValue(f.id)).filter(Boolean))];
  if (!ids.length) throw new Error("RD_PIPELINES_EMPTY");
  const deals: Json[] = [];
  for (const id of ids) {
    const filtro = `pipeline_id:${id}`;
    try {
      deals.push(...await listarTudo(env, "deals", filtro));
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "RD_RESULT_LIMIT_10000") throw e;
      deals.push(...await listarDealsPorPeriodos(filtro, (f) => listarTudo(env, "deals", f)));
    }
  }
  return deals;
}

/**
 * Contatos das negociações, um GET /contacts/{id} por contato (o RDQL de contatos não filtra
 * por id). Concorrência limitada e nova tentativa em 429. Falhas voltam em `falhas`: quem chama
 * decide não gravar dados de contato vazios no lugar de dados que existem no RD.
 */
export async function lerContatosPorId(
  ids: string[],
  ler: (id: string) => Promise<Json>,
  opcoes: { concorrencia?: number; esperas?: number[]; prazoMs?: number } = {},
): Promise<{ contatos: Map<string, Json>; falhas: Set<string>; limitadas: Set<string> }> {
  const unicos = [...new Set(ids.map((id) => stringValue(id)).filter(Boolean))];
  const contatos = new Map<string, Json>();
  const falhas = new Set<string>();
  /** Não lidas agora (limite do RD, instabilidade ou fim do prazo desta execução): ficam para a próxima. */
  const limitadas = new Set<string>();
  const fim = opcoes.prazoMs ? Date.now() + opcoes.prazoMs : Infinity;
  const esperas = opcoes.esperas ?? [1000, 3000, 6000];
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < unicos.length) {
      const id = unicos[proximo++];
      if (Date.now() >= fim) { limitadas.add(id); continue; }
      for (let tentativa = 0; ; tentativa++) {
        try {
          const r = await ler(id);
          const contato = objectValue(r.data ?? r);
          if (stringValue(contato.id) || Object.keys(contato).length) contatos.set(id, { ...contato, id: stringValue(contato.id) || id });
          else falhas.add(id);
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          const limite = msg === "RD_HTTP_429";
          if (limite && tentativa < esperas.length && Date.now() < fim) { await new Promise((r) => setTimeout(r, esperas[tentativa])); continue; }
          // Só 404/410 é "contato não existe mais no RD"; limite, 5xx e rede são temporários (próxima execução).
          (/^RD_HTTP_(404|410)$/.test(msg) ? falhas : limitadas).add(id);
          break;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opcoes.concorrencia ?? 6, unicos.length) }, trabalhador));
  return { contatos, falhas, limitadas };
}

/** rdGet já espera o Retry-After; aqui só uma tentativa extra e concorrência baixa (o ritmo é global). */
export async function lerContatosRd(env: Env, ids: string[], prazoMs?: number) {
  return lerContatosPorId(ids, (id) => rdGet(env, `/contacts/${encodeURIComponent(id)}`), { concorrencia: 3, esperas: [2_000], prazoMs });
}

/** Só o que a importação usa do contato (cache guardado junto da venda). */
export function contatoParaCache(contato: Json) {
  const c = objectValue(contato);
  return {
    id: stringValue(c.id) || null, name: c.name ?? null, phones: arrayValue(c.phones), emails: arrayValue(c.emails),
    whatsapp_username: c.whatsapp_username ?? null, job_title: c.job_title ?? null, birthday: c.birthday ?? null,
    custom_fields: objectValue(c.custom_fields), updated_at: c.updated_at ?? null,
  };
}

/** IDs dos contatos ligados a uma negociação (v2: contact_ids; formatos antigos: contact/contacts). */
export function idsContatoDaNegociacao(deal: Json): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => { const id = typeof v === "object" && v ? stringValue(objectValue(v).id) : stringValue(v); if (id) ids.add(id); };
  add(deal.contact_id);
  add(deal.contact);
  for (const v of arrayValue(deal.contact_ids)) add(v);
  for (const v of arrayValue(deal.contacts)) add(v);
  return [...ids];
}

export async function listarSeguro(env: Env, resource: string) {
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
  const quantidadeParcelasOriginal = numberValue(customFieldValue(deal, ["quantidade de parcelas", "quantidade parcelas", "numero parcelas", "parcelas"])) ?? firstNumber(deal, ["quantidade_parcelas", "numero_parcelas"]);
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

export async function registrarEvento(db: Db, input: { eventId?: string | null; eventType: string; referencia?: string | null; payload?: unknown; status?: string; erro?: string | null }) {
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

type BackgroundContext = { waitUntil?: (p: Promise<unknown>) => void };

/** Resultado da negociação → status do registro bruto do webhook. */
export function statusEntradaWebhook(resultado: string | null): "convertido" | "ignorado" | "erro" | "aguardando_conferencia" {
  if (resultado === "criada" || resultado === "atualizada") return "convertido";
  if (resultado === "ignorada") return "ignorado";
  if (resultado === "erro") return "erro";
  return "aguardando_conferencia"; // duplicidade: segue para a revisão
}

async function processarWebhookRd(payload: Json, env: Env) {
  const eventType = stringValue(payload.event_name) || "unknown";
  const transaction = stringValue(payload.transaction_uuid) || null;
  const document = objectValue(payload.document);
  const dealId = stringValue(document.id) || null;
  const db = createServiceSupabaseClient(env);

  if (transaction) {
    const { data: duplicado } = await db.from("crm_vendas_entrada").select("id").eq("provedor", "rd_station").eq("transaction_uuid", transaction).maybeSingle();
    if (duplicado) return { ok: true, duplicate: true, id: duplicado.id };
  }

  let snapshot: RdDealSnapshot | null = null;
  let persistencia: any = null;
  try {
    if (eventType === "crm_deal_deleted" && dealId) {
      await db.from("novas_vendas").update({ rd_status: "deleted", rd_excluido_em: new Date().toISOString(), rd_snapshot: document, payload_original: document, sincronizado_rd_em: new Date().toISOString() }).eq("rd_station_id", dealId);
    } else if (eventType.startsWith("crm_deal_")) {
      const r = await importarDoWebhook(env, db, document, transaction);
      snapshot = r?.snapshot ?? null;
      persistencia = r ? { resultado: r.item.resultado, id: r.item.nova_venda_id, motivo: r.item.motivo } : null;
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
      // O status reflete o que aconteceu (antes, tudo ficava "aguardando_conferencia" e nenhuma
      // tela lia essa tabela). O que exige ação está na fila integracao_pendencias.
      status: statusEntradaWebhook(persistencia?.resultado ?? null),
    });
    await registrarEvento(db, { eventId: transaction, eventType, referencia: dealId, payload, status: "processado" });
    return { ok: true, recebido: true, venda: persistencia };
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "Falha ao persistir webhook RD";
    await registrarEvento(db, { eventId: transaction, eventType, referencia: dealId, payload, status: "erro", erro: mensagem });
    throw error;
  }
}

async function handleWebhook(request: Request, env: Env, ctx?: BackgroundContext) {
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

  const tarefa = processarWebhookRd(payload, env);
  if (ctx?.waitUntil) {
    ctx.waitUntil(tarefa.then(() => undefined).catch(() => undefined));
    return json({ ok: true, recebido: true, processamento: "segundo_plano" }, 202);
  }

  try {
    return json(await tarefa);
  } catch {
    return json({ erro: "Não foi possível processar o evento do RD Station." }, 500);
  }
}

async function sincronizar(request: Request, env: Env, adminId: string, ctx?: BackgroundContext) {
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const ator = `admin:${adminId}`;
  const tarefa = (async () => {
    const r = await importarCrm(env, { origem: "manual", ator });
    if (r.ok) {
      await createServiceSupabaseClient(env).from("logs_alteracoes").insert({
        usuario: ator,
        acao: "sincronizou_rd_station_somente_leitura",
        entidade: "integracoes",
        entidade_id: "rd_station",
        detalhes: r,
      });
    }
    return r;
  })();

  if (ctx?.waitUntil) {
    ctx.waitUntil(tarefa.then(() => undefined).catch(() => undefined));
    return json({ ok: true, iniciado: true, processamento: "segundo_plano" }, 202);
  }

  const r = await tarefa;
  if (!r.ok) return json({ erro: r.erro }, "ocupado" in r && r.ocupado ? 409 : 502);
  return json(r, r.erros ? 207 : 200);
}

async function rotasCrm(request: Request, env: Env, adminId: string, path: string): Promise<Response | null> {
  const db = createServiceSupabaseClient(env);
  const url = new URL(request.url);
  if (path.endsWith("/opcoes") && request.method === "GET") {
    try { return json(await opcoesCrm(env)); } catch (error) { return json(erroOpcoesRd(error), 502); }
  }
  if (path.endsWith("/opcoes/atualizar") && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
    try {
      const r = await atualizarCatalogoCrm(env, { db });
      await db.from("logs_alteracoes").insert({ usuario: `admin:${adminId}`, acao: "atualizou_catalogo_rd_station", entidade: "integracoes", entidade_id: "rd_station", detalhes: { funis: r.funis.length, duracaoMs: r.catalogo.duracaoMs, escritaNoRd: false } });
      return json(r);
    } catch (error) { return json(erroOpcoesRd(error), 502); }
  }
  if (path.endsWith("/importacoes") && request.method === "GET") return json(await listarImportacoes(db, Number(url.searchParams.get("limite") || 30), url.searchParams.get("webhook") === "1"));
  if (path.endsWith("/importacoes/revisao") && request.method === "GET") return json({ itens: await itensDaImportacao(db, null, true) });
  const itens = path.match(/\/importacoes\/([0-9a-f-]{36})\/itens$/);
  if (itens && request.method === "GET") return json({ itens: await itensDaImportacao(db, itens[1]) });
  const revisar = path.match(/\/importacoes\/itens\/([0-9a-f-]{36})\/(importar|descartar|usar-perfil)$/);
  if (revisar && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
    const ator = `admin:${adminId}`;
    const r = revisar[2] === "importar" ? await importarMesmoAssim(db, revisar[1], ator)
      : revisar[2] === "usar-perfil" ? await usarPerfilDaDuplicata(db, revisar[1], ator)
      : await descartarRevisao(db, revisar[1], ator);
    return r.ok ? json(r) : json({ erro: r.erro }, r.status);
  }
  return null;
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
  const clientId = await rdCredentialConfiguracao(env, "client_id");
  const redirectUri = await rdCredentialConfiguracao(env, "redirect_uri") || `${(env.PUBLIC_APP_URL || "").replace(/\/$/, "")}/api/integrations/rd-station/oauth/callback`;
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

  // O state é assinado e curto. Para sessão humana, revalidamos o colaborador;
  // para o Dev Console, o próprio adminId sintético já foi emitido após M2M válido.
  const ehDev = adminId.startsWith("dev-console:");
  const colaborador = ehDev ? null : await buscarColaboradorAdminAtivo(adminId, env).catch(() => null);
  if (!ehDev && (!colaborador || !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS))) {
    return json({ erro: "Sem permissão para concluir a autorização do RD Station." }, 403);
  }
  const ator = ehDev ? adminId : colaborador!.id;

  const redirectUri = await rdCredentialConfiguracao(env, "redirect_uri") || `${(env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "")}/api/integrations/rd-station/oauth/callback`;
  try {
    const token = await tokenRequest(env, { code, redirect_uri: redirectUri, grant_type: "authorization_code" });
    await persistirTokens(env, ator, token);
    const db = createServiceSupabaseClient(env);
    await db.from("logs_alteracoes").insert({ usuario: ator, acao: "autorizou_oauth_rd_station", entidade: "integracoes", entidade_id: "rd_station", detalhes: { somenteLeitura: true, origem: ehDev ? "dev_console" : "admin" } });
    if (ehDev) return new Response("<!doctype html><meta charset='utf-8'><title>RD Station conectado</title><body style='font-family:system-ui;padding:32px'><h2>RD Station autorizado</h2><p>As credenciais OAuth foram salvas. Volte ao Dev Console e clique em Validar e ativar.</p><script>setTimeout(()=>window.close(),1800)</script></body>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const destino = `${(env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "")}/admin/integracoes?rd=conectado`;
    return Response.redirect(destino, 302);
  } catch (error) {
    console.error("Falha ao concluir OAuth do RD Station:", error);
    return json({ erro: "Não foi possível concluir a autorização OAuth do RD Station." }, 502);
  }
}

export async function rdStationReadonlyApi(request: Request, env: Env, ctx?: BackgroundContext): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/integrations/rd-station/webhook" && request.method === "POST") return handleWebhook(request, env, ctx);
  if (path === "/api/integrations/rd-station/oauth/callback" && request.method === "GET") return oauthCallback(request, env);
  if (!path.startsWith("/api/admin/integrations/rd-station/")) return null;
  const adminId = await requireAdminComPermissao(request, env);
  if (!adminId) return json({ erro: "Sem permissão para gerenciar a integração RD Station." }, 403);
  if (path.endsWith("/authorize-url") && request.method === "GET") return authorizationUrl(env, adminId);
  if (path.endsWith("/webhooks/configurar") && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
    try { return json(await garantirWebhooksRd(env, `admin:${adminId}`)); }
    catch { return json({ erro: "Não foi possível configurar os webhooks do RD Station agora." }, 502); }
  }
  if ((path.endsWith("/sync") || path.endsWith("/importar")) && request.method === "POST") return sincronizar(request, env, adminId, ctx);
  const crm = await rotasCrm(request, env, adminId, path);
  if (crm) return crm;
  if (path.endsWith("/test") && request.method === "POST") return testar(env, adminId);
  return json({ erro: "Rota RD Station não encontrada." }, 404);
}
