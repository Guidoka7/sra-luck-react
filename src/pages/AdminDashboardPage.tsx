"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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

function percent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((value / total) * 100)));
}

function SectionHeader({ icon: Icon, title, subtitle, action }: {
  icon: typeof LayoutDashboard;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
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
  const [feitas, setFeitas] = useState<Record<string, boolean>>({});

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
  const liberacoes = filas?.financialRelease.length ?? 0;
  const recebimentosSemana = dados.financeiro.valorRecebidoSemana ?? dados.financeiro.valorRecebidoMes;
  const inadimplentes = dados.financeiro.clientesInadimplentes ?? dados.financeiro.parcelasVencidas;
  const prontasApp = dados.financeiro.clientesProntasAcessoApp ?? 0;
  const taxaInadimplencia = dados.carteira?.taxaInadimplencia ?? 0;
  const baseFunnel = Math.max(totalCadastro, totalCentral, 1);

  const kpis = [
    { label: "Clientes ativas", value: String(dados.clientStats.ativas), sub: "contratos ativos", icon: UsersRound, href: "/admin/clientes" },
    { label: "Comprovantes aguardando análise", value: String(dados.financeiro.aguardandoConferencia), sub: "fila financeira atual", icon: FileText, href: "/admin/financeiro" },
    { label: "Próximos termos agendados", value: String(proximosTermos), sub: "clientes com data escolhida", icon: CalendarDays, href: "/admin/agenda?aba=termos" },
    { label: "Liberações financeiras em andamento", value: String(liberacoes), sub: "comparecimento + quitação", icon: WalletCards, href: "/admin/agenda?aba=liberacao" },
    { label: "Recebimentos da semana", value: formatarMoeda(recebimentosSemana), sub: `${dados.financeiro.recebidasSemana ?? dados.financeiro.recebidasNoMes} recebimento(s) confirmado(s)`, icon: CircleDollarSign, href: "/admin/financeiro" },
  ];

  const prioridades = [
    { id: "comprovantes", text: `Analisar ${dados.financeiro.aguardandoConferencia} comprovante(s) pendente(s)`, meta: "Financeiro", tone: "bad" as Tone, href: "/admin/financeiro" },
    { id: "app", text: `Liberar ${prontasApp} acesso(s) no app`, meta: "Cadastro validado", tone: "bad" as Tone, href: "/admin/clientes" },
    { id: "termos", text: `Confirmar ${proximosTermos} atendimento(s) de termos`, meta: "Agenda", tone: "warn" as Tone, href: "/admin/agenda?aba=termos" },
    { id: "liberacoes", text: `Validar ${liberacoes} liberação(ões) cirúrgica(s)`, meta: "5 dias úteis", tone: "warn" as Tone, href: "/admin/agenda?aba=liberacao" },
  ];

  const alertas = [
    { icon: AlertTriangle, tone: "bad" as Tone, title: `${inadimplentes} cliente(s) inadimplente(s)`, sub: `${dados.financeiro.parcelasVencidas} parcela(s) vencida(s)`, href: "/admin/financeiro" },
    { icon: FileText, tone: "warn" as Tone, title: `${dados.financeiro.aguardandoConferencia} comprovante(s) pendente(s)`, sub: "Aguardando análise da equipe financeira", href: "/admin/financeiro" },
    { icon: UserRoundCheck, tone: "ok" as Tone, title: `${prontasApp} cliente(s) pronta(s) para acesso no app`, sub: "Requisitos mínimos preenchidos", href: "/admin/clientes" },
    { icon: CalendarDays, tone: "warn" as Tone, title: `${proximosTermos} atendimento(s) de termos aguardando execução`, sub: "Acompanhe datas e responsáveis", href: "/admin/agenda?aba=termos" },
  ];

  const financeiros = [
    { label: "Inadimplência", value: `${taxaInadimplencia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, sub: `${inadimplentes} cliente(s)`, width: Math.min(100, taxaInadimplencia * 5) },
    { label: "Parcelas vencidas", value: String(dados.financeiro.parcelasVencidas), sub: formatarMoeda(dados.financeiro.valorVencido), width: percent(dados.financeiro.parcelasVencidas, Math.max(dados.financeiro.parcelasAbertas, 1)) },
    { label: "Negativadas", value: String(dados.clientStats.negativadas), sub: "clientes", width: percent(dados.clientStats.negativadas, Math.max(totalCadastro, 1)) },
    { label: "Recebimentos confirmados", value: formatarMoeda(recebimentosSemana), sub: "esta semana", width: 82 },
  ];

  const proximos = dados.agenda.proximos.slice(0, 3);

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
      <div><h1>Visão geral</h1><p>Acompanhe a operação central do sistema com clareza e sem poluição visual.</p></div>
      <div className="ov-date"><CalendarDays size={14} /> {dataExtenso(dados.periodo.hoje)}</div>
    </header>

    {erro && <div className="ov-card" style={{ marginBottom: 12, padding: "9px 12px", color: "var(--ov-bad)", fontSize: 9 }}>{erro}</div>}

    <section className="ov-kpis">
      {kpis.map(({ icon: Icon, ...item }) => <a key={item.label} href={item.href} className="ov-card ov-kpi ov-kpi-link">
        <div className="ov-kpi-top"><span className="ov-icon"><Icon size={17} /></span><span className="ov-kpi-label">{item.label}</span></div>
        <div><div className="ov-kpi-value">{item.value}</div><div className="ov-kpi-sub">{item.sub}</div></div>
      </a>)}
    </section>

    <section className="ov-card ov-funnel">
      <SectionHeader icon={LayoutDashboard} title="Funil operacional" subtitle="Acompanhe quantas clientes estão em cada etapa real da jornada." action={<button className="ov-small-btn" onClick={() => void carregar()}>{carregando ? "Atualizando…" : "Atualizar"}</button>} />
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

    <div className="ov-grid-three">
      <section className="ov-card">
        <SectionHeader icon={FileCheck2} title="Prioridades de hoje" subtitle="O que precisa de atenção agora." />
        <div className="ov-list">
          {prioridades.map((item) => <div className="ov-row" key={item.id}>
            <button type="button" className={`ov-checkbox${feitas[item.id] ? " done" : ""}`} onClick={() => setFeitas((v) => ({ ...v, [item.id]: !v[item.id] }))} aria-label={feitas[item.id] ? "Marcar como pendente" : "Marcar como concluída"}>{feitas[item.id] && <Check size={11} />}</button>
            <a className="ov-row-main" href={item.href} style={{ textDecoration: "none" }}><strong>{item.text}</strong><span>{item.meta}</span></a>
            <span className={`ov-tag ${item.tone}`}>{item.tone === "bad" ? "Alta" : "Média"}</span>
          </div>)}
        </div>
      </section>

      <section className="ov-card">
        <SectionHeader icon={Bell} title="Alertas operacionais" subtitle="Situações que merecem acompanhamento." />
        <div className="ov-list">
          {alertas.map((item) => <a className="ov-row" href={item.href} key={item.title}>
            <RowIcon icon={item.icon} tone={item.tone} />
            <span className="ov-row-main"><strong>{item.title}</strong><span>{item.sub}</span></span>
            <ChevronRight size={14} color="var(--ov-muted)" />
          </a>)}
        </div>
      </section>

      <section className="ov-card">
        <SectionHeader icon={CircleDollarSign} title="Visão do financeiro" subtitle="Leitura rápida da saúde financeira." action={<a className="ov-small-btn" href="/admin/financeiro" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Ver detalhes</a>} />
        <div className="ov-finance">
          {financeiros.map((item) => <div className="ov-fin-row" key={item.label}>
            <div className="ov-fin-top"><span>{item.label}</span><strong>{item.value}</strong></div>
            <div className="ov-fin-sub">{item.sub}</div>
            <div className="ov-fin-bar"><span style={{ width: `${Math.max(3, item.width)}%` }} /></div>
          </div>)}
        </div>
      </section>
    </div>

    <div className="ov-bottom">
      <section className="ov-card">
        <SectionHeader icon={CalendarDays} title="Próximos atendimentos" subtitle="Termos e cirurgias dos próximos dias." action={<a className="ov-small-btn" href="/admin/agenda" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Ver agenda</a>} />
        <div className="ov-appointments">
          {proximos.length ? proximos.map((evento) => <a className="ov-appointment" href={evento.tipo === "cirurgia" ? `/admin/agenda?aba=cirurgia&data=${evento.data}` : `/admin/agenda?aba=termos&data=${evento.data}`} key={evento.id}>
            <span className="ov-time"><strong>{diaCurto(evento.data)}</strong><span>{evento.horario ?? "—"}</span></span>
            <span className="ov-client"><strong>{evento.nome}</strong><span>{evento.tipo === "cirurgia" ? "Cirurgia confirmada" : "Assinatura de termos"}</span></span>
            <span className={`ov-tag ${evento.tipo === "cirurgia" ? "ok" : "warn"}`}>{evento.tipo === "cirurgia" ? "Cirurgia" : "Termos"}</span>
            <ChevronRight size={14} color="var(--ov-muted)" />
          </a>) : <div className="ov-empty">Nenhum atendimento próximo.</div>}
        </div>
      </section>

      <section className="ov-card">
        <SectionHeader icon={Zap} title="Ações rápidas" subtitle="Atalhos para as rotinas mais usadas." />
        <div className="ov-action-grid">
          {[
            ["/admin/clientes", UsersRound, "Cadastrar cliente"],
            ["/admin/financeiro", FileText, "Analisar comprovantes"],
            ["/admin/agenda", CalendarDays, "Abrir agenda"],
            ["/admin/financeiro", WalletCards, "Ver financeiro"],
            ["/admin/agenda", Search, "Consultar processo"],
            ["/admin/relatorios", ReceiptText, "Criar relatório"],
          ].map(([href, Icon, label]) => <a className="ov-action" href={String(href)} key={String(label)}><span className="ov-row-icon"><Icon size={15} /></span><span>{String(label)}</span><ChevronRight size={13} style={{ marginLeft: "auto" }} /></a>)}
        </div>
      </section>
    </div>
  </div>;
}
