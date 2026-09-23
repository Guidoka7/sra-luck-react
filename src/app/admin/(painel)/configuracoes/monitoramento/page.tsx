"use client";

import { useEffect, useState } from "react";
import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";

/**
 * Aba MONITORAMENTO — reprodução de Admin Configuracoes.dc.html:
 * sub-abas LOGS DO SISTEMA / ACESSOS AO APLICATIVO, cada uma com a
 * tabela exata do ZIP. O ZIP não mostra os cards de diagnóstico
 * (saúde geral, erros/hora, checks de conexão), mas são sinais reais
 * importantes — foram mantidos como uma faixa compacta acima das
 * sub-abas, no mesmo padrão visual de card.
 */

interface Item { cliente_id: string; device_type: string | null; display_mode: string | null; is_pwa_installed: boolean; notification_permission: string; push_active: boolean; first_access_at: string | null; last_access_at: string | null; cliente: { id: string; nome_completo: string; cpf: string; ativo: boolean }; }
interface Erro { id: string; criado_em: string; origem: string; nivel: string; rota: string | null; metodo: string | null; status_http: number | null; codigo: string | null; mensagem: string; }
interface Check { nome: string; ok: boolean; detalhe: string; ms: number; }

function dataHora(value: string | null) { if (!value) return "—"; return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
function nivelKind(nivel: string): ZipKind { if (nivel === "critical") return "bad"; if (nivel === "warning") return "warn"; return "neutral"; }

export default function MonitoramentoPage() {
  const [dados, setDados] = useState<{ dispositivos: Item[]; resumo: Item[]; metricas: Record<string, number> } | null>(null);
  const [erros, setErros] = useState<{ resumo: { ultimaHora: number; ultimas24h: number; criticos24h: number; totalCarregado: number }; topRotas: { rota: string; total: number }[]; eventos: Erro[] } | null>(null);
  const [diagnostico, setDiagnostico] = useState<{ ok: boolean; geradoEm: string; checks: Check[] } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sub, setSub] = useState<"logs" | "access">("logs");
  const [buscaAcesso, setBuscaAcesso] = useState("");
  const [drawer, setDrawer] = useState<{ tipo: "log"; item: Erro } | { tipo: "access"; item: Item } | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const headers = { "Cache-Control": "no-cache" };
      const [appRes, erroRes, diagRes] = await Promise.all([
        fetch(`/api/admin/monitoramento-app?t=${Date.now()}`, { cache: "no-store", headers }),
        fetch(`/api/admin/monitoramento-erros?t=${Date.now()}`, { cache: "no-store", headers }),
        fetch(`/api/admin/diagnostico?t=${Date.now()}`, { cache: "no-store", headers }),
      ]);
      if (appRes.ok) setDados(await appRes.json());
      if (erroRes.ok) setErros(await erroRes.json());
      if (diagRes.ok) setDiagnostico(await diagRes.json());
    } finally { setCarregando(false); }
  }

  useEffect(() => {
    carregar();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") carregar(); }, 15000);
    return () => window.clearInterval(interval);
  }, []);

  const rows = (dados?.resumo ?? []).filter((r) => !buscaAcesso.trim() || r.cliente?.nome_completo?.toLowerCase().includes(buscaAcesso.trim().toLowerCase()));
  const statusGeral = diagnostico?.ok !== false && (erros?.resumo.criticos24h ?? 0) === 0;

  return <div className="zip-animate-fade-in">
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 9, marginBottom: 10 }}>
      <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 12, padding: 11 }}><div style={{ fontSize: 9.5, color: "var(--soft)", fontWeight: 600 }}>Saúde geral</div><div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: statusGeral ? "var(--ok)" : "var(--bad)" }}>{statusGeral ? "Operacional" : "Atenção"}</div></div>
      <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 12, padding: 11 }}><div style={{ fontSize: 9.5, color: "var(--soft)", fontWeight: 600 }}>Erros · última hora</div><div className="zip-mono" style={{ marginTop: 4, fontSize: 16, fontWeight: 800 }}>{erros?.resumo.ultimaHora ?? "—"}</div></div>
      <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 12, padding: 11 }}><div style={{ fontSize: 9.5, color: "var(--soft)", fontWeight: 600 }}>Eventos · 24h</div><div className="zip-mono" style={{ marginTop: 4, fontSize: 16, fontWeight: 800 }}>{erros?.resumo.ultimas24h ?? "—"}</div></div>
      <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 12, padding: 11 }}><div style={{ fontSize: 9.5, color: "var(--soft)", fontWeight: 600 }}>Críticos · 24h</div><div className="zip-mono" style={{ marginTop: 4, fontSize: 16, fontWeight: 800, color: (erros?.resumo.criticos24h ?? 0) > 0 ? "var(--bad)" : "var(--ok)" }}>{erros?.resumo.criticos24h ?? "—"}</div></div>
    </div>

    {diagnostico && <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 12, padding: 11, marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
      {diagnostico.checks.map((check) => <span key={check.nome} style={zipChip(check.ok ? "ok" : "bad")}>{check.ok ? "✓" : "✕"} {check.nome}</span>)}
    </div>}

    <div style={{ display: "flex", gap: 5, padding: 3, border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel)", width: "fit-content", marginBottom: 10 }}>
      <button onClick={() => setSub("logs")} style={{ height: 28, padding: "0 11px", borderRadius: 8, border: sub === "logs" ? "1px solid var(--line)" : "1px solid transparent", background: sub === "logs" ? "var(--s0)" : "transparent", color: sub === "logs" ? "var(--ink)" : "var(--soft)", fontSize: 10, fontWeight: 700, letterSpacing: ".06em" }}>LOGS DO SISTEMA</button>
      <button onClick={() => setSub("access")} style={{ height: 28, padding: "0 11px", borderRadius: 8, border: sub === "access" ? "1px solid var(--line)" : "1px solid transparent", background: sub === "access" ? "var(--s0)" : "transparent", color: sub === "access" ? "var(--ink)" : "var(--soft)", fontSize: 10, fontWeight: 700, letterSpacing: ".06em" }}>ACESSOS AO APLICATIVO</button>
    </div>

    {sub === "logs" ? <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}><h2 style={{ fontSize: 15 }}>Logs do sistema</h2><div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Eventos operacionais, Web Push e integrações.</div></div>
      <div style={{ overflow: "auto", maxHeight: 560 }}>
        <div style={{ display: "grid", gridTemplateColumns: "145px 120px minmax(160px,1fr) minmax(240px,1.4fr) 90px", gap: 10, minWidth: 850, padding: "9px 14px", background: "var(--s1)", borderBottom: "1px solid var(--line)" }}>{["Data/hora", "Origem", "Evento", "Descrição", "Status"].map((h) => <div key={h} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>{h}</div>)}</div>
        {carregando && !erros ? <div style={{ padding: 32, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Carregando…</div> : (erros?.eventos ?? []).length === 0 ? <div style={{ padding: 32, textAlign: "center", fontSize: 11, color: "var(--ok)" }}>Nenhum erro registrado no período carregado.</div> : (erros?.eventos ?? []).map((e) => <div key={e.id} onClick={() => setDrawer({ tipo: "log", item: e })} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "145px 120px minmax(160px,1fr) minmax(240px,1.4fr) 90px", gap: 10, minWidth: 850, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line2)", cursor: "pointer" }}>
          <div className="zip-mono" style={{ fontSize: 10.5, color: "var(--soft)" }}>{dataHora(e.criado_em)}</div>
          <div style={{ fontSize: 11, fontWeight: 600 }}>{e.origem}</div>
          <div style={{ fontSize: 11.5, fontWeight: 600 }}>{e.codigo || e.nivel}</div>
          <div style={{ fontSize: 10.5, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.mensagem}</div>
          <span style={zipChip(nivelKind(e.nivel))}>{e.nivel}</span>
        </div>)}
      </div>
    </div> : <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><h2 style={{ fontSize: 15 }}>Acessos ao aplicativo</h2><div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Instalação PWA, primeiro acesso, último acesso.</div></div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, height: 30, border: "1px solid var(--line)", borderRadius: 8, background: "var(--s0)", padding: "0 9px" }}><span style={{ color: "var(--soft)", fontSize: 11 }}>⌕</span><input value={buscaAcesso} onChange={(e) => setBuscaAcesso(e.target.value)} placeholder="Buscar cliente..." style={{ width: 170, border: 0, outline: "none", background: "transparent", color: "var(--ink)", fontSize: 10.5 }} /></div>
      </div>
      <div style={{ overflow: "auto", maxHeight: 560 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(170px,1.2fr) 100px 145px 145px 100px 100px", gap: 10, minWidth: 900, padding: "9px 14px", background: "var(--s1)", borderBottom: "1px solid var(--line)" }}>{["Cliente", "PWA", "Primeiro acesso", "Último acesso", "Dispositivo", "Status"].map((h) => <div key={h} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>{h}</div>)}</div>
        {carregando && !dados ? <div style={{ padding: 32, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Carregando…</div> : rows.length === 0 ? <div style={{ padding: 32, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Nenhuma cliente encontrada.</div> : rows.map((item) => { const semAcesso = !item.last_access_at || Date.now() - new Date(item.last_access_at).getTime() > 7 * 86400000; return <div key={item.cliente_id} onClick={() => setDrawer({ tipo: "access", item })} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "minmax(170px,1.2fr) 100px 145px 145px 100px 100px", gap: 10, minWidth: 900, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line2)", cursor: "pointer" }}>
          <div><div style={{ fontSize: 12, fontWeight: 700 }}>{item.cliente?.nome_completo ?? "Cliente"}</div><div style={{ fontSize: 9.5, color: "var(--soft)" }}>{item.cliente?.cpf ?? ""}</div></div>
          <span style={zipChip(item.is_pwa_installed ? "ok" : "neutral")}>{item.is_pwa_installed ? "Instalado" : "Não instalado"}</span>
          <div className="zip-mono" style={{ fontSize: 10.5, color: "var(--soft)" }}>{dataHora(item.first_access_at)}</div>
          <div className="zip-mono" style={{ fontSize: 10.5, color: "var(--soft)" }}>{dataHora(item.last_access_at)}</div>
          <div style={{ fontSize: 10.5, color: "var(--soft)" }}>{item.device_type ?? "—"}</div>
          <span style={zipChip(semAcesso ? "warn" : "ok")}>{semAcesso ? "Sem acesso recente" : "Ativa"}</span>
        </div>; })}
      </div>
    </div>}

    {drawer && <>
      <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", zIndex: 60 }} onClick={() => setDrawer(null)} />
      <aside className="zip-animate-slide-in" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 61, width: "min(396px,100vw)", background: "var(--s0)", borderLeft: "1px solid var(--line)", boxShadow: "var(--sh)", overflowY: "auto" }}>
        <div style={{ padding: "14px 15px 12px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div><div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--rose)" }}>{drawer.tipo === "log" ? "Log operacional" : "Acesso ao aplicativo"}</div><h2 style={{ fontSize: 16, marginTop: 4 }}>{drawer.tipo === "log" ? drawer.item.codigo || drawer.item.nivel : drawer.item.cliente?.nome_completo}</h2></div>
          <button onClick={() => setDrawer(null)} style={{ height: 28, width: 28, borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 13 }}>✕</button>
        </div>
        <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
          {drawer.tipo === "log" ? [["Horário", dataHora(drawer.item.criado_em)], ["Origem", drawer.item.origem], ["Rota", drawer.item.rota || "—"], ["HTTP", String(drawer.item.status_http ?? "—")], ["Mensagem", drawer.item.mensagem]].map(([l, v]) => <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>{l}</span><span style={{ fontWeight: 600, textAlign: "right", maxWidth: "62%" }}>{v}</span></div>)
            : [["PWA instalado", drawer.item.is_pwa_installed ? "Sim" : "Não"], ["Primeiro acesso", dataHora(drawer.item.first_access_at)], ["Último acesso", dataHora(drawer.item.last_access_at)], ["Dispositivo", drawer.item.device_type ?? "—"], ["Notificações", drawer.item.notification_permission ?? "—"]].map(([l, v]) => <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>{l}</span><span style={{ fontWeight: 600 }}>{v}</span></div>)}
          <div style={{ marginTop: 4, border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 10, padding: 10, fontSize: 10.5, color: "var(--soft)", lineHeight: 1.5 }}>Nenhum segredo, token ou payload sensível é exibido neste resumo.</div>
        </div>
      </aside>
    </>}
  </div>;
}
