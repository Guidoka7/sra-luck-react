import { useEffect, useState } from "react";
import { toast } from "sonner";
import { centralApi, dataBr } from "./api";
import { MonthCalendar, estadoDia } from "./MonthCalendar";
import type { AgendaTermosResponse } from "./types";
import { TermsRescheduleModal } from "./TermsRescheduleModal";

function hojeIso() { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`; }

export function TermsAgendaTab({ onAbrirCliente }: { onAbrirCliente: (clienteId: string) => void }) {
  const hoje = hojeIso();
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoje.slice(5, 7)));
  const [dados, setDados] = useState<AgendaTermosResponse | null>(null);
  const [selecionado, setSelecionado] = useState(hoje);
  const [reagendar, setReagendar] = useState<{ agendamentoId: string; nome: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    try { setDados(await centralApi.agendaTermos(ano, mes)); } catch (e: any) { toast.error(e.message); }
  }
  useEffect(() => { void carregar(); }, [ano, mes]);

  function mudarMes(delta: number) {
    let m = mes + delta, a = ano;
    if (m > 12) { m = 1; a++; } else if (m < 1) { m = 12; a--; }
    setMes(m); setAno(a);
  }

  async function liberar() {
    setSalvando(true);
    try { await centralApi.abrirBloquearTermos(selecionado, "liberar", 3); toast.success("Data liberada para termos."); await carregar(); }
    catch (e: any) { toast.error(e.message); } finally { setSalvando(false); }
  }
  async function bloquear() {
    setSalvando(true);
    try { await centralApi.abrirBloquearTermos(selecionado, "bloquear"); toast.success("Data bloqueada."); await carregar(); }
    catch (e: any) { toast.error(e.message); } finally { setSalvando(false); }
  }
  async function definirResponsavel(agendamentoId: string, atual: string | null) {
    const nome = window.prompt("Responsável administrativo pelo atendimento:", atual ?? "");
    if (!nome || !nome.trim()) return;
    try { await centralApi.definirResponsavelTermos(agendamentoId, nome.trim()); toast.success("Responsável definido."); await carregar(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function marcarAusencia(agendamentoId: string) {
    if (!window.confirm("Confirmar ausência? A vaga desta cliente será liberada e ela poderá escolher uma nova data no app.")) return;
    try { await centralApi.registrarComparecimento(agendamentoId, false); toast.success("Ausência registrada. Agenda de Termos reaberta para a cliente."); await carregar(); }
    catch (e: any) { toast.error(e.message); }
  }

  if (!dados) return <div style={{ padding: 24, textAlign: "center", color: "var(--soft)" }}>Carregando…</div>;

  const diaSel = dados.calendario.find((d) => d.data === selecionado);
  const estado = estadoDia(diaSel, hoje, selecionado);
  const assinaturasDoDia = dados.proximasAssinaturas.filter((a) => a.data === selecionado);

  return <div>
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16, fontSize: 10.5, color: "var(--soft)" }}>
      <span><b style={{ color: "var(--ink)" }}>{dados.proximasAssinaturas.length}</b> agendamentos no mês</span>
      <span><b style={{ color: "var(--ink)" }}>{dados.calendario.filter((d) => d.status === "disponivel").length}</b> datas abertas</span>
      <span style={{ marginLeft: "auto" }}>Assinatura de termos · agenda administrativa com vagas e horários visíveis no app</span>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(360px,1.2fr) minmax(300px,1fr)", gap: 16 }}>
      <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--panel)", padding: 14 }}>
        <MonthCalendar ano={ano} mes={mes} hoje={hoje} calendario={dados.calendario} selecionado={selecionado} onSelecionar={setSelecionado} onMudarMes={mudarMes} />
      </div>

      <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--panel)", padding: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{dataBr(selecionado)}</div>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button disabled={salvando} onClick={liberar} style={{ height: 32, borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--ok)", fontSize: 11.5, fontWeight: 700 }}>Liberar para termos</button>
          <button disabled={salvando} onClick={bloquear} style={{ height: 32, borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--bad)", fontSize: 11.5, fontWeight: 700 }}>Bloquear</button>
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--soft)" }}>
          {diaSel ? <>Vagas: <b style={{ color: "var(--ink)" }}>{Math.max(0, diaSel.vagasTotais - diaSel.vagasOcupadas)} de {diaSel.vagasTotais}</b> ({estado})</> : "Sem liberação para esta data."}
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Assinaturas do dia ({assinaturasDoDia.length})</div>
          {assinaturasDoDia.length === 0 && <div style={{ fontSize: 11, color: "var(--soft)" }}>Nenhum agendamento neste dia.</div>}
          {assinaturasDoDia.map((a) => <div key={a.agendamentoId} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line2)" }}>
            <button onClick={() => onAbrirCliente(a.clienteId)} style={{ textAlign: "left", background: "transparent", border: 0, cursor: "pointer" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700 }}>{a.horario} · {a.nome}</div>
              <div style={{ fontSize: 10, color: "var(--soft)" }}>{a.procedimento ?? "—"}{a.responsavel ? ` · ${a.responsavel}` : ""}</div>
            </button>
            {a.data === hoje && <button onClick={() => marcarAusencia(a.agendamentoId)} style={{ fontSize: 10, color: "var(--bad)", background: "transparent", border: 0, cursor: "pointer" }}>Não compareceu</button>}
          </div>)}
        </div>
      </div>
    </div>

    <div style={{ marginTop: 16, border: "1px solid var(--line)", borderRadius: 14, background: "var(--panel)", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Próximas assinaturas de termos</h3>
        <span style={{ fontSize: 10.5, color: "var(--soft)" }}>Fila operacional em ordem de atendimento.</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr>{["Data", "Horário", "Cliente", "CPF", "Procedimento", "Responsável", "Ações"].map((h) => <th key={h} style={{ textAlign: "left", fontSize: 9, textTransform: "uppercase", color: "var(--soft)", padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>{h}</th>)}</tr></thead>
          <tbody>
            {dados.proximasAssinaturas.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "var(--soft)", fontSize: 11 }}>Nenhuma assinatura futura.</td></tr>}
            {dados.proximasAssinaturas.map((a) => <tr key={a.agendamentoId}>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}><b>{dataBr(a.data)}</b></td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}>{a.horario}</td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}>{a.nome}</td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}>{a.cpf}</td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}>{a.procedimento}</td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}>{a.responsavel ?? <span style={{ color: "var(--soft)" }}>Não definido</span>}</td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => onAbrirCliente(a.clienteId)} style={{ background: "transparent", border: 0, color: "var(--bg)", fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}>Abrir cliente</button>
                  <button onClick={() => definirResponsavel(a.agendamentoId, a.responsavel)} style={{ background: "transparent", border: 0, color: "var(--bg)", fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}>{a.responsavel ? "Alterar" : "Definir"} responsável</button>
                  <button onClick={() => setReagendar({ agendamentoId: a.agendamentoId, nome: a.nome })} style={{ background: "transparent", border: 0, color: "var(--bg)", fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}>Reagendar</button>
                </div>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>

    {reagendar && <TermsRescheduleModal agendamentoId={reagendar.agendamentoId} nome={reagendar.nome} onClose={() => setReagendar(null)} onDone={() => { setReagendar(null); void carregar(); }} />}
  </div>;
}
