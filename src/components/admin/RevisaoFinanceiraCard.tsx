"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatarMoeda } from "@/lib/utils";
import { PRAZO_REVISAO_FINANCEIRA_DIAS_UTEIS } from "@/types/database";
import { zipChip } from "@/components/admin-zip/zipUi";

type Forma = "cartao" | "pix" | "cheques" | "boleto_100";
interface Pendente { id: string; nome: string; cpf: string; valorContrato: number; quantidadeParcelas: number | null; porcentagemPagamento: number; dataAtingiuPercentual: string | null; saldoRestanteEstimado: number; }
interface ClienteFilaRaw {
  id: string;
  nome_completo?: string | null;
  cpf?: string | null;
  valor_contrato?: number | string | null;
  quantidade_parcelas?: number | null;
  porcentagem_pagamento?: number | null;
  data_atingiu_percentual?: string | null;
  status_revisao_financeira?: "pendente" | "aprovada" | "recusada" | null;
  financeiro_saldo_restante?: number | string | null;
}
const FORMAS: { value: Forma; label: string }[] = [
  { value: "cartao", label: "Cartão" }, { value: "pix", label: "PIX" }, { value: "cheques", label: "Cheques" }, { value: "boleto_100", label: "100% boleto" },
];
function diasUteisDesde(iso: string | null) { if (!iso) return 0; const inicio = new Date(iso); const hoje = new Date(); inicio.setHours(0, 0, 0, 0); hoje.setHours(0, 0, 0, 0); let dias = 0; while (inicio < hoje) { inicio.setDate(inicio.getDate() + 1); const d = inicio.getDay(); if (d !== 0 && d !== 6) dias++; } return dias; }

function normalizarFilaFinanceira(clientes: ClienteFilaRaw[]): Pendente[] {
  return clientes
    .filter((cliente) => cliente.status_revisao_financeira === "pendente")
    .map((cliente) => {
      const valorContrato = Number(cliente.valor_contrato ?? 0) || 0;
      const porcentagemPagamento = Math.max(0, Math.min(100, Number(cliente.porcentagem_pagamento ?? 0) || 0));
      const saldoPersistido = cliente.financeiro_saldo_restante == null ? null : Number(cliente.financeiro_saldo_restante);
      const saldoRestanteEstimado = saldoPersistido != null && Number.isFinite(saldoPersistido)
        ? Math.max(0, saldoPersistido)
        : Math.max(0, valorContrato * (1 - porcentagemPagamento / 100));
      return {
        id: cliente.id,
        nome: cliente.nome_completo?.trim() || "Cliente",
        cpf: cliente.cpf || "",
        valorContrato,
        quantidadeParcelas: cliente.quantidade_parcelas ?? null,
        porcentagemPagamento,
        dataAtingiuPercentual: cliente.data_atingiu_percentual ?? null,
        saldoRestanteEstimado,
      };
    });
}

export function RevisaoFinanceiraCard() {
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [processando, setProcessando] = useState<string | null>(null);
  const [financeiro, setFinanceiro] = useState<Record<string, { saldo: string; taxa: string; formas: Forma[] }>>({});

  async function carregar() {
    try {
      // A fila financeira é estado da própria cliente. O endpoint antigo
      // /api/admin/liberacoes-financeiras apontava para uma tabela que não
      // existe no schema atual. /api/admin/clientes já entrega o estado real
      // da revisão e o percentual consolidado de pagamento.
      const res = await fetch("/api/admin/clientes", { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as { clientes?: ClienteFilaRaw[]; erro?: string };
      if (!res.ok) throw new Error(data.erro ?? "Falha ao carregar a fila financeira.");
      const lista = normalizarFilaFinanceira(Array.isArray(data.clientes) ? data.clientes : []);
      setPendentes(lista);
      setFinanceiro((atual) => Object.fromEntries(lista.map((p) => [p.id, atual[p.id] ?? { saldo: String(p.saldoRestanteEstimado ?? 0), taxa: "5.4", formas: ["cartao", "pix", "cheques", "boleto_100"] as Forma[] }])));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível carregar a fila financeira."); }
    finally { setCarregando(false); }
  }
  useEffect(() => { void carregar(); const intervalo = setInterval(carregar, 30000); return () => clearInterval(intervalo); }, []);
  const filtradas = useMemo(() => { const termo = busca.trim().toLocaleLowerCase("pt-BR"); return pendentes.filter((p) => !termo || p.nome.toLocaleLowerCase("pt-BR").includes(termo)); }, [pendentes, busca]);
  function alterarFinanceiro(id: string, patch: Partial<{ saldo: string; taxa: string; formas: Forma[] }>) { setFinanceiro((a) => ({ ...a, [id]: { ...(a[id] ?? { saldo: "0", taxa: "5.4", formas: [] }), ...patch } })); }
  function alternarForma(id: string, forma: Forma) { const formas = financeiro[id]?.formas ?? []; alterarFinanceiro(id, { formas: formas.includes(forma) ? formas.filter((f) => f !== forma) : [...formas, forma] }); }
  async function decidir(id: string, decisao: "aprovada" | "recusada") {
    if (decisao === "recusada") { const motivo = window.prompt("Descreva rapidamente a divergência encontrada (opcional):"); if (motivo === null) return; return enviarDecisao(id, decisao, motivo); }
    const config = financeiro[id];
    if (!config || Number(config.saldo) < 0 || !Number.isFinite(Number(config.saldo))) return toast.error("Informe um saldo restante válido.");
    if (!config.formas.length) return toast.error("Selecione pelo menos uma forma de custeio.");
    return enviarDecisao(id, decisao, undefined, config);
  }
  async function enviarDecisao(id: string, decisao: "aprovada" | "recusada", observacao?: string, config?: { saldo: string; taxa: string; formas: Forma[] }) {
    setProcessando(id);
    try {
      const body: Record<string, unknown> = { decisao, observacao: observacao || undefined };
      if (decisao === "aprovada" && config) { body.saldoRestante = Number(config.saldo); body.taxaCartao = Number(config.taxa); body.formasCusteio = config.formas; }
      const res = await fetch(`/api/admin/clientes/${id}/revisao-financeira`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) return toast.error(data.erro ?? "Não foi possível registrar a decisão.");
      toast.success(decisao === "aprovada" ? "Levantamento confirmado e agenda liberada." : "Revisão recusada e cliente notificada.");
      setPendentes((a) => a.filter((p) => p.id !== id)); setAberta(null);
    } catch { toast.error("Erro de conexão. Tente novamente."); }
    finally { setProcessando(null); }
  }
  if (carregando) return null;
  return <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", backdropFilter: "blur(18px)", overflow: "hidden" }}>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
      <div><div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--rose)" }}>Confirmação financeira</div><div style={{ marginTop: 3, fontSize: 11.5, color: "var(--soft)" }}>Revise, escolha o custeio e libere a próxima etapa.</div></div>
      <span style={zipChip(filtradas.length ? "rose" : "neutral")}>{filtradas.length} pendente(s)</span>
    </div>
    <div style={{ padding: "12px 14px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, height: 31, padding: "0 11px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)" }}>
        <span style={{ color: "var(--rose)", fontSize: 11.5 }}>⌕</span>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome…" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", outline: "none", fontSize: 11.5, color: "var(--ink)" }} />
      </div>
    </div>
    {filtradas.length === 0 ? <div style={{ margin: "12px 14px 14px", borderRadius: 12, border: "1px dashed var(--line)", background: "var(--s1)", padding: "22px 16px", textAlign: "center" }}><div style={{ fontSize: 12, color: "var(--soft)" }}>Nenhuma cliente aguardando confirmação financeira.</div></div> : <div style={{ margin: "12px 14px 14px", maxHeight: 460, overflowY: "auto" }}>
      {filtradas.map((c) => {
        const config = financeiro[c.id] ?? { saldo: String(c.saldoRestanteEstimado ?? 0), taxa: "5.4", formas: [] as Forma[] };
        const dias = diasUteisDesde(c.dataAtingiuPercentual); const atrasado = dias >= PRAZO_REVISAO_FINANCEIRA_DIAS_UTEIS; const isOpen = aberta === c.id;
        return <div key={c.id} style={{ overflow: "hidden", borderRadius: 10, border: `1px solid ${isOpen ? "var(--gobg)" : "var(--line)"}`, background: isOpen ? "var(--gobg)" : "var(--s0)", marginBottom: 7 }}>
          <button onClick={() => setAberta(isOpen ? null : c.id)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "10px 12px", textAlign: "left", background: "transparent", border: 0 }}>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.nome}</span>
              <span style={{ display: "block", marginTop: 2, fontSize: 10.5, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatarMoeda(c.valorContrato)} · {c.quantidadeParcelas ?? "—"} parcelas · {c.porcentagemPagamento}% pago</span>
            </span>
            <span style={{ fontSize: 10, color: atrasado ? "var(--bad)" : "var(--soft)", whiteSpace: "nowrap" }}>{atrasado ? "Prazo atingido" : `${dias}/${PRAZO_REVISAO_FINANCEIRA_DIAS_UTEIS} úteis`}</span>
            <span style={{ fontSize: 10, color: "var(--soft)", transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
          </button>
          {isOpen && <div style={{ borderTop: "1px solid var(--line)", padding: "11px 12px 12px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
              <label style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--soft)" }}>Saldo confirmado
                <input value={config.saldo} onChange={(e) => alterarFinanceiro(c.id, { saldo: e.target.value })} inputMode="decimal" style={{ marginTop: 4, height: 30, width: "100%", borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", padding: "0 9px", fontSize: 12, color: "var(--ink)", outline: "none" }} />
              </label>
              <label style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--soft)" }}>Taxa cartão (%)
                <input value={config.taxa} onChange={(e) => alterarFinanceiro(c.id, { taxa: e.target.value })} inputMode="decimal" style={{ marginTop: 4, height: 30, width: "100%", borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", padding: "0 9px", fontSize: 12, color: "var(--ink)", outline: "none" }} />
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ marginBottom: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--soft)" }}>Opções de custeio</div>
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                {FORMAS.map((f) => { const ativo = config.formas.includes(f.value); return <button key={f.value} onClick={() => alternarForma(c.id, f.value)} style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 6, borderRadius: 999, border: `1px solid ${ativo ? "var(--bg)" : "var(--line)"}`, background: ativo ? "var(--bg)" : "var(--s0)", color: ativo ? "#FFFDFC" : "var(--ink)", padding: "6px 11px", fontSize: 10.5, fontWeight: 600 }}>{f.label}</button>; })}
              </div>
            </div>
            <div style={{ marginTop: 9, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, borderRadius: 9, background: "var(--s1)", padding: "8px 10px" }}>
              <div style={{ fontSize: 10.5, color: "var(--soft)" }}>Cartão com taxa: <strong style={{ color: "var(--ink)" }}>{formatarMoeda(Number(config.saldo || 0) * (1 + Number(config.taxa || 0) / 100))}</strong></div>
              <div style={{ display: "flex", gap: 6 }}>
                <button disabled={processando === c.id} onClick={() => decidir(c.id, "recusada")} style={{ height: 30, padding: "0 11px", borderRadius: 8, border: "1px solid var(--badbg)", background: "var(--s0)", color: "var(--bad)", fontSize: 10.5, fontWeight: 700 }}>Recusar</button>
                <button disabled={processando === c.id} onClick={() => decidir(c.id, "aprovada")} style={{ height: 30, padding: "0 11px", borderRadius: 8, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 10.5, fontWeight: 700 }}>Confirmar</button>
              </div>
            </div>
          </div>}
        </div>;
      })}
    </div>}
  </div>;
}
