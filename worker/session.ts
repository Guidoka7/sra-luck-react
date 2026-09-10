const COOKIE_NAME = "cliente_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function base64urlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export interface ClienteSessionPayload {
  clienteId: string;
  iat: number;
}

export async function criarTokenSessao(clienteId: string, secret: string): Promise<string> {
  const payload: ClienteSessionPayload = { clienteId, iat: Date.now() };
  const payloadStr = base64urlEncode(JSON.stringify(payload));
  return `${payloadStr}.${await hmac(payloadStr, secret)}`;
}

export async function verificarTokenSessao(
  token: string | null | undefined,
  secret: string,
): Promise<ClienteSessionPayload | null> {
  if (!token) return null;
  const [payloadStr, signature] = token.split(".");
  if (!payloadStr || !signature) return null;

  const expected = await hmac(payloadStr, secret);
  if (expected.length !== signature.length) return null;
  const expectedBytes = new TextEncoder().encode(expected);
  const actualBytes = new TextEncoder().encode(signature);
  let mismatch = 0;
  for (let i = 0; i < expectedBytes.length; i++) mismatch |= expectedBytes[i] ^ actualBytes[i];
  if (mismatch !== 0) return null;

  try {
    const payload = JSON.parse(base64urlDecode(payloadStr)) as ClienteSessionPayload;
    if (!payload.clienteId || !Number.isFinite(payload.iat)) return null;
    if (Date.now() - payload.iat > MAX_AGE_SECONDS * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

export function setSessionCookie(token: string, secure: boolean): string {
  return `${COOKIE_NAME}=${token}; Max-Age=${MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export { COOKIE_NAME, MAX_AGE_SECONDS };
