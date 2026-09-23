import type { ReactNode } from "react";
import { celulasDoMes, dataBr, diaSemana, mesAno } from "./api";
import type { DiaCalendario } from "./types";

export interface StatusDia { kind: "available" | "partial" | "full" | "blocked"; usadas: number; total: number; aberta: boolean }

/** Mesma classificação do V46 `calendarStatus`, a partir do calendário real. */
export function statusDoDia(dia: DiaCalendario | undefined): StatusDia {
  if (!dia) return { kind: "blocked", usadas: 0, total: 0, aberta: false };
  const usadas = dia.vagasOcupadas, total = dia.vagasTotais || 0;
  if (dia.status !== "disponivel") return { kind: "blocked", usadas, total, aberta: false };
  if (total > 0 && usadas >= total) return { kind: "full", usadas, total, aberta: true };
  if (usadas > 0) return { kind: "partial", usadas, total, aberta: true };
  return { kind: "available", usadas, total, aberta: true };
}

/** V46 `calendarHtml`: grade 6×7 com estados disponível / agendada / fechada. */
export function AgendaCalendar({ selecionado, hoje, calendario, onSelecionar, onMudarMes }: {
  selecionado: string; hoje: string; calendario: DiaCalendario[] | null;
  onSelecionar: (iso: string) => void; onMudarMes: (delta: number) => void;
}) {
  const porData = new Map((calendario ?? []).map((d) => [d.data, d]));
  return <>
    <div className="calendar-head">
      <div className="calendar-nav">
        <button type="button" className="circle-btn" aria-label="Mês anterior" onClick={() => onMudarMes(-1)}>‹</button>
        <h2>{mesAno(selecionado)}</h2>
        <button type="button" className="circle-btn" aria-label="Próximo mês" onClick={() => onMudarMes(1)}>›</button>
      </div>
      <button type="button" className="secondary-btn" onClick={() => onSelecionar(hoje)}>Hoje</button>
    </div>
    <div className="calendar-grid" aria-busy={calendario === null}>
      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((x) => <div key={x} className="weekday">{x}</div>)}
      {celulasDoMes(selecionado).map((cel) => {
        const s = statusDoDia(porData.get(cel.iso));
        const passado = cel.iso < hoje;
        const agendada = s.usadas > 0;
        const estado = passado ? "past" : agendada ? "booked" : s.kind === "available" || s.kind === "partial" ? "available" : "blocked";
        const legenda = passado ? "data encerrada" : agendada ? `${s.usadas} agendamento(s)` : estado === "available" ? "disponível" : "fechada";
        return <div key={cel.iso} className={["day-cell", estado, cel.outroMes ? "other" : "", cel.iso === selecionado ? "selected" : ""].filter(Boolean).join(" ")}>
          <div className="day-top"><span className="day-num">{cel.dia}</span><span className="day-marker" /></div>
          {agendada && <span className="cell-bookings" aria-hidden="true">{s.usadas}</span>}
          <small className="day-cap">{s.total ? `${s.usadas}/${s.total}` : "—"}</small>
          <button type="button" aria-label={`Selecionar ${dataBr(cel.iso)} (${legenda})`} aria-pressed={cel.iso === selecionado} onClick={() => onSelecionar(cel.iso)} />
        </div>;
      })}
    </div>
  </>;
}

/** V46 `dayPanelHtml`: status, abrir/bloquear, vagas e lista do dia. */
export function DayPanel({ tipo, data, hoje, dia, ocupado, tetoAtingido, antesDaLista, itens, acaoLista, onAbrir, onBloquear, onCapacidade }: {
  tipo: "terms" | "surgery"; data: string; hoje: string; dia: DiaCalendario | undefined; ocupado: boolean; tetoAtingido?: boolean;
  antesDaLista?: ReactNode; itens: ReactNode[]; acaoLista?: ReactNode;
  onAbrir: () => void; onBloquear: () => void; onCapacidade: (novo: number) => void;
}) {
  const s = statusDoDia(dia);
  const passado = data < hoje;
  const texto = passado ? "Data encerrada" : s.usadas > 0 ? "Já agendada" : s.kind === "blocked" || s.kind === "full" ? "Fechada" : "Disponível";
  const cls = passado ? "past" : s.kind === "blocked" || s.kind === "full" ? "danger" : s.kind === "partial" ? "wait" : "success";
  const capacidade = dia?.vagasTotais || 0;
  return <div className={`selected-day ${tipo === "terms" ? "terms-day-panel" : "surgery-day-panel"} panel panel-pad`}>
    <div className="calendar-head">
      <div>
        <h3>{diaSemana(data)}, {dataBr(data)}</h3>
        <div className="day-status"><span className={`badge ${cls}`}>{texto}</span></div>
      </div>
    </div>
    {antesDaLista}
    {passado
      ? <div className="past-date-notice" role="note"><b>Data encerrada</b><span>Este dia já passou e está disponível somente para consulta. Não é possível abrir, bloquear, alterar vagas ou criar novos agendamentos.</span></div>
      : <div className="day-actions">
          <button type="button" className="secondary-btn" onClick={onAbrir} disabled={ocupado || tetoAtingido} title={tetoAtingido ? "Teto financeiro mensal atingido" : undefined}>{tipo === "terms" ? "Liberar para termos" : "Abrir data cirúrgica"}</button>
          <button type="button" className="danger-btn" onClick={onBloquear} disabled={ocupado || (Boolean(dia) && !s.aberta)}>Bloquear</button>
        </div>}
    <div className={`vacancy-card${passado ? " read-only" : ""}`}>
      <div>
        <small>{tipo === "terms" ? "Vagas para assinatura" : "Capacidade cirúrgica"}</small>
        <div className="big">{Math.max(0, capacidade - s.usadas)} de {capacidade}</div>
        <small>{s.usadas} {tipo === "terms" ? "agendada(s)" : "ocupada(s)"}</small>
      </div>
      {passado
        ? <span className="past-date-pill">Encerrada</span>
        : <div className="stepper" title={s.aberta ? undefined : "Libere a data para ajustar as vagas"}>
            <button type="button" aria-label="Diminuir vagas" disabled={ocupado || !s.aberta || capacidade - 1 < Math.max(1, s.usadas)} onClick={() => onCapacidade(capacidade - 1)}>−</button>
            <span aria-live="polite">{capacidade}</span>
            <button type="button" aria-label="Aumentar vagas" disabled={ocupado || !s.aberta} onClick={() => onCapacidade(capacidade + 1)}>+</button>
          </div>}
    </div>
    <div className="day-list">
      <div className="day-list-head"><h4>{tipo === "terms" ? "Assinaturas agendadas" : "Cirurgias do dia"} ({itens.length})</h4>{passado ? null : acaoLista}</div>
      <div className="appointment-list">{itens.length ? itens : <div className="empty-card">Nenhum agendamento neste dia.</div>}</div>
    </div>
  </div>;
}

export function AppointmentRow({ tipo, horario, nome, detalhe, badge, onAbrir }: { tipo: "terms" | "surgery"; horario: string | null; nome: string; detalhe: string; badge: ReactNode; onAbrir: () => void }) {
  return <article className={`appointment ${tipo === "terms" ? "terms-appointment" : "surgery-appointment"}`} role="button" tabIndex={0} aria-label={`Abrir ${nome}`} onClick={onAbrir}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(); } }}>
    <time>{horario || "—"}</time>
    <div className="appt-main"><b>{nome}</b><small>{detalhe}</small></div>
    {badge}
    <span className="more" aria-hidden="true">⋮</span>
  </article>;
}
