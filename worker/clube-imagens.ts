/**
 * Imagens das recompensas do Clube.
 *
 * - Enviadas pelo Admin ficam no bucket privado clube-recompensas e são servidas por
 *   /api/clube/recompensas/{id}/imagem: endereço permanente (o app e o Admin usam o mesmo).
 * - Links colados são conferidos: a miniatura do Dropbox (previews.dropbox.com) expira em horas e
 *   foi o que quebrou a "Nécessaire premium" em 25/09/2026; o link de compartilhamento do Dropbox
 *   é convertido para abrir a imagem direto (raw=1).
 */
import { createServiceSupabaseClient, type Env } from "./supabase";
import { detectarTipoArquivo } from "./arquivos";

export const BUCKET_RECOMPENSAS = "clube-recompensas";
export const TAMANHO_MAXIMO_IMAGEM = 5 * 1024 * 1024;

export function urlImagemRecompensa(id: string, versao: string) {
  return `/api/clube/recompensas/${encodeURIComponent(id)}/imagem?v=${encodeURIComponent(versao)}`;
}

/** Confere e normaliza o link de imagem colado no Admin. */
export function normalizarUrlImagem(bruta: string): { ok: true; url: string } | { ok: false; erro: string } {
  // Imagem enviada pelo próprio Admin (rota interna).
  if (/^\/api\/clube\/recompensas\/[^/]+\/imagem(\?v=[\w.-]+)?$/.test(bruta)) return { ok: true, url: bruta };
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    return { ok: false, erro: "Informe uma URL de imagem válida (https) ou envie o arquivo da imagem." };
  }
  if (url.protocol !== "https:") return { ok: false, erro: "Use um link https ou envie o arquivo da imagem." };
  const host = url.hostname.toLowerCase();
  if (host === "previews.dropbox.com" || host.endsWith(".previews.dropbox.com")) {
    return { ok: false, erro: "Este é um link temporário do Dropbox (expira em algumas horas). Envie o arquivo da imagem." };
  }
  if (host === "www.dropbox.com" || host === "dropbox.com") {
    // Página de compartilhamento: raw=1 entrega a imagem. O arquivo precisa estar compartilhado publicamente.
    url.searchParams.delete("dl");
    url.searchParams.set("raw", "1");
  }
  return { ok: true, url: url.toString() };
}

/** GET /api/clube/recompensas/{id}/imagem — imagem de catálogo (não é dado pessoal). */
export async function imagemRecompensaApi(request: Request, env: Env): Promise<Response | null> {
  const m = new URL(request.url).pathname.match(/^\/api\/clube\/recompensas\/([0-9a-f-]{36})\/imagem$/i);
  if (!m) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const db = createServiceSupabaseClient(env);
  const { data } = await db.from("clube_recompensas").select("imagem_path").eq("id", m[1]).is("excluido_em", null).maybeSingle();
  const caminho = (data as { imagem_path?: string | null } | null)?.imagem_path;
  if (!caminho) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const etag = `"${caminho.replace(/"/g, "")}"`;
  const cache = { ETag: etag, "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: cache });
  const { data: arquivo, error } = await db.storage.from(BUCKET_RECOMPENSAS).download(caminho);
  if (error || !arquivo) return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  const tipo = detectarTipoArquivo(new Uint8Array(await arquivo.slice(0, 16).arrayBuffer()));
  if (!tipo || tipo.mime === "application/pdf") return new Response(null, { status: 415, headers: { "Cache-Control": "no-store" } });
  return new Response(request.method === "HEAD" ? null : await arquivo.arrayBuffer(), { status: 200, headers: { ...cache, "Content-Type": tipo.mime, "Content-Disposition": "inline" } });
}

/** Grava a imagem enviada no Admin e devolve o caminho e o endereço permanente. */
export async function salvarImagemRecompensa(db: ReturnType<typeof createServiceSupabaseClient>, id: string, arquivo: File, caminhoAnterior: string | null) {
  if (arquivo.size === 0 || arquivo.size > TAMANHO_MAXIMO_IMAGEM) return { ok: false as const, status: 400, erro: "Envie uma imagem de até 5 MB." };
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const tipo = detectarTipoArquivo(bytes);
  if (!tipo || tipo.mime === "application/pdf") return { ok: false as const, status: 400, erro: "O arquivo precisa ser uma imagem JPG, PNG ou WebP." };
  const versao = String(Date.now());
  const caminho = `recompensas/${id}/${versao}.${tipo.extensao}`;
  const { error } = await db.storage.from(BUCKET_RECOMPENSAS).upload(caminho, bytes, { contentType: tipo.mime, upsert: false });
  if (error) return { ok: false as const, status: 502, erro: "Não foi possível guardar a imagem agora." };
  if (caminhoAnterior && caminhoAnterior !== caminho) await db.storage.from(BUCKET_RECOMPENSAS).remove([caminhoAnterior]).catch(() => undefined);
  return { ok: true as const, caminho, url: urlImagemRecompensa(id, versao) };
}
