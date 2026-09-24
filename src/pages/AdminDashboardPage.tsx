"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle, Bell, CalendarDays, Check, ChevronRight, CircleDollarSign, Clock3,
  FileCheck2, FileText, LayoutDashboard, ReceiptText, Search, ShieldCheck, UserRoundCheck,
  UsersRound, WalletCards, Zap,
} from "lucide-react";
import { formatarMoeda } from "@/lib/utils";
import type { EstagioCentral, VisaoGeralResponse } from "@/features/scheduling/types";
import "@/styles/admin-overview-v2.css";

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
  kpis: {
    novasClientesHoje: number;
    aguardandoCadastro: number;
    aguardandoConferencia: number;
    clientesAtivas: number;
    termosHoje: number;
    cirurgiasHoje: number;
  };
  clientStats: { ativas: number; suspensas: number; negativadas: number; canceladas: number };
  financeiro: {
    parcelasAbertas: number;
    parcelasVencidas: number;
    aguardandoConferencia: number;
    recebidasNoMes: number;
    recebidasSemana?: number;
    clientesInadimplentes?: number;
    clientesProntasAcessoApp?: number;
    semVencimento: number;
    valorAberto: number;
    valorVencido: number;
    valorRecebidoMes: number;
    valorRecebidoSemana?: number;
  };
  agenda: {
    resumo: { termosHoje: number; termosMes: number; cirurgiasHoje: number; cirurgiasMes: number; termosPendentesMes: number; proximos7Dias: number };
    eventos: EventoAgenda[];
    proximos: EventoAgenda[];
  };
  comprovantesPendentes: { boletoId: string; clienteId: string; nome: string; numeroParcela: number; totalParcelas: number; valor: number; dataPagamento: string | null }[];
  monitoramento: { webPushConfigurado: boolean; notificacoesHoje: number; totalDispositivos: number; pwaInstalados: number; pwaInstaladoPercentual: number; semAcessoRecente: number };
  carteira?: {
    clientesAtivos: number;
    valorContratadoAtivo: number;
    ticketMedio: number;
    taxaAdministrativaMedia: number;
    taxaInadimplencia: number;
    parcelasVencidas: number;
    totalParcelas: number;
  };
  resumoClientes?: { total: number };
};

type Perfil = { nome: string | null; cargo: string | null };

type Tone = "bad" | "warn" | "ok";

const stageMeta: Record<EstagioCentral, { label: string; href: string }> = {
  preEligibility: { label: "Próxima da elegibilidade", href: "/admin/agenda" },
  financialReview: { label: "Levantamentos", href: "/admin/agenda" },
  termsConfirmed: { label: "Termos agendados", href: "/admin/agenda?aba=termos" },
  financialRelease: { label: "Liberação cirúrgica", href: "/admin/agenda?aba=liberacao" },
  surgeryConfirmed: { label: "Cirurgia confirmada", href: "/admin/agenda?aba=cirurgia" },
};

function initials(nome: string | null | undefined) {
  const p = String(nome || "Admin").trim().split(/\s+/).filter(Boolean);
  return `${p[0]?.[0] ?? "A"}${p[1]?.[0] ?? ""}`.toUpperCase();
}

function dataExtenso(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  return s.replace(/^./, (c) => c.toUpperCase());
}

function diaCurto(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "").toUpperCase();
}
function addDiasIso(iso: string, dias: number) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

function percent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((value / total) * 100)));
}

function SectionHeader({ icon: Icon, title, subtitle, action }: {
  icon: typeof LayoutDashboard;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return <div className="ov-section-head">
    <div className="ov-section-title">
      <Icon size={17} />
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
    </div>
    {action}
  </div>;
}

function RowIcon({ icon: Icon, tone }: { icon: typeof AlertTriangle; tone?: Tone }) {
  return <span className={`ov-row-icon${tone ? ` ${tone}` : ""}`}><Icon size={15} /></span>;
}

export default function AdminDashboardPage() {
  const now = new Date();
  const [dados, setDados] = useState<DashboardPayload | null>(null);
  const [central, setCentral] = useState<VisaoGeralResponse | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const [dashResponse, centralResponse, sessionResponse] = await Promise.all([
        fetch(`/api/admin/visao-geral?ano=${now.getFullYear()}&mes=${now.getMonth() + 1}`, { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/central/visao-geral", { cache: "no-store", credentials: "same-origin" }).catch(() => null),
        fetch("/api/admin/session", { cache: "no-store", credentials: "same-origin" }).catch(() => null),
      ]);
      const body = await dashResponse.json().catch(() => ({}));
      if (!dashResponse.ok) throw new Error(body.erro ?? "Não foi possível carregar a visão geral.");
      setDados(body as DashboardPayload);
      if (centralResponse?.ok) setCentral(await centralResponse.json() as VisaoGeralResponse);
      if (sessionResponse?.ok) {
        const session = await sessionResponse.json().catch(() => ({}));
        setPerfil({ nome: session.nome ?? null, cargo: session.cargo ?? null });
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a visão geral.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { void carregar(); }, []);

  const filas = central?.filas;
  const totalCentral = useMemo(() => filas ? Object.values(filas).reduce((acc, arr) => acc + arr.length, 0) : 0, [filas]);
  const totalCadastro = dados?.resumoClientes?.total ?? (dados ? Object.values(dados.clientStats).reduce((a, b) => a + b, 0) : 0);

  const funnel = useMemo(() => {
    if (!dados) return [];
    return [
      { key: "cadastro", label: "Cadastro", value: totalCadastro, icon: UsersRound, href: "/admin/clientes" },
      { key: "aguardando", label: "Aguardando cadastro", value: dados.kpis.aguardandoCadastro, icon: FileText, href: "/admin/clientes" },
      { key: "preEligibility", label: stageMeta.preEligibility.label, value: filas?.preEligibility.length ?? 0, icon: FileCheck2, href: stageMeta.preEligibility.href },
      { key: "financialReview", label: stageMeta.financialReview.label, value: filas?.financialReview.length ?? 0, icon: ReceiptText, href: stageMeta.financialReview.href },
      { key: "termsConfirmed", label: stageMeta.termsConfirmed.label, value: filas?.termsConfirmed.length ?? 0, icon: CalendarDays, href: stageMeta.termsConfirmed.href },
      { key: "financialRelease", label: stageMeta.financialRelease.label, value: filas?.financialRelease.length ?? 0, icon: ShieldCheck, href: stageMeta.financialRelease.href },
      { key: "surgeryConfirmed", label: stageMeta.surgeryConfirmed.label, value: filas?.surgeryConfirmed.length ?? 0, icon: Check, href: stageMeta.surgeryConfirmed.href },
    ];
  }, [dados, filas, totalCadastro]);

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const q = busca.trim();
    window.location.href = q ? `/admin/clientes?busca=${encodeURIComponent(q)}` : "/admin/clientes";
  }

  if (carregando && !dados) {
    return <div className="overview-v2"><div className="ov-card ov-empty">Carregando a visão geral…</div></div>;
  }
  if (erro && !dados) {
    return <div className="overview-v2"><div className="ov-card ov-empty"><strong style={{ color: "var(--ov-bad)" }}>{erro}</strong><br /><button className="ov-small-btn" onClick={() => void carregar()} style={{ marginTop: 10 }}>Tentar novamente</button></div></div>;
  }
  if (!dados) return null;

  const proximosTermos = filas?.termsConfirmed.length ?? dados.agenda.proximos.filter((e) => e.tipo === "termos").length;
  const liberacoesFila = filas?.financialRelease ?? [];
  const fim7 = addDiasIso(dados.periodo.hoje, 7);
  const proximasLiberacoes7 = liberacoesFila.filter((c) => c.prazoCirurgico && c.prazoCirurgico >= dados.periodo.hoje && c.prazoCirurgico < fim7 && !c.agendaCirurgicaLiberadaEm).length;
  const liberacoesAtrasadas = liberacoesFila.filter((c) => c.prazoCirurgico && c.prazoCirurgico < dados.periodo.hoje && !c.agendaCirurgicaLiberadaEm).length;
  const recebimentosSemana = dados.financeiro.valorRecebidoSemana ?? dados.financeiro.valorRecebidoMes;
  const inadimplentes = dados.financeiro.clientesInadimplentes ?? dados.financeiro.parcelasVencidas;
  const prontasApp = dados.financeiro.clientesProntasAcessoApp ?? 0;
  const baseFunnel = Math.max(totalCadastro, totalCentral, 1);

  const kpis = [
    { label: "Clientes ativas", value: String(dados.clientStats.ativas), sub: "contratos ativos na carteira", icon: UsersRound, href: "/admin/clientes" },
    { label: "Próximas liberações", value: String(proximasLiberacoes7), sub: "prazos nos próximos 7 dias", icon: ShieldCheck, href: "/admin/agenda?aba=liberacao" },
    { label: "Cirurgias confirmadas no mês", value: String(dados.agenda.resumo.cirurgiasMes), sub: "cirurgias com data no período", icon: CalendarDays, href: "/admin/agenda?aba=cirurgia" },
    { label: "Recebimentos da semana", value: formatarMoeda(recebimentosSemana), sub: `${dados.financeiro.recebidasSemana ?? dados.financeiro.recebidasNoMes} pagamento(s) confirmado(s)`, icon: CircleDollarSign, href: "/admin/financeiro" },
  ];

  const prioridades = [
    { id: "comprovantes", title: "Analisar comprovantes pendentes", sub: "Financeiro · aguardando conferência", count: dados.financeiro.aguardandoConferencia, tone: "bad" as Tone, href: "/admin/financeiro", icon: FileText },
    { id: "app", title: "Liberar acessos prontos no app", sub: "Cadastro com requisitos mínimos completos", count: prontasApp, tone: prontasApp > 0 ? "warn" as Tone : "ok" as Tone, href: "/admin/clientes", icon: UserRoundCheck },
    { id: "termos", title: "Acompanhar termos de hoje", sub: "Assinaturas e confirmações da agenda", count: dados.kpis.termosHoje, tone: dados.kpis.termosHoje > 0 ? "warn" as Tone : "ok" as Tone, href: "/admin/agenda?aba=termos", icon: CalendarDays },
    { id: "liberacoes", title: liberacoesAtrasadas > 0 ? "Tratar liberações com prazo vencido" : "Acompanhar próximas liberações", sub: liberacoesAtrasadas > 0 ? "Prazo V46 já alcançado" : "Prazos V46 dos próximos 7 dias", count: liberacoesAtrasadas > 0 ? liberacoesAtrasadas : proximasLiberacoes7, tone: liberacoesAtrasadas > 0 ? "bad" as Tone : "warn" as Tone, href: "/admin/agenda?aba=liberacao", icon: ShieldCheck },
  ];

  const alertas = [
    { icon: AlertTriangle, tone: inadimplentes > 0 ? "bad" as Tone : "ok" as Tone, title: `${inadimplentes} cliente(s) inadimplente(s)`, sub: `${dados.financeiro.parcelasVencidas} parcela(s) vencida(s) · ${formatarMoeda(dados.financeiro.valorVencido)}`, href: "/admin/financeiro" },
    { icon: ShieldCheck, tone: liberacoesAtrasadas > 0 ? "bad" as Tone : "ok" as Tone, title: `${liberacoesAtrasadas} liberação(ões) fora do prazo`, sub: liberacoesAtrasadas > 0 ? "Exigem conferência operacional" : "Nenhuma liberação vencida", href: "/admin/agenda?aba=liberacao" },
    { icon: UsersRound, tone: dados.monitoramento.semAcessoRecente > 0 ? "warn" as Tone : "ok" as Tone, title: `${dados.monitoramento.semAcessoRecente} dispositivo(s) sem acesso recente`, sub: "Sem atividade registrada há mais de 7 dias", href: "/admin/configuracoes?aba=monitoramento" },
    { icon: Bell, tone: dados.monitoramento.webPushConfigurado ? "ok" as Tone : "warn" as Tone, title: dados.monitoramento.webPushConfigurado ? "Web Push configurado" : "Web Push requer configuração", sub: `${dados.monitoramento.notificacoesHoje} envio(s) registrado(s) hoje`, href: "/admin/notificacoes" },
  ];

  const semanasCirurgia = Array.from({ length: 5 }, (_, i) => ({ label: `Sem ${i + 1}`, total: 0 }));
  for (const evento of dados.agenda.eventos ?? []) {
    if (evento.tipo !== "cirurgia" || !evento.data.startsWith(`${dados.periodo.ano}-${String(dados.periodo.mes).padStart(2, "0")}`)) continue;
    const dia = Number(evento.data.slice(8, 10));
    if (!Number.isFinite(dia) || dia < 1) continue;
    const indice = Math.min(4, Math.floor((dia - 1) / 7));
    semanasCirurgia[indice].total += 1;
  }
  const maxCirurgiasSemana = Math.max(1, ...semanasCirurgia.map((s) => s.total));

  const acoesRapidas: { href: string; icon: typeof UsersRound; label: string; sub: string }[] = [
    { href: "/admin/clientes", icon: UsersRound, label: "Cadastrar cliente", sub: "Abrir cadastro" },
    { href: "/admin/agenda?aba=cirurgia", icon: CalendarDays, label: "Agenda cirúrgica", sub: "Consultar e programar" },
    { href: "/admin/relatorios", icon: ReceiptText, label: "Gerar relatório", sub: "Dados operacionais" },
    { href: "/admin/clube", icon: Zap, label: "Acessar Clube", sub: "Benefícios e missões" },
  ];

  return <div className="overview-v2">
    <div className="ov-topbar">
      <form className="ov-search" onSubmit={submitSearch}>
        <Search size={16} color="var(--ov-muted)" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente, CPF, protocolo ou etapa..." aria-label="Buscar no administrativo" />
        <span className="ov-search-kbd">⌘ K</span>
      </form>
      <div className="ov-profile">
        <a className="ov-notify" href="/admin/notificacoes" aria-label="Notificações">
          <Bell size={17} /><span className="ov-notify-badge">{Math.min(9, dados.financeiro.aguardandoConferencia || 0)}</span>
        </a>
        <span className="ov-avatar">{initials(perfil?.nome)}</span>
        <div className="ov-profile-copy"><strong>{perfil?.nome ?? "Administração"}</strong><span>{perfil?.cargo ?? "Administrativo"}</span></div>
      </div>
    </div>

    <header className="ov-page-head">
      <div><h1>Visão geral</h1><p>Acompanhe a operação do sistema com clareza.</p></div>
      <div className="ov-head-side">
        <div className="ov-date"><CalendarDays size={14} /> {dataExtenso(dados.periodo.hoje)}</div>
        <div className="ov-motto">Disciplina hoje,<br/><strong>mais histórias amanhã.</strong></div>
      </div>
    </header>

    {erro && <div className="ov-card" style={{ marginBottom: 12, padding: "9px 12px", color: "var(--ov-bad)", fontSize: 9 }}>{erro}</div>}

    <section className="ov-kpis">
      {kpis.map(({ icon: Icon, ...item }) => <a key={item.label} href={item.href} className="ov-card ov-kpi ov-kpi-link">
        <div className="ov-kpi-top"><span className="ov-icon"><Icon size={17} /></span><span className="ov-kpi-label">{item.label}</span></div>
        <div><div className="ov-kpi-value">{item.value}</div><div className="ov-kpi-sub">{item.sub}</div></div>
      </a>)}
    </section>

    <div className="ov-main-grid">
      <section className="ov-card">
        <SectionHeader icon={FileCheck2} title="Prioridades de hoje" subtitle="O que precisa de atenção agora." action={<button className="ov-small-btn" onClick={() => void carregar()}>{carregando ? "Atualizando…" : "Atualizar"}</button>} />
        <div className="ov-list">
          {prioridades.map((item) => <a className="ov-row" href={item.href} key={item.id}>
            <RowIcon icon={item.icon} tone={item.tone} />
            <span className="ov-row-main"><strong>{item.title}</strong><span>{item.sub}</span></span>
            <span className={`ov-priority-count ${item.tone}`}>{item.count}</span>
          </a>)}
        </div>
      </section>

      <section className="ov-card ov-funnel">
        <SectionHeader icon={LayoutDashboard} title="Funil operacional" subtitle="Jornada V46 real, da entrada até a cirurgia confirmada." action={<a className="ov-small-btn" href="/admin/agenda" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Ver detalhamento</a>} />
        <div className="ov-funnel-body">
          {funnel.map(({ icon: Icon, ...stage }) => {
            const pct = percent(stage.value, baseFunnel);
            return <a key={stage.key} href={stage.href} className="ov-stage" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="ov-stage-label">{stage.label}</div>
              <div className="ov-stage-count">{stage.value}</div>
              <div className="ov-stage-circle"><Icon size={18} /></div>
              <div className="ov-progress"><span style={{ width: `${pct}%` }} /></div>
              <div className="ov-stage-pct">{pct}%</div>
            </a>;
          })}
        </div>
      </section>
    </div>

    <div className="ov-lower-grid">
      <section className="ov-card">
        <SectionHeader icon={Bell} title="Alertas operacionais" subtitle="Situações reais que merecem acompanhamento." />
        <div className="ov-list">
          {alertas.map((item) => <a className="ov-row" href={item.href} key={item.title}>
            <RowIcon icon={item.icon} tone={item.tone} />
            <span className="ov-row-main"><strong>{item.title}</strong><span>{item.sub}</span></span>
            <ChevronRight size={14} color="var(--ov-muted)" />
          </a>)}
        </div>
      </section>

      <section className="ov-card">
        <SectionHeader icon={CalendarDays} title="Cirurgias no mês" subtitle="Distribuição semanal das datas confirmadas." action={<a className="ov-small-btn" href="/admin/agenda?aba=cirurgia" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Abrir agenda</a>} />
        <div className="ov-surgery-chart">
          <div className="ov-surgery-total"><strong>{dados.agenda.resumo.cirurgiasMes}</strong><span>cirurgia(s) com data no mês</span></div>
          <div className="ov-surgery-bars">
            {semanasCirurgia.map((semana) => <div className="ov-surgery-week" key={semana.label}>
              <div className="ov-surgery-value">{semana.total}</div>
              <div className="ov-surgery-track"><span style={{ height: `${Math.max(5, Math.round((semana.total / maxCirurgiasSemana) * 100))}%` }} /></div>
              <div className="ov-surgery-label">{semana.label}</div>
            </div>)}
          </div>
        </div>
      </section>

      <section className="ov-card">
        <SectionHeader icon={Zap} title="Ações rápidas" subtitle="Atalhos para rotinas frequentes." />
        <div className="ov-action-list">
          {acoesRapidas.map(({ href, icon: Icon, label, sub }) => <a className="ov-action ov-action-wide" href={href} key={label}><span className="ov-row-icon"><Icon size={15} /></span><span><strong>{label}</strong><small>{sub}</small></span><ChevronRight size={13} style={{ marginLeft: "auto" }} /></a>)}
        </div>
      </section>
    </div>
  </div>;
}
