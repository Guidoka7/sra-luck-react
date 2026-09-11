"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  RefreshCw,
  ReceiptText,
  ShieldCheck,
  UsersRound,
  Wallet,
} from "lucide-react";
import { fetchInstant, getInstantCache, refreshInstant } from "@/lib/instantCache";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { formatarMoeda } from "@/lib/utils";

interface ComprovantePendente {
  boletoId: string;
  clienteId: string;
  nome: string;
  numeroParcela: number;
  totalParcelas: number;
  valor: number;
  dataPagamento: string | null;
}

interface AgendamentoTermo {
  agendamentoId: string;
  clienteId: string;
  nome: string;
  data: string | null;
  valorContrato: number;
}

interface ClienteAguardandoLiberacao {
  clienteId: string;
  nome: string;
  valorContrato: number;
  quantidadeParcelas: number | null;
  porcentagemPagamento: number;
}

interface LiberacaoFinanceira {
  agendamentoId: string;
  clienteId: string;
  nome: string;
  valorContrato: number;
  dataPrevisao: string | null;
}

interface VisaoGeralData {
  comprovantesPendentes: ComprovantePendente[];
  proximosAgendamentos: AgendamentoTermo[];
  clientesAguardandoLiberacao: ClienteAguardandoLiberacao[];
  proximasLiberacoesFinanceiras: LiberacaoFinanceira[];
}

type RawItem = Record<string, unknown>;
type RawData = Partial<Record<keyof VisaoGeralData, RawItem[]>>;

const EMPTY: VisaoGeralData = {
  comprovantesPendentes: [],
  proximosAgendamentos: [],
  clientesAguardandoLiberacao: [],
  proximasLiberacoesFinanceiras: [],
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalize(payload: RawData | null | undefined): VisaoGeralData {
  const comprovantes = Array.isArray(payload?.comprovantesPendentes) ? payload.comprovantesPendentes : [];
  const agendamentos = Array.isArray(payload?.proximosAgendamentos) ? payload.proximosAgendamentos : [];
  const aguardando = Array.isArray(payload?.clientesAguardandoLiberacao) ? payload.clientesAguardandoLiberacao : [];
  const liberacoes = Array.isArray(payload?.proximasLiberacoesFinanceiras) ? payload.proximasLiberacoesFinanceiras : [];

  return {
    comprovantesPendentes: comprovantes.map((item) => ({
      boletoId: str(item.boletoId),
      clienteId: str(item.clienteId),
      nome: str(item.nome, "Cliente"),
      numeroParcela: num(item.numeroParcela),
      totalParcelas: num(item.totalParcelas),
      valor: num(item.valor),
      dataPagamento: str(item.dataPagamento) || null,
    })),
    proximosAgendamentos: agendamentos.map((item) => ({
      agendamentoId: str(item.agendamentoId),
      clienteId: str(item.clienteId),
      nome: str(item.nome, "Cliente"),
      data: str(item.data) || null,
      valorContrato: num(item.valorContrato ?? item.valor),
    })),
    clientesAguardandoLiberacao: aguardando.map((item) => ({
      clienteId: str(item.clienteId),
      nome: str(item.nome, "Cliente"),
      valorContrato: num(item.valorContrato ?? item.valor),
      quantidadeParcelas: item.quantidadeParcelas == null ? null : num(item.quantidadeParcelas),
      porcentagemPagamento: num(item.porcentagemPagamento),
    })),
    proximasLiberacoesFinanceiras: liberacoes.map((item) => ({
      agendamentoId: str(item.agendamentoId),
      clienteId: str(item.clienteId),
      nome: str(item.nome, "Cliente"),
      valorContrato: num(item.valorContrato ?? item.valor),
      dataPrevisao: str(item.dataPrevisao) || null,
    })),
  };
}

function date(value: string | null) {
  if (!value) return "—";
  const [ano, mes, dia] = value.slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "—";
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function More({ href, label = "Ver tudo" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-burgundy/55 transition hover:bg-blush/60 hover:text-burgundy dark:text-white/40 dark:hover:bg-white/5 dark:hover:text-white/70">
      {label} <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function Section({ title, description, aside, children }: { title: string; description: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/70 bg-white/78 p-4 shadow-[0_18px_54px_-38px_rgba(122,38,50,0.35)] backdrop-blur-xl dark:border-white/8 dark:bg-[#171519]/88">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-[-0.015em] text-burgundy dark:text-[#f0dfdc]">{title}</h2>
          <p className="mt-0.5 text-[11px] leading-4 text-clay/45 dark:text-white/38">{description}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: string }) {
  return <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-rose/20 bg-blush/20 px-4 py-5 text-center text-xs text-clay/45 dark:border-white/8 dark:bg-white/[0.025] dark:text-white/38">{children}</div>;
}

function Kpi({ icon: Icon, label, value, helper, href, tone }: { icon: typeof ReceiptText; label: string; value: string; helper: string; href: string; tone: string }) {
  return (
    <Link href={href} className="group rounded-2xl border border-white/70 bg-white/80 p-4 shadow-[0_18px_50px_-36px_rgba(122,38,50,0.35)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-rose/20 dark:border-white/8 dark:bg-[#171519]/90">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></span>
        <ArrowUpRight className="h-4 w-4 text-burgundy/25 transition group-hover:text-burgundy/60 dark:text-white/20" />
      </div>
      <p className="mt-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-burgundy/42 dark:text-white/34">{label}</p>
      <p className="mt-1 text-[1.45rem] font-semibold tracking-[-0.035em] text-burgundy dark:text-[#f3e9e7]">{value}</p>
      <p className="mt-1 truncate text-[11px] text-clay/48 dark:text-white/40">{helper}</p>
    </Link>
  );
}

function Row({ href, icon: Icon, title, meta, value, status, dot }: { href: string; icon: typeof ReceiptText; title: string; meta: string; value?: string; status: string; dot: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-rose/[0.08] bg-blush/[0.18] px-3 py-2.5 transition hover:border-rose/15 hover:bg-blush/38 dark:border-white/5 dark:bg-white/[0.025] dark:hover:bg-white/[0.045]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/80 text-burgundy shadow-sm dark:bg-white/6 dark:text-[#dba7a6]"><Icon className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-burgundy dark:text-[#eadbd8]">{title}</p>
        <p className="mt-0.5 truncate text-[10px] text-clay/43 dark:text-white/34">{meta}</p>
      </div>
      <div className="shrink-0 text-right">
        {value ? <p className="text-[11px] font-semibold text-burgundy dark:text-[#eadbd8]">{value}</p> : null}
        <p className="mt-0.5 inline-flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.1em] text-clay/45 dark:text-white/36"><span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{status}</p>
      </div>
    </Link>
  );
}

export default function VisaoGeralPage() {
  const [dados, setDados] = useState<VisaoGeralData | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState("");

  async function carregar(force = false) {
    const url = "/api/admin/visao-geral";
    if (!force) {
      const cached = getInstantCache<RawData>(url);
      if (cached) {
        setDados(normalize(cached));
        setCarregando(false);
      }
    }

    if (force) setAtualizando(true);
    setErro("");

    try {
      const payload = force ? await refreshInstant<RawData>(url) : await fetchInstant<RawData>(url);
      setDados(normalize(payload));
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível atualizar a visão geral.");
      setDados((current) => current ?? EMPTY);
    } finally {
      setCarregando(false);
      setAtualizando(false);
    }
  }

  useEffect(() => {
    void carregar();
    const timer = window.setInterval(() => void carregar(true), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const info = useMemo(() => {
    const current = dados ?? EMPTY;
    const comprovantes = sum(current.comprovantesPendentes.map((item) => item.valor));
    const agenda = sum(current.proximosAgendamentos.map((item) => item.valorContrato));
    const aguardando = sum(current.clientesAguardandoLiberacao.map((item) => item.valorContrato));
    const liberacoes = sum(current.proximasLiberacoesFinanceiras.map((item) => item.valorContrato));
    const bars = [
      { label: "Validações", value: current.comprovantesPendentes.length, color: "bg-amber-500" },
      { label: "Agenda", value: current.proximosAgendamentos.length, color: "bg-emerald-500" },
      { label: "Liberação", value: current.clientesAguardandoLiberacao.length, color: "bg-rose-400" },
      { label: "Previsões", value: current.proximasLiberacoesFinanceiras.length, color: "bg-burgundy dark:bg-[#c9828b]" },
    ];
    return {
      comprovantes,
      agenda,
      aguardando,
      liberacoes,
      bars,
      max: Math.max(...bars.map((item) => item.value), 1),
      total: bars.reduce((total, item) => total + item.value, 0),
    };
  }, [dados]);

  if (carregando && !dados) {
    return <div className="space-y-4 pb-8"><div className="h-24 animate-pulse rounded-2xl bg-white/55 dark:bg-white/5" /><SkeletonCards count={4} /><div className="grid gap-4 xl:grid-cols-2"><div className="h-64 animate-pulse rounded-2xl bg-white/55 dark:bg-white/5" /><div className="h-64 animate-pulse rounded-2xl bg-white/55 dark:bg-white/5" /></div></div>;
  }

  const current = dados ?? EMPTY;

  return (
    <div className="space-y-4 pb-8">
      <section className="relative overflow-hidden rounded-2xl border border-white/70 bg-white/80 px-4 py-4 shadow-[0_20px_60px_-40px_rgba(122,38,50,0.40)] backdrop-blur-xl dark:border-white/8 dark:bg-[#171519]/90 sm:px-5">
        <div className="pointer-events-none absolute -right-14 -top-20 h-48 w-48 rounded-full bg-rose/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-burgundy/45 dark:text-white/35">Dashboard executivo</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/15 bg-emerald-500/[0.07] px-2 py-0.5 text-[9px] font-medium text-emerald-700 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Dados operacionais</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-burgundy dark:text-[#f2e7e4]">Visão Geral</h1>
            <p className="mt-1 max-w-3xl text-[11px] leading-4 text-clay/50 dark:text-white/40">Prioridades financeiras, agenda e liberações reunidas em uma leitura rápida da operação.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden rounded-xl border border-rose/10 bg-blush/25 px-3 py-2 text-right sm:block dark:border-white/6 dark:bg-white/[0.025]"><p className="text-[9px] uppercase tracking-[0.15em] text-clay/38 dark:text-white/30">Itens monitorados</p><p className="mt-0.5 text-sm font-semibold text-burgundy dark:text-[#eadbd8]">{info.total}</p></div>
            <button type="button" onClick={() => void carregar(true)} disabled={atualizando} className="inline-flex h-10 items-center gap-2 rounded-xl bg-burgundy px-3.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_12px_28px_-16px_rgba(122,38,50,0.75)] transition hover:bg-burgundy-dark disabled:opacity-60 dark:bg-[#7f3546]"><RefreshCw className={`h-3.5 w-3.5 ${atualizando ? "animate-spin" : ""}`} />{atualizando ? "Atualizando" : "Atualizar"}</button>
          </div>
        </div>
      </section>

      {erro ? <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200"><span>Falha na última atualização: {erro}</span><button type="button" onClick={() => void carregar(true)} className="shrink-0 font-semibold underline underline-offset-2">Tentar novamente</button></div> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={ReceiptText} label="Comprovantes pendentes" value={String(current.comprovantesPendentes.length)} helper={`${formatarMoeda(info.comprovantes)} nos itens exibidos`} href="/admin/financeiro?aba=validacao" tone="bg-gold/25 text-burgundy dark:bg-[#a87b36]/18 dark:text-[#e1bd79]" />
        <Kpi icon={CalendarClock} label="Próximos agendamentos" value={String(current.proximosAgendamentos.length)} helper={`${formatarMoeda(info.agenda)} nos itens exibidos`} href="/admin/agenda" tone="bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" />
        <Kpi icon={UsersRound} label="Aguardando agenda" value={String(current.clientesAguardandoLiberacao.length)} helper={`${formatarMoeda(info.aguardando)} nos itens exibidos`} href="/admin/agenda" tone="bg-rose/15 text-burgundy dark:bg-[#aa6670]/12 dark:text-[#e4aaa8]" />
        <Kpi icon={Wallet} label="Liberações previstas" value={String(current.proximasLiberacoesFinanceiras.length)} helper={`${formatarMoeda(info.liberacoes)} nos itens exibidos`} href="/admin/agenda?aba=liberacao" tone="bg-burgundy text-white dark:bg-[#7f3546]" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Section title="Prioridades financeiras" description="Pendências que exigem validação ou liberação da equipe." aside={<More href="/admin/financeiro?aba=validacao" label="Financeiro" />}>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between"><p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-burgundy/48 dark:text-white/36"><ReceiptText className="h-3.5 w-3.5" />Comprovantes</p><span className="text-[10px] font-semibold text-burgundy dark:text-[#e4cecb]">{current.comprovantesPendentes.length}</span></div>
              {current.comprovantesPendentes.length === 0 ? <Empty>Nenhum comprovante aguardando validação.</Empty> : <div className="space-y-1.5">{current.comprovantesPendentes.slice(0, 4).map((item) => <Row key={item.boletoId} href="/admin/financeiro?aba=validacao" icon={ReceiptText} title={item.nome} meta={`Parcela ${item.numeroParcela}/${item.totalParcelas || "—"} · ${date(item.dataPagamento)}`} value={formatarMoeda(item.valor)} status="Validar" dot="bg-amber-500" />)}</div>}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between"><p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-burgundy/48 dark:text-white/36"><ShieldCheck className="h-3.5 w-3.5" />Liberação de agenda</p><span className="text-[10px] font-semibold text-burgundy dark:text-[#e4cecb]">{current.clientesAguardandoLiberacao.length}</span></div>
              {current.clientesAguardandoLiberacao.length === 0 ? <Empty>Nenhuma cliente aguardando liberação.</Empty> : <div className="space-y-1.5">{current.clientesAguardandoLiberacao.slice(0, 4).map((item) => <Row key={item.clienteId} href="/admin/agenda" icon={ShieldCheck} title={item.nome} meta={`${item.quantidadeParcelas ?? "—"}x · ${item.porcentagemPagamento}% pago`} value={formatarMoeda(item.valorContrato)} status="Pendente" dot="bg-rose-400" />)}</div>}
            </div>
          </div>
        </Section>

        <Section title="Pulso operacional" description="Distribuição dos itens atualmente monitorados no painel." aside={<Activity className="h-4 w-4 text-burgundy/45 dark:text-white/38" />}>
          <div className="space-y-3 pt-1">{info.bars.map((item) => { const width = `${Math.max((item.value / info.max) * 100, item.value > 0 ? 10 : 2)}%`; return <div key={item.label}><div className="mb-1 flex items-center justify-between text-[10px]"><span className="text-clay/50 dark:text-white/40">{item.label}</span><span className="font-semibold text-burgundy dark:text-[#eadbd8]">{item.value}</span></div><div className="h-2 overflow-hidden rounded-full bg-blush/55 dark:bg-white/6"><div className={`h-full rounded-full transition-all duration-500 ${item.color}`} style={{ width }} /></div></div>; })}</div>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-rose/10 pt-3 dark:border-white/6"><div className="rounded-xl bg-blush/25 px-3 py-2 dark:bg-white/[0.025]"><p className="text-[9px] uppercase tracking-[0.12em] text-clay/35 dark:text-white/28">Financeiro pendente</p><p className="mt-1 text-xs font-semibold text-burgundy dark:text-[#eadbd8]">{formatarMoeda(info.comprovantes)}</p></div><div className="rounded-xl bg-blush/25 px-3 py-2 dark:bg-white/[0.025]"><p className="text-[9px] uppercase tracking-[0.12em] text-clay/35 dark:text-white/28">Liberação prevista</p><p className="mt-1 text-xs font-semibold text-burgundy dark:text-[#eadbd8]">{formatarMoeda(info.liberacoes)}</p></div></div>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Próximos agendamentos" description="Termos cirúrgicos confirmados na agenda." aside={<More href="/admin/agenda" />}>
          {current.proximosAgendamentos.length === 0 ? <Empty>Nenhum agendamento confirmado nos próximos dias.</Empty> : <div className="space-y-1.5">{current.proximosAgendamentos.slice(0, 5).map((item) => <Row key={item.agendamentoId} href="/admin/agenda" icon={CalendarClock} title={item.nome} meta={date(item.data)} value={formatarMoeda(item.valorContrato)} status="Confirmado" dot="bg-emerald-500" />)}</div>}
        </Section>
        <Section title="Próximas liberações financeiras" description="Previsões definidas, ordenadas pela data mais próxima." aside={<More href="/admin/agenda?aba=liberacao" />}>
          {current.proximasLiberacoesFinanceiras.length === 0 ? <Empty>Nenhuma liberação financeira prevista.</Empty> : <div className="space-y-1.5">{current.proximasLiberacoesFinanceiras.slice(0, 5).map((item) => <Row key={item.agendamentoId} href="/admin/agenda?aba=liberacao" icon={Clock3} title={item.nome} meta={`Previsão · ${date(item.dataPrevisao)}`} value={formatarMoeda(item.valorContrato)} status="Prevista" dot="bg-burgundy dark:bg-[#c9828b]" />)}</div>}
        </Section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] uppercase tracking-[0.14em] text-clay/35 dark:text-white/28"><span className="inline-flex items-center gap-1.5"><CircleDollarSign className="h-3 w-3" />Valores consolidados somente a partir dos itens exibidos pela API</span><span>Atualização automática a cada 60 segundos</span></div>
    </div>
  );
}
