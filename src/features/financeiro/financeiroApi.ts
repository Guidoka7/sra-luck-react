import type { ClienteFinanceiro, DetalheRecebivel, ListaRecebiveis, PeriodoFinanceiro, ResumoFinanceiro } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const multipart = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: init?.body && !multipart ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.erro || "Não foi possível concluir a operação.");
  return data as T;
}

function query(params: object) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  return search.toString();
}

export const financeiroApi = {
  resumo: (periodo: PeriodoFinanceiro) => request<ResumoFinanceiro>(`/api/admin/financeiro/resumo?${query(periodo)}`),
  recebiveis: (params: PeriodoFinanceiro & { busca?: string; status?: string; pagina?: number; limite?: number }) =>
    request<ListaRecebiveis>(`/api/admin/financeiro/recebiveis?${query(params)}`),
  validacoes: () => request<ListaRecebiveis>("/api/admin/financeiro/validacoes"),
  detalhe: (id: string) => request<DetalheRecebivel>(`/api/admin/financeiro/recebiveis/${encodeURIComponent(id)}`),
  baixa: (id: string, payload: Record<string, unknown>) => request(`/api/admin/financeiro/recebiveis/${encodeURIComponent(id)}/baixa`, {
    method: "POST", body: JSON.stringify({ ...payload, idempotencyKey: payload.idempotencyKey ?? crypto.randomUUID() }),
  }),
  anexarComprovante: (id: string, arquivo: File) => {
    const form = new FormData();
    form.append("arquivo", arquivo);
    return request(`/api/admin/financeiro/recebiveis/${encodeURIComponent(id)}/comprovante`, { method: "POST", body: form });
  },
  validar: (id: string, acao: "confirmar" | "rejeitar", observacao: string, idempotencyKey?: string) => request(`/api/admin/financeiro/validacoes/${encodeURIComponent(id)}/${acao}`, {
    method: "POST", body: JSON.stringify({ observacao, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  }),
  alterar: (id: string, payload: Record<string, unknown>) => request(`/api/admin/financeiro/recebiveis/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify(payload),
  }),
  clientes: async () => {
    const data = await request<{ clientes?: ClienteFinanceiro[] } | ClienteFinanceiro[]>("/api/admin/clientes");
    return Array.isArray(data) ? data : data.clientes ?? [];
  },
  gerarParcelas: (clienteId: string, payload: Record<string, unknown>) => request(`/api/admin/financeiro/clientes/${encodeURIComponent(clienteId)}/parcelas`, {
    method: "POST", body: JSON.stringify(payload),
  }),
};
