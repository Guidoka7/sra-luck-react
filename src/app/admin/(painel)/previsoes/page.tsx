"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Panel } from "@/components/admin/ExecutiveUI";
import { fetchInstant, refreshInstant } from "@/lib/instantCache";

type Situacao = "no_ritmo" | "em_risco" | "elegivel" | "sem_previsao" | "sem_regra";
type Confianca = "alta" | "media" | "baixa";

interface Regra {
  parcelas: number;
  percentual: number;
  parcelasNecessarias: number;
}

interface MesForecast {
  mes: string;
  total: number;
  noRitmo: number;
  emRisco: number;
}

interface ClienteForecast {
  clienteId: string;
  nome: string;
  campanha: string | null;
  origem: string | null;
  responsavel: string | null;
  totalParcelas: number;
  percentual: number | null;
  parcelasNecessarias: number | null;
  parcelasPagas: number;
  parcelasRestantes: number | null;
  parcelasVencidas: number;
  primeiroBoletoEm: string | null;
  primeiroVencimento: string | null;
  previsao: string | null;
  atingiuEm: string | null;
  fontePrevisao: "cronograma" | "projecao_mensal" | "sem_base";
  confianca: Confianca;
  situacao: Situacao;
}

interface ForecastData {
  geradoEm: string;
  regras: Regra[];
  resumo: {
    total: number;
    emFormacao: number;
    elegiveis: number;
    emRisco: number;
    semPrevisao: number;
    proximos12Meses: number;
    mesPico: { mes: string; total: number } | null;
  };
  meses: MesForecast[];
  clientes: ClienteForecast[];
  enriquecimento: { contratosDisponiveis: boolean; crmDisponivel: boolean };
}

const HORIZONTES = [12, 24, 60] as const;
const SITUACOES: Array<{ value: "todos" | Situacao; label: string }> = [
  { value: "todos", label: "Todas" },
  { value: "no_ritmo", label: "No ritmo" },
  { value: "em_risco", label: "Em risco" },
  { value: "elegivel", label: "Elegíveis" },
  { value: "sem_previsao", label: "Sem previsão" },
];

function monthIndex(value: string) {
  const [year, month] = value.split("-").map(Number);
  return year * 12 + month - 1;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string | null) {
  if (!value) return "—";
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(new Date(year, month - 1, 1)).replace(" de ", "/");
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "—";
}

function statusMeta(status: Situacao) {
  if (status === "elegivel") return { label: "Elegível agora", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" };
  if (status === "em_risco") return { label: "Em risco", cls: "bg-amber-500/10 text-amber-800 dark:text-amber-300", dot: "bg-amber-500" };
  if (status === "no_ritmo") return { label: "No ritmo", cls: "bg-burgundy/8 text-burgundy dark:bg-rose/10 dark:text-rose", dot: "bg-burgundy dark:bg-rose" };
  return { label: "Sem previsão", cls: "bg-clay/8 text-clay/60 dark:bg-white/5 dark:text-white/45", dot: "bg-clay/35 dark:bg-white/35" };
}

function confidenceLabel(value: Confianca) {
  return value === "alta" ? "Cronograma real" : value === "media" ? "Projeção mensal" : "Base insuficiente";
}

function Kpi({ label, value, helper, icon: Icon, alert = false }: { label: string; value: string; helper: string; icon: typeof Activity; alert?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/82 p-4 shadow-[0_16px_46px_-34px_rgba(122,38,50,.35)] dark:border-white/8 dark:bg-[#171519]/92">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${alert ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-blush text-burgundy dark:bg-white/7 dark:text-rose"}`}><Icon className="h-4 w-4" /></span>
        <p className="text-[9px] font-bold uppercase tracking-[.15em] text-clay/42 dark:text-white/38">{label}</p>
      </div>
      <p className={`mt-3 text-2xl font-semibold tracking-[-.035em] ${alert ? "text-amber-700 dark:text-amber-300" : "text-burgundy dark:text-cream"}`}>{value}</p>
      <p className="mt-1 text-[10px] text-clay/45 dark:text-white/36">{helper}</p>
    </div>
  );
}

export default function PrevisoesPage() {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [horizon, setHorizon] = useState<(typeof HORIZONTES)[number]>(12);
  const [campaign, setCampaign] = useState("todas");
  const [plan, setPlan] = useState("todos");
  const [status, setStatus] = useState<"todos" | Situacao>("todos");
  const [search, setSearch] = useState("");

  async function load(force = false) {
    if (force) setRefreshing(true);
    setError("");
    try {
      const url = "/api/admin/previsao-liberacoes";
      const result = force ? await refreshInstant<ForecastData>(url) : await fetchInstant<ForecastData>(url, undefined, 60_000);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar a previsão de liberações.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const baseMonth = currentMonth();
  const endIndex = monthIndex(baseMonth) + horizon - 1;

  const months = useMemo(() => (data?.meses ?? []).filter((item) => {
    const index = monthIndex(item.mes);
    return index >= monthIndex(baseMonth) && index <= endIndex;
  }), [data, baseMonth, endIndex]);

  const campaigns = useMemo(() => {
    const values = new Set((data?.clientes ?? []).map((item) => item.campanha || "Sem campanha"));
    return [...values].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [data]);

  const clients = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    return (data?.clientes ?? []).filter((item) => {
      if (campaign !== "todas" && (item.campanha || "Sem campanha") !== campaign) return false;
      if (plan !== "todos" && String(item.totalParcelas) !== plan) return false;
      if (status !== "todos" && item.situacao !== status) return false;
      if (item.previsao) {
        const idx = monthIndex(item.previsao.slice(0, 7));
        if (idx > endIndex && item.situacao !== "elegivel") return false;
      }
      if (q && !`${item.nome} ${item.campanha ?? ""} ${item.origem ?? ""} ${item.responsavel ?? ""}`.toLocaleLowerCase("pt-BR").includes(q)) return false;
      return true;
    }).sort((a, b) => {
      if (a.situacao === "elegivel" && b.situacao !== "elegivel") return -1;
      if (b.situacao === "elegivel" && a.situacao !== "elegivel") return 1;
      return String(a.previsao ?? "9999-12-31").localeCompare(String(b.previsao ?? "9999-12-31"));
    });
  }, [data, campaign, plan, status, search, endIndex]);

  const campaignBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of clients) {
      if (!item.previsao || item.situacao === "elegivel") continue;
      const idx = monthIndex(item.previsao.slice(0, 7));
      if (idx < monthIndex(baseMonth) || idx > endIndex) continue;
      const key = item.campanha || "Sem campanha";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [clients, baseMonth, endIndex]);

  const projected = months.reduce((total, item) => total + item.total, 0);
  const risk = clients.filter((item) => item.situacao === "em_risco").length;
  const eligible = clients.filter((item) => item.situacao === "elegivel").length;
  const peak = months.reduce<MesForecast | null>((best, item) => !best || item.total > best.total ? item : best, null);
  const chartMax = Math.max(1, ...months.map((item) => item.total));

  if (loading && !data) {
    return <div className="space-y-4 pb-8"><div className="h-24 animate-pulse rounded-2xl bg-white/60 dark:bg-white/5" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/60 dark:bg-white/5" />)}</div><div className="h-80 animate-pulse rounded-2xl bg-white/60 dark:bg-white/5" /></div>;
  }

  return (
    <div className="space-y-4 pb-8">
      <section className="rounded-2xl border border-white/70 bg-white/82 px-4 py-4 shadow-[0_18px_56px_-40px_rgba(122,38,50,.38)] backdrop-blur-xl dark:border-white/8 dark:bg-[#171519]/92 sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[.22em] text-burgundy/42 dark:text-white/34">Planejamento de capacidade</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-.035em] text-burgundy dark:text-cream">Previsão de liberações</h1>
            <p className="mt-1 max-w-3xl text-[11px] leading-5 text-clay/50 dark:text-white/40">Projeta quando cada contrato deve atingir a quantidade mínima de parcelas pagas e transforma essa previsão em capacidade mensal para agenda e financeiro.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-rose/10 bg-blush/25 p-1 dark:border-white/7 dark:bg-white/[.025]">
              {HORIZONTES.map((item) => <button key={item} type="button" onClick={() => setHorizon(item)} className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold transition ${horizon === item ? "bg-burgundy text-white shadow-sm dark:bg-[#7f3546]" : "text-clay/55 hover:text-burgundy dark:text-white/45"}`}>{item} meses</button>)}
            </div>
            <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-xl border border-burgundy/10 bg-white/80 px-3 text-[10px] font-semibold uppercase tracking-[.12em] text-burgundy transition hover:bg-blush/60 disabled:opacity-60 dark:border-white/8 dark:bg-white/5 dark:text-cream"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Atualizar</button>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-amber-500/20 bg-amber-500/[.06] px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={CalendarClock} label={`Próximos ${horizon} meses`} value={String(projected)} helper="clientes com previsão de elegibilidade" />
        <Kpi icon={Activity} label="Mês de maior demanda" value={peak ? monthLabel(peak.mes) : "—"} helper={peak ? `${peak.total} liberações projetadas` : "sem previsão no horizonte"} />
        <Kpi icon={AlertTriangle} label="Previsões em risco" value={String(risk)} helper="há parcela vencida no caminho" alert={risk > 0} />
        <Kpi icon={CheckCircle2} label="Elegíveis agora" value={String(eligible)} helper="já atingiram a quantidade mínima" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(290px,.65fr)]">
        <Panel className="p-4 dark:border-white/8 dark:bg-[#171519]/92 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-sm font-semibold text-burgundy dark:text-cream">Capacidade futura de liberações</h2><p className="mt-0.5 text-[11px] text-clay/45 dark:text-white/36">Quantidade de clientes previstas para atingir a meta em cada mês.</p></div>
            <span className="rounded-full bg-blush/60 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.12em] text-burgundy dark:bg-white/6 dark:text-rose">{projected} no horizonte</span>
          </div>
          {months.length ? <div className="mt-5 overflow-x-auto pb-1"><div className="flex min-w-[720px] items-end gap-2" style={{ height: 230 }}>{months.map((item) => { const height = Math.max(8, (item.total / chartMax) * 180); const riskHeight = item.total ? (item.emRisco / item.total) * height : 0; return <div key={item.mes} className="flex min-w-[48px] flex-1 flex-col items-center justify-end"><span className="mb-1 text-[10px] font-semibold text-burgundy dark:text-cream">{item.total}</span><div className="relative w-full max-w-[42px] overflow-hidden rounded-t-lg bg-burgundy/85 dark:bg-[#a95d6a]" style={{ height }} title={`${item.total} previstas · ${item.emRisco} em risco`}>{riskHeight > 0 ? <div className="absolute bottom-0 left-0 right-0 bg-amber-400/95" style={{ height: riskHeight }} /> : null}</div><span className="mt-2 whitespace-nowrap text-[9px] text-clay/45 dark:text-white/35">{monthLabel(item.mes)}</span></div>; })}</div><div className="mt-3 flex items-center gap-4 border-t border-rose/10 pt-2 text-[9px] text-clay/45 dark:border-white/6 dark:text-white/35"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-burgundy dark:bg-[#a95d6a]" />No ritmo</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-400" />Com risco de atraso</span></div></div> : <div className="mt-4 rounded-xl border border-dashed border-rose/15 px-4 py-10 text-center text-xs text-clay/45 dark:border-white/8 dark:text-white/35">Ainda não há boletos suficientes para montar a curva de liberações.</div>}
        </Panel>

        <Panel className="p-4 dark:border-white/8 dark:bg-[#171519]/92 sm:p-5">
          <div><h2 className="text-sm font-semibold text-burgundy dark:text-cream">Origem da demanda</h2><p className="mt-0.5 text-[11px] text-clay/45 dark:text-white/36">Campanhas que mais pressionam a agenda no horizonte.</p></div>
          <div className="mt-4 space-y-3">{campaignBreakdown.length ? campaignBreakdown.map((item) => { const max = campaignBreakdown[0]?.value || 1; return <div key={item.label}><div className="flex items-center justify-between gap-3"><span className="truncate text-[11px] font-medium text-clay/65 dark:text-white/58">{item.label}</span><span className="text-[11px] font-semibold text-burgundy dark:text-cream">{item.value}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-blush/55 dark:bg-white/6"><div className="h-full rounded-full bg-burgundy dark:bg-[#a95d6a]" style={{ width: `${Math.max(5, (item.value / max) * 100)}%` }} /></div></div>; }) : <p className="rounded-xl border border-dashed border-rose/15 px-3 py-8 text-center text-[11px] text-clay/40 dark:border-white/8 dark:text-white/32">Campanha ainda não disponível para os contratos previstos.</p>}</div>
          <div className="mt-4 rounded-xl border border-rose/10 bg-blush/20 p-3 text-[10px] leading-4 text-clay/52 dark:border-white/6 dark:bg-white/[.025] dark:text-white/42"><strong className="text-burgundy dark:text-rose">Inteligência do forecast:</strong> a data vem do vencimento da parcela que completa a meta. Quando o cronograma não está completo, o sistema projeta mensalmente a partir do primeiro boleto e identifica a previsão como estimada.</div>
        </Panel>
      </div>

      <Panel className="p-4 dark:border-white/8 dark:bg-[#171519]/92 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div><h2 className="text-sm font-semibold text-burgundy dark:text-cream">Carteira prevista</h2><p className="mt-0.5 text-[11px] text-clay/45 dark:text-white/36">Acompanhe quem deve liberar, de qual campanha veio e o risco de desvio da previsão.</p></div>
          <div className="flex flex-wrap gap-2">
            <label className="relative min-w-[180px] flex-1 xl:flex-none"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-clay/35" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente ou campanha" className="h-9 w-full rounded-xl border border-rose/10 bg-white/75 pl-8 pr-3 text-[11px] text-clay outline-none placeholder:text-clay/30 focus:border-rose/30 dark:border-white/8 dark:bg-white/5 dark:text-cream" /></label>
            <select value={campaign} onChange={(event) => setCampaign(event.target.value)} className="h-9 rounded-xl border border-rose/10 bg-white/75 px-2.5 text-[11px] text-clay outline-none dark:border-white/8 dark:bg-[#1b191d] dark:text-cream"><option value="todas">Todas campanhas</option>{campaigns.map((item) => <option key={item} value={item}>{item}</option>)}</select>
            <select value={plan} onChange={(event) => setPlan(event.target.value)} className="h-9 rounded-xl border border-rose/10 bg-white/75 px-2.5 text-[11px] text-clay outline-none dark:border-white/8 dark:bg-[#1b191d] dark:text-cream"><option value="todos">Todos planos</option>{(data?.regras ?? []).map((item) => <option key={item.parcelas} value={item.parcelas}>{item.parcelas}x</option>)}</select>
            <select value={status} onChange={(event) => setStatus(event.target.value as "todos" | Situacao)} className="h-9 rounded-xl border border-rose/10 bg-white/75 px-2.5 text-[11px] text-clay outline-none dark:border-white/8 dark:bg-[#1b191d] dark:text-cream">{SITUACOES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-rose/10 dark:border-white/7">
          <table className="min-w-[920px] w-full text-left">
            <thead className="bg-blush/35 dark:bg-white/[.035]"><tr className="text-[9px] font-bold uppercase tracking-[.12em] text-clay/45 dark:text-white/38"><th className="px-3 py-2.5">Cliente</th><th className="px-3 py-2.5">Campanha</th><th className="px-3 py-2.5">Plano / meta</th><th className="px-3 py-2.5">Progresso</th><th className="px-3 py-2.5">Previsão</th><th className="px-3 py-2.5">Confiança</th><th className="px-3 py-2.5">Situação</th></tr></thead>
            <tbody className="divide-y divide-rose/8 dark:divide-white/5">{clients.length ? clients.map((item) => { const meta = statusMeta(item.situacao); const needed = item.parcelasNecessarias ?? 0; const progress = needed ? Math.min(100, (item.parcelasPagas / needed) * 100) : 0; return <tr key={item.clienteId} className="bg-white/35 text-[11px] transition hover:bg-blush/25 dark:bg-transparent dark:hover:bg-white/[.025]"><td className="px-3 py-3"><p className="font-semibold text-burgundy dark:text-cream">{item.nome}</p><p className="mt-0.5 text-[9px] text-clay/38 dark:text-white/30">{item.responsavel || "Sem responsável"}</p></td><td className="px-3 py-3"><p className="max-w-[180px] truncate font-medium text-clay/65 dark:text-white/56">{item.campanha || "Sem campanha"}</p><p className="mt-0.5 text-[9px] text-clay/38 dark:text-white/30">{item.origem || "Origem não informada"}</p></td><td className="px-3 py-3"><p className="font-semibold text-burgundy dark:text-cream">{item.totalParcelas || "—"}x</p><p className="mt-0.5 text-[9px] text-clay/42 dark:text-white/32">{item.percentual ? `${item.percentual}% · ${item.parcelasNecessarias} parcelas` : "Regra não definida"}</p></td><td className="px-3 py-3"><div className="flex items-center justify-between gap-2"><span className="font-semibold text-burgundy dark:text-cream">{item.parcelasPagas}/{item.parcelasNecessarias ?? "—"}</span>{item.parcelasVencidas > 0 ? <span className="text-[9px] font-semibold text-amber-700 dark:text-amber-300">{item.parcelasVencidas} vencida{item.parcelasVencidas > 1 ? "s" : ""}</span> : null}</div><div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-blush/70 dark:bg-white/7"><div className={`h-full rounded-full ${item.situacao === "em_risco" ? "bg-amber-400" : "bg-burgundy dark:bg-rose"}`} style={{ width: `${Math.max(item.parcelasPagas ? 5 : 0, progress)}%` }} /></div></td><td className="px-3 py-3"><p className="font-semibold text-burgundy dark:text-cream">{item.situacao === "elegivel" ? "Agora" : dateLabel(item.previsao)}</p><p className="mt-0.5 text-[9px] text-clay/38 dark:text-white/30">{item.situacao === "elegivel" ? `Meta atingida ${dateLabel(item.atingiuEm)}` : item.previsao ? monthLabel(item.previsao.slice(0, 7)) : "Sem data-base"}</p></td><td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-semibold ${item.confianca === "alta" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : item.confianca === "media" ? "bg-burgundy/8 text-burgundy dark:bg-rose/10 dark:text-rose" : "bg-clay/8 text-clay/50 dark:bg-white/5 dark:text-white/40"}`}>{confidenceLabel(item.confianca)}</span></td><td className="px-3 py-3"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-semibold ${meta.cls}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}</span></td></tr>; }) : <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-clay/42 dark:text-white/34">Nenhum contrato encontrado com os filtros atuais.</td></tr>}</tbody>
          </table>
        </div>
      </Panel>

      <Panel className="p-4 dark:border-white/8 dark:bg-[#171519]/92 sm:p-5">
        <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-burgundy/8 text-burgundy dark:bg-rose/10 dark:text-rose"><ShieldCheck className="h-4 w-4" /></span><div><h2 className="text-sm font-semibold text-burgundy dark:text-cream">Regras oficiais de elegibilidade</h2><p className="mt-0.5 text-[11px] text-clay/45 dark:text-white/36">A meta é por quantidade de parcelas quitadas. Valor monetário pago não antecipa a elegibilidade.</p></div></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">{(data?.regras ?? []).map((item) => <div key={item.parcelas} className="rounded-xl border border-rose/10 bg-blush/20 px-3 py-3 text-center dark:border-white/6 dark:bg-white/[.025]"><p className="text-sm font-semibold text-burgundy dark:text-cream">{item.parcelas}x</p><p className="mt-1 text-[10px] text-clay/48 dark:text-white/38">meta {item.percentual}%</p><p className="mt-1 text-[9px] font-semibold uppercase tracking-[.1em] text-burgundy/60 dark:text-rose">{item.parcelasNecessarias} pagas</p></div>)}</div>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] uppercase tracking-[.12em] text-clay/35 dark:text-white/28"><span className="inline-flex items-center gap-1.5"><Users className="h-3 w-3" />Forecast de capacidade, não previsão de lucro</span><span>{data?.geradoEm ? `Atualizado ${new Date(data.geradoEm).toLocaleString("pt-BR")}` : ""}</span></div>
    </div>
  );
}
