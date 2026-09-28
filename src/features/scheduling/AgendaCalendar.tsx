import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Lock, Minus, Plus } from "lucide-react";
import { celulasDoMes, dataBr, diaSemana, mesAno } from "./api";
import type { DiaCalendario } from "./types";

export interface StatusDia { kind: "available" | "partial" | "full" | "blocked"; usadas: number; total: number; aberta: boolean }

/** Classificação do dia a partir do calendário real (mesma do V46). */
export function statusDoDia(dia: DiaCalendario | undefined): StatusDia {
  if (!dia) return { kind: "blocked", usadas: 0, total: 0, aberta: false };
  const usadas = dia.vagasOcupadas, total = dia.vagasTotais || 0;
  if (dia.status !== "disponivel") return { kind: "blocked", usadas, total, aberta: false };
  if (total > 0 && usadas >= total) return { kind: "full", usadas, total, aberta: true };
  if (usadas > 0) return { kind: "partial", usadas, total, aberta: true };
  return { kind: "available", usadas, total, aberta: true };
}

/** Vagas ao abrir uma data: mantém o ajuste de uma data aberta; nunca menos que as já ocupadas. */
export function capacidadeAoLiberar(dia: DiaCalendario | undefined): number {
  const s = statusDoDia(dia);
  if (s.aberta) return Math.max(1, s.total);
  return Math.max(1, s.usadas);
}

type EstadoCelula = "past" | "open" | "full" | "closed";

function estadoDaCelula(iso: string, hoje: string, s: StatusDia): EstadoCelula {
  if (iso < hoje) return "past";
  if (!s.aberta) return "closed";
  return s.kind === "full" ? "full" : "open";
}

const LEGENDA_ESTADO: Record<EstadoCelula, string> = {
  past: "data encerrada",
  open: "disponível",
  full: "lotada",
  closed: "fechada",
};

/** Calendário mensal: cada dia mostra se está aberto no app e quantas vagas restam. */
export function AgendaCalendar({ selecionado, hoje, calendario, onSelecionar, onMudarMes }: {
  selecionado: string; hoje: string; calendario: DiaCalendario[] | null;
  onSelecionar: (iso: string) => void; onMudarMes: (delta: number) => void;
}) {
  const porData = new Map((calendario ?? []).map((d) => [d.data, d]));
  return <div className="ag-cal">
    <div className="ag-cal-head">
      <div className="ag-cal-nav">
        <button type="button" className="ag-icone-btn" aria-label="Mês anterior" onClick={() => onMudarMes(-1)}><ChevronLeft size={16} /></button>
        <h2 className="ag-h2 ag-cal-mes">{mesAno(selecionado).replace(/^./, (x) => x.toUpperCase())}</h2>
        <button type="button" className="ag-icone-btn" aria-label="Próximo mês" onClick={() => onMudarMes(1)}><ChevronRight size={16} /></button>
      </div>
      <button type="button" className="ag-btn" onClick={() => onSelecionar(hoje)} disabled={selecionado === hoje}>Hoje</button>
    </div>
    <div className="ag-cal-grade" aria-busy={calendario === null}>
      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((x) => <div key={x} className="ag-cal-semana">{x}</div>)}
      {celulasDoMes(selecionado).map((cel) => {
        const s = statusDoDia(porData.get(cel.iso));
        const estado = estadoDaCelula(cel.iso, hoje, s);
        const livres = Math.max(0, s.total - s.usadas);
        const info = estado === "past" ? ""
          : estado === "closed" ? (s.usadas ? `Fechada · ${s.usadas}` : "Fechada")
            : estado === "full" ? "Lotada"
              : `${livres} ${livres === 1 ? "vaga" : "vagas"}`;
        const legenda = s.usadas > 0 && estado !== "past" ? `${LEGENDA_ESTADO[estado]}, ${s.usadas} agendamento(s)` : LEGENDA_ESTADO[estado];
        const classes = ["ag-dia", `is-${estado}`, cel.outroMes ? "is-outro" : "", cel.iso === hoje ? "is-hoje" : "", cel.iso === selecionado ? "is-sel" : ""].filter(Boolean).join(" ");
        return <div key={cel.iso} className={classes}>
          <span className="ag-dia-num">{cel.dia}</span>
          {cel.iso === hoje && <span className="ag-dia-hoje">Hoje</span>}
          {info && <span className="ag-dia-info">{info}</span>}
          {estado === "past" && s.usadas > 0 && <span className="ag-dia-contagem" aria-hidden="true">{s.usadas}</span>}
          {(estado === "open" || estado === "full") && s.total > 0 && <span className="ag-dia-barra" aria-hidden="true"><span style={{ width: `${Math.min(100, (s.usadas / s.total) * 100)}%` }} /></span>}
          <button type="button" aria-label={`Selecionar ${dataBr(cel.iso)} (${legenda})`} aria-pressed={cel.iso === selecionado} onClick={() => onSelecionar(cel.iso)} />
        </div>;
      })}
    </div>
    <div className="ag-cal-legenda" aria-hidden="true">
      <span><i className="is-open" />Aberta no app</span>
      <span><i className="is-full" />Lotada</span>
      <span><i className="is-closed" />Fechada</span>
      <span><i className="is-past" />Encerrada</span>
    </div>
  </div>;
}

/**
 * Painel do dia: disponibilidade no app (aberta/fechada + vagas) e a lista
 * de compromissos. Datas passadas ficam somente para consulta.
 */
export function DayPanel({ tipo, data, hoje, dia, ocupado, tetoAtingido, antesDaLista, itens, acaoLista, onAbrir, onBloquear, onCapacidade }: {
  tipo: "terms" | "surgery"; data: string; hoje: string; dia: DiaCalendario | undefined; ocupado: boolean; tetoAtingido?: boolean;
  antesDaLista?: ReactNode; itens: ReactNode[]; acaoLista?: ReactNode;
  onAbrir: () => void; onBloquear: () => void; onCapacidade: (novo: number) => void;
}) {
  const s = statusDoDia(dia);
  const passado = data < hoje;
  const capacidade = dia?.vagasTotais || 0;
  const livres = Math.max(0, capacidade - s.usadas);
  const termos = tipo === "terms";
  const status = passado ? { texto: "Data encerrada", cls: "past" }
    : !s.aberta ? { texto: "Fechada no app", cls: "closed" }
      : s.kind === "full" ? { texto: "Lotada", cls: "full" }
        : { texto: "Aberta no app", cls: "open" };
  const rotuloAbrir = termos ? "Abrir para assinaturas" : "Abrir data cirúrgica";

  return <section className="ag-panel ag-diapainel" aria-labelledby="ag-diapainel-titulo">
    <header className="ag-diapainel-head">
      <div>
        <span className="ag-eyebrow">{termos ? "Agenda de termos" : "Agenda cirúrgica"}</span>
        <h2 id="ag-diapainel-titulo" className="ag-h2">{diaSemana(data)}, {dataBr(data)}</h2>
      </div>
      <span className={`ag-status is-${status.cls}`}>{status.texto}</span>
    </header>

    {passado
      ? <div className="ag-aviso" role="note"><Lock size={14} aria-hidden="true" /><div><b>Data encerrada</b><span>Este dia já passou e está disponível somente para consulta. Não é possível abrir, fechar, alterar vagas ou criar novos agendamentos.</span></div></div>
      : <div className="ag-disponibilidade">
        <div className="ag-disp-linha">
          <div>
            <b>{s.aberta ? `${livres} de ${capacidade} ${capacidade === 1 ? "vaga livre" : "vagas livres"}` : "Data fechada para novas escolhas"}</b>
            <small>{s.aberta
              ? `As clientes ${termos ? "com levantamento concluído" : "com agenda cirúrgica liberada"} veem esta data no app. ${s.usadas} ${s.usadas === 1 ? "já agendada" : "já agendadas"}.`
              : s.usadas > 0 ? `Não aparece no app. Os ${s.usadas} agendamento(s) existentes continuam valendo.` : "Não aparece no app para as clientes."}</small>
          </div>
          {s.aberta
            ? <button type="button" className="ag-btn is-perigo" onClick={onBloquear} disabled={ocupado}>Fechar data</button>
            : <button type="button" className="ag-btn is-primario" onClick={onAbrir} disabled={ocupado || tetoAtingido} title={tetoAtingido ? "Teto financeiro mensal atingido" : undefined}>{rotuloAbrir}</button>}
        </div>
        {s.aberta && <div className="ag-disp-linha ag-disp-vagas">
          <div><b>{termos ? "Vagas para assinatura" : "Capacidade cirúrgica"}</b><small>Não pode ficar abaixo das vagas já ocupadas.</small></div>
          <div className="ag-stepper">
            <button type="button" aria-label="Diminuir vagas" disabled={ocupado || capacidade - 1 < Math.max(1, s.usadas)} onClick={() => onCapacidade(capacidade - 1)}><Minus size={14} /></button>
            <span aria-live="polite">{capacidade}</span>
            <button type="button" aria-label="Aumentar vagas" disabled={ocupado} onClick={() => onCapacidade(capacidade + 1)}><Plus size={14} /></button>
          </div>
        </div>}
      </div>}

    {antesDaLista}

    <div className="ag-dialista">
      <div className="ag-dialista-head">
        <h3 className="ag-h3">{termos ? "Assinaturas do dia" : "Cirurgias do dia"} <span>{itens.length}</span></h3>
        {passado ? null : acaoLista}
      </div>
      {itens.length ? <div className="ag-compromissos">{itens}</div> : <div className="ag-vazio ag-vazio-compacto"><span>Nenhum agendamento neste dia.</span></div>}
    </div>
  </section>;
}

/** Compromisso do dia: horário, cliente e situação; ações opcionais ao lado. */
export function AppointmentRow({ tipo, horario, nome, detalhe, badge, onAbrir, acoes }: {
  tipo: "terms" | "surgery"; horario: string | null; nome: string; detalhe: string; badge: ReactNode; onAbrir: () => void; acoes?: ReactNode;
}) {
  return <article className={`ag-compromisso is-${tipo}`}>
    <button type="button" className="ag-compromisso-main" aria-label={`Abrir ${nome}`} onClick={onAbrir}>
      <time>{horario || "—"}</time>
      <span className="ag-compromisso-texto"><b>{nome}</b><small>{detalhe}</small></span>
      {badge}
    </button>
    {acoes && <div className="ag-compromisso-acoes">{acoes}</div>}
  </article>;
}
