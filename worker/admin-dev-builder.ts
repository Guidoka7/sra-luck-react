import { buscarColaboradorAdminAtivo } from "./admin-auth";
import { getCookie, verificarTokenAdmin } from "./session";
import { requestLogger } from "./logger";
import type { Env } from "./supabase";
import { assertPublishableBuilderDocument } from "../src/features/dev-builder/validation";
import { stableBuilderJson } from "../src/features/dev-builder/serialization";

interface DevBuilderEnv extends Env {
  DEV_BUILDER_GITHUB_TOKEN?: string;
  DEV_BUILDER_REPOSITORY?: string;
  DEV_BUILDER_CONFIG_PATH?: string;
}

const DEFAULT_REPOSITORY = "Guidoka7/sra-luck-react";
const DEFAULT_BRANCH = "develop";
const DEFAULT_CONFIG_PATH = "src/features/dev-builder/generated/builder-config.json";
const MAX_BODY_BYTES = 350_000;

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

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "sra-luck-dev-builder",
    "Content-Type": "application/json",
  };
}

async function requireDeveloperAdmin(request: Request, env: Env): Promise<Response | null> {
  if (!env.CLIENTE_SESSION_SECRET) return json({ error: "Sessão administrativa indisponível." }, 503);
  const session = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!session) return json({ error: "Sessão administrativa expirada." }, 401);
  try {
    const collaborator = await buscarColaboradorAdminAtivo(session.adminId, env);
    if (!collaborator || collaborator.cargo !== "administrativo") {
      return json({ error: "Publicação do Builder restrita ao perfil administrativo." }, 403);
    }
    return null;
  } catch (error) {
    requestLogger(request).error("Falha ao validar permissão do DEV Builder", { action: "dev-builder.authorization", eventCode: "DEV_BUILDER_AUTH_FAILED", error });
    return json({ error: "Não foi possível validar a autorização agora." }, 503);
  }
}

async function getCurrentContentSha(repository: string, path: string, token: string) {
  const endpoint = `https://api.github.com/repos/${repository}/contents/${path}?ref=${DEFAULT_BRANCH}`;
  const response = await fetch(endpoint, { headers: githubHeaders(token) });
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub GET ${response.status}: ${body.slice(0, 240)}`);
  }
  const data = await response.json() as { sha?: string };
  return data.sha ?? null;
}

async function publishToGithub(repository: string, path: string, token: string, content: string, currentSha: string | null, documentId: string) {
  const endpoint = `https://api.github.com/repos/${repository}/contents/${path}`;
  const body: Record<string, unknown> = {
    message: `chore(builder): publicar layout ${documentId}`,
    content: encodeBase64Utf8(content),
    branch: DEFAULT_BRANCH,
  };
  if (currentSha) body.sha = currentSha;
  const response = await fetch(endpoint, { method: "PUT", headers: githubHeaders(token), body: JSON.stringify(body) });
  const data = await response.json() as {
    commit?: { sha?: string; html_url?: string };
    content?: { sha?: string };
    message?: string;
  };
  if (!response.ok) throw new Error(`GitHub PUT ${response.status}: ${data.message ?? "falha ao criar commit"}`);
  return data;
}

export async function adminDevBuilder(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/admin/dev-builder")) return null;
  const builderEnv = env as DevBuilderEnv;
  const repository = builderEnv.DEV_BUILDER_REPOSITORY?.trim() || DEFAULT_REPOSITORY;
  const configPath = builderEnv.DEV_BUILDER_CONFIG_PATH?.trim() || DEFAULT_CONFIG_PATH;
  const configured = Boolean(builderEnv.DEV_BUILDER_GITHUB_TOKEN);

  if (url.pathname !== "/api/admin/dev-builder/status" && url.pathname !== "/api/admin/dev-builder/publish") return null;
  const denied = await requireDeveloperAdmin(request, env);
  if (denied) return denied;

  if (url.pathname === "/api/admin/dev-builder/status" && request.method === "GET") {
    return json({
      configured,
      repository,
      branch: DEFAULT_BRANCH,
      configPath,
      reason: configured ? undefined : "Configure DEV_BUILDER_GITHUB_TOKEN no Worker.",
    });
  }

  if (url.pathname !== "/api/admin/dev-builder/publish" || request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!sameOrigin(request)) return json({ error: "Requisição de origem não autorizada." }, 403);
  if (!configured) return json({ error: "Sincronização Git do DEV Builder não está configurada." }, 503);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return json({ error: "Repositório do DEV Builder inválido." }, 503);
  if (configPath !== DEFAULT_CONFIG_PATH) return json({ error: "Caminho de publicação do Builder não autorizado." }, 503);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "Configuração excede o limite permitido." }, 413);

  let body: { document?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Payload inválido." }, 400); }
  const validation = assertPublishableBuilderDocument(body.document);
  const blocking = validation.issues.filter((issue) => issue.level === "error");
  if (!validation.document || blocking.length) return json({ error: "Configuração inválida.", issues: blocking }, 422);

  const serialized = stableBuilderJson({ ...validation.document, updatedAt: new Date().toISOString() });
  if (new TextEncoder().encode(serialized).byteLength > MAX_BODY_BYTES) return json({ error: "Configuração serializada excede o limite permitido." }, 413);

  const log = requestLogger(request).child({ action: "dev-builder.publish", actorType: "admin" });
  try {
    const token = builderEnv.DEV_BUILDER_GITHUB_TOKEN!;
    const currentSha = await getCurrentContentSha(repository, configPath, token);
    const result = await publishToGithub(repository, configPath, token, serialized, currentSha, validation.document.id);
    log.info("Configuração visual publicada no GitHub", {
      eventCode: "DEV_BUILDER_PUBLISHED",
      metadata: { repository, branch: DEFAULT_BRANCH, configPath, documentId: validation.document.id, commitSha: result.commit?.sha?.slice(0, 12) },
    });
    return json({
      ok: true,
      commitSha: result.commit?.sha,
      commitUrl: result.commit?.html_url,
      contentSha: result.content?.sha,
      branch: DEFAULT_BRANCH,
      configPath,
    });
  } catch (error) {
    log.error("Falha ao publicar configuração visual no GitHub", { eventCode: "DEV_BUILDER_GITHUB_PUBLISH_FAILED", error });
    return json({ error: "Não foi possível criar o commit do Builder no GitHub." }, 502);
  }
}
