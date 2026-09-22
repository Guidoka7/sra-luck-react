import { dataBr } from "./api";
import type { CartaoCliente } from "./types";

/** V46 `chosenDateHtml`: bloco "calendário" com a data escolhida. */
export function ChosenDate({ iso, horario, rotulo }: { iso: string | null; horario: string | null; rotulo: string }) {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "").toUpperCase();
  const semana = d.toLocaleDateString("pt-BR", { weekday: "long" }).replace(/^./, (x) => x.toUpperCase());
  return <div className="chosen-date">
    <div className="chosen-date-calendar" aria-hidden="true"><span>{mes}</span><strong>{dia}</strong><small>{d.getFullYear()}</small></div>
    <div className="chosen-date-copy"><small>{rotulo}</small><b>{semana} · {horario || "Horário a definir"}</b><em>Data escolhida</em></div>
  </div>;
}

export type Tom = "success" | "info" | "wait" | "danger";

/** Estado da Etapa 4 derivado dos campos persistidos (somente exibição). */
export function estadoLiberacao(c: CartaoCliente, hoje: string) {
  const compareceu = c.comparecimentoStatus === "compareceu";
  const quitada = c.quitacaoStatus === "paga";
  const ambos = compareceu && quitada;
  const liberada = Boolean(c.agendaCirurgicaLiberadaEm);
  const inicio = ambos ? maiorData(c.comparecimentoEm, c.quitacaoEm) : null;
  const totalDias = 5 + Math.max(0, c.prazoAjusteDias || 0);
  const decorridos = inicio ? Math.min(totalDias, diasUteis(inicio, hoje)) : 0;
  return { compareceu, quitada, ambos, liberada, inicio, totalDias, decorridos, previsao: c.prazoCirurgico ?? null };
}

function maiorData(a: string | null, b: string | null): string | null {
  const da = a ? a.slice(0, 10) : null, db = b ? b.slice(0, 10) : null;
  if (!da) return db;
  if (!db) return da;
  return da >= db ? da : db;
}

function diasUteis(inicio: string, fim: string): number {
  const d = new Date(`${inicio}T12:00:00`), end = new Date(`${fim}T12:00:00`);
  let n = 0;
  while (d < end) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6 && d <= end) n++; }
  return n;
}

export function rotuloLevantamento(c: CartaoCliente): { texto: string; tom: Tom } {
  if (c.statusRevisaoFinanceira === "aprovada") return { texto: "Levantamento concluído", tom: "success" };
  if (c.statusRevisaoFinanceira === "recusada") return { texto: "Divergência no levantamento", tom: "danger" };
  if (c.statusRevisaoFinanceira === "pendente") return { texto: "Em análise", tom: "info" };
  return { texto: "Aguardando", tom: "wait" };
}

export function rotuloLiberacao(c: CartaoCliente, hoje: string): { texto: string; tom: Tom; passo: number } {
  const e = estadoLiberacao(c, hoje);
  let texto = "Hoje · conferir atendimento", tom: Tom = "wait", passo = 0;
  if (e.compareceu) { passo = 1; texto = "Compareceu · falta quitação"; tom = "info"; }
  if (e.quitada && !e.compareceu) { passo = 1; texto = "Quitação confirmada · falta presença"; tom = "info"; }
  if (c.comparecimentoStatus === "nao_compareceu") { texto = "Não compareceu · reagendar"; tom = "danger"; }
  if (c.quitacaoStatus === "nao_realizada") { texto = "Saldo não quitado · pendência"; tom = "danger"; }
  if (e.ambos && !e.liberada) {
    passo = 3;
    texto = e.decorridos === 0 ? `Prazo de ${e.totalDias} dias úteis iniciado` : `Prazo · ${e.decorridos} de ${e.totalDias} dias úteis`;
    tom = "wait";
  }
  if (e.liberada) { passo = 4; texto = "Agenda cirúrgica liberada · aguardando escolha"; tom = "success"; }
  return { texto, tom, passo };
}

export function faltamTexto(n: number) {
  return n === 1 ? "Falta 1 parcela" : `Faltam ${n} parcelas`;
}

export { dataBr };
