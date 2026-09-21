import { useEffect, useMemo, useState } from "react";
import { centralApi, dataBr, moeda } from "./api";
import type { CartaoCliente, EstagioCentral, VisaoGeralResponse } from "./types";

const LANES: { id: EstagioCentral; titulo: string; desc: string; cor: string }[] = [
  { id: "preEligibility", titulo: "Elegibilidade e solicitação", desc: "Quem está próxima do percentual mínimo e quem já pode solicitar a liberação financeira pelo app.", cor: "#8b3141" },
  { id: "financialReview", titulo: "Levantamentos", desc: "Já solicitaram a liberação financeira e estão em análise.", cor: "#a97927" },
  { id: "termsConfirmed", titulo: "Agendamentos confirmados", desc: "Assinatura dos termos agendada, ordenada pela data mais próxima.", cor: "#397b60" },
  { id: "financialRelease", titulo: "Liberações financeiras", desc: "No dia dos termos: conferir comparecimento e quitação. Depois, acompanhar o prazo de 5 dias úteis.", cor: "#b56f2a" },
  { id: "surgeryConfirmed", titulo: "Cirurgias confirmadas", desc: "Aguardando confirmação do pagamento da cirurgia.", cor: "#246b50" },
];

function laneMeta(estagio: EstagioCentral, c: CartaoCliente): { texto: string; tom: "ok" | "warn" | "bad" | "info" } {
  if (estagio === "preEligibility") {
    return c.parcelasFaltantes === 0
      ? { texto: "Elegível · aguardando solicitação no app", tom: "ok" }
      : { texto: `Falta${c.parcelasFaltantes === 1 ? "" : "m"} ${c.parcelasFaltantes} parcela${c.parcelasFaltantes === 1 ? "" : "s"}`, tom: "bad" };
  }
  if (estagio === "financialReview") return { texto: `${c.parcelasPagas}/${c.totalParcelas} parcelas pagas`, tom: "info" };
  if (estagio === "termsConfirmed") {
    return { texto: `${dataBr(c.dataTermos)} ${c.horarioTermos ?? ""}`, tom: "ok" };
  }
  if (estagio === "financialRelease") {
    const compareceu = c.comparecimentoStatus === "compareceu";
    const quitada = c.quitacaoStatus === "paga";
    if (!c.previsaoConfirmadaEm) return { texto: "Confirmar previsão cirúrgica", tom: "warn" };
    if (compareceu && quitada) {
      return c.agendaCirurgicaLiberadaEm ? { texto: "Agenda cirúrgica liberada", tom: "ok" } : { texto: `Prazo até ${dataBr(c.prazoCirurgico)}`, tom: "warn" };
    }
    if (compareceu) return { texto: "Compareceu · falta quitação", tom: "info" };
    if (quitada) return { texto: "Quitação confirmada · falta presença", tom: "info" };
    return { texto: "Hoje · conferir atendimento", tom: "warn" };
  }
  return { texto: `Cirurgia em ${dataBr(c.dataCirurgia)}`, tom: "ok" };
}

const TOM_COR: Record<string, string> = { ok: "#0d754a", warn: "#915e0d", bad: "#ad2d40", info: "#7a2632" };
const TOM_BG: Record<string, string> = { ok: "#e5f5ec", warn: "#fff1db", bad: "#fde8ec", info: "#f5e7e9" };

export function OverviewBoard({ onAbrirCliente }: { onAbrirCliente: (clienteId: string, estagio: EstagioCentral) => void }) {
  const [dados, setDados] = useState<VisaoGeralResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  async function carregar() {
    try { setDados(await centralApi.visaoGeral()); setErro(null); } catch (e: any) { setErro(e.message); }
  }
  useEffect(() => { void carregar(); }, []);

  const filas = useMemo(() => {
    if (!dados) return null;
    const q = busca.trim().toLowerCase();
    const filtra = (lista: CartaoCliente[]) => !q ? lista : lista.filter((c) => `${c.nome} ${c.cpf ?? ""}`.toLowerCase().includes(q));
    return { preEligibility: filtra(dados.filas.preEligibility), financialReview: filtra(dados.filas.financialReview), termsConfirmed: filtra(dados.filas.termsConfirmed), financialRelease: filtra(dados.filas.financialRelease), surgeryConfirmed: filtra(dados.filas.surgeryConfirmed) };
  }, [dados, busca]);

  if (erro) return <div style={{ padding: 24, textAlign: "center", color: "var(--bad)" }}>{erro}</div>;
  if (!dados || !filas) return <div style={{ padding: 24, textAlign: "center", color: "var(--soft)" }}>Carregando…</div>;

  return <div>
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou CPF…" style={{ height: 36, minWidth: 260, borderRadius: 9, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)", padding: "0 12px", fontSize: 12.5 }} />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 14, overflowX: "auto" }}>
      {LANES.map((lane) => {
        const lista = filas[lane.id];
        return <section key={lane.id} style={{ borderTop: `3px solid ${lane.cor}`, paddingTop: 10, minWidth: 220 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, paddingBottom: 7, borderBottom: `1px solid ${lane.cor}33` }}>
            <span style={{ fontSize: 12, fontWeight: 850, color: lane.cor }}>{lane.titulo}</span>
            <span style={{ minWidth: 24, height: 22, padding: "0 7px", borderRadius: 999, background: lane.cor, color: "#fff", fontSize: 11, fontWeight: 900, display: "grid", placeItems: "center" }}>{lista.length}</span>
          </div>
          <p style={{ fontSize: 9.5, color: "var(--soft)", minHeight: 40, margin: "7px 0 9px" }}>{lane.desc}</p>
          <div style={{ display: "grid", gap: 8 }}>
            {lista.length === 0 && <div style={{ border: "1px dashed var(--line)", borderRadius: 11, padding: 16, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Nenhuma cliente neste filtro.</div>}
            {lista.map((c) => {
              const meta = laneMeta(lane.id, c);
              return <button key={c.id} onClick={() => onAbrirCliente(c.id, lane.id)} style={{ textAlign: "left", border: "1px solid var(--line)", borderLeft: `3px solid ${lane.cor}`, background: "var(--panel)", borderRadius: 11, padding: 10, cursor: "pointer" }}>
                <div style={{ fontWeight: 800, fontSize: 12, color: "var(--ink)" }}>{c.nome}</div>
                <div style={{ fontSize: 10, color: "var(--soft)", marginTop: 2 }}>{c.procedimento ?? "—"}</div>
                <div style={{ marginTop: 8 }}><span style={{ display: "inline-flex", borderRadius: 999, padding: "4px 8px", fontSize: 9.5, fontWeight: 750, background: TOM_BG[meta.tom], color: TOM_COR[meta.tom] }}>{meta.texto}</span></div>
                {lane.id === "surgeryConfirmed" && <div style={{ marginTop: 6, fontSize: 10, color: "var(--soft)" }}>Carta de crédito: <b style={{ color: "var(--ink)" }}>{moeda(c.cartaDeCredito)}</b></div>}
              </button>;
            })}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
