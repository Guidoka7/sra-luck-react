import { obterCredencial } from "./integrations-credenciais";
import { createServiceSupabaseClient, type Env } from "./supabase";

export type WebPushCredentials = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

function paraBase64(bytes: Uint8Array) {
  let binario = "";
  bytes.forEach((byte) => {
    binario += String.fromCharCode(byte);
  });
  return btoa(binario);
}

function paraBase64Url(bytes: Uint8Array) {
  return paraBase64(bytes).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function deBase64Url(valor: string) {
  const padding = "=".repeat((4 - (valor.length % 4)) % 4);
  const base64 = (valor + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (caractere) => caractere.charCodeAt(0));
}

async function derivarChave(segredo: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(segredo));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
}

async function cifrarValor(segredo: string, valor: string) {
  const chave = await derivarChave(segredo);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    chave,
    new TextEncoder().encode(valor),
  );
  return {
    valorCifrado: paraBase64(new Uint8Array(cifrado)),
    iv: paraBase64(iv),
  };
}

function mascarar(valor: string) {
  const limpo = valor.trim();
  if (limpo.length <= 4) return "••••";
  return `•••• ${limpo.slice(-4)}`;
}

async function gerarVapid(): Promise<{ publicKey: string; privateKey: string }> {
  const par = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const publica = await crypto.subtle.exportKey("jwk", par.publicKey);
  const privada = await crypto.subtle.exportKey("jwk", par.privateKey);

  if (!publica.x || !publica.y || !privada.d) {
    throw new Error("VAPID_KEY_GENERATION_FAILED");
  }

  const x = deBase64Url(publica.x);
  const y = deBase64Url(publica.y);
  if (x.length !== 32 || y.length !== 32) {
    throw new Error("VAPID_PUBLIC_KEY_INVALID");
  }

  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(x, 1);
  raw.set(y, 33);

  return {
    publicKey: paraBase64Url(raw),
    privateKey: privada.d,
  };
}

async function ler(env: Env): Promise<WebPushCredentials | null> {
  const [publicKey, privateKey, subject] = await Promise.all([
    obterCredencial(env, "web_push", "vapid_public_key"),
    obterCredencial(env, "web_push", "vapid_private_key"),
    obterCredencial(env, "web_push", "vapid_subject"),
  ]);

  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export async function garantirWebPushConfigurado(
  request: Request,
  env: Env,
): Promise<WebPushCredentials | null> {
  const existente = await ler(env);
  if (existente) return existente;

  if (!env.CLIENTE_SESSION_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  try {
    const { publicKey, privateKey } = await gerarVapid();
    const subject = new URL(request.url).origin;
    const entradas = [
      { chave: "vapid_public_key", valor: publicKey },
      { chave: "vapid_private_key", valor: privateKey },
      { chave: "vapid_subject", valor: subject },
    ];

    const registros = await Promise.all(
      entradas.map(async ({ chave, valor }) => {
        const { valorCifrado, iv } = await cifrarValor(env.CLIENTE_SESSION_SECRET!, valor);
        return {
          provedor: "web_push",
          chave,
          valor_cifrado: valorCifrado,
          valor_iv: iv,
          valor_mascarado: mascarar(valor),
          ativo: true,
          atualizado_por: "system:web_push_bootstrap",
          atualizado_em: new Date().toISOString(),
        };
      }),
    );

    const db = createServiceSupabaseClient(env);
    const { error } = await db
      .from("integracoes_credenciais")
      .upsert(registros, { onConflict: "provedor,chave" });

    if (error) return null;

    // Releitura garante que, mesmo com duas inicializações simultâneas, a
    // resposta use exatamente o par que ficou persistido no cofre.
    return await ler(env);
  } catch {
    return null;
  }
}
