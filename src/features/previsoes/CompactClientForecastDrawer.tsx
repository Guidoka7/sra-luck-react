"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileClock,
  PauseCircle,
  RefreshCw,
  RotateCcw,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { formatarMoeda } from "@/lib/utils";

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

function money(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? formatarMoeda(number) : "—";
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
  return item.created_at ? dateLabel(item.created_at) : null;
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
  if (tone === "danger") return "border-red-200 bg-red-50 text-red-800";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "paused") return "border-slate-300 bg-slate-50 text-slate-700";
  return "border-[#eadedf] bg-white text-[#5d4b51]";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CL";
}

export function CompactClientForecastDrawer({ client, rules, onClose }: { client: ClienteSnapshot; rules: RegraForecast[]; onClose: () => void }) {
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const [parcelasResponse, clientesResponse] = await Promise.all([
        fetch(`/api/admin/clientes/${encodeURIComponent(client.clienteId)}/parcelas`, { cache: "no-store" }),
        fetch("/api/admin/clientes", { cache: "no-store" }),
      ]);
      const parcelasJson = await parcelasResponse.json();
      const clientesJson = await clientesResponse.json();
      if (!parcelasResponse.ok) throw new Error(parcelasJson?.erro ?? "Não foi possível atualizar as parcelas da cliente.");
      if (!clientesResponse.ok) throw new Error(clientesJson?.erro ?? "Não foi possível atualizar o cadastro da cliente.");
      const cadastro = Array.isArray(clientesJson?.clientes)
        ? clientesJson.clientes.find((item: CadastroLive) => String(item.id) === String(client.clienteId)) ?? null
        : null;
      setDetail({
        boletos: Array.isArray(parcelasJson?.boletos) ? parcelasJson.boletos : Array.isArray(parcelasJson?.parcelas) ? parcelasJson.parcelas : [],
        historico: Array.isArray(parcelasJson?.historico) ? parcelasJson.historico : [],
        cadastro,
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
  const overdue = boletos.filter((row) => !row.suspensa && row.status !== "pago" && Boolean(row.data_vencimento && row.data_vencimento < today));
  const pendingConfirmation = boletos.filter((row) => row.status === "pendente_confirmacao");
  const openNotSuspended = boletos.filter((row) => row.status !== "pago" && !row.suspensa);
  const allOpenSuspended = openNotSuspended.length === 0 && suspended.length > 0;
  const contractSuspended = cadastro?.ativo === false || allOpenSuspended;
  const targetInstallment = targetNumber ? byNumber.get(targetNumber) : undefined;
  const targetPaid = targetInstallment?.status === "pago" || (targetNumber != null && paid.length >= targetNumber);
  const targetSuspended = Boolean(targetInstallment?.suspensa);
  const targetDue = targetInstallment?.data_vencimento ?? (currentPlan === client.totalParcelas ? client.previsao : null);
  const valorCarta = cadastro?.valor_contrato ?? client.valorCarta ?? null;

  const timeline = useMemo(() => Array.from({ length: Math.max(currentPlan, 0) }, (_, index) => {
    const number = index + 1;
    const row = byNumber.get(number);
    const isPaid = row?.status === "pago";
    const isSuspended = Boolean(row?.suspensa) && !isPaid;
    const isOverdue = Boolean(row?.data_vencimento && row.data_vencimento < today && !isPaid && !isSuspended);
    const isPending = row?.status === "pendente_confirmacao";
    return {
      number,
      row,
      target: number === targetNumber,
      state: isPaid ? "paid" : isSuspended ? "suspended" : isOverdue ? "overdue" : isPending ? "pending" : "open",
    } as const;
  }), [byNumber, currentPlan, targetNumber, today]);

  const adendos = useMemo(() => {
    const items: Adendo[] = [];
    if (cadastro?.ativo === false) {
      items.push({ key: "inactive", tone: "paused", title: "Contrato suspenso / cadastro inativo", detail: "O cadastro da cliente está inativo. A previsão deve ser tratada como suspensa até a reativação." });
    } else if (allOpenSuspended) {
      items.push({ key: "all-suspended", tone: "paused", title: "Parcelamento suspenso", detail: "Todas as parcelas ainda em aberto estão suspensas no financeiro." });
    }
    if (suspended.length) {
      items.push({ key: "suspended", tone: "paused", title: `${suspended.length} parcela(s) suspensa(s)`, detail: `${listParcelas(suspended)}. Parcelas suspensas não devem ser tratadas como cobrança ativa enquanto permanecerem suspensas.`, date: suspended.map((row) => row.suspensa_em).filter(Boolean).sort().at(-1) ?? null });
    }
    if (overdue.length) {
      items.push({ key: "overdue", tone: "danger", title: `${overdue.length} parcela(s) em atraso`, detail: `Inadimplência registrada em ${listParcelas(overdue)}. A previsão deve refletir esse risco até a regularização.`, date: overdue[0]?.data_vencimento ?? null });
    }
    if (boletos.length > 0 && paid.length === 0) {
      items.push({ key: "unpaid", tone: "warning", title: "Nenhuma parcela paga", detail: "Ainda não existe parcela baixada como paga para esta cliente." });
    }
    if (pendingConfirmation.length) {
      items.push({ key: "pending", tone: "warning", title: `${pendingConfirmation.length} pagamento(s) aguardando confirmação`, detail: `${listParcelas(pendingConfirmation)} ainda não contam como parcela paga até a confirmação financeira.` });
    }

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

  const status = contractSuspended
    ? { label: "Suspenso", detail: "fora da previsão ativa", className: "bg-slate-100 text-slate-700", icon: PauseCircle }
    : overdue.length
      ? { label: "Inadimplente", detail: `${overdue.length} parcela(s) vencida(s)`, className: "bg-red-50 text-red-700", icon: AlertTriangle }
      : targetPaid
        ? { label: "Elegível", detail: `marco da ${targetNumber ?? "—"}ª atingido`, className: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 }
        : { label: "Em andamento", detail: targetNumber ? `meta na ${targetNumber}ª parcela` : "sem regra de liberação", className: "bg-[#fff0f1] text-burgundy", icon: Clock3 };
  const StatusIcon = status.icon;

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-[#1b1518]/42 backdrop-blur-[1px]" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Fechar detalhes da cliente" />
      <aside className="relative z-10 h-full w-full overflow-y-auto border-l border-[#eadedf] bg-[#fffdfc] shadow-[-28px_0_72px_-36px_rgba(55,14,26,.5)] sm:w-[520px] xl:w-[540px]">
        <header className="sticky top-0 z-20 border-b border-[#eee3e3] bg-[#fffdfc]/96 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rose/20 bg-gradient-to-br from-[#f8d8d4] to-[#f1b8bd] text-[11px] font-bold text-burgundy">{initials(client.nome)}</span>
            <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-semibold text-burgundy">{client.nome}</p><p className="truncate text-[9px] text-clay/50">{client.campanha || "Sem campanha"} · {client.responsavel || "Sem vendedora"}</p></div>
            <button type="button" onClick={() => void load(true)} disabled={refreshing} className="rounded-lg border border-[#eadedf] p-2 text-burgundy/70 hover:bg-blush disabled:opacity-50" title="Atualizar dados"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /></button>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-burgundy/70 hover:bg-blush"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-semibold ${status.className}`}><StatusIcon className="h-3.5 w-3.5" />{status.label}<span className="font-normal opacity-75">· {status.detail}</span></span><span className="text-[8px] text-clay/40">{updatedAt ? `Atualizado ${updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Atualizando..."}</span></div>
        </header>

        <div className="space-y-3 p-4">
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[9px] text-red-700">{error}</div> : null}
          {loading && !detail ? <div className="space-y-2"><div className="h-20 animate-pulse rounded-xl bg-white" /><div className="h-48 animate-pulse rounded-xl bg-white" /></div> : (
            <>
              <section className="grid grid-cols-3 overflow-hidden rounded-xl border border-[#eadedf] bg-white">
                <div className="border-r border-[#eee5e4] px-3 py-2.5"><p className="text-[7px] uppercase tracking-[.12em] text-clay/45">Valor da carta</p><p className="mt-1 truncate text-[12px] font-semibold text-burgundy">{money(valorCarta)}</p></div>
                <div className="border-r border-[#eee5e4] px-3 py-2.5"><p className="text-[7px] uppercase tracking-[.12em] text-clay/45">Plano atual</p><p className="mt-1 text-[12px] font-semibold text-burgundy">{currentPlan ? `${currentPlan}x` : "—"}</p></div>
                <div className="px-3 py-2.5"><p className="text-[7px] uppercase tracking-[.12em] text-clay/45">Pagas</p><p className="mt-1 text-[12px] font-semibold text-burgundy">{paid.length}/{currentPlan || boletos.length || 0}</p></div>
              </section>

              <section className="rounded-xl border border-[#eadedf] bg-white p-3">
                <div className="flex items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-[11px] font-semibold text-burgundy"><CalendarDays className="h-4 w-4" />Parcelas da cliente</h3><p className="mt-0.5 text-[8px] text-clay/45">Estado atual do financeiro. A parcela-alvo fica destacada.</p></div>{currentRule ? <span className="rounded-lg bg-[#fff0f1] px-2 py-1 text-right text-[8px] font-semibold text-burgundy">{currentPlan}x · {currentRule.percentual}%<br /><strong>{targetNumber}ª é o marco</strong></span> : <span className="rounded-lg bg-slate-50 px-2 py-1 text-[8px] text-slate-500">Sem regra</span>}</div>

                <div className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-12">
                  {timeline.map((item) => {
                    const stateClass = item.state === "paid"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : item.state === "overdue"
                        ? "border-red-300 bg-red-50 text-red-700"
                        : item.state === "suspended"
                          ? "border-slate-300 bg-slate-100 text-slate-500"
                          : item.state === "pending"
                            ? "border-amber-300 bg-amber-50 text-amber-700"
                            : "border-[#e1e3e8] bg-[#fafbfc] text-[#7c8798]";
                    const targetClass = item.target ? "ring-2 ring-burgundy ring-offset-1 ring-offset-white shadow-[0_6px_18px_-10px_rgba(100,25,43,.8)]" : "";
                    return <div key={item.number} className={`relative min-w-0 rounded-lg border px-1 py-1.5 text-center ${stateClass} ${targetClass}`} title={`${item.number}ª parcela · ${item.state}`}>
                      {item.target ? <span className="absolute -right-1 -top-1 rounded-full bg-burgundy px-1 text-[6px] font-bold text-white">ALVO</span> : null}
                      <p className="text-[9px] font-bold">{item.number}</p>
                      <div className="mt-1 flex h-3 items-center justify-center">{item.state === "paid" ? <Check className="h-3 w-3" /> : item.state === "overdue" ? <CircleAlert className="h-3 w-3" /> : item.state === "suspended" ? <PauseCircle className="h-3 w-3" /> : item.state === "pending" ? <Clock3 className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current opacity-35" />}</div>
                      <p className="mt-1 truncate text-[6.5px] font-medium">{shortDate(item.row?.data_vencimento)}</p>
                    </div>;
                  })}
                </div>

                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[7px] text-clay/50"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" />Paga</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" />Atrasada</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" />Suspensa</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />Confirmação</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-burgundy" />Marco da liberação</span></div>
              </section>

              <section className="rounded-xl border border-[#f0cfd1] bg-[#fff6f6] p-3">
                <div className="flex items-start gap-2"><WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-burgundy" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h3 className="text-[10px] font-semibold text-burgundy">Previsão recalculada pelo plano atual</h3><span className="text-[8px] font-semibold text-burgundy">{targetNumber ? `${targetNumber}ª parcela` : "Sem marco"}</span></div><p className="mt-1 text-[8px] leading-4 text-[#675158]">{currentRule ? `No plano ${currentPlan}x, o marco é ${currentRule.percentual}% (${targetNumber}ª parcela).` : `O plano atual de ${currentPlan || "—"} parcelas não possui regra de liberação cadastrada.`} {targetSuspended ? "A parcela-alvo está suspensa." : targetDue ? `Vencimento atual da parcela-alvo: ${dateLabel(targetDue)}.` : "Ainda não há vencimento atual para a parcela-alvo."}</p></div></div>
              </section>

              <section className="rounded-xl border border-[#eadedf] bg-white p-3">
                <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-[11px] font-semibold text-burgundy"><FileClock className="h-4 w-4" />Adendos do cadastro</h3><span className="text-[7px] text-clay/40">gerados pelos dados atuais</span></div>
                <div className="mt-2 space-y-1.5">
                  {adendos.length ? adendos.map((item) => <div key={item.key} className={`rounded-lg border px-2.5 py-2 ${toneClasses(item.tone)}`}><div className="flex items-start gap-2">{item.tone === "danger" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : item.tone === "paused" ? <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : item.tone === "warning" ? <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : item.tone === "success" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />}<div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="text-[8px] font-semibold">{item.title}</p>{item.date ? <span className="shrink-0 text-[7px] opacity-60">{dateLabel(item.date)}</span> : null}</div><p className="mt-0.5 text-[7.5px] leading-4 opacity-85">{item.detail}</p></div></div></div>) : <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[8px] text-emerald-700"><span className="inline-flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-3.5 w-3.5" />Sem adendos financeiros no momento.</span></div>}
                </div>
              </section>

              <section className="grid grid-cols-2 gap-2 rounded-xl border border-[#eadedf] bg-white p-3 text-[8px]">
                <div><p className="text-clay/45">Vencimento do marco</p><p className="mt-0.5 font-semibold text-burgundy">{targetSuspended ? "Suspenso" : dateLabel(targetDue)}</p></div><div><p className="text-clay/45">Status financeiro</p><p className="mt-0.5 font-semibold text-burgundy">{cadastro?.status_financeiro || status.label}</p></div><div><p className="text-clay/45">Contrato</p><p className="mt-0.5 truncate font-semibold text-burgundy">{client.codigoContrato || "Sem código vinculado"}</p></div><div><p className="text-clay/45">Parcelas vencidas</p><p className="mt-0.5 font-semibold text-burgundy">{overdue.length}</p></div>
              </section>

              <div className="grid grid-cols-2 gap-2 pb-2"><a href={`/admin/financeiro?cliente_id=${client.clienteId}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-burgundy text-[8px] font-semibold text-white"><BarChart3 className="h-3.5 w-3.5" />Ver financeiro</a><a href={`/admin/clientes?cliente_id=${client.clienteId}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-burgundy/25 bg-white text-[8px] font-semibold text-burgundy"><UserRound className="h-3.5 w-3.5" />Abrir cadastro</a></div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
