import type { Cliente } from "@/types/database";
import type { AgendaCirurgiaResponse, AgendaTermosResponse, CartaoCliente, EstagioCentral, EstagioDrawer, VisaoGeralResponse } from "./types";

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
  visaoGeral: (cursor?: { estagio: EstagioCentral; aposNome: string; aposId: string }) => {
    const params = cursor ? new URLSearchParams(cursor) : null;
    return get<VisaoGeralResponse>(`/api/admin/central/visao-geral${params ? `?${params}` : ""}`);
  },
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

  /** Cadastro completo (mesma fonte da tela Clientes), usado por Perfil/Financeiro compartilhados. */
  clienteCadastro: async (clienteId: string): Promise<Cliente | null> => {
    const d = await get<{ clientes: Cliente[] }>("/api/admin/clientes");
    return (d.clientes ?? []).find((c) => c.id === clienteId) ?? null;
  },
  /** Conclusão do levantamento — mesmo endpoint do card de Revisão financeira. */
  concluirLevantamento: (clienteId: string, body: { decisao: "aprovada" | "recusada"; observacao?: string; saldoRestante?: number; taxaCartao?: number; formasCusteio?: FormaCusteio[] }) =>
    post(`/api/admin/clientes/${encodeURIComponent(clienteId)}/revisao-financeira`, body),
};

export type FormaCusteio = "cartao" | "pix" | "cheques" | "boleto_100";
export const FORMAS_CUSTEIO: { value: FormaCusteio; label: string }[] = [
  { value: "cartao", label: "Cartão" }, { value: "pix", label: "PIX" }, { value: "cheques", label: "Cheques" }, { value: "boleto_100", label: "100% boleto" },
];
export function rotuloFormaCusteio(v: string | null | undefined): string {
  return FORMAS_CUSTEIO.find((f) => f.value === v)?.label ?? (v ? String(v).toUpperCase() : "—");
}

/** Horários aceitos pelo backend (agenda_agendar_data / agenda_reservar_cirurgia). */
export const HORARIOS_TERMOS = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"];
export const HORARIOS_CIRURGIA = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00"];

export function moeda(n: number): string {
  return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dia = String(iso).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia.split("-").reverse().join("/") : "—";
}

const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const isoDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const capitalizar = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

export function diaSemana(iso: string | null | undefined): string {
  return iso ? capitalizar(toDate(iso).toLocaleDateString("pt-BR", { weekday: "long" })) : "";
}
export function mesAno(iso: string): string {
  return toDate(iso).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
export function dataHoraBr(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return dataBr(v);
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}
export function horaLocal(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
export function somarMeses(iso: string, delta: number): string {
  const d = toDate(iso);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return isoDe(d);
}
/** Dias corridos entre duas datas ISO (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}
export function proximoDiaUtil(iso: string): string {
  const d = toDate(iso);
  do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
  return isoDe(d);
}
/** Dias úteis decorridos entre início (exclusivo) e fim (inclusivo) — só exibição. */
export function diasUteisDecorridos(inicio: string | null, fim: string): number {
  if (!inicio) return 0;
  const d = toDate(inicio), end = toDate(fim);
  let n = 0;
  while (d < end) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6 && d <= end) n++; }
  return n;
}
/** 42 células (6 semanas) do mês que contém `iso`. */
export function celulasDoMes(iso: string): { iso: string; dia: number; outroMes: boolean }[] {
  const base = toDate(iso);
  const mes = base.getMonth();
  const inicio = new Date(base.getFullYear(), mes, 1, 12);
  inicio.setDate(1 - inicio.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    return { iso: isoDe(d), dia: d.getDate(), outroMes: d.getMonth() !== mes };
  });
}
export function iniciais(nome: string | null | undefined): string {
  return String(nome || "CL").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

export function horaBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const raw = String(iso);
  return raw.length >= 16 ? raw.slice(11, 16) : "";
}
