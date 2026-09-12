"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  Percent,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  DualBarChart,
  EmptyPanel,
  Panel,
  SectionHeading,
} from "@/components/admin/ExecutiveUI";
import { fetchInstant, getInstantCache, refreshInstant } from "@/lib/instantCache";
import { formatarMoeda } from "@/lib/utils";
import type { ResumoFinanceiro } from "@/features/financeiro/types";

type RawItem = Record<string, unknown>;

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

interface CarteiraAtiva {
  clientesAtivos: number;
  valorContratadoAtivo: number;
  ticketMedio: number;
  taxaAdministrativaMedia: number;
  taxaInadimplencia: number;
  parcelasVencidas: number;
  totalParcelas: number;
}

interface VisaoGeralData {
  comprovantesPendentes: ComprovantePendente[];
  proximosAgendamentos: AgendamentoTermo[];
  clientesAguardandoLiberacao: ClienteAguardandoLiberacao[];
  proximasLiberacoesFinanceiras: LiberacaoFinanceira[];
  carteira: CarteiraAtiva | null;
}

type RawVisao = Partial<Record<Exclude<keyof VisaoGeralData, "carteira">, RawItem[]>> & { carteira?: RawItem };

const EMPTY_VISAO: VisaoGeralData = {
  comprovantesPendentes: [],
  proximosAgendamentos: [],
  clientesAguardandoLiberacao: [],
  proximasLiberacoesFinanceiras: [],
  carteira: null,
};

function numero(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function texto(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizarVisao(payload: RawVisao | null | undefined): VisaoGeralData {
  const comprovantes = Array.isArray(payload?.comprovantesPendentes) ? payload.comprovantesPendentes : [];
  const agendamentos = Array.isArray(payload?.proximosAgendamentos) ? payload.proximosAgendamentos : [];
  const aguardando = Array.isArray(payload?.clientesAguardandoLiberacao) ? payload.clientesAguardandoLiberacao : [];
  const liberacoes = Array.isArray(payload?.proximasLiberacoesFinanceiras) ? payload.proximasLiberacoesFinanceiras : [];

  return {
    comprovantesPendentes: comprovantes.map((item) => ({
      boletoId: texto(item.boletoId),
      clienteId: texto(item.clienteId),
      nome: texto(item.nome, "Cliente"),
      numeroParcela: numero(item.numeroParcela),
      totalParcelas: numero(item.totalParcelas),
      valor: numero(item.valor),
      dataPagamento: texto(item.dataPagamento) || null,
    })),
    proximosAgendamentos: agendamentos.map((item) => ({
      agendamentoId: texto(item.agendamentoId),
      clienteId: texto(item.clienteId),
      nome: texto(item.nome, "Cliente"),
      data: texto(item.data) || null,
      valorContrato: numero(item.valorContrato ?? item.valor),
    })),
    clientesAguardandoLiberacao: aguardando.map((item) => ({
      clienteId: texto(item.clienteId),
      nome: texto(item.nome, "Cliente"),
      valorContrato: numero(item.valorContrato ?? item.valor),
      quantidadeParcelas: item.quantidadeParcelas == null ? null : numero(item.quantidadeParcelas),
      porcentagemPagamento: numero(item.porcentagemPagamento),
    })),
    proximasLiberacoesFinanceiras: liberacoes.map((item) => ({
      agendamentoId: texto(item.agendamentoId),
      clienteId: texto(item.clienteId),
      nome: texto(item.nome, "Cliente"),
      valorContrato: numero(item.valorContrato ?? item.valor),
      dataPrevisao: texto(item.dataPrevisao) || null,
    })),
    carteira: payload?.carteira
      ? {
          clientesAtivos: numero(payload.carteira.clientesAtivos),
          valorContratadoAtivo: numero(payload.carteira.valorContratadoAtivo),
          ticketMedio: numero(payload.carteira.ticketMedio),
          taxaAdministrativaMedia: numero(payload.carteira.taxaAdministrativaMedia),
          taxaInadimplencia: numero(payload.carteira.taxaInadimplencia),
          parcelasVencidas: numero(payload.carteira.parcelasVencidas),
          totalParcelas: numero(payload.carteira.totalParcelas),
        }
      : null,
  };
}

function dataCurta(value: string | null | undefined) {
  if (!value) return "—";
  const iso = String(value).slice(0, 10);
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "—";
}

function periodoLabel(resumo: ResumoFinanceiro | null) {
  if (!resumo?.periodo) return "Mês atual";
  return `${dataCurta(resumo.periodo.inicio)} — ${dataCurta(resumo.periodo.fim)}`;
}

function percentual(parte: number, total: number) {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, (parte / total) * 100));
}

function money(value: unknown) {
  return formatarMoeda(numero(value));
}

function LinkAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-burgundy/55 transition hover:bg-blush/70 hover:text-burgundy dark:text-white/42 dark:hover:bg-white/6 dark:hover:text-white/75"
    >
      {children} <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function Metric({
  label,
  value,
  helper,
  icon: Icon,
  emphasis = false,
}: {
  label: string;
  value: string;
  helper: string;
  icon: typeof CircleDollarSign;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 px-3 py-2.5 first:pl-0 last:pr-0">
      <div className="flex items-center gap-2">
        <span className={emphasis ? "text-alert" : "text-burgundy/55 dark:text-rose"}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <p className="truncate text-[9px] font-bold uppercase tracking-[0.14em] text-clay/45 dark:text-white/40">{label}</p>
      </div>
      <p className={`mt-1 truncate text-lg font-semibold tracking-[-0.025em] ${emphasis ? "text-alert" : "text-burgundy dark:text-cream"}`}>{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-clay/40 dark:text-white/34">{helper}</p>
    </div>
  );
}

function ActionRow({
  href,
  title,
  detail,
  value,
  badge,
  badgeClass,
}: {
  href: string;
  title: string;
  detail: string;
  value?: string;
  badge: string;
  badgeClass: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-rose/10 bg-blush/20 px-3 py-2.5 transition hover:border-rose/20 hover:bg-blush/45 dark:border-white/6 dark:bg-white/[0.025] dark:hover:bg-white/[0.05]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-burgundy dark:text-cream">{title}</p>
        <p className="mt-0.5 truncate text-[10px] text-clay/45 dark:text-white/36">{detail}</p>
      </div>
      <div className="shrink-0 text-right">
        {value ? <p className="text-[11px] font-semibold text-burgundy dark:text-cream">{value}</p> : null}
        <span className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${badgeClass}`}>{badge}</span>
      </div>
    </Link>
  );
}

export default function VisaoGeralPage() {
  const [financeiro, setFinanceiro] = useState<ResumoFinanceiro | null>(null);
  const [visao, setVisao] = useState<VisaoGeralData>(EMPTY_VISAO);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erroFinanceiro, setErroFinanceiro] = useState("");
  const [erroOperacao, setErroOperacao] = useState("");

  async function carregar(force = false) {
    const financeUrl = "/api/admin/financeiro/resumo";
    const operationUrl = "/api/admin/visao-geral";

    if (!force) {
      const cachedFinanceiro = getInstantCache<ResumoFinanceiro>(financeUrl);
      const cachedVisao = getInstantCache<RawVisao>(operationUrl);
      if (cachedFinanceiro) setFinanceiro(cachedFinanceiro);
      if (cachedVisao) setVisao(normalizarVisao(cachedVisao));
    } else {
      setAtualizando(true);
    }

    const fetcherFinanceiro = force ? refreshInstant<ResumoFinanceiro> : fetchInstant<ResumoFinanceiro>;
    const fetcherVisao = force ? refreshInstant<RawVisao> : fetchInstant<RawVisao>;

    const [financeResult, operationResult] = await Promise.allSettled([
      fetcherFinanceiro(financeUrl),
      fetcherVisao(operationUrl),
    ]);

    if (financeResult.status === "fulfilled") {
      setFinanceiro(financeResult.value);
      setErroFinanceiro("");
    } else {
      setErroFinanceiro(financeResult.reason instanceof Error ? financeResult.reason.message : "Resumo financeiro indisponível.");
    }

    if (operationResult.status === "fulfilled") {
      setVisao(normalizarVisao(operationResult.value));
      setErroOperacao("");
    } else {
      setErroOperacao(operationResult.reason instanceof Error ? operationResult.reason.message : "Pendências operacionais indisponíveis.");
    }

    setCarregando(false);
    setAtualizando(false);
  }

  useEffect(() => {
    void carregar();
    const timer = window.setInterval(() => void carregar(true), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const totalPeriodo = financeiro?.kpis.aReceber ?? 0;
  const recebido = financeiro?.kpis.recebido ?? 0;
  const vencido = financeiro?.kpis.vencido ?? 0;
  const emAberto = Math.max(0, totalPeriodo - recebido);
  const taxaRealizacao = percentual(recebido, totalPeriodo);
  const taxaAtraso = percentual(vencido, totalPeriodo);

  if (carregando && !financeiro) {
    return (
      <div className="space-y-4 pb-8">
        <div className="h-20 animate-pulse rounded-2xl bg-white/60 dark:bg-white/5" />
        <div className="h-32 animate-pulse rounded-2xl bg-white/60 dark:bg-white/5" />
        <div className="grid gap-4 xl:grid-cols-[1.55fr_.75fr]">
          <div className="h-72 animate-pulse rounded-2xl bg-white/60 dark:bg-white/5" />
          <div className="h-72 animate-pulse rounded-2xl bg-white/60 dark:bg-white/5" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <section className="flex flex-col gap-3 rounded-2xl border border-white/70 bg-white/80 px-4 py-4 shadow-[0_18px_56px_-40px_rgba(122,38,50,.38)] backdrop-blur-xl dark:border-white/8 dark:bg-[#171519]/92 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-burgundy/42 dark:text-white/34">Visão executiva</p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-[-0.035em] text-burgundy dark:text-cream">Visão Geral</h1>
            <span className="text-[10px] font-medium text-clay/45 dark:text-white/35">{periodoLabel(financeiro)}</span>
          </div>
          <p className="mt-1 text-[11px] text-clay/48 dark:text-white/38">Financeiro, projeção de caixa e filas que exigem ação da equipe.</p>
        </div>
        <button
          type="button"
          onClick={() => void carregar(true)}
          disabled={atualizando}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-burgundy/10 bg-white/80 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-burgundy transition hover:bg-blush/60 disabled:opacity-60 dark:border-white/8 dark:bg-white/5 dark:text-cream"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${atualizando ? "animate-spin" : ""}`} />
          {atualizando ? "Atualizando" : "Atualizar"}
        </button>
      </section>

      {(erroFinanceiro || erroOperacao) ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
          {erroFinanceiro ? `Financeiro: ${erroFinanceiro}` : ""}
          {erroFinanceiro && erroOperacao ? " · " : ""}
          {erroOperacao ? `Operação: ${erroOperacao}` : ""}
        </div>
      ) : null}

      <Panel className="overflow-hidden p-0 dark:border-white/8 dark:bg-[#171519]/92">
        <div className="flex flex-col gap-3 border-b border-rose/10 px-4 py-3 dark:border-white/6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-burgundy/40 dark:text-white/32">Carteira ativa</p>
            <p className="mt-0.5 text-xs text-clay/55 dark:text-white/45">Contratos em andamento sob gestão financeira da Sra. Luck.</p>
          </div>
          <LinkAction href="/admin/clientes">Ver clientes</LinkAction>
        </div>

        {visao.carteira ? (
          <div className="grid grid-cols-2 divide-x divide-y divide-rose/10 px-4 sm:grid-cols-3 xl:grid-cols-5 xl:divide-y-0 dark:divide-white/6">
            <Metric label="Clientes ativos" value={String(visao.carteira.clientesAtivos)} helper="contratos em andamento" icon={Users} />
            <Metric label="Valor em carteira" value={money(visao.carteira.valorContratadoAtivo)} helper="soma dos contratos ativos" icon={Wallet} />
            <Metric label="Ticket médio" value={money(visao.carteira.ticketMedio)} helper="por contrato ativo" icon={CircleDollarSign} />
            <Metric label="Taxa administrativa média" value={`${visao.carteira.taxaAdministrativaMedia.toFixed(1)}%`} helper="receita da Sra. Luck" icon={Percent} />
            <Metric label="Inadimplência" value={`${visao.carteira.taxaInadimplencia.toFixed(1)}%`} helper={`${visao.carteira.parcelasVencidas} de ${visao.carteira.totalParcelas} parcelas`} icon={AlertTriangle} emphasis={visao.carteira.taxaInadimplencia > 0} />
          </div>
        ) : (
          <div className="p-4"><EmptyPanel title="Carteira indisponível" description="Não foi possível carregar os indicadores de carteira agora. Tente atualizar." /></div>
        )}
      </Panel>

      <Panel className="overflow-hidden p-0 dark:border-white/8 dark:bg-[#171519]/92">
        <div className="flex flex-col gap-3 border-b border-rose/10 px-4 py-3 dark:border-white/6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-burgundy/40 dark:text-white/32">Financeiro do período</p>
            <p className="mt-0.5 text-xs text-clay/55 dark:text-white/45">Leitura consolidada dos vencimentos e baixas já registrados.</p>
          </div>
          <LinkAction href="/admin/financeiro">Abrir financeiro</LinkAction>
        </div>

        {financeiro ? (
          <>
            <div className="grid grid-cols-2 divide-x divide-y divide-rose/10 px-4 sm:grid-cols-3 xl:grid-cols-6 xl:divide-y-0 dark:divide-white/6">
              <Metric label="Recebido" value={money(recebido)} helper="Baixas confirmadas" icon={CheckCircle2} />
              <Metric label="A receber" value={money(totalPeriodo)} helper="Vencimentos do período" icon={CircleDollarSign} />
              <Metric label="Em aberto" value={money(emAberto)} helper={`${(100 - taxaRealizacao).toFixed(1)}% do previsto`} icon={Clock3} />
              <Metric label="Vencido" value={money(vencido)} helper={`${taxaAtraso.toFixed(1)}% do previsto`} icon={AlertTriangle} emphasis={vencido > 0} />
              <Metric label="Receita adm. realizada" value={money(financeiro.kpis.receitaAdministrativaRealizada)} helper="Proporção das baixas" icon={TrendingUp} />
              <Metric label="Receita adm. futura" value={money(financeiro.kpis.receitaAdministrativaFutura)} helper="Proporção ainda em aberto" icon={Wallet} />
            </div>

            <div className="grid gap-3 border-t border-rose/10 px-4 py-3 dark:border-white/6 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="flex items-center justify-between gap-3 text-[10px]">
                  <span className="font-medium text-clay/55 dark:text-white/45">Realização financeira do período</span>
                  <span className="font-semibold text-burgundy dark:text-cream">{taxaRealizacao.toFixed(1)}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-blush/60 dark:bg-white/7">
                  <div className="h-full rounded-full bg-success transition-all" style={{ width: `${taxaRealizacao}%` }} />
                </div>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-clay/45 dark:text-white/36">
                <span><strong className="text-burgundy dark:text-cream">{financeiro.kpis.aguardandoValidacao}</strong> aguardando validação</span>
                {financeiro.truncado ? <span className="text-alert">Base truncada</span> : null}
              </div>
            </div>
          </>
        ) : (
          <div className="p-4"><EmptyPanel title="Resumo financeiro indisponível" description="A dashboard continua disponível; tente atualizar para carregar os indicadores." /></div>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,.75fr)]">
        <Panel className="p-4 dark:border-white/8 dark:bg-[#171519]/92">
          <SectionHeading
            title="Evolução financeira"
            description="Previsto versus recebido por mês, usando os mesmos dados do Financeiro."
            aside={financeiro ? <span className="text-[10px] font-semibold text-alert">Vencido: {money(vencido)}</span> : undefined}
          />
          {financeiro?.evolucao?.length ? (
            <DualBarChart
              data={financeiro.evolucao.map((item) => ({ label: item.label, value: numero(item.previsto), secondaryValue: numero(item.realizado) }))}
              primaryLabel="Previsto"
              secondaryLabel="Recebido"
              primaryColorClassName="bg-burgundy"
              secondaryColorClassName="bg-success/75"
            />
          ) : (
            <EmptyPanel title="Sem movimento no período" description="Ainda não há vencimentos ou baixas suficientes para formar o evolutivo." />
          )}
        </Panel>

        <Panel className="p-4 dark:border-white/8 dark:bg-[#171519]/92">
          <SectionHeading
            title="Previsão de caixa"
            description="Valores em aberto, não suspensos, a partir de hoje."
            aside={<CalendarClock className="h-4 w-4 text-burgundy/50 dark:text-rose" />}
          />
          {financeiro ? (
            <div className="space-y-2.5">
              {[
                { label: "30 dias", value: financeiro.previsao.dias30 },
                { label: "60 dias", value: financeiro.previsao.dias60 },
                { label: "90 dias", value: financeiro.previsao.dias90 },
              ].map((item) => {
                const max = Math.max(financeiro.previsao.dias90, 1);
                return (
                  <div key={item.label} className="rounded-xl border border-rose/10 bg-blush/25 px-3 py-2.5 dark:border-white/6 dark:bg-white/[0.025]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-medium text-clay/60 dark:text-white/50">Próximos {item.label}</span>
                      <span className="text-xs font-semibold text-burgundy dark:text-cream">{money(item.value)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white dark:bg-white/7">
                      <div className="h-full rounded-full bg-burgundy dark:bg-rose" style={{ width: `${Math.max(3, percentual(item.value, max))}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="px-1 text-[9px] leading-4 text-clay/38 dark:text-white/30">As faixas são cumulativas: 60 dias inclui os 30 primeiros; 90 dias inclui os períodos anteriores.</p>
            </div>
          ) : (
            <EmptyPanel title="Projeção indisponível" description="Não foi possível carregar a previsão financeira neste momento." />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-4 dark:border-white/8 dark:bg-[#171519]/92">
          <SectionHeading
            title="Ações financeiras pendentes"
            description="Itens que dependem de conferência ou liberação da equipe."
            aside={<LinkAction href="/admin/financeiro?aba=validacao">Ver validações</LinkAction>}
          />
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-clay/45 dark:text-white/36"><FileCheck2 className="h-3.5 w-3.5" />Comprovantes</p>
                <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[9px] font-semibold text-burgundy">{visao.comprovantesPendentes.length}</span>
              </div>
              {visao.comprovantesPendentes.length ? (
                <div className="space-y-1.5">
                  {visao.comprovantesPendentes.slice(0, 4).map((item) => (
                    <ActionRow
                      key={item.boletoId}
                      href={`/admin/financeiro?aba=validacao&cliente_id=${item.clienteId}`}
                      title={item.nome}
                      detail={`Parcela ${item.numeroParcela}/${item.totalParcelas || "—"} · ${dataCurta(item.dataPagamento)}`}
                      value={money(item.valor)}
                      badge="Validar"
                      badgeClass="bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    />
                  ))}
                </div>
              ) : <EmptyPanel title="Fila limpa" description="Nenhum comprovante aguardando validação." />}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-clay/45 dark:text-white/36"><ShieldCheck className="h-3.5 w-3.5" />Liberação da agenda</p>
                <span className="rounded-full bg-rose/15 px-2 py-0.5 text-[9px] font-semibold text-burgundy">{visao.clientesAguardandoLiberacao.length}</span>
              </div>
              {visao.clientesAguardandoLiberacao.length ? (
                <div className="space-y-1.5">
                  {visao.clientesAguardandoLiberacao.slice(0, 4).map((item) => (
                    <ActionRow
                      key={item.clienteId}
                      href="/admin/agenda"
                      title={item.nome}
                      detail={`${item.quantidadeParcelas ?? "—"}x · ${item.porcentagemPagamento}% pago`}
                      value={money(item.valorContrato)}
                      badge="Liberar"
                      badgeClass="bg-rose/15 text-burgundy dark:text-rose"
                    />
                  ))}
                </div>
              ) : <EmptyPanel title="Fila limpa" description="Nenhuma cliente aguardando liberação da agenda." />}
            </div>
          </div>
        </Panel>

        <Panel className="p-4 dark:border-white/8 dark:bg-[#171519]/92">
          <SectionHeading
            title="Agenda e liberações próximas"
            description="Compromissos já confirmados e previsões financeiras mais próximas."
            aside={<LinkAction href="/admin/agenda">Abrir agenda</LinkAction>}
          />
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-clay/45 dark:text-white/36"><CalendarClock className="h-3.5 w-3.5" />Agendamentos</p>
                <span className="text-[10px] font-semibold text-burgundy dark:text-cream">{visao.proximosAgendamentos.length}</span>
              </div>
              {visao.proximosAgendamentos.length ? (
                <div className="space-y-1.5">
                  {visao.proximosAgendamentos.slice(0, 4).map((item) => (
                    <ActionRow
                      key={item.agendamentoId}
                      href="/admin/agenda"
                      title={item.nome}
                      detail={dataCurta(item.data)}
                      value={money(item.valorContrato)}
                      badge="Confirmado"
                      badgeClass="bg-success/10 text-success"
                    />
                  ))}
                </div>
              ) : <EmptyPanel title="Sem próximos eventos" description="Nenhum agendamento confirmado nos próximos dias." />}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-clay/45 dark:text-white/36"><Wallet className="h-3.5 w-3.5" />Liberações</p>
                <span className="text-[10px] font-semibold text-burgundy dark:text-cream">{visao.proximasLiberacoesFinanceiras.length}</span>
              </div>
              {visao.proximasLiberacoesFinanceiras.length ? (
                <div className="space-y-1.5">
                  {visao.proximasLiberacoesFinanceiras.slice(0, 4).map((item) => (
                    <ActionRow
                      key={item.agendamentoId}
                      href="/admin/agenda?aba=liberacao"
                      title={item.nome}
                      detail={`Previsão · ${dataCurta(item.dataPrevisao)}`}
                      value={money(item.valorContrato)}
                      badge="Prevista"
                      badgeClass="bg-burgundy/8 text-burgundy dark:bg-white/6 dark:text-rose"
                    />
                  ))}
                </div>
              ) : <EmptyPanel title="Sem previsões próximas" description="Nenhuma liberação financeira prevista." />}
            </div>
          </div>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] uppercase tracking-[0.12em] text-clay/32 dark:text-white/25">
        <span>Dados financeiros: mesmo resumo usado na aba Financeiro</span>
        <span>Atualização automática a cada 60 segundos</span>
      </div>
    </div>
  );
}
