import type { AgendaCirurgiaResponse, AgendaTermosResponse, CartaoCliente, EstagioDrawer, VisaoGeralResponse } from "./types";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { cache: "no-store" });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.erro ?? "Não foi possível carregar os dados.");
  return d as T;
}

async function post(path: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.erro ?? "Não foi possível concluir a operação.");
  return d;
}

export const centralApi = {
  visaoGeral: () => get<VisaoGeralResponse>("/api/admin/central/visao-geral"),
  cliente: (clienteId: string) => get<{ estagio: EstagioDrawer; cartao: CartaoCliente }>(`/api/admin/central/cliente/${clienteId}`),
  agendaTermos: (ano: number, mes: number) => get<AgendaTermosResponse>(`/api/admin/central/termos?ano=${ano}&mes=${mes}`),
  agendaCirurgia: (ano: number, mes: number) => get<AgendaCirurgiaResponse>(`/api/admin/central/cirurgia?ano=${ano}&mes=${mes}`),

  abrirBloquearTermos: (data: string, acao: "liberar" | "bloquear", vagasTotais?: number) =>
    post("/api/admin/central/termos/data", { data, acao, vagasTotais }),
  abrirBloquearCirurgia: (data: string, acao: "liberar" | "bloquear", vagasTotais?: number) =>
    post("/api/admin/central/cirurgia/data", { data, acao, vagasTotais }),

  definirResponsavelTermos: (agendamentoId: string, responsavel: string) =>
    post("/api/admin/central/termos/responsavel", { agendamentoId, responsavel }),
  devolverEscolhaTermos: (agendamentoId: string) => post("/api/admin/central/termos/devolver-escolha", { agendamentoId }),
  reagendarTermosAgora: (agendamentoId: string, novaDataId: string, horario: string) =>
    post("/api/admin/central/termos/reagendar", { agendamentoId, novaDataId, horario }),

  confirmarPrevisao: (agendamentoId: string, previsao: string) => post("/api/admin/central/previsao", { agendamentoId, previsao }),
  registrarComparecimento: (agendamentoId: string, compareceu: boolean) => post("/api/admin/central/comparecimento", { agendamentoId, compareceu }),
  registrarQuitacao: (agendamentoId: string, recebido: boolean) => post("/api/admin/central/quitacao", { agendamentoId, recebido }),
  tentarLiberarCirurgia: (agendamentoId: string) => post("/api/admin/central/liberar-tentativa", { agendamentoId }),

  ajustarPrazo: (agendamentoId: string, diasUteis: 1 | 3 | 5) => post("/api/admin/central/prazo/ajustar", { agendamentoId, diasUteis }),
  liberarAgendaCirurgicaAgora: (agendamentoId: string) => post("/api/admin/central/prazo/liberar-agora", { agendamentoId }),

  agendarDataCirurgia: (clienteId: string, data: string, horario: string) => post("/api/admin/central/cirurgia/agendar", { clienteId, data, horario }),
  confirmarPagamentoCirurgia: (agendamentoId: string) => post("/api/admin/central/cirurgia/pagamento", { agendamentoId }),
};

export function moeda(n: number): string {
  return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dia = String(iso).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia.split("-").reverse().join("/") : "—";
}

export function horaBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const raw = String(iso);
  return raw.length >= 16 ? raw.slice(11, 16) : "";
}
