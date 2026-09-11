import { registrarErro } from "@/lib/monitoramento";
import { requestJson, type HttpOptions } from "./http";

export type ApiError = { erro?: string };

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit, options?: HttpOptions): Promise<T> {
  const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    return await requestJson<T>(path, init, options);
  } catch (error) {
    registrarErro({
      origem: "api",
      nivel: "error",
      codigo: "API_REQUEST_FAILED",
      mensagem: error instanceof Error ? error.message : "Falha de comunicação com a API",
      metodo: init?.method || "GET",
      detalhes: { rota: path.split("?")[0].slice(0, 700) },
    });
    throw error;
  }
}
