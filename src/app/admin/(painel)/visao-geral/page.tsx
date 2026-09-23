"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatarMoeda } from "@/lib/utils";
import { zipChip, zipIconBox, zipPanel } from "@/components/admin-zip/zipUi";

/**
 * Reprodução pixel a pixel de Admin Visao Geral.dc.html: topbar fixa,
 * 6 KPIs, Operação de hoje / Agenda / Ações rápidas, Financeiro /
 * Previsões / Clientes, Notificações e monitoramento, e drawer de
 * atividade recente. Toda a lógica de dados é a mesma da versão anterior
 * (mesmos endpoints reais) — só a marcação foi reescrita nos tokens do ZIP.
 * O seletor de período do ZIP foi mantido apenas como rótulo "Hoje" real
 * (não fabricamos filtro por data que o backend não suporta ainda).
 */

function numero(v: unknown) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function texto(v: unknown, fallback = "—") { return typeof v === "string" && v ? v : fallback; }
function dataCurta(v: string | null | undefined) {
  if (!v) return "—";
  const [ano, mes, dia] = String(v).slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "—";
}
function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "—";
}

const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MESES_PT_CAP = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

interface VisaoGeral {
  kpis: { novasClientesHoje: number; aguardandoCadastro: number; aguardandoConferencia: number; clientesAtivas: number; termosHoje: number; cirurgiasHoje: number };
  clientStats: { ativas: number; suspensas: number; negativadas: number; canceladas: number };
  novasClientesRecentes: { clienteId: string; nome: string; cpf: string; quando: string; status: string }[];
  monitoramento: { webPushConfigurado: boolean; notificacoesHoje: number; totalDispositivos: number; pwaInstalados: number; pwaInstaladoPercentual: number; semAcessoRecente: number };
  atividadeRecente: { texto: string; usuario: string | null; quando: string }[];
  termosHojeLista: { agendamentoId: string; nome: string; horario: string | null }[];
  comprovantesPendentes: { boletoId: string; clienteId: string; nome: string; numeroParcela: number; totalParcelas: number; valor: number; dataPagamento: string | null }[];
  proximosAgendamentos: { agendamentoId: string; clienteId: string; nome: string; data: string | null; valorContrato: number }[];
  clientesAguardandoLiberacao: { clienteId: string; nome: string; valorContrato: number; quantidadeParcelas: number | null; porcentagemPagamento: number }[];
  proximasLiberacoesFinanceiras: { agendamentoId: string; clienteId: string; nome: string; valorContrato: number; dataPrevisao: string | null }[];
}

const VAZIO: VisaoGeral = {
  kpis: { novasClientesHoje: 0, aguardandoCadastro: 0, aguardandoConferencia: 0, clientesAtivas: 0, termosHoje: 0, cirurgiasHoje: 0 },
  clientStats: { ativas: 0, suspensas: 0, negativadas: 0, canceladas: 0 },
  novasClientesRecentes: [],
  monitoramento: { webPushConfigurado: false, notificacoesHoje: 0, totalDispositivos: 0, pwaInstalados: 0, pwaInstaladoPercentual: 0, semAcessoRecente: 0 },
  atividadeRecente: [],
  termosHojeLista: [],
  comprovantesPendentes: [],
  proximosAgendamentos: [],
  clientesAguardandoLiberacao: [],
  proximasLiberacoesFinanceiras: [],
};

interface Cirurgia { id: string; nome: string; data: string; statusCirurgia: string; }
interface ClienteForecast { nome: string; parcelasPagas: number; totalParcelas: number; previsao: string | null; situacao: string; valorCarta: number | null; }
interface AgendaMensalCliente { agendamentoId: string; data: string | null; statusCirurgia: string; statusFinanceiro: string; }
interface AgendaMensalMes { mes: number; total: number; clientes: AgendaMensalCliente[]; }

function CardShell({ children }: { children: React.ReactNode }) {
  return <section style={zipPanel({ overflow: "hidden" })}>{children}</section>;
}
function CardHeader({ title, sub, href, linkLabel }: { title: string; sub: string; href: string; linkLabel: string }) {
  return <div style={{ padding: "12px 13px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
    <div><h3 style={{ fontSize: 15 }}>{title}</h3><div style={{ fontSize: 9, color: "var(--soft)", marginTop: 2 }}>{sub}</div></div>
    <a href={href} style={{ fontSize: 9, color: "var(--bg)", fontWeight: 700 }}>{linkLabel} →</a>
  </div>;
}

export default function VisaoGeralPage() {
  const hoje = new Date();
  const isoHoje = hoje.toISOString().slice(0, 10);

  const [visao, setVisao] = useState<VisaoGeral>(VAZIO);
  const [cirurgias, setCirurgias] = useState<Cirurgia[]>([]);
  const [forecastMeses, setForecastMeses] = useState<{ mes: string; total: number }[]>([]);
  const [forecastClientes, setForecastClientes] = useState<ClienteForecast[]>([]);
  const [metaOrcamento, setMetaOrcamento] = useState(100000);
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mesSelecionado, setMesSelecionado] = useState(hoje.getMonth() + 1);
  const [agendaMeses, setAgendaMeses] = useState<AgendaMensalMes[]>([]);
  const [f1, setF1] = useState(0);
  const [f3, setF3] = useState(0);
  const [f5, setF5] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [atividadeAberta, setAtividadeAberta] = useState(false);
  const [perfil, setPerfil] = useState<{ nome: string; cargo: string } | null>(null);

  useEffect(() => {
    let ativo = true;
    async function preview(id: string) {
      try {
        const r = await fetch("/api/admin/relatorios/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relatorioId: id, filtros: {} }) });
        const d = await r.json();
        return numero(d?.totalRegistros);
      } catch { return 0; }
    }
    Promise.all([
      fetch("/api/admin/visao-geral", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/cirurgias-confirmadas", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/previsao-liberacoes", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/configuracoes", { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/admin/agenda-mensal?ano=${ano}`, { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/session", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      preview("f1"), preview("f3"), preview("f5"),
    ]).then(([v, c, f, cfg, agenda, sessao, af1, af3, af5]) => {
      if (!ativo) return;
      setVisao({ ...VAZIO, ...v });
      setCirurgias((c.cirurgias ?? []).map((x: any) => ({ id: x.id, nome: x.nome, data: x.data, statusCirurgia: x.statusCirurgia })));
      setForecastMeses(f.meses ?? []);
      setForecastClientes((f.clientes ?? []) as ClienteForecast[]);
      setMetaOrcamento(numero(cfg?.configuracoes?.meta_orcamento_mensal) || 100000);
      setAgendaMeses(agenda.meses ?? []);
      if (sessao?.nome) setPerfil({ nome: sessao.nome, cargo: sessao.cargo ?? "administrativo" });
      setF1(af1); setF3(af3); setF5(af5);
    }).catch(() => toast.error("Não foi possível carregar a Visão Geral."))
      .finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, [ano]);

  const cirurgiasHoje = useMemo(() => cirurgias.filter((c) => c.data === isoHoje), [cirurgias, isoHoje]);

  const forecastBarras = useMemo(() => {
    const valoresPorMes = new Map<string, number>();
    for (const c of forecastClientes) {
      if (!c.previsao) continue;
      const mes = c.previsao.slice(0, 7);
      valoresPorMes.set(mes, (valoresPorMes.get(mes) ?? 0) + numero(c.valorCarta));
    }
    const proximos = forecastMeses.filter((m) => m.mes >= isoHoje.slice(0, 7)).slice(0, 6);
    const maxValor = Math.max(...proximos.map((m) => valoresPorMes.get(m.mes) ?? 0), metaOrcamento, 1);
    return proximos.map((m) => {
      const valor = valoresPorMes.get(m.mes) ?? 0;
      const [, mesMes] = m.mes.split("-");
      return { mes: m.mes, label: `${MESES_PT_CAP[Number(mesMes) - 1]?.slice(0, 3)}`, valor, altura: Math.max(4, Math.round((valor / maxValor) * 100)) };
    });
  }, [forecastMeses, forecastClientes, metaOrcamento, isoHoje]);

  const refBottomPct = useMemo(() => { const maxValor = Math.max(...forecastBarras.map((b) => b.valor), metaOrcamento, 1); return Math.round((metaOrcamento / maxValor) * 100); }, [forecastBarras, metaOrcamento]);

  const elegibilidadeProxima = useMemo(() => forecastClientes.filter((c) => c.situacao === "no_ritmo" && c.previsao).sort((a, b) => String(a.previsao).localeCompare(String(b.previsao))).slice(0, 4), [forecastClientes]);

  const mesAtualAgenda = agendaMeses.find((m) => m.mes === mesSelecionado);
  const diasComEvento = useMemo(() => {
    const mapa = new Map<number, "ok" | "bad" | "rose">();
    for (const c of mesAtualAgenda?.clientes ?? []) {
      if (!c.data) continue;
      const dia = Number(c.data.slice(8, 10));
      const cor = c.statusCirurgia === "cancelada" ? "bad" : c.statusCirurgia === "realizada" || c.statusFinanceiro === "pago" ? "ok" : "rose";
      if (!mapa.has(dia) || cor === "bad") mapa.set(dia, cor);
    }
    return mapa;
  }, [mesAtualAgenda]);

  const diasNoMes = new Date(ano, mesSelecionado, 0).getDate();
  const primeiroDiaSemana = new Date(ano, mesSelecionado - 1, 1).getDay();
  const celulas = [...Array.from({ length: primeiroDiaSemana }, () => null), ...Array.from({ length: diasNoMes }, (_, i) => i + 1)];

  function navegarMes(delta: number) {
    let novoMes = mesSelecionado + delta;
    let novoAno = ano;
    if (novoMes < 1) { novoMes = 12; novoAno -= 1; }
    if (novoMes > 12) { novoMes = 1; novoAno += 1; }
    setMesSelecionado(novoMes);
    if (novoAno !== ano) setAno(novoAno);
  }

  const kpiCards = [
    { label: "Novas clientes", sub: "cadastradas hoje", value: visao.kpis.novasClientesHoje, icon: "＋", kind: "rose" as const, href: "/admin/clientes" },
    { label: "Aguardando cadastro", sub: "no funil de entrada", value: visao.kpis.aguardandoCadastro, icon: "▤", kind: "rose" as const, href: "/admin/clientes" },
    { label: "Aguardando conferência", sub: "comprovantes", value: visao.kpis.aguardandoConferencia, icon: "◷", kind: "warn" as const, href: "/admin/financeiro" },
    { label: "Clientes ativas", sub: "contratos ativos", value: visao.kpis.clientesAtivas, icon: "○", kind: "ok" as const, href: "/admin/clientes" },
    { label: "Termos hoje", sub: "assinaturas / confirmações", value: visao.kpis.termosHoje, icon: "▣", kind: "rose" as const, href: "/admin/agenda" },
    { label: "Cirurgias hoje", sub: "agendamentos confirmados", value: visao.kpis.cirurgiasHoje, icon: "◫", kind: "rose" as const, href: "/admin/agenda" },
  ];
  const acoesRapidas = [
    { icon: "＋", label: "Nova cliente", href: "/admin/clientes" },
    { icon: "$", label: "Abrir Financeiro", href: "/admin/financeiro" },
    { icon: "◷", label: "Agenda de termos", href: "/admin/agenda" },
    { icon: "▥", label: "Relatórios", href: "/admin/relatorios" },
    { icon: "⚙", label: "Configurações", href: "/admin/configuracoes" },
  ];

  if (carregando) {
    return <div className="zip-admin" style={{ padding: 2 }}>
      <div style={{ height: 64, borderRadius: 14, background: "var(--s1)", marginBottom: 14 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(130px,1fr))", gap: 8 }}>{Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ height: 82, borderRadius: 12, background: "var(--s1)" }} />)}</div>
    </div>;
  }

  return <div className="zip-admin">
    <div style={{ position: "sticky", top: 16, zIndex: 10, border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, padding: "10px 13px", boxShadow: "var(--sh)", backdropFilter: "blur(18px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
      <div><div style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--rose)" }}>SRA. LUCK · BACKOFFICE</div><div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 2 }}>Gestão administrativa</div></div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--soft)" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ok)" }} />Sistema online</span>
        <span style={{ width: 1, height: 24, background: "var(--line)" }} />
        <button onClick={() => setAtividadeAberta(true)} title="Atividade recente" style={{ width: 31, height: 31, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--soft)", position: "relative" }}>◌{visao.atividadeRecente.length > 0 && <span style={{ position: "absolute", right: -4, top: -5, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 99, background: "var(--bad)", color: "white", fontSize: 9, fontWeight: 800, display: "grid", placeItems: "center" }}>{Math.min(9, visao.atividadeRecente.length)}</span>}</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--s2)", color: "var(--bg)", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 800 }}>{iniciais(perfil?.nome ?? "Admin")}</div><div style={{ lineHeight: 1.2 }}><div style={{ fontSize: 11, fontWeight: 700 }}>{perfil?.nome ?? "—"}</div><div style={{ fontSize: 9, color: "var(--soft)" }}>{perfil?.cargo ?? "Administrativo"}</div></div></div>
      </div>
    </div>

    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap", margin: "0 1px 12px" }}>
      <div><h1 style={{ fontSize: 27 }}>Dashboard</h1><p style={{ margin: "5px 0 0", color: "var(--soft)", fontSize: 12 }}>Visão geral da operação Sra. Luck. Acompanhe o que exige atenção e acesse rapidamente cada área.</p></div>
      <div style={{ height: 34, display: "flex", alignItems: "center", border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel)", padding: "0 12px", fontSize: 10.5, fontWeight: 700 }}>Hoje, {hoje.getDate()} de {MESES_PT[hoje.getMonth()]} de {hoje.getFullYear()}</div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(130px,1fr))", gap: 8, marginBottom: 10 }}>
      {kpiCards.map((k) => <a key={k.label} href={k.href} style={{ ...zipPanel({ borderRadius: 12, padding: "11px 12px", minHeight: 82 }), display: "flex", gap: 9, cursor: "pointer", textDecoration: "none", color: "inherit" }}>
        <div style={zipIconBox(k.kind, 28)}>{k.icon}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong className="zip-mono" style={{ fontSize: 20, letterSpacing: "-.04em" }}>{k.value}</strong>
          <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 1 }}>{k.label}</div>
          <div style={{ fontSize: 8.8, color: "var(--soft)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.sub}</div>
        </div>
      </a>)}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.45fr .72fr", gap: 10, marginBottom: 10 }}>
      <CardShell>
        <CardHeader title="Operação de hoje" sub="Pendências que pedem ação" href="/admin/agenda" linkLabel="Ver agenda" />
        <div style={{ padding: "5px 10px 8px" }}>
          {[
            { label: "Comprovantes aguardando conferência", count: visao.kpis.aguardandoConferencia, icon: "▤", kind: "warn" as const, href: "/admin/financeiro" },
            { label: "Termos para confirmar", count: visao.kpis.termosHoje, icon: "▣", kind: "rose" as const, href: "/admin/agenda" },
            { label: "Revisão financeira pendente", count: visao.clientesAguardandoLiberacao.length, icon: "$", kind: "bad" as const, href: "/admin/agenda" },
            { label: "Cirurgias do dia", count: visao.kpis.cirurgiasHoje, icon: "◷", kind: "rose" as const, href: "/admin/agenda" },
          ].map((o) => <a key={o.label} href={o.href} style={{ display: "grid", gridTemplateColumns: "27px 1fr auto 13px", alignItems: "center", gap: 8, padding: "9px 3px", borderBottom: "1px solid var(--line2)", cursor: "pointer", textDecoration: "none", color: "inherit" }} className="zip-row-hover">
            <span style={zipIconBox(o.kind, 26)}>{o.icon}</span>
            <div style={{ fontSize: 10.5, fontWeight: 600 }}>{o.label}</div>
            <span style={zipChip(o.kind)}>{o.count}</span>
            <span style={{ color: "var(--soft)" }}>›</span>
          </a>)}
        </div>
      </CardShell>

      <CardShell>
        <div style={{ padding: "12px 13px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}><div><h3 style={{ fontSize: 15 }}>Agenda</h3><div style={{ fontSize: 9, color: "var(--soft)", marginTop: 2 }}>Termos e cirurgias do mês</div></div><a href="/admin/agenda" style={{ fontSize: 9, color: "var(--bg)", fontWeight: 700 }}>Abrir agenda →</a></div>
        <div style={{ display: "grid", gridTemplateColumns: "1.08fr .92fr", gap: 8, padding: "0 12px 12px" }}>
          <div style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <button onClick={() => navegarMes(-1)} style={{ width: 25, height: 25, border: "1px solid var(--line)", borderRadius: 8, background: "var(--s0)", color: "var(--soft)" }}>‹</button>
              <strong style={{ fontSize: 10.5 }}>{MESES_PT_CAP[mesSelecionado - 1]} {ano}</strong>
              <button onClick={() => navegarMes(1)} style={{ width: 25, height: 25, border: "1px solid var(--line)", borderRadius: 8, background: "var(--s0)", color: "var(--soft)" }}>›</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 3 }}>{DIAS_SEMANA.map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 7.5, color: "var(--soft)", fontWeight: 700 }}>{d}</div>)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>{celulas.map((dia, i) => {
              if (dia == null) return <div key={i} style={{ height: 28 }} />;
              const cor = diasComEvento.get(dia);
              const sel = false;
              const isHoje = dia === hoje.getDate() && mesSelecionado === hoje.getMonth() + 1 && ano === hoje.getFullYear();
              const dotColor = cor === "ok" ? "var(--ok)" : cor === "bad" ? "var(--bad)" : cor === "rose" ? "var(--bg)" : "transparent";
              return <button key={i} style={{ height: 28, border: `1px solid ${isHoje ? "var(--bg)" : "transparent"}`, borderRadius: 8, background: isHoje ? "var(--robg)" : "transparent", color: isHoje ? "var(--bg)" : "var(--ink)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, fontSize: 8.5, fontWeight: isHoje ? 800 : (sel ? 700 : 600) }}>
                <span>{dia}</span><span style={{ width: 4, height: 4, borderRadius: "50%", background: dotColor, opacity: cor ? 1 : 0 }} />
              </button>;
            })}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: 9 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}><strong style={{ fontSize: 10.5 }}>Termos cirúrgicos</strong><a href="/admin/agenda" style={{ fontSize: 8.5, color: "var(--bg)", fontWeight: 700 }}>Ver todos →</a></div>
              {visao.termosHojeLista.length === 0 ? <div style={{ fontSize: 9.5, color: "var(--soft)", padding: "4px 0" }}>Nenhum termo hoje.</div> : visao.termosHojeLista.slice(0, 2).map((t) => <div key={t.agendamentoId} style={{ display: "grid", gridTemplateColumns: "36px 1fr auto", gap: 7, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--line2)" }}>
                <span className="zip-mono" style={{ fontSize: 9, color: "var(--soft)" }}>{t.horario?.slice(0, 5) ?? "—"}</span>
                <div><div style={{ fontSize: 9.5, fontWeight: 700 }}>{t.nome}</div><div style={{ fontSize: 8.4, color: "var(--soft)" }}>Assinatura de termos</div></div>
                <span style={zipChip("ok")}>Hoje</span>
              </div>)}
            </div>
            <div style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: 9 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}><strong style={{ fontSize: 10.5 }}>Cirurgias confirmadas</strong><a href="/admin/agenda" style={{ fontSize: 8.5, color: "var(--bg)", fontWeight: 700 }}>Ver todas →</a></div>
              {cirurgiasHoje.length === 0 ? <div style={{ fontSize: 9.5, color: "var(--soft)", padding: "4px 0" }}>Nenhuma cirurgia hoje.</div> : cirurgiasHoje.slice(0, 2).map((c) => <div key={c.id} style={{ display: "grid", gridTemplateColumns: "36px 1fr auto", gap: 7, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--line2)" }}>
                <span className="zip-mono" style={{ fontSize: 9, color: "var(--soft)" }}>—</span>
                <div><div style={{ fontSize: 9.5, fontWeight: 700 }}>{c.nome}</div><div style={{ fontSize: 8.4, color: "var(--soft)" }}>Cirurgia confirmada</div></div>
                <span style={zipChip("ok")}>Hoje</span>
              </div>)}
            </div>
          </div>
        </div>
      </CardShell>

      <CardShell>
        <div style={{ padding: "12px 13px", borderBottom: "1px solid var(--line)" }}><h3 style={{ fontSize: 15 }}>Ações rápidas</h3><div style={{ fontSize: 9, color: "var(--soft)", marginTop: 2 }}>Atalhos para tarefas reais do sistema</div></div>
        <div style={{ padding: 9, display: "grid", gap: 6 }}>{acoesRapidas.map((a) => <a key={a.label} href={a.href} style={{ height: 36, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", padding: "0 10px", display: "flex", alignItems: "center", gap: 9, textAlign: "left", fontSize: 10.5, fontWeight: 700, textDecoration: "none" }}><span style={{ width: 22, height: 22, borderRadius: 7, background: "var(--s2)", color: "var(--bg)", display: "grid", placeItems: "center" }}>{a.icon}</span><span style={{ flex: 1 }}>{a.label}</span><span style={{ color: "var(--soft)" }}>›</span></a>)}</div>
      </CardShell>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1.18fr 1fr .92fr", gap: 10, marginBottom: 10 }}>
      <CardShell>
        <CardHeader title="Financeiro" sub="Conferência e parcelas da operação" href="/admin/financeiro" linkLabel="Ver financeiro" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, padding: "8px 10px" }}>
          {[["Parcelas em aberto", f1], ["Vencidas", f3], ["Aguardando conferência", visao.kpis.aguardandoConferencia], ["Comprovantes recebidos", f5]].map(([label, value]) => <a key={label as string} href="/admin/financeiro" style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 8, cursor: "pointer", textDecoration: "none", color: "inherit" }}><div className="zip-mono" style={{ fontSize: 16, fontWeight: 800 }}>{value}</div><div style={{ fontSize: 8.5, color: "var(--soft)", marginTop: 2 }}>{label}</div></a>)}
        </div>
        <div style={{ padding: "0 10px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "2px 0 6px" }}><strong style={{ fontSize: 10 }}>Comprovantes aguardando conferência</strong><a href="/admin/financeiro" style={{ fontSize: 8.5, color: "var(--bg)", fontWeight: 700 }}>Ver todos →</a></div>
          <div style={{ border: "1px solid var(--line2)", borderRadius: 9, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr .55fr .75fr .8fr 18px", gap: 7, padding: "6px 8px", background: "var(--s1)", fontSize: 7.5, color: "var(--soft)", fontWeight: 700 }}><span>Cliente</span><span>Parcela</span><span>Valor</span><span>Status</span><span /></div>
            {visao.comprovantesPendentes.length === 0 ? <div style={{ padding: "16px 8px", textAlign: "center", fontSize: 9.5, color: "var(--soft)" }}>Fila limpa.</div> : visao.comprovantesPendentes.slice(0, 4).map((r) => <a key={r.boletoId} href="/admin/financeiro" style={{ display: "grid", gridTemplateColumns: "1.4fr .55fr .75fr .8fr 18px", gap: 7, alignItems: "center", padding: "7px 8px", borderTop: "1px solid var(--line2)", fontSize: 8.6, cursor: "pointer", textDecoration: "none", color: "inherit" }}>
              <strong>{r.nome}</strong><span>{r.numeroParcela}/{r.totalParcelas || "—"}</span><span className="zip-mono">{formatarMoeda(r.valor)}</span><span style={zipChip("warn")}>Aguardando</span><span style={{ color: "var(--soft)" }}>⋮</span>
            </a>)}
          </div>
        </div>
      </CardShell>

      <CardShell>
        <CardHeader title="Previsões" sub="Liberações e próximas elegibilidades" href="/admin/previsoes" linkLabel="Ver previsões" />
        <div style={{ padding: "8px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><strong style={{ fontSize: 9.5 }}>Liberações previstas</strong><span style={{ fontSize: 8, color: "var(--soft)" }}>Referência mensal: {formatarMoeda(metaOrcamento)}</span></div>
          <div style={{ height: 116, marginTop: 8, display: "flex", alignItems: "flex-end", gap: 7, borderBottom: "1px solid var(--line)", position: "relative", padding: "0 4px" }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: `${100 - refBottomPct}%`, borderTop: "1px dashed var(--rose)", opacity: .55 }} />
            {forecastBarras.length === 0 ? <div style={{ width: "100%", textAlign: "center", fontSize: 9.5, color: "var(--soft)" }}>Sem previsões futuras.</div> : forecastBarras.map((b) => <div key={b.mes} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 3 }}>
              <span style={{ fontSize: 7.5, fontWeight: 700 }}>{formatarMoeda(b.valor).replace("R$", "").trim()}</span>
              <div title={`${b.label}: ${formatarMoeda(b.valor)}`} style={{ width: "80%", height: `${b.altura}%`, minHeight: 8, borderRadius: "5px 5px 0 0", background: "linear-gradient(180deg,var(--bg),var(--bgl))" }} />
              <span style={{ fontSize: 7, color: "var(--soft)" }}>{b.label}</span>
            </div>)}
          </div>
        </div>
        <div style={{ padding: "0 10px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}><strong style={{ fontSize: 9.5 }}>Próximas elegibilidades</strong><a href="/admin/previsoes" style={{ fontSize: 8, color: "var(--bg)", fontWeight: 700 }}>Ver todas →</a></div>
          {elegibilidadeProxima.length === 0 ? <div style={{ fontSize: 8.3, color: "var(--soft)", padding: "5px 0" }}>Nenhuma cliente próxima da elegibilidade.</div> : elegibilidadeProxima.map((e, i) => <a key={i} href="/admin/previsoes" style={{ display: "grid", gridTemplateColumns: "1.45fr .65fr .7fr", gap: 7, padding: "5px 0", borderTop: "1px solid var(--line2)", fontSize: 8.3, cursor: "pointer", textDecoration: "none", color: "inherit" }}>
            <strong>{e.nome}</strong><span>{e.parcelasPagas}/{e.totalParcelas}</span><span style={{ color: "var(--bg)", fontWeight: 700 }}>{e.previsao ? `${MESES_PT_CAP[Number(e.previsao.slice(5, 7)) - 1]?.slice(0, 3)}/${e.previsao.slice(0, 4)}` : "—"}</span>
          </a>)}
        </div>
      </CardShell>

      <CardShell>
        <CardHeader title="Clientes" sub="Situação da base atual" href="/admin/clientes" linkLabel="Ver clientes" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5, padding: "8px 10px" }}>
          {[["Ativas", visao.clientStats.ativas, "var(--ok)"], ["Suspensas", visao.clientStats.suspensas, "var(--gold)"], ["Negativadas", visao.clientStats.negativadas, "var(--bad)"], ["Canceladas", visao.clientStats.canceladas, "var(--soft)"]].map(([label, value, dot]) => <a key={label as string} href="/admin/clientes" style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 7, cursor: "pointer", textDecoration: "none", color: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: dot as string }} /><strong className="zip-mono" style={{ fontSize: 14 }}>{value}</strong></div>
            <div style={{ fontSize: 7.8, color: "var(--soft)", marginTop: 2 }}>{label}</div>
          </a>)}
        </div>
        <div style={{ padding: "0 10px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "2px 0 6px" }}><strong style={{ fontSize: 9.5 }}>Novas clientes</strong><a href="/admin/clientes" style={{ fontSize: 8, color: "var(--bg)", fontWeight: 700 }}>Ver todas →</a></div>
          {visao.novasClientesRecentes.length === 0 ? <div style={{ fontSize: 8, color: "var(--soft)", padding: "5px 0" }}>Nenhum cadastro recente.</div> : visao.novasClientesRecentes.slice(0, 3).map((c) => <a key={c.clienteId} href="/admin/clientes" style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 7, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--line2)", cursor: "pointer", textDecoration: "none", color: "inherit" }}>
            <span style={{ width: 25, height: 25, borderRadius: "50%", background: "var(--s2)", color: "var(--bg)", display: "grid", placeItems: "center", fontSize: 8, fontWeight: 800 }}>{iniciais(c.nome)}</span>
            <div style={{ minWidth: 0 }}><div style={{ fontSize: 9, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.nome}</div><div style={{ fontSize: 8, color: "var(--soft)" }}>{c.cpf} · {dataCurta(c.quando)}</div></div>
            <span style={zipChip("rose")}>{c.status}</span>
          </a>)}
        </div>
      </CardShell>
    </div>

    <CardShell>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}><div><h3 style={{ fontSize: 14 }}>Notificações e monitoramento</h3><div style={{ fontSize: 8.8, color: "var(--soft)", marginTop: 2 }}>Web Push e uso do aplicativo PWA</div></div><a href="/admin/configuracoes?aba=monitoramento" style={{ fontSize: 8.5, color: "var(--bg)", fontWeight: 700 }}>Abrir configurações →</a></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr) 1.7fr", gap: 7, padding: "8px 10px" }}>
        <a href="/admin/configuracoes?aba=notif" style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 8, cursor: "pointer", textDecoration: "none", color: "inherit" }}><div style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={zipIconBox(visao.monitoramento.webPushConfigurado ? "ok" : "neutral", 28)}>✓</span><div><div style={{ fontSize: 9, fontWeight: 700 }}>Web Push</div><div className="zip-mono" style={{ fontSize: 13, fontWeight: 800, marginTop: 2 }}>{visao.monitoramento.webPushConfigurado ? "Ativo" : "Inativo"}</div></div></div><div style={{ fontSize: 7.8, color: "var(--soft)", marginTop: 5 }}>{visao.monitoramento.webPushConfigurado ? "Envio operacional habilitado" : "Aguardando configuração"}</div></a>
        <a href="/admin/configuracoes?aba=notif" style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 8, cursor: "pointer", textDecoration: "none", color: "inherit" }}><div style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={zipIconBox("rose", 28)}>↗</span><div><div style={{ fontSize: 9, fontWeight: 700 }}>Notificações hoje</div><div className="zip-mono" style={{ fontSize: 13, fontWeight: 800, marginTop: 2 }}>{visao.monitoramento.notificacoesHoje}</div></div></div><div style={{ fontSize: 7.8, color: "var(--soft)", marginTop: 5 }}>Web Push enviados hoje</div></a>
        <a href="/admin/configuracoes?aba=monitoramento" style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 8, cursor: "pointer", textDecoration: "none", color: "inherit" }}><div style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={zipIconBox("blue", 28)}>▯</span><div><div style={{ fontSize: 9, fontWeight: 700 }}>PWA instalado</div><div className="zip-mono" style={{ fontSize: 13, fontWeight: 800, marginTop: 2 }}>{visao.monitoramento.pwaInstaladoPercentual}%</div></div></div><div style={{ fontSize: 7.8, color: "var(--soft)", marginTop: 5 }}>{visao.monitoramento.pwaInstalados} de {visao.monitoramento.totalDispositivos} clientes</div></a>
        <a href="/admin/configuracoes?aba=monitoramento" style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 8, cursor: "pointer", textDecoration: "none", color: "inherit" }}><div style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={zipIconBox("rose", 28)}>☻</span><div><div style={{ fontSize: 9, fontWeight: 700 }}>Sem acesso recente</div><div className="zip-mono" style={{ fontSize: 13, fontWeight: 800, marginTop: 2 }}>{visao.monitoramento.semAcessoRecente}</div></div></div><div style={{ fontSize: 7.8, color: "var(--soft)", marginTop: 5 }}>há mais de 7 dias</div></a>
        <div style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><strong style={{ fontSize: 9 }}>Atividade recente</strong><button onClick={() => setAtividadeAberta(true)} style={{ border: 0, background: "transparent", color: "var(--bg)", fontSize: 8, fontWeight: 700 }}>Ver histórico →</button></div>
          {visao.atividadeRecente.slice(0, 3).map((a, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "10px 1fr auto", gap: 6, padding: "5px 0", borderTop: "1px solid var(--line2)", fontSize: 7.8 }}><span style={{ color: "var(--bg)" }}>●</span><span>{a.texto}</span><span style={{ color: "var(--soft)" }}>{a.quando ? new Date(a.quando).toLocaleDateString("pt-BR") : ""}</span></div>)}
        </div>
      </div>
    </CardShell>

    {atividadeAberta && <>
      <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", zIndex: 40 }} onClick={() => setAtividadeAberta(false)} />
      <aside className="zip-animate-slide-in" style={{ position: "fixed", right: 14, top: 14, bottom: 14, width: "min(390px,calc(100vw - 28px))", zIndex: 41, border: "1px solid var(--line)", background: "var(--s0)", borderRadius: 16, boxShadow: "var(--panel-shadow)", overflow: "auto" }}>
        <div style={{ padding: "14px 15px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, position: "sticky", top: 0, background: "var(--s0)", zIndex: 2 }}>
          <div><div style={{ fontSize: 8, fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--rose)" }}>Visão geral</div><h2 style={{ fontSize: 17, marginTop: 3 }}>Atividade recente</h2></div>
          <button onClick={() => setAtividadeAberta(false)} style={{ width: 29, height: 29, border: "1px solid var(--line)", borderRadius: 8, background: "var(--s1)", color: "var(--soft)" }}>×</button>
        </div>
        <div style={{ padding: "14px 15px" }}>
          <div style={{ fontSize: 11, color: "var(--soft)", lineHeight: 1.55 }}>Resumo operacional dos eventos mais recentes registrados no sistema.</div>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
            {visao.atividadeRecente.length === 0 ? <div style={{ fontSize: 10, color: "var(--soft)" }}>Nenhuma atividade registrada ainda.</div> : visao.atividadeRecente.map((a, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 9px", border: "1px solid var(--line2)", borderRadius: 9, background: "var(--s1)", fontSize: 10 }}>
              <span style={{ color: "var(--soft)" }}>{texto(a.usuario, "sistema")}</span><strong style={{ textAlign: "right" }}>{a.texto}</strong>
            </div>)}
          </div>
          <a href="/admin/configuracoes?aba=monitoramento" style={{ marginTop: 13, width: "100%", height: 35, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, border: "1px solid var(--bg)", background: "var(--bg)", color: "var(--on-accent)", fontSize: 10.5, fontWeight: 800, textDecoration: "none" }}>Abrir monitoramento</a>
        </div>
      </aside>
    </>}
  </div>;
}
