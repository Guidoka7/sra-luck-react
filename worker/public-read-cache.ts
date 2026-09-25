// Somente dados globais, iguais para todas as clientes. Não armazenar sessão,
// permissões, CPF, saldo, parcelas ou qualquer informação individual aqui.
type Entry = { value?: unknown; expiresAt: number; pending?: Promise<unknown> };
const entries = new Map<string, Entry>();

export async function cachedPublicRead<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  let entry = entries.get(key);
  if (entry && entry.value !== undefined && entry.expiresAt > now) return entry.value as T;
  if (entry?.pending) return entry.pending as Promise<T>;
  entry = { value: undefined, expiresAt: 0 };
  entries.set(key, entry);
  const current = entry;
  const pending = loader().then((value) => {
    if (entries.get(key) === current) {
      current.value = value;
      current.expiresAt = Date.now() + 20_000 + Math.floor(Math.random() * 15_000);
      current.pending = undefined;
    }
    return value;
  }, (error) => {
    if (entries.get(key) === current) entries.delete(key);
    throw error;
  });
  entry.pending = pending;
  return pending;
}

export function invalidatePublicRead(key: string): void {
  entries.delete(key);
}
