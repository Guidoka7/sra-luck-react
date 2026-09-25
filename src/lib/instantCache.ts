const PREFIX = "sra:instant:v2:";
const DEFAULT_TTL = 60_000;

type CacheEntry<T> = { timestamp: number; data: T };
// O painel pode conter nomes e histórico de clientes: somente memória da aba.
// Os registros antigos de sessionStorage são apagados ao carregar o módulo.
const entries = new Map<string, CacheEntry<unknown>>();
if (typeof window !== "undefined") {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key);
    }
  } catch { /* armazenamento indisponível */ }
}

function read<T>(key: string, ttl: number): T | null {
  const entry = entries.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttl) {
    entries.delete(key);
    return null;
  }
  return entry.data;
}

export function writeInstantCache<T>(key: string, data: T) {
  if (typeof window === "undefined") return;
  entries.set(key, { timestamp: Date.now(), data });
}

export function getInstantCache<T>(key: string, ttl = DEFAULT_TTL): T | null {
  return read<T>(key, ttl);
}

export async function fetchInstant<T>(url: string, options?: RequestInit, ttl = DEFAULT_TTL): Promise<T> {
  const key = url;
  const cached = read<T>(key, ttl);
  if (cached !== null) return cached;

  const response = await fetch(url, { ...options, cache: "no-store" });
  const data = (await response.json()) as T;
  if (!response.ok) throw new Error((data as any)?.erro || `Erro ${response.status}`);
  writeInstantCache(key, data);
  return data;
}

export async function refreshInstant<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = (await response.json()) as T;
  if (!response.ok) throw new Error((data as any)?.erro || `Erro ${response.status}`);
  writeInstantCache(url, data);
  return data;
}

export function invalidateInstantCache(prefix?: string) {
  if (typeof window === "undefined") return;
  for (const key of entries.keys()) if (!prefix || key.startsWith(prefix)) entries.delete(key);
}
