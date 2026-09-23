"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";

/**
 * Reprodução pixel a pixel de Admin Relatorios.dc.html: tabs por módulo,
 * lista agrupada com sticky header, drawer com filtros/colunas/resumo/
 * gráfico/prévia/geração. Os 68 relatórios reais e a geração de PDF/XLSX
 * (Fase 10) continuam os mesmos — só a marcação foi reescrita.
 */

interface RelatorioDef { id: string; modulo: string; nome: string; desc: string; icone: string; }
interface ModuloInfo { label: string; sub: string; icone: string; }
interface GrupoRelatorios { modulo: string; label: string; sub: string; icone: string; itens: RelatorioDef[]; }
interface CatalogoResposta { modulos: Record<string, ModuloInfo>; grupos: GrupoRelatorios[]; total: number; }
interface Filtros { periodoInicio?: string; periodoFim?: string; busca?: string; }
interface PreviewResposta { relatorio: RelatorioDef; colunas: string[]; linhas: string[][]; resumo: { label: string; value: string }[]; totalRegistros: number; indisponivel?: string; }
interface HistoricoItem { id: string; relatorio_id: string; relatorioNome: string; formato: string; total_linhas: number; nome_arquivo: string; geradoPorNome: string; created_at: string; }

const PERIODOS = [
  { id: "todos", label: "Todos os registros" },
  { id: "30d", label: "Últimos 30 dias" },
  { id: "mes_atual", label: "Mês atual" },
  { id: "mes_anterior", label: "Mês anterior" },
  { id: "personalizado", label: "Personalizado" },
] as const;

const MODULO_KIND: Record<string, ZipKind> = { clientes: "rose", financeiro: "ok", agenda: "blue", previsoes: "warn", operacao: "neutral", equipe: "rose", integracoes: "blue" };

function calcularPeriodo(opcao: string, inicioCustom: string, fimCustom: string): Filtros {
  const hoje = new Date();
  if (opcao === "30d") { const inicio = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000); return { periodoInicio: inicio.toISOString().slice(0, 10), periodoFim: hoje.toISOString().slice(0, 10) }; }
  if (opcao === "mes_atual") { const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1); return { periodoInicio: inicio.toISOString().slice(0, 10), periodoFim: hoje.toISOString().slice(0, 10) }; }
  if (opcao === "mes_anterior") { const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1); const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0); return { periodoInicio: inicio.toISOString().slice(0, 10), periodoFim: fim.toISOString().slice(0, 10) }; }
  if (opcao === "personalizado") return { periodoInicio: inicioCustom || undefined, periodoFim: fimCustom || undefined };
  return {};
}

async function baixarArquivo(relatorioId: string, formato: "pdf" | "xlsx", filtros: Filtros, periodoLabel: string) {
  const resposta = await fetch("/api/admin/relatorios/gerar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relatorioId, formato, filtros, periodoLabel }) });
  if (!resposta.ok) { const corpo = await resposta.json().catch(() => ({})); throw new Error(corpo?.erro ?? "Não foi possível gerar o relatório."); }
  const blob = await resposta.blob();
  const nomeArquivo = resposta.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `relatorio.${formato}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nomeArquivo;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const selectStyle: React.CSSProperties = { height: 34, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", padding: "0 10px", fontSize: 10.5 };

export default function RelatoriosCatalogo() {
  const [catalogo, setCatalogo] = useState<CatalogoResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [categoria, setCategoria] = useState("all");
  const [busca, setBusca] = useState("");
  const [periodoOpcao, setPeriodoOpcao] = useState<string>("todos");
  const [inicioCustom, setInicioCustom] = useState("");
  const [fimCustom, setFimCustom] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("Todos os status");
  const [formatoFiltro, setFormatoFiltro] = useState("Todos os formatos");

  const [drawerAberto, setDrawerAberto] = useState(false);
  const [selecionado, setSelecionado] = useState<RelatorioDef | null>(null);
  const [colunasAtivas, setColunasAtivas] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PreviewResposta | null>(null);
  const [carregandoPreview, setCarregandoPreview] = useState(false);
  const [gerando, setGerando] = useState<"idle" | "gerando" | "pronto">("idle");

  const [historico, setHistorico] = useState<HistoricoItem[]>([]);

  useEffect(() => {
    let ativo = true;
    fetch("/api/admin/relatorios/catalogo", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (ativo) setCatalogo(d); })
      .catch(() => toast.error("Não foi possível carregar o catálogo de relatórios.")).finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    let ativo = true;
    fetch("/api/admin/relatorios/historico", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (ativo) setHistorico(d.historico ?? []); }).catch(() => {});
    return () => { ativo = false; };
  }, [gerando]);

  const filtros = useMemo(() => ({ ...calcularPeriodo(periodoOpcao, inicioCustom, fimCustom), busca: busca || undefined }), [periodoOpcao, inicioCustom, fimCustom, busca]);
  const periodoLabel = PERIODOS.find((p) => p.id === periodoOpcao)?.label ?? "Todos os registros";

  const grupos = useMemo(() => {
    if (!catalogo) return [];
    const termo = busca.trim().toLowerCase();
    return catalogo.grupos
      .filter((g) => categoria === "all" || g.modulo === categoria)
      .map((g) => ({ ...g, itens: g.itens.filter((r) => !termo || `${r.nome} ${r.desc}`.toLowerCase().includes(termo)) }))
      .filter((g) => g.itens.length > 0);
  }, [catalogo, categoria, busca]);

  const abas = useMemo(() => {
    if (!catalogo) return [];
    return [{ id: "all", label: "TODOS", count: catalogo.total }, ...catalogo.grupos.map((g) => ({ id: g.modulo, label: g.label.toUpperCase(), count: g.itens.length }))];
  }, [catalogo]);

  async function abrirRelatorio(relatorio: RelatorioDef) {
    setSelecionado(relatorio); setDrawerAberto(true); setGerando("idle"); setCarregandoPreview(true);
    try {
      const resposta = await fetch("/api/admin/relatorios/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relatorioId: relatorio.id, filtros }) });
      const dados: PreviewResposta = await resposta.json();
      if (!resposta.ok) throw new Error((dados as any)?.erro ?? "Falha ao gerar prévia.");
      setPreview(dados);
      setColunasAtivas(new Set(dados.colunas));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível carregar a prévia."); setPreview(null); }
    finally { setCarregandoPreview(false); }
  }

  async function exportarRapido(relatorio: RelatorioDef, formato: "pdf" | "xlsx") {
    try { await baixarArquivo(relatorio.id, formato, filtros, periodoLabel); toast.success(`${relatorio.nome} exportado em ${formato.toUpperCase()}.`); setGerando((g) => (g === "idle" ? "pronto" : g)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível exportar."); }
  }

  async function gerarNoDrawer(formato: "pdf" | "xlsx") {
    if (!selecionado) return;
    setGerando("gerando");
    try { await baixarArquivo(selecionado.id, formato, filtros, periodoLabel); setGerando("pronto"); toast.success("Relatório exportado com sucesso."); }
    catch (error) { setGerando("idle"); toast.error(error instanceof Error ? error.message : "Não foi possível gerar o relatório."); }
  }

  return <div className="zip-admin" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
    <div style={{ flex: "1 1 720px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "2px 2px 14px" }}>
        <div><h1 style={{ fontSize: 27 }}>Relatórios</h1><p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--soft)", maxWidth: "76ch" }}>Gere relatórios operacionais, financeiros e gerenciais de toda a Sra. Luck em PDF ou Excel.</p></div>
      </div>

      {carregando || !catalogo ? <div style={{ padding: 40, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Carregando catálogo…</div> : <>
        <div style={{ display: "flex", gap: 5, padding: 3, borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", maxWidth: "100%", overflow: "auto", marginBottom: 12, boxShadow: "var(--tabs-shadow)" }}>
          {abas.map((aba) => { const on = categoria === aba.id; return <button key={aba.id} onClick={() => setCategoria(aba.id)} style={{ height: 30, padding: "0 11px", borderRadius: 9, border: on ? "1px solid var(--line)" : "1px solid transparent", background: on ? "var(--s0)" : "transparent", color: on ? "var(--ink)" : "var(--soft)", fontSize: 9.6, fontWeight: 800, letterSpacing: ".06em", whiteSpace: "nowrap" }}>{aba.label} <span style={{ opacity: .62 }}>{aba.count}</span></button>; })}
        </div>

        <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden", boxShadow: "var(--panel-shadow)" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px", display: "flex", alignItems: "center", gap: 7, height: 34, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", padding: "0 10px" }}>
              <span style={{ color: "var(--soft)", fontSize: 12 }}>⌕</span>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar relatório..." style={{ width: "100%", border: 0, outline: "none", background: "transparent", color: "var(--ink)", fontSize: 11.5 }} />
            </div>
            <select value={periodoOpcao} onChange={(e) => setPeriodoOpcao(e.target.value)} style={selectStyle}>{PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            {periodoOpcao === "personalizado" && <>
              <input type="date" value={inicioCustom} onChange={(e) => setInicioCustom(e.target.value)} style={selectStyle} />
              <input type="date" value={fimCustom} onChange={(e) => setFimCustom(e.target.value)} style={selectStyle} />
            </>}
            <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)} style={selectStyle}><option>Todos os status</option><option>Ativo</option><option>Pendente</option><option>Concluído</option></select>
            <select value={formatoFiltro} onChange={(e) => setFormatoFiltro(e.target.value)} style={selectStyle}><option>Todos os formatos</option><option>PDF</option><option>Excel</option></select>
          </div>

          <div style={{ overflow: "auto", maxHeight: 610 }}>
            {grupos.length === 0 ? <div style={{ padding: "54px 18px", textAlign: "center" }}><div style={{ fontSize: 28, color: "var(--soft)" }}>⌕</div><div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700 }}>Nenhum relatório encontrado</div><div style={{ marginTop: 4, fontSize: 10.5, color: "var(--soft)" }}>Ajuste a busca ou selecione outra categoria.</div></div>
              : grupos.map((g) => { const kind = MODULO_KIND[g.modulo] ?? "neutral"; return <div key={g.modulo}>
                <div style={{ padding: "10px 14px", background: "var(--s1)", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 24, height: 24, borderRadius: 7, background: `var(--${kind === "ok" ? "okbg" : kind === "bad" ? "badbg" : kind === "warn" ? "gobg" : kind === "rose" ? "robg" : kind === "blue" ? "bluebg" : "line2"})`, display: "grid", placeItems: "center", fontSize: 8, fontWeight: 900, flex: "none" }}>{g.icone}</span><div><div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".03em" }}>{g.label}</div><div style={{ marginTop: 1, fontSize: 9.5, color: "var(--soft)" }}>{g.sub}</div></div></div>
                  <span style={zipChip(kind)}>{g.itens.length} relatórios</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.2fr) minmax(260px,1.4fr) 86px 60px 60px 76px", gap: 8, minWidth: 780, padding: "7px 14px", background: "var(--panel)", borderBottom: "1px solid var(--line2)" }}>
                  {["Relatório", "Descrição", "Módulo", "PDF", "Excel", "Ação"].map((h) => <div key={h} style={{ fontSize: 8.2, fontWeight: 700, letterSpacing: ".13em", textTransform: "uppercase", color: "var(--rose)" }}>{h}</div>)}
                </div>
                {g.itens.map((r) => <div key={r.id} onClick={() => abrirRelatorio(r)} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.2fr) minmax(260px,1.4fr) 86px 60px 60px 76px", gap: 8, minWidth: 780, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line2)", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 24, height: 24, borderRadius: 7, background: `var(--${kind === "ok" ? "okbg" : kind === "bad" ? "badbg" : kind === "warn" ? "gobg" : kind === "rose" ? "robg" : kind === "blue" ? "bluebg" : "line2"})`, display: "grid", placeItems: "center", fontSize: 8, fontWeight: 900, flex: "none" }}>{r.icone}</span><div style={{ fontSize: 11.5, fontWeight: 700 }}>{r.nome}</div></div>
                  <div style={{ fontSize: 10.3, color: "var(--soft)", lineHeight: 1.4 }}>{r.desc}</div>
                  <span style={zipChip(kind)}>{g.label}</span>
                  <button onClick={(e) => { e.stopPropagation(); exportarRapido(r, "pdf"); }} title="Gerar PDF" style={{ height: 27, border: "1px solid var(--line)", borderRadius: 8, background: "var(--s0)", color: "var(--bad)", fontSize: 9.5, fontWeight: 800 }}>PDF</button>
                  <button onClick={(e) => { e.stopPropagation(); exportarRapido(r, "xlsx"); }} title="Gerar Excel" style={{ height: 27, border: "1px solid var(--line)", borderRadius: 8, background: "var(--s0)", color: "var(--ok)", fontSize: 9.5, fontWeight: 800 }}>XLSX</button>
                  <button onClick={(e) => { e.stopPropagation(); abrirRelatorio(r); }} style={{ height: 27, border: "1px solid var(--bg)", borderRadius: 8, background: "var(--bg)", color: "var(--on-accent)", fontSize: 9.5, fontWeight: 700 }}>Gerar</button>
                </div>)}
              </div>; })}
          </div>
        </div>

        <div style={{ marginTop: 12, border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div><h2 style={{ fontSize: 15 }}>Histórico de exportações</h2><div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Últimos relatórios gerados.</div></div></div>
          <div style={{ overflow: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(190px,1.3fr) 130px 135px 70px 110px 86px", gap: 8, minWidth: 760, padding: "8px 14px", background: "var(--s1)", borderBottom: "1px solid var(--line)" }}>
              {["Relatório", "Período", "Data/hora", "Formato", "Usuário", "Ação"].map((h) => <div key={h} style={{ fontSize: 8.2, fontWeight: 700, letterSpacing: ".13em", textTransform: "uppercase", color: "var(--rose)" }}>{h}</div>)}
            </div>
            {historico.length === 0 ? <div style={{ padding: "24px 14px", textAlign: "center", fontSize: 10.5, color: "var(--soft)" }}>Nenhuma exportação registrada ainda.</div> : historico.map((h) => <div key={h.id} style={{ display: "grid", gridTemplateColumns: "minmax(190px,1.3fr) 130px 135px 70px 110px 86px", gap: 8, minWidth: 760, alignItems: "center", padding: "9px 14px", borderBottom: "1px solid var(--line2)" }}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>{h.relatorioNome}</div>
              <div style={{ fontSize: 10, color: "var(--soft)" }}>{periodoLabel}</div>
              <div style={{ fontSize: 10, color: "var(--soft)" }}>{new Date(h.created_at).toLocaleString("pt-BR")}</div>
              <span style={zipChip(h.formato === "pdf" ? "bad" : "ok")}>{h.formato.toUpperCase()}</span>
              <div style={{ fontSize: 10, color: "var(--soft)" }}>{h.geradoPorNome}</div>
              <button onClick={() => baixarArquivo(h.relatorio_id, h.formato as "pdf" | "xlsx", filtros, periodoLabel).catch(() => toast.error("Arquivo não pôde ser gerado novamente."))} style={{ height: 27, border: "1px solid var(--line)", borderRadius: 8, background: "var(--s0)", color: "var(--bg)", fontSize: 9.5, fontWeight: 700 }}>Baixar</button>
            </div>)}
          </div>
        </div>
      </>}
    </div>

    {drawerAberto && selecionado && <aside className="zip-animate-slide-in" style={{ width: 398, flex: "none", position: "sticky", top: 16, maxHeight: "calc(100vh - 32px)", overflow: "auto", border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 16, boxShadow: "var(--sh)", backdropFilter: "blur(18px)" }}>
      <div style={{ padding: "14px 15px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--rose)" }}>{catalogo?.modulos[selecionado.modulo]?.label}</div><h2 style={{ fontSize: 17, marginTop: 4 }}>{selecionado.nome}</h2><div style={{ marginTop: 4, fontSize: 10.5, color: "var(--soft)", lineHeight: 1.45 }}>{selecionado.desc}</div></div>
        <button onClick={() => setDrawerAberto(false)} style={{ height: 28, width: 28, borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 13 }}>✕</button>
      </div>

      {carregandoPreview ? <div style={{ padding: 40, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Carregando prévia…</div> : preview?.indisponivel ? <div style={{ padding: "13px 15px" }}>
        <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 9 }}>Sem dados disponíveis</div>
        <div style={{ border: "1px solid var(--gobg)", background: "var(--gobg)", borderRadius: 10, padding: 10, fontSize: 10.5, color: "var(--ink)", lineHeight: 1.5 }}>{preview.indisponivel}</div>
      </div> : preview && <>
        <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 9 }}>Resumo do período</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 7 }}>{preview.resumo.map((s) => <div key={s.label} style={{ border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 9, padding: 9 }}><div style={{ fontSize: 9, color: "var(--soft)" }}>{s.label}</div><div className="zip-mono" style={{ marginTop: 3, fontSize: 13, fontWeight: 800 }}>{s.value}</div></div>)}</div>
        </div>

        <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}><div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>Colunas do relatório</div><span style={{ fontSize: 9.5, color: "var(--soft)" }}>personalizável</span></div>
          <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>{preview.colunas.map((c) => <label key={c} style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 8, padding: "7px 8px", fontSize: 10 }}><input type="checkbox" checked={colunasAtivas.has(c)} onChange={() => setColunasAtivas((atual) => { const n = new Set(atual); n.has(c) ? n.delete(c) : n.add(c); return n; })} /><span>{c}</span></label>)}</div>
        </div>

        <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}><div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>Prévia dos dados</div><span style={{ fontSize: 9.5, color: "var(--soft)" }}>{preview.linhas.length} de {preview.totalRegistros}</span></div>
          <div style={{ marginTop: 9, overflow: "auto", border: "1px solid var(--line)", borderRadius: 9 }}>
            <table style={{ width: "100%", fontSize: 9.5, borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "var(--s1)" }}>{preview.colunas.filter((c) => colunasAtivas.has(c)).map((c) => <th key={c} style={{ padding: "7px 8px", textAlign: "left", fontSize: 7.8, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--rose)" }}>{c}</th>)}</tr></thead>
              <tbody>{preview.linhas.map((linha, i) => <tr key={i} style={{ borderTop: "1px solid var(--line2)" }}>{preview.colunas.map((c, j) => colunasAtivas.has(c) && <td key={c} style={{ padding: "7px 8px", color: "var(--soft)" }}>{linha[j]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>

        <div style={{ padding: "13px 15px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 9 }}>
            <span style={zipChip(gerando === "pronto" ? "ok" : gerando === "gerando" ? "warn" : "neutral")}>{gerando === "pronto" ? "Concluído" : gerando === "gerando" ? "Gerando..." : "Pronto para gerar"}</span>
            <span style={{ fontSize: 9, color: "var(--soft)" }}>Geração real de PDF/XLSX</span>
          </div>
          <button disabled={gerando === "gerando"} onClick={() => gerarNoDrawer("pdf")} style={{ width: "100%", height: 36, borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "var(--on-accent)", fontSize: 11, fontWeight: 800, opacity: gerando === "gerando" ? .6 : 1 }}>{gerando === "pronto" ? "Gerar novamente" : "Gerar relatório"}</button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <button disabled={gerando === "gerando"} onClick={() => gerarNoDrawer("pdf")} style={{ height: 34, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--bad)", fontSize: 10.5, fontWeight: 800 }}>↓ Baixar PDF</button>
            <button disabled={gerando === "gerando"} onClick={() => gerarNoDrawer("xlsx")} style={{ height: 34, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ok)", fontSize: 10.5, fontWeight: 800 }}>↓ Baixar Excel</button>
          </div>
        </div>
      </>}
    </aside>}
  </div>;
}
