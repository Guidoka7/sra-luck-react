import { registrarErro } from "@/lib/monitoramento";

export type ApiError = { erro?: string };

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: "include",
      headers: {
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    registrarErro({ origem: "api", codigo: "NETWORK_ERROR", mensagem: error instanceof Error ? error.message : "Falha de rede" });
    throw error;
  }

  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!response.ok) {
    const message = typeof data === "object" && data && "erro" in data && typeof data.erro === "string"
      ? data.erro
      : `Não foi possível concluir a operação (${response.status}).`;
    registrarErro({
      origem: "api",
      nivel: response.status >= 500 ? "critical" : "warning",
      codigo: "HTTP_ERROR",
      mensagem: message,
      status_http: response.status,
      detalhes: { metodo: init?.method || "GET", rota: typeof input === "string" ? input.split("?")[0] : String(input) },
    });
    throw new Error(message);
  }

  return data as T;
}
