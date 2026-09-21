import { useEffect, useState } from "react";
import { toast } from "sonner";
import { centralApi, dataBr, moeda } from "./api";
import { MonthCalendar, estadoDia } from "./MonthCalendar";
import type { AgendaCirurgiaResponse } from "./types";

function hojeIso() { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`; }

export function SurgeryAgendaTab({ onAbrirCliente, onConsultarProcesso }: { onAbrirCliente: (clienteId: string) => void; onConsultarProcesso: (clienteId: string) => void }) {
  const hoje = hojeIso();
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoje.slice(5, 7)));
  const [dados, setDados] = useState<AgendaCirurgiaResponse | null>(null);
  const [selecionado, setSelecionado] = useState(hoje);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    try { setDados(await centralApi.agendaCirurgia(ano, mes)); } catch (e: any) { toast.error(e.message); }
  }
  useEffect(() => { void carregar(); }, [ano, mes]);

  function mudarMes(delta: number) {
    let m = mes + delta, a = ano;
    if (m > 12) { m = 1; a++; } else if (m < 1) { m = 12; a--; }
    setMes(m); setAno(a);
  }

  async function abrir() {
    setSalvando(true);
    try { await centralApi.abrirBloquearCirurgia(selecionado, "liberar", 1); toast.success("Data cirúrgica aberta."); await carregar(); }
    catch (e: any) { toast.error(e.message); } finally { setSalvando(false); }
  }
  async function bloquear() {
    setSalvando(true);
    try { await centralApi.abrirBloquearCirurgia(selecionado, "bloquear"); toast.success("Data bloqueada."); await carregar(); }
    catch (e: any) { toast.error(e.message); } finally { setSalvando(false); }
  }
  async function confirmarPagamento(agendamentoId: string) {
    if (!window.confirm("Confirmar pagamento da cirurgia? O processo será concluído e sairá das filas operacionais.")) return;
    try { await centralApi.confirmarPagamentoCirurgia(agendamentoId); toast.success("Pagamento confirmado. Processo concluído."); await carregar(); }
    catch (e: any) { toast.error(e.message); }
  }

  if (!dados) return <div style={{ padding: 24, textAlign: "center", color: "var(--soft)" }}>Carregando…</div>;

  const diaSel = dados.calendario.find((d) => d.data === selecionado);
  const estado = estadoDia(diaSel, hoje, selecionado);
  const disponivelTeto = Math.max(0, dados.tetoMensal - dados.comprometidoMensal);

  return <div>
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16, fontSize: 10.5, color: "var(--soft)" }}>
      <span><b style={{ color: "var(--ink)" }}>{dados.mapaCirurgico.filter((c) => !c.processoConcluido).length}</b> aguardando pagamento</span>
      <span><b style={{ color: "var(--ink)" }}>{dados.mapaCirurgico.filter((c) => c.processoConcluido).length}</b> processos concluídos</span>
      <span style={{ marginLeft: "auto" }}>Novas escolhas também respeitam o teto financeiro mensal de {moeda(dados.tetoMensal)}</span>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(360px,1.2fr) minmax(300px,1fr)", gap: 16 }}>
      <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--panel)", padding: 14 }}>
        <MonthCalendar ano={ano} mes={mes} hoje={hoje} calendario={dados.calendario} selecionado={selecionado} onSelecionar={setSelecionado} onMudarMes={mudarMes} />
      </div>

      <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--panel)", padding: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{dataBr(selecionado)}</div>

        <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 10, padding: 10, background: "var(--s1, var(--s0))" }}>
          <div style={{ fontSize: 9.5, color: "var(--soft)" }}>Teto financeiro do mês</div>
          <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>{moeda(dados.comprometidoMensal)} <span style={{ fontSize: 10, fontWeight: 500, color: "var(--soft)" }}>de {moeda(dados.tetoMensal)}</span></div>
          <div style={{ fontSize: 10, color: "var(--soft)", marginTop: 4 }}>{disponivelTeto > 0 ? <>Ainda há <b style={{ color: "var(--ink)" }}>{moeda(disponivelTeto)}</b> disponíveis este mês.</> : "O teto mensal foi atingido. Novas escolhas deste mês ficam bloqueadas."}</div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button disabled={salvando} onClick={abrir} style={{ height: 32, borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--ok)", fontSize: 11.5, fontWeight: 700 }}>Abrir data cirúrgica</button>
          <button disabled={salvando} onClick={bloquear} style={{ height: 32, borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--bad)", fontSize: 11.5, fontWeight: 700 }}>Bloquear</button>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: "var(--soft)" }}>
          {diaSel ? <>Capacidade: <b style={{ color: "var(--ink)" }}>{Math.max(0, diaSel.vagasTotais - diaSel.vagasOcupadas)} de {diaSel.vagasTotais}</b> ({estado})</> : "Sem liberação para esta data."}
        </div>
      </div>
    </div>

    <div style={{ marginTop: 16, border: "1px solid var(--line)", borderRadius: 14, background: "var(--panel)", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Mapa cirúrgico do mês</h3>
        <span style={{ fontSize: 10.5, color: "var(--soft)" }}>Processos concluídos permanecem arquivados no mês e na data escolhida.</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
          <thead><tr>{["Data", "Cliente", "Procedimento", "Carta de crédito", "Parcelamento", "Status", "Ações"].map((h) => <th key={h} style={{ textAlign: "left", fontSize: 9, textTransform: "uppercase", color: "var(--soft)", padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>{h}</th>)}</tr></thead>
          <tbody>
            {dados.mapaCirurgico.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "var(--soft)", fontSize: 11 }}>Nenhuma cirurgia no mês selecionado.</td></tr>}
            {dados.mapaCirurgico.map((c) => <tr key={c.agendamentoId}>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}><b>{dataBr(c.data)}</b></td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}>{c.nome}</td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}>{c.procedimento}</td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)", fontWeight: 700 }}>{moeda(c.cartaDeCredito)}</td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}>{c.quitada ? <span style={{ color: "var(--ok)", fontWeight: 700 }}>Quitada</span> : "—"}</td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}>
                <span style={{ borderRadius: 999, padding: "3px 8px", fontSize: 9.5, fontWeight: 700, background: c.processoConcluido ? "#e5f5ec" : "#fff1db", color: c.processoConcluido ? "#0d754a" : "#915e0d" }}>{c.processoConcluido ? "Processo concluído" : "Aguardando pagamento"}</span>
              </td>
              <td style={{ padding: "8px 10px", fontSize: 11, borderBottom: "1px solid var(--line2)" }}>
                {c.processoConcluido
                  ? <button onClick={() => onConsultarProcesso(c.clienteId)} style={{ background: "transparent", border: 0, color: "var(--bg)", fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}>Consultar processo</button>
                  : <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => onAbrirCliente(c.clienteId)} style={{ background: "transparent", border: 0, color: "var(--bg)", fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}>Abrir cliente</button>
                      <button onClick={() => confirmarPagamento(c.agendamentoId)} style={{ background: "transparent", border: 0, color: "var(--bg)", fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}>Confirmar pagamento</button>
                    </div>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  </div>;
}
