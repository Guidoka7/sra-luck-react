"use client";

import {
  CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, FileText,
  Grid2X2, Landmark, List, MoreHorizontal, Plus, ReceiptText, RefreshCw, Search, SlidersHorizontal,
  Users, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ClienteDetailDrawer } from "@/components/admin/clientes/ClienteDetailDrawer";
import type { DrawerInstallment } from "@/components/admin/clientes/clienteDrawerModel";
import { financeiroApi } from "@/features/financeiro/financeiroApi";
import type { FinancePanelData, FinancePanelRow, FinancePanelStatus, FinancePanelTab } from "@/features/financeiro/types";
import type { Cliente } from "@/types/database";
import styles from "./FinanceiroPage.module.css";

const TAB_META: Array<{ id: FinancePanelTab; label: string; icon: typeof ReceiptText }> = [
  { id: "proofs", label: "Comprovantes", icon: ReceiptText },
  { id: "received", label: "Recebidos", icon: Check },
  { id: "late", label: "Atrasados", icon: Clock3 },
  { id: "all", label: "Todas", icon: Users },
];

const STATUS_OPTIONS: Array<FinancePanelStatus> = [
  "Aguardando análise",
  "Comprovante confirmado",
  "Recebido",
  "Atrasado",
  "Recusado",
  "Suspensa",
  "Pendente",
];

const TAB_LABEL: Record<FinancePanelTab, string> = {
  proofs: "Comprovantes",
  received: "Recebidos",
  late: "Atrasados",
  all: "Todas",
};

const ITEM_LABEL: Record<FinancePanelTab, [string, string]> = {
  proofs: ["comprovante", "comprovantes"],
  received: ["recebimento", "recebimentos"],
  late: ["parcela", "parcelas"],
  all: ["cliente", "clientes"],
};

type SortValue = "dateAsc" | "dateDesc" | "valueDesc" | "valueAsc" | "nameAsc" | "nameDesc";
type PeriodValue = "all" | "today" | "7" | "30" | "past";
type ViewMode = "list" | "grid";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function localIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function parseIso(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const parts = value.slice(0, 10).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function shiftDay(iso: string, amount: number) {
  const date = parseIso(iso) ?? new Date();
  date.setDate(date.getDate() + amount);
  return localIso(date);
}

function dateBr(value: string | null | undefined) {
  const date = parseIso(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function dateLong(value: string) {
  const date = parseIso(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" }).format(date);
}

function monthLong(date: Date) {
  const value = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "SL";
}

function cpfLabel(cpf: string | null) {
  const digits = String(cpf ?? "").replace(/\D/g, "");
  if (digits.length !== 11) return cpf || "CPF não informado";
  return digits.slice(0, 3) + "." + digits.slice(3, 6) + "." + digits.slice(6, 9) + "-" + digits.slice(9);
}

function statusClass(status: FinancePanelStatus) {
  if (status === "Aguardando análise") return styles.statusProof;
  if (status === "Comprovante confirmado" || status === "Recebido") return styles.statusReceived;
  if (status === "Atrasado") return styles.statusLate;
  if (status === "Recusado") return styles.statusRejected;
  if (status === "Suspensa") return styles.statusSuspended;
  return styles.statusPending;
}

function firstOfMonth(iso: string) {
  const date = parseIso(iso) ?? new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export default function FinanceiroPage() {
  const [data, setData] = useState<FinancePanelData | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<FinancePanelTab>("proofs");
  const [selectedProofDate, setSelectedProofDate] = useState(localIso());
  const [proofDatesOpen, setProofDatesOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(firstOfMonth(localIso()));
  const [search, setSearch] = useState("");
  const [bank, setBank] = useState("all");
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState<PeriodValue>("all");
  const [sort, setSort] = useState<SortValue>("dateAsc");
  const [view, setView] = useState<ViewMode>("list");
  const [selectedProof, setSelectedProof] = useState<FinancePanelRow | null>(null);
  const [selectedClient, setSelectedClient] = useState<Cliente | null>(null);
  const [drawerTab, setDrawerTab] = useState<"profile" | "finance">("finance");
  const [drawerFocus, setDrawerFocus] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ row: FinancePanelRow; left: number; top: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const proofDatesRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  const notify = useCallback((message: string) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2800);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [panel, rawClientes] = await Promise.all([financeiroApi.painel(), financeiroApi.clientes()]);
      const clientList = rawClientes as unknown as Cliente[];
      setData(panel);
      setClientes(clientList);
      setSelectedClient((current) => current ? clientList.find((item) => item.id === current.id) ?? current : null);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar o Financeiro.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (proofDatesOpen && !proofDatesRef.current?.contains(target)) setProofDatesOpen(false);
      if (calendarOpen && !calendarRef.current?.contains(target)) setCalendarOpen(false);
      if (menu && !target.closest("[data-finance-action-menu]")) setMenu(null);
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menu) { setMenu(null); return; }
      if (calendarOpen) { setCalendarOpen(false); return; }
      if (proofDatesOpen) setProofDatesOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [proofDatesOpen, calendarOpen, menu]);

  const sourceRows = useMemo(() => {
    if (!data) return [] as FinancePanelRow[];
    return data[tab];
  }, [data, tab]);

  const dateCount = useMemo(() => {
    return data?.proofDates.find((item) => item.date === selectedProofDate)?.count ?? 0;
  }, [data, selectedProofDate]);

  const visibleRows = useMemo(() => {
    let rows = [...sourceRows];
    if (tab === "proofs") rows = rows.filter((row) => String(row.uploadedAt ?? "").slice(0, 10) === selectedProofDate);
    const query = search.trim().toLocaleLowerCase("pt-BR");
    const now = parseIso(localIso())!;
    const end7 = new Date(now); end7.setDate(end7.getDate() + 7);
    const end30 = new Date(now); end30.setDate(end30.getDate() + 30);

    rows = rows.filter((row) => {
      if (query) {
        const haystack = [row.name, row.cpf ?? "", row.installmentNumber + "/" + row.installmentTotal, row.bank ?? "", row.contractCode]
          .join(" ").toLocaleLowerCase("pt-BR");
        if (!haystack.includes(query)) return false;
      }
      if (bank !== "all" && row.bank !== bank) return false;
      if (status !== "all" && row.status !== status) return false;
      if (period !== "all") {
        const due = parseIso(row.dueDate);
        if (!due) return false;
        if (period === "today" && due.getTime() !== now.getTime()) return false;
        if (period === "7" && !(due >= now && due <= end7)) return false;
        if (period === "30" && !(due >= now && due <= end30)) return false;
        if (period === "past" && !(due < now)) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      if (sort === "valueDesc") return b.amount - a.amount;
      if (sort === "valueAsc") return a.amount - b.amount;
      if (sort === "nameAsc") return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
      if (sort === "nameDesc") return b.name.localeCompare(a.name, "pt-BR", { sensitivity: "base" });
      const ad = a.dueDate ?? "9999-12-31";
      const bd = b.dueDate ?? "9999-12-31";
      return sort === "dateDesc" ? bd.localeCompare(ad) : ad.localeCompare(bd);
    });
    return rows;
  }, [sourceRows, tab, selectedProofDate, search, bank, status, period, sort]);

  const filtersActive = Boolean(search.trim()) || bank !== "all" || status !== "all" || period !== "all";
  const recordCount = tab === "proofs" ? dateCount : data?.counts[tab] ?? 0;
  const itemLabel = ITEM_LABEL[tab];

  function clearFilters() {
    setSearch("");
    setBank("all");
    setStatus("all");
    setPeriod("all");
  }

  function selectTab(next: FinancePanelTab) {
    if (next === "proofs" && tab === "proofs") {
      setProofDatesOpen((value) => !value);
      setCalendarOpen(false);
      return;
    }
    setTab(next);
    setProofDatesOpen(false);
    setCalendarOpen(false);
    setMenu(null);
  }

  function chooseProofDate(date: string) {
    setSelectedProofDate(date);
    setCalendarMonth(firstOfMonth(date));
    setProofDatesOpen(false);
    setCalendarOpen(false);
    setTab("proofs");
  }

  function changeProofDay(delta: number) {
    const next = shiftDay(selectedProofDate, delta);
    if (next > localIso()) return;
    chooseProofDate(next);
  }

  function findClient(row: FinancePanelRow) {
    return clientes.find((item) => item.id === row.clientId) ?? null;
  }

  function openClient(row: FinancePanelRow, initial: "profile" | "finance", focus: string | null = null) {
    const cliente = findClient(row);
    if (!cliente) {
      notify("Não foi possível abrir o perfil completo desta cliente agora.");
      return;
    }
    setSelectedClient(cliente);
    setDrawerTab(initial);
    setDrawerFocus(focus);
    setMenu(null);
  }

  function openProof(row: FinancePanelRow) {
    if (!row.proof) {
      notify("Este registro não possui comprovante disponível.");
      return;
    }
    setSelectedProof(row);
    setMenu(null);
  }

  function openRow(row: FinancePanelRow) {
    if (tab === "proofs") openProof(row);
    else openClient(row, "finance", tab === "late" ? row.installmentId : null);
  }

  function rowKey(event: KeyboardEvent<HTMLElement>, row: FinancePanelRow) {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    openRow(row);
  }

  function openActionMenu(event: MouseEvent<HTMLButtonElement>, row: FinancePanelRow) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 205;
    const estimatedHeight = row.proof ? 138 : 104;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const top = rect.bottom + estimatedHeight + 6 > window.innerHeight ? Math.max(8, rect.top - estimatedHeight - 6) : rect.bottom + 6;
    setMenu({ row, left, top });
  }

  function openProofFromDrawer(item: DrawerInstallment) {
    const row = data?.proofs.find((entry) => entry.installmentId === item.id)
      ?? data?.received.find((entry) => entry.installmentId === item.id)
      ?? null;
    if (!row?.proof) {
      notify("Não foi possível localizar o comprovante desta parcela.");
      return;
    }
    setSelectedProof(row);
  }

  async function onProofResolved() {
    await load(true);
  }

  return (
    <div className={styles.page}>
      <section className={styles.pageHeading}>
        <div className={styles.headingLeft}>
          <div className={styles.eyebrow}>Financeiro</div>
          <div className={styles.titleRow}><h1>Financeiro</h1><span className={styles.titleLine}/></div>
          <div className={styles.subtitle}>Gerencie lançamentos, parcelas e recebimentos das clientes.</div>
        </div>
        <div className={styles.headingRight}>
          <div className={styles.headingButtons}>
            <button className={styles.primaryBtn} type="button" onClick={() => notify("Selecione uma cliente ou parcela para registrar o lançamento.")}><Plus size={15}/>Novo lançamento</button>
            <button className={styles.moreBtn} type="button" aria-label="Mais opções" onClick={() => notify("As operações financeiras estão disponíveis nas linhas e drawers.")}>•••</button>
          </div>
        </div>
      </section>

      <div className={styles.tabsWrap} ref={proofDatesRef}>
        <section className={styles.tabs} aria-label="Categorias financeiras">
          {TAB_META.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            const total = data?.counts[item.id] ?? 0;
            return <button key={item.id} className={cx(styles.tab, active && styles.activeTab)} type="button" aria-selected={active} aria-expanded={item.id === "proofs" ? proofDatesOpen : undefined} onClick={() => selectTab(item.id)}>
              <span className={styles.tabIcon}><Icon size={19} strokeWidth={1.7}/></span>
              <span>{item.label}</span>
              <span className={styles.countPill}>{total}</span>
            </button>;
          })}
        </section>
        {proofDatesOpen ? <div className={styles.proofDatesPopover} role="dialog" aria-label="Datas com comprovantes aguardando análise">
          <div className={styles.proofDatesHead}>
            <div className={styles.proofDatesTitle}>Comprovantes para analisar</div>
            <div className={styles.proofDatesSub}>{data?.counts.proofs ?? 0} comprovantes aguardando análise</div>
          </div>
          <div className={styles.proofDatesList}>
            {data?.proofDates.length ? data.proofDates.map((item) => <button key={item.date} className={cx(styles.proofDateOption, item.date === selectedProofDate && styles.proofDateOptionActive)} type="button" onClick={() => chooseProofDate(item.date)}>
              <span className={styles.proofDateOptionCopy}><span className={styles.proofDateOptionDate}>{dateLong(item.date)}</span><span className={styles.proofDateOptionHelp}>aguardando análise</span></span>
              <span className={styles.proofDateOptionCount}>{item.count}</span>
            </button>) : <div className={styles.popoverEmpty}>Nenhuma pendência.</div>}
          </div>
        </div> : null}
      </div>

      {tab === "proofs" ? <section className={styles.proofDateNav} aria-label="Filtrar comprovantes pela data de envio">
        <div className={styles.proofDateCopy}>
          <CalendarDays size={18} strokeWidth={1.7}/>
          <div><div className={styles.proofDateKicker}>Data do envio</div><div className={styles.proofDateHelp}>Comprovantes anexados pelas clientes neste dia</div></div>
        </div>
        <div className={styles.datePager} ref={calendarRef}>
          <button className={styles.dateStep} type="button" aria-label="Dia anterior" onClick={() => changeProofDay(-1)}><ChevronLeft size={17}/></button>
          <button className={styles.dateCurrent} type="button" aria-expanded={calendarOpen} onClick={() => { setCalendarOpen((value) => !value); setProofDatesOpen(false); }}>
            <CalendarDays size={15}/><span>{dateLong(selectedProofDate)}</span><ChevronDown size={14} className={styles.dateChevron}/>
          </button>
          <button className={styles.dateStep} type="button" aria-label="Próximo dia" disabled={selectedProofDate >= localIso()} onClick={() => changeProofDay(1)}><ChevronRight size={17}/></button>
          {calendarOpen ? <MiniCalendar month={calendarMonth} selected={selectedProofDate} marked={new Set(data?.proofDates.map((item) => item.date) ?? [])} onMonth={setCalendarMonth} onSelect={chooseProofDate}/> : null}
        </div>
      </section> : null}

      <section className={styles.filters} aria-label="Filtros financeiros">
        <label className={cx(styles.control, styles.search)}><Search size={18}/><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" autoComplete="off" placeholder="Buscar por cliente, CPF, parcela ou contrato..."/></label>
        <label className={cx(styles.control, styles.selectWrap)}><Landmark size={15} className={styles.leadIcon}/><select value={bank} onChange={(event) => setBank(event.target.value)} aria-label="Filtrar por banco"><option value="all">Bancos</option>{data?.banks.map((item) => <option key={item} value={item}>{item}</option>)}</select><ChevronDown size={14} className={styles.down}/></label>
        <label className={cx(styles.control, styles.selectWrap)}><SlidersHorizontal size={15} className={styles.leadIcon}/><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por status"><option value="all">Status</option>{STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><ChevronDown size={14} className={styles.down}/></label>
        <label className={cx(styles.control, styles.selectWrap)}><CalendarDays size={15} className={styles.leadIcon}/><select value={period} onChange={(event) => setPeriod(event.target.value as PeriodValue)} aria-label="Filtrar por período"><option value="all">Período</option><option value="today">Hoje</option><option value="7">Próximos 7 dias</option><option value="30">Próximos 30 dias</option><option value="past">Vencidos</option></select><ChevronDown size={14} className={styles.down}/></label>
        <button className={styles.clearBtn} type="button" onClick={clearFilters}><RefreshCw size={14}/>Limpar filtros</button>
      </section>

      <section className={styles.financeCard}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.cardTitleRow}><span className={styles.cardTitle}>{TAB_LABEL[tab]}</span><span className={styles.recordPill}>{recordCount} {recordCount === 1 ? itemLabel[0] : itemLabel[1]}</span></div>
            <div className={styles.pageCount}>{loading ? "Carregando dados..." : visibleRows.length + (visibleRows.length === 1 ? " nesta página" : " nesta página")}</div>
          </div>
          <div className={styles.cardHeaderRight}>
            <span className={styles.sortLabel}>Ordenar por</span>
            <label className={cx(styles.control, styles.selectWrap, styles.sortControl)}><select value={sort} onChange={(event) => setSort(event.target.value as SortValue)} aria-label="Ordenar"><option value="dateAsc">Vencimento mais próximo</option><option value="dateDesc">Vencimento mais distante</option><option value="valueDesc">Maior valor</option><option value="valueAsc">Menor valor</option><option value="nameAsc">Cliente A-Z</option><option value="nameDesc">Cliente Z-A</option></select><ChevronDown size={14} className={styles.down}/></label>
            <div className={styles.viewToggle}><button className={cx(styles.viewBtn, view === "list" && styles.viewBtnActive)} type="button" aria-label="Visualização em lista" onClick={() => setView("list")}><List size={17}/></button><button className={cx(styles.viewBtn, view === "grid" && styles.viewBtnActive)} type="button" aria-label="Visualização em grade" onClick={() => setView("grid")}><Grid2X2 size={16}/></button></div>
          </div>
        </div>

        {loadError ? <div className={styles.errorState}><strong>Não foi possível carregar o Financeiro.</strong><span>{loadError}</span><button type="button" onClick={() => void load()}>Tentar novamente</button></div>
          : loading ? <LoadingTable/>
          : visibleRows.length === 0 ? <div className={styles.empty}><strong>{tab === "proofs" && !filtersActive ? "Nenhum comprovante aguardando análise nesta data." : "Nenhum registro encontrado"}</strong><span>{tab === "proofs" && !filtersActive ? "Escolha outra data ou acompanhe novas pendências por aqui." : "Ajuste os filtros para visualizar outros resultados."}</span></div>
          : view === "list" ? <FinanceTable rows={visibleRows} tab={tab} onOpen={openRow} onKey={rowKey} onMenu={openActionMenu} onFinance={(row) => openClient(row, "finance", row.installmentId)}/>
          : <FinanceGrid rows={visibleRows} tab={tab} onOpen={openRow} onKey={rowKey} onMenu={openActionMenu} onFinance={(row) => openClient(row, "finance", row.installmentId)}/>}
      </section>

      {menu ? <div className={styles.actionMenu} data-finance-action-menu role="menu" style={{ left: menu.left, top: menu.top }}>
        {menu.row.proof ? <button type="button" onClick={() => openProof(menu.row)}>{menu.row.isPendingProof ? "Analisar comprovante" : "Ver comprovante"}</button> : null}
        <button type="button" onClick={() => openClient(menu.row, "finance", tab === "late" ? menu.row.installmentId : null)}>Abrir Financeiro</button>
        <button type="button" onClick={() => openClient(menu.row, "profile")}>Abrir Perfil</button>
      </div> : null}

      <ClienteDetailDrawer
        cliente={selectedClient}
        open={Boolean(selectedClient)}
        initialTab={drawerTab}
        financeMode="compact"
        focusInstallmentId={drawerFocus}
        onOpenProof={openProofFromDrawer}
        onClose={() => { setSelectedClient(null); setDrawerFocus(null); }}
        onUpdated={(updated) => { if (updated) setSelectedClient(updated); void load(true); }}
      />

      <ProofDrawer
        row={selectedProof}
        onClose={() => setSelectedProof(null)}
        onOpenProfile={(row) => { setSelectedProof(null); openClient(row, "profile"); }}
        onResolved={onProofResolved}
      />

      {notice ? <div className={styles.toast} role="status">{notice}</div> : null}
    </div>
  );
}

function FinanceTable({
  rows, tab, onOpen, onKey, onMenu, onFinance,
}: {
  rows: FinancePanelRow[];
  tab: FinancePanelTab;
  onOpen: (row: FinancePanelRow) => void;
  onKey: (event: KeyboardEvent<HTMLElement>, row: FinancePanelRow) => void;
  onMenu: (event: MouseEvent<HTMLButtonElement>, row: FinancePanelRow) => void;
  onFinance: (row: FinancePanelRow) => void;
}) {
  return <div className={styles.tableWrap}><table className={styles.table}>
    <colgroup><col style={{width:"26%"}}/><col style={{width:"14%"}}/><col style={{width:"11.5%"}}/><col style={{width:"15%"}}/><col style={{width:"14%"}}/><col style={{width:"14%"}}/><col style={{width:"5.5%"}}/></colgroup>
    <thead><tr><th>Cliente</th><th>Parcela</th><th>Banco</th><th>Status</th><th>Vencimento</th><th>Valor</th><th>Ações</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={tab + "-" + row.clientId + "-" + row.installmentId} className={styles.clickRow} tabIndex={0} onClick={() => onOpen(row)} onKeyDown={(event) => onKey(event, row)}>
      <td><ClientCell row={row}/></td>
      <td>{row.installmentNumber}/{row.installmentTotal}</td>
      <td>{row.bank ? <span className={styles.bankPill}>{row.bank}</span> : "—"}</td>
      <td>{tab === "proofs" || tab === "late" || tab === "all" ? <button className={styles.statusLink} type="button" onClick={(event) => { event.stopPropagation(); onFinance(row); }}><StatusPill status={row.status}/></button> : <StatusPill status={row.status}/>}</td>
      <td>{dateBr(row.dueDate)}</td>
      <td><span className={styles.amount}>{money(row.amount)}</span></td>
      <td><button className={styles.rowAction} data-finance-action-menu type="button" aria-label={"Ações de " + row.name} onClick={(event) => onMenu(event, row)}><MoreHorizontal size={18}/></button></td>
    </tr>)}</tbody>
  </table></div>;
}

function FinanceGrid({
  rows, tab, onOpen, onKey, onMenu, onFinance,
}: {
  rows: FinancePanelRow[];
  tab: FinancePanelTab;
  onOpen: (row: FinancePanelRow) => void;
  onKey: (event: KeyboardEvent<HTMLElement>, row: FinancePanelRow) => void;
  onMenu: (event: MouseEvent<HTMLButtonElement>, row: FinancePanelRow) => void;
  onFinance: (row: FinancePanelRow) => void;
}) {
  return <div className={styles.gridView}>{rows.map((row) => <article key={tab + "-grid-" + row.clientId + "-" + row.installmentId} className={styles.financeItem} tabIndex={0} onClick={() => onOpen(row)} onKeyDown={(event) => onKey(event, row)}>
    <button className={styles.rowAction} data-finance-action-menu type="button" aria-label={"Ações de " + row.name} onClick={(event) => onMenu(event, row)}><MoreHorizontal size={18}/></button>
    <div className={styles.financeItemTop}><ClientCell row={row}/></div>
    <div className={styles.financeItemMeta}>
      <Meta label="Parcela" value={row.installmentNumber + "/" + row.installmentTotal}/>
      <Meta label="Banco" value={row.bank || "—"}/>
      <Meta label="Vencimento" value={dateBr(row.dueDate)}/>
      <Meta label="Contrato" value={row.contractCode}/>
    </div>
    <div className={styles.financeItemFooter}>{tab === "proofs" || tab === "late" || tab === "all" ? <button className={styles.statusLink} type="button" onClick={(event) => { event.stopPropagation(); onFinance(row); }}><StatusPill status={row.status}/></button> : <StatusPill status={row.status}/>}<span className={styles.amount}>{money(row.amount)}</span></div>
  </article>)}</div>;
}

function ClientCell({ row }: { row: FinancePanelRow }) {
  return <div className={styles.clientCell}><span className={styles.avatar}>{initials(row.name)}</span><div className={styles.clientCopy}><div className={styles.clientName}>{row.name || "Sem nome"}</div><div className={styles.clientCpf}>{cpfLabel(row.cpf)}</div></div></div>;
}

function StatusPill({ status }: { status: FinancePanelStatus }) {
  return <span className={cx(styles.statusPill, statusClass(status))}><span className={styles.statusDot}/>{status}</span>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><div className={styles.metaLabel}>{label}</div><div className={styles.metaValue}>{value}</div></div>;
}

function LoadingTable() {
  return <div className={styles.loadingRows}>{Array.from({ length: 7 }, (_, index) => <div key={index} className={styles.loadingRow}><span/><span/><span/><span/><span/><span/></div>)}</div>;
}

function MiniCalendar({
  month, selected, marked, onMonth, onSelect,
}: {
  month: Date;
  selected: string;
  marked: Set<string>;
  onMonth: (date: Date) => void;
  onSelect: (iso: string) => void;
}) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1);
  const startOffset = first.getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<{ iso: string; day: number } | null> = [];
  for (let i = 0; i < startOffset; i += 1) cells.push(null);
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(year, monthIndex, day);
    cells.push({ iso: localIso(date), day });
  }
  while (cells.length % 7) cells.push(null);

  return <div className={styles.miniCalendar} role="dialog" aria-label="Escolher data dos comprovantes">
    <div className={styles.miniCalendarHead}>
      <button className={styles.miniCalendarNav} type="button" aria-label="Mês anterior" onClick={() => onMonth(new Date(year, monthIndex - 1, 1))}><ChevronLeft size={16}/></button>
      <div className={styles.miniCalendarMonth}>{monthLong(month)}</div>
      <button className={styles.miniCalendarNav} type="button" aria-label="Próximo mês" onClick={() => onMonth(new Date(year, monthIndex + 1, 1))}><ChevronRight size={16}/></button>
    </div>
    <div className={styles.miniCalendarWeekdays}>{["D","S","T","Q","Q","S","S"].map((item, index) => <span key={item + index}>{item}</span>)}</div>
    <div className={styles.miniCalendarGrid}>{cells.map((cell, index) => cell ? <button key={cell.iso} className={cx(styles.calendarDay, cell.iso === selected && styles.calendarDaySelected, marked.has(cell.iso) && styles.calendarDayMarked)} type="button" disabled={cell.iso > localIso()} onClick={() => onSelect(cell.iso)}><span>{cell.day}</span>{marked.has(cell.iso) ? <i/> : null}</button> : <span key={"empty-" + index}/>)}</div>
    <div className={styles.miniCalendarFoot}><span className={styles.calendarLegend}><span/>comprovante pendente</span><button className={styles.calendarToday} type="button" onClick={() => onSelect(localIso())}>Hoje</button></div>
  </div>;
}

function ProofDrawer({
  row, onClose, onOpenProfile, onResolved,
}: {
  row: FinancePanelRow | null;
  onClose: () => void;
  onOpenProfile: (row: FinancePanelRow) => void;
  onResolved: () => Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [reason, setReason] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!row?.proof) { setUrl(null); return; }
    let active = true;
    setLoading(true);
    setError(null);
    setRejectMode(false);
    setReason("");
    financeiroApi.comprovanteUrl(row.installmentId)
      .then((result) => { if (active) setUrl(result.url); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Não foi possível abrir o comprovante."); })
      .finally(() => { if (active) setLoading(false); });
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => { active = false; };
  }, [row?.installmentId, row?.proof]);

  useEffect(() => {
    if (!row) return;
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [row, busy, onClose]);

  if (!row) return null;
  const pending = row.status === "Aguardando análise" && row.isPendingProof;
  const fileName = row.proof?.fileName ?? "comprovante";
  const isPdf = fileName.toLocaleLowerCase("pt-BR").endsWith(".pdf");

  async function validate(action: "confirmar" | "rejeitar") {
    if (!row) return;
    if (action === "rejeitar" && !reason.trim()) {
      setError("Informe o motivo da rejeição.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await financeiroApi.validar(row.installmentId, action, action === "rejeitar" ? reason.trim() : "");
      await onResolved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível analisar o comprovante.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}/>
    <aside className={styles.proofDrawer} role="dialog" aria-modal="true" aria-labelledby="proof-drawer-title">
      <div className={styles.drawerHeader}>
        <div><div className={styles.drawerKicker}>FINANCEIRO · COMPROVANTES</div><div className={styles.drawerTitle} id="proof-drawer-title">Analisar comprovante</div></div>
        <button ref={closeRef} className={styles.drawerClose} type="button" aria-label="Fechar análise do comprovante" disabled={busy} onClick={onClose}><X size={19}/></button>
      </div>
      <div className={styles.drawerScroll}>
        <button className={styles.proofSummary} type="button" onClick={() => onOpenProfile(row)}>
          <span className={styles.drawerAvatar}>{initials(row.name)}</span>
          <span className={styles.proofSummaryMain}><span className={styles.proofSummaryName}>{row.name}</span><span className={styles.proofSummaryCpf}>{cpfLabel(row.cpf)}</span></span>
          <span className={styles.proofSummaryStatus}><StatusPill status={row.status}/></span>
        </button>
        <div className={styles.proofMeta}>
          <ProofMeta label="Parcela" value={row.installmentNumber + "/" + row.installmentTotal}/>
          <ProofMeta label="Banco" value={row.bank || "—"}/>
          <ProofMeta label="Vencimento" value={dateBr(row.dueDate)}/>
          <ProofMeta label="Valor" value={money(row.amount)}/>
        </div>
        {error ? <div className={styles.drawerError} role="alert">{error}</div> : null}
        {rejectMode ? <div className={styles.rejectPanel}>
          <label htmlFor="proof-reason">Motivo da rejeição</label>
          <textarea id="proof-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Descreva o motivo para que a cliente possa corrigir o comprovante."/>
          <div><button type="button" disabled={busy} onClick={() => { setRejectMode(false); setReason(""); setError(null); }}>Cancelar</button><button type="button" disabled={busy || !reason.trim()} onClick={() => void validate("rejeitar")}>{busy ? "Recusando..." : "Confirmar recusa"}</button></div>
        </div> : null}
        <div className={styles.previewCard}>
          <div className={styles.previewToolbar}>
            <div className={styles.previewFile}><div className={styles.previewFileName}>{fileName}</div><div className={styles.previewFileType}>Arquivo anexado pela cliente</div></div>
            {url ? <a className={styles.downloadBtn} href={url} target="_blank" rel="noreferrer" download={fileName}><Download size={15}/>Baixar comprovante</a> : <span className={cx(styles.downloadBtn, styles.downloadDisabled)}><Download size={15}/>Baixar comprovante</span>}
          </div>
          <div className={styles.previewStage}>
            {loading ? <div className={styles.previewLoading}><FileText size={28}/><span>Abrindo comprovante...</span></div>
              : url ? isPdf ? <iframe className={styles.proofPdf} src={url} title={"Comprovante de " + row.name}/> : <img className={styles.proofImage} src={url} alt={"Comprovante de " + row.name}/>
              : <div className={styles.previewLoading}><FileText size={28}/><span>Pré-visualização indisponível.</span></div>}
          </div>
        </div>
      </div>
      <div className={styles.drawerActions}>
        <button className={styles.proofReject} type="button" disabled={busy || !pending} onClick={() => { setRejectMode(true); setError(null); }}><X size={17}/>{pending ? "Recusar comprovante" : row.status === "Recusado" ? "Comprovante recusado" : "Análise concluída"}</button>
        <button className={styles.proofConfirm} type="button" disabled={busy || !pending} onClick={() => void validate("confirmar")}><Check size={17}/>{busy ? "Processando..." : pending ? "Confirmar comprovante" : row.status === "Comprovante confirmado" ? "Comprovante confirmado" : "Pagamento recebido"}</button>
      </div>
    </aside>
  </>;
}

function ProofMeta({ label, value }: { label: string; value: string }) {
  return <div className={styles.proofMetaItem}><div className={styles.proofMetaLabel}>{label}</div><div className={styles.proofMetaValue}>{value}</div></div>;
}
