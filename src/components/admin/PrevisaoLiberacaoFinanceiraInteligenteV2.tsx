"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatarMoeda, nomeMes } from "@/lib/utils";
import { zipChip } from "@/components/admin-zip/zipUi";

type Estado = "verde" | "amarelo" | "vermelho" | "cinza" | "passado";
type AcaoData = "liberar" | "fechar" | null;
interface Dia { data: string; dia: number; estado: Estado; oracamentoAntes: number; oracamentoDepois: number; ultrapassagem: number; dentroOrcamento: boolean; ocupante: { nome: string; valor: number } | null }
interface Analise { orcamentoMensal: number; calendario: { dias: Dia[] }; melhorData: { data: string } | null }
interface Solicitacao { id: string; cliente_id: string; forma_custeio: string; saldo_restante: number; status: string; clientes?: { nome_completo: string } | null; data_termos: string | null; previsao_sugerida: string | null }
interface ClienteAgenda { agendamentoId: string; clienteId: string; nome: string; dataTermos: string | null; previsaoAtual: string | null; valor: number; valorPago: number; parcelasPagas: number; totalParcelas: number; custeioConfirmado: boolean; cirurgiaRealizada: boolean; statusFinanceiro: string | null; formaCusteio: string | null; saldoRestante: number | null }
interface DataLiberacao { id: string; data: string; status: string; vagasOcupadas: number; clientes: { nome: string; valor: number }[] }
interface Remarcacao { id: string; tipo: "termos" | "cirurgia"; data_solicitada: string | null; horario_termos: string | null; status: string; clientes?: { nome_completo: string } | null; created_at: string }
const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const curta = (x: string | null) => (x ? x.split("-").reverse().join("/") : "—");
const forma = (x: string | null) => (x === "cartao" ? "Cartão de crédito" : x === "pix" ? "PIX" : x === "boleto_100" ? "100% boleto" : x === "cheques" ? "Cheques" : "—");

function RemarcacoesZip({ tipo }: { tipo: "termos" | "cirurgia" }) {
  const [itens, setItens] = useState<Remarcacao[]>([]);
  const [processando, setProcessando] = useState<string | null>(null);
  async function carregar() { try { const r = await fetch("/api/admin/remarcacoes", { cache: "no-store" }); if (r.ok) { const j = await r.json(); setItens((j.solicitacoes ?? []).filter((x: Remarcacao) => x.tipo === tipo)); } } catch { /* real */ } }
  useEffect(() => { void carregar(); const t = setInterval(() => void carregar(), 5000); return () => clearInterval(t); }, [tipo]);
  async function analisar(id: string, acao: "aprovar" | "recusar") {
    setProcessando(id);
    try {
      const r = await fetch("/api/admin/remarcacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, acao }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return toast.error(j.erro ?? "Não foi possível concluir a análise.");
      toast.success(acao === "aprovar" ? "Remarcação autorizada." : "Remarcação recusada."); await carregar();
    } finally { setProcessando(null); }
  }
  if (!itens.length) return null;
  return <div style={{ borderTop: "1px solid var(--line)", padding: "13px 14px" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <div><div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--gold)" }}>Remarcações em análise</div><div style={{ marginTop: 3, fontSize: 11, color: "var(--soft)" }}>{tipo === "termos" ? "Solicitações da assinatura dos termos." : "Solicitações da data da cirurgia."}</div></div>
      <span style={zipChip("warn")}>{itens.length}</span>
    </div>
    <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 7 }}>
      {itens.map((item) => <div key={item.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, borderRadius: 10, border: "1px solid var(--gobg)", background: "var(--gobg)", padding: "8px 11px" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.clientes?.nome_completo ?? "Cliente"}</div>
          <div style={{ marginTop: 2, fontSize: 10.5, color: "var(--soft)" }}>Atual → {curta(item.data_solicitada)}{item.horario_termos ? ` às ${String(item.horario_termos).slice(0, 5)}` : ""}</div>
          <div style={{ fontSize: 9.5, color: "var(--soft)" }}>Aguardando análise administrativa</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button disabled={processando === item.id} onClick={() => void analisar(item.id, "recusar")} style={{ height: 28, padding: "0 10px", borderRadius: 8, border: "1px solid var(--badbg)", background: "var(--s0)", color: "var(--bad)", fontSize: 10.5, fontWeight: 700 }}>Recusar</button>
          <button disabled={processando === item.id} onClick={() => void analisar(item.id, "aprovar")} style={{ height: 28, padding: "0 10px", borderRadius: 8, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 10.5, fontWeight: 700 }}>Autorizar</button>
        </div>
      </div>)}
    </div>
  </div>;
}

export function PrevisaoLiberacaoFinanceiraInteligenteV2() {
  const hoje = hojeIso(), now = new Date();
  const [ano, setAno] = useState(now.getFullYear()), [mes, setMes] = useState(now.getMonth() + 1);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]), [clientes, setClientes] = useState<ClienteAgenda[]>([]), [datasLiberacao, setDatasLiberacao] = useState<DataLiberacao[]>([]), [analise, setAnalise] = useState<Analise | null>(null);
  const [selecionado, setSelecionado] = useState(""), [data, setData] = useState<string | null>(null), [acaoData, setAcaoData] = useState<AcaoData>(null), [busca, setBusca] = useState(""), [modalDia, setModalDia] = useState<string | null>(null), [salvando, setSalvando] = useState(false), [carregando, setCarregando] = useState(false);

  async function carregar() { const [a, b, c] = await Promise.all([fetch("/api/admin/solicitacoes-liberacao-financeira", { cache: "no-store" }), fetch("/api/admin/clientes-agendamentos", { cache: "no-store" }), fetch(`/api/admin/datas-liberacao-financeira?ano=${ano}&mes=${mes}`, { cache: "no-store" })]); if (a.ok) setSolicitacoes((await a.json()).solicitacoes ?? []); if (b.ok) setClientes((await b.json()).clientes ?? []); if (c.ok) setDatasLiberacao((await c.json()).datas ?? []); }
  async function calendario() { setCarregando(true); try { const q = new URLSearchParams({ ano: String(ano), mes: String(mes) }); if (selecionado) q.set("agendamento_id", selecionado); const r = await fetch(`/api/admin/liberacao-inteligente?${q}`, { cache: "no-store" }); if (r.ok) setAnalise(await r.json()); } finally { setCarregando(false); } }
  useEffect(() => { void carregar(); const t = window.setInterval(() => void carregar(), 5000); return () => clearInterval(t); }, [ano, mes]);
  useEffect(() => { void calendario(); }, [ano, mes, selecionado]);

  const q = busca.trim().toLocaleLowerCase("pt-BR");
  const previsoes = useMemo(() => solicitacoes.filter((s) => ["pendente", "em_analise", "aprovada"].includes(s.status) && (!q || (s.clientes?.nome_completo ?? "").toLocaleLowerCase("pt-BR").includes(q))), [solicitacoes, q]);
  const confirmadas = useMemo(() => clientes.filter((c) => { if (!c.previsaoAtual) return false; const mesmoMes = Number(c.previsaoAtual.slice(0, 4)) === ano && Number(c.previsaoAtual.slice(5, 7)) === mes; return mesmoMes && (!q || c.nome.toLocaleLowerCase("pt-BR").includes(q)); }).sort((a, b) => (a.previsaoAtual ?? "").localeCompare(b.previsaoAtual ?? "")), [clientes, ano, mes, q]);
  const confirmadasDoDia = useMemo(() => (modalDia ? clientes.filter((c) => c.previsaoAtual === modalDia).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) : []), [clientes, modalDia]);
  const selecionada = useMemo(() => clientes.find((c) => c.agendamentoId === selecionado) ?? null, [clientes, selecionado]);
  const dias = analise?.calendario.dias ?? [], orc = analise?.orcamentoMensal ?? 0, liberado = dias[0]?.oracamentoAntes ?? 0;
  const datasMap = useMemo(() => new Map(datasLiberacao.map((d) => [d.data, d])), [datasLiberacao]);
  const melhorMes = analise?.melhorData?.data ? curta(analise.melhorData.data) : "—";

  function mesDelta(n: number) { let m = mes + n, a = ano; if (m > 12) { m = 1; a++; } if (m < 1) { m = 12; a--; } setMes(m); setAno(a); setData(null); setAcaoData(null); setSelecionado(""); }
  function selecionarSolicitacao(s: Solicitacao) { const c = clientes.find((x) => x.clienteId === s.cliente_id); if (!c) return toast.error("Agendamento confirmado não encontrado para esta cliente."); setSelecionado(c.agendamentoId); setData(s.previsao_sugerida || c.previsaoAtual || null); const alvo = s.previsao_sugerida || c.previsaoAtual; if (alvo) { setMes(Number(alvo.slice(5, 7))); setAno(Number(alvo.slice(0, 4))); } }
  function selecionarConfirmada(c: ClienteAgenda) { if (!c.previsaoAtual) return; setModalDia(c.previsaoAtual); }
  function clicarDia(x: Dia) { if (x.estado === "passado") return; if (x.estado === "vermelho") { setModalDia(x.data); return; } if (!selecionado) { setData(x.data); setAcaoData(datasMap.has(x.data) ? "fechar" : "liberar"); return; } setData(x.data); if (!datasMap.has(x.data)) setAcaoData("liberar"); }
  async function confirmarCusteio(s: Solicitacao) { setSalvando(true); try { const r = await fetch("/api/admin/solicitacoes-liberacao-financeira", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, status: "aprovada" }) }); const j = await r.json().catch(() => ({})); if (!r.ok) return toast.error(j.erro ?? "Não foi possível confirmar o custeio."); toast.success("Forma de custeio confirmada. Agora escolha a data."); await carregar(); } finally { setSalvando(false); } }
  async function alternarLiberacaoData() { if (!data || !acaoData) return; setSalvando(true); try { const r = acaoData === "liberar" ? await fetch("/api/admin/datas-liberacao-financeira", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) }) : await fetch(`/api/admin/datas-liberacao-financeira?data=${encodeURIComponent(data)}`, { method: "DELETE" }); const j = await r.json().catch(() => ({})); if (!r.ok) return toast.error(j.erro ?? "Não foi possível atualizar a data."); toast.success(acaoData === "liberar" ? "Data liberada para previsão financeira." : "Data fechada para novas previsões."); setAcaoData(null); await Promise.all([carregar(), calendario()]); } finally { setSalvando(false); } }
  async function salvarPrevisao() { if (!selecionado || !data) return; if (!datasMap.has(data)) { setAcaoData("liberar"); return; } setSalvando(true); try { const r = await fetch(`/api/admin/agendamentos/${selecionado}/previsao`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ previsaoLiberacaoFinanceira: data }) }); const j = await r.json().catch(() => ({})); if (!r.ok) return toast.error(j.erro ?? "Não foi possível confirmar a previsão."); toast.success("Liberação financeira confirmada."); setSelecionado(""); setData(null); await Promise.all([carregar(), calendario()]); } finally { setSalvando(false); } }

  const diaSel = data ? dias.find((d) => d.data === data) : undefined;

  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      <div style={{ flex: "1 1 210px", border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 12, padding: "12px 13px" }}>
        <div style={{ fontSize: 10, color: "var(--soft)", fontWeight: 600 }}>Referência mensal</div>
        <div style={{ marginTop: 2, fontSize: 17, fontFamily: "Fraunces,Georgia,serif" }}>{formatarMoeda(orc)}</div>
        <div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Planejamento, não trava operacional.</div>
      </div>
      <div style={{ flex: "1 1 210px", border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 12, padding: "12px 13px" }}>
        <div style={{ fontSize: 10, color: "var(--soft)", fontWeight: 600 }}>Previsto em {nomeMes(mes)}</div>
        <div style={{ marginTop: 2, fontSize: 17, fontFamily: "Fraunces,Georgia,serif" }}>{formatarMoeda(liberado)}</div>
        <div style={{ marginTop: 3, fontSize: 10.5, color: liberado >= orc ? "var(--bad)" : "var(--soft)" }}>{liberado >= orc ? "Referência mensal atingida" : `${formatarMoeda(Math.max(0, orc - liberado))} disponível`}</div>
      </div>
      <div style={{ flex: "1 1 210px", border: "1px solid var(--gobg)", background: "var(--gobg)", borderRadius: 12, padding: "12px 13px" }}>
        <div style={{ fontSize: 10, color: "var(--soft)", fontWeight: 600 }}>Melhor período sugerido</div>
        <div style={{ marginTop: 2, fontSize: 17, fontFamily: "Fraunces,Georgia,serif" }}>{melhorMes}</div>
        <div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Menor comprometimento da referência mensal.</div>
      </div>
    </div>

    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", backdropFilter: "blur(18px)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><h2 style={{ fontSize: 15 }}>Calendário de liberação</h2><span style={{ fontSize: 11, color: "var(--soft)" }}>{nomeMes(mes)} {ano}{carregando ? " · atualizando…" : ""}</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 2, height: 34, padding: "0 4px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel)" }}>
          <button onClick={() => mesDelta(-1)} style={{ height: 26, width: 26, borderRadius: 8, border: 0, background: "transparent", color: "var(--soft)" }}>‹</button>
          <div style={{ minWidth: 90, textAlign: "center", fontSize: 12.5, fontWeight: 600 }}>{nomeMes(mes)} {ano}</div>
          <button onClick={() => mesDelta(1)} style={{ height: 26, width: 26, borderRadius: 8, border: 0, background: "transparent", color: "var(--soft)" }}>›</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px" }}>
        <div style={{ padding: "13px 14px", borderRight: "1px solid var(--line)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 5, marginBottom: 6 }}>{DIAS.map((w, i) => <div key={i} style={{ textAlign: "center", fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>{w}</div>)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 5 }}>
            {dias.map((x) => {
              const liberada = datasMap.has(x.data), sel = x.data === data, hj = x.data === hoje;
              const bg = x.estado === "vermelho" ? "var(--bg)" : sel ? "var(--robg)" : "var(--s0)";
              const col = x.estado === "vermelho" ? "#FFFDFC" : "var(--ink)";
              const dot = x.estado === "vermelho" ? "#FFFDFC" : x.estado === "amarelo" ? "var(--gold)" : liberada ? "var(--ok)" : x.estado === "passado" ? "transparent" : "var(--soft)";
              return <button key={x.data} disabled={x.estado === "passado"} onClick={() => clicarDia(x)} style={{ height: 48, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 10, border: `1px solid ${sel ? "var(--bg)" : hj ? "var(--gold)" : "var(--line2)"}`, background: bg, opacity: x.estado === "passado" ? 0.35 : 1, cursor: x.estado === "passado" ? "default" : "pointer" }}>
                <span style={{ fontSize: 12.5, fontWeight: sel ? 700 : 500, color: col }} className="zip-mono">{x.dia}</span>
                <span style={{ width: 5, height: 5, borderRadius: 999, background: dot, opacity: x.estado === "cinza" ? 0.4 : 1 }} />
                {x.estado === "vermelho" && x.ocupante && <span style={{ fontSize: 8, color: "#FFFDFC", maxWidth: "90%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.ocupante.nome.split(" ")[0]}</span>}
              </button>;
            })}
          </div>
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 12, fontSize: 10, color: "var(--soft)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ok)" }} />Liberada</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--gold)" }} />Acima do orçamento</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--bg)" }} />Ocupada</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--soft)", opacity: 0.4 }} />Sem dados</span>
          </div>
        </div>
        <div style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 11, background: "var(--s1)" }}>
          <div>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--rose)" }}>Dia selecionado</div>
            <div style={{ marginTop: 5, fontSize: 15, fontFamily: "Fraunces,Georgia,serif" }}>{data ? curta(data) : "—"}</div>
          </div>
          {diaSel && <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Antes</span><span style={{ fontWeight: 600 }}>{formatarMoeda(diaSel.oracamentoAntes)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Depois</span><span style={{ fontWeight: 600 }}>{formatarMoeda(diaSel.oracamentoDepois)}</span></div>
            {diaSel.ultrapassagem > 0 && <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--bad)" }}>Ultrapassagem</span><span style={{ fontWeight: 600, color: "var(--bad)" }}>{formatarMoeda(diaSel.ultrapassagem)}</span></div>}
          </div>}
          {selecionada && <div style={{ borderRadius: 10, border: "1px solid var(--gobg)", background: "var(--gobg)", padding: "8px 10px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--gold)" }}>Cliente selecionada</div>
            <div style={{ marginTop: 3, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selecionada.nome}</div>
            <button onClick={() => { setSelecionado(""); setData(null); }} style={{ marginTop: 6, height: 24, padding: "0 8px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 10 }}>Voltar</button>
          </div>}
          <div style={{ height: 1, background: "var(--line)" }} />
          {selecionado && data && datasMap.has(data) && <button disabled={salvando} onClick={() => void salvarPrevisao()} style={{ height: 32, borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 11.5, fontWeight: 600 }}>Confirmar previsão nesta data</button>}
        </div>
      </div>
      <RemarcacoesZip tipo="cirurgia" />
    </div>

    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 15 }}>Fluxo financeiro</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 7, height: 31, width: 240, maxWidth: "44vw", padding: "0 11px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)" }}>
          <span style={{ color: "var(--rose)", fontSize: 11.5 }}>⌕</span>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome..." style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", outline: "none", fontSize: 11.5, color: "var(--ink)" }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 0 }}>
        <div style={{ borderRight: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 14px", borderBottom: "1px solid var(--line)", background: "var(--s1)" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ok)" }}>Solicitações de previsão</span>
            <span style={zipChip("ok")}>{previsoes.length}</span>
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {previsoes.length === 0 ? <div style={{ padding: "26px 14px", textAlign: "center", fontSize: 11.5, color: "var(--soft)" }}>Nenhuma solicitação de previsão.</div> : previsoes.map((s) => {
              const c = clientes.find((x) => x.clienteId === s.cliente_id), sel = Boolean(selecionado && c?.agendamentoId === selecionado), aguardando = s.status !== "aprovada";
              return <div key={s.id} style={{ borderBottom: "1px solid var(--line2)", padding: "10px 14px", background: sel ? "var(--gobg)" : "transparent" }}>
                <button onClick={() => selecionarSolicitacao(s)} style={{ width: "100%", textAlign: "left", background: "transparent", border: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.clientes?.nome_completo ?? "Cliente"}</span><span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", color: aguardando ? "var(--gold)" : "var(--ok)" }}>{aguardando ? "Aguardando" : "Confirmado"}</span></div>
                  <div style={{ marginTop: 3, display: "flex", flexWrap: "wrap", gap: 8, fontSize: 10.5, color: "var(--soft)" }}><span>{forma(s.forma_custeio)}</span><strong style={{ color: "var(--ink)" }}>{formatarMoeda(Number(s.saldo_restante))}</strong><span>{s.data_termos ? `Termos ${curta(s.data_termos)}` : "Aguardando termos"}</span></div>
                </button>
                {aguardando && sel && <button disabled={salvando} onClick={() => void confirmarCusteio(s)} style={{ marginTop: 8, width: "100%", height: 28, borderRadius: 8, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 10.5, fontWeight: 700 }}>Confirmar forma de custeio</button>}
                {!aguardando && sel && <div style={{ marginTop: 8, borderRadius: 8, background: "var(--okbg)", color: "var(--ok)", fontSize: 10.5, fontWeight: 600, padding: "7px 9px" }}>Custeio confirmado. Escolha uma data no calendário.</div>}
              </div>;
            })}
          </div>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 14px", borderBottom: "1px solid var(--line)", background: "var(--s1)" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>Liberações confirmadas</span>
            <span style={zipChip("rose")}>{confirmadas.length}</span>
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {confirmadas.length === 0 ? <div style={{ padding: "26px 14px", textAlign: "center", fontSize: 11.5, color: "var(--soft)" }}>Nenhuma liberação confirmada neste mês.</div> : confirmadas.map((c) => <button key={c.agendamentoId} onClick={() => selecionarConfirmada(c)} style={{ width: "100%", textAlign: "left", borderBottom: "1px solid var(--line2)", padding: "10px 14px", background: "transparent", border: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.nome}</span><span style={{ fontSize: 12, fontWeight: 700, color: "var(--ok)" }} className="zip-mono">{curta(c.previsaoAtual)}</span></div>
              <div style={{ marginTop: 3, display: "flex", flexWrap: "wrap", gap: 8, fontSize: 10.5, color: "var(--soft)" }}><span>Termos {curta(c.dataTermos)}</span><span>{c.formaCusteio ? forma(c.formaCusteio) : "Custeio não informado"}</span><span>{formatarMoeda(c.saldoRestante ?? 0)} restante</span></div>
            </button>)}
          </div>
        </div>
      </div>
    </div>

    {acaoData && data && <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.55)", padding: 16 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setAcaoData(null); }}>
      <div className="zip-animate-pop-in" style={{ width: "100%", maxWidth: 360, border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", padding: 16 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--gold)" }}>Agenda financeira</div>
        <h2 style={{ marginTop: 4, fontSize: 15 }}>{acaoData === "liberar" ? "Liberar esta data?" : "Fechar esta data?"}</h2>
        <p style={{ marginTop: 3, fontSize: 12, color: "var(--soft)" }}>{curta(data)}</p>
        <p style={{ marginTop: 10, borderRadius: 10, background: "var(--s1)", padding: 10, fontSize: 11.5, color: "var(--soft)", lineHeight: 1.5 }}>{acaoData === "liberar" ? "Esta data ficará disponível para receber uma previsão financeira." : "Esta data deixará de aceitar novas previsões."}</p>
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button onClick={() => setAcaoData(null)} style={{ flex: 1, height: 34, borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 12, fontWeight: 600 }}>Cancelar</button>
          <button disabled={salvando} onClick={() => void alternarLiberacaoData()} style={{ flex: 1, height: 34, borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 12, fontWeight: 600 }}>{acaoData === "liberar" ? "Liberar" : "Fechar"}</button>
        </div>
      </div>
    </div>}

    {modalDia && <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.55)", padding: 12 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setModalDia(null); }}>
      <div className="zip-animate-pop-in" style={{ width: "100%", maxWidth: 460, border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", overflow: "hidden" }}>
        <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)", background: "var(--gobg)" }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--rose)" }}>Liberação confirmada</div>
          <h2 style={{ marginTop: 3, fontSize: 15 }}>Clientes agendadas para {curta(modalDia)}</h2>
          <p style={{ marginTop: 2, fontSize: 11.5, color: "var(--soft)" }}>{confirmadasDoDia.length} {confirmadasDoDia.length === 1 ? "cliente confirmada" : "clientes confirmadas"} nesta data.</p>
        </div>
        <div style={{ maxHeight: "60vh", overflowY: "auto", padding: 12 }}>
          {confirmadasDoDia.length === 0 ? <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Nenhuma cliente confirmada nesta data.</div> : confirmadasDoDia.map((c) => <div key={c.agendamentoId} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 11, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ fontSize: 13, fontWeight: 700 }}>{c.nome}</span><span style={zipChip("ok")}>Confirmada</span></div>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 7 }}>
              <div style={{ borderRadius: 8, background: "var(--s1)", padding: 8 }}><div style={{ fontSize: 9, color: "var(--soft)", fontWeight: 700, textTransform: "uppercase" }}>Termos</div><div style={{ marginTop: 3, fontSize: 11.5, fontWeight: 600 }}>{curta(c.dataTermos)}</div></div>
              <div style={{ borderRadius: 8, background: "var(--s1)", padding: 8 }}><div style={{ fontSize: 9, color: "var(--soft)", fontWeight: 700, textTransform: "uppercase" }}>Carta de crédito</div><div style={{ marginTop: 3, fontSize: 11.5, fontWeight: 600 }}>{formatarMoeda(c.valor)}</div></div>
              <div style={{ borderRadius: 8, background: "var(--okbg)", padding: 8 }}><div style={{ fontSize: 9, color: "var(--soft)", fontWeight: 700, textTransform: "uppercase" }}>Já pago</div><div style={{ marginTop: 3, fontSize: 11.5, fontWeight: 600, color: "var(--ok)" }}>{formatarMoeda(c.valorPago)}</div><div style={{ fontSize: 9, color: "var(--soft)" }}>{c.parcelasPagas}{c.totalParcelas ? ` de ${c.totalParcelas}` : ""} parcelas</div></div>
              <div style={{ borderRadius: 8, background: "var(--gobg)", padding: 8 }}><div style={{ fontSize: 9, color: "var(--soft)", fontWeight: 700, textTransform: "uppercase" }}>Valor restante</div><div style={{ marginTop: 3, fontSize: 11.5, fontWeight: 700 }}>{formatarMoeda(c.saldoRestante ?? Math.max(0, c.valor - c.valorPago))}</div></div>
            </div>
          </div>)}
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: 12 }}><button onClick={() => setModalDia(null)} style={{ width: "100%", height: 34, borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 12, fontWeight: 600 }}>Fechar</button></div>
      </div>
    </div>}
  </div>;
}
