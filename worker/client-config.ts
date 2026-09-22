import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";

const COOKIE_NAME = "cliente_session";
const PROFILE_BUCKET = "clientes-perfil";
const PROFILE_MAX_PROCESSED_UPLOAD = 4 * 1024 * 1024;
const PROFILE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ProfileMime = (typeof PROFILE_TYPES)[number];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function detectarTipoImagem(bytes: Uint8Array): ProfileMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

function extensaoImagem(tipo: ProfileMime) {
  if (tipo === "image/jpeg") return "jpg";
  if (tipo === "image/png") return "png";
  return "webp";
}

function cacheFotoHeaders(etag: string, contentType?: string) {
  const headers = new Headers({
    "Cache-Control": "private, max-age=0, stale-while-revalidate=86400",
    "Vary": "Cookie",
    "ETag": etag,
  });
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

/**
 * Configuração visível pela cliente e manutenção da foto de perfil.
 * A imagem permanece privada e é entregue pelo próprio endpoint autenticado,
 * com cache privado revalidável para evitar o avatar piscando a cada reload.
 */
export async function clientConfigApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/api/cliente/config-publica") {
    if (request.method !== "GET") return null;
    const db = createServiceSupabaseClient(env);
    const { data, error } = await db
      .from("configuracoes")
      .select("whatsapp_contato")
      .maybeSingle();
    if (error) { console.error("Falha ao carregar configuração pública:", error); return json({ erro: "Não foi possível carregar as informações de atendimento." }, 500); }

    return json({ whatsappContato: data?.whatsapp_contato || null });
  }

  if (url.pathname === "/api/cliente/perfil/foto") {
    if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
    const sessao = await verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
    if (!sessao) return json({ erro: "Sessão expirada." }, 401);

    const db = createServiceSupabaseClient(env);

    if (request.method === "GET") {
      const { data: cliente, error } = await db
        .from("clientes")
        .select("foto_perfil_path")
        .eq("id", sessao.clienteId)
        .maybeSingle();
      if (error) return json({ erro: "Não foi possível carregar a foto de perfil." }, 500);
      if (!cliente?.foto_perfil_path) return json({ erro: "Foto de perfil não cadastrada." }, 404);

      const etag = `"${String(cliente.foto_perfil_path).replace(/\"/g, "")}"`;
      const headers304 = cacheFotoHeaders(etag);
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: headers304 });

      const { data: arquivo, error: downloadError } = await db.storage.from(PROFILE_BUCKET).download(cliente.foto_perfil_path);
      if (downloadError || !arquivo) return json({ erro: "Não foi possível carregar a foto de perfil." }, 500);

      const contentType = arquivo.type || (cliente.foto_perfil_path.endsWith(".png") ? "image/png" : cliente.foto_perfil_path.endsWith(".jpg") ? "image/jpeg" : "image/webp");
      const headers = cacheFotoHeaders(etag, contentType);
      headers.set("Content-Disposition", "inline");
      return new Response(await arquivo.arrayBuffer(), { status: 200, headers });
    }

    if (request.method === "POST") {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return json({ erro: "Requisição inválida." }, 400);
      }

      const arquivo = formData.get("foto");
      if (!(arquivo instanceof File)) return json({ erro: "Selecione uma foto para continuar." }, 400);
      if (!PROFILE_TYPES.includes(arquivo.type as ProfileMime)) return json({ erro: "Não foi possível processar esta imagem." }, 400);
      if (arquivo.size === 0 || arquivo.size > PROFILE_MAX_PROCESSED_UPLOAD) return json({ erro: "Não foi possível processar esta imagem. Tente outra foto." }, 400);

      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      const tipo = detectarTipoImagem(bytes);
      if (!tipo || tipo !== arquivo.type) return json({ erro: "O arquivo selecionado não é uma imagem válida." }, 400);

      const { data: clienteAtual, error: clienteError } = await db
        .from("clientes")
        .select("foto_perfil_path")
        .eq("id", sessao.clienteId)
        .single();
      if (clienteError) return json({ erro: "Cliente não encontrada." }, 404);

      const novoCaminho = `${sessao.clienteId}/perfil-${Date.now()}.${extensaoImagem(tipo)}`;
      const { error: uploadError } = await db.storage
        .from(PROFILE_BUCKET)
        .upload(novoCaminho, arquivo, { contentType: tipo, upsert: false });
      if (uploadError) return json({ erro: "Não foi possível enviar a foto." }, 500);

      const { error: updateError } = await db
        .from("clientes")
        .update({ foto_perfil_path: novoCaminho, updated_at: new Date().toISOString() })
        .eq("id", sessao.clienteId);
      if (updateError) {
        await db.storage.from(PROFILE_BUCKET).remove([novoCaminho]);
        return json({ erro: "Não foi possível salvar a foto de perfil." }, 500);
      }

      if (clienteAtual?.foto_perfil_path && clienteAtual.foto_perfil_path !== novoCaminho) {
        await db.storage.from(PROFILE_BUCKET).remove([clienteAtual.foto_perfil_path]);
      }

      return json({ sucesso: true, versao: Date.now() });
    }

    if (request.method === "DELETE") {
      const { data: cliente, error } = await db
        .from("clientes")
        .select("foto_perfil_path")
        .eq("id", sessao.clienteId)
        .single();
      if (error) return json({ erro: "Cliente não encontrada." }, 404);
      if (!cliente?.foto_perfil_path) return json({ sucesso: true });

      const { error: updateError } = await db
        .from("clientes")
        .update({ foto_perfil_path: null, updated_at: new Date().toISOString() })
        .eq("id", sessao.clienteId);
      if (updateError) return json({ erro: "Não foi possível remover a foto de perfil." }, 500);

      await db.storage.from(PROFILE_BUCKET).remove([cliente.foto_perfil_path]);
      return json({ sucesso: true });
    }

    return json({ erro: "Método não permitido." }, 405);
  }

  if (url.pathname !== "/api/cliente/config" || request.method !== "GET") return null;
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);

  const sessao = await verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return json({ erro: "Sessão expirada." }, 401);

  const db = createServiceSupabaseClient(env);
  const { data, error } = await db
    .from("configuracoes")
    .select("pix_chave,pix_qrcode_base64,pix_desconto_percentual,whatsapp_contato,telefone_contato")
    .maybeSingle();
  if (error) { console.error("Falha ao carregar configuração da cliente:", error); return json({ erro: "Não foi possível carregar as configurações agora." }, 500); }

  return json({
    pixChave: data?.pix_chave || null,
    pixQrCodeUrl: data?.pix_qrcode_base64 || null,
    pixDescontoPercentual: Number(data?.pix_desconto_percentual ?? 0),
    whatsappContato: data?.whatsapp_contato || null,
    telefoneContato: data?.telefone_contato || null,
  });
}
