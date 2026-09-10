/**
 * Sessão da cliente (login por CPF + data de nascimento), sem depender do
 * Supabase Auth. Usa HMAC-SHA256 via Web Crypto — funciona tanto em Route
 * Handlers (Node) quanto no middleware (Edge).
 */

const COOKIE_NAME = "cliente_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 dias

function getSecret() {
  const secret = process.env.CLIENTE_SESSION_SECRET;
  if (!secret) throw new Error("CLIENTE_SESSION_SECRET não configurada no .env.local");
  return secret;
}

async function hmac(data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Buffer.from(signature).toString("base64url");
}

export interface ClienteSessionPayload {
  clienteId: string;
  iat: number;
}

export async function criarTokenSessao(clienteId: string): Promise<string> {
  const payload: ClienteSessionPayload = { clienteId, iat: Date.now() };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = await hmac(payloadStr);
  return `${payloadStr}.${signature}`;
}

export async function verificarTokenSessao(
  token: string | undefined
): Promise<ClienteSessionPayload | null> {
  if (!token) return null;
  const [payloadStr, signature] = token.split(".");
  if (!payloadStr || !signature) return null;

  const expected = await hmac(payloadStr);
  if (expected !== signature) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadStr, "base64url").toString("utf-8")
    ) as ClienteSessionPayload;
    const idadeMs = Date.now() - payload.iat;
    if (idadeMs > MAX_AGE_SECONDS * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export const CLIENTE_COOKIE_NAME = COOKIE_NAME;
export const CLIENTE_COOKIE_MAX_AGE = MAX_AGE_SECONDS;
