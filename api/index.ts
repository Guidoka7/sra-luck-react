import worker from "../worker/index";
import type { Env } from "../worker/supabase";
import { authorizeDevConsoleRequest } from "../worker/dev-console-auth";


const LOADTEST_BRANCH = "load-test-10k-isolated";

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function isolatedDeployment() {
  return firstEnv("VERCEL_GIT_COMMIT_REF") === LOADTEST_BRANCH
    || firstEnv("LOAD_TEST_TELEMETRY") === "1";
}

function canonicalProductionOrigin(request: Request): string {
  return new URL(request.url).origin;
}

function buildEnv(request: Request): Env {
  // Esta branch nunca reutiliza credenciais de produção. O Preview isolado só
  // funciona quando as três variáveis LOADTEST_* estão configuradas na Vercel.
  return {
    LOAD_TEST_TELEMETRY: "1",
    SUPABASE_URL: firstEnv("LOADTEST_SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: firstEnv("LOADTEST_SUPABASE_SERVICE_ROLE_KEY"),
    CLIENTE_SESSION_SECRET: firstEnv("LOADTEST_SESSION_SECRET"),
    PUBLIC_APP_URL: new URL(request.url).origin,

    // Integrações externas permanecem deliberadamente desligadas no ensaio.
    NOTIFICACOES_CRON_SECRET: undefined,
    DEV_CONSOLE_SERVICE_TOKEN: undefined,
    WEB_PUSH_VAPID_PUBLIC_KEY: undefined,
    WEB_PUSH_VAPID_PRIVATE_KEY: undefined,
    WEB_PUSH_VAPID_SUBJECT: undefined,
    RD_WEBHOOK_SECRET: undefined,
    RD_API_ACCESS_TOKEN: undefined,
    RD_CLIENT_ID: undefined,
    RD_CLIENT_SECRET: undefined,
    RD_REDIRECT_URI: undefined,
    RD_ACCESS_TOKEN: undefined,
    RD_REFRESH_TOKEN: undefined,
    RD_TOKEN_EXPIRES_AT: undefined,
    CONTA_AZUL_CLIENT_ID: undefined,
    CONTA_AZUL_CLIENT_SECRET: undefined,
    CONTA_AZUL_ACCESS_TOKEN: undefined,
    CONTA_AZUL_REFRESH_TOKEN: undefined,
    CONTA_AZUL_REDIRECT_URI: undefined,
    MERCADO_PAGO_ACCESS_TOKEN: undefined,
    MERCADO_PAGO_WEBHOOK_SECRET: undefined,
    BRB_WEBHOOK_SECRET: undefined,
    BB_WEBHOOK_SECRET: undefined,
    SANTANDER_WEBHOOK_SECRET: undefined,
    SICREDI_WEBHOOK_SECRET: undefined,
    EFI_WEBHOOK_SECRET: undefined,
    GEMINI_API_KEY: undefined,
    GEMINI_MODEL: undefined,
    GEMINI_PROMPT: undefined,
    CRON_SECRET: undefined,
  };
}

function missingIsolatedConfig(env: Env) {
  return !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.CLIENTE_SESSION_SECRET;
}

async function handleRequest(request: Request, context?: { waitUntil?: (p: Promise<unknown>) => void }) {
  const url = new URL(request.url);

  // Hard-stop: este adaptador pertence exclusivamente à branch isolada.
  if (!isolatedDeployment()) {
    return Response.json({ erro: "Adaptador isolado fora do ambiente permitido." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const env = buildEnv(request);

  // O k6 comprova o destino antes de enviar tráfego. O marker não expõe chaves.
  if (request.method === "GET" && url.pathname === "/api/loadtest/identity") {
    return Response.json({
      isolated: true,
      projectRef: "xqlxzdmleekbrietejoq",
      externalIntegrationsDisabled: true,
      configured: !missingIsolatedConfig(env),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  if (missingIsolatedConfig(env)) {
    return Response.json({ erro: "Ambiente isolado não configurado." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (request.method === "GET" && url.pathname === "/api/pwa/origin") {
    return Response.json(
      { origin: canonicalProductionOrigin(request) },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }

  // Vercel sobrescreve X-Forwarded-For. Não confiar em IPs Cloudflare
  // fornecidos pelo cliente neste adaptador.
  const headers = new Headers(request.headers);
  headers.delete("cf-connecting-ip");
  headers.delete("x-real-ip");
  const trustedRequest = new Request(request, { headers });

  const authorizedRequest = await authorizeDevConsoleRequest(trustedRequest, env);
  if (authorizedRequest instanceof Response) return authorizedRequest;

  // O contexto waitUntil ainda é suportado pela Vercel para Web Handlers
  // (embora a API recomende @vercel/functions para código novo).
  return worker.fetch(authorizedRequest, env, context);
}

// Node.js Web Handler: evita o limite de 1 MB das antigas Edge Functions.
export default { fetch: handleRequest };
