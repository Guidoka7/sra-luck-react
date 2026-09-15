"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { RevisaoFinanceiraCard } from "@/components/admin/RevisaoFinanceiraCard";
import { PrevisaoLiberacaoFinanceiraInteligente } from "@/components/admin/PrevisaoLiberacaoFinanceiraInteligente";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import { nomeMes } from "@/lib/utils";
import { zipChip } from "@/components/admin-zip/zipUi";
import type { DataAgenda } from "@/types/database";

/**
 * Reprodução fiel de Admin Agenda.dc.html: 3 fluxos reais (Termos
 * cirúrgicos, Liberação financeira, Cirurgias confirmadas), calendário de
 * vagas, pendências de meses anteriores e listas reais. "Liberação
 * financeira" e "Solicitações" reaproveitam os paineis reais já existentes
 * (PrevisaoLiberacaoFinanceiraInteligenteV2 / RevisaoFinanceiraCard) — a
 * lógica de negócio (orçamento, custeio, janela de 90 dias) não foi
 * reescrita, apenas encapsulada no novo shell do ZIP.
 */

type AbaAgenda = "termos" | "liberacao" | "cirurgias";
type SubTermos = "sol" | "conf";
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

function formatarDataCurta(iso: string) { return iso.split("-").reverse().join("/"); }
function diasAte(iso: string, hoje: string) { const [ay, am, ad] = iso.split("-").map(Number); const [hy, hm, hd] = hoje.split("-").map(Number); return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(hy, hm - 1, hd)) / 86400000); }
function textoContagem(dias: number) { if (dias < 0) return "Realizado"; if (dias === 0) return "Hoje"; if (dias === 1) return "1 dia"; return `${dias} dias`; }

export default function AgendaAdminPage() { return <Suspense fallback={null}><AgendaAdminConteudo /></Suspense>; }

function AgendaAdminConteudo() {
  const searchParams = useSearchParams();
  const abaParam = searchParams.get("aba");
  const abaInicial: AbaAgenda = abaParam === "liberacao" ? "liberacao" : abaParam === "cirurgias" ? "cirurgias" : "termos";
  const hoje = new Date();
  const isoHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

  const [aba, setAba] = useState<AbaAgenda>(abaInicial);
  const [sub, setSub] = useState<SubTermos>("sol");

  const subtitulo = aba === "liberacao"
    ? "Acompanhe clientes com termos concluídos e organize a liberação da agenda cirúrgica dentro da janela operacional."
    : aba === "cirurgias"
      ? "Cirurgias com data escolhida, contagem regressiva e confirmação no dia do procedimento."
      : "Solicitações, levantamento financeiro e assinatura dos termos cirúrgicos em um único espaço.";

  const tabs: { id: AbaAgenda; label: string }[] = [
    { id: "termos", label: "Termos cirúrgicos" },
    { id: "liberacao", label: "Liberação financeira" },
    { id: "cirurgias", label: "Cirurgias confirmadas" },
  ];

  return <div className="zip-admin">
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "2px 2px 14px" }}>
      <div><h1 style={{ fontSize: 27 }}>Agenda</h1><p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--soft)", maxWidth: "60ch" }}>{subtitulo}</p></div>
    </div>

    <div style={{ display: "flex", gap: 5, padding: 3, borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", width: "fit-content", maxWidth: "100%", overflow: "auto", marginBottom: 12 }}>
      {tabs.map((t) => {
        const on = aba === t.id;
        return <button key={t.id} onClick={() => setAba(t.id)} style={{ display: "flex", alignItems: "center", gap: 7, height: 31, padding: "0 13px", borderRadius: 9, border: on ? "1px solid var(--line)" : "1px solid transparent", background: on ? "var(--s0)" : "transparent", color: on ? "var(--ink)" : "var(--soft)", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>{t.label}</button>;
      })}
    </div>

    <PendenciasBanner />

    {aba === "termos" && <>
      <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 11, border: "1px solid var(--line)", background: "var(--panel)", width: "fit-content", maxWidth: "100%", marginBottom: 12 }}>
        <button onClick={() => setSub("sol")} style={{ display: "flex", alignItems: "center", gap: 7, height: 28, padding: "0 12px", borderRadius: 8, border: sub === "sol" ? "1px solid var(--line)" : "1px solid transparent", background: sub === "sol" ? "var(--s0)" : "transparent", color: sub === "sol" ? "var(--ink)" : "var(--soft)", fontSize: 11.5, fontWeight: 600 }}>Solicitações</button>
        <button onClick={() => setSub("conf")} style={{ display: "flex", alignItems: "center", gap: 7, height: 28, padding: "0 12px", borderRadius: 8, border: sub === "conf" ? "1px solid var(--line)" : "1px solid transparent", background: sub === "conf" ? "var(--s0)" : "transparent", color: sub === "conf" ? "var(--ink)" : "var(--soft)", fontSize: 11.5, fontWeight: 600 }}>Agendamentos confirmados</button>
      </div>
      <CalendarioTermos />
      <div style={{ marginTop: 14 }}>{sub === "sol" ? <RevisaoFinanceiraCard /> : <AgendamentosConfirmados />}</div>
    </>}

    {aba === "liberacao" && <div style={{ marginTop: 2 }}><PrevisaoLiberacaoFinanceiraInteligente /></div>}

    {aba === "cirurgias" && <CirurgiasConfirmadas />}
  </div>;
}

function PendenciasBanner() {
  const [itens, setItens] = useState<{ id: string; nome: string; motivo: string; quando: string }[]>([]);
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    let ativo = true;
    fetch("/api/admin/remarcacoes", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (!ativo) return;
      const lista = (d.solicitacoes ?? []).map((s: any) => ({ id: s.id, nome: s.clientes?.nome_completo ?? "Cliente", motivo: s.tipo === "termos" ? "Remarcação de termos solicitada" : "Remarcação de cirurgia solicitada", quando: s.data_solicitada ? formatarDataCurta(s.data_solicitada) : "—" }));
      setItens(lista);
    }).catch(() => {});
    return () => { ativo = false; };
  }, []);
  if (itens.length === 0) return null;
  return <div style={{ marginBottom: 12 }}>
    <button onClick={() => setAberto((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, height: 31, padding: "0 12px", borderRadius: 9, border: "1px solid var(--gobg)", background: "var(--gobg)", color: "var(--ink)", fontSize: 11.5, fontWeight: 600 }}>
      <span style={{ color: "var(--gold)" }}>⚠</span>{itens.length} pendência(s) em análise<span style={{ fontSize: 9, color: "var(--soft)" }}>▾</span>
    </button>
    {aberto && <div className="zip-animate-pop-in" style={{ marginTop: 8, border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "9px 13px", borderBottom: "1px solid var(--line)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>Pendências de remarcação</div>
      {itens.map((p) => <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 13px", borderBottom: "1px solid var(--line2)" }}>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 600 }}>{p.nome}</div><div style={{ fontSize: 11, color: "var(--soft)" }}>{p.motivo}</div></div>
        <span style={{ fontSize: 11, color: "var(--soft)", whiteSpace: "nowrap" }} className="zip-mono">{p.quando}</span>
      </div>)}
    </div>}
  </div>;
}

function CalendarioTermos() {
  type DataComOcupacao = DataAgenda & { vagasOcupadas: number };
  const hoje = new Date();
  const isoHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [datas, setDatas] = useState<DataComOcupacao[]>([]);
  const [diaSel, setDiaSel] = useState<number | null>(hoje.getDate());
  const [vagasInput, setVagasInput] = useState(1);
  const [salvando, setSalvando] = useState(false);

  async function carregar() { const r = await fetch(`/api/admin/datas?ano=${ano}&mes=${mes}`, { cache: "no-store" }); const d = await r.json(); setDatas(d.datas ?? []); }
  useEffect(() => { void carregar(); }, [ano, mes]);
  useEffect(() => { const supabase = createClientSupabaseClient(); const canal = supabase.channel("agenda-clientes-admin-zip").on("broadcast", { event: "datas_atualizadas" }, () => void carregar()).subscribe(); return () => { supabase.removeChannel(canal); }; }, [ano, mes]);

  const datasPorDia = useMemo(() => new Map(datas.map((d) => [Number(d.data.slice(8, 10)), d])), [datas]);
  const totalDias = new Date(ano, mes, 0).getDate();
  const primeiroDia = new Date(ano, mes - 1, 1).getDay();
  const isoDoDia = (d: number) => `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  function mudarMes(delta: number) { let m = mes + delta, a = ano; if (m > 12) { m = 1; a++; } if (m < 1) { m = 12; a--; } setMes(m); setAno(a); setDiaSel(null); }

  const infoSel = diaSel ? datasPorDia.get(diaSel) : undefined;
  const isoSel = diaSel ? isoDoDia(diaSel) : null;
  const passado = isoSel ? isoSel < isoHoje : false;
  const statusSel = !infoSel ? "unset" : infoSel.status === "bloqueado" ? "off" : infoSel.vagasOcupadas >= infoSel.vagas_totais ? "full" : "open";

  async function liberarDia() {
    if (!isoSel) return;
    setSalvando(true);
    try {
      const r = await fetch("/api/admin/datas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: isoSel, vagasTotais: vagasInput || 1 }) });
      const d = await r.json();
      if (!r.ok) return toast.error(d.erro ?? "Não foi possível liberar essa data.");
      toast.success("Data liberada."); await carregar();
    } finally { setSalvando(false); }
  }
  async function fecharDia() {
    if (!infoSel) return;
    setSalvando(true);
    try {
      const r = await fetch(`/api/admin/datas/${infoSel.id}`, { method: "DELETE" });
      if (!r.ok) return toast.error("Não foi possível remover a liberação.");
      toast.success("Liberação removida."); await carregar();
    } finally { setSalvando(false); }
  }

  return <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", backdropFilter: "blur(18px)", overflow: "hidden", marginBottom: 14 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><h2 style={{ fontSize: 15 }}>Calendário dos termos</h2><span style={{ fontSize: 11, color: "var(--soft)" }}>{nomeMes(mes)} {ano}</span></div>
      <div style={{ display: "flex", alignItems: "center", gap: 2, height: 34, padding: "0 4px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel)" }}>
        <button onClick={() => mudarMes(-1)} style={{ height: 26, width: 26, borderRadius: 8, border: 0, background: "transparent", color: "var(--soft)" }}>‹</button>
        <div style={{ minWidth: 90, textAlign: "center", fontSize: 12.5, fontWeight: 600 }}>{nomeMes(mes)} {ano}</div>
        <button onClick={() => mudarMes(1)} style={{ height: 26, width: 26, borderRadius: 8, border: 0, background: "transparent", color: "var(--soft)" }}>›</button>
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px" }}>
      <div style={{ padding: "13px 14px", borderRight: "1px solid var(--line)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 5, marginBottom: 6 }}>{DIAS_SEMANA.map((w, i) => <div key={i} style={{ textAlign: "center", fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>{w}</div>)}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 5 }}>
          {Array.from({ length: primeiroDia }, (_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: totalDias }, (_, i) => i + 1).map((d) => {
            const info = datasPorDia.get(d);
            const iso = isoDoDia(d);
            const isPast = iso < isoHoje;
            const status = isPast ? "past" : !info ? "unset" : info.status === "bloqueado" ? "off" : info.vagasOcupadas >= info.vagas_totais ? "full" : "open";
            const dot = status === "open" ? "var(--ok)" : status === "full" ? "var(--bad)" : "var(--soft)";
            const sel = d === diaSel;
            return <button key={d} disabled={isPast} onClick={() => { setDiaSel(d); setVagasInput(info?.vagas_totais ?? 1); }} style={{ height: 48, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 10, border: `1px solid ${sel ? "var(--bg)" : "var(--line2)"}`, background: sel ? "var(--robg)" : "var(--s0)", opacity: isPast ? 0.35 : 1, cursor: isPast ? "default" : "pointer" }}>
              <span style={{ fontSize: 12.5, fontWeight: sel ? 700 : 500 }} className="zip-mono">{d}</span>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: dot, opacity: status === "off" || status === "unset" ? 0.4 : 1 }} />
              {info && info.vagasOcupadas > 0 && <span style={{ fontSize: 9, color: "var(--soft)" }}>{info.vagasOcupadas}/{info.vagas_totais}</span>}
            </button>;
          })}
        </div>
      </div>
      <div style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 11, background: "var(--s1)" }}>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--rose)" }}>Dia selecionado</div>
          <div style={{ marginTop: 5, fontSize: 15, fontFamily: "Fraunces,Georgia,serif" }}>{diaSel ? isoDoDia(diaSel).split("-").reverse().join("/") : "—"}</div>
          <div style={{ marginTop: 6 }}><span style={zipChip(statusSel === "open" ? "ok" : statusSel === "full" ? "bad" : "neutral")}>● {statusSel === "open" ? "Disponível" : statusSel === "full" ? "Lotada" : statusSel === "off" ? "Bloqueada" : "Sem liberação"}</span></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>Vagas</span><span style={{ fontWeight: 600 }}>{infoSel ? `${infoSel.vagasOcupadas} de ${infoSel.vagas_totais}` : "—"}</span></div>
        </div>
        <div style={{ height: 1, background: "var(--line)" }} />
        <div style={{ marginTop: "auto", display: "flex", gap: 7 }}>
          {!infoSel && !passado && <button disabled={salvando} onClick={liberarDia} style={{ flex: 1, height: 32, borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 11.5, fontWeight: 600 }}>Liberar data</button>}
          {infoSel && <button disabled={salvando} onClick={fecharDia} style={{ flex: 1, height: 32, borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--bad)", fontSize: 11.5, fontWeight: 600 }}>Fechar data</button>}
        </div>
      </div>
    </div>
  </div>;
}

function AgendamentosConfirmados() {
  interface Item { id: string; nome: string; data: string; horario: string | null; podeConfirmarAssinatura: boolean; ehHoje: boolean; }
  const [itens, setItens] = useState<Item[]>([]);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  async function carregar() { try { const r = await fetch("/api/admin/agendamentos-termos", { cache: "no-store" }); const d = await r.json(); if (r.ok) setItens(d.agendamentos ?? []); } catch { /* real */ } }
  useEffect(() => { void carregar(); const t = setInterval(() => void carregar(), 30000); return () => clearInterval(t); }, []);
  async function confirmar(id: string) {
    setConfirmando(id);
    try {
      const r = await fetch("/api/admin/agendamentos-termos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const d = await r.json();
      if (!r.ok) return toast.error(d.erro ?? "Não foi possível confirmar a assinatura.");
      toast.success("Assinatura dos termos confirmada."); await carregar();
    } finally { setConfirmando(null); }
  }
  return <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", overflow: "hidden" }}>
    <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}><h2 style={{ fontSize: 15 }}>Agendamentos confirmados</h2><span style={{ fontSize: 11, color: "var(--soft)" }}>{itens.length} clientes</span></div>
    {itens.length === 0 ? <div style={{ padding: "48px 20px", textAlign: "center" }}><div style={{ fontSize: 13, fontWeight: 600 }}>Nada nesta fila</div></div> : itens.map((c) => <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--line2)" }}>
      <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.nome}</div><div style={{ fontSize: 11, color: "var(--soft)" }} className="zip-mono">{formatarDataCurta(c.data)}{c.horario ? ` · ${c.horario}` : ""}</div></div>
      {c.podeConfirmarAssinatura ? <button disabled={confirmando === c.id} onClick={() => confirmar(c.id)} style={{ height: 30, padding: "0 12px", borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 11.5, fontWeight: 600 }}>Confirmar assinatura</button> : <span style={zipChip(c.ehHoje ? "warn" : "neutral")}>{c.ehHoje ? "Hoje" : "Agendado"}</span>}
    </div>)}
  </div>;
}

function CirurgiasConfirmadas() {
  interface Cirurgia { id: string; nome: string; cpf: string | null; data: string; statusCirurgia: string; realizada: boolean; podeConfirmarRealizacao: boolean; }
  const [cirurgias, setCirurgias] = useState<Cirurgia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  async function carregar() { setCarregando(true); try { const r = await fetch("/api/admin/cirurgias-confirmadas", { cache: "no-store" }); const d = await r.json(); if (r.ok) setCirurgias(d.cirurgias ?? []); } finally { setCarregando(false); } }
  useEffect(() => { void carregar(); const t = setInterval(carregar, 60000); return () => clearInterval(t); }, []);
  async function confirmarRealizacao(agendamentoId: string) {
    setConfirmando(agendamentoId);
    try {
      const r = await fetch(`/api/admin/agendamentos/${agendamentoId}/ciclo`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cirurgiaRealizada: true }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast.error(d.erro ?? "Não foi possível registrar a realização."); return; }
      toast.success("Cirurgia registrada como realizada."); await carregar();
    } finally { setConfirmando(null); }
  }
  const hoje = new Date().toISOString().slice(0, 10);
  const proximas = cirurgias.filter((c) => !c.realizada);
  const realizadas = cirurgias.filter((c) => c.realizada);
  return <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", overflow: "hidden" }}>
    <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}><h2 style={{ fontSize: 15 }}>Cirurgias confirmadas</h2><span style={{ fontSize: 11, color: "var(--soft)" }}>{proximas.length} pendente(s) · {realizadas.length} concluída(s)</span></div>
    <div style={{ maxHeight: 480, overflowY: "auto" }}>
      {carregando ? <p style={{ padding: 32, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Carregando…</p> : proximas.length === 0 ? <p style={{ padding: 32, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Nenhuma cirurgia agendada.</p> : proximas.map((c) => { const dias = diasAte(c.data, hoje); return <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--line2)" }}>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.nome}</div><div style={{ fontSize: 11, color: "var(--soft)" }} className="zip-mono">{formatarDataCurta(c.data)} · {textoContagem(dias)}</div></div>
        {c.podeConfirmarRealizacao ? <button disabled={confirmando === c.id} onClick={() => confirmarRealizacao(c.id)} style={{ height: 30, padding: "0 12px", borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 11.5, fontWeight: 600 }}>Confirmar realização</button> : <span style={zipChip("warn")}>{dias > 0 ? `Em ${dias} dias` : "Aguardando"}</span>}
      </div>; })}
    </div>
    {realizadas.length > 0 && <div style={{ borderTop: "1px solid var(--line)" }}>
      <div style={{ padding: "9px 14px", background: "var(--s1)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ok)" }}>Concluídas ({realizadas.length})</div>
      <div style={{ maxHeight: 220, overflowY: "auto" }}>{realizadas.map((c) => <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 14px", borderBottom: "1px solid var(--line2)", fontSize: 12, color: "var(--soft)" }}><span>{c.nome}</span><span className="zip-mono">{formatarDataCurta(c.data)}</span></div>)}</div>
    </div>}
  </div>;
}
