import { buscarColaboradorAdminAtivo, temPermissaoAdmin, PERMISSOES_ADMIN } from "./admin-auth";
import { obterCredencial, salvarCredencialInterna } from "./integrations-credenciais";
import { getCookie, verificarTokenAdmin } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";

type VapidConfiguracao = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

type VapidValidacao = {
  valido: boolean;
  detalhe: string;
  subject?: string;
  publicKey?: string;
  privateKey?: string;
};

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

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64(value: string) {
  const compact = value.trim().replace(/\s+/g, "").replace(/=+$/g, "");
  if (!compact || !/^[A-Za-z0-9_+\/-]+$/.test(compact)) throw new Error("BASE64_INVALIDO");
  const standard = compact.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function normalizarSubjectVapid(value: string): string | null {
  const raw = value.trim();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (raw.toLowerCase().startsWith("mailto:")) {
    const email = raw.slice(7).trim();
    return emailPattern.test(email) ? `mailto:${email.toLowerCase()}` : null;
  }
  if (emailPattern.test(raw)) return `mailto:${raw.toLowerCase()}`;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function validarConfiguracaoVapid(config: VapidConfiguracao): Promise<VapidValidacao> {
  const subject = normalizarSubjectVapid(config.subject);
  if (!subject) return { valido: false, detalhe: "Subject inválido. Use um e-mail ou uma URL HTTPS." };

  try {
    const publicBytes = decodeBase64(config.publicKey);
    const privateBytes = decodeBase64(config.privateKey);
    if (publicBytes.length !== 65 || publicBytes[0] !== 4) {
      return { valido: false, detalhe: "VAPID Public Key inválida: esperado ponto P-256 não comprimido de 65 bytes." };
    }
    if (privateBytes.length !== 32) {
      return { valido: false, detalhe: "VAPID Private Key inválida: esperado escalar P-256 de 32 bytes." };
    }

    const publicKey = encodeBase64Url(publicBytes);
    const privateKey = encodeBase64Url(privateBytes);
    const x = encodeBase64Url(publicBytes.slice(1, 33));
    const y = encodeBase64Url(publicBytes.slice(33, 65));

    const signingKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x, y, d: privateKey, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const verifyKey = await crypto.subtle.importKey(
      "raw",
      publicBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const challenge = new TextEncoder().encode("sra-luck:web-push:vapid-validation:v1");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, challenge);
    const matches = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, signature, challenge);
    if (!matches) return { valido: false, detalhe: "As chaves VAPID pública e privada não pertencem ao mesmo par." };

    return {
      valido: true,
      detalhe: "Par VAPID válido e compatível com ECDSA P-256.",
      subject,
      publicKey,
      privateKey,
    };
  } catch {
    return { valido: false, detalhe: "Não foi possível importar ou validar o par VAPID informado." };
  }
}

export async function gerarConfiguracaoVapid(subjectInput: string): Promise<VapidConfiguracao> {
  const subject = normalizarSubjectVapid(subjectInput);
  if (!subject) throw new Error("SUBJECT_INVALIDO");

  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!privateJwk.d) throw new Error("FALHA_EXPORTAR_VAPID");

  return {
    subject,
    publicKey: encodeBase64Url(publicBytes),
    privateKey: privateJwk.d,
  };
}

async function autorizar(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return { adminId: null, resposta: json({ erro: "Serviço temporariamente indisponível." }, 503) };
  const session = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  if (!session) return { adminId: null, resposta: json({ erro: "Sessão administrativa expirada." }, 401) };
  const colaborador = await buscarColaboradorAdminAtivo(session.adminId, env).catch(() => null);
  if (!colaborador || !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS)) {
    return { adminId: null, resposta: json({ erro: "Seu papel não tem permissão para gerenciar o Web Push." }, 403) };
  }
  return { adminId: session.adminId, resposta: null };
}

async function carregarConfiguracao(env: Env) {
  const [subject, publicKey, privateKey] = await Promise.all([
    obterCredencial(env, "web_push", "vapid_subject"),
    obterCredencial(env, "web_push", "vapid_public_key"),
    obterCredencial(env, "web_push", "vapid_private_key"),
  ]);
  return { subject, publicKey, privateKey };
}

async function quantidadeAssinaturas(env: Env) {
  const db = createServiceSupabaseClient(env);
  const { count, error } = await db.from("web_push_subscriptions").select("id", { count: "exact", head: true });
  return error ? 0 : (count ?? 0);
}

async function ultimaVerificacao(env: Env) {
  const db = createServiceSupabaseClient(env);
  const { data } = await db.from("logs_alteracoes")
    .select("created_at,detalhes")
    .eq("acao", "testou_conexao_integracao")
    .eq("entidade_id", "web_push")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function diagnosticoSeguro(env: Env) {
  const [config, assinaturas, verificacao] = await Promise.all([
    carregarConfiguracao(env),
    quantidadeAssinaturas(env),
    ultimaVerificacao(env),
  ]);
  const configurado = Boolean(config.subject && config.publicKey && config.privateKey);
  const validacao = configurado
    ? await validarConfiguracaoVapid({ subject: config.subject!, publicKey: config.publicKey!, privateKey: config.privateKey! })
    : { valido: false, detalhe: "As três credenciais VAPID ainda não estão configuradas." };

  return {
    configurado,
    validado: validacao.valido,
    detalhe: validacao.detalhe,
    subject: config.subject ?? null,
    publicKey: config.publicKey ?? null,
    privateKeyConfigurada: Boolean(config.privateKey),
    assinaturas,
    ultimaVerificacao: verificacao?.created_at ?? null,
  };
}

async function guardarPar(env: Env, adminId: string, config: VapidConfiguracao, confirmarRotacao: boolean) {
  const db = createServiceSupabaseClient(env);
  const atual = await carregarConfiguracao(env);
  const assinaturas = await quantidadeAssinaturas(env);
  const rotacao = Boolean(atual.publicKey && atual.publicKey !== config.publicKey);

  if (rotacao && assinaturas > 0 && !confirmarRotacao) {
    return {
      resposta: json({
        erro: `Existem ${assinaturas} dispositivo(s) inscrito(s) com a chave atual. A rotação pode exigir nova ativação das notificações nesses aparelhos.`,
        codigo: "ROTACAO_VAPID_COM_ASSINATURAS",
        assinaturas,
      }, 409),
      assinaturas,
    };
  }

  await salvarCredencialInterna(env, "web_push", "vapid_subject", config.subject, adminId);
  await salvarCredencialInterna(env, "web_push", "vapid_public_key", config.publicKey, adminId);
  await salvarCredencialInterna(env, "web_push", "vapid_private_key", config.privateKey, adminId);
  await db.from("logs_alteracoes").insert({
    usuario: `admin:${adminId}`,
    acao: rotacao ? "rotacionou_vapid_web_push" : "configurou_vapid_web_push",
    entidade: "integracoes",
    entidade_id: "web_push",
    detalhes: { validado: true, assinaturas, rotacao, chavePrivadaExposta: false },
  });
  return { resposta: null, assinaturas };
}

async function registrarTeste(env: Env, adminId: string, valido: boolean, detalhe: string, assinaturas: number) {
  const db = createServiceSupabaseClient(env);
  await db.from("logs_alteracoes").insert({
    usuario: `admin:${adminId}`,
    acao: "testou_conexao_integracao",
    entidade: "integracoes",
    entidade_id: "web_push",
    detalhes: { conectado: valido, valido, detalhe, assinaturas, tipoValidacao: "vapid_p256" },
  });
}

export async function webPushConfigApi(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/api/admin/integrations/web-push/vapid") return null;

  const auth = await autorizar(request, env);
  if (auth.resposta) return auth.resposta;
  const adminId = auth.adminId!;

  if (request.method === "GET") return json(await diagnosticoSeguro(env));
  if (request.method !== "POST") return json({ erro: "Método não suportado." }, 405);
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);

  const body = await request.json().catch(() => ({})) as {
    acao?: "gerar" | "salvar" | "testar";
    subject?: string;
    publicKey?: string;
    privateKey?: string;
    confirmarRotacao?: boolean;
  };

  if (body.acao === "testar") {
    const diagnostico = await diagnosticoSeguro(env);
    await registrarTeste(env, adminId, diagnostico.validado, diagnostico.detalhe, diagnostico.assinaturas);
    return json({ conectado: diagnostico.validado, ...diagnostico }, diagnostico.validado ? 200 : 422);
  }

  let config: VapidConfiguracao;
  if (body.acao === "gerar") {
    try {
      config = await gerarConfiguracaoVapid(String(body.subject ?? ""));
    } catch {
      return json({ erro: "Informe um Subject válido (e-mail ou URL HTTPS) antes de gerar as chaves." }, 400);
    }
  } else if (body.acao === "salvar") {
    const validacao = await validarConfiguracaoVapid({
      subject: String(body.subject ?? ""),
      publicKey: String(body.publicKey ?? ""),
      privateKey: String(body.privateKey ?? ""),
    });
    if (!validacao.valido || !validacao.subject || !validacao.publicKey || !validacao.privateKey) {
      return json({ erro: validacao.detalhe, conectado: false }, 422);
    }
    config = { subject: validacao.subject, publicKey: validacao.publicKey, privateKey: validacao.privateKey };
  } else {
    return json({ erro: "Ação inválida." }, 400);
  }

  const validacao = await validarConfiguracaoVapid(config);
  if (!validacao.valido || !validacao.subject || !validacao.publicKey || !validacao.privateKey) {
    return json({ erro: validacao.detalhe, conectado: false }, 422);
  }
  config = { subject: validacao.subject, publicKey: validacao.publicKey, privateKey: validacao.privateKey };

  try {
    const salvo = await guardarPar(env, adminId, config, Boolean(body.confirmarRotacao));
    if (salvo.resposta) return salvo.resposta;
    await registrarTeste(env, adminId, true, "Par VAPID válido, pareado e salvo no cofre do sistema.", salvo.assinaturas);
    return json({
      ok: true,
      conectado: true,
      validado: true,
      detalhe: "Par VAPID válido, pareado e salvo no cofre do sistema.",
      subject: config.subject,
      publicKey: config.publicKey,
      privateKeyConfigurada: true,
      assinaturas: salvo.assinaturas,
      chavePrivadaExposta: false,
    });
  } catch (error) {
    console.error("Falha ao salvar VAPID:", error);
    return json({ erro: "Não foi possível salvar a configuração VAPID." }, 500);
  }
}
