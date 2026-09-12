"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Download,
  FileText,
  Filter,
  Layers3,
  MessageSquareText,
  MoreVertical,
  PieChart,
  RefreshCw,
  Search,
  ShoppingCart,
  Target,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { fetchInstant, refreshInstant } from "@/lib/instantCache";
import { formatarMoeda } from "@/lib/utils";

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

interface ParcelaForecast {
  numero: number;
  status: string;
  vencimento: string | null;
  pagamento: string | null;
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
  valorCarta?: number | null;
  dataVenda?: string | null;
  codigoContrato?: string | null;
  parcelas?: ParcelaForecast[];
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

const DEFAULT_RULES: Regra[] = [
  { parcelas: 12, percentual: 60, parcelasNecessarias: 8 },
  { parcelas: 18, percentual: 60, parcelasNecessarias: 11 },
  { parcelas: 24, percentual: 60, parcelasNecessarias: 15 },
  { parcelas: 36, percentual: 70, parcelasNecessarias: 26 },
  { parcelas: 48, percentual: 80, parcelasNecessarias: 39 },
  { parcelas: 60, percentual: 80, parcelasNecessarias: 48 },
  { parcelas: 72, percentual: 80, parcelasNecessarias: 58 },
];

const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PLAN_ACCENTS: Record<number, string> = {
  12: "bg-[#f8d7d0]",
  18: "bg-[#efd8e4]",
  24: "bg-[#f4d5b6]",
  36: "bg-[#e9c8d6]",
  48: "bg-[#e9ddd5]",
  60: "bg-[#cfe7e5]",
  72: "bg-[#dedce2]",
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthIndex(value: string) {
  const [year, month] = value.split("-").map(Number);
  return year * 12 + month - 1;
}

function shiftMonth(value: string, delta: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLong(value: string) {
  const [year, month] = value.split("-").map(Number);
  return `${MONTH_NAMES[month - 1] ?? value} de ${year}`;
}

function monthShort(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return `${MONTH_NAMES[month - 1]?.slice(0, 3) ?? ""}/${String(year).slice(-2)}`;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "—";
}

function addMonthsIso(value: string, amount: number) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1 + amount, 1));
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day || 1, last));
  return base.toISOString().slice(0, 10);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CL";
}

function money(value: number | null | undefined) {
  return value && value > 0 ? formatarMoeda(value) : "—";
}

function percentageChange(current: number, previous: number) {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function statusMeta(status: Situacao) {
  if (status === "elegivel") return { label: "Elegível", className: "bg-emerald-500/10 text-emerald-700", dot: "bg-emerald-500" };
  if (status === "em_risco") return { label: "Em risco", className: "bg-red-500/10 text-red-700", dot: "bg-red-500" };
  if (status === "no_ritmo") return { label: "Prevista", className: "bg-emerald-500/10 text-emerald-700", dot: "bg-emerald-500" };
  return { label: "Sem previsão", className: "bg-clay/10 text-clay/60", dot: "bg-clay/35" };
}

function forecastSource(client: ClienteForecast) {
  if (client.fontePrevisao === "cronograma") return "Cronograma real";
  if (client.fontePrevisao === "projecao_mensal") return "Projeção mensal";
  return "Base insuficiente";
}

function buildCalendar(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { iso, day: date.getDate(), inMonth: date.getMonth() === month - 1 };
  });
}

function buildTimeline(client: ClienteForecast) {
  const total = Math.max(client.totalParcelas || 0, client.parcelasNecessarias || 0);
  const base = client.primeiroVencimento || client.primeiroBoletoEm || client.previsao;
  const byNumber = new Map((client.parcelas ?? []).map((item) => [item.numero, item]));
  return Array.from({ length: total }, (_, index) => {
    const number = index + 1;
    const existing = byNumber.get(number);
    const due = existing?.vencimento || (base ? addMonthsIso(base, index) : null);
    const paid = existing ? existing.status === "pago" : number <= client.parcelasPagas;
    return { number, due, paid, target: number === client.parcelasNecessarias };
  });
}

function MiniDelta({ value, helper }: { value: number | null; helper: string }) {
  if (value == null) return <span className="text-[9px] text-clay/40">base atual</span>;
  const positive = value >= 0;
  return <span className={`inline-flex items-center gap-1 text-[9px] font-semibold ${positive ? "text-emerald-600" : "text-red-600"}`}><span>↑</span>{Math.abs(value).toFixed(0)}% <span className="font-normal text-clay/42">{helper}</span></span>;
}

function KpiCard({ icon: Icon, label, value, delta, helper, tone = "rose" }: { icon: LucideIcon; label: string; value: string; delta?: number | null; helper: string; tone?: "rose" | "gold" | "alert" }) {
  const toneClass = tone === "alert" ? "bg-red-50 text-red-700" : tone === "gold" ? "bg-[#fff0d7] text-burgundy" : "bg-[#fde8e7] text-burgundy";
  return (
    <div className="rounded-xl border border-[#efdede] bg-gradient-to-br from-[#fff9f8] to-[#fcecec] px-3.5 py-3 shadow-[0_10px_30px_-26px_rgba(91,19,36,.35)]">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneClass}`}><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-burgundy/85">{label}</p>
          <div className="mt-0.5 flex flex-wrap items-end gap-x-2 gap-y-1"><strong className="text-[1.45rem] leading-none tracking-[-.04em] text-burgundy">{value}</strong>{delta !== undefined ? <MiniDelta value={delta ?? null} helper={helper} /> : <span className="text-[9px] text-clay/42">{helper}</span>}</div>
        </div>
      </div>
    </div>
  );
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "h-12 w-12 text-sm" : size === "sm" ? "h-8 w-8 text-[9px]" : "h-9 w-9 text-[10px]";
  return <span className={`flex shrink-0 items-center justify-center rounded-full border border-rose/15 bg-gradient-to-br from-[#f8d8d4] to-[#f1b8bd] font-bold text-burgundy shadow-sm ${sizeClass}`}>{initials(name)}</span>;
}

function ModalShell({ children, onClose, wide = false }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-end bg-[#1b1518]/45 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Fechar" />
      <div className={`relative z-10 h-full overflow-y-auto border-l border-white/60 bg-[#fffdfc] shadow-[-30px_0_80px_-36px_rgba(55,14,26,.45)] ${wide ? "w-full xl:w-[78%] 2xl:w-[72%]" : "w-full xl:w-[72%] 2xl:w-[68%]"}`}>
        {children}
      </div>
    </div>
  );
}

export default function PrevisoesPage() {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [campaign, setCampaign] = useState("todas");
  const [seller, setSeller] = useState("todas");
  const [planFilter, setPlanFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedPortfolio, setSelectedPortfolio] = useState<number | null>(null);
  const [selectedClient, setSelectedClient] = useState<ClienteForecast | null>(null);
  const [portfolioPage, setPortfolioPage] = useState(1);

  async function load(force = false) {
    if (force) setRefreshing(true);
    setError("");
    try {
      const url = "/api/admin/previsao-liberacoes";
      const result = force ? await refreshInstant<ForecastData>(url) : await fetchInstant<ForecastData>(url, undefined, 60_000);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as previsões de liberação.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => { setSelectedDay(null); setPortfolioPage(1); }, [selectedMonth]);

  const rules = data?.regras?.length ? data.regras : DEFAULT_RULES;
  const allClients = data?.clientes ?? [];
  const campaigns = useMemo(() => [...new Set(allClients.map((item) => item.campanha || "Sem campanha"))].sort((a, b) => a.localeCompare(b, "pt-BR")), [allClients]);
  const sellers = useMemo(() => [...new Set(allClients.map((item) => item.responsavel || "Sem vendedora"))].sort((a, b) => a.localeCompare(b, "pt-BR")), [allClients]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    return allClients.filter((client) => {
      if (campaign !== "todas" && (client.campanha || "Sem campanha") !== campaign) return false;
      if (seller !== "todas" && (client.responsavel || "Sem vendedora") !== seller) return false;
      if (planFilter !== "todos" && String(client.totalParcelas) !== planFilter) return false;
      if (statusFilter !== "todos" && client.situacao !== statusFilter) return false;
      if (q && !`${client.nome} ${client.campanha ?? ""} ${client.responsavel ?? ""}`.toLocaleLowerCase("pt-BR").includes(q)) return false;
      return true;
    });
  }, [allClients, campaign, seller, planFilter, statusFilter, search]);

  const releaseMonthClients = useMemo(() => filteredClients.filter((client) => client.previsao?.slice(0, 7) === selectedMonth), [filteredClients, selectedMonth]);
  const previousReleaseMonthClients = useMemo(() => allClients.filter((client) => client.previsao?.slice(0, 7) === shiftMonth(selectedMonth, -1)), [allClients, selectedMonth]);
  const salesMonthClients = useMemo(() => filteredClients.filter((client) => (client.dataVenda || client.primeiroBoletoEm || client.primeiroVencimento)?.slice(0, 7) === selectedMonth), [filteredClients, selectedMonth]);
  const previousSalesMonthClients = useMemo(() => allClients.filter((client) => (client.dataVenda || client.primeiroBoletoEm || client.primeiroVencimento)?.slice(0, 7) === shiftMonth(selectedMonth, -1)), [allClients, selectedMonth]);

  const nextMonths = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftMonth(selectedMonth, index)), [selectedMonth]);
  const chartData = useMemo(() => nextMonths.map((month) => {
    const clients = filteredClients.filter((client) => client.previsao?.slice(0, 7) === month);
    return { month, count: clients.length, value: clients.reduce((sum, client) => sum + Number(client.valorCarta || 0), 0) };
  }), [filteredClients, nextMonths]);
  const maxChart = Math.max(1, ...chartData.map((item) => item.count));
  const projectedNext6 = chartData.slice(0, 6).reduce((sum, item) => sum + item.count, 0);
  const projectedValueNext6 = chartData.slice(0, 6).reduce((sum, item) => sum + item.value, 0);
  const riskCount = releaseMonthClients.filter((client) => client.situacao === "em_risco").length;

  const releaseByDate = useMemo(() => {
    const map = new Map<string, ClienteForecast[]>();
    for (const client of releaseMonthClients) {
      if (!client.previsao) continue;
      const key = client.previsao.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), client]);
    }
    return map;
  }, [releaseMonthClients]);

  const calendar = useMemo(() => buildCalendar(selectedMonth), [selectedMonth]);
  const selectedDayClients = selectedDay ? releaseByDate.get(selectedDay) ?? [] : [];

  const portfolioClients = useMemo(() => selectedPortfolio == null ? [] : releaseMonthClients
    .filter((client) => client.totalParcelas === selectedPortfolio)
    .sort((a, b) => String(a.previsao || "").localeCompare(String(b.previsao || ""))), [releaseMonthClients, selectedPortfolio]);
  const selectedRule = rules.find((rule) => rule.parcelas === selectedPortfolio) ?? null;
  const portfolioValue = portfolioClients.reduce((sum, client) => sum + Number(client.valorCarta || 0), 0);
  const pageSize = 8;
  const portfolioPages = Math.max(1, Math.ceil(portfolioClients.length / pageSize));
  const pagedPortfolioClients = portfolioClients.slice((portfolioPage - 1) * pageSize, portfolioPage * pageSize);

  const timeline = selectedClient ? buildTimeline(selectedClient) : [];
  const today = new Date().toISOString().slice(0, 10);

  if (loading && !data) {
    return <div className="space-y-3 pb-8"><div className="h-24 animate-pulse rounded-xl bg-white/70" /><div className="grid gap-3 xl:grid-cols-4">{[1,2,3,4].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-white/70" />)}</div><div className="h-[560px] animate-pulse rounded-xl bg-white/70" /></div>;
  }

  return (
    <div className="pb-8 text-[#3f3034]">
      <div className="mb-3 flex flex-col gap-3 rounded-xl border border-[#eadedf] bg-white/90 px-4 py-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <label className="relative w-full max-w-[370px]"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-clay/35" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, campanha, vendedora..." className="h-9 w-full rounded-lg border border-[#eadedf] bg-[#fffdfc] pl-9 pr-3 text-[11px] outline-none transition focus:border-burgundy/30" /></label>
        <div className="flex items-center gap-2 text-[10px] text-clay/50"><span className="h-2 w-2 rounded-full bg-emerald-500" />Previsão calculada pelos boletos registrados</div>
      </div>

      <section className="mb-3 flex flex-col gap-3 rounded-xl border border-[#eadedf] bg-white/92 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2"><BarChart3 className="h-6 w-6 text-burgundy" /><h1 className="text-[1.65rem] font-semibold tracking-[-.035em] text-burgundy">Previsões de Liberação</h1></div>
          <p className="ml-8 mt-0.5 text-[11px] text-clay/55">Capacidade futura de liberações por mês, campanha e parcelamento.</p>
        </div>
        <div className="flex min-w-[300px] items-center justify-between gap-4 rounded-xl border border-[#f0d6d7] bg-[#fff2f1] px-4 py-2.5">
          <div className="flex items-center gap-3"><Database className="h-5 w-5 text-burgundy" /><div><p className="text-[11px] font-semibold text-burgundy">Dados do CRM RD Station</p><p className="text-[9px] text-clay/48">Vendas, contratos e boletos sincronizados automaticamente.</p></div></div>
          <span className="hidden rounded-lg bg-white/80 px-2 py-1 text-[9px] font-bold text-[#13363c] sm:inline">RD STATION<br />CRM</span>
        </div>
      </section>

      <section className="mb-3 rounded-xl border border-[#eadedf] bg-white/92 p-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[1.05fr_1.25fr_1.15fr_1fr_1fr_auto]">
          <label><span className="mb-1 block text-[9px] font-medium text-clay/60">Mês analisado</span><input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="h-9 w-full rounded-lg border border-[#e6d9da] bg-white px-2.5 text-[10px] outline-none" /></label>
          <label><span className="mb-1 block text-[9px] font-medium text-clay/60">Campanha</span><select value={campaign} onChange={(event) => setCampaign(event.target.value)} className="h-9 w-full rounded-lg border border-[#e6d9da] bg-white px-2 text-[10px] outline-none"><option value="todas">Todas as campanhas</option>{campaigns.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span className="mb-1 block text-[9px] font-medium text-clay/60">Vendedora</span><select value={seller} onChange={(event) => setSeller(event.target.value)} className="h-9 w-full rounded-lg border border-[#e6d9da] bg-white px-2 text-[10px] outline-none"><option value="todas">Todas as vendedoras</option>{sellers.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span className="mb-1 block text-[9px] font-medium text-clay/60">Parcelamento</span><select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)} className="h-9 w-full rounded-lg border border-[#e6d9da] bg-white px-2 text-[10px] outline-none"><option value="todos">Todos</option>{rules.map((rule) => <option key={rule.parcelas} value={rule.parcelas}>{rule.parcelas}x</option>)}</select></label>
          <label><span className="mb-1 block text-[9px] font-medium text-clay/60">Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 w-full rounded-lg border border-[#e6d9da] bg-white px-2 text-[10px] outline-none"><option value="todos">Todos</option><option value="no_ritmo">Prevista</option><option value="em_risco">Em risco</option><option value="elegivel">Elegível</option></select></label>
          <div className="flex items-end gap-2"><button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-burgundy px-4 text-[10px] font-semibold text-white shadow-sm transition hover:bg-burgundy-dark disabled:opacity-60"><Filter className="h-3.5 w-3.5" />Filtrar</button><button type="button" onClick={() => { setCampaign("todas"); setSeller("todas"); setPlanFilter("todos"); setStatusFilter("todos"); setSearch(""); }} className="h-9 px-2 text-[9px] font-medium text-burgundy/65">Limpar</button></div>
        </div>
      </section>

      {error ? <div className="mb-3 rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-2 text-[10px] text-amber-800">{error}</div> : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_292px]">
        <div className="min-w-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={ShoppingCart} label={`Vendas em ${MONTH_NAMES[Number(selectedMonth.slice(5,7)) - 1]}`} value={String(salesMonthClients.length)} delta={percentageChange(salesMonthClients.length, previousSalesMonthClients.length)} helper="vs. mês anterior" />
            <KpiCard icon={Layers3} label="Liberações Previstas" value={String(projectedNext6)} delta={percentageChange(releaseMonthClients.length, previousReleaseMonthClients.length)} helper="nos próximos 6 meses" />
            <KpiCard icon={WalletCards} label="Valor da Carta Previsto" value={projectedValueNext6 > 0 ? formatarMoeda(projectedValueNext6) : "—"} helper="em liberações futuras" tone="gold" />
            <KpiCard icon={AlertTriangle} label="Em Risco / Inadimplência" value={String(riskCount)} helper="requer atenção" tone="alert" />
          </div>

          <div className="grid gap-3 2xl:grid-cols-[minmax(280px,.9fr)_minmax(420px,1.35fr)_minmax(240px,.72fr)]">
            <section className="rounded-xl border border-[#eadedf] bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-[12px] font-semibold text-burgundy"><CalendarDays className="h-4 w-4" />Calendário de Liberações Previstas</h2><div className="flex items-center gap-1"><button type="button" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))} className="rounded-md border border-[#eadedf] p-1 text-burgundy"><ChevronLeft className="h-3.5 w-3.5" /></button><span className="min-w-[110px] text-center text-[10px] font-semibold text-burgundy">{monthLong(selectedMonth).replace(" de ", " ")}</span><button type="button" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))} className="rounded-md border border-[#eadedf] p-1 text-burgundy"><ChevronRight className="h-3.5 w-3.5" /></button></div></div>
              <div className="mt-3 grid grid-cols-7 overflow-hidden rounded-lg border border-[#eee4e4]">{WEEK_DAYS.map((day) => <div key={day} className="bg-[#fbf8f7] py-1.5 text-center text-[8px] font-semibold text-clay/55">{day}</div>)}{calendar.map((cell) => { const count = releaseByDate.get(cell.iso)?.length ?? 0; const active = selectedDay === cell.iso; return <button type="button" key={cell.iso} onClick={() => count && setSelectedDay(cell.iso)} className={`relative min-h-[58px] border-r border-t border-[#f0e8e7] px-1 py-1.5 text-center transition ${!cell.inMonth ? "bg-[#fcfbfb] text-clay/25" : active ? "bg-emerald-700 text-white" : "bg-white text-[#49383c]"}`}><span className="text-[9px] font-medium">{cell.day}</span>{count > 0 ? <span className={`mx-auto mt-1 block w-fit max-w-full truncate rounded-md px-1.5 py-0.5 text-[7px] font-semibold ${active ? "bg-white/18 text-white" : "bg-emerald-100 text-emerald-700"}`}>{count} {count === 1 ? "prevista" : count <= 4 ? "previstas" : "liberações"}</span> : null}</button>; })}</div>
              <p className="mt-2 text-[8px] leading-4 text-clay/42">As marcações verdes são clientes cuja parcela necessária para elegibilidade vence naquele dia.</p>
              {selectedDay && selectedDayClients.length ? <div className="mt-2 rounded-lg border border-emerald-200/60 bg-emerald-50/60 p-2"><div className="flex items-center justify-between"><p className="text-[9px] font-semibold text-emerald-800">{dateLabel(selectedDay)} · {selectedDayClients.length} previstas</p><button type="button" onClick={() => setSelectedDay(null)}><X className="h-3 w-3 text-emerald-700" /></button></div><div className="mt-1.5 space-y-1">{selectedDayClients.slice(0, 3).map((client) => <button type="button" onClick={() => setSelectedClient(client)} key={client.clienteId} className="flex w-full items-center justify-between rounded-md bg-white/80 px-2 py-1.5 text-left"><span className="truncate text-[8px] font-medium text-burgundy">{client.nome}</span><span className="text-[8px] text-emerald-700">{client.totalParcelas}x · {client.parcelasNecessarias}ª</span></button>)}</div></div> : null}
            </section>

            <section className="rounded-xl border border-[#eadedf] bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-[12px] font-semibold text-burgundy"><BarChart3 className="h-4 w-4" />Previsão de Liberações por Mês</h2><div className="mt-1 flex items-center gap-3 text-[8px] text-clay/50"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-burgundy" />Quantidade de liberações</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#efa6a5]" />Valor previsto (R$)</span></div></div><span className="rounded-md border border-[#eadedf] px-2 py-1 text-[8px] text-clay/55">Próximos 6 meses</span></div>
              <div className="relative mt-5 h-[220px]"><div className="absolute inset-x-0 bottom-7 top-0 flex items-end justify-around gap-2 border-b border-l border-[#eee5e4] px-3">{chartData.map((item) => <div key={item.month} className="flex h-full flex-1 flex-col items-center justify-end"><span className="mb-1 text-[9px] font-bold text-[#3f2f33]">{item.count}</span><div className="w-full max-w-[42px] rounded-t-sm bg-gradient-to-b from-[#9c5362] to-burgundy" style={{ height: `${Math.max(item.count ? 12 : 2, (item.count / maxChart) * 150)}px` }} /><span className="mt-2 text-[8px] text-clay/50">{monthShort(item.month)}</span></div>)}</div></div>
              <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center rounded-lg bg-[#fff0ef] px-3 py-2"><div><p className="text-[8px] text-burgundy/60">Total previsto no período</p><p className="text-[12px] font-semibold text-burgundy">{projectedNext6} liberações</p></div><div className="h-8 w-px bg-rose/30" /><div className="text-right"><p className="text-[12px] font-semibold text-burgundy">{projectedValueNext6 > 0 ? formatarMoeda(projectedValueNext6) : "Valor aguardando CRM"}</p><p className="text-[8px] text-burgundy/55">em valor de cartas</p></div></div>
            </section>

            <section className="rounded-xl border border-[#eadedf] bg-white p-3 shadow-sm">
              <h2 className="flex items-center gap-2 text-[12px] font-semibold text-burgundy"><PieChart className="h-4 w-4" />Carteiras por parcelamento</h2>
              <div className="mt-3 space-y-1.5">{rules.map((rule) => { const count = releaseMonthClients.filter((client) => client.totalParcelas === rule.parcelas).length; return <button type="button" key={rule.parcelas} onClick={() => { setSelectedPortfolio(rule.parcelas); setPortfolioPage(1); }} className="group flex w-full items-center gap-2 rounded-lg border border-[#efe5e4] bg-[#fffdfc] px-2 py-1.5 text-left transition hover:-translate-y-px hover:border-burgundy/20 hover:shadow-sm"><span className={`flex h-7 min-w-[48px] items-center justify-center rounded-md text-[10px] font-bold text-burgundy ${PLAN_ACCENTS[rule.parcelas] ?? "bg-blush"}`}>{rule.parcelas}x</span><span className="flex-1 text-[9px] font-medium text-clay/65">{count} cliente{count === 1 ? "" : "s"}</span><span className="text-[9px] font-semibold text-burgundy">{rule.parcelasNecessarias} parcelas</span><ArrowUpRight className="h-3 w-3 text-burgundy/30 opacity-0 transition group-hover:opacity-100" /></button>; })}</div>
            </section>
          </div>

          <section className="rounded-xl border border-[#eadedf] bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-[#eee3e3] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 text-[12px] font-semibold text-burgundy"><UsersRound className="h-4 w-4" />Clientes do CRM e Previsões</h2><p className="mt-0.5 text-[8px] text-clay/45">Dados do CRM com previsão automática baseada no parcelamento e nos boletos registrados.</p></div><button type="button" className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#eadedf] px-3 text-[9px] font-medium text-burgundy"><Download className="h-3.5 w-3.5" />Exportar</button></div>
            <div className="overflow-x-auto"><table className="min-w-[980px] w-full text-left"><thead className="bg-[#fbf8f7]"><tr className="text-[8px] font-semibold text-clay/55"><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Campanha</th><th className="px-3 py-2">Vendedora</th><th className="px-3 py-2">Plano</th><th className="px-3 py-2">Valor da Carta</th><th className="px-3 py-2">1º Boleto</th><th className="px-3 py-2">Meta p/ liberação</th><th className="px-3 py-2">Previsão de Liberação</th><th className="px-3 py-2">Status</th><th className="w-8" /></tr></thead><tbody className="divide-y divide-[#f0e7e6]">{filteredClients.slice(0, 12).map((client) => { const meta = statusMeta(client.situacao); return <tr key={client.clienteId} className="text-[8.5px] transition hover:bg-[#fff8f7]"><td className="px-3 py-2 font-medium text-[#3e3135]"><button type="button" onClick={() => setSelectedClient(client)} className="hover:text-burgundy hover:underline">{client.nome}</button></td><td className="px-3 py-2 text-clay/60">{client.campanha || "Sem campanha"}</td><td className="px-3 py-2 text-clay/60">{client.responsavel || "Sem vendedora"}</td><td className="px-3 py-2 font-semibold text-burgundy">{client.totalParcelas}x</td><td className="px-3 py-2 font-medium">{money(client.valorCarta)}</td><td className="px-3 py-2">{dateLabel(client.primeiroVencimento || client.primeiroBoletoEm)}</td><td className="px-3 py-2">{client.parcelasNecessarias ? `${client.parcelasNecessarias} parcelas` : "—"}</td><td className="px-3 py-2 font-medium text-burgundy">{dateLabel(client.previsao)}</td><td className="px-3 py-2"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${meta.className}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{client.fontePrevisao === "projecao_mensal" && client.situacao === "no_ritmo" ? "Projeção mensal" : meta.label}</span></td><td className="px-2"><button type="button" onClick={() => setSelectedClient(client)}><MoreVertical className="h-3.5 w-3.5 text-clay/45" /></button></td></tr>; })}{filteredClients.length === 0 ? <tr><td colSpan={10} className="px-4 py-10 text-center text-[10px] text-clay/45">Nenhuma cliente encontrada com os filtros atuais.</td></tr> : null}</tbody></table></div>
          </section>
        </div>

        <aside className="flex min-h-[630px] flex-col rounded-xl border border-[#eadedf] bg-white shadow-sm">
          <div className="border-b border-[#eee3e3] px-3 py-3"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-[12px] font-semibold text-burgundy"><CalendarDays className="h-4 w-4" />Vendas do mês</h2></div><div className="mt-2 flex items-center justify-between gap-2"><button type="button" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))} className="rounded-md border border-[#eadedf] p-1"><ChevronLeft className="h-3.5 w-3.5 text-burgundy" /></button><strong className="text-[12px] text-burgundy">{monthLong(selectedMonth)}</strong><button type="button" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))} className="rounded-md border border-[#eadedf] p-1"><ChevronRight className="h-3.5 w-3.5 text-burgundy" /></button></div><p className="mt-1.5 text-[8px] leading-4 text-clay/45">Exibe apenas vendas que já chegaram ao financeiro e possuem boleto/cadastro registrado.</p><p className="mt-1 text-[14px] font-semibold text-burgundy">{salesMonthClients.length} vendas registradas</p></div>
          <div className="max-h-[590px] flex-1 overflow-y-auto px-2 py-2">{salesMonthClients.length ? <div className="space-y-1.5">{salesMonthClients.map((client) => <button key={client.clienteId} type="button" onClick={() => setSelectedClient(client)} className="flex w-full items-start gap-2 rounded-lg border border-[#efe6e5] bg-white px-2 py-2 text-left transition hover:border-burgundy/15 hover:bg-[#fff9f8]"><Avatar name={client.nome} size="sm" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-[9px] font-semibold text-[#392c30]">{client.nome}</p><span className="shrink-0 text-[8px] font-semibold text-burgundy">{money(client.valorCarta)}</span></div><p className="mt-0.5 truncate text-[8px] text-clay/52">{client.campanha || "Sem campanha"}</p><p className="truncate text-[8px] text-clay/52">Vendedora: {client.responsavel || "—"}</p><p className="mt-0.5 text-[8px] font-medium text-burgundy/75">{client.totalParcelas}x {client.codigoContrato ? `| Contrato: ${client.codigoContrato}` : "| Financeiro ativo"}</p></div><ChevronRight className="mt-3 h-3.5 w-3.5 text-burgundy/45" /></button>)}</div> : <div className="flex h-full min-h-[260px] flex-col items-center justify-center px-5 text-center"><ShoppingCart className="h-6 w-6 text-burgundy/25" /><p className="mt-2 text-[10px] font-semibold text-burgundy/65">Sem vendas financeiras neste mês</p><p className="mt-1 text-[8px] leading-4 text-clay/42">Quando o cadastro financeiro/primeiro boleto existir, a venda aparecerá aqui.</p></div>}</div>
          <div className="mt-auto border-t border-[#eee3e3] p-2"><button type="button" className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[#f0cfd0] bg-[#fff3f2] text-[9px] font-semibold text-burgundy"><FileText className="h-3.5 w-3.5" />Ver todas as vendas do mês</button></div>
        </aside>
      </div>

      {selectedPortfolio != null && selectedRule ? (
        <ModalShell onClose={() => setSelectedPortfolio(null)} wide>
          <div className="p-5 sm:p-6 xl:p-7">
            <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-3"><PieChart className="h-7 w-7 text-burgundy" /><div><h2 className="text-2xl font-semibold tracking-[-.03em] text-burgundy">Carteira {selectedPortfolio}x · {monthLong(selectedMonth)}</h2><p className="mt-0.5 text-[11px] text-clay/55">Clientes com {selectedRule.parcelasNecessarias}ª parcela prevista para este mês</p></div></div></div><button type="button" onClick={() => setSelectedPortfolio(null)} className="rounded-lg p-2 text-burgundy/70 hover:bg-blush"><X className="h-5 w-5" /></button></div>

            <div className="mt-5 rounded-xl border border-[#f0c9cd] bg-[#fff0f1] p-4"><div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-burgundy text-white"><CircleAlert className="h-4 w-4" /></span><div><p className="text-[13px] font-semibold text-burgundy">Regra do plano {selectedPortfolio}x: {selectedRule.percentual}% pago = {selectedRule.parcelasNecessarias}ª parcela</p><p className="mt-1 text-[11px] text-[#614b52]">Entram nesta carteira apenas clientes cuja {selectedRule.parcelasNecessarias}ª parcela vence em {monthLong(selectedMonth)}.</p><p className="mt-1 text-[10px] italic text-clay/45">Exemplo: se a cliente pagou {selectedRule.parcelasNecessarias - 1} parcelas até o mês anterior, ela entra nesta previsão no vencimento da {selectedRule.parcelasNecessarias}ª parcela.</p></div></div></div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-[#eadedf] bg-white p-3"><p className="text-[9px] text-clay/50">Clientes na carteira</p><p className="mt-1 text-xl font-semibold text-burgundy">{portfolioClients.length}</p></div><div className="rounded-xl border border-[#eadedf] bg-white p-3"><p className="text-[9px] text-clay/50">Valor previsto</p><p className="mt-1 text-xl font-semibold text-burgundy">{portfolioValue > 0 ? formatarMoeda(portfolioValue) : "—"}</p></div><div className="rounded-xl border border-[#eadedf] bg-white p-3"><p className="text-[9px] text-clay/50">Mês filtrado</p><p className="mt-1 text-[15px] font-semibold text-burgundy">{monthLong(selectedMonth)}</p></div><div className="rounded-xl border border-[#eadedf] bg-white p-3"><p className="text-[9px] text-clay/50">Parcela necessária</p><p className="mt-1 text-xl font-semibold text-burgundy">{selectedRule.parcelasNecessarias}ª</p></div></div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h3 className="flex items-center gap-2 text-[16px] font-semibold text-burgundy"><UsersRound className="h-5 w-5" />Clientes da carteira {selectedPortfolio}x</h3><label className="relative"><Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-clay/35" /><input placeholder="Buscar cliente, campanha ou vendedora..." className="h-9 min-w-[280px] rounded-lg border border-[#eadedf] bg-white pl-8 pr-3 text-[10px] outline-none" /></label></div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-[#eadedf]"><table className="min-w-[980px] w-full text-left"><thead className="bg-[#fbf8f7]"><tr className="text-[9px] font-semibold text-clay/55"><th className="px-3 py-2.5">Cliente</th><th className="px-3 py-2.5">Campanha</th><th className="px-3 py-2.5">Vendedora</th><th className="px-3 py-2.5">Parcelas pagas</th><th className="px-3 py-2.5">Parcela-alvo</th><th className="px-3 py-2.5">Vencimento da {selectedRule.parcelasNecessarias}ª</th><th className="px-3 py-2.5">Valor da carta</th><th className="px-3 py-2.5">Status</th><th /></tr></thead><tbody className="divide-y divide-[#f0e7e6]">{pagedPortfolioClients.map((client) => { const meta = statusMeta(client.situacao); return <tr key={client.clienteId} className="text-[9px] hover:bg-[#fff8f7]"><td className="px-3 py-3"><button type="button" onClick={() => setSelectedClient(client)} className="font-semibold text-[#3b2d31] hover:text-burgundy hover:underline">{client.nome}</button></td><td className="px-3 py-3">{client.campanha || "Sem campanha"}</td><td className="px-3 py-3">{client.responsavel || "—"}</td><td className="px-3 py-3 font-medium">{client.parcelasPagas}/{client.totalParcelas} pagas</td><td className="px-3 py-3 font-medium text-burgundy">{client.parcelasNecessarias}ª parcela</td><td className="px-3 py-3 font-medium">{dateLabel(client.previsao)}</td><td className="px-3 py-3 font-semibold">{money(client.valorCarta)}</td><td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${meta.className}`}><Check className="h-3 w-3" />{meta.label}</span></td><td className="px-2"><button type="button" onClick={() => setSelectedClient(client)}><MoreVertical className="h-4 w-4 text-clay/45" /></button></td></tr>; })}{portfolioClients.length === 0 ? <tr><td colSpan={9} className="px-4 py-12 text-center text-[11px] text-clay/45">Nenhuma cliente deste parcelamento está prevista para {monthLong(selectedMonth)}.</td></tr> : null}</tbody></table></div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-[9px] text-clay/50">Mostrando {Math.min(portfolioClients.length, (portfolioPage - 1) * pageSize + 1)}–{Math.min(portfolioClients.length, portfolioPage * pageSize)} de {portfolioClients.length} clientes da carteira</p><div className="flex items-center gap-1"><button type="button" onClick={() => setPortfolioPage((page) => Math.max(1, page - 1))} className="rounded-md border border-[#eadedf] p-1"><ChevronLeft className="h-3.5 w-3.5" /></button>{Array.from({ length: Math.min(5, portfolioPages) }, (_, index) => index + 1).map((page) => <button type="button" key={page} onClick={() => setPortfolioPage(page)} className={`h-7 w-7 rounded-md border text-[9px] ${portfolioPage === page ? "border-burgundy bg-burgundy text-white" : "border-[#eadedf] bg-white text-burgundy"}`}>{page}</button>)}<button type="button" onClick={() => setPortfolioPage((page) => Math.min(portfolioPages, page + 1))} className="rounded-md border border-[#eadedf] p-1"><ChevronRight className="h-3.5 w-3.5" /></button></div></div>
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-[#f0d4d5] bg-[#fff2f2] p-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-[9px] leading-4 text-[#674e55]">Esta carteira considera apenas clientes do plano {selectedPortfolio}x cuja parcela-alvo ({selectedRule.parcelasNecessarias}ª) tem vencimento em {monthLong(selectedMonth)}.</p><button type="button" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#e7c8ca] bg-white px-3 text-[9px] font-semibold text-burgundy"><Download className="h-3.5 w-3.5" />Exportar carteira</button></div>
          </div>
        </ModalShell>
      ) : null}

      {selectedClient ? (
        <ModalShell onClose={() => setSelectedClient(null)} wide>
          <div className="p-5 sm:p-6 xl:p-7">
            <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-2 text-[10px] text-[#657198]"><span>Previsões</span><ChevronRight className="h-3 w-3" /><span>Carteira {selectedClient.totalParcelas}x</span><ChevronRight className="h-3 w-3" /><strong className="text-[#3c4769]">{selectedClient.nome}</strong></div><button type="button" onClick={() => setSelectedClient(null)} className="rounded-lg p-2 text-burgundy/70 hover:bg-blush"><X className="h-5 w-5" /></button></div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><Avatar name={selectedClient.nome} size="lg" /><div><h2 className="text-2xl font-semibold tracking-[-.03em] text-burgundy">Perfil da cliente · Previsão de Liberação</h2><p className="text-[11px] text-clay/52">Detalhes da cliente e regra de previsão para liberação da carta.</p></div></div><div className="rounded-full bg-emerald-50 px-3 py-2 text-center text-[10px] font-semibold text-emerald-700"><span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Prevista para {MONTH_NAMES[Number(selectedMonth.slice(5,7)) - 1]}</span><p className="mt-0.5 text-[8px] font-normal text-emerald-800/70">Elegível no vencimento da {selectedClient.parcelasNecessarias}ª parcela</p></div></div>

            <div className="mt-4 grid gap-2 rounded-xl border border-[#eadedf] bg-white px-4 py-3 sm:grid-cols-[1.7fr_1fr_1fr_1fr_.65fr]"><div><p className="text-xl font-semibold text-burgundy">{selectedClient.nome}</p></div><div><p className="text-[8px] text-clay/45">Campanha</p><p className="text-[10px] font-semibold">{selectedClient.campanha || "Sem campanha"}</p></div><div><p className="text-[8px] text-clay/45">Vendedora</p><p className="text-[10px] font-semibold">{selectedClient.responsavel || "—"}</p></div><div><p className="text-[8px] text-clay/45">Valor da carta</p><p className="text-[10px] font-semibold">{money(selectedClient.valorCarta)}</p></div><div><p className="text-[8px] text-clay/45">Plano</p><p className="text-[10px] font-semibold">{selectedClient.totalParcelas}x</p></div></div>

            <div className="mt-3 rounded-xl border border-[#f0c9cd] bg-[#fff0f1] p-4"><div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-burgundy text-white"><CircleAlert className="h-4 w-4" /></span><div><p className="text-[14px] font-semibold text-burgundy">Plano {selectedClient.totalParcelas}x · {selectedClient.percentual ?? "—"}% = {selectedClient.parcelasNecessarias ?? "—"}ª parcela</p><p className="mt-1 text-[11px] text-[#614b52]">Como a cliente tem {selectedClient.parcelasPagas} parcelas pagas, a previsão de liberação é no vencimento da parcela-alvo: <strong>{dateLabel(selectedClient.previsao)}</strong>.</p></div></div></div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[1.35fr_.9fr]">
              <section className="rounded-xl border border-[#eadedf] bg-white p-3"><h3 className="flex items-center gap-2 text-[13px] font-semibold text-burgundy"><Target className="h-4 w-4" />Resumo da previsão</h3><div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded-lg border border-[#eee4e4] p-3"><p className="text-[8px] text-clay/50">Parcela necessária</p><p className="mt-1 text-xl font-semibold text-burgundy">{selectedClient.parcelasNecessarias ?? "—"}ª</p></div><div className="rounded-lg border border-[#eee4e4] p-3"><p className="text-[8px] text-clay/50">Parcelas pagas</p><p className="mt-1 text-xl font-semibold text-burgundy">{selectedClient.parcelasPagas}/{selectedClient.totalParcelas}</p></div><div className="rounded-lg border border-[#eee4e4] p-3"><p className="text-[8px] text-clay/50">Próximo marco</p><p className="mt-1 text-[14px] font-semibold text-burgundy">{selectedClient.parcelasNecessarias ?? "—"}ª parcela</p></div><div className="rounded-lg border border-[#eee4e4] p-3"><p className="text-[8px] text-clay/50">Vencimento previsto</p><p className="mt-1 text-[14px] font-semibold text-burgundy">{dateLabel(selectedClient.previsao)}</p></div><div className="rounded-lg border border-[#eee4e4] p-3"><p className="text-[8px] text-clay/50">Valor da carta</p><p className="mt-1 text-[14px] font-semibold text-burgundy">{money(selectedClient.valorCarta)}</p></div><div className="rounded-lg border border-[#eee4e4] p-3"><p className="text-[8px] text-clay/50">Confiabilidade</p><span className="mt-1 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">{selectedClient.confianca === "alta" ? "Alta" : selectedClient.confianca === "media" ? "Média" : "Baixa"}</span></div></div></section>
              <section className="rounded-xl border border-[#eadedf] bg-white p-3"><h3 className="flex items-center gap-2 text-[13px] font-semibold text-burgundy"><UserRound className="h-4 w-4" />Dados da venda / CRM</h3><div className="mt-3 divide-y divide-[#f0e7e6] rounded-lg border border-[#eee4e4] text-[9px]"><div className="grid grid-cols-2 px-3 py-2"><span className="text-clay/50">Campanha</span><strong>{selectedClient.campanha || "Sem campanha"}</strong></div><div className="grid grid-cols-2 px-3 py-2"><span className="text-clay/50">Vendedora</span><strong>{selectedClient.responsavel || "—"}</strong></div><div className="grid grid-cols-2 px-3 py-2"><span className="text-clay/50">Data da venda</span><strong>{dateLabel(selectedClient.dataVenda || selectedClient.primeiroBoletoEm)}</strong></div><div className="grid grid-cols-2 px-3 py-2"><span className="text-clay/50">Origem</span><strong>{selectedClient.origem || "RD Station / CRM"}</strong></div><div className="grid grid-cols-2 px-3 py-2"><span className="text-clay/50">Contrato</span><strong>{selectedClient.codigoContrato || "Aguardando vínculo"}</strong></div><div className="grid grid-cols-2 px-3 py-2"><span className="text-clay/50">Status comercial</span><span className="w-fit rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Venda confirmada</span></div></div></section>
            </div>

            <section className="mt-3 rounded-xl border border-[#eadedf] bg-white p-3"><h3 className="flex items-center gap-2 text-[13px] font-semibold text-burgundy"><CalendarDays className="h-4 w-4" />Cronograma de parcelas</h3><div className="mt-5 overflow-x-auto pb-2"><div className="flex min-w-max items-start">{timeline.map((item, index) => { const targetPast = item.target && item.due && item.due < today && !item.paid; const circle = item.paid ? "border-emerald-500 bg-emerald-500 text-white" : item.target ? targetPast ? "border-red-500 bg-red-500 text-white" : "border-burgundy bg-burgundy text-white" : "border-[#cdd4df] bg-[#eef1f5] text-[#9aa5b5]"; return <div key={item.number} className="relative flex w-[86px] shrink-0 flex-col items-center"><div className={`absolute left-1/2 top-4 h-[2px] w-full ${index === timeline.length - 1 ? "hidden" : item.paid ? "bg-emerald-400" : "bg-[#d7dde5]"}`} /><span className="mb-2 text-[8px] font-semibold text-[#39445b]">{item.number}ª</span><span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${circle}`}>{item.paid || item.target ? <Check className="h-4 w-4" /> : null}</span><span className="mt-2 text-[8px] font-medium text-[#526078]">{item.due ? dateLabel(item.due).slice(0,5) : "—"}</span><span className={`mt-0.5 rounded-full px-1.5 py-0.5 text-[7px] font-semibold ${item.paid ? "bg-emerald-100 text-emerald-700" : item.target ? "bg-[#f8d8dc] text-burgundy" : "text-[#8692a3]"}`}>{item.paid ? "Paga" : item.target ? "Prevista" : "Futura"}</span></div>; })}</div></div></section>

            <div className="mt-3 grid gap-3 xl:grid-cols-[1.15fr_1fr]"><section className="rounded-xl border border-[#f0cfd1] bg-[#fff3f3] p-3"><h3 className="flex items-center gap-2 text-[12px] font-semibold text-burgundy"><Target className="h-4 w-4" />Motivo da entrada na carteira</h3><p className="mt-2 text-[9px] leading-5 text-[#5f4b51]">Esta cliente aparece na carteira {selectedClient.totalParcelas}x de {monthLong(selectedMonth)} porque a <strong>{selectedClient.parcelasNecessarias}ª parcela</strong>, que atinge {selectedClient.percentual}% do plano, vence em <strong>{dateLabel(selectedClient.previsao)}</strong>.</p><p className="mt-1 text-[8px] italic text-clay/48">Ela pertence ao mês do vencimento da parcela-alvo, não ao mês da parcela anterior.</p></section><section className="rounded-xl border border-[#eadedf] bg-white p-3"><h3 className="flex items-center gap-2 text-[12px] font-semibold text-burgundy"><FileText className="h-4 w-4" />Ações e observações</h3><div className="mt-3 flex flex-wrap gap-2"><a href={`/admin/financeiro?cliente_id=${selectedClient.clienteId}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-burgundy px-3 text-[8px] font-semibold text-white"><BarChart3 className="h-3 w-3" />Ver financeiro</a><a href={`/admin/clientes?cliente_id=${selectedClient.clienteId}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-burgundy/25 px-3 text-[8px] font-semibold text-burgundy"><UserRound className="h-3 w-3" />Abrir cliente</a><button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-burgundy/25 px-3 text-[8px] font-semibold text-burgundy"><MessageSquareText className="h-3 w-3" />Registrar observação</button></div><p className="mt-3 text-[8px] leading-4 text-clay/45">O sistema inclui nesta carteira apenas clientes cuja parcela necessária possui vencimento no mês visualizado. Fonte: {forecastSource(selectedClient)}.</p></section></div>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
