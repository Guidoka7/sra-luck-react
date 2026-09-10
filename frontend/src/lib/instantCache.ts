const PREFIX = "sra:instant:v2:";
const DEFAULT_TTL = 60_000;

type CacheEntry<T> = { timestamp: number; data: T };

function read<T>(key: string, ttl: number): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.timestamp > ttl) {
      sessionStorage.removeItem(PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function writeInstantCache<T>(key: string, data: T) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {
    // Cache is an optimization only; never break the application if storage is full/blocked.
  }
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
  try {
    const fullPrefix = PREFIX + (prefix ?? "");
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(fullPrefix)) sessionStorage.removeItem(key);
    }
  } catch {
    // no-op
  }
}
