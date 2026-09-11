import { registrarErro } from "@/lib/monitoramento";

export type ApiError = { erro?: string };

function fallbackHttpMessage(status: number): string {
  if (status === 405) return "A API desta implantação não foi publicada corretamente. Abra o deployment mais recente e tente novamente.";
  if (status === 503) return "O backend desta implantação ainda não está configurado para autenticação real.";
  if (status === 401) return "Seus dados não foram reconhecidos. Confira as informações e tente novamente.";
  if (status === 429) return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  return `Não foi possível concluir a operação (${status}).`;
}

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
    throw new Error("Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.");
  }

  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!response.ok) {
    const message = typeof data === "object" && data && "erro" in data && typeof data.erro === "string"
      ? data.erro
      : fallbackHttpMessage(response.status);
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
