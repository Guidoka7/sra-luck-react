export type ApiError = { erro?: string };

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = typeof data === "object" && data && "erro" in data && typeof data.erro === "string"
      ? data.erro
      : `Não foi possível concluir a operação (${response.status}).`;
    throw new Error(message);
  }

  return data as T;
}
