import http from "k6/http";
import { check, sleep } from "k6";
import encoding from "k6/encoding";
import crypto from "k6/crypto";
import { Rate, Counter } from "k6/metrics";

const BASE = (__ENV.TARGET_BASE || "").replace(/\/$/, "");
const SHARE = __ENV.VERCEL_SHARE || "";
const SHARD = Number(__ENV.SHARD || "0");
const SMOKE = __ENV.SMOKE === "1";

const SUPABASE_URL = "https://xqlxzdmleekbrietejoq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxbHh6ZG1sZWVrYnJpZXRlam9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyODg1NzIsImV4cCI6MjEwNTg2NDU3Mn0.8xeWOMtFhdivO3NJTpCsUtwbvr74t56LmghYVLK1YFk";
const SESSION_SECRET = "sra-luck-load-test-only-session-secret-2026-09-24";

const server5xx = new Rate("server_5xx");
const routeFail = new Rate("route_fail");
const appRequests = new Counter("app_requests");

const ROUTE_NAMES = [
  "client_page_agenda",
  "client_session",
  "client_agenda",
  "client_boletos",
  "client_notificacoes",
  "client_journey",
  "client_config",
  "client_home_campanhas",
  "client_notificacoes_ler_todas",
  "admin_page_clientes",
  "admin_session",
  "admin_visao_geral",
  "admin_central_visao_geral",
  "admin_clientes",
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
  "admin_credit_ops_contracts",
  "admin_cliente_boletos",
  "admin_central_cliente",
  "admin_cliente_patch",
];

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
      stages: [
        { duration: "2m", target: 1000 },
        { duration: "30m", target: 1000 },
        { duration: "1m", target: 0 },
      ],
      gracefulStop: "30s",
      discardResponseBodies: true,
      thresholds: {
        checks: ["rate>0.90"],
        http_req_failed: ["rate<0.20"],
        "http_req_duration": [
          { threshold: "p(95)<5000", abortOnFail: false },
          { threshold: "p(99)<8000", abortOnFail: true, delayAbortEval: "3m" },
        ],
        server_5xx: [
          { threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "2m" },
        ],
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

  return { clients };
}

let previewReady = false;
let cachedClientCookie = "";
let cachedAdminCookie = "";

function ensurePreviewAccess() {
  if (previewReady) return;
  const url = SHARE ? `${BASE}/?_vercel_share=${SHARE}` : `${BASE}/`;
  const res = http.get(url, {
    headers: {
      "x-vercel-trusted-oidc-idp-token": __ENV.VERCEL_OIDC_TOKEN || "",
      "x-vercel-set-bypass-cookie": "true",
    },
    redirects: 10,
    tags: { name: SHARE ? "vercel_sso" : "test_host_health" },
  });
  const ok = res.status >= 200 && res.status < 400;
  check(res, { "test host access": () => ok });
  if (!ok) throw new Error(`Falha de acesso ao host isolado: HTTP ${res.status}`);
  previewReady = true;
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

  const res = http.request(method, `${BASE}${path}`, body, {
    headers,
    tags: { name },
    redirects: 5,
    responseType: SMOKE ? "text" : "none",
  });

  if (SMOKE) {
    const snippet = res.status >= 400 ? String(res.body || "").replace(/\s+/g, " ").slice(0, 300) : "";
    console.log(`[SMOKE] ${name} HTTP ${res.status}${snippet ? ` :: ${snippet}` : ""}`);
  }

  const failed = !(res.status >= 200 && res.status < 400);
  routeFail.add(failed, { route: name });
  server5xx.add(res.status >= 500, { route: name });
  appRequests.add(1, { route: name });
  check(res, { [`${name} HTTP < 400`]: (r) => r.status < 400 });
  return res;
}

function cookiesFor(clientId) {
  if (!cachedClientCookie) {
    cachedClientCookie = `cliente_session=${signedToken({ clienteId: clientId, iat: Date.now() })}`;
  }
  if (!cachedAdminCookie) {
    cachedAdminCookie = `admin_session=${signedToken({ adminId: `dev-console:loadtest-${SHARD}`, iat: Date.now() })}`;
  }
  return { client: cachedClientCookie, admin: cachedAdminCookie };
}

function clientRead(cookie) {
  const pick = (__ITER + __VU) % 8;
  if (pick === 0) return call("GET", "/agenda", cookie, "client_page_agenda");
  if (pick === 1) return call("GET", "/api/cliente/session", cookie, "client_session");
  if (pick === 2) return call("GET", "/api/cliente/agenda", cookie, "client_agenda");
  if (pick === 3) return call("GET", "/api/cliente/boletos", cookie, "client_boletos");
  if (pick === 4) return call("GET", "/api/cliente/notificacoes", cookie, "client_notificacoes");
  if (pick === 5) return call("GET", "/api/cliente/journey", cookie, "client_journey");
  if (pick === 6) return call("GET", "/api/cliente/config", cookie, "client_config");
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
  ["/api/admin/clientes", "admin_clientes"],
  ["/api/admin/financeiro/clientes", "admin_financeiro_clientes"],
  ["/api/admin/financeiro/resumo?inicio=2026-01-01&fim=2026-12-31", "admin_financeiro_resumo"],
  ["/api/admin/financeiro/recebiveis?inicio=2026-01-01&fim=2026-12-31&pagina=1&limite=50", "admin_financeiro_recebiveis"],
  ["/api/admin/financeiro/validacoes", "admin_financeiro_validacoes"],
  ["/api/admin/agenda-mensal?ano=2026", "admin_agenda_mensal"],
  ["/api/admin/clientes-agendamentos", "admin_clientes_agendamentos"],
  ["/api/admin/previsao-liberacoes", "admin_previsao_liberacoes"],
  ["/api/admin/cirurgias-confirmadas", "admin_cirurgias_confirmadas"],
  ["/api/admin/configuracoes", "admin_configuracoes"],
  ["/api/admin/notificacoes", "admin_notificacoes"],
  ["/api/admin/agendamentos-termos", "admin_agendamentos_termos"],
  ["/api/admin/solicitacoes-liberacao-financeira", "admin_solicitacoes_liberacao"],
  ["/api/admin/relatorios/catalogo", "admin_relatorios_catalogo"],
  ["/api/admin/integrations/status", "admin_integrations_status"],
  ["/api/admin/monitoramento-app", "admin_monitoramento_app"],
  ["/api/admin/staff", "admin_staff"],
  ["/api/admin/credit-ops/contracts", "admin_credit_ops_contracts"],
];

function adminRead(cookie) {
  const [path, name] = ADMIN_READS[(__ITER + __VU) % ADMIN_READS.length];
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
    () => call("GET", "/api/admin/session", cookies.admin, "admin_session"),
    () => call("GET", "/api/admin/visao-geral", cookies.admin, "admin_visao_geral"),
    () => call("GET", "/api/admin/central/visao-geral", cookies.admin, "admin_central_visao_geral"),
    () => call("GET", `/api/admin/clientes/${client.id}/boletos`, cookies.admin, "admin_cliente_boletos"),
    () => call("GET", `/api/admin/central/cliente/${client.id}`, cookies.admin, "admin_central_cliente"),
  ];
  for (const fn of calls) fn();
}

export default function (data) {
  ensurePreviewAccess();

  if (SMOKE) {
    smoke(data);
    return;
  }

  const client = data.clients[(__VU - 1) % data.clients.length];
  const cookies = cookiesFor(client.id);

  // Por shard: 960 clientes leitura, 20 clientes escrita, 18 admins leitura, 2 admins escrita.
  // 10 shards = 10.000 VUs simultâneos, sendo 9.800 clientes e 200 acessos administrativos.
  if (__VU <= 960) clientRead(cookies.client);
  else if (__VU <= 980) clientWrite(cookies.client);
  else if (__VU <= 998) adminRead(cookies.admin);
  else adminWrite(cookies.admin, client.id);

  sleep(8 + ((__VU + __ITER) % 9));
}

export function handleSummary(data) {
  const path = `loadtest/results/shard-${SHARD}.json`;
  const summary = {
    shard: SHARD,
    generatedAt: new Date().toISOString(),
    metrics: data.metrics,
    rootGroup: data.root_group,
    options: { smoke: SMOKE },
  };
  return {
    [path]: JSON.stringify(summary, null, 2),
    stdout: `Shard ${SHARD}: summary gravado em ${path}\n`,
  };
}
