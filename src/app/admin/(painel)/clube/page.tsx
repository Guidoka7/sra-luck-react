"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ChevronRight,
  Gift,
  PackageCheck,
  Pause,
  Pencil,
  Play,
  Settings2,
  Share2,
  Star,
  Target,
  Ticket,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";
import { ImagemPremio } from "@/components/cliente/clube/ClubeUi";
import styles from "./clube.module.css";

type Pessoa = { id: string; nome_completo: string; telefone: string | null; cpf: string | null } | null;
type StatusIndicacao = "enviada" | "qualificada" | "venda" | "invalidada";
interface Indicacao {
  id: string; nome_indicado: string; telefone_indicado: string | null; status: StatusIndicacao; pontos_creditados: number;
  created_at: string; observacao?: string | null; indicado_cliente_id?: string | null; indicador: Pessoa; indicado: Pessoa;
}
interface Voucher {
  id: string; cliente_id: string; beneficio_key: string; status: string; origem: string; created_at: string;
  solicitado_em?: string | null; arquivo_disponivel: boolean; arquivo_anexado_em?: string | null; cliente: Pessoa;
}
interface Config { pontosPrimeiraParcela: number; pontosParcelaEmDia: number; pontosIndicacao: number }
interface Recompensa {
  id: string; titulo: string; descricao?: string | null; categoria?: string | null; pontos: number;
  estoque?: number | null; ativo: boolean; imagem_url?: string | null; ordem?: number | null;
  icone_key?: string | null; instrucoes_pos_resgate?: string | null; excluido_em?: string | null;
}
interface Resgate {
  id: string; cliente_id: string; recompensa_id: string; pontos: number; status: string; created_at: string;
  cliente: Pessoa; recompensa: Recompensa | null;
}
interface MetricasClube {
  clientesClube: number;
  missoesConcluidasMes: number;
  indicacoesAprovadas: number;
  beneficiosResgatados: number;
  resgatesPendentes: number;
  missoesPorTipo: { primeiraParcela: number; parcelaEmDia: number; indicacao: number; resgate: number };
}
interface ClubeOverview {
  config: Config;
  indicacoes: Indicacao[];
  vouchers: Voucher[];
  recompensas: Recompensa[];
  resgates: Resgate[];
  metricas: MetricasClube;
}
type AbaClube = "painel" | "beneficios" | "indicacoes" | "vouchers" | "resgates" | "pontuacao";

const STATUS: Record<StatusIndicacao, { rotulo: string; kind: ZipKind }> = {
  enviada: { rotulo: "Enviada", kind: "neutral" },
  qualificada: { rotulo: "Em conversa", kind: "warn" },
  venda: { rotulo: "Fechou", kind: "ok" },
  invalidada: { rotulo: "Não fechou", kind: "bad" },
};

const cartao: CSSProperties = { border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden", boxShadow: "var(--panel-shadow)" };
const cabecalhoTabela: CSSProperties = { fontSize: 8.2, fontWeight: 700, letterSpacing: ".13em", textTransform: "uppercase", color: "var(--rose)" };
const botao = (primario = false): CSSProperties => ({ height: 30, padding: "0 12px", borderRadius: 9, border: `1px solid ${primario ? "var(--bg)" : "var(--line)"}`, background: primario ? "var(--bg)" : "var(--s0)", color: primario ? "var(--on-accent)" : "var(--ink)", fontSize: 11, fontWeight: 700, cursor: "pointer" });
const campo: CSSProperties = { height: 34, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", fontSize: 12, padding: "0 10px", width: "100%" };

function data(iso?: string | null) { return iso ? new Date(iso).toLocaleDateString("pt-BR") : "—"; }
function whatsapp(tel?: string | null) { const d = (tel ?? "").replace(/\D/g, ""); return d ? `https://wa.me/${d.length <= 11 ? `55${d}` : d}` : null; }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store", ...init });
  const dados = await r.json().catch(() => ({})) as T & { erro?: string };
  if (!r.ok) throw new Error(dados.erro ?? "Não foi possível concluir a operação.");
  return dados;
}

export default function ClubeAdminPage() {
  const [aba, setAba] = useState<AbaClube>("painel");
  const [dados, setDados] = useState<ClubeOverview | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<"abertas" | "fecharam" | "premiadas" | "todas">("abertas");
  const [editando, setEditando] = useState<Indicacao | null>(null);

  const carregar = useCallback(async () => {
    try { setDados(await api("/api/admin/credit-ops/club/overview")); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao carregar o Clube."); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const indicacoes = useMemo(() => (dados?.indicacoes ?? []).filter((i) =>
    filtro === "todas" ? true
    : filtro === "abertas" ? i.status === "enviada" || i.status === "qualificada"
    : filtro === "fecharam" ? i.status === "venda" && !i.pontos_creditados
    : i.pontos_creditados > 0), [dados, filtro]);
  const vouchersPendentes = (dados?.vouchers ?? []).filter((v) => v.solicitado_em && !v.arquivo_disponivel && v.status === "disponivel").length;

  const abas: Array<{ id: Exclude<AbaClube, "painel">; rotulo: string; n: number }> = [
    { id: "beneficios", rotulo: "Benefícios", n: (dados?.recompensas ?? []).filter((r) => r.ativo).length },
    { id: "indicacoes", rotulo: "Indicações", n: (dados?.indicacoes ?? []).filter((i) => i.status === "enviada" || i.status === "qualificada").length },
    { id: "vouchers", rotulo: "Vouchers", n: vouchersPendentes },
    { id: "resgates", rotulo: "Resgates", n: dados?.metricas?.resgatesPendentes ?? 0 },
    { id: "pontuacao", rotulo: "Pontuação", n: 0 },
  ];

  if (aba === "painel") {
    return <ClubeDashboard dados={dados} carregando={carregando} onOpen={setAba} />;
  }

  return <div className={["zip-admin", styles.page].join(" ")} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
    <div style={{ flex: "1 1 720px", minWidth: 0 }}>
      <div style={{ padding: "2px 2px 14px" }}>
        <button type="button" onClick={() => setAba("painel")} className={styles.backButton}><ArrowLeft size={14} /> Voltar ao Clube</button>
        <div style={{ marginTop: 10 }}>
          <div className={styles.detailEyebrow}>Clube Sra. Luck</div>
          <h1 style={{ fontSize: 27, marginTop: 3 }}>Gestão do Clube</h1>
          <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--soft)", maxWidth: "80ch" }}>Gerencie benefícios, indicações, vouchers, resgates e regras de pontuação sem sair do painel.</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 5, padding: 3, borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", width: "fit-content", maxWidth: "100%", marginBottom: 12 }}>
        {abas.map((a) => { const on = aba === a.id; return <button key={a.id} onClick={() => setAba(a.id)} style={{ height: 30, padding: "0 12px", borderRadius: 9, border: on ? "1px solid var(--line)" : "1px solid transparent", background: on ? "var(--s0)" : "transparent", color: on ? "var(--bg)" : "var(--soft)", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          {a.rotulo}{a.n > 0 && <span style={{ ...zipChip("rose"), padding: "1px 6px" }}>{a.n}</span>}
        </button>; })}
      </div>

      {carregando || !dados ? <div style={{ padding: 40, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Carregando…</div> : <>
        {aba === "indicacoes" && <div style={cartao}>
          <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--line)", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {([["abertas", "Em aberto"], ["fecharam", "Fecharam · aguardando 1ª parcela"], ["premiadas", "Premiadas"], ["todas", "Todas"]] as const).map(([id, r]) =>
                <button key={id} onClick={() => setFiltro(id)} style={{ ...botao(filtro === id), height: 28 }}>{r}</button>)}
            </div>
            <span style={{ fontSize: 11, color: "var(--soft)" }}>Pontos por indicação: <b>{dados.config.pontosIndicacao}</b> (após fechar e pagar a 1ª parcela)</span>
          </div>
          <div style={{ overflow: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "92px minmax(170px,1.2fr) minmax(160px,1fr) minmax(150px,1fr) 110px 70px 92px", gap: 8, minWidth: 900, padding: "8px 14px", background: "var(--s1)", borderBottom: "1px solid var(--line)" }}>
              {["Data", "Indicada", "Indicou", "Cliente vinculada", "Status", "Pontos", "Ação"].map((h) => <div key={h} style={cabecalhoTabela}>{h}</div>)}
            </div>
            {indicacoes.length === 0 ? <div style={{ padding: "28px 14px", textAlign: "center", fontSize: 11.5, color: "var(--soft)" }}>Nenhuma indicação neste filtro.</div> : indicacoes.map((i) => {
              const link = whatsapp(i.telefone_indicado);
              return <div key={i.id} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "92px minmax(170px,1.2fr) minmax(160px,1fr) minmax(150px,1fr) 110px 70px 92px", gap: 8, minWidth: 900, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line2)" }}>
                <div style={{ fontSize: 10.5, color: "var(--soft)" }}>{data(i.created_at)}</div>
                <div><div style={{ fontSize: 12, fontWeight: 700 }}>{i.nome_indicado}</div>{link ? <a href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10.5, color: "var(--ok)", fontWeight: 700 }}>WhatsApp ↗</a> : <span style={{ fontSize: 10.5, color: "var(--soft)" }}>sem telefone</span>}</div>
                <div style={{ fontSize: 11.5 }}>{i.indicador?.nome_completo ?? "—"}</div>
                <div style={{ fontSize: 11.5, color: i.indicado ? "var(--ink)" : "var(--soft)" }}>{i.indicado?.nome_completo ?? "Não vinculada"}</div>
                <span style={zipChip(STATUS[i.status].kind)}>{STATUS[i.status].rotulo}</span>
                <div style={{ fontSize: 12, fontWeight: 800, color: i.pontos_creditados ? "var(--ok)" : "var(--soft)" }}>{i.pontos_creditados ? `+${i.pontos_creditados}` : "—"}</div>
                <button onClick={() => setEditando(i)} style={botao(true)}>{i.pontos_creditados ? "Detalhes" : "Atualizar"}</button>
              </div>;
            })}
          </div>
        </div>}

        {aba === "beneficios" && <PainelBeneficios recompensas={dados.recompensas} onAtualizado={carregar} />}
        {aba === "vouchers" && <PainelVouchers vouchers={dados.vouchers} onAtualizado={carregar} />}
        {aba === "resgates" && <PainelResgates resgates={dados.resgates} onAtualizado={carregar} />}
        {aba === "pontuacao" && <PainelPontuacao config={dados.config} onSalvo={carregar} />}
      </>}
    </div>

    {editando && <EditarIndicacao indicacao={editando} onFechar={() => setEditando(null)} onSalvo={async () => { setEditando(null); await carregar(); }} />}
  </div>;
}

function EditarIndicacao({ indicacao, onFechar, onSalvo }: { indicacao: Indicacao; onFechar: () => void; onSalvo: () => Promise<void> }) {
  const [status, setStatus] = useState<StatusIndicacao>(indicacao.status);
  const [cliente, setCliente] = useState<Pessoa>(indicacao.indicado);
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<NonNullable<Pessoa>[]>([]);
  const [observacao, setObservacao] = useState(indicacao.observacao ?? "");
  const [salvando, setSalvando] = useState(false);
  const creditada = indicacao.pontos_creditados > 0;

  useEffect(() => {
    if (busca.trim().length < 2) { setResultados([]); return; }
    const t = window.setTimeout(() => {
      api<{ clientes: NonNullable<Pessoa>[] }>(`/api/admin/credit-ops/club/clientes?busca=${encodeURIComponent(busca.trim())}`)
        .then((r) => setResultados(r.clientes.filter((c) => c.id !== indicacao.indicador?.id)))
        .catch(() => setResultados([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [busca, indicacao.indicador?.id]);

  async function salvar() {
    setSalvando(true);
    try {
      const r = await api<{ indicacao: { pontos_creditados: number } }>(`/api/admin/credit-ops/club/referrals/${indicacao.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, indicadoClienteId: cliente?.id ?? null, observacao }),
      });
      toast.success(r.indicacao.pontos_creditados > 0 && !creditada ? "Indicação salva e pontos creditados à cliente." : status === "venda" ? "Salvo. Os pontos entram quando a indicada pagar a 1ª parcela." : "Indicação atualizada.");
      await onSalvo();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setSalvando(false); }
  }

  return <aside className="zip-animate-slide-in" style={{ width: 380, flex: "none", position: "sticky", top: 16, border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", overflow: "hidden" }}>
    <div style={{ padding: "14px 15px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 12 }}>
      <div><div style={cabecalhoTabela}>Indicação</div><h2 style={{ fontSize: 17, marginTop: 4 }}>{indicacao.nome_indicado}</h2><div style={{ fontSize: 11, color: "var(--soft)", marginTop: 3 }}>Indicada por {indicacao.indicador?.nome_completo ?? "—"} em {data(indicacao.created_at)}</div></div>
      <button onClick={onFechar} style={{ height: 28, width: 28, borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)" }}>✕</button>
    </div>
    <div style={{ padding: "13px 15px", display: "grid", gap: 12 }}>
      {creditada && <div style={{ border: "1px solid var(--okbg)", background: "var(--okbg)", borderRadius: 10, padding: 10, fontSize: 11.5, lineHeight: 1.5 }}>Esta indicação já gerou <b>+{indicacao.pontos_creditados} pontos</b> e não pode mais mudar de status.</div>}
      <label style={{ display: "grid", gap: 5, fontSize: 10.5, fontWeight: 700, color: "var(--soft)" }}>Status
        <select value={status} disabled={creditada} onChange={(e) => setStatus(e.target.value as StatusIndicacao)} style={campo}>
          {(Object.keys(STATUS) as StatusIndicacao[]).map((s) => <option key={s} value={s}>{STATUS[s].rotulo}</option>)}
        </select>
      </label>
      <div style={{ display: "grid", gap: 5 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--soft)" }}>Cliente indicada (cadastro dela) {status === "venda" && <span style={{ color: "var(--bad)" }}>· obrigatório para “Fechou”</span>}</span>
        {cliente ? <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", background: "var(--s1)" }}>
          <div><div style={{ fontSize: 12, fontWeight: 700 }}>{cliente.nome_completo}</div><div style={{ fontSize: 10.5, color: "var(--soft)" }}>{cliente.cpf ?? cliente.telefone ?? ""}</div></div>
          {!creditada && <button onClick={() => setCliente(null)} style={botao()}>Trocar</button>}
        </div> : <>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, CPF ou telefone…" style={campo} />
          {resultados.map((c) => <button key={c.id} onClick={() => { setCliente(c); setBusca(""); setResultados([]); }} style={{ textAlign: "left", border: "1px solid var(--line)", borderRadius: 9, padding: "7px 10px", background: "var(--s0)", color: "var(--ink)" }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{c.nome_completo}</div><div style={{ fontSize: 10.5, color: "var(--soft)" }}>{c.cpf ?? ""} {c.telefone ?? ""}</div>
          </button>)}
        </>}
      </div>
      <label style={{ display: "grid", gap: 5, fontSize: 10.5, fontWeight: 700, color: "var(--soft)" }}>Observação interna
        <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} maxLength={500} style={{ ...campo, height: "auto", padding: 10, resize: "vertical" }} />
      </label>
      <div style={{ fontSize: 10.8, color: "var(--soft)", lineHeight: 1.5, background: "var(--s1)", borderRadius: 9, padding: 10 }}>Ao marcar <b>Fechou</b> com a cliente vinculada, os pontos são creditados a quem indicou assim que a indicada tiver a <b>1ª parcela paga</b> — na hora, se já estiver paga. Crédito único e registrado em auditoria.</div>
      <button onClick={() => void salvar()} disabled={salvando || (status === "venda" && !cliente)} style={{ ...botao(true), height: 36, opacity: salvando || (status === "venda" && !cliente) ? 0.5 : 1 }}>{salvando ? "Salvando…" : "Salvar"}</button>
    </div>
  </aside>;
}

function PainelVouchers({ vouchers, onAtualizado }: { vouchers: Voucher[]; onAtualizado: () => Promise<void> }) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const ordenados = [...vouchers].sort((a, b) => Number(Boolean(b.solicitado_em && !b.arquivo_disponivel)) - Number(Boolean(a.solicitado_em && !a.arquivo_disponivel)));

  async function anexar(v: Voucher, arquivo: File | undefined) {
    if (!arquivo) return;
    setEnviando(v.id);
    try {
      const form = new FormData(); form.append("arquivo", arquivo);
      await api(`/api/admin/credit-ops/club/vouchers/${v.id}/arquivo`, { method: "POST", body: form });
      toast.success("Voucher anexado e liberado para a cliente.");
      await onAtualizado();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível anexar."); }
    finally { setEnviando(null); }
  }
  async function ver(v: Voucher) {
    try { const { url } = await api<{ url: string }>(`/api/admin/credit-ops/club/vouchers/${v.id}/arquivo`); window.open(url, "_blank", "noopener"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível abrir."); }
  }

  return <div style={cartao}>
    <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--line)", fontSize: 11.5, color: "var(--soft)" }}>O voucher de consulta é liberado quando a cliente paga a 1ª parcela. Anexe o arquivo (PDF ou imagem, até 10 MB) para ela visualizar no app.</div>
    <div style={{ overflow: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.3fr) 110px 110px 120px 220px", gap: 8, minWidth: 780, padding: "8px 14px", background: "var(--s1)", borderBottom: "1px solid var(--line)" }}>
        {["Cliente", "Liberado em", "Solicitado em", "Situação", "Arquivo"].map((h) => <div key={h} style={cabecalhoTabela}>{h}</div>)}
      </div>
      {ordenados.length === 0 ? <div style={{ padding: "28px 14px", textAlign: "center", fontSize: 11.5, color: "var(--soft)" }}>Nenhum voucher liberado ainda.</div> : ordenados.map((v) => {
        const situacao: [string, ZipKind] = v.status === "utilizado" ? ["Utilizado", "neutral"] : v.status === "cancelado" ? ["Cancelado", "bad"] : v.arquivo_disponivel ? ["Liberado", "ok"] : v.solicitado_em ? ["Aguardando arquivo", "warn"] : ["Disponível", "rose"];
        return <div key={v.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.3fr) 110px 110px 120px 220px", gap: 8, minWidth: 780, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line2)" }}>
          <div><div style={{ fontSize: 12, fontWeight: 700 }}>{v.cliente?.nome_completo ?? "—"}</div><div style={{ fontSize: 10.5, color: "var(--soft)" }}>{v.cliente?.telefone ?? ""}</div></div>
          <div style={{ fontSize: 10.5, color: "var(--soft)" }}>{data(v.created_at)}</div>
          <div style={{ fontSize: 10.5, color: v.solicitado_em ? "var(--ink)" : "var(--soft)" }}>{data(v.solicitado_em)}</div>
          <span style={zipChip(situacao[1])}>{situacao[0]}</span>
          <div style={{ display: "flex", gap: 6 }}>
            {v.arquivo_disponivel && <button onClick={() => void ver(v)} style={botao()}>Ver</button>}
            {v.status !== "cancelado" && <label style={{ ...botao(!v.arquivo_disponivel), display: "inline-flex", alignItems: "center", opacity: enviando === v.id ? 0.6 : 1 }}>
              {enviando === v.id ? "Enviando…" : v.arquivo_disponivel ? "Substituir" : "Anexar voucher"}
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden disabled={enviando === v.id} onChange={(e) => { void anexar(v, e.target.files?.[0]); e.target.value = ""; }} />
            </label>}
          </div>
        </div>;
      })}
    </div>
  </div>;
}

function PainelPontuacao({ config, onSalvo }: { config: Config; onSalvo: () => Promise<void> }) {
  const [valores, setValores] = useState(config);
  const [salvando, setSalvando] = useState(false);
  const campos: Array<[keyof Config, string, string]> = [
    ["pontosParcelaEmDia", "Parcela paga em dia", "Por parcela paga até o vencimento."],
    ["pontosIndicacao", "Indicação que fechou", "Para quem indicou, quando a amiga fecha e paga a 1ª parcela."],
    ["pontosPrimeiraParcela", "1ª parcela paga", "Bônus único, junto com o voucher de consulta."],
  ];
  async function salvar() {
    setSalvando(true);
    try {
      await api("/api/admin/credit-ops/club/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valores) });
      toast.success("Pontuação atualizada. Vale para os próximos créditos.");
      await onSalvo();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setSalvando(false); }
  }
  return <div style={{ ...cartao, padding: 16, maxWidth: 560 }}>
    <div style={{ display: "grid", gap: 12 }}>
      {campos.map(([k, rotulo, ajuda]) => <label key={k} style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 10, alignItems: "center" }}>
        <span><span style={{ display: "block", fontSize: 12.5, fontWeight: 700 }}>{rotulo}</span><span style={{ display: "block", fontSize: 10.8, color: "var(--soft)", marginTop: 2 }}>{ajuda}</span></span>
        <input type="number" min={0} max={100000} step={1} value={valores[k]} onChange={(e) => setValores((v) => ({ ...v, [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} style={{ ...campo, textAlign: "right", fontWeight: 700 }} />
      </label>)}
    </div>
    <div style={{ fontSize: 10.8, color: "var(--soft)", marginTop: 12 }}>Alterações não mudam pontos já creditados.</div>
    <button onClick={() => void salvar()} disabled={salvando} style={{ ...botao(true), height: 36, marginTop: 12 }}>{salvando ? "Salvando…" : "Salvar pontuação"}</button>
  </div>;
}

function ClubeDashboard({ dados, carregando, onOpen }: { dados: ClubeOverview | null; carregando: boolean; onOpen: (aba: AbaClube) => void }) {
  if (carregando || !dados) {
    return <div className={["zip-admin", styles.page].join(" ")}><div className={styles.loading}>{carregando ? "Carregando Clube…" : "Não foi possível carregar o Clube."}</div></div>;
  }

  const abertas = dados.indicacoes.filter((i) => i.status === "enviada" || i.status === "qualificada").length;
  const vouchersPendentes = dados.vouchers.filter((v) => v.solicitado_em && !v.arquivo_disponivel && v.status === "disponivel").length;
  const recompensasAtivas = dados.recompensas.filter((r) => r.ativo);
  const estoqueBaixo = recompensasAtivas.filter((r) => r.estoque !== null && r.estoque !== undefined && r.estoque <= 5).length;
  const base = Math.max(1, dados.metricas.clientesClube);
  const progresso = (n: number) => Math.max(0, Math.min(100, Math.round((n / base) * 100)));

  const kpis = [
    { label: "Clientes no clube", value: dados.metricas.clientesClube, icon: <Users size={21} />, chip: "Base atual", meta: "clientes com saldo no Clube" },
    { label: "Missões concluídas no mês", value: dados.metricas.missoesConcluidasMes, icon: <Target size={21} />, chip: "Mês atual", meta: "créditos e resgates válidos" },
    { label: "Indicações aprovadas", value: dados.metricas.indicacoesAprovadas, icon: <Share2 size={21} />, chip: "Confirmadas", meta: "indicações marcadas como fechadas" },
    { label: "Benefícios resgatados", value: dados.metricas.beneficiosResgatados, icon: <Gift size={21} />, chip: "Acumulado", meta: "resgates válidos no catálogo" },
  ];

  const missoes = [
    {
      titulo: "Primeira parcela paga",
      descricao: "Libera o bônus inicial e o voucher de consulta.",
      pontos: "+" + dados.config.pontosPrimeiraParcela + " pts",
      concluidas: dados.metricas.missoesPorTipo.primeiraParcela,
      icon: <CalendarDays size={17} />,
    },
    {
      titulo: "Parcela paga em dia",
      descricao: "Premia pagamentos confirmados até o vencimento.",
      pontos: "+" + dados.config.pontosParcelaEmDia + " pts",
      concluidas: dados.metricas.missoesPorTipo.parcelaEmDia,
      icon: <Star size={17} />,
    },
    {
      titulo: "Indicar uma amiga",
      descricao: "Crédito após a indicada fechar e pagar a 1ª parcela.",
      pontos: "+" + dados.config.pontosIndicacao + " pts",
      concluidas: dados.metricas.missoesPorTipo.indicacao,
      icon: <Users size={17} />,
    },
    {
      titulo: "Resgatar um benefício",
      descricao: "Trocas realizadas com pontos no catálogo do Clube.",
      pontos: "resgate",
      concluidas: dados.metricas.missoesPorTipo.resgate,
      icon: <Gift size={17} />,
    },
  ];

  const campanhas = [
    { titulo: "Indique e ganhe", descricao: "Cada indicação elegível rende +" + dados.config.pontosIndicacao + " pontos.", cor: "var(--ok)" },
    { titulo: "Parcela em dia", descricao: "Pagamento no prazo rende +" + dados.config.pontosParcelaEmDia + " pontos.", cor: "var(--rose)" },
    { titulo: "Bônus da primeira parcela", descricao: "Primeiro pagamento rende +" + dados.config.pontosPrimeiraParcela + " pontos e voucher.", cor: "var(--soft)" },
  ];

  const alertas = [
    {
      titulo: abertas + " indicações em análise",
      descricao: abertas ? "Aguardando validação da equipe." : "Nenhuma indicação aguardando análise.",
      icon: <Share2 size={14} />,
      warn: abertas > 0,
      destino: "indicacoes" as const,
    },
    {
      titulo: vouchersPendentes + " vouchers aguardando arquivo",
      descricao: vouchersPendentes ? "Clientes já solicitaram a liberação." : "Nenhum voucher aguardando arquivo.",
      icon: <Ticket size={14} />,
      warn: vouchersPendentes > 0,
      destino: "vouchers" as const,
    },
    {
      titulo: dados.metricas.resgatesPendentes + " resgates em processamento",
      descricao: dados.metricas.resgatesPendentes ? "Solicitações ainda não concluídas." : "Fila de resgates sem pendências.",
      icon: <PackageCheck size={14} />,
      warn: dados.metricas.resgatesPendentes > 0,
      destino: "resgates" as const,
    },
    {
      titulo: estoqueBaixo + " benefícios com estoque baixo",
      descricao: estoqueBaixo ? "Revise itens com 5 unidades ou menos." : "Estoque do catálogo sem alerta.",
      icon: <AlertTriangle size={14} />,
      warn: estoqueBaixo > 0,
      destino: "beneficios" as const,
    },
  ];

  const acoes = [
    { label: "Indicações", icon: <UserPlus size={18} />, destino: "indicacoes" as const, primary: true },
    { label: "Vouchers", icon: <Ticket size={18} />, destino: "vouchers" as const, primary: false },
    { label: "Ver resgates", icon: <BarChart3 size={18} />, destino: "resgates" as const, primary: false },
    { label: "Configurar regras", icon: <Settings2 size={18} />, destino: "pontuacao" as const, primary: false },
  ];

  return <div className={["zip-admin", styles.page].join(" ")}>
    <section className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>Bem-vinda, Admin!</div>
        <h1>Clube</h1>
        <p>Acompanhe os benefícios, engajamento, missões e indicações das clientes.</p>
      </div>
      <div className={styles.quote}>Relacionamentos<br />que transformam<br />mais que jornadas.<span className={styles.quoteLine} /></div>
    </section>

    <section className={styles.kpiGrid}>
      {kpis.map((k) => <article key={k.label} className={styles.kpiCard}>
        <div className={styles.kpiIcon}>{k.icon}</div>
        <div className={styles.kpiLabel}>{k.label}</div>
        <div className={styles.kpiValueWrap}>
          <div className={styles.kpiValue}>{k.value.toLocaleString("pt-BR")}</div>
          <div className={styles.kpiMeta}><span className={styles.kpiChip}>{k.chip}</span><span>{k.meta}</span></div>
        </div>
      </article>)}
    </section>

    <section className={styles.topGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Missões do mês</h2>
          <button type="button" className={styles.panelLink} onClick={() => onOpen("pontuacao")}>Ver todas <ChevronRight size={13} /></button>
        </div>
        <div className={styles.missionList}>
          {missoes.map((m) => <div key={m.titulo} className={styles.missionRow}>
            <div className={styles.missionIcon}>{m.icon}</div>
            <div><div className={styles.missionTitle}>{m.titulo}</div><div className={styles.missionDesc}>{m.descricao}</div></div>
            <div className={styles.missionPoints}>{m.pontos}</div>
            <div className={styles.missionProgress}>
              <div className={styles.missionProgressLabel}>{m.concluidas.toLocaleString("pt-BR")} clientes concluíram</div>
              <div className={styles.progressTrack}><span className={styles.progressFill} style={{ width: progresso(m.concluidas) + "%" }} /></div>
            </div>
          </div>)}
        </div>
      </article>

      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Benefícios e parceiros</h2>
          <button type="button" className={styles.panelLink} onClick={() => onOpen("beneficios")}>Ver todos <ChevronRight size={13} /></button>
        </div>
        {recompensasAtivas.length === 0 ? <div className={styles.empty}>Nenhum benefício ativo no catálogo.</div> : <div className={styles.benefitsGrid}>
          {recompensasAtivas.slice(0, 4).map((r) => <button type="button" key={r.id} onClick={() => onOpen("beneficios")} className={styles.benefitProductCard}>
            <span className={styles.benefitThumb}><ImagemPremio recompensa={r} /></span>
            <span className={styles.benefitProductCopy}>
              <span className={styles.benefitTitle}>{r.titulo}</span>
              <span className={styles.benefitDesc}>{r.categoria || "Benefício"} · {r.pontos.toLocaleString("pt-BR")} pts</span>
            </span>
            <ChevronRight size={15} color="var(--rose)" />
          </button>)}
        </div>}
      </article>
    </section>

    <section className={styles.bottomGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Campanhas ativas</h2>
          <button type="button" className={styles.panelLink} onClick={() => onOpen("pontuacao")}>Ver regras <ChevronRight size={13} /></button>
        </div>
        <div className={styles.campaignList}>
          {campanhas.map((c) => <div className={styles.campaignRow} key={c.titulo}>
            <span className={styles.campaignDot} style={{ background: c.cor }} />
            <div><div className={styles.campaignTitle}>{c.titulo}</div><div className={styles.campaignDesc}>{c.descricao}</div></div>
            <span className={styles.statusPill}>Ativa</span>
          </div>)}
        </div>
      </article>

      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Alertas do clube</h2>
          <span className={styles.panelLink}>Atualizado agora</span>
        </div>
        <div className={styles.alertsList}>
          {alertas.map((a) => <button type="button" key={a.titulo} className={styles.alertRow} onClick={() => onOpen(a.destino)} style={{ width: "100%", border: 0, background: "transparent", textAlign: "left", color: "inherit" }}>
            <span className={[styles.alertIcon, a.warn ? styles.alertIconWarn : ""].join(" ")}>{a.icon}</span>
            <span><span className={styles.alertTitle}>{a.titulo}</span><span className={styles.alertDesc}>{a.descricao}</span></span>
            <span className={styles.alertTime}>Abrir</span>
          </button>)}
        </div>
      </article>

      <article className={styles.panel}>
        <div className={styles.panelHeader}><h2>Ações rápidas</h2></div>
        <div className={styles.quickGrid}>
          {acoes.map((a) => <button type="button" key={a.label} onClick={() => onOpen(a.destino)} className={[styles.quickAction, a.primary ? styles.quickPrimary : ""].join(" ")}>
            <span className={styles.quickIcon}>{a.icon}</span>
            <span style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>{a.label}<ChevronRight size={14} /></span>
          </button>)}
        </div>
      </article>
    </section>
  </div>;
}

function PainelBeneficios({ recompensas, onAtualizado }: { recompensas: Recompensa[]; onAtualizado: () => Promise<void> }) {
  type FormCatalogo = { titulo: string; descricao: string; categoria: string; pontos: number; estoque: string; imagemUrl: string; ordem: number; instrucoesPosResgate: string };
  const vazio: FormCatalogo = { titulo: "", descricao: "", categoria: "", pontos: 0, estoque: "", imagemUrl: "", ordem: 0, instrucoesPosResgate: "" };
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Recompensa | null>(null);
  const [form, setForm] = useState<FormCatalogo>(vazio);
  const [ocupado, setOcupado] = useState<string | null>(null);

  function abrirNovo() {
    setEditando(null);
    setForm(vazio);
    setFormAberto(true);
  }

  function abrirEdicao(r: Recompensa) {
    setEditando(r);
    setForm({
      titulo: r.titulo,
      descricao: r.descricao ?? "",
      categoria: r.categoria ?? "",
      pontos: r.pontos,
      estoque: r.estoque === null || r.estoque === undefined ? "" : String(r.estoque),
      imagemUrl: r.imagem_url ?? "",
      ordem: r.ordem ?? 0,
      instrucoesPosResgate: r.instrucoes_pos_resgate ?? "",
    });
    setFormAberto(true);
  }

  function fecharForm() {
    setFormAberto(false);
    setEditando(null);
    setForm(vazio);
  }

  async function salvar() {
    if (form.titulo.trim().length < 2 || form.pontos <= 0) {
      toast.error("Informe o nome do benefício e uma pontuação maior que zero.");
      return;
    }
    const chave = editando?.id ?? "novo";
    setOcupado(chave);
    try {
      await api(editando ? `/api/admin/credit-ops/rewards/${encodeURIComponent(editando.id)}` : "/api/admin/credit-ops/rewards", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: form.titulo.trim(),
          descricao: form.descricao.trim() || null,
          categoria: form.categoria.trim() || null,
          pontos: Math.max(1, Math.floor(form.pontos)),
          estoque: form.estoque === "" ? null : Math.max(0, Math.floor(Number(form.estoque) || 0)),
          imagemUrl: form.imagemUrl.trim() || null,
          ordem: Math.floor(form.ordem || 0),
          instrucoesPosResgate: form.instrucoesPosResgate.trim() || null,
          ativo: editando?.ativo ?? true,
        }),
      });
      toast.success(editando ? "Benefício atualizado no app das clientes." : "Benefício criado no catálogo.");
      fecharForm();
      await onAtualizado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o benefício.");
    } finally {
      setOcupado(null);
    }
  }

  async function alternar(r: Recompensa) {
    setOcupado(r.id);
    try {
      await api(`/api/admin/credit-ops/rewards/${encodeURIComponent(r.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: !r.ativo }),
      });
      toast.success(r.ativo ? "Benefício pausado e ocultado do app." : "Benefício reativado no app.");
      await onAtualizado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar o benefício.");
    } finally {
      setOcupado(null);
    }
  }

  async function excluir(r: Recompensa) {
    if (!window.confirm(`Excluir “${r.titulo}” do catálogo? Ele deixará de aparecer no app, mas o histórico de resgates será preservado.`)) return;
    setOcupado(r.id);
    try {
      await api(`/api/admin/credit-ops/rewards/${encodeURIComponent(r.id)}`, { method: "DELETE" });
      toast.success("Benefício excluído do catálogo.");
      if (editando?.id === r.id) fecharForm();
      await onAtualizado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir o benefício.");
    } finally {
      setOcupado(null);
    }
  }

  const preview: Recompensa = {
    id: editando?.id ?? "preview",
    titulo: form.titulo || "Prévia do benefício",
    descricao: form.descricao || null,
    categoria: form.categoria || null,
    pontos: form.pontos || 0,
    estoque: form.estoque === "" ? null : Number(form.estoque),
    ativo: editando?.ativo ?? true,
    imagem_url: form.imagemUrl || null,
    ordem: form.ordem,
  };

  return <div style={cartao}>
    <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
      <div>
        <strong style={{ fontSize: 13 }}>Benefícios e parceiros</strong>
        <div style={{ fontSize: 10.5, color: "var(--soft)", marginTop: 3 }}>Mesmo catálogo, produtos, imagens e ordem exibidos no app das clientes.</div>
      </div>
      <button type="button" style={botao(true)} onClick={() => formAberto ? fecharForm() : abrirNovo()}>{formAberto ? "Fechar editor" : "Novo benefício"}</button>
    </div>

    {formAberto && <div className={styles.catalogEditor}>
      <div className={styles.editorPreview}>
        <div className={styles.editorPreviewImage}><ImagemPremio recompensa={preview} /></div>
        <div className={styles.editorPreviewCopy}>
          <span>Prévia no catálogo</span>
          <strong>{form.titulo || "Nome do benefício"}</strong>
          <small>{form.categoria || "Categoria"} · {(form.pontos || 0).toLocaleString("pt-BR")} pts</small>
        </div>
      </div>
      <div className={styles.editorGrid}>
        <label>Nome<input value={form.titulo} onChange={(e) => setForm((v) => ({ ...v, titulo: e.target.value }))} /></label>
        <label>Categoria<input value={form.categoria} onChange={(e) => setForm((v) => ({ ...v, categoria: e.target.value }))} placeholder="Ex.: Autocuidado" /></label>
        <label>Pontos<input type="number" min={1} value={form.pontos || ""} onChange={(e) => setForm((v) => ({ ...v, pontos: Math.max(0, Number(e.target.value) || 0) }))} /></label>
        <label>Estoque<input type="number" min={0} value={form.estoque} onChange={(e) => setForm((v) => ({ ...v, estoque: e.target.value }))} placeholder="Livre" /></label>
        <label>Ordem<input type="number" value={form.ordem} onChange={(e) => setForm((v) => ({ ...v, ordem: Number(e.target.value) || 0 }))} /></label>
        <label className={styles.editorWide}>URL da imagem<input value={form.imagemUrl} onChange={(e) => setForm((v) => ({ ...v, imagemUrl: e.target.value }))} placeholder="https://..." /></label>
        <label className={styles.editorWide}>Descrição<textarea value={form.descricao} onChange={(e) => setForm((v) => ({ ...v, descricao: e.target.value }))} rows={3} /></label>
        <label className={styles.editorWide}>Orientação após o resgate<textarea value={form.instrucoesPosResgate} onChange={(e) => setForm((v) => ({ ...v, instrucoesPosResgate: e.target.value }))} rows={2} placeholder="Mensagem exibida à cliente após solicitar o prêmio." /></label>
      </div>
      <div className={styles.editorActions}>
        <button type="button" style={botao(false)} onClick={fecharForm}>Cancelar</button>
        <button type="button" style={{ ...botao(true), minWidth: 120 }} disabled={ocupado !== null} onClick={() => void salvar()}>{ocupado ? "Salvando…" : editando ? "Salvar alterações" : "Criar benefício"}</button>
      </div>
    </div>}

    {recompensas.length === 0 ? <div className={styles.empty}>Nenhum benefício cadastrado.</div> : <div className={styles.catalogGrid}>
      {[...recompensas].sort((a, b) => Number(b.ativo) - Number(a.ativo) || (a.ordem ?? 0) - (b.ordem ?? 0) || a.pontos - b.pontos).map((r) => {
        const emAcao = ocupado === r.id;
        return <article key={r.id} className={[styles.rewardCard, !r.ativo ? styles.rewardCardPaused : ""].join(" ")}>
          <div className={styles.rewardImage}>
            <ImagemPremio recompensa={r} />
            {r.categoria && <span className={styles.rewardCategory}>{r.categoria}</span>}
            <span className={styles.rewardPoints}>{r.pontos.toLocaleString("pt-BR")} pts</span>
            <span className={[styles.rewardState, r.ativo ? styles.rewardStateActive : styles.rewardStatePaused].join(" ")}>{r.ativo ? "Ativo no app" : "Pausado"}</span>
          </div>
          <div className={styles.rewardBody}>
            <h3>{r.titulo}</h3>
            <p>{r.descricao || "Benefício disponível no catálogo do Clube."}</p>
            <div className={styles.rewardMeta}><span>{r.estoque === null || r.estoque === undefined ? "Estoque livre" : r.estoque + " em estoque"}</span><span>Ordem {r.ordem ?? 0}</span></div>
            <div className={styles.rewardActions}>
              <button type="button" disabled={emAcao} onClick={() => abrirEdicao(r)}><Pencil size={13} /> Editar</button>
              <button type="button" disabled={emAcao} onClick={() => void alternar(r)}>{r.ativo ? <Pause size={13} /> : <Play size={13} />}{r.ativo ? "Pausar" : "Reativar"}</button>
              <button type="button" className={styles.rewardDelete} disabled={emAcao} onClick={() => void excluir(r)}><Trash2 size={13} /> Excluir</button>
            </div>
          </div>
        </article>;
      })}
    </div>}
  </div>;
}

function PainelResgates({ resgates, onAtualizado }: { resgates: Resgate[]; onAtualizado: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const kind = (status: string): ZipKind => status === "entregue" ? "ok" : status === "cancelado" ? "bad" : status === "solicitado" ? "warn" : "rose";
  const rotulo = (status: string) => ({
    solicitado: "Solicitado",
    aprovado: "Aprovado",
    separacao: "Em separação",
    entregue: "Entregue",
    cancelado: "Cancelado",
  } as Record<string, string>)[status] ?? status;
  const proximos = (status: string): Array<{ status: string; label: string; danger?: boolean }> => {
    if (status === "solicitado") return [{ status: "aprovado", label: "Aprovar" }, { status: "cancelado", label: "Cancelar", danger: true }];
    if (status === "aprovado") return [{ status: "separacao", label: "Em separação" }, { status: "cancelado", label: "Cancelar", danger: true }];
    if (status === "separacao") return [{ status: "entregue", label: "Entregue" }, { status: "cancelado", label: "Cancelar", danger: true }];
    return [];
  };

  async function atualizar(r: Resgate, novoStatus: string) {
    if (novoStatus === "cancelado" && !window.confirm(`Cancelar o resgate de “${r.recompensa?.titulo ?? "Benefício"}”? Os ${r.pontos.toLocaleString("pt-BR")} pontos serão devolvidos à cliente e o estoque será reposto.`)) return;
    setOcupado(r.id);
    try {
      await api(`/api/admin/credit-ops/club/resgates/${encodeURIComponent(r.id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novoStatus }),
      });
      toast.success(novoStatus === "cancelado" ? "Resgate cancelado e pontos devolvidos." : `Resgate atualizado para “${rotulo(novoStatus)}”.`);
      await onAtualizado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível atualizar o resgate.");
    } finally {
      setOcupado(null);
    }
  }

  return <div style={cartao}>
    <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--line)", fontSize: 11.5, color: "var(--soft)" }}>Acompanhe e processe os resgates. Cancelamentos antes da entrega devolvem os pontos automaticamente e recompõem o estoque.</div>
    {resgates.length === 0 ? <div className={styles.empty}>Nenhum resgate registrado ainda.</div> : <div className={styles.redemptionTable}>
      <div className={styles.redemptionHead}><span>Cliente</span><span>Benefício</span><span>Pontos</span><span>Data</span><span>Status</span><span>Ações</span></div>
      {resgates.map((r) => {
        const acoes = proximos(r.status);
        return <div key={r.id} className={styles.redemptionRow}>
          <div><strong>{r.cliente?.nome_completo ?? "—"}</strong><div style={{ color: "var(--soft)", fontSize: 9, marginTop: 2 }}>{r.cliente?.cpf ?? ""}</div></div>
          <div>{r.recompensa?.titulo ?? "Benefício"}</div>
          <strong style={{ color: "var(--bg)" }}>{r.pontos.toLocaleString("pt-BR")}</strong>
          <span style={{ color: "var(--soft)" }}>{data(r.created_at)}</span>
          <span style={zipChip(kind(r.status))}>{rotulo(r.status)}</span>
          <div className={styles.redemptionActions}>
            {acoes.length === 0 ? <span className={styles.redemptionDone}>Concluído</span> : acoes.map((a) => <button type="button" key={a.status} disabled={ocupado === r.id} data-danger={Boolean(a.danger)} onClick={() => void atualizar(r, a.status)}>{ocupado === r.id ? "…" : a.label}</button>)}
          </div>
        </div>;
      })}
    </div>}
  </div>;
}

