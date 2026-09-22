import { useState } from "react";
import { celulasDoMes, dataBr, diaSemana, mesAno, somarMeses } from "./api";
import { V46Modal } from "./V46Modal";

/**
 * V46 "Escolher dia". No produto real a data do sistema é a do servidor:
 * aqui o dia escolhido só posiciona as agendas de Termos e Cirurgia, sem
 * alterar datas, prazos ou transições.
 */
export function SystemDateModal({ atual, hoje, contagens, onClose, onAplicar }: {
  atual: string; hoje: string; contagens: Map<string, { termos: number; cirurgias: number }>;
  onClose: () => void; onAplicar: (iso: string) => void;
}) {
  const [selecionado, setSelecionado] = useState(atual);
  const [mes, setMes] = useState(`${atual.slice(0, 7)}-01`);
  return <V46Modal className="system-date-modal" titulo="Escolher dia" onClose={onClose} footer={<>
    <button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button>
    <button type="button" className="primary-btn" onClick={() => { onAplicar(selecionado); onClose(); }}>Ir para {dataBr(selecionado)}</button>
  </>}>
    <div className="system-date-calendar">
      <div className="system-date-toolbar">
        <div className="system-date-nav">
          <button type="button" aria-label="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))}>‹</button>
          <button type="button" aria-label="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))}>›</button>
        </div>
        <h3>{mesAno(mes)}</h3>
      </div>
      <div className="system-date-weekdays">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((x) => <span key={x}>{x}</span>)}</div>
      <div className="system-date-grid">
        {celulasDoMes(mes).map((d) => {
          const n = contagens.get(d.iso);
          return <button key={d.iso} type="button" aria-pressed={d.iso === selecionado} aria-label={`Selecionar ${dataBr(d.iso)}`}
            className={["system-date-day", d.outroMes ? "other" : "", d.iso === selecionado ? "selected" : "", d.iso === hoje ? "system-current" : ""].filter(Boolean).join(" ")}
            onClick={() => { setSelecionado(d.iso); setMes(`${d.iso.slice(0, 7)}-01`); }}>
            <span>{d.dia}</span>
            <span className="system-date-events">
              {n?.termos ? <i className="terms-dot" title="Termos agendados" /> : null}
              {n?.cirurgias ? <i className="surgery-dot" title="Cirurgias agendadas" /> : null}
            </span>
          </button>;
        })}
      </div>
      <div className="system-date-selected">
        <div><small>Dia selecionado</small><b>{dataBr(selecionado)} · {diaSemana(selecionado)}</b></div>
        <span className="system-date-hint">Posiciona as agendas no dia escolhido.<br />A data real do sistema não muda.</span>
      </div>
    </div>
  </V46Modal>;
}
