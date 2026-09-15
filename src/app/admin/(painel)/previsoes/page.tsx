"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatarMoeda } from "@/lib/utils";
import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";

/**
 * Reprodução fiel de Admin Previsoes.dc.html: cenário (horizonte em meses),
 * alertas reais, indicadores, gráfico de barras por mês com referência de
 * R$100k, filtros por etapa real da jornada e drawer [PERFIL][PREVISÃO].
 * Nada de meta comercial fictícia — as duas linhas do "Meta" do ZIP que não
 * tinham dado real (novas vendas/ticket médio-alvo) foram substituídas por
 * indicadores realmente calculáveis a partir da carteira existente.
 */

interface ClienteForecast {
  clienteId: string; nome: string; totalParcelas: number; parcelasPagas: number; parcelasNecessarias: number | null; parcelasRestantes: number | null; parcelasVencidas: number;
  previsao: string | null; situacao: string; valorCarta: number | null; responsavel: string | null; campanha: string | null; codigoContrato: string | null;
}
interface MesForecast { mes: string; total: number; noRitmo: number; emRisco: number; }
interface AgendaCliente { clienteId: string; nome: string; dataTermos: string | null; termosAssinadosEm: string | null; agendaCirurgicaLiberarEm: string | null; previsaoAtual: string | null; custeioConfirmado: boolean; }

type Grupo = "todos" | "aprox" | "solicit" | "agendado" | "quit" | "janela" | "risco";
const FILTROS: { id: Grupo; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "aprox", label: "Aproximando elegibilidade" },
  { id: "solicit", label: "Pode solicitar termos" },
  { id: "agendado", label: "Termos agendados" },
  { id: "quit", label: "Aguardando quitação" },
  { id: "janela", label: "Em janela de 90 dias" },
  { id: "risco", label: "Em risco" },
];

const MESES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function dataBr(v: string | null | undefined) { return v ? v.slice(0, 10).split("-").reverse().join("/") : "—"; }

function grupoDe(f: ClienteForecast, ag: AgendaCliente | undefined): Grupo {
  if (f.situacao === "em_risco") return "risco";
  if (ag?.agendaCirurgicaLiberarEm) return "janela";
  if (ag?.termosAssinadosEm && !ag.custeioConfirmado) return "quit";
  if (ag?.dataTermos) return "agendado";
  if (f.situacao === "elegivel") return "solicit";
  if (f.situacao === "no_ritmo" && (f.parcelasRestantes ?? 99) <= 2) return "aprox";
  return "todos";
}
function statusLabelDe(grupo: Grupo, f: ClienteForecast): { label: string; kind: ZipKind } {
  if (grupo === "risco") return { label: "Em risco", kind: "bad" };
  if (grupo === "janela") return { label: "Em janela", kind: "rose" };
  if (grupo === "quit") return { label: "Aguardando quitação", kind: "warn" };
  if (grupo === "agendado") return { label: "Termos agendados", kind: "warn" };
  if (grupo === "solicit") return { label: "Pode solicitar", kind: "ok" };
  if (grupo === "aprox") return { label: "Em projeção", kind: "neutral" };
  return { label: f.situacao === "elegivel" ? "Elegível" : "Em acompanhamento", kind: "neutral" };
}

export default function PrevisoesPage() {
  const [clientes, setClientes] = useState<ClienteForecast[]>([]);
  const [meses, setMeses] = useState<MesForecast[]>([]);
  const [agenda, setAgenda] = useState<Map<string, AgendaCliente>>(new Map());
  const [metaOrcamento, setMetaOrcamento] = useState(100000);
  const [horizonte, setHorizonte] = useState(8);
  const [filtro, setFiltro] = useState<Grupo>("todos");
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [aba, setAba] = useState<"prev" | "perfil">("prev");

  useEffect(() => {
    let ativo = true;
    Promise.all([
      fetch("/api/admin/previsao-liberacoes", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/clientes-agendamentos", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/configuracoes", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([f, a, cfg]) => {
      if (!ativo) return;
      setClientes(f.clientes ?? []);
      setMeses(f.meses ?? []);
      setMetaOrcamento(Number(cfg?.configuracoes?.meta_orcamento_mensal) || 100000);
      const mapa = new Map<string, AgendaCliente>();
      for (const item of (a.clientes ?? []) as AgendaCliente[]) mapa.set(item.clienteId, item);
      setAgenda(mapa);
      if (!selecionado && f.clientes?.[0]) setSelecionado(f.clientes[0].clienteId);
    }).catch(() => toast.error("Não foi possível carregar as previsões.")).finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, []);

  const classificados = useMemo(() => clientes.map((c) => ({ ...c, grupo: grupoDe(c, agenda.get(c.clienteId)) })), [clientes, agenda]);
  const termo = busca.trim().toLowerCase();
  const filtrados = useMemo(() => {
    let base = classificados;
    if (filtro !== "todos") base = base.filter((c) => c.grupo === filtro);
    if (!termo) return base;
    return base.filter((c) => [c.nome, c.responsavel, c.campanha].some((v) => v?.toLowerCase().includes(termo)));
  }, [classificados, filtro, termo]);

  const isoHoje = new Date().toISOString().slice(0, 7);
  const proximosMeses = useMemo(() => meses.filter((m) => m.mes >= isoHoje).slice(0, horizonte), [meses, horizonte, isoHoje]);
  const barras = useMemo(() => {
    const valoresPorMes = new Map<string, number>();
    for (const c of clientes) { if (!c.previsao) continue; const mes = c.previsao.slice(0, 7); valoresPorMes.set(mes, (valoresPorMes.get(mes) ?? 0) + Number(c.valorCarta ?? 0)); }
    const maxValor = Math.max(...proximosMeses.map((m) => valoresPorMes.get(m.mes) ?? 0), metaOrcamento * 1.2, 1);
    return proximosMeses.map((m) => { const valor = valoresPorMes.get(m.mes) ?? 0; const [, mm] = m.mes.split("-"); return { mes: m.mes, label: MESES_PT[Number(mm) - 1], valor, acima: valor > metaOrcamento, altura: Math.max(4, Math.round((valor / maxValor) * 100)) }; });
  }, [clientes, proximosMeses, metaOrcamento]);
  const refBottomPct = useMemo(() => { const maxValor = Math.max(...barras.map((b) => b.valor), metaOrcamento * 1.2, 1); return Math.round((metaOrcamento / maxValor) * 100); }, [barras, metaOrcamento]);

  const elegiveis = classificados.filter((c) => c.situacao === "elegivel").length;
  const risco = classificados.filter((c) => c.grupo === "risco").length;
  const janela = classificados.filter((c) => c.grupo === "janela");
  const liberacaoHorizonte = barras.reduce((s, b) => s + b.valor, 0);
  const valorNecessarioJanela = janela.reduce((s, c) => s + Math.max(0, Number(c.valorCarta ?? 0) * ((c.parcelasNecessarias ?? 0) - c.parcelasPagas) / (c.totalParcelas || 1)), 0);

  const indicadores = [
    { label: `Solicitações previstas em ${horizonte} meses`, valor: String(classificados.filter((c) => c.grupo === "solicit" || c.grupo === "aprox").length), nota: "Carteira atual" },
    { label: "Clientes elegíveis hoje", valor: String(elegiveis), nota: "Pagas ≥ meta" },
    { label: "Liberação prevista no horizonte", valor: formatarMoeda(liberacaoHorizonte), nota: "Soma dos meses" },
    { label: "Em risco de prolongamento", valor: String(risco), nota: "Atraso, suspensão ou negativação" },
  ];

  const alertas: { texto: string; kind: ZipKind; icon: string }[] = [
    { texto: `${janela.length} cliente(s) estão dentro da janela de 90 dias`, kind: "warn", icon: "⚠" },
    { texto: `${risco} previsão(ões) mudaram por atraso ou suspensão`, kind: "bad", icon: "⚠" },
  ];
  const mesExcedente = barras.find((b) => b.acima);
  if (mesExcedente) alertas.unshift({ texto: `${mesExcedente.label} pode ultrapassar a referência mensal (${formatarMoeda(mesExcedente.valor)})`, kind: "warn", icon: "⚠" });

  const cli = classificados.find((c) => c.clienteId === selecionado) ?? classificados[0];
  const agCli = cli ? agenda.get(cli.clienteId) : undefined;
  const statusCli = cli ? statusLabelDe(cli.grupo, cli) : null;

  return <div className="zip-admin" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
    <div style={{ flex: "1 1 560px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "2px 2px 14px" }}>
        <div><h1 style={{ fontSize: 27 }}>Previsões</h1><p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--soft)", maxWidth: "62ch" }}>Previsões de elegibilidade, janelas de liberação e impacto de atrasos sobre os próximos meses.</p></div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, padding: "8px 10px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", marginBottom: 12 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--rose)", marginRight: 2 }}>Horizonte</span>
        <div style={{ display: "flex", alignItems: "center", gap: 2, height: 30, padding: "0 4px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)" }}>
          <button onClick={() => setHorizonte((h) => Math.max(3, h - 1))} style={{ height: 22, width: 22, borderRadius: 7, border: 0, background: "transparent", color: "var(--soft)" }}>‹</button>
          <span style={{ minWidth: 74, textAlign: "center", fontSize: 11.5, fontWeight: 600 }}>{horizonte} meses</span>
          <button onClick={() => setHorizonte((h) => Math.min(12, h + 1))} style={{ height: 22, width: 22, borderRadius: 7, border: 0, background: "transparent", color: "var(--soft)" }}>›</button>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", height: 30, padding: "0 11px", borderRadius: 9, background: "var(--robg)", color: "var(--bg)", fontSize: 11.5, fontWeight: 600 }}>Regra: meta por parcelas pagas</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 12 }}>
        {alertas.map((a, i) => { const bg = a.kind === "bad" ? "var(--badbg)" : a.kind === "ok" ? "var(--okbg)" : "var(--gobg)"; const fg = a.kind === "bad" ? "var(--bad)" : a.kind === "ok" ? "var(--ok)" : "var(--gold)"; return <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 11px", borderRadius: 9, border: `1px solid ${bg}`, background: bg, fontSize: 11.5, fontWeight: 500 }}><span style={{ color: fg, fontSize: 11 }}>{a.icon}</span>{a.texto}</div>; })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        {indicadores.map((i) => <div key={i.label} style={{ flex: "1 1 190px", border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 12, padding: "12px 13px" }}>
          <div style={{ fontSize: 10, color: "var(--soft)", fontWeight: 600 }}>{i.label}</div>
          <div style={{ marginTop: 2, fontSize: 18, fontFamily: "Fraunces,Georgia,serif" }}>{i.valor}</div>
          <div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>{i.nota}</div>
        </div>)}
      </div>

      <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", backdropFilter: "blur(18px)", overflow: "hidden", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><h2 style={{ fontSize: 15 }}>Liberações previstas por mês</h2><span style={{ fontSize: 11, color: "var(--soft)" }}>próximos {horizonte} meses</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 13, fontSize: 10.5, color: "var(--soft)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "var(--bg)" }} />Valor previsto</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "var(--gold)" }} />Acima da referência</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 0, borderTop: "1px dashed var(--soft)" }} />{formatarMoeda(metaOrcamento)} / mês</span>
          </div>
        </div>
        <div style={{ padding: "16px 14px 12px" }}>
          {barras.length === 0 ? <p style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Sem previsões futuras.</p> : <>
            <div style={{ position: "relative", height: 190, display: "flex", alignItems: "flex-end", gap: 10 }}>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: `${refBottomPct}%`, borderTop: "1px dashed var(--soft)", opacity: .55 }} />
              {barras.map((b) => <div key={b.mes} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 9.5, fontWeight: 600, color: b.acima ? "var(--gold)" : "var(--soft)", whiteSpace: "nowrap" }}>{formatarMoeda(b.valor).replace("R$", "").trim()}</span>
                <div title={b.label} style={{ width: "100%", maxWidth: 46, height: `${b.altura}%`, borderRadius: "7px 7px 3px 3px", background: b.acima ? "var(--gold)" : "var(--bg)", opacity: b.acima ? .9 : .85 }} />
              </div>)}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>{barras.map((b) => <div key={b.mes} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 10, color: "var(--soft)" }}>{b.label}</div>)}</div>
          </>}
          <div style={{ marginTop: 11, paddingTop: 10, borderTop: "1px solid var(--line2)", fontSize: 11, color: "var(--soft)", lineHeight: 1.5 }}>A previsão considera parcelas pagas, atrasos, suspensões, reagendamento dos termos e a confirmação da quitação. A referência de {formatarMoeda(metaOrcamento)} é planejamento, não trava operacional.</div>
        </div>
      </div>

      <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", backdropFilter: "blur(18px)", overflow: "hidden", marginBottom: 14 }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}><h2 style={{ fontSize: 15 }}>Janela de liberação — resumo real</h2></div>
        <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(196px,1fr))", gap: 11 }}>
          {[["Clientes previstas para liberação", String(janela.length)], ["Valor ainda necessário em parcelas", formatarMoeda(valorNecessarioJanela)], ["Clientes em risco", String(risco)]].map(([label, valor]) => <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 10, paddingBottom: 9, borderBottom: "1px solid var(--line2)" }}><span style={{ fontSize: 11.5, color: "var(--soft)" }}>{label}</span><span style={{ fontSize: 12, fontWeight: 600 }} className="zip-mono">{valor}</span></div>)}
        </div>
        <div style={{ padding: "0 14px 14px", fontSize: 11, color: "var(--soft)", lineHeight: 1.5 }}>Previsão da carteira atual — não inclui metas comerciais de novas vendas, que são planejamento separado.</div>
      </div>

      <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", backdropFilter: "blur(18px)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><h2 style={{ fontSize: 15 }}>{FILTROS.find((f) => f.id === filtro)?.label}</h2><span style={{ fontSize: 11, color: "var(--soft)" }}>{filtrados.length} clientes</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, height: 31, width: 268, maxWidth: "44vw", padding: "0 11px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)" }}>
            <span style={{ color: "var(--rose)", fontSize: 11.5 }}>⌕</span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, vendedora ou campanha…" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", outline: "none", fontSize: 11.5, color: "var(--ink)" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 5, padding: "9px 14px", borderBottom: "1px solid var(--line)", background: "var(--s1)", overflowX: "auto" }}>
          {FILTROS.map((f) => { const on = filtro === f.id; return <button key={f.id} onClick={() => setFiltro(f.id)} style={{ height: 27, padding: "0 11px", borderRadius: 999, border: `1px solid ${on ? "var(--bg)" : "var(--line)"}`, background: on ? "var(--robg)" : "var(--s0)", color: on ? "var(--bg)" : "var(--soft)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{f.label}</button>; })}
        </div>
        <div style={{ overflowX: "auto", maxHeight: 500, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(150px,1.3fr) 92px minmax(150px,1.2fr) 100px 150px 130px", gap: 11, minWidth: 900, padding: "0 14px", height: 33, alignItems: "center", background: "var(--s1)", borderBottom: "1px solid var(--line)", position: "sticky", top: 0 }}>
            {["Cliente", "Pagas / Total", "Etapa atual", "Previsão", "Impacto", "Status"].map((h) => <div key={h} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>{h}</div>)}
          </div>
          {carregando ? <div style={{ padding: 40, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Carregando…</div> : filtrados.length === 0 ? <div style={{ padding: "46px 20px", textAlign: "center" }}><div style={{ fontSize: 13, fontWeight: 600 }}>Nenhuma cliente neste filtro</div></div>
            : filtrados.map((r) => { const status = statusLabelDe(r.grupo, r); return <div key={r.clienteId} onClick={() => { setSelecionado(r.clienteId); setAba("prev"); }} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "minmax(150px,1.3fr) 92px minmax(150px,1.2fr) 100px 150px 130px", gap: 11, minWidth: 900, padding: "0 14px", height: 44, alignItems: "center", cursor: "pointer", borderBottom: "1px solid var(--line2)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.nome}</div>
              <div style={{ fontSize: 12, fontWeight: 600 }} className="zip-mono">{r.parcelasPagas} / {r.totalParcelas}</div>
              <div style={{ fontSize: 12, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{status.label}</div>
              <div style={{ fontSize: 12, color: "var(--soft)" }} className="zip-mono">{dataBr(r.previsao)}</div>
              <div style={{ fontSize: 12, color: "var(--soft)" }}>{r.parcelasVencidas > 0 ? `${r.parcelasVencidas} parcela(s) vencida(s)` : "—"}</div>
              <div><span style={zipChip(status.kind)}>{status.label}</span></div>
            </div>; })}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--soft)" }}>{filtrados.length} clientes · lista contínua</div>
      </div>
    </div>

    {cli && <aside style={{ flex: "1 1 340px", minWidth: "min(100%,340px)", maxWidth: 430, position: "sticky", top: 16, maxHeight: "calc(100vh - 32px)", overflow: "auto", border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", backdropFilter: "blur(18px)" }} className="zip-animate-slide-in">
      <div style={{ padding: "15px 16px 12px", borderBottom: "1px solid var(--line)" }}>
        <h2 style={{ fontSize: 16, lineHeight: 1.25 }}>{cli.nome}</h2>
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 5 }}>{statusCli && <span style={zipChip(statusCli.kind)}>● {statusCli.label}</span>}<span style={{ display: "inline-flex", alignItems: "center", height: 21, padding: "0 9px", borderRadius: 999, background: "var(--line2)", color: "var(--soft)", fontSize: 10.5, fontWeight: 600 }}>{cli.totalParcelas}x</span></div>
        <div style={{ marginTop: 12, display: "flex", gap: 4, padding: 3, borderRadius: 10, border: "1px solid var(--line)", background: "var(--s1)" }}>
          <button onClick={() => setAba("perfil")} style={{ flex: 1, height: 28, borderRadius: 8, border: aba === "perfil" ? "1px solid var(--line)" : "1px solid transparent", background: aba === "perfil" ? "var(--s0)" : "transparent", color: aba === "perfil" ? "var(--ink)" : "var(--soft)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em" }}>PERFIL</button>
          <button onClick={() => setAba("prev")} style={{ flex: 1, height: 28, borderRadius: 8, border: aba === "prev" ? "1px solid var(--line)" : "1px solid transparent", background: aba === "prev" ? "var(--s0)" : "transparent", color: aba === "prev" ? "var(--ink)" : "var(--soft)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em" }}>PREVISÃO</button>
        </div>
      </div>

      {aba === "prev" ? <>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 10 }}>Elegibilidade</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}><span style={{ color: "var(--soft)" }}>Parcelas pagas</span><span style={{ fontWeight: 600 }}>{cli.parcelasPagas} / {cli.totalParcelas}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}><span style={{ color: "var(--soft)" }}>Meta de liberação</span><span style={{ fontWeight: 600 }}>{cli.parcelasNecessarias ?? "—"} parcelas</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}><span style={{ color: "var(--soft)" }}>Faltam</span><span style={{ fontWeight: 600, color: cli.situacao === "elegivel" ? "var(--ok)" : "var(--ink)" }}>{cli.situacao === "elegivel" ? "Elegível agora" : `${Math.max((cli.parcelasNecessarias ?? 0) - cli.parcelasPagas, 0)} parcelas`}</span></div>
          </div>
          <div style={{ marginTop: 9, height: 5, borderRadius: 999, background: "var(--line2)", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(Math.round((cli.parcelasPagas / (cli.parcelasNecessarias || 1)) * 100), 100)}%`, borderRadius: 999, background: cli.situacao === "elegivel" ? "var(--ok)" : "var(--bg)" }} /></div>
          <div style={{ marginTop: 9, fontSize: 11, color: "var(--soft)", lineHeight: 1.5 }}>Para contratos de {cli.totalParcelas}x, a cliente pode solicitar os próximos passos após a {cli.parcelasNecessarias}ª parcela.</div>
        </div>
        <div style={{ height: 1, background: "var(--line)", margin: "0 16px" }} />
        <div style={{ padding: "13px 16px" }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 10 }}>Liberação financeira</div>
          {agCli?.agendaCirurgicaLiberarEm ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}><span style={{ color: "var(--soft)" }}>Termos</span><span style={{ fontWeight: 600 }}>{dataBr(agCli.termosAssinadosEm)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}><span style={{ color: "var(--soft)" }}>Janela máxima</span><span style={{ fontWeight: 600 }}>{dataBr(agCli.agendaCirurgicaLiberarEm)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}><span style={{ color: "var(--soft)" }}>Previsão sugerida</span><span style={{ fontWeight: 600 }}>{dataBr(agCli.previsaoAtual)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}><span style={{ color: "var(--soft)" }}>Valor previsto</span><span style={{ fontWeight: 600 }} className="zip-mono">{formatarMoeda(cli.valorCarta ?? 0)}</span></div>
          </div> : <div style={{ border: "1px dashed var(--line)", borderRadius: 11, padding: "16px 13px", textAlign: "center" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>Ainda não calculável</div>
            <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--soft)", lineHeight: 1.5 }}>A janela de 90 dias começa somente com termos assinados e quitação confirmada.</div>
          </div>}
        </div>
        <div style={{ padding: "0 16px 16px" }}>
          <div style={{ border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 11, padding: "11px 12px", fontSize: 11, color: "var(--soft)", lineHeight: 1.5 }}>A data é previsão. A regra real é a quantidade de parcelas pagas: a cliente só pode solicitar quando pagas ≥ meta.</div>
        </div>
      </> : <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}><span style={{ color: "var(--soft)" }}>Vendedora</span><span style={{ fontWeight: 600 }}>{cli.responsavel || "—"}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}><span style={{ color: "var(--soft)" }}>Campanha</span><span style={{ fontWeight: 600 }}>{cli.campanha || "—"}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}><span style={{ color: "var(--soft)" }}>Plano</span><span style={{ fontWeight: 600 }}>{cli.totalParcelas}x</span></div>
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--soft)", lineHeight: 1.5 }}>Dados completos e edição ficam em Clientes. Aqui a visão é de previsão.</div>
      </div>}
    </aside>}
  </div>;
}
