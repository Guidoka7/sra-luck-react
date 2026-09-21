import type { DiaCalendario } from "./types";

const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function estadoDia(dia: DiaCalendario | undefined, hoje: string, iso: string): "passado" | "bloqueado" | "lotado" | "ocupado" | "aberto" | "indefinido" {
  if (iso < hoje) return "passado";
  if (!dia) return "indefinido";
  if (dia.status === "bloqueado") return "bloqueado";
  if (dia.vagasOcupadas >= dia.vagasTotais && dia.vagasTotais > 0) return "lotado";
  if (dia.vagasOcupadas > 0) return "ocupado";
  return "aberto";
}

const COR_ESTADO: Record<string, { bg: string; border: string; dot: string }> = {
  passado: { bg: "var(--s0)", border: "var(--line2)", dot: "var(--soft)" },
  bloqueado: { bg: "var(--s0)", border: "var(--line2)", dot: "var(--soft)" },
  lotado: { bg: "#FDE8EC", border: "#F2CBD1", dot: "#AD2D40" },
  ocupado: { bg: "#FFF8E9", border: "#EAD4A8", dot: "#B18442" },
  aberto: { bg: "#EEF9F3", border: "#CFE7D8", dot: "#168A59" },
  indefinido: { bg: "var(--s0)", border: "var(--line2)", dot: "var(--soft)" },
};

export function MonthCalendar({
  ano, mes, hoje, calendario, selecionado, onSelecionar, onMudarMes,
}: {
  ano: number; mes: number; hoje: string; calendario: DiaCalendario[]; selecionado: string | null;
  onSelecionar: (iso: string) => void; onMudarMes: (delta: number) => void;
}) {
  const porData = new Map(calendario.map((d) => [d.data, d]));
  const totalDias = new Date(ano, mes, 0).getDate();
  const primeiroDia = new Date(ano, mes - 1, 1).getDay();
  const isoDoDia = (d: number) => `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return <div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <strong style={{ fontSize: 15, textTransform: "capitalize" }}>{MESES_PT[mes - 1]} {ano}</strong>
      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={() => onMudarMes(-1)} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--wine, var(--bg))" }}>‹</button>
        <button onClick={() => onMudarMes(1)} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--wine, var(--bg))" }}>›</button>
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 4, marginBottom: 4 }}>
      {DIAS_SEMANA.map((w, i) => <div key={i} style={{ textAlign: "center", fontSize: 9, fontWeight: 800, color: "var(--soft)" }}>{w}</div>)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 4 }}>
      {Array.from({ length: primeiroDia }, (_, i) => <div key={`e${i}`} />)}
      {Array.from({ length: totalDias }, (_, i) => i + 1).map((d) => {
        const iso = isoDoDia(d);
        const dia = porData.get(iso);
        const estado = estadoDia(dia, hoje, iso);
        const cor = COR_ESTADO[estado];
        const sel = iso === selecionado;
        const desabilitado = estado === "passado";
        return <button key={d} disabled={desabilitado} onClick={() => onSelecionar(iso)} style={{
          height: 52, borderRadius: 9, border: `1px solid ${sel ? "var(--bg)" : cor.border}`,
          background: sel ? "var(--bg)" : cor.bg, color: sel ? "#FFFDFC" : "var(--ink)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
          opacity: desabilitado ? 0.4 : 1, cursor: desabilitado ? "default" : "pointer",
        }}>
          <span style={{ fontSize: 12, fontWeight: sel ? 800 : 500 }}>{d}</span>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: sel ? "#FFFDFC" : cor.dot }} />
          {dia && dia.vagasOcupadas > 0 && <span style={{ fontSize: 8, color: sel ? "#FFFDFC" : "var(--soft)" }}>{dia.vagasOcupadas}/{dia.vagasTotais}</span>}
        </button>;
      })}
    </div>
  </div>;
}
