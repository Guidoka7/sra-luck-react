import { ehCancelamento, motivoFalhaDoAparelho, registrarErro, respostaEsperada } from "@/lib/monitoramento";

export type ApiError = { erro?: string };

function fallbackHttpMessage(status: number): string {
  if (status === 405) return "A API desta implantação não foi publicada corretamente. Abra o deployment mais recente e tente novamente.";
  if (status === 503) return "O backend desta implantação ainda não está configurado para autenticação real.";
  if (status === 401) return "Seus dados não foram reconhecidos. Confira as informações e tente novamente.";
  if (status === 429) return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  return `Não foi possível concluir a operação (${status}).`;
}

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response | null = null;
  const metodo = (init?.method || "GET").toUpperCase();
  const inicio = Date.now();
  // Leitura (GET) que falha por rede tenta de novo uma vez: no celular, a conexão costuma voltar
  // em um ou dois segundos depois que o app sai do segundo plano.
  for (let tentativa = 0; tentativa < (metodo === "GET" ? 2 : 1); tentativa++) {
    try {
      const vaiRepetir = tentativa === 0 && metodo === "GET";
      response = await fetch(input, {
        ...init,
        ...(vaiRepetir ? { sraLuckVaiRepetir: true } : {}),
        credentials: "include",
        headers: {
          ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...(init?.headers ?? {}),
        },
      });
      break;
    } catch (error) {
      if (ehCancelamento(error)) throw error;
      if (tentativa === 0 && metodo === "GET" && !(typeof navigator !== "undefined" && navigator.onLine === false)) {
        await esperar(1500);
        continue;
      }
      const motivo = motivoFalhaDoAparelho(inicio);
      registrarErro({ origem: "api", nivel: motivo ? "info" : "error", codigo: motivo ? "CONEXAO_DO_APARELHO" : "NETWORK_ERROR", action: "api.network.failed", mensagem: error instanceof Error ? error.message : "Falha de rede", detalhes: motivo ? { motivo } : undefined });
      throw new Error("Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.");
    }
  }
  if (!response) throw new Error("Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.");

  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!response.ok) {
    const message = typeof data === "object" && data && "erro" in data && typeof data.erro === "string"
      ? data.erro
      : fallbackHttpMessage(response.status);
    const rota = typeof input === "string" ? input : String(input);
    registrarErro({
      origem: "api",
      nivel: respostaEsperada(rota, response.status) ? "info" : response.status >= 500 ? "error" : "warn",
      codigo: "HTTP_ERROR",
      action: "api.request.failed",
      mensagem: message,
      status_http: response.status,
      request_id: response.headers.get("x-request-id") || undefined,
      detalhes: { metodo: init?.method || "GET", rota: typeof input === "string" ? input.split("?")[0] : String(input) },
    });
    throw new Error(message);
  }

  return data as T;
}
