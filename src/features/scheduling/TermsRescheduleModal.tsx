import { useEffect, useState } from "react";
import { toast } from "sonner";
import { celulasDoMes, centralApi, dataBr, HORARIOS_TERMOS, mesAno, somarMeses } from "./api";
import type { DiaCalendario } from "./types";
import { V46Modal } from "./V46Modal";

type Status = { kind: "available" | "booked" | "closed"; remaining: number; selectable: boolean };

/**
 * V46 `showTermsRescheduleModal`: dois modos — escolher nova data agora
 * (`/termos/reagendar`, vaga validada no banco) ou devolver a escolha para a
 * cliente no app (`/termos/devolver-escolha`). Usa a mesma disponibilidade
 * real da Agenda de Termos.
 */
export function TermsRescheduleModal({ agendamentoId, nome, dataAtual, horarioAtual, hoje, onClose, onDone }: {
  agendamentoId: string; nome: string; dataAtual: string | null; horarioAtual: string | null; hoje: string;
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [modo, setModo] = useState<"admin" | "client">("admin");
  const [mes, setMes] = useState(`${(dataAtual && dataAtual >= hoje ? dataAtual : hoje).slice(0, 7)}-01`);
  const [calendario, setCalendario] = useState<DiaCalendario[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [horario, setHorario] = useState(horarioAtual && HORARIOS_TERMOS.includes(horarioAtual) ? horarioAtual : HORARIOS_TERMOS[0]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCalendario(null); setErro(null);
    centralApi.agendaTermos(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)))
      .then((r) => { if (vivo) setCalendario(r.calendario); })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : "Não foi possível carregar a agenda."); });
    return () => { vivo = false; };
  }, [mes]);

  function status(iso: string): Status {
    const dia = calendario?.find((d) => d.data === iso);
    if (!dia || dia.status !== "disponivel" || iso < hoje) return { kind: "closed", remaining: 0, selectable: false };
    const usadas = Math.max(0, dia.vagasOcupadas - (iso === dataAtual ? 1 : 0));
    const restantes = Math.max(0, dia.vagasTotais - usadas);
    if (dia.vagasTotais <= 0 || restantes <= 0) return { kind: "closed", remaining: 0, selectable: false };
    return { kind: usadas > 0 ? "booked" : "available", remaining: restantes, selectable: true };
  }

  useEffect(() => {
    if (!calendario) return;
    if (selecionado && selecionado.slice(0, 7) === mes.slice(0, 7) && status(selecionado).selectable) return;
    const primeiro = celulasDoMes(mes).find((d) => !d.outroMes && status(d.iso).selectable);
    setSelecionado(dataAtual && dataAtual.slice(0, 7) === mes.slice(0, 7) && status(dataAtual).selectable ? dataAtual : primeiro?.iso ?? null);
  }, [calendario]);

  async function confirmar() {
    if (enviando) return;
    if (modo === "admin") {
      const dia = selecionado ? calendario?.find((d) => d.data === selecionado) : null;
      if (!selecionado || !dia || !status(selecionado).selectable) { toast.warning("Selecione uma data disponível na Agenda de Termos."); return; }
      setEnviando(true);
      try {
        await centralApi.reagendarTermosAgora(agendamentoId, dia.id, horario);
        toast.success("Reagendamento confirmado.");
        await onDone(); onClose();
      } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível reagendar."); }
      finally { setEnviando(false); }
      return;
    }
    setEnviando(true);
    try {
      await centralApi.devolverEscolhaTermos(agendamentoId);
      toast.success("Reagendamento liberado. A cliente poderá escolher uma nova data no app.");
      await onDone(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível liberar a escolha no app."); }
    finally { setEnviando(false); }
  }

  return <V46Modal titulo="Reagendar assinatura dos termos" subtitulo={`${nome} · usa a mesma disponibilidade da Agenda de Termos principal.`} onClose={onClose} bloqueado={enviando} footer={<>
    <button type="button" className="secondary-btn" onClick={onClose} disabled={enviando}>Cancelar</button>
    <button type="button" className="primary-btn" onClick={confirmar} disabled={enviando || (modo === "admin" && !selecionado)} aria-busy={enviando}>{enviando ? "Salvando…" : modo === "admin" ? "Confirmar nova data" : "Liberar escolha no app"}</button>
  </>}>
    <div className="rebook-mode-grid" role="radiogroup" aria-label="Forma de reagendamento">
      <button type="button" role="radio" aria-checked={modo === "admin"} className={`rebook-mode${modo === "admin" ? " active" : ""}`} onClick={() => setModo("admin")}>
        <b>Escolher nova data agora</b><small>Você seleciona uma data disponível pelo administrativo.</small>
      </button>
      <button type="button" role="radio" aria-checked={modo === "client"} className={`rebook-mode${modo === "client" ? " active" : ""}`} onClick={() => setModo("client")}>
        <b>Deixar a cliente escolher no app</b><small>Libera novamente a Agenda de Termos e remove a data atual.</small>
      </button>
    </div>

    {modo === "admin" ? <>
      <div className="rebook-current"><small>Agendamento atual</small><b>{dataAtual ? `${dataBr(dataAtual)} às ${horarioAtual || "—"}` : "Sem data definida"}</b></div>
      <div className="rebook-calendar">
        <div className="rebook-calendar-head">
          <button type="button" className="circle-btn" aria-label="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))}>‹</button>
          <b>{mesAno(mes)}</b>
          <button type="button" className="circle-btn" aria-label="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))}>›</button>
        </div>
        <div className="rebook-weekdays">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((x) => <span key={x}>{x}</span>)}</div>
        {erro ? <div className="callout danger" role="alert">{erro}</div>
          : !calendario ? <div className="process-note">Carregando datas…</div>
          : <div className="rebook-grid">
              {celulasDoMes(mes).map((d) => {
                const s = status(d.iso);
                return <button key={d.iso} type="button" className={`rebook-day rebook-${s.kind}${d.outroMes ? " other" : ""}${d.iso === selecionado ? " selected" : ""}`}
                  disabled={!s.selectable} aria-pressed={d.iso === selecionado}
                  aria-label={s.selectable ? `Selecionar ${dataBr(d.iso)}, ${s.remaining} vaga(s)` : `${dataBr(d.iso)} indisponível`}
                  onClick={() => setSelecionado(d.iso)}>
                  <span>{d.dia}</span>
                  <small>{s.selectable ? `${s.remaining} vaga${s.remaining === 1 ? "" : "s"}` : "—"}</small>
                </button>;
              })}
            </div>}
      </div>
      <div className="rebook-selection">
        <div><small>Nova data</small><b>{selecionado ? dataBr(selecionado) : "Selecione uma data disponível"}</b></div>
        <label><span>Horário</span>
          <select value={horario} onChange={(e) => setHorario(e.target.value)}>{HORARIOS_TERMOS.map((h) => <option key={h}>{h}</option>)}</select>
        </label>
      </div>
    </> : <div className="rebook-client-choice">
      <span className="app-request-icon" aria-hidden="true">▣</span>
      <div><b>Escolha livre no app</b><p>A data atual será liberada. A cliente verá somente datas abertas e com vagas cadastradas na Agenda de Termos principal.</p></div>
    </div>}
  </V46Modal>;
}
