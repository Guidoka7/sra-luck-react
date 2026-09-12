"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Download,
  Filter,
  MoreVertical,
  PieChart,
  Search,
  UsersRound,
  X,
} from "lucide-react";
import { fetchInstant, refreshInstant } from "@/lib/instantCache";
import { formatarMoeda } from "@/lib/utils";
import { CompactClientForecastDrawer } from "@/features/previsoes/CompactClientForecastDrawer";

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

function money(value: number | null | undefined) {
  return value && value > 0 ? formatarMoeda(value) : "—";
}

function compactMoney(value: number) {
  if (!value) return "R$ 0";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function statusMeta(status: Situacao) {
  if (status === "elegivel") return { label: "Elegível", className: "bg-emerald-500/10 text-emerald-700", dot: "bg-emerald-500" };
  if (status === "em_risco") return { label: "Em risco", className: "bg-red-500/10 text-red-700", dot: "bg-red-500" };
  if (status === "no_ritmo") return { label: "Prevista", className: "bg-emerald-500/10 text-emerald-700", dot: "bg-emerald-500" };
  return { label: "Sem previsão", className: "bg-clay/10 text-clay/60", dot: "bg-clay/35" };
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

function StatusBadge({ situacao, fontePrevisao, size = "sm" }: { situacao: Situacao; fontePrevisao?: ClienteForecast["fontePrevisao"]; size?: "sm" | "md" }) {
  const meta = statusMeta(situacao);
  const label = fontePrevisao === "projecao_mensal" && situacao === "no_ritmo" ? "Projeção mensal" : meta.label;
  const sizeClass = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${sizeClass} ${meta.className}`}>
      {situacao === "em_risco" ? <CircleAlert className="h-3 w-3" /> : <Check className="h-3 w-3" />}
      {label}
    </span>
  );
}

function DrawerShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-end bg-[#1b1518]/52 backdrop-blur-[1.5px]" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Fechar painel lateral" />
      <aside className="relative z-10 h-full w-full overflow-y-auto border-l border-white/70 bg-[#fffdfc] shadow-[-34px_0_90px_-38px_rgba(55,14,26,.52)] md:w-[94%] lg:w-[80%] xl:w-[66%] 2xl:w-[54%]">
        {children}
      </aside>
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
  const [portfolioSearch, setPortfolioSearch] = useState("");
  const [hoveredChart, setHoveredChart] = useState<number | null>(null);

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
  useEffect(() => { setSelectedDay(null); setPortfolioPage(1); setPortfolioSearch(""); }, [selectedMonth]);
  useEffect(() => {
    if (!selectedPortfolio) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedPortfolio(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedPortfolio]);

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

  const nextMonths = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftMonth(selectedMonth, index)), [selectedMonth]);
  const chartData = useMemo(() => nextMonths.map((month) => {
    const clients = filteredClients.filter((client) => client.previsao?.slice(0, 7) === month);
    return { month, count: clients.length, value: clients.reduce((sum, client) => sum + Number(client.valorCarta || 0), 0) };
  }), [filteredClients, nextMonths]);
  const maxChartCount = Math.max(1, ...chartData.map((item) => item.count));
  const maxChartValue = Math.max(1, ...chartData.map((item) => item.value));
  const projectedNext6 = chartData.slice(0, 6).reduce((sum, item) => sum + item.count, 0);
  const projectedValueNext6 = chartData.slice(0, 6).reduce((sum, item) => sum + item.value, 0);
  const chartPoints = useMemo(() => chartData.map((item, index) => ({
    x: ((index + 0.5) / chartData.length) * 700,
    y: 20 + (1 - item.value / maxChartValue) * 120,
  })), [chartData, maxChartValue]);
  const linePoints = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");

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

  const rawPortfolioClients = useMemo(() => selectedPortfolio == null ? [] : releaseMonthClients
    .filter((client) => client.totalParcelas === selectedPortfolio)
    .sort((a, b) => String(a.previsao || "").localeCompare(String(b.previsao || ""))), [releaseMonthClients, selectedPortfolio]);
  const portfolioClients = useMemo(() => {
    const q = portfolioSearch.trim().toLocaleLowerCase("pt-BR");
    if (!q) return rawPortfolioClients;
    return rawPortfolioClients.filter((client) => `${client.nome} ${client.campanha ?? ""} ${client.responsavel ?? ""}`.toLocaleLowerCase("pt-BR").includes(q));
  }, [rawPortfolioClients, portfolioSearch]);
  const selectedRule = rules.find((rule) => rule.parcelas === selectedPortfolio) ?? null;
  const portfolioTotalValue = useMemo(() => rawPortfolioClients.reduce((sum, client) => sum + Number(client.valorCarta || 0), 0), [rawPortfolioClients]);
  const pageSize = 8;
  const portfolioPages = Math.max(1, Math.ceil(portfolioClients.length / pageSize));
  const pagedPortfolioClients = portfolioClients.slice((portfolioPage - 1) * pageSize, portfolioPage * pageSize);

  if (loading && !data) {
    return (
      <div className="space-y-4 pb-10">
        <div className="h-28 animate-pulse rounded-2xl bg-white/70" />
        <div className="h-20 animate-pulse rounded-2xl bg-white/70" />
        <div className="h-[420px] animate-pulse rounded-2xl bg-white/70" />
        <div className="h-[360px] animate-pulse rounded-2xl bg-white/70" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-10 text-clay">
      <header className="rounded-2xl border border-[#eadedf] bg-white/95 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#fde8e7] text-burgundy">
              <BarChart3 className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-burgundy sm:text-[1.7rem]">Previsões de Liberação</h1>
              <p className="mt-1 text-sm text-clay/60">Capacidade futura de liberações por mês, campanha e parcelamento.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-[#f0d6d7] bg-[#fff2f1] px-4 py-3">
            <Database className="h-5 w-5 shrink-0 text-burgundy" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-burgundy">Dados do CRM RD Station</p>
              <p className="text-[11px] text-clay/55">Vendas, contratos e boletos sincronizados automaticamente.</p>
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-[#eadedf] bg-white/92 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <label className="relative w-full xl:max-w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-clay/35" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente, campanha, vendedora..."
              className="h-10 w-full rounded-lg border border-[#e6d9da] bg-white pl-9 pr-3 text-sm outline-none transition focus:border-burgundy/40"
            />
          </label>

          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4 xl:flex xl:flex-wrap xl:items-center">
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-medium text-clay/55">Mês analisado</span>
              <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="h-9 w-full rounded-lg border border-[#e6d9da] bg-white px-2.5 text-xs outline-none xl:w-[150px]" />
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-medium text-clay/55">Campanha</span>
              <select value={campaign} onChange={(event) => setCampaign(event.target.value)} className="h-9 w-full rounded-lg border border-[#e6d9da] bg-white px-2 text-xs outline-none xl:w-[160px]">
                <option value="todas">Todas as campanhas</option>
                {campaigns.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-medium text-clay/55">Vendedora</span>
              <select value={seller} onChange={(event) => setSeller(event.target.value)} className="h-9 w-full rounded-lg border border-[#e6d9da] bg-white px-2 text-xs outline-none xl:w-[150px]">
                <option value="todas">Todas as vendedoras</option>
                {sellers.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-medium text-clay/55">Parcelamento</span>
              <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)} className="h-9 w-full rounded-lg border border-[#e6d9da] bg-white px-2 text-xs outline-none xl:w-[110px]">
                <option value="todos">Todos</option>
                {rules.map((rule) => <option key={rule.parcelas} value={rule.parcelas}>{rule.parcelas}x</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-medium text-clay/55">Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 w-full rounded-lg border border-[#e6d9da] bg-white px-2 text-xs outline-none xl:w-[130px]">
                <option value="todos">Todos</option>
                <option value="no_ritmo">Prevista</option>
                <option value="em_risco">Em risco</option>
                <option value="elegivel">Elegível</option>
              </select>
            </label>
            <div className="col-span-2 flex items-end gap-2 sm:col-span-4 xl:col-span-1">
              <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-burgundy px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-burgundy-dark disabled:opacity-60">
                <Filter className="h-3.5 w-3.5" />Filtrar
              </button>
              <button type="button" onClick={() => { setCampaign("todas"); setSeller("todas"); setPlanFilter("todos"); setStatusFilter("todos"); setSearch(""); }} className="h-9 px-2 text-[11px] font-medium text-burgundy/65 hover:text-burgundy">
                Limpar
              </button>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-[#f1e9e8] pt-3 text-[11px] text-clay/50">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />Previsão calculada automaticamente pelos boletos registrados
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-amber-300/40 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div> : null}

      <div className="grid gap-4 2xl:grid-cols-[minmax(300px,.85fr)_minmax(460px,1.35fr)_minmax(260px,.8fr)]">
        <section className="rounded-2xl border border-[#eadedf] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-burgundy"><CalendarDays className="h-4 w-4" />Calendário de Liberações</h2>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))} className="rounded-md border border-[#eadedf] p-1 text-burgundy"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <span className="min-w-[110px] text-center text-xs font-semibold text-burgundy">{monthLong(selectedMonth).replace(" de ", " ")}</span>
              <button type="button" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))} className="rounded-md border border-[#eadedf] p-1 text-burgundy"><ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-7 overflow-hidden rounded-lg border border-[#eee4e4]">
            {WEEK_DAYS.map((day) => <div key={day} className="bg-[#fbf8f7] py-1.5 text-center text-[10px] font-semibold text-clay/55">{day}</div>)}
            {calendar.map((cell) => {
              const count = releaseByDate.get(cell.iso)?.length ?? 0;
              const active = selectedDay === cell.iso;
              return (
                <button
                  type="button"
                  key={cell.iso}
                  onClick={() => count && setSelectedDay(cell.iso)}
                  className={`relative min-h-[62px] border-r border-t border-[#f0e8e7] px-1 py-1.5 text-center transition ${!cell.inMonth ? "bg-[#fcfbfb] text-clay/25" : active ? "bg-emerald-700 text-white" : "bg-white text-clay hover:bg-emerald-50/50"}`}
                >
                  <span className="text-[11px] font-medium">{cell.day}</span>
                  {count > 0 ? (
                    <span className={`mx-auto mt-1 block w-fit max-w-full truncate rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${active ? "bg-white/18 text-white" : "bg-emerald-100 text-emerald-700"}`}>
                      {count} {count === 1 ? "prevista" : count <= 4 ? "previstas" : "liberações"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-4 text-clay/45">As marcações verdes representam clientes cuja parcela necessária vence naquele dia.</p>

          {selectedDay && selectedDayClients.length ? (
            <div className="mt-2 rounded-lg border border-emerald-200/60 bg-emerald-50/60 p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-emerald-800">{dateLabel(selectedDay)} · {selectedDayClients.length} previstas</p>
                <button type="button" onClick={() => setSelectedDay(null)}><X className="h-3.5 w-3.5 text-emerald-700" /></button>
              </div>
              <div className="mt-1.5 space-y-1">
                {selectedDayClients.slice(0, 3).map((client) => (
                  <button type="button" onClick={() => setSelectedClient(client)} key={client.clienteId} className="flex w-full items-center justify-between rounded-md bg-white/80 px-2 py-1.5 text-left">
                    <span className="truncate text-[11px] font-medium text-burgundy">{client.nome}</span>
                    <span className="shrink-0 text-[11px] text-emerald-700">{client.totalParcelas}x · {client.parcelasNecessarias}ª</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-[#eadedf] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-burgundy"><BarChart3 className="h-4 w-4" />Previsão de Liberações por Mês</h2>
              <div className="mt-1 flex items-center gap-3 text-[11px] text-clay/50">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-burgundy" />Quantidade de liberações</span>
                <span className="inline-flex items-center gap-1"><span className="h-[2px] w-4 bg-[#e99c9d]" />Valor previsto (R$)</span>
              </div>
            </div>
            <span className="shrink-0 rounded-md border border-[#eadedf] px-2 py-1 text-[10px] text-clay/55">Mês + próximos 6</span>
          </div>

          <div className="relative mt-5 h-[240px] select-none">
            <div className="absolute bottom-8 left-9 right-12 top-1">
              {[0, 1, 2, 3].map((line) => <div key={line} className="absolute left-0 right-0 border-t border-dashed border-[#eee5e4]" style={{ top: `${line * 33.33}%` }} />)}
              <span className="absolute -left-8 -top-1 text-[9px] text-clay/40">{maxChartCount}</span>
              <span className="absolute -bottom-1 -left-5 text-[9px] text-clay/40">0</span>
              <span className="absolute -right-12 -top-1 text-[9px] text-clay/40">{compactMoney(maxChartValue)}</span>
              <span className="absolute -bottom-1 -right-8 text-[9px] text-clay/40">R$ 0</span>

              <div className="absolute inset-0 flex items-end gap-2">
                {chartData.map((item, index) => {
                  const active = hoveredChart === index;
                  const height = Math.max(item.count ? 14 : 2, (item.count / maxChartCount) * 130);
                  return (
                    <button
                      key={item.month}
                      type="button"
                      onMouseEnter={() => setHoveredChart(index)}
                      onMouseLeave={() => setHoveredChart(null)}
                      onFocus={() => setHoveredChart(index)}
                      onBlur={() => setHoveredChart(null)}
                      onClick={() => setSelectedMonth(item.month)}
                      className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none"
                    >
                      {active ? (
                        <div className="absolute left-1/2 top-1 z-20 w-[160px] -translate-x-1/2 rounded-lg border border-[#ead9da] bg-white px-3 py-2.5 text-left shadow-[0_14px_36px_-14px_rgba(73,20,34,.28)]">
                          <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-clay/45">{monthLong(item.month)}</p>
                          <p className="mt-1 text-xs font-semibold text-burgundy">{item.count} liberações previstas</p>
                          <p className="mt-0.5 text-xs font-semibold text-[#c46e75]">{item.value > 0 ? formatarMoeda(item.value) : "Valor aguardando CRM"}</p>
                        </div>
                      ) : null}
                      <span className={`mb-1 text-[11px] font-bold transition ${active ? "text-burgundy" : "text-clay"}`}>{item.count}</span>
                      <span className={`w-full max-w-[42px] rounded-t-[5px] bg-gradient-to-b from-[#9c5362] to-burgundy transition-all duration-200 ${active ? "shadow-[0_8px_18px_-8px_rgba(111,31,49,.7)] ring-2 ring-burgundy/15" : "group-hover:brightness-105"}`} style={{ height }} />
                    </button>
                  );
                })}
              </div>

              {chartData.some((item) => item.value > 0) ? (
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 700 160" preserveAspectRatio="none" aria-hidden="true">
                  <polyline points={linePoints} fill="none" stroke="#e89a9c" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  {chartPoints.map((point, index) => <circle key={chartData[index].month} cx={point.x} cy={point.y} r={hoveredChart === index ? 5 : 3.5} fill="#fffdfc" stroke="#e89a9c" strokeWidth={hoveredChart === index ? 3 : 2} vectorEffect="non-scaling-stroke" />)}
                </svg>
              ) : null}
            </div>
            <div className="absolute bottom-0 left-9 right-12 flex gap-2">
              {chartData.map((item) => <span key={item.month} className={`min-w-0 flex-1 text-center text-[10px] ${item.month === selectedMonth ? "font-bold text-burgundy" : "text-clay/50"}`}>{monthShort(item.month)}</span>)}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center rounded-lg bg-[#fff0ef] px-4 py-3">
            <div>
              <p className="text-[10px] text-burgundy/60">Total previsto no período</p>
              <p className="text-sm font-semibold text-burgundy">{projectedNext6} liberações</p>
            </div>
            <div className="h-8 w-px bg-rose/30" />
            <div className="text-right">
              <p className="text-sm font-semibold text-burgundy">{projectedValueNext6 > 0 ? formatarMoeda(projectedValueNext6) : "Valor aguardando CRM"}</p>
              <p className="text-[10px] text-burgundy/55">em valor de cartas</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#eadedf] bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-burgundy"><PieChart className="h-4 w-4" />Carteiras por parcelamento</h2>
          <p className="mt-1 text-[11px] leading-4 text-clay/45">Carteiras do mês analisado, calculadas pelo vencimento da parcela-alvo.</p>
          <div className="mt-3 space-y-1.5">
            {rules.map((rule) => {
              const clients = releaseMonthClients.filter((client) => client.totalParcelas === rule.parcelas);
              const count = clients.length;
              const value = clients.reduce((sum, client) => sum + Number(client.valorCarta || 0), 0);
              return (
                <button
                  type="button"
                  key={rule.parcelas}
                  onClick={() => { setSelectedPortfolio(rule.parcelas); setPortfolioPage(1); setPortfolioSearch(""); }}
                  className="group flex w-full items-center gap-3 rounded-lg border border-[#efe5e4] bg-[#fffdfc] px-3 py-2 text-left transition hover:-translate-y-px hover:border-burgundy/20 hover:bg-[#fff9f8] hover:shadow-sm"
                >
                  <span className={`flex h-8 min-w-[52px] items-center justify-center rounded-md text-xs font-bold text-burgundy ${PLAN_ACCENTS[rule.parcelas] ?? "bg-blush"}`}>{rule.parcelas}x</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-clay/65">{count} cliente{count === 1 ? "" : "s"}</span>
                    <span className="block truncate text-[10px] text-clay/38">{value > 0 ? compactMoney(value) : "valor pendente"}</span>
                  </span>
                  <span className="text-xs font-semibold text-burgundy">{rule.parcelasNecessarias}ª</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-burgundy/30 transition group-hover:text-burgundy" />
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-[#eadedf] bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-[#eee3e3] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-burgundy"><UsersRound className="h-4 w-4" />Clientes do CRM e Previsões</h2>
            <p className="mt-0.5 text-[11px] text-clay/45">Dados do CRM com previsão automática baseada no parcelamento e nos boletos registrados.</p>
          </div>
          <button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#eadedf] px-3 text-xs font-medium text-burgundy hover:bg-[#fff8f7]">
            <Download className="h-3.5 w-3.5" />Exportar
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead className="bg-[#fbf8f7]">
              <tr className="text-[11px] font-semibold text-clay/55">
                <th className="px-4 py-2.5">Cliente</th>
                <th className="px-4 py-2.5">Campanha</th>
                <th className="px-4 py-2.5">Vendedora</th>
                <th className="px-4 py-2.5">Plano</th>
                <th className="px-4 py-2.5">Valor da Carta</th>
                <th className="px-4 py-2.5">1º Boleto</th>
                <th className="px-4 py-2.5">Meta p/ liberação</th>
                <th className="px-4 py-2.5">Previsão de Liberação</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0e7e6]">
              {filteredClients.slice(0, 12).map((client) => (
                <tr key={client.clienteId} className="text-xs transition hover:bg-[#fff8f7]">
                  <td className="px-4 py-3 font-medium text-clay">
                    <button type="button" onClick={() => setSelectedClient(client)} className="hover:text-burgundy hover:underline">{client.nome}</button>
                  </td>
                  <td className="px-4 py-3 text-clay/60">{client.campanha || "Sem campanha"}</td>
                  <td className="px-4 py-3 text-clay/60">{client.responsavel || "Sem vendedora"}</td>
                  <td className="px-4 py-3 font-semibold text-burgundy">{client.totalParcelas}x</td>
                  <td className="px-4 py-3 font-medium">{money(client.valorCarta)}</td>
                  <td className="px-4 py-3">{dateLabel(client.primeiroVencimento || client.primeiroBoletoEm)}</td>
                  <td className="px-4 py-3">{client.parcelasNecessarias ? `${client.parcelasNecessarias} parcelas` : "—"}</td>
                  <td className="px-4 py-3 font-medium text-burgundy">{dateLabel(client.previsao)}</td>
                  <td className="px-4 py-3"><StatusBadge situacao={client.situacao} fontePrevisao={client.fontePrevisao} /></td>
                  <td className="px-3"><button type="button" onClick={() => setSelectedClient(client)}><MoreVertical className="h-4 w-4 text-clay/45" /></button></td>
                </tr>
              ))}
              {filteredClients.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-clay/45">Nenhuma cliente encontrada com os filtros atuais.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedPortfolio != null && selectedRule ? (
        <DrawerShell onClose={() => setSelectedPortfolio(null)}>
          <div className="sticky top-0 z-20 border-b border-[#eee3e3] bg-[#fffdfc]/95 px-5 py-4 backdrop-blur-xl sm:px-6 xl:px-7">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <PieChart className="h-7 w-7 text-burgundy" />
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-burgundy">Carteira {selectedPortfolio}x · {monthLong(selectedMonth)}</h2>
                  <p className="mt-0.5 text-sm text-clay/55">Clientes com {selectedRule.parcelasNecessarias}ª parcela prevista para este mês</p>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedPortfolio(null)} className="rounded-lg p-2 text-burgundy/70 transition hover:bg-blush"><X className="h-5 w-5" /></button>
            </div>
          </div>
          <div className="p-5 sm:p-6 xl:p-7">
            <div className="rounded-xl border border-[#f0c9cd] bg-[#fff0f1] p-4">
              <div className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-burgundy text-white"><CircleAlert className="h-4 w-4" /></span>
                <div>
                  <p className="text-sm font-semibold text-burgundy">Regra do plano {selectedPortfolio}x: {selectedRule.percentual}% pago = {selectedRule.parcelasNecessarias}ª parcela</p>
                  <p className="mt-1 text-sm text-[#614b52]">Entram nesta carteira apenas clientes cuja <strong>{selectedRule.parcelasNecessarias}ª parcela vence em {monthLong(selectedMonth)}</strong>.</p>
                  <p className="mt-1 text-xs italic text-clay/45">Exemplo: se a cliente pagou {selectedRule.parcelasNecessarias - 1} parcelas até o mês anterior, ela entra nesta previsão no vencimento da {selectedRule.parcelasNecessarias}ª parcela.</p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-[#eadedf] bg-white p-3.5"><p className="text-[11px] text-clay/50">Clientes na carteira</p><p className="mt-1 text-xl font-semibold text-burgundy">{rawPortfolioClients.length}</p></div>
              <div className="rounded-xl border border-[#eadedf] bg-white p-3.5"><p className="text-[11px] text-clay/50">Valor previsto</p><p className="mt-1 text-xl font-semibold text-burgundy">{portfolioTotalValue > 0 ? formatarMoeda(portfolioTotalValue) : "—"}</p></div>
              <div className="rounded-xl border border-[#eadedf] bg-white p-3.5"><p className="text-[11px] text-clay/50">Mês filtrado</p><p className="mt-1 text-base font-semibold text-burgundy">{monthLong(selectedMonth)}</p></div>
              <div className="rounded-xl border border-[#eadedf] bg-white p-3.5"><p className="text-[11px] text-clay/50">Parcela necessária</p><p className="mt-1 text-xl font-semibold text-burgundy">{selectedRule.parcelasNecessarias}ª</p></div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold text-burgundy"><UsersRound className="h-5 w-5" />Clientes da carteira {selectedPortfolio}x</h3>
              <label className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-clay/35" />
                <input value={portfolioSearch} onChange={(event) => { setPortfolioSearch(event.target.value); setPortfolioPage(1); }} placeholder="Buscar cliente, campanha ou vendedora..." className="h-9 min-w-[280px] rounded-lg border border-[#eadedf] bg-white pl-8 pr-3 text-sm outline-none focus:border-burgundy/25" />
              </label>
            </div>

            <div className="mt-3 overflow-x-auto rounded-xl border border-[#eadedf]">
              <table className="w-full min-w-[980px] text-left">
                <thead className="bg-[#fbf8f7]">
                  <tr className="text-xs font-semibold text-clay/55">
                    <th className="px-4 py-2.5">Cliente</th>
                    <th className="px-4 py-2.5">Campanha</th>
                    <th className="px-4 py-2.5">Vendedora</th>
                    <th className="px-4 py-2.5">Parcelas pagas</th>
                    <th className="px-4 py-2.5">Parcela-alvo</th>
                    <th className="px-4 py-2.5">Vencimento da {selectedRule.parcelasNecessarias}ª</th>
                    <th className="px-4 py-2.5">Valor da carta</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0e7e6]">
                  {pagedPortfolioClients.map((client) => (
                    <tr key={client.clienteId} className="cursor-pointer text-xs transition hover:bg-[#fff8f7]" onClick={() => setSelectedClient(client)}>
                      <td className="px-4 py-3"><span className="font-semibold text-clay hover:text-burgundy">{client.nome}</span></td>
                      <td className="px-4 py-3">{client.campanha || "Sem campanha"}</td>
                      <td className="px-4 py-3">{client.responsavel || "—"}</td>
                      <td className="px-4 py-3 font-medium">{client.parcelasPagas}/{client.totalParcelas} pagas</td>
                      <td className="px-4 py-3 font-medium text-burgundy">{client.parcelasNecessarias}ª parcela</td>
                      <td className="px-4 py-3 font-medium">{dateLabel(client.previsao)}</td>
                      <td className="px-4 py-3 font-semibold">{money(client.valorCarta)}</td>
                      <td className="px-4 py-3"><StatusBadge situacao={client.situacao} size="md" /></td>
                      <td className="px-3"><MoreVertical className="h-4 w-4 text-clay/45" /></td>
                    </tr>
                  ))}
                  {portfolioClients.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-clay/45">Nenhuma cliente deste parcelamento está prevista para {monthLong(selectedMonth)}.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-clay/50">Mostrando {portfolioClients.length ? (portfolioPage - 1) * pageSize + 1 : 0}–{Math.min(portfolioClients.length, portfolioPage * pageSize)} de {portfolioClients.length} clientes da carteira</p>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPortfolioPage((page) => Math.max(1, page - 1))} className="rounded-md border border-[#eadedf] p-1"><ChevronLeft className="h-3.5 w-3.5" /></button>
                {Array.from({ length: Math.min(5, portfolioPages) }, (_, index) => index + 1).map((page) => (
                  <button type="button" key={page} onClick={() => setPortfolioPage(page)} className={`h-7 w-7 rounded-md border text-xs ${portfolioPage === page ? "border-burgundy bg-burgundy text-white" : "border-[#eadedf] bg-white text-burgundy"}`}>{page}</button>
                ))}
                <button type="button" onClick={() => setPortfolioPage((page) => Math.min(portfolioPages, page + 1))} className="rounded-md border border-[#eadedf] p-1"><ChevronRight className="h-3.5 w-3.5" /></button>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-[#f0d4d5] bg-[#fff2f2] p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-4 text-[#674e55]">Esta carteira considera apenas clientes do plano {selectedPortfolio}x cuja parcela-alvo ({selectedRule.parcelasNecessarias}ª) tem vencimento em {monthLong(selectedMonth)}.</p>
              <button type="button" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#e7c8ca] bg-white px-3 text-xs font-semibold text-burgundy hover:bg-[#fff6f6]"><Download className="h-3.5 w-3.5" />Exportar carteira</button>
            </div>
          </div>
        </DrawerShell>
      ) : null}

      {selectedClient ? <CompactClientForecastDrawer client={selectedClient} rules={rules} onClose={() => setSelectedClient(null)} /> : null}
    </div>
  );
}
