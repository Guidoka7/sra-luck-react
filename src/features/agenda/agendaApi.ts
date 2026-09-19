import type { Cliente } from "@/types/database";
import type {
  AgendaFlowPayload,
  AgendaReleasePayload,
  AgendaSurgeriesPayload,
  AgendaTermsPayload,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.erro || "Não foi possível concluir a operação.");
  return data as T;
}

export const agendaApi = {
  terms: (month: string) => request<AgendaTermsPayload>("/api/admin/agenda/termos?month=" + encodeURIComponent(month)),
  release: () => request<AgendaReleasePayload>("/api/admin/agenda/liberacao-financeira"),
  surgeries: (month: string) => request<AgendaSurgeriesPayload>("/api/admin/agenda/cirurgias?month=" + encodeURIComponent(month)),
  clientFlow: (clientId: string) => request<AgendaFlowPayload>("/api/admin/clientes/" + encodeURIComponent(clientId) + "/agenda-flow"),
  setTermsCapacity: (date: string, payload: { total: number; action: "open" | "close" | "reopen" }) =>
    request("/api/admin/agenda/termos/" + encodeURIComponent(date) + "/capacity", { method: "PUT", body: JSON.stringify(payload) }),
  setSurgeryCapacity: (date: string, payload: { total: number; action: "open" | "close" | "reopen" }) =>
    request("/api/admin/agenda/cirurgias/" + encodeURIComponent(date) + "/capacity", { method: "PUT", body: JSON.stringify(payload) }),
  confirmReview: (clientId: string, payload: { saldoFinal: number; formasQuitacao: string[] }) =>
    request("/api/admin/clientes/" + encodeURIComponent(clientId) + "/levantamento-financeiro", { method: "POST", body: JSON.stringify(payload) }),
  confirmForecast: (clientId: string, date: string) =>
    request("/api/admin/clientes/" + encodeURIComponent(clientId) + "/previsao-cirurgia", { method: "POST", body: JSON.stringify({ data: date }) }),
  attendance: (clientId: string, compareceu: boolean) =>
    request("/api/admin/clientes/" + encodeURIComponent(clientId) + "/comparecimento-termos", { method: "POST", body: JSON.stringify({ compareceu }) }),
  settlement: (clientId: string, recebido: boolean) =>
    request("/api/admin/clientes/" + encodeURIComponent(clientId) + "/quitacao-saldo", { method: "POST", body: JSON.stringify({ recebido, idempotencyKey: crypto.randomUUID() }) }),
  clients: async () => {
    const data = await request<{ clientes?: Cliente[] } | Cliente[]>("/api/admin/clientes");
    return Array.isArray(data) ? data : data.clientes ?? [];
  },
};
