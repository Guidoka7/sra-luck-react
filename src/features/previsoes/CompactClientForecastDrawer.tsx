"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileClock,
  MessageSquarePlus,
  PauseCircle,
  RefreshCw,
  RotateCcw,
  Send,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { formatarMoeda } from "@/lib/utils";

type Confianca = "alta" | "media" | "baixa";

interface RegraForecast {
  parcelas: number;
  percentual: number;
  parcelasNecessarias: number;
}

interface ClienteSnapshot {
  clienteId: string;
  nome: string;
  campanha: string | null;
  origem: string | null;
  responsavel: string | null;
  totalParcelas: number;
  percentual: number | null;
  parcelasNecessarias: number | null;
  parcelasPagas: number;
  parcelasVencidas: number;
  previsao: string | null;
  valorCarta?: number | null;
  codigoContrato?: string | null;
  dataVenda?: string | null;
  confianca?: Confianca;
}

interface BoletoLive {
  id: string;
  numero_parcela: number;
  total_parcelas: number;
  valor: number;
  data_vencimento: string | null;
  status: string;
  data_pagamento: string | null;
  observacoes?: string | null;
  suspensa?: boolean;
  suspensa_em?: string | null;
  suspensa_por?: string | null;
  updated_at?: string | null;
}

interface HistoricoLive {
  id?: string;
  usuario?: string | null;
  acao: string;
  detalhes?: Record<string, any> | null;
  created_at?: string | null;
}

interface CadastroLive {
  id: string;
  valor_contrato?: number | string | null;
  quantidade_parcelas?: number | null;
  ativo?: boolean;
  status_financeiro?: string | null;
}

interface DetailState {
  boletos: BoletoLive[];
  historico: HistoricoLive[];
  cadastro: CadastroLive | null;
}

type Tone = "neutral" | "success" | "warning" | "danger" | "paused";

interface Adendo {
  key: string;
  tone: Tone;
  title: string;
  detail: string;
  date?: string | null;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "—";
}

function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}` : "—";
}

function monthYearLabel(value: string | null | undefined) {
  if (!value) return null;
  const [year, month] = value.slice(0, 10).split("-");
  const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const index = Number(month) - 1;
  return year && months[index] ? `${months[index]} de ${year}` : null;
}

function money(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? formatarMoeda(numeric) : "—";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CL";
}

function confidenceLabel(value: Confianca | null | undefined) {
  if (value === "alta") return "Alta";
  if (value === "media") return "Média";
  if (value === "baixa") return "Baixa";
  return "—";
}

function usuarioLabel(value: string | null | undefined) {
  if (!value) return "Equipe administrativa";
  return value.startsWith("admin:") ? "Equipe administrativa" : value;
}

function listParcelas(rows: BoletoLive[], limit = 6) {
  const numbers = rows
    .map((row) => Number(row.numero_parcela))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!numbers.length) return "";
  const shown = numbers.slice(0, limit).map((value) => `${value}ª`).join(", ");
  return numbers.length > limit ? `${shown} +${numbers.length - limit}` : shown;
}

function historyDate(item: HistoricoLive) {
  return item.created_at ?? null;
}

function planChangeText(item: HistoricoLive) {
  const details = item.detalhes ?? {};
  const before = Number(details.total_anterior ?? details.quantidade_anterior ?? details.de ?? 0);
  const after = Number(details.total_novo ?? details.novo_total ?? details.quantidade_nova ?? details.para ?? 0);
  if (before > 0 && after >= 0 && before !== after) return `Parcelamento alterado de ${before}x para ${after}x.`;
  if (item.acao === "excluiu_parcela" && after >= 0) return `Parcelamento recalculado para ${after}x após exclusão da ${details.parcela ? `${details.parcela}ª parcela` : "parcela"}.`;
  if (item.acao === "gerou_parcelas" && Number(details.quantidade_adicionada ?? 0) > 0 && before > 0) return `${details.quantidade_adicionada} parcela(s) adicionada(s); plano passou de ${before}x para ${after || "novo total"}.`;
  if (item.acao === "alterou_quantidade_parcelas") return "Quantidade de parcelas alterada no cadastro financeiro.";
  return "";
}

function changeDetail(item: HistoricoLive) {
  const details = item.detalhes ?? {};
  if (item.acao === "editou_parcela") {
    const parcela = details.parcela ? `${details.parcela}ª parcela` : "Parcela";
    const oldDue = details.de?.data_vencimento;
    const newDue = details.para?.data_vencimento;
    if (oldDue && newDue && oldDue !== newDue) return `${parcela}: vencimento alterado de ${dateLabel(oldDue)} para ${dateLabel(newDue)}.`;
    const oldValue = Number(details.de?.valor ?? 0);
    const newValue = Number(details.para?.valor ?? 0);
    if (oldValue && newValue && oldValue !== newValue) return `${parcela}: valor alterado de ${money(oldValue)} para ${money(newValue)}.`;
    return `${parcela} atualizada no financeiro.`;
  }
  if (item.acao === "reabriu_parcela") return `${details.parcela ? `${details.parcela}ª parcela` : "Parcela"} reaberta para pagamento.`;
  if (item.acao === "suspendeu_parcelas") {
    const parcelas = Array.isArray(details.parcelas) ? details.parcelas.map((value: unknown) => `${Number(value)}ª`).join(", ") : "parcelas selecionadas";
    return `Suspensão registrada para ${parcelas}.`;
  }
  return planChangeText(item);
}

function toneClasses(tone: Tone) {
  if (tone === "danger") return "border-red-200 bg-red-50/90 text-red-800";
  if (tone === "warning") return "border-amber-200 bg-amber-50/90 text-amber-800";
  if (tone === "success") return "border-emerald-200 bg-emerald-50/90 text-emerald-800";
  if (tone === "paused") return "border-slate-300 bg-slate-50 text-slate-700";
  return "border-[#eadedf] bg-[#fffdfc] text-[#5d4b51]";
}

function statusLabel(value: string | null | undefined) {
  if (!value) return null;
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#eadedf] bg-[#fffdfc] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[.1em] text-clay/40">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-clay">{value}</p>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[.1em] text-clay/40">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-burgundy">{value}</p>
    </div>
  );
}

export function CompactClientForecastDrawer({ client, rules, onClose }: { client: ClienteSnapshot; rules: RegraForecast[]; onClose: () => void }) {
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [showObservacaoForm, setShowObservacaoForm] = useState(false);
  const [observacaoText, setObservacaoText] = useState("");
  const [savingObservacao, setSavingObservacao] = useState(false);
  const [observacaoError, setObservacaoError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/clientes/${encodeURIComponent(client.clienteId)}/parcelas`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.erro ?? "Não foi possível atualizar os dados financeiros da cliente.");
      setDetail({
        boletos: Array.isArray(result?.boletos) ? result.boletos : Array.isArray(result?.parcelas) ? result.parcelas : [],
        historico: Array.isArray(result?.historico) ? result.historico : [],
        cadastro: result?.cliente ?? null,
      });
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar os dados financeiros.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client.clienteId]);

  useEffect(() => {
    void load();
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  async function submitObservacao() {
    const texto = observacaoText.trim();
    if (!texto) { setObservacaoError("Escreva uma observação antes de salvar."); return; }
    setSavingObservacao(true);
    setObservacaoError("");
    try {
      const response = await fetch(`/api/admin/clientes/${encodeURIComponent(client.clienteId)}/parcelas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "registrar_observacao", texto }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.erro ?? "Não foi possível registrar a observação.");
      setObservacaoText("");
      setShowObservacaoForm(false);
      await load(true);
    } catch (err) {
      setObservacaoError(err instanceof Error ? err.message : "Não foi possível registrar a observação.");
    } finally {
      setSavingObservacao(false);
    }
  }

  const boletos = useMemo(() => [...(detail?.boletos ?? [])].sort((a, b) => Number(a.numero_parcela) - Number(b.numero_parcela)), [detail]);
  const cadastro = detail?.cadastro ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const maxBoletoPlan = boletos.reduce((max, row) => Math.max(max, Number(row.total_parcelas ?? 0), Number(row.numero_parcela ?? 0)), 0);
  const currentPlan = Number(cadastro?.quantidade_parcelas ?? 0) || maxBoletoPlan || client.totalParcelas || 0;
  const currentRule = rules.find((rule) => rule.parcelas === currentPlan) ?? null;
  const targetNumber = currentRule?.parcelasNecessarias ?? (currentPlan === client.totalParcelas ? client.parcelasNecessarias : null);
  const byNumber = useMemo(() => new Map(boletos.map((item) => [Number(item.numero_parcela), item])), [boletos]);
  const paid = boletos.filter((row) => row.status === "pago");
  const suspended = boletos.filter((row) => Boolean(row.suspensa) && row.status !== "pago");
  const overdue = boletos.filter((row) => !row.suspensa && !["pago", "pendente_confirmacao"].includes(row.status) && Boolean(row.data_vencimento && row.data_vencimento < today));
  const pendingConfirmation = boletos.filter((row) => row.status === "pendente_confirmacao");
  const openNotSuspended = boletos.filter((row) => row.status !== "pago" && !row.suspensa);
  const allOpenSuspended = openNotSuspended.length === 0 && suspended.length > 0;
  const contractSuspended = cadastro?.ativo === false || allOpenSuspended;
  const targetInstallment = targetNumber ? byNumber.get(targetNumber) : undefined;
  const targetPaid = targetInstallment?.status === "pago" || (targetNumber != null && paid.length >= targetNumber);
  const targetSuspended = Boolean(targetInstallment?.suspensa);
  const targetDue = targetInstallment?.data_vencimento ?? (currentPlan === client.totalParcelas ? client.previsao : null);
  const valorCarta = cadastro?.valor_contrato ?? client.valorCarta ?? null;
  const targetMonthLabel = monthYearLabel(targetDue);

  const timeline = useMemo(() => Array.from({ length: Math.max(currentPlan, 0) }, (_, index) => {
    const number = index + 1;
    const row = byNumber.get(number);
    const isPaid = row?.status === "pago";
    const isSuspended = Boolean(row?.suspensa) && !isPaid;
    const isPending = row?.status === "pendente_confirmacao";
    const isOverdue = Boolean(row?.data_vencimento && row.data_vencimento < today && !isPaid && !isSuspended && !isPending);
    return {
      number,
      row,
      target: number === targetNumber,
      state: isPaid ? "paid" : isSuspended ? "suspended" : isPending ? "pending" : isOverdue ? "overdue" : "open",
    } as const;
  }), [byNumber, currentPlan, targetNumber, today]);

  const adendos = useMemo(() => {
    const items: Adendo[] = [];
    if (cadastro?.ativo === false) items.push({ key: "inactive", tone: "paused", title: "Contrato suspenso / cadastro inativo", detail: "A previsão fica suspensa até a reativação do cadastro." });
    else if (allOpenSuspended) items.push({ key: "all-suspended", tone: "paused", title: "Parcelamento suspenso", detail: "Todas as parcelas ainda em aberto estão suspensas no financeiro." });
    if (suspended.length) items.push({ key: "suspended", tone: "paused", title: `${suspended.length} parcela(s) suspensa(s)`, detail: `${listParcelas(suspended)}.`, date: suspended.map((row) => row.suspensa_em).filter(Boolean).sort().at(-1) ?? null });
    if (overdue.length) items.push({ key: "overdue", tone: "danger", title: `${overdue.length} parcela(s) em atraso`, detail: `Inadimplência em ${listParcelas(overdue)}. A previsão permanece em risco até a regularização.`, date: overdue[0]?.data_vencimento ?? null });
    if (boletos.length === 0) items.push({ key: "no-installments", tone: "warning", title: "Sem parcelas registradas", detail: "O cadastro ainda não possui parcelas financeiras para acompanhar." });
    else if (paid.length === 0) items.push({ key: "unpaid", tone: "warning", title: "Nenhuma parcela paga", detail: "Ainda não existe parcela baixada como paga para esta cliente." });
    if (pendingConfirmation.length) items.push({ key: "pending", tone: "warning", title: `${pendingConfirmation.length} pagamento(s) aguardando confirmação`, detail: `${listParcelas(pendingConfirmation)} ainda não contam como pagas.` });

    const relevantHistory = (detail?.historico ?? []).filter((item) => ["alterou_quantidade_parcelas", "gerou_parcelas", "excluiu_parcela", "editou_parcela", "reabriu_parcela", "suspendeu_parcelas"].includes(item.acao));
    for (const item of relevantHistory) {
      const description = changeDetail(item);
      if (!description) continue;
      if (item.acao === "gerou_parcelas" && Number(item.detalhes?.total_anterior ?? 0) <= 0) continue;
      items.push({
        key: `${item.acao}-${item.id ?? item.created_at ?? items.length}`,
        tone: item.acao === "suspendeu_parcelas" ? "paused" : "neutral",
        title: item.acao === "editou_parcela" ? "Parcela alterada" : item.acao === "reabriu_parcela" ? "Parcela reaberta" : item.acao === "suspendeu_parcelas" ? "Suspensão registrada" : "Parcelamento alterado",
        detail: description,
        date: historyDate(item),
      });
      if (items.length >= 6) break;
    }
    return items;
  }, [allOpenSuspended, boletos.length, cadastro?.ativo, detail?.historico, overdue, paid.length, pendingConfirmation, suspended]);

  const observacoes = useMemo(() => (detail?.historico ?? [])
    .filter((item) => item.acao === "registrou_observacao")
    .map((item) => ({ id: item.id ?? item.created_at ?? "", texto: String(item.detalhes?.texto ?? ""), usuario: item.usuario, date: item.created_at }))
    .filter((item) => item.texto), [detail?.historico]);

  const status = contractSuspended
    ? { label: "Suspenso", detail: "fora da previsão ativa", className: "bg-slate-100 text-slate-700", icon: PauseCircle }
    : overdue.length
      ? { label: "Inadimplente", detail: `${overdue.length} parcela(s) vencida(s)`, className: "bg-red-50 text-red-700", icon: AlertTriangle }
      : targetPaid
        ? { label: "Elegível", detail: `marco da ${targetNumber ?? "—"}ª atingido`, className: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 }
        : { label: "Em andamento", detail: targetNumber ? `meta na ${targetNumber}ª parcela` : "sem regra de liberação", className: "bg-[#fff0f1] text-burgundy", icon: Clock3 };
  const StatusIcon = status.icon;

  return (
    <>
      <button type="button" className="fixed inset-0 z-[108] cursor-default bg-transparent" onClick={onClose} aria-label="Fechar perfil da cliente" />
      <aside className="fixed inset-y-0 right-0 z-[110] h-full w-full overflow-y-auto border-l border-white/70 bg-[#fffdfc] shadow-[-34px_0_90px_-38px_rgba(55,14,26,.52)] md:w-[94%] lg:w-[80%] xl:w-[66%] 2xl:w-[54%]">
        <header className="sticky top-0 z-20 border-b border-[#eee3e3] bg-[#fffdfc]/96 px-4 py-3 backdrop-blur-xl sm:px-5">
          <nav className="mb-2 flex items-center gap-1.5 text-xs text-clay/45">
            <button type="button" onClick={onClose} className="font-medium text-burgundy/70 hover:text-burgundy hover:underline">Previsões</button>
            <span>›</span>
            <span>Carteira {currentPlan || client.totalParcelas}x</span>
            <span>›</span>
            <span className="font-semibold text-clay">{client.nome}</span>
          </nav>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-rose/20 bg-gradient-to-br from-[#f8d8d4] to-[#f1b8bd] text-sm font-bold text-burgundy">{initials(client.nome)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold tracking-tight text-burgundy">{client.nome}</h2>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.className}`}><StatusIcon className="h-3 w-3" />{status.label}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-clay/50">Perfil da cliente · Previsão de Liberação — {status.detail}</p>
            </div>
            <button type="button" onClick={() => void load(true)} disabled={refreshing} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#eadedf] bg-white text-burgundy/70 transition hover:bg-[#fff4f3] disabled:opacity-50" title="Atualizar dados"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /></button>
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-burgundy/65 transition hover:bg-[#fff4f3]"><X className="h-4 w-4" /></button>
          </div>
        </header>

        <div className="space-y-4 p-4 sm:p-5">
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          {loading && !detail ? <div className="space-y-2"><div className="h-20 animate-pulse rounded-xl bg-white" /><div className="h-48 animate-pulse rounded-xl bg-white" /></div> : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <InfoChip label="Campanha" value={client.campanha || "Sem campanha"} />
                <InfoChip label="Vendedora" value={client.responsavel || "Sem vendedora"} />
                <InfoChip label="Valor da carta" value={money(valorCarta)} />
                <InfoChip label="Plano" value={currentPlan ? `${currentPlan}x` : "—"} />
              </div>

              <section className="rounded-xl border border-[#f0cfd1] bg-[#fff6f6] p-3.5">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-burgundy text-white"><WalletCards className="h-4 w-4" /></span>
                  <p className="text-sm leading-5 text-[#5c4650]">
                    {currentRule ? <><strong className="text-burgundy">Plano {currentPlan}x · {currentRule.percentual}% pago = {targetNumber}ª parcela.</strong> Como a cliente paga 1 parcela por mês, a previsão de liberação é no vencimento da {targetNumber}ª parcela{targetDue ? `: ${dateLabel(targetDue)}` : "."}.</> : <>O plano atual de {currentPlan || "—"} parcelas não possui regra de liberação cadastrada.</>}
                    {targetSuspended ? " A parcela-alvo está suspensa no financeiro." : null}
                  </p>
                </div>
              </section>

              <div className="grid gap-3 xl:grid-cols-2">
                <section className="rounded-xl border border-[#eadedf] bg-white p-3.5 shadow-[0_12px_30px_-28px_rgba(75,25,39,.42)]">
                  <h3 className="text-sm font-semibold text-burgundy">Resumo da previsão</h3>
                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3">
                    <StatItem label="Parcela ativa" value={targetNumber ? `${targetNumber}ª` : "—"} />
                    <StatItem label="Parcelas pagas" value={`${paid.length}/${currentPlan || boletos.length || 0}`} />
                    <StatItem label="Próximo marco" value={targetNumber ? `${targetNumber}ª parcela` : "—"} />
                    <StatItem label="Vencimento" value={targetSuspended ? "Suspensa" : dateLabel(targetDue)} />
                    <StatItem label="Valor da carta" value={money(valorCarta)} />
                    <StatItem label="Confiança" value={confidenceLabel(client.confianca)} />
                  </div>
                </section>

                <section className="rounded-xl border border-[#eadedf] bg-white p-3.5 shadow-[0_12px_30px_-28px_rgba(75,25,39,.42)]">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-burgundy"><UserRound className="h-4 w-4" />Dados da venda / CRM</h3>
                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3">
                    <StatItem label="Campanha" value={client.campanha || "Sem campanha"} />
                    <StatItem label="Vendedora" value={client.responsavel || "—"} />
                    <StatItem label="Data da venda" value={dateLabel(client.dataVenda)} />
                    <StatItem label="Origem" value={client.origem || "—"} />
                    <StatItem label="Contrato" value={client.codigoContrato || "Sem código"} />
                    <StatItem label="Status comercial" value={statusLabel(cadastro?.status_financeiro) || status.label} />
                  </div>
                </section>
              </div>

              <section className="rounded-xl border border-[#eadedf] bg-white p-3.5 shadow-[0_12px_30px_-28px_rgba(75,25,39,.42)] sm:p-4">
                <h3 className="text-sm font-semibold text-burgundy">Cronograma de parcelas</h3>
                <p className="mt-0.5 text-xs text-clay/45">Situação real do financeiro, parcela por parcela.</p>

                <div className="mt-4 overflow-x-auto pb-2">
                  <div className="relative flex min-w-max gap-0 px-2">
                    <div className="pointer-events-none absolute left-6 right-6 top-4 h-0.5 bg-[#eee0df]" />
                    {timeline.map((item) => {
                      const circleClass = item.state === "paid"
                        ? "border-emerald-400 bg-emerald-500 text-white"
                        : item.state === "overdue"
                          ? "border-red-300 bg-red-50 text-red-700"
                          : item.state === "suspended"
                            ? "border-slate-300 bg-slate-100 text-slate-500"
                            : item.state === "pending"
                              ? "border-amber-300 bg-amber-50 text-amber-700"
                              : "border-[#e2e4e8] bg-white text-clay/60";
                      const ringClass = item.target ? "ring-2 ring-burgundy ring-offset-2 ring-offset-[#fffdfc]" : "";
                      return (
                        <div key={item.number} className="relative z-10 flex w-14 shrink-0 flex-col items-center gap-1">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-[11px] font-bold ${circleClass} ${ringClass}`} title={`${item.number}ª parcela · ${item.state}`}>
                            {item.state === "paid" ? <Check className="h-3.5 w-3.5" /> : item.number}
                          </span>
                          {item.target ? <span className="rounded-full bg-burgundy px-1.5 py-0.5 text-[8px] font-bold tracking-wide text-white">ALVO</span> : <span className="text-[10px] font-medium text-clay/50">{shortDate(item.row?.data_vencimento)}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-[#f1e9e8] pt-2.5 text-[11px] text-clay/48">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" />Paga</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" />Atrasada</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" />Suspensa</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />Confirmação</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-burgundy"><span className="h-2 w-2 rounded-full bg-burgundy" />Marco da liberação</span>
                </div>
              </section>

              <section className="rounded-xl border border-[#eadedf] bg-[#fbf8f7] p-3.5">
                <h3 className="text-sm font-semibold text-burgundy">Motivo de entrada na carteira</h3>
                <p className="mt-1 text-sm leading-5 text-clay/60">
                  {targetMonthLabel && currentRule
                    ? `Esta cliente aparece na carteira ${currentPlan}x de ${targetMonthLabel} porque a ${targetNumber}ª parcela vence em ${dateLabel(targetDue)}, atingindo os ${currentRule.percentual}% pagos exigidos pela regra do plano.`
                    : "Ainda não há vencimento suficiente para calcular em qual carteira mensal esta cliente entra."}
                </p>
              </section>

              <section className="rounded-xl border border-[#eadedf] bg-white p-3.5 shadow-[0_12px_30px_-28px_rgba(75,25,39,.4)]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-burgundy"><FileClock className="h-4 w-4" />Adendos do cadastro</h3>
                    <p className="mt-0.5 text-xs text-clay/42">Mudanças e exceções que alteram a leitura da previsão.</p>
                  </div>
                  <span className="rounded-full bg-[#f8f4f3] px-2 py-1 text-[10px] font-medium text-clay/45">{adendos.length} registro{adendos.length === 1 ? "" : "s"}</span>
                </div>
                <div className="mt-2.5 grid gap-1.5 xl:grid-cols-2">
                  {adendos.length ? adendos.map((item) => (
                    <div key={item.key} className={`rounded-lg border px-2.5 py-2 ${toneClasses(item.tone)}`}>
                      <div className="flex items-start gap-2">
                        {item.tone === "danger" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : item.tone === "paused" ? <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : item.tone === "warning" ? <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : item.tone === "success" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">{item.title}</p>{item.date ? <span className="shrink-0 text-[10px] opacity-55">{dateLabel(item.date)}</span> : null}</div>
                          <p className="mt-0.5 text-xs leading-4 opacity-85">{item.detail}</p>
                        </div>
                      </div>
                    </div>
                  )) : <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-700"><span className="inline-flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-3.5 w-3.5" />Sem adendos financeiros no momento.</span></div>}
                </div>
              </section>

              <section className="rounded-xl border border-[#eadedf] bg-white p-3.5 shadow-[0_12px_30px_-28px_rgba(75,25,39,.4)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-burgundy"><MessageSquarePlus className="h-4 w-4" />Ações e observações</h3>
                  <div className="flex flex-wrap gap-2">
                    <a href={`/admin/financeiro?cliente_id=${client.clienteId}`} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-burgundy px-3 text-xs font-semibold text-white hover:bg-burgundy-dark"><BarChart3 className="h-3.5 w-3.5" />Ver financeiro</a>
                    <a href={`/admin/clientes?cliente_id=${client.clienteId}`} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-burgundy/25 bg-white px-3 text-xs font-semibold text-burgundy hover:bg-[#fff6f6]"><UserRound className="h-3.5 w-3.5" />Abrir cadastro</a>
                    <button type="button" onClick={() => setShowObservacaoForm((value) => !value)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-burgundy/25 bg-white px-3 text-xs font-semibold text-burgundy hover:bg-[#fff6f6]"><MessageSquarePlus className="h-3.5 w-3.5" />Registrar observação</button>
                  </div>
                </div>

                {showObservacaoForm ? (
                  <div className="mt-3 rounded-lg border border-[#eadedf] bg-[#fffdfc] p-3">
                    <textarea
                      value={observacaoText}
                      onChange={(event) => setObservacaoText(event.target.value)}
                      placeholder="Escreva uma observação sobre esta cliente..."
                      rows={3}
                      className="w-full resize-none rounded-lg border border-[#eadedf] bg-white p-2.5 text-sm outline-none focus:border-burgundy/40"
                    />
                    {observacaoError ? <p className="mt-1.5 text-xs text-red-600">{observacaoError}</p> : null}
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => { setShowObservacaoForm(false); setObservacaoText(""); setObservacaoError(""); }} className="h-8 px-3 text-xs font-medium text-clay/55 hover:text-clay">Cancelar</button>
                      <button type="button" onClick={() => void submitObservacao()} disabled={savingObservacao} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-burgundy px-3 text-xs font-semibold text-white disabled:opacity-60"><Send className="h-3.5 w-3.5" />{savingObservacao ? "Salvando..." : "Salvar observação"}</button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 space-y-2">
                  {observacoes.length ? observacoes.map((item) => (
                    <div key={item.id} className="rounded-lg border border-[#eadedf] bg-[#fffdfc] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-clay/65">{usuarioLabel(item.usuario)}</p>
                        <span className="shrink-0 text-[10px] text-clay/40">{dateLabel(item.date)}</span>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-clay">{item.texto}</p>
                    </div>
                  )) : <p className="text-xs text-clay/42">Nenhuma observação registrada para esta cliente ainda.</p>}
                </div>

                <p className="mt-3 border-t border-[#eee5e4] pt-2.5 text-[11px] text-clay/42">As informações acima são atualizadas diretamente do cadastro financeiro da cliente.</p>
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
