"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { useTheme } from "@/components/ui/ThemeProvider";
import { ClienteDrawer, type AbaDrawer } from "@/components/admin/cliente-drawer/ClienteDrawer";
import { formatarCpf } from "@/lib/cpf";
import { formatarMoeda } from "@/lib/utils";
import { financeiroApi } from "@/features/financeiro/financeiroApi";
import { FUNIL_CLIENTE_LABEL } from "@/features/financeiro/types";
import type { ClienteFunilItem, FunilClienteBucket, Recebivel, RecebidosSubfunil } from "@/features/financeiro/types";
import type { Cliente } from "@/types/database";
import styles from "@/components/admin/lista/AdminLista.module.css";
import { PainelOperacaoIntegracao } from "@/features/admin/PainelOperacaoIntegracao";
import { ContaAzulOperacao } from "@/features/admin/IntegracoesOperacao";
import { useAcessoTotalAdmin } from "@/lib/adminAccess";
import { adicionarDiasCivil, hojeSaoPaulo } from "@/lib/dataCivil";

/**
 * Financeiro — padrão visual aprovado (referência k338) sobre o funil real
 * por cliente (`GET /api/admin/financeiro/clientes`). Clicar no nome abre o
 * drawer único da cliente direto no Financeiro, onde o comprovante é
 * analisado (confirmar/rejeitar), a baixa é registrada e o plano é ajustado.
 */

type FinanceiroBucket = FunilClienteBucket | "recebidos";

const ORDEM: FinanceiroBucket[] = ["aguardando_conferencia", "recebidos", "ativos", "todos", "suspensos", "negativados", "cancelados"];

const FUNIL_NOTA: Record<FunilClienteBucket, string> = {
  aguardando_conferencia: "Clientes que enviaram comprovantes de pagamento e aguardam análise do Financeiro.",
  ativos: "Contratos operando normalmente, com parcelas em aberto e pagamentos disponíveis no app.",
  todos: "Todos os contratos ativos, aguardando conferência, suspensos e negativados.",
  suspensos: "Parcelas restantes suspensas no app. Pode ter período determinado ou indeterminado.",
  negativados: "Parcelas suspensas e pagamentos indisponíveis no aplicativo.",
  cancelados: "Acesso ao app bloqueado. O histórico permanece disponível.",
};

type SortMode = "venc" | "saldo" | "az" | "za";

const Svg = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={d} /></svg>;
const ICON = {
  search: "M10.8 4.4a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8ZM16 16l4 4",
  chevron: "m7 9 5 5 5-5",
  clear: "M5 8a8 8 0 1 1-1 6M5 8V3M5 8h5",
  empty: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM8.5 10.5h.01M15.5 10.5h.01M8.5 16c1.8-1.7 5.2-1.7 7 0",
  aguardando_conferencia: "M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20ZM10 11h5M10 14.5h5M10 18h3",
  recebidos: "M4 7.5h16M6.5 4.5h11A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17V7a2.5 2.5 0 0 1 2.5-2.5ZM8 13l2.4 2.4L16 10",
  ativos: "m5 12.5 4.2 4.2L19 7",
  todos: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8.2.8a2.4 2.4 0 1 0 0 4.8M2.8 19v-1c0-2.8 2.2-5 5-5h.4c2.8 0 5 2.2 5 5v1M15.5 13.2h.8c2.7 0 4.8 2.1 4.8 4.8v1",
  suspensos: "M9 6v12M15 6v12",
  negativados: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.5v5.5M12 16.5h.01",
  cancelados: "m6 6 12 12M18 6 6 18",
};

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1]?.[0] ?? "" : p[0]?.[1] ?? "")).toUpperCase() || "—";
}
function dataBr(v: string | null | undefined) { return v ? v.slice(0, 10).split("-").reverse().join("/") : "—"; }
function dataHoraBr(v: string | null | undefined) {
  if (!v) return "—";
  const data = new Date(v);
  if (Number.isNaN(data.getTime())) return dataBr(v);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(data);
}
function origemRecebimento(v: string | null | undefined) {
  const labels: Record<string, string> = {
    manual: "Baixa manual", comprovante: "Comprovante", historico: "Histórico",
    banco: "Banco", mercado_pago: "Mercado Pago", conta_azul: "Conta Azul", interno: "Interno",
  };
  return labels[v ?? ""] ?? (v || "—");
}
function bucketClass(b: FunilClienteBucket) {
  if (b === "aguardando_conferencia") return styles.statusProof;
  if (b === "suspensos") return styles.statusSuspensa;
  if (b === "negativados") return styles.statusNegativada;
  if (b === "cancelados") return styles.statusCancelled;
  return "";
}

export default function FinanceiroPage() {
  // Operação de integração (RD / Conta Azul): somente o cargo Administrativo.
  const acessoTotal = useAcessoTotalAdmin();
  const { theme } = useTheme();
  const [itens, setItens] = useState<ClienteFunilItem[]>([]);
  const [clientesCompletos, setClientesCompletos] = useState<Cliente[]>([]);
  const [funis, setFunis] = useState<Array<{ bucket: FunilClienteBucket; total: number }>>([]);
  const [bucket, setBucket] = useState<FinanceiroBucket>("aguardando_conferencia");
  const [busca, setBusca] = useState("");
  const [ordenacao, setOrdenacao] = useState<SortMode>("venc");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ id: string; aba: AbaDrawer } | null>(null);
  const [subfunil, setSubfunil] = useState<RecebidosSubfunil>("recebidos");
  const [diaRecebidos, setDiaRecebidos] = useState(() => hojeSaoPaulo());
  const [recebidosDia, setRecebidosDia] = useState<Recebivel[]>([]);
  const [vencidosTotais, setVencidosTotais] = useState<Recebivel[]>([]);
  const [carregandoRecebidos, setCarregandoRecebidos] = useState(false);
  const [erroRecebidos, setErroRecebidos] = useState<string | null>(null);

  async function carregar() {
    try {
      const [funil, lista] = await Promise.all([financeiroApi.funilClientes(), financeiroApi.clientes()]);
      setItens(funil.itens);
      setFunis(funil.funis);
      setClientesCompletos(lista as Cliente[]);
      setErro(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Falha ao carregar o funil de clientes.";
      setErro(msg); toast.error(msg);
    } finally {
      setCarregando(false);
    }
  }
  async function carregarRecebidos() {
    setCarregandoRecebidos(true);
    try {
      const [recebidos, vencidos] = await Promise.all([
        financeiroApi.recebidos({ data: diaRecebidos, tipo: "recebidos" }),
        financeiroApi.recebidos({ data: diaRecebidos, tipo: "vencidos" }),
      ]);
      setRecebidosDia(recebidos.itens);
      setVencidosTotais(vencidos.itens);
      setErroRecebidos(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Falha ao carregar recebidos e vencidos.";
      setErroRecebidos(msg);
      toast.error(msg);
    } finally {
      setCarregandoRecebidos(false);
    }
  }
  useEffect(() => { void carregar(); }, []);
  useEffect(() => { if (bucket === "recebidos") void carregarRecebidos(); }, [bucket, diaRecebidos]);

  useEffect(() => {
    if (!menuId) return;
    const fechar = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest("[data-client-row-menu]")) setMenuId(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuId(null); };
    document.addEventListener("pointerdown", fechar);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fechar); document.removeEventListener("keydown", esc); };
  }, [menuId]);

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const visiveis = useMemo(() => {
    if (bucket === "recebidos") return [];
    const base = bucket === "todos" ? itens : itens.filter((item) => item.bucket === bucket);
    const filtrados = termo ? base.filter((i) => [i.nome, i.cpf, i.vendedora, i.campanha].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(termo)) : base;
    return [...filtrados].sort((a, b) => {
      if (ordenacao === "saldo") return b.saldoAReceber - a.saldoAReceber;
      if (ordenacao === "venc") return (a.proximoVencimento ?? "9999").localeCompare(b.proximoVencimento ?? "9999");
      const cmp = a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
      return ordenacao === "az" ? cmp : -cmp;
    });
  }, [itens, bucket, termo, ordenacao]);

  const recebidosFiltrados = useMemo(() => {
    if (!termo) return recebidosDia;
    return recebidosDia.filter((i) => [i.cliente, i.cpf, `${i.numeroParcela}/${i.totalParcelas}`, i.origem, i.formaPagamento].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(termo));
  }, [recebidosDia, termo]);
  const vencidosFiltrados = useMemo(() => {
    if (!termo) return vencidosTotais;
    return vencidosTotais.filter((i) => [i.cliente, i.cpf, `${i.numeroParcela}/${i.totalParcelas}`, i.origem].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(termo));
  }, [vencidosTotais, termo]);
  const recebidosVisiveis = subfunil === "recebidos" ? recebidosFiltrados : vencidosFiltrados;

  const total = (b: FinanceiroBucket) => b === "recebidos"
    ? (subfunil === "recebidos" ? recebidosFiltrados.length : vencidosFiltrados.length)
    : funis.find((f) => f.bucket === b)?.total ?? 0;
  function abrir(item: ClienteFunilItem, aba: AbaDrawer = "finance") { setMenuId(null); setDrawer({ id: item.clienteId, aba }); }
  function abrirRecebivel(item: Recebivel, aba: AbaDrawer = "finance") { setMenuId(null); setDrawer({ id: item.clienteId, aba }); }

  return <div className={`${styles.page} ${theme === "dark" ? styles.dark : ""}`}>
    <section className={styles.pageHeader}>
      <div>
        <div className={styles.eyebrow}>Financeiro</div>
        <div className={styles.titleRow}><h1 className={styles.pageTitle}>Financeiro</h1><span className={styles.goldLine} /></div>
        <p className={styles.pageSub}>Conferência de comprovantes, controle de parcelas e operações financeiras em um único espaço.</p>
      </div>
      <div className={styles.pageHeadRight}>
        {acessoTotal && <div style={{ display: "flex", justifyContent: "flex-end" }}><PainelOperacaoIntegracao rotulo="Conta Azul" titulo="Conta Azul" descricao="Conflitos, fila de envio, vínculos e sincronização das parcelas com a Conta Azul."><ContaAzulOperacao modo="equipe" /></PainelOperacaoIntegracao></div>}
        <div className={styles.decorative}><span className={styles.decorativeLine} /><span className={styles.decorativeText}>Disciplina hoje,<br />liberdade sempre.</span></div>
      </div>
    </section>

    <nav className={styles.tabs} aria-label="Funil financeiro" role="tablist" style={{ "--tabs": ORDEM.length } as CSSProperties}>
      {ORDEM.map((b) => <button key={b} className={`${styles.tab} ${bucket === b ? styles.tabActive : ""}`} type="button" role="tab" aria-selected={bucket === b} onClick={() => { setBucket(b); setMenuId(null); }}>
        <span className={styles.tabIcon}><Svg d={ICON[b]} /></span>
        <span className={styles.tabLabel}>{b === "recebidos" ? "Recebidos" : FUNIL_CLIENTE_LABEL[b]}</span>
        <span className={styles.countPill}>{total(b)}</span>
      </button>)}
    </nav>

    <section className={styles.filters} aria-label="Filtros do financeiro">
      <label className={styles.field}><Svg d={ICON.search} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, CPF, campanha ou vendedora..." aria-label="Buscar clientes no financeiro" /></label>
      <button className={styles.clearBtn} type="button" onClick={() => setBusca("")}><Svg d={ICON.clear} />Limpar busca</button>
    </section>

    <section className={styles.listCard}>
      {bucket === "recebidos" ? <>
        <header className={styles.cardHead}>
          <div>
            <div className={styles.cardTitleLine}>
              <span className={styles.cardTitle}>{subfunil === "recebidos" ? "Recebidos no dia" : "Vencidos totais"}</span>
              <span className={styles.cardCount}>{recebidosVisiveis.length} {recebidosVisiveis.length === 1 ? "registro" : "registros"}</span>
            </div>
            <div className={styles.cardSub}>{subfunil === "recebidos" ? `Confirmações e baixas de ${dataBr(diaRecebidos)}` : "Todas as parcelas vencidas em aberto, independentemente do dia selecionado."}</div>
          </div>
        </header>

        <nav className={styles.tabs} aria-label="Filtros de recebidos" role="tablist" style={{ "--tabs": 2, height: 46, margin: "14px 16px 0" } as CSSProperties}>
          {(["recebidos", "vencidos"] as RecebidosSubfunil[]).map((tipo) => {
            const quantidade = tipo === "recebidos" ? recebidosFiltrados.length : vencidosFiltrados.length;
            return <button key={tipo} className={`${styles.tab} ${subfunil === tipo ? styles.tabActive : ""}`} type="button" role="tab" aria-selected={subfunil === tipo} onClick={() => { setSubfunil(tipo); setMenuId(null); }}>
              <span className={styles.tabLabel}>{tipo === "recebidos" ? "Recebidos" : "Vencidos"}</span>
              <span className={styles.countPill}>{quantidade}</span>
            </button>;
          })}
        </nav>

        <div className={styles.funilNote} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <span>{subfunil === "recebidos"
            ? "Lista somente comprovantes confirmados e baixas cuja confirmação ocorreu no dia selecionado."
            : "Vencidos mostra o total acumulado em aberto. O seletor de dia permanece na tela, mas não restringe esta lista."}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className={styles.rowMenuBtn} type="button" aria-label="Dia anterior" title="Dia anterior" onClick={() => setDiaRecebidos((atual) => adicionarDiasCivil(atual, -1))}>‹</button>
            <strong className={styles.mono} style={{ minWidth: 92, textAlign: "center", color: "var(--text)" }}>{dataBr(diaRecebidos)}</strong>
            <button className={styles.rowMenuBtn} type="button" aria-label="Próximo dia" title="Próximo dia" onClick={() => setDiaRecebidos((atual) => adicionarDiasCivil(atual, 1))}>›</button>
          </div>
        </div>

        {carregandoRecebidos ? <div className={styles.loadingState}>Carregando recebimentos...</div>
          : erroRecebidos && recebidosDia.length === 0 && vencidosTotais.length === 0 ? <div className={styles.emptyState} role="alert"><Svg d={ICON.empty} /><strong>Não foi possível carregar os recebimentos.</strong><span>{erroRecebidos}</span><button className={styles.clearBtn} style={{ margin: "12px auto 0" }} type="button" onClick={() => void carregarRecebidos()}>Tentar novamente</button></div>
          : recebidosVisiveis.length === 0 ? <div className={styles.emptyState}><Svg d={ICON.empty} /><strong>{subfunil === "recebidos" ? "Nenhum recebimento neste dia." : "Nenhuma parcela vencida."}</strong><span>{termo ? "A busca atual não encontrou registros." : subfunil === "recebidos" ? "Use as setas para consultar outro dia." : "Não há vencidos em aberto no momento."}</span></div>
          : <div className={styles.tableWrap}>
              <table className={styles.table}>
                <colgroup><col style={{ width: "22%" }} /><col style={{ width: "9%" }} /><col style={{ width: "14%" }} /><col style={{ width: "11%" }} /><col style={{ width: "11%" }} /><col style={{ width: "11%" }} /><col style={{ width: "13%" }} /><col style={{ width: "5%" }} /></colgroup>
                <thead><tr><th>Cliente</th><th>Parcela</th><th>{subfunil === "recebidos" ? "Confirmado / baixa" : "Vencimento"}</th><th>Valor</th><th>Forma</th><th>Origem</th><th>Status</th><th className={styles.center}>Ações</th></tr></thead>
                <tbody>{recebidosVisiveis.map((r) => {
                  const menuKey = `recebido:${r.id}`;
                  const aberto = menuId === menuKey;
                  return <tr key={`${subfunil}:${r.recebimentoId ?? r.id}`} onClick={() => abrirRecebivel(r)}>
                    <td><button type="button" className={`${styles.nameBtn} ${styles.clientCell}`} onClick={(e) => { e.stopPropagation(); abrirRecebivel(r); }} aria-label={`Abrir ${r.cliente} no Financeiro`}>
                      <div className={styles.clientAvatar} aria-hidden="true">{iniciais(r.cliente)}</div>
                      <div className={styles.clientMeta}><div className={styles.clientName}>{r.cliente}</div><div className={styles.clientCpf}>{r.cpf ? formatarCpf(r.cpf) : "CPF não informado"}</div></div>
                    </button></td>
                    <td className={styles.mono}>{r.numeroParcela}/{r.totalParcelas}</td>
                    <td className={styles.mono}>{subfunil === "recebidos" ? dataHoraBr(r.confirmadoEm) : dataBr(r.vencimento)}</td>
                    <td className={`${styles.mono} ${styles.strong}`}>{formatarMoeda(r.valorRecebido ?? r.valorEsperado)}</td>
                    <td>{r.formaPagamento || <span className={styles.dash}>—</span>}</td>
                    <td>{origemRecebimento(r.origem)}</td>
                    <td><span className={`${styles.statusPill} ${subfunil === "vencidos" ? styles.statusCancelled : ""}`}><span className={styles.statusDot} />{subfunil === "recebidos" ? "Recebido" : "Vencido"}</span></td>
                    <td className={styles.center}><div className={styles.rowMenuWrap} data-client-row-menu>
                      <button className={styles.rowMenuBtn} type="button" aria-label={`Ações de ${r.cliente}`} aria-haspopup="menu" aria-expanded={aberto} onClick={(e) => { e.stopPropagation(); setMenuId(aberto ? null : menuKey); }}>⋮</button>
                      {aberto && <div className={styles.rowMenu} role="menu">
                        <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); abrirRecebivel(r, "finance"); }}>Abrir financeiro</button>
                        <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); abrirRecebivel(r, "profile"); }}>Perfil</button>
                        <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); abrirRecebivel(r, "process"); }}>Processo</button>
                      </div>}
                    </div></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>}
      </> : <>
        <header className={styles.cardHead}>
          <div>
            <div className={styles.cardTitleLine}><span className={styles.cardTitle}>{FUNIL_CLIENTE_LABEL[bucket]}</span><span className={styles.cardCount}>{total(bucket)} {total(bucket) === 1 ? "cliente" : "clientes"}</span></div>
            <div className={styles.cardSub}>{visiveis.length} nesta página</div>
          </div>
          <div className={styles.cardTools}>
            <span className={styles.orderLabel}>Ordenar por</span>
            <label className={styles.smallSelect}>
              <select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as SortMode)} aria-label="Ordenar clientes do financeiro">
                <option value="venc">Vencimento mais próximo</option><option value="saldo">Maior saldo em aberto</option><option value="az">Nome A-Z</option><option value="za">Nome Z-A</option>
              </select>
              <Svg d={ICON.chevron} />
            </label>
          </div>
        </header>
        <div className={styles.funilNote}>{FUNIL_NOTA[bucket]}</div>

        {carregando ? <div className={styles.loadingState}>Carregando financeiro...</div>
          : erro && itens.length === 0 ? <div className={styles.emptyState} role="alert"><Svg d={ICON.empty} /><strong>Não foi possível carregar o Financeiro.</strong><span>{erro}</span><button className={styles.clearBtn} style={{ margin: "12px auto 0" }} type="button" onClick={() => { setCarregando(true); void carregar(); }}>Tentar novamente</button></div>
          : visiveis.length === 0 ? <div className={styles.emptyState}><Svg d={ICON.empty} /><strong>Nenhuma cliente neste funil.</strong><span>Ajuste a busca ou escolha outro funil.</span></div>
          : <div className={styles.tableWrap}>
              <table className={styles.table}>
                <colgroup><col className={styles.finClientCol} /><col className={styles.finSellerCol} /><col className={styles.finCampaignCol} /><col className={styles.finDueCol} /><col className={styles.finProgressCol} /><col className={styles.finBalanceCol} /><col className={styles.finStatusCol} /><col className={styles.actionsCol} /></colgroup>
                <thead><tr><th>Cliente</th><th>Vendedora</th><th>Campanha</th><th>Próx. venc.</th><th>Progresso</th><th>Saldo aberto</th><th>Status</th><th className={styles.center}>Ações</th></tr></thead>
                <tbody>{visiveis.map((r) => {
                  const pct = r.parcelasTotal ? Math.round((r.parcelasPagas / r.parcelasTotal) * 100) : 0;
                  const aberto = menuId === r.clienteId;
                  return <tr key={r.clienteId} onClick={() => abrir(r)}>
                    <td><button type="button" className={`${styles.nameBtn} ${styles.clientCell}`} onClick={(e) => { e.stopPropagation(); abrir(r); }} aria-label={`Abrir ${r.nome} no Financeiro`}>
                      <div className={styles.clientAvatar} aria-hidden="true">{iniciais(r.nome)}</div>
                      <div className={styles.clientMeta}><div className={styles.clientName}>{r.nome}</div>{r.quitado ? <span className={styles.quitado}>Quitado</span> : <div className={styles.clientCpf}>{r.cpf ? formatarCpf(r.cpf) : "CPF não informado"}</div>}</div>
                    </button></td>
                    <td>{r.vendedora || <span className={styles.dash}>—</span>}</td>
                    <td>{r.campanha || <span className={styles.dash}>—</span>}</td>
                    <td className={styles.mono}>{dataBr(r.proximoVencimento)}</td>
                    <td><div className={styles.progressTrack} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.parcelasPagas} de ${r.parcelasTotal} parcelas pagas`}><div className={styles.progressFill} style={{ width: `${pct}%` }} /></div><div className={styles.progressText}>{r.parcelasPagas} / {r.parcelasTotal}{r.vencidas ? ` · ${r.vencidas} vencida(s)` : ""}</div></td>
                    <td className={`${styles.mono} ${styles.strong}`}>{formatarMoeda(r.saldoAReceber)}</td>
                    <td><span className={`${styles.statusPill} ${bucketClass(r.bucket)}`}><span className={styles.statusDot} />{r.aguardandoValidacao > 0 && r.bucket === "aguardando_conferencia" ? `${r.aguardandoValidacao} comprovante(s)` : FUNIL_CLIENTE_LABEL[r.bucket]}</span></td>
                    <td className={styles.center}><div className={styles.rowMenuWrap} data-client-row-menu>
                      <button className={styles.rowMenuBtn} type="button" aria-label={`Ações de ${r.nome}`} aria-haspopup="menu" aria-expanded={aberto} onClick={(e) => { e.stopPropagation(); setMenuId(aberto ? null : r.clienteId); }}>⋮</button>
                      {aberto && <div className={styles.rowMenu} role="menu">
                        <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); abrir(r, "finance"); }}>{r.aguardandoValidacao > 0 ? "Analisar comprovante" : "Abrir financeiro"}</button>
                        <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); abrir(r, "profile"); }}>Perfil</button>
                        <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); abrir(r, "process"); }}>Processo</button>
                      </div>}
                    </div></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>}
      </>}
    </section>

    <div style={{ marginTop: 10, textAlign: "right" }}>
      <a href="/admin/financeiro/avancado" className={styles.cardSub} style={{ textDecoration: "underline" }}>Ferramenta interna transitória — recebíveis em lote e conciliação bancária →</a>
    </div>

    {drawer && <ClienteDrawer key={drawer.id} clienteId={drawer.id} cliente={clientesCompletos.find((c) => c.id === drawer.id) ?? null} abaInicial={drawer.aba}
      onClose={() => setDrawer(null)} onChanged={() => { void carregar(); if (bucket === "recebidos") void carregarRecebidos(); }} />}
  </div>;
}
