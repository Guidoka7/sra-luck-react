"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/ui/ThemeProvider";
import { ClienteDetailDrawer } from "@/components/admin/clientes/ClienteDetailDrawer";
import { formatarCpf } from "@/lib/cpf";
import { fetchInstant, getInstantCache, refreshInstant } from "@/lib/instantCache";
import { separarClientesAdmin, type ClientesAdminTab } from "@/lib/clientesAdmin";
import type { Cliente, StatusContratoCliente } from "@/types/database";
import styles from "./ClientesPage.module.css";

type ViewMode = "list" | "grid";
type SortMode = "recent" | "old" | "az" | "za";
type PeriodMode = "all" | "today" | "7" | "30";
type DrawerTab = "profile" | "finance";

const TAB_LABEL: Record<ClientesAdminTab, string> = {
  cadastradas: "Cadastradas",
  aguardando: "Aguardando cadastro",
  canceladas: "Canceladas",
};

const STATUS_LABEL: Record<StatusContratoCliente, string> = {
  ativo: "Ativa",
  inadimplente: "Inadimplente",
  suspenso: "Suspensa",
  negativado: "Negativada",
  cancelado: "Cancelada",
};

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.8" cy="10.8" r="6.4"/><path d="m16 16 4 4"/></svg>;
}
function BankIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3.5 9h17M5 9v9M9 9v9M15 9v9M19 9v9M3 18h18M12 3.5 4 7h16z"/></svg>;
}
function FilterIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 6h16l-6 7v5l-4 2v-7z"/></svg>;
}
function CalendarIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M13 13h3"/></svg>;
}
function ChevronIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m7 9 5 5 5-5"/></svg>;
}
function ClearIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 8a8 8 0 1 1-1 6M5 8V3M5 8h5"/></svg>;
}
function ListIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>;
}
function GridIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>;
}
function RegisteredIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="8" r="3"/><circle cx="16.2" cy="7.2" r="2.4"/><path d="M2.8 19v-1.8C2.8 14.4 5 12.2 7.8 12.2h.4c2.8 0 5 2.2 5 5V19zM13.5 13c.7-.5 1.6-.8 2.6-.8h.3c2.7 0 4.8 2.1 4.8 4.8V19h-6.1v-1.8c0-1.7-.6-3.1-1.6-4.2Z"/></svg>;
}
function WaitingIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>;
}
function CancelledIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m6 6 12 12M18 6 6 18"/></svg>;
}
function PlusIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 5v14M5 12h14"/></svg>;
}
function EmptyIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 10.5h.01M15.5 10.5h.01M8.5 16c1.8-1.7 5.2-1.7 7 0"/></svg>;
}

function tabIcon(tab: ClientesAdminTab) {
  if (tab === "cadastradas") return <RegisteredIcon/>;
  if (tab === "aguardando") return <WaitingIcon/>;
  return <CancelledIcon/>;
}

function iniciais(nome: string | null | undefined) {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "—";
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1]?.[0] ?? "" : partes[0]?.[1] ?? "";
  return `${primeira}${ultima}`.toUpperCase();
}

function statusLabel(cliente: Cliente) {
  return STATUS_LABEL[cliente.status_contrato ?? "ativo"];
}

function statusClass(cliente: Cliente) {
  const status = cliente.status_contrato ?? "ativo";
  if (status === "cancelado") return styles.statusCancelled;
  if (status === "negativado") return styles.statusNegativada;
  if (status === "suspenso") return styles.statusSuspensa;
  if (status === "inadimplente") return styles.statusInadimplente;
  return "";
}

function campaignLabel(cliente: Cliente) {
  return cliente.campanha?.trim() || cliente.origem_venda?.trim() || "—";
}

function dateKey(cliente: Cliente) {
  const value = cliente.created_at ? new Date(cliente.created_at).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function matchesPeriod(cliente: Cliente, period: PeriodMode) {
  if (period === "all") return true;
  if (!cliente.created_at) return false;
  const created = new Date(cliente.created_at);
  if (Number.isNaN(created.getTime())) return false;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startCreated = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime();
  const days = Math.floor((startToday - startCreated) / 86_400_000);
  if (period === "today") return days === 0;
  return days >= 0 && days <= Number(period);
}

function clientSearchText(cliente: Cliente) {
  return [
    cliente.nome_completo,
    cliente.cpf,
    cliente.telefone,
    cliente.consultora,
    cliente.origem_venda,
    cliente.campanha,
    cliente.banco,
  ].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
}

export default function ClientesPage() {
  const { theme } = useTheme();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [tab, setTab] = useState<ClientesAdminTab>("cadastradas");
  const [busca, setBusca] = useState("");
  const [banco, setBanco] = useState("all");
  const [status, setStatus] = useState<StatusContratoCliente | "all">("all");
  const [periodo, setPeriodo] = useState<PeriodMode>("all");
  const [ordenacao, setOrdenacao] = useState<SortMode>("recent");
  const [view, setView] = useState<ViewMode>("list");
  const [menuClienteId, setMenuClienteId] = useState<string | null>(null);
  const [drawerCliente, setDrawerCliente] = useState<Cliente | null | false>(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("profile");
  const [pageToast, setPageToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  function showPageToast(message: string) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setPageToast(message);
    toastTimer.current = window.setTimeout(() => setPageToast(null), 2400);
  }

  async function carregar(force = false) {
    const url = "/api/admin/clientes";
    const cached = !force ? getInstantCache<{ clientes?: Cliente[] }>(url) : null;
    if (cached) {
      setClientes(cached.clientes ?? []);
      setCarregando(false);
    } else {
      setCarregando(true);
    }

    try {
      const data = force
        ? await refreshInstant<{ clientes?: Cliente[] }>(url)
        : await fetchInstant<{ clientes?: Cliente[] }>(url);
      const next = data.clientes ?? [];
      setClientes(next);
      setDrawerCliente((current) => {
        if (!current || current === false) return current;
        return next.find((item) => item.id === current.id) ?? current;
      });
    } catch (error) {
      if (!cached) showPageToast(error instanceof Error ? error.message : "Falha ao carregar clientes.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    const timer = window.setInterval(() => void carregar(true), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    if (!menuClienteId) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest("[data-client-row-menu]")) setMenuClienteId(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuClienteId(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menuClienteId]);

  const grupos = useMemo(() => separarClientesAdmin(clientes), [clientes]);
  const baseAtual = grupos[tab];

  const bancos = useMemo(() => Array.from(new Set(
    baseAtual.map((cliente) => cliente.banco?.trim()).filter((value): value is string => Boolean(value)),
  )).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })), [baseAtual]);

  useEffect(() => {
    if (banco !== "all" && !bancos.includes(banco)) setBanco("all");
  }, [banco, bancos]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    const result = baseAtual.filter((cliente) => {
      if (termo && !clientSearchText(cliente).includes(termo)) return false;
      if (banco !== "all" && cliente.banco !== banco) return false;
      if (status !== "all" && (cliente.status_contrato ?? "ativo") !== status) return false;
      return matchesPeriod(cliente, periodo);
    });

    return [...result].sort((a, b) => {
      if (ordenacao === "recent") return dateKey(b) - dateKey(a);
      if (ordenacao === "old") return dateKey(a) - dateKey(b);
      const nomeA = a.nome_completo ?? "";
      const nomeB = b.nome_completo ?? "";
      const cmp = nomeA.localeCompare(nomeB, "pt-BR", { sensitivity: "base" });
      return ordenacao === "az" ? cmp : -cmp;
    });
  }, [baseAtual, busca, banco, status, periodo, ordenacao]);

  function clearFilters() {
    setBusca("");
    setBanco("all");
    setStatus("all");
    setPeriodo("all");
  }

  function openDrawer(cliente: Cliente | null, initialTab: DrawerTab = "profile") {
    setMenuClienteId(null);
    setDrawerTab(initialTab);
    setDrawerCliente(cliente);
  }

  function atualizarDepoisDoDrawer(atualizada?: Cliente) {
    if (atualizada) {
      setClientes((atuais) => atuais.map((item) => item.id === atualizada.id ? { ...item, ...atualizada } : item));
      setDrawerCliente((current) => current && current !== false && current.id === atualizada.id ? { ...current, ...atualizada } : current);
    }
    void carregar(true);
  }

  function RowMenu({ cliente }: { cliente: Cliente }) {
    const open = menuClienteId === cliente.id;
    return <div className={styles.rowMenuWrap} data-client-row-menu>
      <button
        className={styles.rowMenuBtn}
        type="button"
        aria-label={`Ações de ${cliente.nome_completo || "cliente"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setMenuClienteId((current) => current === cliente.id ? null : cliente.id);
        }}
      >⋮</button>
      {open ? <div className={styles.rowMenu} role="menu">
        <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); openDrawer(cliente, "profile"); }}>Abrir cliente</button>
        <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); openDrawer(cliente, "profile"); }}>Editar</button>
        <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); openDrawer(cliente, "finance"); }}>Financeiro</button>
      </div> : null}
    </div>;
  }

  function ClientRow({ cliente }: { cliente: Cliente }) {
    return <tr onClick={() => openDrawer(cliente, "profile")}>
      <td><div className={styles.clientCell}>
        <div className={styles.clientAvatar}>{iniciais(cliente.nome_completo)}</div>
        <div className={styles.clientMeta}>
          <div className={styles.clientName}>{cliente.nome_completo || "Sem nome"}</div>
          <div className={styles.clientCpf}>{cliente.cpf ? formatarCpf(cliente.cpf) : "CPF não informado"}</div>
        </div>
      </div></td>
      <td>{cliente.consultora ? cliente.consultora : <span className={styles.dash}>—</span>}</td>
      <td>{campaignLabel(cliente) === "—" ? <span className={styles.dash}>—</span> : campaignLabel(cliente)}</td>
      <td>{cliente.banco ? <span className={styles.bankPill}>{cliente.banco}</span> : <span className={styles.dash}>—</span>}</td>
      <td><span className={`${styles.statusPill} ${statusClass(cliente)}`}><span className={styles.statusDot}/>{statusLabel(cliente)}</span></td>
      <td className={styles.center}><RowMenu cliente={cliente}/></td>
    </tr>;
  }

  function ClientCard({ cliente }: { cliente: Cliente }) {
    return <article className={styles.clientCard} onClick={() => openDrawer(cliente, "profile")}>
      <RowMenu cliente={cliente}/>
      <div className={styles.clientCardTop}>
        <div className={styles.clientAvatar}>{iniciais(cliente.nome_completo)}</div>
        <div className={styles.clientMeta}>
          <div className={styles.clientName}>{cliente.nome_completo || "Sem nome"}</div>
          <div className={styles.clientCpf}>{cliente.cpf ? formatarCpf(cliente.cpf) : "CPF não informado"}</div>
        </div>
      </div>
      <div className={styles.gridDetails}>
        <div><div className={styles.gridLabel}>Banco</div><div className={styles.gridValue}>{cliente.banco || "—"}</div></div>
        <div><div className={styles.gridLabel}>Status</div><div className={styles.gridValue}>{statusLabel(cliente)}</div></div>
        <div><div className={styles.gridLabel}>Vendedora</div><div className={styles.gridValue}>{cliente.consultora || "—"}</div></div>
        <div><div className={styles.gridLabel}>Campanha</div><div className={styles.gridValue}>{campaignLabel(cliente)}</div></div>
      </div>
    </article>;
  }

  const tabs: ClientesAdminTab[] = ["cadastradas", "aguardando", "canceladas"];
  const counts: Record<ClientesAdminTab, number> = {
    cadastradas: grupos.cadastradas.length,
    aguardando: grupos.aguardando.length,
    canceladas: grupos.canceladas.length,
  };

  return <div className={`${styles.page} ${theme === "dark" ? styles.dark : ""}`}>
    <section className={styles.pageHeader}>
      <div>
        <div className={styles.eyebrow}>Clientes</div>
        <div className={styles.titleRow}><h1 className={styles.pageTitle}>Clientes</h1><span className={styles.goldLine}/></div>
        <p className={styles.pageSub}>Gerencie clientes recebidas pelo CRM e acompanhe o processo de cadastro.</p>
      </div>
      <div className={styles.pageHeadRight}>
        <div className={styles.headButtons}>
          <button className={styles.primaryBtn} type="button" onClick={() => openDrawer(null, "profile")}><PlusIcon/>Nova cliente</button>
          <button className={styles.moreBtn} type="button" aria-label="Mais opções da página" onClick={() => showPageToast("Mais opções da página.")}>•••</button>
        </div>
        <div className={styles.decorative}><span className={styles.decorativeLine}/><span className={styles.decorativeText}>Organização que<br/>transforma.</span></div>
      </div>
    </section>

    <nav className={styles.tabs} aria-label="Categorias de clientes">
      {tabs.map((item) => <button
        key={item}
        className={`${styles.tab} ${tab === item ? styles.tabActive : ""}`}
        type="button"
        aria-selected={tab === item}
        onClick={() => { setTab(item); setMenuClienteId(null); }}
      >
        <span className={styles.tabIcon}>{tabIcon(item)}</span>
        <span className={styles.tabLabel}>{TAB_LABEL[item]}</span>
        <span className={styles.countPill}>{counts[item]}</span>
      </button>)}
    </nav>

    <section className={styles.filters} aria-label="Filtros de clientes">
      <label className={styles.field}>
        <SearchIcon/>
        <input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar por nome, CPF, telefone ou vendedora..." aria-label="Buscar clientes"/>
      </label>

      <label className={styles.selectWrap}>
        <span className={styles.leftIco}><BankIcon/></span>
        <select value={banco} onChange={(event) => setBanco(event.target.value)} aria-label="Filtrar por banco">
          <option value="all">Todos os bancos</option>
          {bancos.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <span className={styles.chev}><ChevronIcon/></span>
      </label>

      <label className={`${styles.selectWrap} ${styles.statusSelect}`}>
        <span className={styles.leftIco}><FilterIcon/></span>
        <select value={status} onChange={(event) => setStatus(event.target.value as StatusContratoCliente | "all")} aria-label="Filtrar por status">
          <option value="all">Todos os status</option>
          <option value="ativo">Ativa</option>
          <option value="inadimplente">Inadimplente</option>
          <option value="suspenso">Suspensa</option>
          <option value="negativado">Negativada</option>
          <option value="cancelado">Cancelada</option>
        </select>
        <span className={styles.chev}><ChevronIcon/></span>
      </label>

      <label className={`${styles.selectWrap} ${styles.periodSelect}`}>
        <span className={styles.leftIco}><CalendarIcon/></span>
        <select value={periodo} onChange={(event) => setPeriodo(event.target.value as PeriodMode)} aria-label="Filtrar por período">
          <option value="all">Qualquer período</option>
          <option value="today">Hoje</option>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
        </select>
        <span className={styles.chev}><ChevronIcon/></span>
      </label>

      <button className={styles.clearBtn} type="button" onClick={clearFilters}><ClearIcon/>Limpar filtros</button>
    </section>

    <section className={styles.listCard}>
      <header className={styles.cardHead}>
        <div>
          <div className={styles.cardTitleLine}><span className={styles.cardTitle}>{TAB_LABEL[tab]}</span><span className={styles.cardCount}>{counts[tab]} {counts[tab] === 1 ? "cliente" : "clientes"}</span></div>
          <div className={styles.cardSub}>{filtradas.length} nesta página</div>
        </div>
        <div className={styles.cardTools}>
          <span className={styles.orderLabel}>Ordenar por</span>
          <label className={styles.smallSelect}>
            <select value={ordenacao} onChange={(event) => setOrdenacao(event.target.value as SortMode)} aria-label="Ordenar clientes">
              <option value="recent">Mais recentes</option>
              <option value="old">Mais antigos</option>
              <option value="az">Nome A-Z</option>
              <option value="za">Nome Z-A</option>
            </select>
            <ChevronIcon/>
          </label>
          <div className={styles.viewButtons}>
            <button className={`${styles.viewBtn} ${view === "list" ? styles.viewBtnActive : ""}`} type="button" aria-label="Lista" onClick={() => setView("list")}><ListIcon/></button>
            <button className={`${styles.viewBtn} ${view === "grid" ? styles.viewBtnActive : ""}`} type="button" aria-label="Grade" onClick={() => setView("grid")}><GridIcon/></button>
          </div>
        </div>
      </header>

      {carregando && clientes.length === 0 ? <div className={styles.loadingState}>Carregando clientes...</div> : filtradas.length === 0 ? (
        <div className={styles.emptyState}><EmptyIcon/><strong>Nenhuma cliente encontrada.</strong><span>Ajuste a busca ou os filtros desta lista.</span></div>
      ) : view === "list" ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <colgroup>
              <col className={styles.clientCol}/><col className={styles.sellerCol}/><col className={styles.campaignCol}/><col className={styles.bankCol}/><col className={styles.statusCol}/><col className={styles.actionsCol}/>
            </colgroup>
            <thead><tr>
              <th><span className={styles.thSort}>Cliente</span></th>
              <th>Vendedora</th>
              <th>Campanha</th>
              <th>Banco</th>
              <th>Status</th>
              <th className={styles.center}>Ações</th>
            </tr></thead>
            <tbody>{filtradas.map((cliente) => <ClientRow key={cliente.id} cliente={cliente}/>)}</tbody>
          </table>
        </div>
      ) : (
        <div className={styles.gridView}>{filtradas.map((cliente) => <ClientCard key={cliente.id} cliente={cliente}/>)}</div>
      )}
    </section>

    {drawerCliente !== false ? <ClienteDetailDrawer
      cliente={drawerCliente}
      creating={drawerCliente === null}
      initialTab={drawerTab}
      open
      onClose={() => setDrawerCliente(false)}
      onUpdated={atualizarDepoisDoDrawer}
      onCreated={(criada) => {
        setClientes((atuais) => [criada, ...atuais.filter((item) => item.id !== criada.id)]);
        setDrawerCliente(criada);
        setDrawerTab("profile");
        setTab("aguardando");
        void carregar(true);
      }}
    /> : null}

    <div className={`${styles.pageToast} ${pageToast ? styles.pageToastVisible : ""}`} role="status" aria-live="polite">{pageToast}</div>
  </div>;
}
