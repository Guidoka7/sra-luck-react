"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { useTheme } from "@/components/ui/ThemeProvider";
import { ClienteDrawer, type AbaDrawer } from "@/components/admin/cliente-drawer/ClienteDrawer";
import { formatarCpf } from "@/lib/cpf";
import { formatarMoeda } from "@/lib/utils";
import { fetchInstant, getInstantCache, refreshInstant } from "@/lib/instantCache";
import type { Cliente, NovaVenda, StatusContratoCliente } from "@/types/database";
import styles from "@/components/admin/lista/AdminLista.module.css";

/**
 * Clientes — padrão visual aprovado (referência k338) sobre os dados reais da
 * main: funil de cadastro (novas vendas do CRM → aguardando parcelas →
 * cadastradas → canceladas), filtros de banco/status/período e o drawer único
 * da cliente (Processo/Perfil/Financeiro/Jornada).
 */

type Funil = "novas" | "aguardando" | "cadastradas" | "canceladas";
type ViewMode = "list" | "grid";
type SortMode = "recent" | "old" | "az" | "za";
type PeriodMode = "all" | "today" | "7" | "30";

const TAB_LABEL: Record<Funil, string> = { novas: "Novas", aguardando: "Aguardando cadastro", cadastradas: "Cadastradas", canceladas: "Canceladas" };
const TABS: Funil[] = ["novas", "aguardando", "cadastradas", "canceladas"];
const STATUS_LABEL: Record<StatusContratoCliente, string> = { ativo: "Ativa", suspenso: "Suspensa", negativado: "Negativada", cancelado: "Cancelada" };

const Svg = ({ d, fill }: { d: string; fill?: boolean }) => <svg viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? undefined : "currentColor"} strokeWidth="1.7" aria-hidden="true"><path d={d} /></svg>;
const ICON = {
  search: "M10.8 4.4a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8ZM16 16l4 4",
  bank: "M3.5 9h17M5 9v9M9 9v9M15 9v9M19 9v9M3 18h18M12 3.5 4 7h16z",
  filter: "M4 6h16l-6 7v5l-4 2v-7z",
  calendar: "M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM8 3.5v4M16 3.5v4M4 9.5h16",
  chevron: "m7 9 5 5 5-5",
  clear: "M5 8a8 8 0 1 1-1 6M5 8V3M5 8h5",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  novas: "M12 5v14M5 12h14",
  aguardando: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7v5l3 2",
  cadastradas: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8.2-.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8ZM2.8 19v-1.8c0-2.8 2.2-5 5-5h.4c2.8 0 5 2.2 5 5V19zM13.5 13c.7-.5 1.6-.8 2.6-.8h.3c2.7 0 4.8 2.1 4.8 4.8V19h-6.1v-1.8c0-1.7-.6-3.1-1.6-4.2Z",
  canceladas: "m6 6 12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  empty: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM8.5 10.5h.01M15.5 10.5h.01M8.5 16c1.8-1.7 5.2-1.7 7 0",
};

function iniciais(nome: string | null | undefined) {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "—";
  const ultima = partes.length > 1 ? partes[partes.length - 1]?.[0] ?? "" : partes[0]?.[1] ?? "";
  return `${partes[0]?.[0] ?? ""}${ultima}`.toUpperCase();
}
function statusClass(status: StatusContratoCliente | undefined) {
  if (status === "cancelado") return styles.statusCancelled;
  if (status === "negativado") return styles.statusNegativada;
  if (status === "suspenso") return styles.statusSuspensa;
  return "";
}
function tempo(v: string | null | undefined) { const t = v ? new Date(v).getTime() : 0; return Number.isFinite(t) ? t : 0; }
function noPeriodo(criadoEm: string | null | undefined, periodo: PeriodMode) {
  if (periodo === "all") return true;
  if (!criadoEm) return false;
  const criado = new Date(criadoEm);
  if (Number.isNaN(criado.getTime())) return false;
  const agora = new Date();
  const dias = Math.floor((new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime() - new Date(criado.getFullYear(), criado.getMonth(), criado.getDate()).getTime()) / 86_400_000);
  return periodo === "today" ? dias === 0 : dias >= 0 && dias <= Number(periodo);
}
function ordenar<T>(lista: T[], modo: SortMode, nome: (x: T) => string, criado: (x: T) => string | null | undefined) {
  return [...lista].sort((a, b) => {
    if (modo === "recent") return tempo(criado(b)) - tempo(criado(a));
    if (modo === "old") return tempo(criado(a)) - tempo(criado(b));
    const cmp = nome(a).localeCompare(nome(b), "pt-BR", { sensitivity: "base" });
    return modo === "az" ? cmp : -cmp;
  });
}

/** Perfil existe, mas o financeiro só é considerado criado quando há parcelas reais persistidas. */
export function clienteAguardandoCadastroFinanceiro(cliente: Pick<Cliente, "ativo" | "status_contrato" | "parcelas_total">) {
  return cliente.ativo !== false
    && cliente.status_contrato !== "cancelado"
    && Number(cliente.parcelas_total ?? 0) === 0;
}

export function clienteComCadastroCompleto(cliente: Pick<Cliente, "ativo" | "status_contrato" | "parcelas_total">) {
  return cliente.ativo !== false
    && cliente.status_contrato !== "cancelado"
    && Number(cliente.parcelas_total ?? 0) > 0;
}

export default function ClientesPage() {
  const { theme } = useTheme();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [novasVendas, setNovasVendas] = useState<NovaVenda[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [funil, setFunil] = useState<Funil>("cadastradas");
  const [busca, setBusca] = useState("");
  const [banco, setBanco] = useState("all");
  const [status, setStatus] = useState<StatusContratoCliente | "all">("all");
  const [periodo, setPeriodo] = useState<PeriodMode>("all");
  const [ordenacao, setOrdenacao] = useState<SortMode>("recent");
  const [view, setView] = useState<ViewMode>("list");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ id: string | null; cliente: Cliente | null; aba: AbaDrawer } | null>(null);
  const [cadastrandoVenda, setCadastrandoVenda] = useState<string | null>(null);

  async function carregar(force = false) {
    const url = "/api/admin/clientes";
    const cached = !force ? getInstantCache<{ clientes?: Cliente[] }>(url) : null;
    if (cached) { setClientes(cached.clientes ?? []); setCarregando(false); } else setCarregando(true);
    try {
      const data = force ? await refreshInstant<{ clientes?: Cliente[] }>(url) : await fetchInstant<{ clientes?: Cliente[] }>(url);
      setClientes(data.clientes ?? []);
      try { const r = await fetch("/api/admin/novas-vendas", { cache: "no-store" }); const d = await r.json(); if (r.ok) setNovasVendas(d.vendas ?? []); } catch { /* staging opcional */ }
    } catch (e) { if (!cached) toast.error(e instanceof Error ? e.message : "Falha ao carregar clientes."); } finally { setCarregando(false); }
  }
  useEffect(() => { void carregar(); const intervalo = window.setInterval(() => void carregar(true), 30000); return () => window.clearInterval(intervalo); }, []);

  useEffect(() => {
    if (!menuId) return;
    const fechar = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest("[data-client-row-menu]")) setMenuId(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuId(null); };
    document.addEventListener("pointerdown", fechar);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fechar); document.removeEventListener("keydown", esc); };
  }, [menuId]);

  const novas = useMemo(() => novasVendas.filter((v) => !v.cliente_id && v.status === "aguardando_cadastro"), [novasVendas]);
  // Perfis arquivados por "Excluir perfil" ficam preservados no banco para
  // auditoria, mas não pertencem mais à área operacional de Clientes.
  const clientesVisiveis = useMemo(() => clientes.filter((c) => c.ativo !== false), [clientes]);
  // Fonte de verdade do funil "Aguardando cadastro": perfil já persistido,
  // porém SEM nenhuma parcela real. Não depende da origem (CRM ou cadastro manual).
  const aguardandoCadastro = useMemo(() => clientesVisiveis.filter(clienteAguardandoCadastroFinanceiro), [clientesVisiveis]);
  const cadastradas = useMemo(() => clientesVisiveis.filter(clienteComCadastroCompleto), [clientesVisiveis]);
  const canceladas = useMemo(() => clientesVisiveis.filter((c) => c.status_contrato === "cancelado"), [clientesVisiveis]);
  const ehVenda = funil === "novas";

  const baseClientes = funil === "aguardando" ? aguardandoCadastro : funil === "canceladas" ? canceladas : cadastradas;
  const bancos = useMemo(() => Array.from(new Set(baseClientes.map((c) => c.banco?.trim()).filter((b): b is string => Boolean(b)))).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })), [baseClientes]);
  useEffect(() => { if (banco !== "all" && !bancos.includes(banco)) setBanco("all"); }, [banco, bancos]);

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtradas = useMemo(() => ordenar(baseClientes.filter((c) => {
    if (termo && ![c.nome_completo, c.cpf, c.telefone, c.consultora, c.origem_venda, c.banco].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(termo)) return false;
    if (banco !== "all" && c.banco !== banco) return false;
    if (status !== "all" && (c.status_contrato ?? "ativo") !== status) return false;
    return noPeriodo(c.created_at, periodo);
  }), ordenacao, (c) => c.nome_completo ?? "", (c) => c.created_at), [baseClientes, termo, banco, status, periodo, ordenacao]);
  const vendasFiltradas = useMemo(() => ordenar(novas.filter((v) => {
    if (termo && ![v.nome_completo, v.cpf, v.telefone, v.vendedora_responsavel, v.origem_venda].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(termo)) return false;
    return noPeriodo(v.created_at, periodo);
  }), ordenacao, (v) => v.nome_completo ?? "", (v) => v.created_at), [novas, termo, periodo, ordenacao]);

  const counts: Record<Funil, number> = { novas: novas.length, aguardando: aguardandoCadastro.length, cadastradas: cadastradas.length, canceladas: canceladas.length };
  const total = ehVenda ? vendasFiltradas.length : filtradas.length;

  function limparFiltros() { setBusca(""); setBanco("all"); setStatus("all"); setPeriodo("all"); }
  function abrir(cliente: Cliente | null, aba: AbaDrawer, id: string | null = cliente?.id ?? null) { setMenuId(null); setDrawer({ id, cliente, aba }); }

  /** Conversão de uma venda do CRM em cliente — `POST /api/admin/novas-vendas/:id/cadastrar`. */
  async function cadastrarVenda(v: NovaVenda) {
    const cpf = window.prompt("CPF da cliente (11 dígitos):", v.cpf ?? "");
    const nascimento = cpf ? window.prompt("Data de nascimento (AAAA-MM-DD):") : null;
    if (!cpf || !nascimento) return;
    setCadastrandoVenda(v.id);
    try {
      const r = await fetch(`/api/admin/novas-vendas/${encodeURIComponent(v.id)}/cadastrar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cpf, dataNascimento: nascimento }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível cadastrar a cliente.");
      toast.success("Cliente cadastrada. Gere as parcelas no Financeiro.");
      await carregar(true);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível cadastrar a cliente."); }
    finally { setCadastrandoVenda(null); }
  }

  function RowMenu({ cliente }: { cliente: Cliente }) {
    const aberto = menuId === cliente.id;
    return <div className={styles.rowMenuWrap} data-client-row-menu>
      <button className={styles.rowMenuBtn} type="button" aria-label={`Ações de ${cliente.nome_completo || "cliente"}`} aria-haspopup="menu" aria-expanded={aberto} onClick={(e) => { e.stopPropagation(); setMenuId(aberto ? null : cliente.id); }}>⋮</button>
      {aberto && <div className={styles.rowMenu} role="menu">
        <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); abrir(cliente, "profile"); }}>Abrir perfil</button>
        <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); abrir(cliente, "finance"); }}>Financeiro</button>
        <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); abrir(cliente, "process"); }}>Processo</button>
      </div>}
    </div>;
  }

  const Avatar = ({ nome }: { nome: string | null | undefined }) => <div className={styles.clientAvatar} aria-hidden="true">{iniciais(nome)}</div>;
  const Dash = () => <span className={styles.dash}>—</span>;

  return <div className={`${styles.page} ${theme === "dark" ? styles.dark : ""}`}>
    <section className={styles.pageHeader}>
      <div>
        <div className={styles.eyebrow}>Clientes</div>
        <div className={styles.titleRow}><h1 className={styles.pageTitle}>Clientes</h1><span className={styles.goldLine} /></div>
        <p className={styles.pageSub}>Gerencie clientes recebidas pelo CRM e acompanhe o processo de cadastro.</p>
      </div>
      <div className={styles.pageHeadRight}>
        <div className={styles.headButtons}><button className={styles.primaryBtn} type="button" onClick={() => abrir(null, "profile", null)}><Svg d={ICON.plus} />Nova cliente</button></div>
        <div className={styles.decorative}><span className={styles.decorativeLine} /><span className={styles.decorativeText}>Organização que<br />transforma.</span></div>
      </div>
    </section>

    <nav className={styles.tabs} aria-label="Categorias de clientes" role="tablist" style={{ "--tabs": TABS.length } as CSSProperties}>
      {TABS.map((t) => <button key={t} className={`${styles.tab} ${funil === t ? styles.tabActive : ""}`} type="button" role="tab" aria-selected={funil === t} onClick={() => { setFunil(t); setMenuId(null); }}>
        <span className={styles.tabIcon}><Svg d={ICON[t]} fill={t === "cadastradas"} /></span>
        <span className={styles.tabLabel}>{TAB_LABEL[t]}</span>
        <span className={styles.countPill}>{counts[t]}</span>
      </button>)}
    </nav>

    <section className={styles.filters} aria-label="Filtros de clientes">
      <label className={styles.field}><Svg d={ICON.search} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, CPF, telefone ou vendedora..." aria-label="Buscar clientes" /></label>
      {!ehVenda && <label className={styles.selectWrap}>
        <span className={styles.leftIco}><Svg d={ICON.bank} /></span>
        <select value={banco} onChange={(e) => setBanco(e.target.value)} aria-label="Filtrar por banco">
          <option value="all">Todos os bancos</option>
          {bancos.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className={styles.chev}><Svg d={ICON.chevron} /></span>
      </label>}
      {funil === "cadastradas" && <label className={`${styles.selectWrap} ${styles.statusSelect}`}>
        <span className={styles.leftIco}><Svg d={ICON.filter} /></span>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusContratoCliente | "all")} aria-label="Filtrar por status">
          <option value="all">Todos os status</option>
          {(["ativo", "suspenso", "negativado"] as StatusContratoCliente[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <span className={styles.chev}><Svg d={ICON.chevron} /></span>
      </label>}
      <label className={`${styles.selectWrap} ${styles.periodSelect}`}>
        <span className={styles.leftIco}><Svg d={ICON.calendar} /></span>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodMode)} aria-label="Filtrar por período">
          <option value="all">Qualquer período</option><option value="today">Hoje</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option>
        </select>
        <span className={styles.chev}><Svg d={ICON.chevron} /></span>
      </label>
      <button className={styles.clearBtn} type="button" onClick={limparFiltros}><Svg d={ICON.clear} />Limpar filtros</button>
    </section>

    <section className={styles.listCard}>
      <header className={styles.cardHead}>
        <div>
          <div className={styles.cardTitleLine}><span className={styles.cardTitle}>{TAB_LABEL[funil]}</span><span className={styles.cardCount}>{counts[funil]} {counts[funil] === 1 ? "cliente" : "clientes"}</span></div>
          <div className={styles.cardSub}>{total} nesta página</div>
        </div>
        <div className={styles.cardTools}>
          <span className={styles.orderLabel}>Ordenar por</span>
          <label className={styles.smallSelect}>
            <select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as SortMode)} aria-label="Ordenar clientes">
              <option value="recent">Mais recentes</option><option value="old">Mais antigos</option><option value="az">Nome A-Z</option><option value="za">Nome Z-A</option>
            </select>
            <Svg d={ICON.chevron} />
          </label>
          {!ehVenda && <div className={styles.viewButtons}>
            <button className={`${styles.viewBtn} ${view === "list" ? styles.viewBtnActive : ""}`} type="button" aria-label="Lista" aria-pressed={view === "list"} onClick={() => setView("list")}><Svg d={ICON.list} /></button>
            <button className={`${styles.viewBtn} ${view === "grid" ? styles.viewBtnActive : ""}`} type="button" aria-label="Grade" aria-pressed={view === "grid"} onClick={() => setView("grid")}><Svg d={ICON.grid} /></button>
          </div>}
        </div>
      </header>

      {carregando && clientes.length === 0 ? <div className={styles.loadingState}>Carregando clientes...</div>
        : total === 0 ? <div className={styles.emptyState}><Svg d={ICON.empty} /><strong>{ehVenda ? "Nenhuma venda encontrada." : "Nenhuma cliente encontrada."}</strong><span>{funil === "novas" ? "Nenhuma venda nova aguardando conferência." : funil === "aguardando" ? "Nenhuma cliente aguardando geração de parcelas." : "Ajuste a busca ou os filtros desta lista."}</span></div>
        : ehVenda ? <div className={styles.tableWrap}>
            <table className={styles.table}>
              <colgroup><col className={styles.clientCol} /><col className={styles.sellerCol} /><col className={styles.campaignCol} /><col className={styles.bankCol} /><col className={styles.statusCol} /></colgroup>
              <thead><tr><th><span className={styles.thSort}>Cliente</span></th><th>Vendedora</th><th>Campanha</th><th>Valor</th><th>Ação</th></tr></thead>
              <tbody>{vendasFiltradas.map((v) => <tr key={v.id} style={{ cursor: "default" }}>
                <td><div className={styles.clientCell}><Avatar nome={v.nome_completo} /><div className={styles.clientMeta}><div className={styles.clientName}>{v.nome_completo || "Sem nome"}</div><div className={styles.clientCpf}>{v.cpf ? formatarCpf(v.cpf) : "CPF não informado"}</div></div></div></td>
                <td>{v.vendedora_responsavel || <Dash />}</td>
                <td>{v.origem_venda || <Dash />}</td>
                <td>{formatarMoeda(Number(v.valor_contrato ?? 0))}</td>
                <td><button className={styles.primaryBtn} style={{ height: 30, padding: "0 12px", fontSize: 11.5 }} type="button" disabled={cadastrandoVenda === v.id} onClick={(e) => { e.stopPropagation(); void cadastrarVenda(v); }}>{cadastrandoVenda === v.id ? "Cadastrando…" : "Conferir e cadastrar"}</button></td>
              </tr>)}</tbody>
            </table>
          </div>
        : view === "list" ? <div className={styles.tableWrap}>
            <table className={styles.table}>
              <colgroup><col className={styles.clientCol} /><col className={styles.sellerCol} /><col className={styles.campaignCol} /><col className={styles.bankCol} /><col className={styles.statusCol} /><col className={styles.actionsCol} /></colgroup>
              <thead><tr><th><span className={styles.thSort}>Cliente</span></th><th>Vendedora</th><th>Campanha</th><th>Banco</th><th>Status</th><th className={styles.center}>Ações</th></tr></thead>
              <tbody>{filtradas.map((c) => <tr key={c.id} onClick={() => abrir(c, funil === "aguardando" ? "finance" : "profile")}>
                <td><div className={styles.clientCell}><Avatar nome={c.nome_completo} /><div className={styles.clientMeta}><div className={styles.clientName}>{c.nome_completo || "Sem nome"}</div><div className={styles.clientCpf}>{c.cpf ? formatarCpf(c.cpf) : "CPF não informado"}</div></div></div></td>
                <td>{c.consultora || <Dash />}</td>
                <td>{c.origem_venda || <Dash />}</td>
                <td>{c.banco ? <span className={styles.bankPill}>{c.banco}</span> : <Dash />}</td>
                <td>{funil === "aguardando"
                  ? <span className={`${styles.statusPill} ${styles.statusSuspensa}`}><span className={styles.statusDot} />Falta gerar financeiro</span>
                  : <span className={`${styles.statusPill} ${statusClass(c.status_contrato)}`}><span className={styles.statusDot} />{STATUS_LABEL[c.status_contrato ?? "ativo"]}</span>}</td>
                <td className={styles.center}><RowMenu cliente={c} /></td>
              </tr>)}</tbody>
            </table>
          </div>
        : <div className={styles.gridView}>{filtradas.map((c) => <article key={c.id} className={styles.clientCard} onClick={() => abrir(c, funil === "aguardando" ? "finance" : "profile")}>
            <RowMenu cliente={c} />
            <div className={styles.clientCardTop}><Avatar nome={c.nome_completo} /><div className={styles.clientMeta}><div className={styles.clientName}>{c.nome_completo || "Sem nome"}</div><div className={styles.clientCpf}>{c.cpf ? formatarCpf(c.cpf) : "CPF não informado"}</div></div></div>
            <div className={styles.gridDetails}>
              <div><div className={styles.gridLabel}>Banco</div><div className={styles.gridValue}>{c.banco || "—"}</div></div>
              <div><div className={styles.gridLabel}>Status</div><div className={styles.gridValue}>{funil === "aguardando" ? "Falta gerar financeiro" : STATUS_LABEL[c.status_contrato ?? "ativo"]}</div></div>
              <div><div className={styles.gridLabel}>Vendedora</div><div className={styles.gridValue}>{c.consultora || "—"}</div></div>
              <div><div className={styles.gridLabel}>Campanha</div><div className={styles.gridValue}>{c.origem_venda || "—"}</div></div>
            </div>
          </article>)}</div>}
    </section>

    {drawer && <ClienteDrawer key={drawer.id ?? "nova"} clienteId={drawer.id} cliente={drawer.cliente} abaInicial={drawer.aba}
      onClose={() => setDrawer(null)} onChanged={() => carregar(true)} />}
  </div>;
}
