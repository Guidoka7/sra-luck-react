import { useEffect, useState } from "react";
import { toast } from "sonner";
import { centralApi, dataBr } from "./api";
import { MonthCalendar } from "./MonthCalendar";
import type { AgendaTermosResponse } from "./types";

const HORARIOS = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"];

function hojeIso() { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`; }

export function TermsRescheduleModal({ agendamentoId, nome, onClose, onDone }: { agendamentoId: string; nome: string; onClose: () => void; onDone: () => void }) {
  const hoje = hojeIso();
  const [modo, setModo] = useState<"admin" | "cliente">("admin");
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoje.slice(5, 7)));
  const [dados, setDados] = useState<AgendaTermosResponse | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [horario, setHorario] = useState(HORARIOS[0]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { void centralApi.agendaTermos(ano, mes).then(setDados).catch((e) => toast.error(e.message)); }, [ano, mes]);

  function mudarMes(delta: number) {
    let m = mes + delta, a = ano;
    if (m > 12) { m = 1; a++; } else if (m < 1) { m = 12; a--; }
    setMes(m); setAno(a);
  }

  async function confirmar() {
    setSalvando(true);
    try {
      if (modo === "cliente") {
        await centralApi.devolverEscolhaTermos(agendamentoId);
        toast.success("Reagendamento liberado. A cliente poderá escolher uma nova data no app.");
      } else {
        if (!selecionado) { toast.warning("Selecione uma data disponível."); setSalvando(false); return; }
        const dia = dados?.calendario.find((d) => d.data === selecionado);
        if (!dia) { toast.warning("Selecione uma data disponível."); setSalvando(false); return; }
        await centralApi.reagendarTermosAgora(agendamentoId, dia.id, horario);
        toast.success("Reagendamento confirmado.");
      }
      onDone();
    } catch (e: any) { toast.error(e.message); } finally { setSalvando(false); }
  }

  return <div style={{ position: "fixed", inset: 0, background: "rgba(24,18,20,.4)", zIndex: 60, display: "grid", placeItems: "center", padding: 16 }} onClick={onClose}>
    <div onClick={(e) => e.stopPropagation()} style={{ width: "min(600px,96vw)", maxHeight: "90vh", overflow: "auto", background: "var(--panel)", borderRadius: 16, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17 }}>Reagendar assinatura dos termos</h2>
          <small style={{ color: "var(--soft)" }}>{nome} · usa a mesma disponibilidade da Agenda de Termos principal.</small>
        </div>
        <button onClick={onClose} style={{ border: 0, background: "transparent", fontSize: 16, cursor: "pointer" }}>✕</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "14px 0" }}>
        <button onClick={() => setModo("admin")} style={{ textAlign: "left", padding: 10, borderRadius: 10, border: `1px solid ${modo === "admin" ? "var(--bg)" : "var(--line)"}`, background: modo === "admin" ? "var(--robg, var(--s0))" : "var(--panel)" }}>
          <b style={{ fontSize: 11 }}>Escolher nova data agora</b>
          <div style={{ fontSize: 9.5, color: "var(--soft)", marginTop: 4 }}>Você seleciona uma data com vaga real disponível.</div>
        </button>
        <button onClick={() => setModo("cliente")} style={{ textAlign: "left", padding: 10, borderRadius: 10, border: `1px solid ${modo === "cliente" ? "var(--bg)" : "var(--line)"}`, background: modo === "cliente" ? "var(--robg, var(--s0))" : "var(--panel)" }}>
          <b style={{ fontSize: 11 }}>Deixar a cliente escolher no app</b>
          <div style={{ fontSize: 9.5, color: "var(--soft)", marginTop: 4 }}>Libera a Agenda de Termos novamente; a cliente vê só datas abertas com vaga.</div>
        </button>
      </div>

      {modo === "admin" ? (
        dados ? <>
          <MonthCalendar ano={ano} mes={mes} hoje={hoje} calendario={dados.calendario} selecionado={selecionado} onSelecionar={setSelecionado} onMudarMes={mudarMes} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 10 }}>
            <div style={{ fontSize: 11 }}>Nova data: <b>{selecionado ? dataBr(selecionado) : "selecione uma data disponível"}</b></div>
            <select value={horario} onChange={(e) => setHorario(e.target.value)} style={{ height: 32, borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)" }}>
              {HORARIOS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        </> : <div style={{ padding: 20, textAlign: "center", color: "var(--soft)" }}>Carregando calendário…</div>
      ) : (
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, fontSize: 11, color: "var(--soft)" }}>
          A data atual será liberada. A cliente verá, no app, somente datas realmente abertas e com vaga na Agenda de Termos.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={{ height: 34, padding: "0 14px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--panel)" }}>Cancelar</button>
        <button disabled={salvando} onClick={confirmar} style={{ height: 34, padding: "0 14px", borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontWeight: 700 }}>
          {modo === "admin" ? "Confirmar nova data" : "Liberar escolha no app"}
        </button>
      </div>
    </div>
  </div>;
}
