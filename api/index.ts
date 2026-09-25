import worker from "../worker/index";
import type { Env } from "../worker/supabase";
import { authorizeDevConsoleRequest } from "../worker/dev-console-auth";

export const config = { runtime: "edge" };

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function canonicalProductionOrigin(request: Request): string {
  return new URL(request.url).origin;
}

function buildEnv(request: Request): Env {
  return {
    // Ambiente EXCLUSIVO do teste de carga. Nunca aponta para produção.
    SUPABASE_URL: "https://xqlxzdmleekbrietejoq.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxbHh6ZG1sZWVrYnJpZXRlam9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyODg1NzIsImV4cCI6MjEwNTg2NDU3Mn0.8xeWOMtFhdivO3NJTpCsUtwbvr74t56LmghYVLK1YFk",
    CLIENTE_SESSION_SECRET: "sra-luck-load-test-only-session-secret-2026-09-24",
    PUBLIC_APP_URL: new URL(request.url).origin,

    // Todas as integrações externas ficam deliberadamente desligadas no teste.
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

export default async function handler(request: Request, context?: { waitUntil?: (p: Promise<unknown>) => void }) {
  const url = new URL(request.url);

  // Branch de carga isolada: o k6 deve comprovar o destino antes de enviar tráfego.
  if (request.method === "GET" && url.pathname === "/api/loadtest/identity") {
    return Response.json({ isolated: true, projectRef: "xqlxzdmleekbrietejoq", externalIntegrationsDisabled: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (request.method === "GET" && url.pathname === "/api/pwa/origin") {
    return Response.json(
      { origin: canonicalProductionOrigin(request) },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  }

  // This adapter runs only on Vercel, which overwrites X-Forwarded-For.
  // Do not trust a client-supplied Cloudflare header on this deployment.
  const headers = new Headers(request.headers);
  headers.delete("cf-connecting-ip");
  headers.delete("x-real-ip");
  const trustedRequest = new Request(request, { headers });
  const env = buildEnv(trustedRequest);

  // O Dev Console nunca recebe um cookie administrativo real do Sra. Luck.
  // O adapter valida o segredo M2M e cria uma sessão técnica efêmera apenas
  // para consultas explicitamente permitidas; o header secreto é removido
  // antes de entregar a requisição ao Worker.
  const authorizedRequest = await authorizeDevConsoleRequest(trustedRequest, env);
  if (authorizedRequest instanceof Response) return authorizedRequest;

  return worker.fetch(authorizedRequest, env, context);
}
