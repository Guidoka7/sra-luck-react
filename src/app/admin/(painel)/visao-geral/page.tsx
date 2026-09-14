"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  History,
  Plus,
  Settings,
  Smartphone,
  Stethoscope,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/admin/ExecutiveUI";
import { formatarMoeda } from "@/lib/utils";

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

const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
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
      preview("f1"), preview("f3"), preview("f5"),
    ]).then(([v, c, f, cfg, agenda, af1, af3, af5]) => {
      if (!ativo) return;
      setVisao({ ...VAZIO, ...v });
      setCirurgias((c.cirurgias ?? []).map((x: any) => ({ id: x.id, nome: x.nome, data: x.data, statusCirurgia: x.statusCirurgia })));
      setForecastMeses(f.meses ?? []);
      setForecastClientes((f.clientes ?? []) as ClienteForecast[]);
      setMetaOrcamento(numero(cfg?.configuracoes?.meta_orcamento_mensal) || 100000);
      setAgendaMeses(agenda.meses ?? []);
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
      const [anoMes, mesMes] = m.mes.split("-");
      return { mes: m.mes, label: `${MESES_PT[Number(mesMes) - 1]?.slice(0, 3)}`, valor, altura: Math.max(4, Math.round((valor / maxValor) * 100)) };
    });
  }, [forecastMeses, forecastClientes, metaOrcamento, isoHoje]);

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
  const celulas = [
    ...Array.from({ length: primeiroDiaSemana }, () => null),
    ...Array.from({ length: diasNoMes }, (_, i) => i + 1),
  ];

  function navegarMes(delta: number) {
    let novoMes = mesSelecionado + delta;
    let novoAno = ano;
    if (novoMes < 1) { novoMes = 12; novoAno -= 1; }
    if (novoMes > 12) { novoMes = 1; novoAno += 1; }
    setMesSelecionado(novoMes);
    if (novoAno !== ano) setAno(novoAno);
  }

  const kpiCards = [
    { label: "Novas clientes", value: String(visao.kpis.novasClientesHoje), sub: "cadastradas hoje", icon: Plus, href: "/admin/clientes" },
    { label: "Aguardando cadastro", value: String(visao.kpis.aguardandoCadastro), sub: "no funil de entrada", icon: ClipboardCheck, href: "/admin/clientes" },
    { label: "Aguardando conferência", value: String(visao.kpis.aguardandoConferencia), sub: "comprovantes", icon: CircleDollarSign, href: "/admin/financeiro?aba=validacao" },
    { label: "Clientes ativas", value: String(visao.kpis.clientesAtivas), sub: "contratos ativos", icon: Users, href: "/admin/clientes" },
    { label: "Termos hoje", value: String(visao.kpis.termosHoje), sub: "confirmados para hoje", icon: FileText, href: "/admin/agenda" },
    { label: "Cirurgias hoje", value: String(visao.kpis.cirurgiasHoje), sub: "confirmadas para hoje", icon: Stethoscope, href: "/admin/agenda" },
  ];

  const acoesRapidas = [
    { icon: Plus, label: "Nova cliente", href: "/admin/clientes" },
    { icon: Wallet, label: "Abrir Financeiro", href: "/admin/financeiro" },
    { icon: CalendarClock, label: "Agenda de termos", href: "/admin/agenda" },
    { icon: FileText, label: "Relatórios", href: "/admin/relatorios" },
    { icon: Settings, label: "Configurações", href: "/admin/configuracoes" },
  ];

  if (carregando) {
    return <div className="space-y-3 pb-8">
      <div className="h-20 animate-pulse rounded-2xl bg-white/60 dark:bg-white/5" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-white/60 dark:bg-white/5" />)}</div>
      <div className="h-80 animate-pulse rounded-2xl bg-white/60 dark:bg-white/5" />
    </div>;
  }

  return <div className="space-y-3 pb-8">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-burgundy dark:text-cream">Dashboard</h1><p className="mt-1 text-xs text-clay/55 dark:text-white/45">Visão geral da operação Sra. Luck. Acompanhe o que exige atenção e acesse rapidamente cada área.</p></div>
      <button onClick={() => setAtividadeAberta(true)} className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-burgundy/15 bg-white/80 text-clay/60 dark:bg-white/5" title="Atividade recente">
        <Bell className="h-4 w-4" />
        {visao.atividadeRecente.length > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-alert px-1 text-[9px] font-bold text-white">{Math.min(9, visao.atividadeRecente.length)}</span>}
      </button>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {kpiCards.map((k) => <Link key={k.label} href={k.href} className="group rounded-xl border border-burgundy/10 bg-white/80 p-3 shadow-sm transition hover:border-rose/30 hover:-translate-y-0.5 dark:border-white/8 dark:bg-white/[0.03]">
        <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blush/60 text-burgundy dark:bg-white/10"><k.icon className="h-3.5 w-3.5" /></span></div>
        <p className="mt-2 text-xl font-bold tracking-tight text-burgundy dark:text-cream">{k.value}</p>
        <p className="text-[0.68rem] font-semibold text-burgundy/80 dark:text-white/70">{k.label}</p>
        <p className="truncate text-[0.6rem] text-clay/45 dark:text-white/35">{k.sub}</p>
      </Link>)}
    </div>

    <div className="grid gap-2.5 lg:grid-cols-[1fr_1.45fr_0.75fr]">
      <Panel className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-white/8 px-3.5 py-2.5"><div><h3 className="text-sm font-semibold text-burgundy dark:text-pearl">Operação de hoje</h3><p className="text-[0.6rem] text-clay/45">Pendências que pedem ação</p></div><Link href="/admin/agenda" className="text-[0.62rem] font-bold text-burgundy">Ver agenda →</Link></div>
        <div className="px-2 py-1">
          {[
            { label: "Comprovantes aguardando conferência", count: visao.kpis.aguardandoConferencia, icon: CircleDollarSign, href: "/admin/financeiro?aba=validacao" },
            { label: "Termos confirmados hoje", count: visao.kpis.termosHoje, icon: FileText, href: "/admin/agenda" },
            { label: "Revisão financeira pendente", count: visao.clientesAguardandoLiberacao.length, icon: ClipboardCheck, href: "/admin/agenda" },
            { label: "Cirurgias do dia", count: visao.kpis.cirurgiasHoje, icon: Stethoscope, href: "/admin/agenda" },
          ].map((o) => <Link key={o.label} href={o.href} className="flex items-center gap-2 border-b border-white/6 px-1 py-2 text-[0.72rem] last:border-0 hover:bg-blush/20 dark:hover:bg-white/[0.02]">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-blush/60 text-burgundy dark:bg-white/10"><o.icon className="h-3 w-3" /></span>
            <span className="flex-1 font-medium text-burgundy dark:text-pearl">{o.label}</span>
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[0.62rem] font-bold text-burgundy">{o.count}</span>
          </Link>)}
        </div>
      </Panel>

      <Panel className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-white/8 px-3.5 py-2.5"><div><h3 className="text-sm font-semibold text-burgundy dark:text-pearl">Agenda</h3><p className="text-[0.6rem] text-clay/45">Termos e cirurgias do mês</p></div><Link href="/admin/agenda" className="text-[0.62rem] font-bold text-burgundy">Abrir agenda →</Link></div>
        <div className="grid grid-cols-1 gap-2 p-2.5 sm:grid-cols-2">
          <div className="rounded-lg border border-white/8 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <button onClick={() => navegarMes(-1)} className="flex h-6 w-6 items-center justify-center rounded-md border border-burgundy/15 text-clay/50"><ChevronLeft className="h-3 w-3" /></button>
              <strong className="text-[0.65rem] text-burgundy dark:text-pearl">{MESES_PT[mesSelecionado - 1]} {ano}</strong>
              <button onClick={() => navegarMes(1)} className="flex h-6 w-6 items-center justify-center rounded-md border border-burgundy/15 text-clay/50"><ChevronRight className="h-3 w-3" /></button>
            </div>
            <div className="grid grid-cols-7 gap-0.5">{DIAS_SEMANA.map((d, i) => <div key={i} className="text-center text-[0.5rem] font-bold text-clay/40">{d}</div>)}</div>
            <div className="mt-0.5 grid grid-cols-7 gap-0.5">{celulas.map((dia, i) => {
              if (dia == null) return <div key={i} />;
              const cor = diasComEvento.get(dia);
              const isHoje = dia === hoje.getDate() && mesSelecionado === hoje.getMonth() + 1 && ano === hoje.getFullYear();
              return <div key={i} className={`flex h-6 flex-col items-center justify-center rounded-md text-[0.55rem] ${isHoje ? "bg-rose/15 font-bold text-burgundy" : "text-burgundy/80 dark:text-pearl/80"}`}>
                <span>{dia}</span>
                <span className={`h-1 w-1 rounded-full ${cor === "ok" ? "bg-success" : cor === "bad" ? "bg-alert" : cor === "rose" ? "bg-rose" : "bg-transparent"}`} />
              </div>;
            })}</div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="rounded-lg border border-white/8 p-2">
              <div className="mb-1 flex items-center justify-between"><strong className="text-[0.65rem] text-burgundy dark:text-pearl">Termos hoje</strong><Link href="/admin/agenda" className="text-[0.58rem] font-bold text-burgundy">Ver todos →</Link></div>
              {visao.termosHojeLista.length === 0 ? <p className="py-2 text-center text-[0.6rem] text-clay/40">Nenhum termo hoje.</p> : visao.termosHojeLista.slice(0, 3).map((t) => <div key={t.agendamentoId} className="flex items-center gap-2 border-t border-white/6 py-1.5 text-[0.62rem]"><span className="font-mono text-clay/50">{t.horario?.slice(0, 5) ?? "—"}</span><span className="flex-1 truncate font-semibold text-burgundy dark:text-pearl">{t.nome}</span><span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[0.55rem] font-bold text-success">Hoje</span></div>)}
            </div>
            <div className="rounded-lg border border-white/8 p-2">
              <div className="mb-1 flex items-center justify-between"><strong className="text-[0.65rem] text-burgundy dark:text-pearl">Cirurgias confirmadas</strong><Link href="/admin/agenda" className="text-[0.58rem] font-bold text-burgundy">Ver todas →</Link></div>
              {cirurgiasHoje.length === 0 ? <p className="py-2 text-center text-[0.6rem] text-clay/40">Nenhuma cirurgia hoje.</p> : cirurgiasHoje.slice(0, 3).map((c) => <div key={c.id} className="flex items-center gap-2 border-t border-white/6 py-1.5 text-[0.62rem]"><span className="flex-1 truncate font-semibold text-burgundy dark:text-pearl">{c.nome}</span><span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[0.55rem] font-bold text-success">Hoje</span></div>)}
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden p-0">
        <div className="border-b border-white/8 px-3.5 py-2.5"><h3 className="text-sm font-semibold text-burgundy dark:text-pearl">Ações rápidas</h3><p className="text-[0.6rem] text-clay/45">Atalhos para tarefas reais do sistema</p></div>
        <div className="grid gap-1.5 p-2.5">{acoesRapidas.map((a) => <Link key={a.label} href={a.href} className="flex h-9 items-center gap-2 rounded-lg border border-burgundy/10 px-2.5 text-[0.68rem] font-semibold text-burgundy hover:border-rose/30 hover:bg-blush/25 dark:border-white/8 dark:text-pearl dark:hover:bg-white/[0.03]"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-blush/60 dark:bg-white/10"><a.icon className="h-3 w-3" /></span><span className="flex-1">{a.label}</span></Link>)}</div>
      </Panel>
    </div>

    <div className="grid gap-2.5 lg:grid-cols-[1.18fr_1fr_0.92fr]">
      <Panel className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-white/8 px-3.5 py-2.5"><div><h3 className="text-sm font-semibold text-burgundy dark:text-pearl">Financeiro</h3><p className="text-[0.6rem] text-clay/45">Conferência e parcelas da operação</p></div><Link href="/admin/financeiro" className="text-[0.62rem] font-bold text-burgundy">Ver financeiro →</Link></div>
        <div className="grid grid-cols-2 gap-1.5 p-2.5 sm:grid-cols-4">
          {[["Parcelas em aberto", f1], ["Vencidas", f3], ["Aguardando conferência", visao.kpis.aguardandoConferencia], ["Comprovantes recebidos", f5]].map(([label, value]) => <Link key={label as string} href="/admin/financeiro" className="rounded-lg border border-white/8 p-2 hover:bg-blush/20"><p className="text-base font-bold text-burgundy dark:text-pearl">{value}</p><p className="text-[0.58rem] text-clay/45">{label}</p></Link>)}
        </div>
        <div className="px-2.5 pb-2.5">
          <div className="mb-1 flex items-center justify-between"><strong className="text-[0.65rem] text-burgundy dark:text-pearl">Comprovantes aguardando conferência</strong><Link href="/admin/financeiro?aba=validacao" className="text-[0.58rem] font-bold text-burgundy">Ver todos →</Link></div>
          <div className="overflow-hidden rounded-lg border border-white/8">
            {visao.comprovantesPendentes.length === 0 ? <p className="p-4 text-center text-[0.62rem] text-clay/40">Fila limpa.</p> : visao.comprovantesPendentes.slice(0, 4).map((r) => <Link key={r.boletoId} href={`/admin/financeiro?aba=validacao&cliente_id=${r.clienteId}`} className="flex items-center gap-2 border-b border-white/6 px-2.5 py-1.5 text-[0.62rem] last:border-0 hover:bg-blush/20">
              <strong className="flex-1 truncate text-burgundy dark:text-pearl">{r.nome}</strong>
              <span className="text-clay/50">{r.numeroParcela}/{r.totalParcelas || "—"}</span>
              <span className="font-mono text-burgundy dark:text-pearl">{formatarMoeda(r.valor)}</span>
              <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[0.55rem] font-bold text-burgundy">Aguardando</span>
            </Link>)}
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-white/8 px-3.5 py-2.5"><div><h3 className="text-sm font-semibold text-burgundy dark:text-pearl">Previsões</h3><p className="text-[0.6rem] text-clay/45">Liberações e próximas elegibilidades</p></div><Link href="/admin/previsoes" className="text-[0.62rem] font-bold text-burgundy">Ver previsões →</Link></div>
        <div className="p-2.5">
          <div className="flex items-center justify-between"><strong className="text-[0.62rem] text-burgundy dark:text-pearl">Liberações previstas</strong><span className="text-[0.55rem] text-clay/45">Referência: {formatarMoeda(metaOrcamento)}</span></div>
          <div className="relative mt-2 flex h-24 items-end gap-1.5 border-b border-white/8 px-1">
            {forecastBarras.length === 0 ? <p className="w-full pb-4 text-center text-[0.6rem] text-clay/40">Sem previsões futuras.</p> : forecastBarras.map((b) => <div key={b.mes} className="flex flex-1 flex-col items-center justify-end gap-1"><span className="text-[0.5rem] font-bold text-burgundy dark:text-pearl">{formatarMoeda(b.valor).replace("R$", "").trim()}</span><div className="w-4/5 rounded-t-md bg-gradient-to-t from-rose/60 to-burgundy" style={{ height: `${b.altura}%` }} title={`${b.label}: ${formatarMoeda(b.valor)}`} /><span className="text-[0.5rem] text-clay/45">{b.label}</span></div>)}
          </div>
        </div>
        <div className="px-2.5 pb-2.5">
          <div className="mb-1 flex items-center justify-between"><strong className="text-[0.62rem] text-burgundy dark:text-pearl">Próximas elegibilidades</strong><Link href="/admin/previsoes" className="text-[0.58rem] font-bold text-burgundy">Ver todas →</Link></div>
          {elegibilidadeProxima.length === 0 ? <p className="py-3 text-center text-[0.6rem] text-clay/40">Nenhuma cliente próxima da elegibilidade.</p> : elegibilidadeProxima.map((e, i) => <Link key={i} href="/admin/previsoes" className="flex items-center gap-2 border-t border-white/6 py-1.5 text-[0.62rem] hover:bg-blush/20"><strong className="flex-1 truncate text-burgundy dark:text-pearl">{e.nome}</strong><span className="text-clay/50">{e.parcelasPagas}/{e.totalParcelas}</span><span className="font-bold text-burgundy">{e.previsao ? `${MESES_PT[Number(e.previsao.slice(5, 7)) - 1]?.slice(0, 3)}/${e.previsao.slice(0, 4)}` : "—"}</span></Link>)}
        </div>
      </Panel>

      <Panel className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-white/8 px-3.5 py-2.5"><div><h3 className="text-sm font-semibold text-burgundy dark:text-pearl">Clientes</h3><p className="text-[0.6rem] text-clay/45">Situação da base atual</p></div><Link href="/admin/clientes" className="text-[0.62rem] font-bold text-burgundy">Ver clientes →</Link></div>
        <div className="grid grid-cols-2 gap-1.5 p-2.5">
          {[["Ativas", visao.clientStats.ativas, "bg-success"], ["Suspensas", visao.clientStats.suspensas, "bg-gold"], ["Negativadas", visao.clientStats.negativadas, "bg-alert"], ["Canceladas", visao.clientStats.canceladas, "bg-clay/50"]].map(([label, value, dot]) => <Link key={label as string} href="/admin/clientes" className="rounded-lg border border-white/8 p-2 hover:bg-blush/20"><div className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${dot}`} /><strong className="text-sm text-burgundy dark:text-pearl">{value}</strong></div><p className="mt-0.5 text-[0.56rem] text-clay/45">{label}</p></Link>)}
        </div>
        <div className="px-2.5 pb-2.5">
          <div className="mb-1 flex items-center justify-between"><strong className="text-[0.62rem] text-burgundy dark:text-pearl">Novas clientes</strong><Link href="/admin/clientes" className="text-[0.58rem] font-bold text-burgundy">Ver todas →</Link></div>
          {visao.novasClientesRecentes.length === 0 ? <p className="py-3 text-center text-[0.6rem] text-clay/40">Nenhum cadastro recente.</p> : visao.novasClientesRecentes.map((c) => <Link key={c.clienteId} href="/admin/clientes" className="flex items-center gap-2 border-t border-white/6 py-1.5 hover:bg-blush/20">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-blush/60 text-[0.55rem] font-bold text-burgundy dark:bg-white/10">{iniciais(c.nome)}</span>
            <div className="min-w-0 flex-1"><p className="truncate text-[0.62rem] font-semibold text-burgundy dark:text-pearl">{c.nome}</p><p className="truncate text-[0.55rem] text-clay/45">{c.cpf} · {dataCurta(c.quando)}</p></div>
            <span className="rounded-full bg-rose/15 px-1.5 py-0.5 text-[0.55rem] font-bold text-burgundy">{c.status}</span>
          </Link>)}
        </div>
      </Panel>
    </div>

    <Panel className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-white/8 px-3.5 py-2.5"><div><h3 className="text-sm font-semibold text-burgundy dark:text-pearl">Notificações e monitoramento</h3><p className="text-[0.6rem] text-clay/45">Web Push e uso do aplicativo PWA</p></div><Link href="/admin/configuracoes" className="text-[0.62rem] font-bold text-burgundy">Abrir configurações →</Link></div>
      <div className="grid grid-cols-2 gap-1.5 p-2.5 sm:grid-cols-5">
        <Link href="/admin/configuracoes" className="rounded-lg border border-white/8 p-2 hover:bg-blush/20"><div className="flex items-center gap-1.5"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-success/10 text-success"><Bell className="h-3 w-3" /></span><div><p className="text-[0.6rem] font-semibold text-burgundy dark:text-pearl">Web Push</p><p className="text-[0.68rem] font-bold text-burgundy dark:text-pearl">{visao.monitoramento.webPushConfigurado ? "Configurado" : "Não configurado"}</p></div></div></Link>
        <Link href="/admin/configuracoes" className="rounded-lg border border-white/8 p-2 hover:bg-blush/20"><div className="flex items-center gap-1.5"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose/10 text-burgundy"><History className="h-3 w-3" /></span><div><p className="text-[0.6rem] font-semibold text-burgundy dark:text-pearl">Notificações hoje</p><p className="text-[0.68rem] font-bold text-burgundy dark:text-pearl">{visao.monitoramento.notificacoesHoje}</p></div></div></Link>
        <Link href="/admin/configuracoes" className="rounded-lg border border-white/8 p-2 hover:bg-blush/20"><div className="flex items-center gap-1.5"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/10 text-blue-600"><Smartphone className="h-3 w-3" /></span><div><p className="text-[0.6rem] font-semibold text-burgundy dark:text-pearl">PWA instalado</p><p className="text-[0.68rem] font-bold text-burgundy dark:text-pearl">{visao.monitoramento.pwaInstaladoPercentual}%</p></div></div><p className="mt-1 text-[0.55rem] text-clay/45">{visao.monitoramento.pwaInstalados} de {visao.monitoramento.totalDispositivos}</p></Link>
        <Link href="/admin/configuracoes" className="rounded-lg border border-white/8 p-2 hover:bg-blush/20"><div className="flex items-center gap-1.5"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose/10 text-burgundy"><UserRound className="h-3 w-3" /></span><div><p className="text-[0.6rem] font-semibold text-burgundy dark:text-pearl">Sem acesso recente</p><p className="text-[0.68rem] font-bold text-burgundy dark:text-pearl">{visao.monitoramento.semAcessoRecente}</p></div></div><p className="mt-1 text-[0.55rem] text-clay/45">há mais de 7 dias</p></Link>
        <div className="rounded-lg border border-white/8 p-2">
          <div className="flex items-center justify-between"><strong className="text-[0.62rem] text-burgundy dark:text-pearl">Atividade recente</strong><button onClick={() => setAtividadeAberta(true)} className="text-[0.58rem] font-bold text-burgundy">Ver histórico →</button></div>
          {visao.atividadeRecente.slice(0, 3).map((a, i) => <div key={i} className="flex items-start gap-1.5 border-t border-white/6 py-1 text-[0.58rem]"><span className="mt-0.5 text-burgundy">●</span><span className="flex-1 truncate text-clay/60 dark:text-white/50">{a.texto}</span></div>)}
        </div>
      </div>
    </Panel>

    {atividadeAberta && <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setAtividadeAberta(false)} />
      <aside className="animate-slideInRight fixed inset-y-0 right-0 z-50 w-full max-w-sm overflow-y-auto border-l border-white/10 bg-white shadow-2xl dark:bg-[#141619]">
        <div className="flex items-start justify-between gap-3 border-b border-white/8 p-4">
          <div><p className="text-[0.6rem] font-bold uppercase tracking-wider text-rose">Visão geral</p><h2 className="mt-1 text-base font-semibold text-burgundy dark:text-pearl">Atividade recente</h2></div>
          <button onClick={() => setAtividadeAberta(false)} className="flex h-7 w-7 items-center justify-center rounded-md border border-burgundy/15 text-clay/50"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="p-4">
          <p className="text-[0.72rem] text-clay/55 dark:text-white/45">Resumo operacional dos eventos mais recentes registrados no sistema.</p>
          <div className="mt-3 space-y-2">
            {visao.atividadeRecente.length === 0 ? <p className="py-4 text-center text-[0.68rem] text-clay/40">Nenhuma atividade registrada ainda.</p> : visao.atividadeRecente.map((a, i) => <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-blush/15 px-3 py-2 dark:bg-white/[0.02]">
              <span className="text-[0.68rem] text-clay/60 dark:text-white/55">{texto(a.usuario, "sistema")}</span>
              <strong className="text-right text-[0.68rem] text-burgundy dark:text-pearl">{a.texto}</strong>
            </div>)}
          </div>
          <Link href="/admin/configuracoes" className="mt-4 flex h-9 items-center justify-center rounded-lg bg-burgundy text-[0.68rem] font-bold text-cream">Abrir monitoramento</Link>
        </div>
      </aside>
    </>}
  </div>;
}
