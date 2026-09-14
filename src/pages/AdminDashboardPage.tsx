"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { formatarMoeda } from "@/lib/utils";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];

type EventoAgenda = {
  id: string;
  agendamentoId: string;
  clienteId: string;
  nome: string;
  data: string;
  horario: string | null;
  tipo: "termos" | "cirurgia";
  status: string;
};

type DashboardPayload = {
  geradoEm: string;
  periodo: { ano: number; mes: number; inicio: string; fimExclusivo: string; hoje: string };
  kpis: { novasClientesHoje: number; aguardandoCadastro: number; aguardandoConferencia: number; clientesAtivas: number; termosHoje: number; cirurgiasHoje: number };
  clientStats: { ativas: number; suspensas: number; negativadas: number; canceladas: number };
  novasClientesRecentes: { clienteId: string; nome: string; cpf: string; quando: string; status: string }[];
  financeiro: {
    parcelasAbertas: number;
    parcelasVencidas: number;
    aguardandoConferencia: number;
    recebidasNoMes: number;
    semVencimento: number;
    valorAberto: number;
    valorVencido: number;
    valorRecebidoMes: number;
  };
  agenda: {
    resumo: { termosHoje: number; termosMes: number; cirurgiasHoje: number; cirurgiasMes: number; termosPendentesMes: number; proximos7Dias: number };
    dias: { data: string; total: number; termos: number; cirurgias: number; termosPendentes: number }[];
    eventos: EventoAgenda[];
    proximos: EventoAgenda[];
  };
  graficos: {
    financeiroMensal: { mes: string; label: string; previsto: number; recebido: number; vencido: number }[];
    clientesStatus: { id: string; label: string; valor: number }[];
    agendaDiaria: { data: string; total: number; termos: number; cirurgias: number; termosPendentes: number }[];
  };
  comprovantesPendentes: { boletoId: string; clienteId: string; nome: string; numeroParcela: number; totalParcelas: number; valor: number; dataPagamento: string | null }[];
  monitoramento: { webPushConfigurado: boolean; notificacoesHoje: number; totalDispositivos: number; pwaInstalados: number; pwaInstaladoPercentual: number; semAcessoRecente: number };
  atividadeRecente: { texto: string; usuario: string | null; quando: string }[];
};

type Perfil = { nome: string | null; cargo: string | null };

const painel: CSSProperties = {
  border: "1px solid var(--line)",
  background: "var(--panel)",
  borderRadius: 14,
  boxShadow: "var(--sh)",
  overflow: "hidden",
};
const tituloSecao: CSSProperties = { fontSize: 14, margin: 0, fontWeight: 750 };
const suave: CSSProperties = { color: "var(--soft)" };
const botao: CSSProperties = {
  height: 31,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--s0)",
  color: "var(--ink)",
  fontSize: 10.5,
  fontWeight: 700,
  cursor: "pointer",
};

function numero(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dataBr(iso: string | null | undefined) {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : "—";
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return `${p[0]?.[0] ?? ""}${p[1]?.[0] ?? ""}`.toUpperCase() || "—";
}

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <section style={{ ...painel, ...style }}>{children}</section>;
}

function CardHeader({ titulo, subtitulo, href, link }: { titulo: string; subtitulo: string; href?: string; link?: string }) {
  return <div style={{ padding: "11px 12px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
    <div><h2 style={tituloSecao}>{titulo}</h2><div style={{ ...suave, fontSize: 9, marginTop: 2 }}>{subtitulo}</div></div>
    {href && <a href={href} style={{ fontSize: 9, fontWeight: 750, color: "var(--bg)", textDecoration: "none", whiteSpace: "nowrap" }}>{link ?? "Abrir"} →</a>}
  </div>;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "ok" | "warn" | "bad" | "rose" | "neutral" }) {
  const estilos: Record<string, CSSProperties> = {
    ok: { background: "var(--okbg)", color: "var(--ok)" },
    warn: { background: "var(--warnbg, rgba(180,130,25,.12))", color: "var(--gold)" },
    bad: { background: "var(--badbg)", color: "var(--bad)" },
    rose: { background: "var(--robg)", color: "var(--bg)" },
    neutral: { background: "var(--s2)", color: "var(--soft)" },
  };
  return <span style={{ display: "inline-flex", alignItems: "center", minHeight: 19, padding: "0 7px", borderRadius: 99, fontSize: 8.5, fontWeight: 750, whiteSpace: "nowrap", ...estilos[tone] }}>{children}</span>;
}

function Kpi({ titulo, valor, subtitulo, href, tone }: { titulo: string; valor: number; subtitulo: string; href: string; tone: "ok" | "warn" | "bad" | "rose" | "neutral" }) {
  const iconBg = tone === "ok" ? "var(--okbg)" : tone === "bad" ? "var(--badbg)" : tone === "rose" ? "var(--robg)" : "var(--s2)";
  const iconColor = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--gold)" : "var(--bg)";
  return <a href={href} style={{ ...painel, minHeight: 82, padding: "11px 12px", display: "flex", alignItems: "flex-start", gap: 9, textDecoration: "none", color: "inherit" }}>
    <span style={{ width: 29, height: 29, borderRadius: 9, display: "grid", placeItems: "center", background: iconBg, color: iconColor, fontSize: 12, fontWeight: 900 }}>●</span>
    <div style={{ minWidth: 0 }}><div className="zip-mono" style={{ fontSize: 21, fontWeight: 850, lineHeight: 1 }}>{valor}</div><div style={{ fontSize: 10.5, fontWeight: 750, marginTop: 4 }}>{titulo}</div><div style={{ ...suave, fontSize: 8.5, marginTop: 2 }}>{subtitulo}</div></div>
  </a>;
}

function nomeStatus(id: string) {
  if (id === "ativo") return "Ativas";
  if (id === "suspenso") return "Suspensas";
  if (id === "negativado") return "Negativadas";
  if (id === "cancelado") return "Canceladas";
  return id;
}

export default function AdminDashboardPage() {
  const agora = new Date();
  const [ano, setAno] = useState(agora.getFullYear());
  const [mes, setMes] = useState(agora.getMonth() + 1);
  const [dados, setDados] = useState<DashboardPayload | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [diaSelecionado, setDiaSelecionado] = useState<string>("");
  const [mesFinanceiroSelecionado, setMesFinanceiroSelecionado] = useState<string>("");
  const [statusSelecionado, setStatusSelecionado] = useState<string>("ativo");

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const [dashResponse, sessionResponse] = await Promise.all([
        fetch(`/api/admin/visao-geral?ano=${ano}&mes=${mes}`, { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/session", { cache: "no-store", credentials: "same-origin" }).catch(() => null),
      ]);
      const body = await dashResponse.json().catch(() => ({}));
      if (!dashResponse.ok) throw new Error(body.erro ?? "Não foi possível carregar o Dashboard.");
      setDados(body as DashboardPayload);
      if (sessionResponse?.ok) {
        const session = await sessionResponse.json().catch(() => ({}));
        setPerfil({ nome: session.nome ?? null, cargo: session.cargo ?? null });
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o Dashboard.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { void carregar(); }, [ano, mes]);

  useEffect(() => {
    if (!dados) return;
    const hojeNoMes = dados.periodo.hoje >= dados.periodo.inicio && dados.periodo.hoje < dados.periodo.fimExclusivo;
    const primeiroEvento = dados.agenda.dias[0]?.data;
    setDiaSelecionado((atual) => {
      if (atual >= dados.periodo.inicio && atual < dados.periodo.fimExclusivo) return atual;
      return hojeNoMes ? dados.periodo.hoje : primeiroEvento ?? dados.periodo.inicio;
    });
    setMesFinanceiroSelecionado((atual) => dados.graficos.financeiroMensal.some((m) => m.mes === atual) ? atual : (dados.graficos.financeiroMensal.at(-1)?.mes ?? ""));
  }, [dados]);

  function navegarMes(delta: number) {
    let novoMes = mes + delta;
    let novoAno = ano;
    if (novoMes < 1) { novoMes = 12; novoAno -= 1; }
    if (novoMes > 12) { novoMes = 1; novoAno += 1; }
    setAno(novoAno);
    setMes(novoMes);
  }

  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const primeiroDia = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
  const celulas = useMemo(() => [
    ...Array.from({ length: primeiroDia }, () => null as number | null),
    ...Array.from({ length: diasNoMes }, (_, i) => i + 1),
  ], [primeiroDia, diasNoMes]);

  const resumoPorDia = useMemo(() => new Map((dados?.agenda.dias ?? []).map((d) => [d.data, d])), [dados]);
  const eventosDoDia = useMemo(() => (dados?.agenda.eventos ?? []).filter((e) => e.data === diaSelecionado), [dados, diaSelecionado]);
  const financeiroSelecionado = dados?.graficos.financeiroMensal.find((m) => m.mes === mesFinanceiroSelecionado) ?? null;
  const maiorFinanceiro = Math.max(1, ...(dados?.graficos.financeiroMensal ?? []).flatMap((m) => [m.previsto, m.recebido, m.vencido]));
  const maiorStatus = Math.max(1, ...(dados?.graficos.clientesStatus ?? []).map((s) => s.valor));
  const maiorAgenda = Math.max(1, ...(dados?.graficos.agendaDiaria ?? []).map((d) => d.total));
  const statusAtual = dados?.graficos.clientesStatus.find((s) => s.id === statusSelecionado) ?? null;

  if (carregando && !dados) {
    return <div className="zip-admin"><div style={{ ...painel, padding: 24, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Carregando informações reais do Dashboard…</div></div>;
  }

  if (erro && !dados) {
    return <div className="zip-admin"><div style={{ ...painel, padding: 24, textAlign: "center" }}><div style={{ color: "var(--bad)", fontSize: 12, fontWeight: 700 }}>{erro}</div><button onClick={() => void carregar()} style={{ ...botao, marginTop: 12 }}>Tentar novamente</button></div></div>;
  }

  if (!dados) return null;

  const kpis = [
    { titulo: "Novas clientes", valor: dados.kpis.novasClientesHoje, subtitulo: "cadastradas hoje", href: "/admin/clientes", tone: "rose" as const },
    { titulo: "Aguardando cadastro", valor: dados.kpis.aguardandoCadastro, subtitulo: "vendas no funil", href: "/admin/clientes", tone: "warn" as const },
    { titulo: "Aguardando conferência", valor: dados.kpis.aguardandoConferencia, subtitulo: "pagamentos/comprovantes", href: "/admin/financeiro", tone: "warn" as const },
    { titulo: "Clientes ativas", valor: dados.kpis.clientesAtivas, subtitulo: "contratos ativos", href: "/admin/clientes", tone: "ok" as const },
    { titulo: "Termos hoje", valor: dados.kpis.termosHoje, subtitulo: "agenda de termos", href: "/admin/agenda", tone: "rose" as const },
    { titulo: "Cirurgias hoje", valor: dados.kpis.cirurgiasHoje, subtitulo: "data cirúrgica real", href: "/admin/agenda", tone: "rose" as const },
  ];

  return <div className="zip-admin" style={{ paddingBottom: 28 }}>
    <div style={{ position: "sticky", top: 16, zIndex: 20, ...painel, padding: "9px 12px", marginBottom: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div><div style={{ fontSize: 8, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--rose)", fontWeight: 800 }}>SRA. LUCK · BACKOFFICE</div><div style={{ fontSize: 11.5, fontWeight: 750, marginTop: 2 }}>Painel operacional em tempo real</div></div>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Badge tone="ok">● Online</Badge>
        <button onClick={() => void carregar()} disabled={carregando} style={{ ...botao, opacity: carregando ? .55 : 1 }}>{carregando ? "Atualizando…" : "↻ Atualizar"}</button>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--s2)", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 800, color: "var(--bg)" }}>{iniciais(perfil?.nome ?? "Admin")}</div>
        <div style={{ lineHeight: 1.15 }}><div style={{ fontSize: 10.5, fontWeight: 700 }}>{perfil?.nome ?? "Administrativo"}</div><div style={{ fontSize: 8.5, color: "var(--soft)" }}>{perfil?.cargo ?? "Sra. Luck"}</div></div>
      </div>
    </div>

    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
      <div><h1 style={{ fontSize: 27, margin: 0 }}>Dashboard</h1><p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--soft)" }}>Resumo executivo da operação, financeiro, clientes e agenda real.</p></div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button onClick={() => navegarMes(-1)} style={botao}>‹</button>
        <div style={{ ...botao, minWidth: 142, display: "grid", placeItems: "center", cursor: "default" }}>{MESES[mes - 1]} {ano}</div>
        <button onClick={() => navegarMes(1)} style={botao}>›</button>
      </div>
    </div>

    {erro && <div style={{ marginBottom: 10, border: "1px solid var(--badbg)", background: "var(--badbg)", color: "var(--bad)", borderRadius: 10, padding: "8px 10px", fontSize: 10.5 }}>{erro}</div>}

    {dados.financeiro.semVencimento > 0 && <a href="/admin/clientes" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10, padding: "9px 11px", borderRadius: 11, border: "1px solid var(--badbg)", background: "var(--badbg)", color: "var(--bad)", textDecoration: "none", fontSize: 10.5 }}>
      <span><strong>Atenção à qualidade do financeiro:</strong> existem {dados.financeiro.semVencimento} parcela(s) em aberto sem vencimento. Abra a cliente e informe o 1º vencimento para reconstruir o cronograma corretamente.</span><span style={{ fontWeight: 850 }}>Corrigir →</span>
    </a>}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8, marginBottom: 10 }}>
      {kpis.map((k) => <Kpi key={k.titulo} {...k} />)}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(360px,1.35fr) minmax(300px,1fr)", gap: 10, marginBottom: 10 }}>
      <Card>
        <CardHeader titulo="Agenda resumida" subtitulo="Termos cirúrgicos + cirurgias pela data real" href="/admin/agenda" link="Abrir agenda" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(90px,1fr))", gap: 6, padding: "9px 10px 0" }}>
          {[
            ["Termos no mês", dados.agenda.resumo.termosMes],
            ["Cirurgias no mês", dados.agenda.resumo.cirurgiasMes],
            ["Termos pendentes", dados.agenda.resumo.termosPendentesMes],
            ["Próximos 7 dias", dados.agenda.resumo.proximos7Dias],
          ].map(([label, value]) => <div key={String(label)} style={{ border: "1px solid var(--line2)", background: "var(--s1)", borderRadius: 9, padding: 8 }}><div className="zip-mono" style={{ fontSize: 16, fontWeight: 850 }}>{value}</div><div style={{ ...suave, fontSize: 8.3, marginTop: 2 }}>{label}</div></div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(250px,.9fr) minmax(270px,1.1fr)", gap: 10, padding: 10 }}>
          <div style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: 9 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 4 }}>{DIAS.map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 7.5, fontWeight: 750, color: "var(--soft)" }}>{d}</div>)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
              {celulas.map((dia, i) => {
                if (!dia) return <div key={`v-${i}`} style={{ height: 35 }} />;
                const key = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
                const resumo = resumoPorDia.get(key);
                const selecionado = key === diaSelecionado;
                const hoje = key === dados.periodo.hoje;
                return <button key={key} onClick={() => setDiaSelecionado(key)} title={resumo ? `${resumo.termos} termo(s) · ${resumo.cirurgias} cirurgia(s)` : "Sem eventos"} style={{ height: 35, border: `1px solid ${selecionado ? "var(--bg)" : hoje ? "var(--rose)" : "transparent"}`, borderRadius: 8, background: selecionado ? "var(--robg)" : "transparent", color: selecionado ? "var(--bg)" : "var(--ink)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, cursor: "pointer" }}>
                  <span style={{ fontSize: 8.5, fontWeight: selecionado || hoje ? 850 : 650 }}>{dia}</span>
                  <span style={{ display: "flex", gap: 2, minHeight: 4 }}>
                    {Boolean(resumo?.termos) && <span style={{ width: 4, height: 4, borderRadius: 99, background: "var(--bg)" }} />}
                    {Boolean(resumo?.cirurgias) && <span style={{ width: 4, height: 4, borderRadius: 99, background: "var(--ok)" }} />}
                  </span>
                </button>;
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 7, fontSize: 8, color: "var(--soft)" }}><span>● <b style={{ color: "var(--bg)" }}>Termos</b></span><span>● <b style={{ color: "var(--ok)" }}>Cirurgia</b></span></div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 7 }}><div><strong style={{ fontSize: 10.5 }}>{dataBr(diaSelecionado)}</strong><div style={{ ...suave, fontSize: 8.4, marginTop: 2 }}>{eventosDoDia.length ? `${eventosDoDia.length} compromisso(s)` : "Sem compromisso neste dia"}</div></div><Badge tone={eventosDoDia.length ? "rose" : "neutral"}>{eventosDoDia.length}</Badge></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 190, overflow: "auto" }}>
              {(eventosDoDia.length ? eventosDoDia : dados.agenda.proximos.slice(0, 5)).map((evento) => <a key={evento.id} href="/admin/agenda" style={{ display: "grid", gridTemplateColumns: "48px 1fr auto", alignItems: "center", gap: 7, padding: "7px 8px", border: "1px solid var(--line2)", borderRadius: 9, textDecoration: "none", color: "inherit", background: "var(--s1)" }}>
                <div className="zip-mono" style={{ fontSize: 8.5, color: "var(--soft)" }}>{evento.data === diaSelecionado ? (evento.horario ?? "—") : dataBr(evento.data).slice(0, 5)}</div>
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 9.5, fontWeight: 750, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{evento.nome}</div><div style={{ ...suave, fontSize: 8.2, marginTop: 1 }}>{evento.tipo === "cirurgia" ? "Cirurgia confirmada" : "Termos cirúrgicos"}</div></div>
                <Badge tone={evento.tipo === "cirurgia" ? "ok" : evento.status === "assinado" ? "ok" : "warn"}>{evento.tipo === "cirurgia" ? "Cirurgia" : evento.status === "assinado" ? "Assinado" : "A confirmar"}</Badge>
              </a>)}
              {eventosDoDia.length === 0 && dados.agenda.proximos.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--soft)", fontSize: 9.5 }}>Nenhum evento próximo.</div>}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader titulo="Operação financeira" subtitulo="Dados reais das parcelas" href="/admin/financeiro" link="Abrir financeiro" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6, padding: 10 }}>
          {[
            ["Parcelas em aberto", dados.financeiro.parcelasAbertas, formatarMoeda(dados.financeiro.valorAberto)],
            ["Vencidas", dados.financeiro.parcelasVencidas, formatarMoeda(dados.financeiro.valorVencido)],
            ["Aguardando conferência", dados.financeiro.aguardandoConferencia, "fila humana"],
            ["Recebidas no mês", dados.financeiro.recebidasNoMes, formatarMoeda(dados.financeiro.valorRecebidoMes)],
          ].map(([label, value, sub]) => <a href="/admin/financeiro" key={String(label)} style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 9, textDecoration: "none", color: "inherit" }}><div className="zip-mono" style={{ fontSize: 16, fontWeight: 850 }}>{value}</div><div style={{ fontSize: 9, fontWeight: 700, marginTop: 2 }}>{label}</div><div style={{ ...suave, fontSize: 8.2, marginTop: 2 }}>{sub}</div></a>)}
        </div>
        <div style={{ padding: "0 10px 10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}><strong style={{ fontSize: 9.5 }}>Comprovantes para conferir</strong><Badge tone="warn">{dados.comprovantesPendentes.length}</Badge></div>
          {dados.comprovantesPendentes.slice(0, 4).map((item) => <a key={item.boletoId} href="/admin/financeiro" style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 7, padding: "6px 0", borderTop: "1px solid var(--line2)", textDecoration: "none", color: "inherit", alignItems: "center", fontSize: 8.8 }}><strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.nome}</strong><span>{item.numeroParcela}/{item.totalParcelas}</span><span className="zip-mono">{formatarMoeda(item.valor)}</span></a>)}
          {dados.comprovantesPendentes.length === 0 && <div style={{ ...suave, padding: "10px 0", fontSize: 9 }}>Fila de conferência limpa.</div>}
        </div>
      </Card>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(360px,1.25fr) minmax(280px,.75fr)", gap: 10, marginBottom: 10 }}>
      <Card>
        <CardHeader titulo="Fluxo financeiro — interativo" subtitulo="Previsto, recebido e vencido por mês" href="/admin/financeiro" link="Detalhar" />
        <div style={{ padding: "10px 11px" }}>
          <div style={{ height: 176, display: "flex", alignItems: "flex-end", gap: 7, borderBottom: "1px solid var(--line)", padding: "0 4px 5px", overflowX: "auto" }}>
            {dados.graficos.financeiroMensal.map((item) => {
              const on = item.mes === mesFinanceiroSelecionado;
              const previstoH = Math.max(2, (item.previsto / maiorFinanceiro) * 130);
              const recebidoH = Math.max(2, (item.recebido / maiorFinanceiro) * 130);
              const vencidoH = Math.max(0, (item.vencido / maiorFinanceiro) * 130);
              return <button key={item.mes} onClick={() => setMesFinanceiroSelecionado(item.mes)} title={`${item.label} · Previsto ${formatarMoeda(item.previsto)} · Recebido ${formatarMoeda(item.recebido)} · Vencido ${formatarMoeda(item.vencido)}`} style={{ minWidth: 66, height: 158, padding: "0 3px", border: `1px solid ${on ? "var(--bg)" : "transparent"}`, borderRadius: 9, background: on ? "var(--s1)" : "transparent", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", cursor: "pointer" }}>
                <div style={{ height: 132, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 3 }}>
                  <span style={{ width: 13, height: previstoH, borderRadius: "4px 4px 1px 1px", background: "var(--s2)", border: "1px solid var(--line)" }} />
                  <span style={{ width: 13, height: recebidoH, borderRadius: "4px 4px 1px 1px", background: "var(--ok)" }} />
                  <span style={{ width: 7, height: vencidoH, borderRadius: "4px 4px 1px 1px", background: "var(--bad)" }} />
                </div>
                <span style={{ marginTop: 5, fontSize: 8, fontWeight: on ? 850 : 650, color: on ? "var(--bg)" : "var(--soft)" }}>{item.label}</span>
              </button>;
            })}
          </div>
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap", fontSize: 8.2, color: "var(--soft)", marginTop: 7 }}><span>■ Previsto</span><span style={{ color: "var(--ok)" }}>■ Recebido</span><span style={{ color: "var(--bad)" }}>■ Vencido</span></div>
          {financeiroSelecionado && <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 9 }}>
            <div style={{ border: "1px solid var(--line2)", borderRadius: 8, padding: 8 }}><div style={{ ...suave, fontSize: 8 }}>Previsto · {financeiroSelecionado.label}</div><strong className="zip-mono" style={{ fontSize: 11 }}>{formatarMoeda(financeiroSelecionado.previsto)}</strong></div>
            <div style={{ border: "1px solid var(--line2)", borderRadius: 8, padding: 8 }}><div style={{ ...suave, fontSize: 8 }}>Recebido</div><strong className="zip-mono" style={{ fontSize: 11, color: "var(--ok)" }}>{formatarMoeda(financeiroSelecionado.recebido)}</strong></div>
            <div style={{ border: "1px solid var(--line2)", borderRadius: 8, padding: 8 }}><div style={{ ...suave, fontSize: 8 }}>Vencido</div><strong className="zip-mono" style={{ fontSize: 11, color: "var(--bad)" }}>{formatarMoeda(financeiroSelecionado.vencido)}</strong></div>
          </div>}
        </div>
      </Card>

      <Card>
        <CardHeader titulo="Clientes por status — interativo" subtitulo="Clique para destacar uma faixa" href="/admin/clientes" link="Ver clientes" />
        <div style={{ padding: 11, display: "flex", flexDirection: "column", gap: 8 }}>
          {dados.graficos.clientesStatus.map((item) => {
            const on = item.id === statusSelecionado;
            const largura = Math.max(item.valor > 0 ? 5 : 0, Math.round((item.valor / maiorStatus) * 100));
            const cor = item.id === "ativo" ? "var(--ok)" : item.id === "suspenso" ? "var(--gold)" : item.id === "negativado" ? "var(--bad)" : "var(--soft)";
            return <button key={item.id} onClick={() => setStatusSelecionado(item.id)} style={{ border: `1px solid ${on ? "var(--bg)" : "var(--line2)"}`, background: on ? "var(--s1)" : "transparent", borderRadius: 9, padding: "7px 8px", textAlign: "left", cursor: "pointer", color: "inherit" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 9 }}><strong>{item.label}</strong><span className="zip-mono" style={{ fontWeight: 850 }}>{item.valor}</span></div>
              <div style={{ height: 7, background: "var(--s2)", borderRadius: 99, marginTop: 5, overflow: "hidden" }}><div style={{ height: "100%", width: `${largura}%`, background: cor, borderRadius: 99, transition: "width .2s ease" }} /></div>
            </button>;
          })}
          {statusAtual && <div style={{ marginTop: 2, borderTop: "1px solid var(--line)", paddingTop: 8, fontSize: 9.2 }}><strong>{statusAtual.valor}</strong> cliente(s) classificadas como <strong>{nomeStatus(statusAtual.id).toLowerCase()}</strong>.</div>}
        </div>
      </Card>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(360px,1.2fr) minmax(300px,.8fr)", gap: 10, marginBottom: 10 }}>
      <Card>
        <CardHeader titulo="Movimento da agenda — interativo" subtitulo="Dias do mês que concentram termos e cirurgias" href="/admin/agenda" link="Abrir agenda" />
        <div style={{ padding: "10px 11px" }}>
          {dados.graficos.agendaDiaria.length === 0 ? <div style={{ padding: 25, textAlign: "center", fontSize: 9.5, color: "var(--soft)" }}>Nenhum termo ou cirurgia neste mês.</div> : <div style={{ height: 145, display: "flex", alignItems: "flex-end", gap: 4, overflowX: "auto", borderBottom: "1px solid var(--line)", paddingBottom: 5 }}>
            {dados.graficos.agendaDiaria.map((item) => {
              const termosH = Math.max(item.termos ? 5 : 0, (item.termos / maiorAgenda) * 105);
              const cirurgiasH = Math.max(item.cirurgias ? 5 : 0, (item.cirurgias / maiorAgenda) * 105);
              const on = item.data === diaSelecionado;
              return <button key={item.data} onClick={() => setDiaSelecionado(item.data)} title={`${dataBr(item.data)} · ${item.termos} termo(s) · ${item.cirurgias} cirurgia(s)`} style={{ minWidth: 37, height: 130, border: `1px solid ${on ? "var(--bg)" : "transparent"}`, borderRadius: 8, background: on ? "var(--s1)" : "transparent", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", padding: "0 3px", cursor: "pointer" }}>
                <div style={{ height: 108, display: "flex", alignItems: "flex-end", gap: 2 }}><span style={{ width: 9, height: termosH, background: "var(--bg)", borderRadius: "4px 4px 1px 1px" }} /><span style={{ width: 9, height: cirurgiasH, background: "var(--ok)", borderRadius: "4px 4px 1px 1px" }} /></div>
                <span style={{ fontSize: 7.5, marginTop: 4, color: on ? "var(--bg)" : "var(--soft)", fontWeight: on ? 850 : 650 }}>{item.data.slice(8, 10)}</span>
              </button>;
            })}
          </div>}
          <div style={{ marginTop: 7, display: "flex", gap: 12, fontSize: 8.2, color: "var(--soft)" }}><span style={{ color: "var(--bg)" }}>■ Termos</span><span style={{ color: "var(--ok)" }}>■ Cirurgias</span></div>
        </div>
      </Card>

      <Card>
        <CardHeader titulo="Clientes recentes" subtitulo="Últimos cadastros reais" href="/admin/clientes" link="Ver todas" />
        <div style={{ padding: "5px 10px 10px" }}>
          {dados.novasClientesRecentes.slice(0, 5).map((cliente) => <a key={cliente.clienteId} href="/admin/clientes" style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 7, alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--line2)", textDecoration: "none", color: "inherit" }}>
            <span style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--s2)", color: "var(--bg)", display: "grid", placeItems: "center", fontSize: 8, fontWeight: 850 }}>{iniciais(cliente.nome)}</span>
            <div style={{ minWidth: 0 }}><div style={{ fontSize: 9.5, fontWeight: 750, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cliente.nome}</div><div style={{ ...suave, fontSize: 8.2 }}>{cliente.cpf} · {dataBr(cliente.quando)}</div></div>
            <Badge tone={cliente.status === "ativo" ? "ok" : cliente.status === "suspenso" ? "warn" : cliente.status === "negativado" ? "bad" : "neutral"}>{nomeStatus(cliente.status)}</Badge>
          </a>)}
        </div>
      </Card>
    </div>

    <Card>
      <CardHeader titulo="Notificações e monitoramento" subtitulo="Saúde resumida do PWA e Web Push" href="/admin/configuracoes?aba=monitoramento" link="Abrir monitoramento" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 7, padding: 10 }}>
        <a href="/admin/configuracoes?aba=notif" style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 9, textDecoration: "none", color: "inherit" }}><div style={{ fontSize: 9, fontWeight: 750 }}>Web Push</div><strong className="zip-mono" style={{ display: "block", fontSize: 14, marginTop: 3, color: dados.monitoramento.webPushConfigurado ? "var(--ok)" : "var(--bad)" }}>{dados.monitoramento.webPushConfigurado ? "Ativo" : "Inativo"}</strong></a>
        <a href="/admin/configuracoes?aba=notif" style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 9, textDecoration: "none", color: "inherit" }}><div style={{ fontSize: 9, fontWeight: 750 }}>Push enviados hoje</div><strong className="zip-mono" style={{ display: "block", fontSize: 14, marginTop: 3 }}>{dados.monitoramento.notificacoesHoje}</strong></a>
        <a href="/admin/configuracoes?aba=monitoramento" style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 9, textDecoration: "none", color: "inherit" }}><div style={{ fontSize: 9, fontWeight: 750 }}>PWA instalado</div><strong className="zip-mono" style={{ display: "block", fontSize: 14, marginTop: 3 }}>{dados.monitoramento.pwaInstaladoPercentual}%</strong><div style={{ ...suave, fontSize: 8, marginTop: 2 }}>{dados.monitoramento.pwaInstalados} de {dados.monitoramento.totalDispositivos} dispositivos</div></a>
        <a href="/admin/configuracoes?aba=monitoramento" style={{ border: "1px solid var(--line2)", borderRadius: 9, padding: 9, textDecoration: "none", color: "inherit" }}><div style={{ fontSize: 9, fontWeight: 750 }}>Sem acesso recente</div><strong className="zip-mono" style={{ display: "block", fontSize: 14, marginTop: 3 }}>{dados.monitoramento.semAcessoRecente}</strong><div style={{ ...suave, fontSize: 8, marginTop: 2 }}>há mais de 7 dias</div></a>
      </div>
    </Card>
  </div>;
}
