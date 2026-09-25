import http from "k6/http";
import { check, sleep } from "k6";
import encoding from "k6/encoding";
import crypto from "k6/crypto";
import { Rate, Counter, Trend } from "k6/metrics";

const BASE = (__ENV.TARGET_BASE || "").replace(/\/$/, "");
const SHARE = __ENV.VERCEL_SHARE || "";
const SHARD = Number(__ENV.SHARD || "0");
const PROFILE = __ENV.PROFILE || (__ENV.SMOKE === "1" ? "smoke" : "full");
const SMOKE = PROFILE === "smoke";
const STAIR_TARGET = /^stair_(1500|2000|3000|5000|7500|10000)$/.test(PROFILE) ? Number(PROFILE.slice(6)) / 10 : 0;
const START_EPOCH = Number(__ENV.START_EPOCH || "0");
// Deployment imutável da branch; o cookie de share é vinculado a esta URL.
const ISOLATED_PREVIEW = "https://sra-luck-react-7yd7ly95q-guidoka7.vercel.app";

const SUPABASE_URL = "https://xqlxzdmleekbrietejoq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxbHh6ZG1sZWVrYnJpZXRlam9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyODg1NzIsImV4cCI6MjEwNTg2NDU3Mn0.8xeWOMtFhdivO3NJTpCsUtwbvr74t56LmghYVLK1YFk";
const SESSION_SECRET = __ENV.LOADTEST_SESSION_SECRET || "";

const server5xx = new Rate("server_5xx");
const routeFail = new Rate("route_fail");
const appRequests = new Counter("app_requests");
const client4xx = new Counter("client_4xx");
const timeouts = new Counter("request_timeouts");
const protectionChallenges = new Counter("protection_challenges");
let lastWitnessBucket = -1;

function bucket() {
  return START_EPOCH ? Math.max(0, Math.floor((Date.now() / 1000 - START_EPOCH) / 60)) : 0;
}

const ROUTE_NAMES = [
  "client_page_agenda",
  "client_session",
  "client_agenda",
  "client_boletos",
  "client_notificacoes",
  "client_config",
  "client_home_campanhas",
  "client_notificacoes_ler_todas",
  "admin_page_clientes",
  "admin_session",
  "admin_visao_geral",
  "admin_central_visao_geral",
  "admin_clientes",
  "admin_clientes_pagina",
  "admin_clientes_totais",
  "admin_financeiro_clientes",
  "admin_financeiro_resumo",
  "admin_financeiro_recebiveis",
  "admin_financeiro_validacoes",
  "admin_agenda_mensal",
  "admin_clientes_agendamentos",
  "admin_previsao_liberacoes",
  "admin_cirurgias_confirmadas",
  "admin_configuracoes",
  "admin_notificacoes",
  "admin_agendamentos_termos",
  "admin_solicitacoes_liberacao",
  "admin_relatorios_catalogo",
  "admin_integrations_status",
  "admin_monitoramento_app",
  "admin_staff",
  "admin_cliente_boletos",
  "admin_central_cliente",
  "admin_cliente_patch",
];

// Séries com nomes próprios aparecem no handleSummary mesmo sem thresholds por
// tag. Guardamos apenas 35 minutos e não precisamos do dump bruto de milhões de requests.
const minutes = Array.from({ length: 35 }, (_, minute) => ({
  requests: new Counter(`minute_${minute}_requests`),
  failures: new Counter(`minute_${minute}_failures`),
  server5xx: new Counter(`minute_${minute}_server5xx`),
  client4xx: new Counter(`minute_${minute}_client4xx`),
  timeouts: new Counter(`minute_${minute}_timeouts`),
  protection: new Counter(`minute_${minute}_protection`),
  witnessedVus: new Counter(`minute_${minute}_witnessedVus`),
  duration: new Trend(`minute_${minute}_duration`, true),
  dbCalls: new Trend(`minute_${minute}_dbCalls`),
  dbTime: new Trend(`minute_${minute}_dbTime`, true),
}));
const routeDurations = Object.fromEntries(ROUTE_NAMES.map((route) => [route, new Trend(`route_duration_${route}`, true)]));
const routeDbCalls = Object.fromEntries(ROUTE_NAMES.map((route) => [route, new Trend(`route_db_calls_${route}`)]));
const routeDbTime = Object.fromEntries(ROUTE_NAMES.map((route) => [route, new Trend(`route_db_time_${route}`, true)]));
const routePayloadBytes = Object.fromEntries(ROUTE_NAMES.map((route) => [route, new Trend(`route_payload_bytes_${route}`)]));

const routeThresholds = {};
for (const route of ROUTE_NAMES) {
  routeThresholds[`route_fail{route:${route}}`] = ["rate<0.25"];
}

export const options = SMOKE
  ? {
      vus: 1,
      iterations: 1,
      discardResponseBodies: true,
      thresholds: {
        checks: ["rate>0.99"],
        route_fail: ["rate<0.01"],
        server_5xx: ["rate<0.01"],
      },
    }
  : {
      stages: PROFILE === "progressive" ? [
        { duration: "30s", target: 25 },
        { duration: "2m", target: 25 },
        { duration: "30s", target: 50 },
        { duration: "2m", target: 50 },
        { duration: "30s", target: 100 },
        { duration: "2m", target: 100 },
        { duration: "30s", target: 0 },
      ] : STAIR_TARGET ? [
        { duration: "90s", target: STAIR_TARGET },
        { duration: "3m", target: STAIR_TARGET },
        { duration: "30s", target: 0 },
      ] : [
        { duration: "2m", target: 1000 },
        { duration: "30m", target: 1000 },
        { duration: "1m", target: 0 },
      ],
      discardResponseBodies: true,
      summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
      thresholds: {
        checks: ["rate>0.99"],
        http_req_failed: ["rate<0.01"],
        "http_req_duration": ["p(95)<2000", "p(99)<5000"],
        server_5xx: ["rate<0.001"],
        ...routeThresholds,
      },
    };

function b64url(value) {
  return encoding
    .b64encode(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signedToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const signature = crypto
    .hmac("sha256", SESSION_SECRET, body, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${body}.${signature}`;
}

export function setup() {
  if (!BASE) throw new Error("TARGET_BASE é obrigatório.");
  if (!SHARE || !SESSION_SECRET) throw new Error("Hard-stop: segredos isolados do Preview e da sessão de teste ausentes.");
  if (BASE !== ISOLATED_PREVIEW || (!["smoke", "progressive", "full"].includes(PROFILE) && !STAIR_TARGET) || SHARD < 0 || SHARD > 9) {
    throw new Error("Hard-stop: alvo, perfil ou shard fora do ambiente isolado aprovado.");
  }
  // Este é o único hard-stop do cenário: nunca gerar carga contra outro deployment.
  http.get(`${BASE}/?_vercel_share=${encodeURIComponent(SHARE)}`, {
    tags: { name: "isolated_share_setup" },
  });
  const identity = http.get(`${BASE}/api/loadtest/identity`, {
    responseType: "text", tags: { name: "isolated_identity" },
  });
  let marker = null;
  try { marker = JSON.parse(identity.body || "null"); } catch { /* identificação inválida */ }
  if (identity.status !== 200 || marker?.projectRef !== "xqlxzdmleekbrietejoq" || marker?.isolated !== true || marker?.externalIntegrationsDisabled !== true) {
    throw new Error(`Hard-stop: Preview não confirmou o Supabase isolado (HTTP ${identity.status}, tipo ${identity.headers["Content-Type"] || "desconhecido"}).`);
  }
  const previewCookies = http.cookieJar().cookiesForURL(BASE);
  if (!Object.keys(previewCookies).length) throw new Error("Hard-stop: Preview não forneceu cookie para os VUs.");

  const first = 80000000001 + SHARD * 1000;
  const last = first + 999;
  const url =
    `${SUPABASE_URL}/rest/v1/clientes?select=id,cpf&cpf=gte.${first}&cpf=lte.${last}&order=cpf.asc&limit=1000`;

  const response = http.get(url, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      Accept: "application/json",
    },
    responseType: "text",
    tags: { name: "setup_clients" },
  });

  if (response.status !== 200) {
    throw new Error(`Falha ao carregar clientes do shard ${SHARD}: HTTP ${response.status}`);
  }

  const clients = JSON.parse(response.body || "[]");
  if (!Array.isArray(clients) || clients.length !== 1000) {
    throw new Error(`Shard ${SHARD}: esperado 1000 clientes, recebido ${clients?.length ?? 0}`);
  }

  return { clients, previewCookies, startedAt: new Date().toISOString() };
}

let cachedClientCookie = "";
let cachedAdminCookie = "";

function ensurePreviewAccess(previewCookies) {
  // O k6 limpa o jar de cookies entre iterações. Reaplicar o cookie obtido e
  // validado no setup evita 10.000 negociações SSO durante a rampa.
  for (const [name, values] of Object.entries(previewCookies)) {
    if (values[0]) http.cookieJar().set(BASE, name, values[0]);
  }
}

function call(method, path, cookie, name, body = null) {
  if (cookie) {
    const eq = cookie.indexOf("=");
    if (eq > 0) {
      const name = cookie.slice(0, eq);
      const value = cookie.slice(eq + 1);
      http.cookieJar().set(BASE, name, value);
    }
  }

  const headers = {
    Accept: "application/json",
    "Cache-Control": "no-cache",
  };
  if (method !== "GET" && method !== "HEAD") {
    headers.Origin = BASE;
    headers["Content-Type"] = "application/json";
  }

  // ensurePreviewAccess já estabeleceu o cookie de share deste VU.
  // Repetir o query token a cada API inflava o tráfego com redirecionamentos.
  const requestUrl = `${BASE}${path}`;
  const metricTags = { route: name };
  const minute = minutes[Math.min(34, bucket())];

  const res = http.request(method, requestUrl, body, {
    headers,
    tags: { name },
    redirects: 5,
    responseType: SMOKE ? "text" : "none",
    timeout: "40s",
  });

  if (SMOKE) {
    const snippet = res.status >= 400 ? String(res.body || "").replace(/\s+/g, " ").slice(0, 300) : "";
    const encoded = typeof res.body === "string" ? encoding.b64encode(res.body) : "";
    const measuredBytes = encoded.length * 3 / 4 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
    console.log(`[SMOKE] ${name} HTTP ${res.status} db=${res.headers["X-Loadtest-Db-Calls"] ?? "?"} rpc=${res.headers["X-Loadtest-Rpc-Calls"] ?? "?"} dbMs=${res.headers["Server-Timing"] ?? "?"} payload=${measuredBytes}B total=${Math.round(res.timings.duration)}ms${snippet ? ` :: ${snippet}` : ""}`);
  }

  const unexpectedHtml = path.startsWith("/api/") && res.status >= 200 && res.status < 400
    && !String(res.headers["Content-Type"] || "").toLowerCase().includes("application/json");
  const failed = !(res.status >= 200 && res.status < 400) || unexpectedHtml;
  routeFail.add(failed, metricTags);
  server5xx.add(res.status >= 500, metricTags);
  appRequests.add(1, metricTags);
  minute.requests.add(1);
  minute.duration.add(res.timings.duration);
  routeDurations[name].add(res.timings.duration);
  const dbCalls = res.headers["X-Loadtest-Db-Calls"] ?? res.headers["X-Loadtest-DB-Calls"];
  if (dbCalls !== undefined && Number.isFinite(Number(dbCalls))) {
    routeDbCalls[name].add(Number(dbCalls));
    minute.dbCalls.add(Number(dbCalls));
  }
  const timings = res.headers["Server-Timing"] || "";
  const dbTime = timings.match(/(?:^|,)\s*db;dur=([\d.]+)/);
  if (dbTime) { routeDbTime[name].add(Number(dbTime[1])); minute.dbTime.add(Number(dbTime[1])); }
  if (SMOKE && typeof res.body === "string") {
    const encoded = encoding.b64encode(res.body);
    routePayloadBytes[name].add(encoded.length * 3 / 4 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0));
  }
  if (failed) minute.failures.add(1);
  if (res.status >= 500) minute.server5xx.add(1);
  if (res.status >= 400 && res.status < 500) client4xx.add(1, metricTags);
  if (res.status >= 400 && res.status < 500) minute.client4xx.add(1);
  if (res.status === 0) timeouts.add(1, metricTags);
  if (res.status === 0) minute.timeouts.add(1);
  if (unexpectedHtml) {
    protectionChallenges.add(1, metricTags);
    minute.protection.add(1);
  }
  check(res, { [`${name} resposta válida`]: () => !failed });
  return res;
}

function cookiesFor(clientId) {
  if (!cachedClientCookie) {
    cachedClientCookie = `cliente_session=${signedToken({ clienteId: clientId, iat: Date.now() })}`;
  }
  if (!cachedAdminCookie) {
    cachedAdminCookie = `admin_session=${signedToken({ adminId: "00000000-0000-4000-8000-000000000001", iat: Date.now() })}`;
  }
  return { client: cachedClientCookie, admin: cachedAdminCookie };
}

function clientRead(cookie) {
  const pick = (__ITER + __VU) % 7;
  if (pick === 0) return call("GET", "/agenda", cookie, "client_page_agenda");
  if (pick === 1) return call("GET", "/api/cliente/session", cookie, "client_session");
  if (pick === 2) return call("GET", "/api/cliente/agenda", cookie, "client_agenda");
  if (pick === 3) return call("GET", "/api/cliente/boletos", cookie, "client_boletos");
  if (pick === 4) return call("GET", "/api/cliente/notificacoes", cookie, "client_notificacoes");
  if (pick === 5) return call("GET", "/api/cliente/config", cookie, "client_config");
  return call("GET", "/api/cliente/home-campanhas", cookie, "client_home_campanhas");
}

function clientWrite(cookie) {
  if (__ITER % 4 === 0) {
    return call("POST", "/api/cliente/notificacoes/ler-todas", cookie, "client_notificacoes_ler_todas", "{}");
  }
  return (__ITER % 2 === 0)
    ? call("GET", "/api/cliente/boletos", cookie, "client_boletos")
    : call("GET", "/api/cliente/agenda", cookie, "client_agenda");
}

const ADMIN_READS = [
  ["/admin/clientes", "admin_page_clientes"],
  ["/api/admin/session", "admin_session"],
  ["/api/admin/visao-geral", "admin_visao_geral"],
  ["/api/admin/central/visao-geral", "admin_central_visao_geral"],
  ["/api/admin/clientes/pagina?limite=50", "admin_clientes_pagina"],
  ["/api/admin/financeiro/clientes", "admin_financeiro_clientes"],
  ["/api/admin/financeiro/resumo?inicio=2026-01-01&fim=2026-12-31", "admin_financeiro_resumo"],
  ["/api/admin/financeiro/recebiveis?inicio=2026-01-01&fim=2026-12-31&pagina=1&limite=50", "admin_financeiro_recebiveis"],
  ["/api/admin/financeiro/validacoes", "admin_financeiro_validacoes"],
  ["/api/admin/agenda-mensal?ano=2026", "admin_agenda_mensal"],
  ["/api/admin/clientes-agendamentos", "admin_clientes_agendamentos"],
  ["/api/admin/previsao-liberacoes", "admin_previsao_liberacoes"],
  ["/api/admin/cirurgias-confirmadas", "admin_cirurgias_confirmadas"],
  ["/api/admin/configuracoes", "admin_configuracoes"],
  ["/api/admin/notificacoes/automacao", "admin_notificacoes"],
  ["/api/admin/agendamentos-termos", "admin_agendamentos_termos"],
  ["/api/admin/solicitacoes-liberacao-financeira", "admin_solicitacoes_liberacao"],
  ["/api/admin/relatorios/catalogo", "admin_relatorios_catalogo"],
  ["/api/admin/integrations/status", "admin_integrations_status"],
  ["/api/admin/staff", "admin_staff"],
];

function adminRead(cookie) {
  // Misture os shards: na escada curta os mesmos VUs administrativos existem
  // em cada shard, e o índice sem SHARD exercitava só uma rota de cada vez.
  const [path, name] = ADMIN_READS[(__ITER + __VU + SHARD * 7) % ADMIN_READS.length];
  return call("GET", path, cookie, name);
}

function adminWrite(cookie, clientId) {
  const pick = __ITER % 3;
  if (pick === 0) {
    return call(
      "PATCH",
      `/api/admin/clientes/${encodeURIComponent(clientId)}`,
      cookie,
      "admin_cliente_patch",
      JSON.stringify({ observacoes: `LOAD_TEST shard=${SHARD} vu=${__VU}` }),
    );
  }
  if (pick === 1) {
    return call(
      "GET",
      `/api/admin/clientes/${encodeURIComponent(clientId)}/boletos`,
      cookie,
      "admin_cliente_boletos",
    );
  }
  return call(
    "GET",
    `/api/admin/central/cliente/${encodeURIComponent(clientId)}`,
    cookie,
    "admin_central_cliente",
  );
}

function smoke(data) {
  const client = data.clients[0];
  const cookies = cookiesFor(client.id);
  const calls = [
    () => call("GET", "/api/cliente/session", cookies.client, "client_session"),
    () => call("GET", "/api/cliente/agenda", cookies.client, "client_agenda"),
    () => call("GET", "/api/cliente/boletos", cookies.client, "client_boletos"),
    () => call("GET", "/api/cliente/notificacoes", cookies.client, "client_notificacoes"),
    () => call("GET", "/api/cliente/config", cookies.client, "client_config"),
    () => call("GET", "/api/cliente/home-campanhas", cookies.client, "client_home_campanhas"),
    () => call("GET", "/api/admin/session", cookies.admin, "admin_session"),
    () => call("GET", "/api/admin/notificacoes/automacao", cookies.admin, "admin_notificacoes"),
    () => call("GET", "/api/admin/visao-geral", cookies.admin, "admin_visao_geral"),
    () => call("GET", "/api/admin/clientes/pagina?limite=50", cookies.admin, "admin_clientes_pagina"),
    () => call("GET", "/api/admin/clientes/totais", cookies.admin, "admin_clientes_totais"),
    () => call("GET", "/api/admin/financeiro/resumo?inicio=2026-01-01&fim=2026-12-31", cookies.admin, "admin_financeiro_resumo"),
    () => call("GET", "/api/admin/financeiro/clientes", cookies.admin, "admin_financeiro_clientes"),
    () => call("GET", "/api/admin/financeiro/recebiveis?inicio=2026-01-01&fim=2026-12-31&pagina=1&limite=50", cookies.admin, "admin_financeiro_recebiveis"),
    () => call("GET", `/api/admin/clientes/${client.id}/boletos`, cookies.admin, "admin_cliente_boletos"),
    () => call("GET", `/api/admin/central/cliente/${client.id}`, cookies.admin, "admin_central_cliente"),
  ];
  const covered = new Set(["admin_session", "admin_notificacoes", "admin_visao_geral", "admin_clientes_pagina",
    "admin_financeiro_resumo", "admin_financeiro_clientes", "admin_financeiro_recebiveis"]);
  for (const [path, name] of ADMIN_READS) {
    if (!covered.has(name)) calls.push(() => call("GET", path, cookies.admin, name));
  }
  for (const fn of calls) fn();
}

export default function (data) {
  ensurePreviewAccess(data.previewCookies);

  if (SMOKE) {
    smoke(data);
    return;
  }

  const client = data.clients[(__VU - 1) % data.clients.length];
  const cookies = cookiesFor(client.id);

  if (START_EPOCH) {
    const b = bucket();
    if (b < 35 && b !== lastWitnessBucket) {
      minutes[b].witnessedVus.add(1);
      lastWitnessBucket = b;
    }
  }

  // Por shard: 960 clientes leitura, 20 clientes escrita, 18 admins leitura, 2 admins escrita.
  // 10 shards = 10.000 VUs simultâneos, sendo 9.800 clientes e 200 acessos administrativos.
  // Deslocar o papel por shard distribui os VUs de escrita da cliente e de
  // Admin, inclusive em etapas abaixo de 500 VUs.
  const slot = (__VU - 1 + SHARD * 17) % 50;
  if (slot < 48) clientRead(cookies.client);
  else if (slot === 48) clientWrite(cookies.client);
  else if ((Math.floor((__VU - 1 + SHARD * 17) / 50) % 10) !== 0) adminRead(cookies.admin);
  else adminWrite(cookies.admin, client.id);

  sleep(8 + ((__VU + __ITER) % 9));
}

export function handleSummary(data) {
  const path = `loadtest/results/shard-${SHARD}.json`;
  const summary = {
    shard: SHARD,
    profile: PROFILE,
    startedAt: Number.isFinite(data.state?.testRunDurationMs)
      ? new Date(Date.now() - data.state.testRunDurationMs).toISOString()
      : null,
    durationMs: data.state?.testRunDurationMs ?? null,
    generatedAt: new Date().toISOString(),
    metrics: data.metrics,
    rootGroup: data.root_group,
    options: { smoke: SMOKE, profile: PROFILE },
  };
  return {
    [path]: JSON.stringify(summary, null, 2),
    stdout: `Shard ${SHARD}: summary gravado em ${path}\n`,
  };
}
