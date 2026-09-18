"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatarCpf } from "@/lib/cpf";
import { formatarMoeda } from "@/lib/utils";
import { fetchInstant, getInstantCache, refreshInstant } from "@/lib/instantCache";
import type { Cliente, NovaVenda } from "@/types/database";
import { STATUS_CONTRATO_LABEL } from "@/types/database";
import { ClienteDetailDrawer } from "@/components/admin/clientes/ClienteDetailDrawer";
import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";

/**
 * Reprodução fiel de Admin Clientes.dc.html: tabs por estágio do funil de
 * cadastro, tabela densa com filtro de banco/busca, e drawer lateral
 * [PERFIL][FINANCEIRO] ao clicar numa cliente. Dados 100% reais — nenhum
 * mock. "Campanha" e "Banco" só aparecem quando há dado real (novas_vendas
 * / carnês); sem isso, mostram "—".
 */

type Funil = "novas" | "aguardando" | "cadastradas" | "canceladas";

const TAB_LABEL: Record<Funil, string> = { novas: "Novas", aguardando: "Aguardando cadastro", cadastradas: "Cadastradas", canceladas: "Canceladas" };

function statusKind(status: string | undefined): ZipKind {
  if (status === "ativo") return "ok";
  if (status === "suspenso" || status === "inadimplente") return "warn";
  return "bad";
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [novasVendas, setNovasVendas] = useState<NovaVenda[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [funil, setFunil] = useState<Funil>("cadastradas");
  const [bancoFiltro, setBancoFiltro] = useState("Todos os bancos");
  const [bancoMenuAberto, setBancoMenuAberto] = useState(false);
  const [modal, setModal] = useState<Cliente | null | false>(false);

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

  const novas = useMemo(() => novasVendas.filter((v) => !v.cliente_id && v.status === "aguardando_cadastro"), [novasVendas]);
  const aguardandoCadastro = useMemo(() => novasVendas.filter((v) => v.cliente_id && v.status === "aguardando_boletos"), [novasVendas]);
  const cadastradas = useMemo(() => clientes.filter((c) => c.status_contrato !== "cancelado"), [clientes]);
  const canceladas = useMemo(() => clientes.filter((c) => c.status_contrato === "cancelado"), [clientes]);

  const bancos = useMemo(() => ["Todos os bancos", ...Array.from(new Set(clientes.map((c) => c.banco).filter((b): b is string => Boolean(b))))], [clientes]);

  const termo = busca.trim().toLowerCase();
  const filtradas = useMemo(() => {
    let base = funil === "canceladas" ? canceladas : cadastradas;
    if (bancoFiltro !== "Todos os bancos") base = base.filter((c) => c.banco === bancoFiltro);
    if (!termo) return base;
    return base.filter((c) => [c.nome_completo, c.cpf, c.telefone, c.consultora, c.origem_venda].some((v) => v?.toLowerCase().includes(termo)));
  }, [cadastradas, canceladas, funil, termo, bancoFiltro]);
  const vendasFiltradas = useMemo(() => { const base = funil === "novas" ? novas : aguardandoCadastro; if (!termo) return base; return base.filter((v) => v.nome_completo.toLowerCase().includes(termo)); }, [novas, aguardandoCadastro, funil, termo]);

  const tabs: Funil[] = ["novas", "aguardando", "cadastradas", "canceladas"];
  const tabCount: Record<Funil, number> = { novas: novas.length, aguardando: aguardandoCadastro.length, cadastradas: cadastradas.length, canceladas: canceladas.length };

  function atualizarDepoisDoDrawer(atualizada?: Cliente) {
    if (atualizada) {
      setClientes((atuais) => atuais.map((item) => item.id === atualizada.id ? { ...item, ...atualizada } : item));
      setModal((atual) => atual && atual.id === atualizada.id ? { ...atual, ...atualizada } : atual);
    }
    void carregar(true);
  }


  return <div className="zip-admin" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
    <div style={{ flex: "1 1 560px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "2px 2px 14px" }}>
        <div>
          <h1 style={{ fontSize: 27 }}>Clientes</h1>
          <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--soft)", maxWidth: "52ch" }}>Gerencie clientes recebidas pelo CRM e acompanhe o processo de cadastro.</p>
        </div>
        <button onClick={() => setModal(null)} style={{ height: 34, padding: "0 15px", borderRadius: 10, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>Nova cliente
        </button>
      </div>

      <div style={{ display: "flex", gap: 5, padding: 3, borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", width: "fit-content", maxWidth: "100%", overflow: "auto", marginBottom: 14 }}>
        {tabs.map((t) => {
          const on = funil === t;
          return <button key={t} onClick={() => setFunil(t)} style={{ height: 30, padding: "0 11px", borderRadius: 9, border: on ? "1px solid var(--line)" : "1px solid transparent", background: on ? "var(--s0)" : "transparent", color: on ? "var(--ink)" : "var(--soft)", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
            {TAB_LABEL[t]}<span style={{ ...zipChip(on ? "rose" : "neutral"), height: 17, fontSize: 8 }}>{tabCount[t]}</span>
          </button>;
        })}
      </div>

      <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, boxShadow: "var(--sh)", backdropFilter: "blur(18px)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ fontSize: 15 }}>{TAB_LABEL[funil]}</h2>
            <span style={{ fontSize: 11, color: "var(--soft)" }}>{(funil === "novas" || funil === "aguardando" ? vendasFiltradas.length : filtradas.length)} nesta página</span>
          </div>
          {(funil === "cadastradas" || funil === "canceladas") && <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, height: 31, width: 280, maxWidth: "44vw", padding: "0 11px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)" }}>
              <span style={{ color: "var(--rose)", fontSize: 11.5 }}>⌕</span>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, CPF, telefone ou vendedora…" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", outline: "none", fontSize: 11.5, color: "var(--ink)" }} />
            </div>
            <div style={{ position: "relative" }}>
              <button onClick={() => setBancoMenuAberto((v) => !v)} style={{ height: 31, padding: "0 11px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>{bancoFiltro}<span style={{ fontSize: 9 }}>▾</span></button>
              {bancoMenuAberto && <div className="zip-animate-pop-in" style={{ position: "absolute", top: 35, right: 0, zIndex: 9, width: 206, border: "1px solid var(--line)", background: "var(--s0)", borderRadius: 10, boxShadow: "var(--sh)", overflow: "hidden" }}>
                {bancos.map((b) => <div key={b} className="zip-row-hover" onClick={() => { setBancoFiltro(b); setBancoMenuAberto(false); }} style={{ padding: "9px 12px", fontSize: 12, borderBottom: "1px solid var(--line2)", cursor: "pointer" }}>{b}</div>)}
              </div>}
            </div>
          </div>}
        </div>

        <div style={{ overflowX: "auto" }}>
          {(funil === "novas" || funil === "aguardando") ? (
            vendasFiltradas.length === 0 ? <div style={{ padding: "52px 20px", textAlign: "center" }}><div style={{ fontSize: 13, fontWeight: 600 }}>Nenhuma venda encontrada</div><div style={{ marginTop: 5, fontSize: 12, color: "var(--soft)" }}>{funil === "novas" ? "Nenhuma venda nova aguardando conferência." : "Nenhuma cliente aguardando geração de parcelas."}</div></div>
              : <div style={{ minWidth: 640 }}>{vendasFiltradas.map((v) => <div key={v.id} style={{ display: "grid", gridTemplateColumns: "1fr 160px 160px", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--line2)", alignItems: "center", fontSize: 12.5 }}>
                <div><div style={{ fontWeight: 600 }}>{v.nome_completo}</div><div style={{ fontSize: 11, color: "var(--soft)" }}>{v.origem_venda || "Origem não informada"}</div></div>
                <span className="zip-mono">{formatarMoeda(Number(v.valor_contrato ?? 0))}</span>
                {funil === "novas" ? <button onClick={() => { const cpf = window.prompt("CPF da cliente (11 dígitos):", v.cpf ?? ""); const nascimento = cpf ? window.prompt("Data de nascimento (AAAA-MM-DD):") : null; if (!cpf || !nascimento) return; void fetch(`/api/admin/novas-vendas/${v.id}/cadastrar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cpf, dataNascimento: nascimento }) }).then(() => carregar(true)); }} style={{ height: 28, padding: "0 10px", borderRadius: 8, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 11, fontWeight: 700 }}>Conferir e cadastrar</button>
                  : <span style={zipChip("warn")}>Falta gerar parcelas</span>}
              </div>)}</div>
          ) : (
            <div style={{ minWidth: 860 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.4fr) minmax(110px,.9fr) minmax(130px,1fr) 132px 144px 40px", gap: 12, padding: "0 14px", height: 34, alignItems: "center", background: "var(--s1)", borderBottom: "1px solid var(--line)", fontSize: 9, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>
                <div>Cliente</div><div>Vendedora</div><div>Campanha</div><div>Banco</div><div>Status</div><div style={{ textAlign: "right" }}>Ações</div>
              </div>
              {carregando ? <div style={{ padding: 40, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Carregando…</div> : filtradas.length === 0 ? <div style={{ padding: "52px 20px", textAlign: "center" }}><div style={{ fontSize: 13, fontWeight: 600 }}>Nenhuma cliente encontrada</div><div style={{ marginTop: 5, fontSize: 12, color: "var(--soft)" }}>Ajuste a busca ou os filtros desta lista.</div></div>
                : filtradas.map((c) => <div key={c.id} onClick={() => setModal(c)} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.4fr) minmax(110px,.9fr) minmax(130px,1fr) 132px 144px 40px", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--line2)", alignItems: "center", cursor: "pointer" }}>
                  <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.nome_completo || "Sem nome"}</div><div style={{ fontSize: 10.5, color: "var(--soft)" }}>{c.cpf ? formatarCpf(c.cpf) : "CPF não informado"}</div></div>
                  <div style={{ fontSize: 12, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.consultora || "—"}</div>
                  <div style={{ fontSize: 12, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.origem_venda || "—"}</div>
                  <div style={{ minWidth: 0 }}>{c.banco ? <span style={zipChip("rose")}>{c.banco}</span> : <span style={{ color: "var(--soft)", fontSize: 12 }}>—</span>}</div>
                  <div><span style={zipChip(statusKind(c.status_contrato))}>{STATUS_CONTRATO_LABEL[c.status_contrato ?? "ativo"]}</span></div>
                  <div style={{ textAlign: "right", color: "var(--soft)", fontSize: 13 }}>⋯</div>
                </div>)}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--soft)" }}>
          <span>{funil === "novas" || funil === "aguardando" ? vendasFiltradas.length : filtradas.length} clientes · lista contínua</span>
        </div>
      </div>
    </div>

    {modal !== false && <ClienteDetailDrawer
      cliente={modal}
      creating={modal === null}
      open
      onClose={() => setModal(false)}
      onUpdated={atualizarDepoisDoDrawer}
      onCreated={(criada) => {
        setClientes((atuais) => [criada, ...atuais.filter((item) => item.id !== criada.id)]);
        setModal(criada);
        void carregar(true);
      }}
    />}
  </div>;
}
