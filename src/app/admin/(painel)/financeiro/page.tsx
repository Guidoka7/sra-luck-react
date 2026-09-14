"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatarMoeda } from "@/lib/utils";
import { ClienteZipDrawer } from "@/components/admin-zip/ClienteZipDrawer";
import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";
import { financeiroApi } from "@/features/financeiro/financeiroApi";
import { FUNIL_CLIENTE_LABEL } from "@/features/financeiro/types";
import type { ClienteFunilItem, FunilClienteBucket } from "@/features/financeiro/types";
import type { Cliente } from "@/types/database";

/**
 * Reprodução fiel de Admin Financeiro.dc.html: funil por cliente (o mesmo
 * modelo aprovado na Correção 1), tabela densa com progresso/saldo/status,
 * legenda "Status do contrato" e drawer lateral [PERFIL][FINANCEIRO] abrindo
 * em FINANCEIRO. O "Financeiro Unificado" antigo permanece só como
 * infraestrutura por baixo (financeiroApi) — não é mais a UI principal.
 */

const ORDEM: FunilClienteBucket[] = ["aguardando_conferencia", "ativos", "todos", "suspensos", "negativados", "cancelados"];

const FUNIL_NOTA: Record<FunilClienteBucket, string> = {
  aguardando_conferencia: "Clientes que enviaram comprovantes de pagamento e aguardam análise do Financeiro.",
  ativos: "Contratos operando normalmente, com parcelas em aberto e pagamentos disponíveis no app.",
  todos: "Todos os contratos ativos, aguardando conferência, suspensos e negativados.",
  suspensos: "Parcelas restantes suspensas no app. Pode ter período determinado ou indeterminado.",
  negativados: "Parcelas suspensas e pagamentos indisponíveis no aplicativo.",
  cancelados: "Acesso ao app bloqueado. O histórico permanece disponível.",
};

const STATUS_DOCS: { nome: string; modo: string; desc: string; kind: ZipKind }[] = [
  { nome: "Aguardando conferência", modo: "Automático", desc: "Existe comprovante aguardando análise.", kind: "warn" },
  { nome: "Ativo", modo: "Automático", desc: "Contrato operando normalmente.", kind: "ok" },
  { nome: "Suspenso", modo: "Manual", desc: "Parcelas restantes suspensas no app. Pode ter período determinado ou indeterminado.", kind: "warn" },
  { nome: "Negativado", modo: "Manual", desc: "Parcelas suspensas e pagamentos indisponíveis.", kind: "bad" },
  { nome: "Cancelado", modo: "Manual", desc: "Acesso ao app bloqueado e cliente movida para Cancelados.", kind: "neutral" },
];

function bucketKind(bucket: FunilClienteBucket): ZipKind {
  if (bucket === "ativos") return "ok";
  if (bucket === "aguardando_conferencia" || bucket === "suspensos") return "warn";
  if (bucket === "negativados") return "bad";
  return "neutral";
}
function dataBr(v: string | null | undefined) { return v ? v.slice(0, 10).split("-").reverse().join("/") : "—"; }

export default function FinanceiroPage() {
  const [itens, setItens] = useState<ClienteFunilItem[]>([]);
  const [clientesCompletos, setClientesCompletos] = useState<Cliente[]>([]);
  const [funis, setFunis] = useState<Array<{ bucket: FunilClienteBucket; total: number }>>([]);
  const [bucket, setBucket] = useState<FunilClienteBucket>("aguardando_conferencia");
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [modal, setModal] = useState<Cliente | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const [funil, lista] = await Promise.all([financeiroApi.funilClientes(), financeiroApi.clientes()]);
      setItens(funil.itens);
      setFunis(funil.funis);
      setClientesCompletos(lista as Cliente[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar o funil de clientes.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => { void carregar(); }, []);

  const termo = busca.trim().toLowerCase();
  const visiveis = useMemo(() => {
    const base = bucket === "todos" ? itens : itens.filter((item) => item.bucket === bucket);
    if (!termo) return base;
    return base.filter((i) => [i.nome, i.cpf, i.vendedora, i.campanha].some((v) => v?.toLowerCase().includes(termo)));
  }, [itens, bucket, termo]);

  function abrir(item: ClienteFunilItem) {
    const cliente = clientesCompletos.find((c) => c.id === item.clienteId);
    if (!cliente) { toast.error("Não foi possível abrir o perfil completo desta cliente agora."); return; }
    setModal(cliente);
  }

  return <div className="zip-admin" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
    <div style={{ flex: "1 1 560px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "2px 2px 14px" }}>
        <div>
          <h1 style={{ fontSize: 27 }}>Financeiro</h1>
          <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--soft)", maxWidth: "62ch" }}>Conferência de comprovantes, controle de parcelas e operações financeiras em um único espaço.</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 5, padding: 3, borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", width: "fit-content", maxWidth: "100%", overflow: "auto", marginBottom: 14 }}>
        {ORDEM.map((b) => {
          const on = bucket === b;
          const total = funis.find((f) => f.bucket === b)?.total ?? 0;
          return <button key={b} onClick={() => setBucket(b)} style={{ display: "flex", alignItems: "center", gap: 7, height: 31, padding: "0 13px", borderRadius: 9, border: on ? "1px solid var(--line)" : "1px solid transparent", background: on ? "var(--s0)" : "transparent", color: on ? "var(--ink)" : "var(--soft)", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>
            {FUNIL_CLIENTE_LABEL[b]}<span style={{ display: "inline-grid", placeItems: "center", minWidth: 19, height: 17, padding: "0 5px", borderRadius: 999, background: on ? "var(--robg)" : "var(--line2)", color: on ? "var(--bg)" : "var(--soft)", fontSize: 10, fontWeight: 700 }}>{total}</span>
          </button>;
        })}
      </div>

      <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", backdropFilter: "blur(18px)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ fontSize: 15 }}>{FUNIL_CLIENTE_LABEL[bucket]}</h2>
            <span style={{ fontSize: 11, color: "var(--soft)" }}>{visiveis.length} clientes</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, height: 31, width: 274, maxWidth: "44vw", padding: "0 11px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)" }}>
            <span style={{ color: "var(--rose)", fontSize: 11.5 }}>⌕</span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, CPF, campanha ou vendedora…" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", outline: "none", fontSize: 11.5, color: "var(--ink)" }} />
          </div>
        </div>
        <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--line)", fontSize: 11, color: "var(--soft)", background: "var(--s1)" }}>{FUNIL_NOTA[bucket]}</div>

        <div style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(170px,1.4fr) minmax(110px,.9fr) minmax(130px,1fr) 104px 132px 110px 174px 34px", gap: 11, minWidth: 1060, padding: "0 14px", height: 33, alignItems: "center", background: "var(--s1)", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, zIndex: 2 }}>
            {["Cliente", "Vendedora", "Campanha", "Próx. venc.", "Progresso", "Saldo aberto", "Status", ""].map((h) => <div key={h} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h}</div>)}
          </div>

          {carregando ? <div style={{ padding: 46, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Carregando…</div> : visiveis.length === 0 ? <div style={{ padding: "46px 20px", textAlign: "center" }}><div style={{ fontSize: 13, fontWeight: 600 }}>Nenhuma cliente neste funil</div><div style={{ marginTop: 5, fontSize: 12, color: "var(--soft)" }}>Ajuste a busca ou escolha outro funil.</div></div>
            : visiveis.map((r) => <div key={r.clienteId} onClick={() => abrir(r)} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "minmax(170px,1.4fr) minmax(110px,.9fr) minmax(130px,1fr) 104px 132px 110px 174px 34px", gap: 11, minWidth: 1060, padding: "0 14px", height: 50, alignItems: "center", cursor: "pointer", borderBottom: "1px solid var(--line2)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.nome}</div>
                {r.quitado && <span style={{ display: "inline-block", marginTop: 3, height: 18, lineHeight: "18px", padding: "0 7px", borderRadius: 999, background: "var(--okbg)", color: "var(--ok)", fontSize: 9.5, fontWeight: 600 }}>Quitado</span>}
              </div>
              <div style={{ minWidth: 0, fontSize: 12, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.vendedora || "—"}</div>
              <div style={{ minWidth: 0, fontSize: 12, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.campanha || "—"}</div>
              <div style={{ fontSize: 12, color: "var(--soft)" }} className="zip-mono">{dataBr(r.proximoVencimento)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ height: 5, borderRadius: 999, background: "var(--line2)", overflow: "hidden" }}><div style={{ height: "100%", width: `${r.parcelasTotal ? Math.round((r.parcelasPagas / r.parcelasTotal) * 100) : 0}%`, borderRadius: 999, background: r.bucket === "ativos" ? "var(--bg)" : r.bucket === "aguardando_conferencia" ? "var(--gold)" : "var(--soft)" }} /></div>
                <div style={{ marginTop: 3, fontSize: 10, color: "var(--soft)" }} className="zip-mono">{r.parcelasPagas} / {r.parcelasTotal}</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600 }} className="zip-mono">{formatarMoeda(r.saldoAReceber)}</div>
              <div style={{ minWidth: 0, overflow: "hidden" }}><span style={zipChip(bucketKind(r.bucket))}>{FUNIL_CLIENTE_LABEL[r.bucket]}</span></div>
              <div style={{ textAlign: "right", color: "var(--soft)", fontSize: 13 }}>⋯</div>
            </div>)}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--soft)" }}>{visiveis.length} clientes · lista contínua</div>
      </div>

      <div style={{ marginTop: 14, border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}><h2 style={{ fontSize: 15 }}>Status do contrato</h2></div>
        <div style={{ padding: "13px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(248px,1fr))", gap: 11 }}>
          {STATUS_DOCS.map((d) => <div key={d.nome} style={{ border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 11, padding: "11px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={zipChip(d.kind)}>{d.nome}</span><span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--soft)" }}>{d.modo}</span></div>
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--soft)", lineHeight: 1.5 }}>{d.desc}</div>
          </div>)}
        </div>
      </div>

      <div style={{ marginTop: 10, textAlign: "right" }}>
        <a href="/admin/financeiro/avancado" style={{ fontSize: 10.5, color: "var(--soft)", textDecoration: "underline" }}>Operações avançadas do Financeiro Unificado (baixa manual, conciliação, recebíveis em lote) →</a>
      </div>
    </div>

    {modal && <ClienteZipDrawer cliente={modal} abaInicial="financeiro" onClose={() => setModal(null)} onSalvo={() => { setModal(null); void carregar(); }} />}
  </div>;
}
