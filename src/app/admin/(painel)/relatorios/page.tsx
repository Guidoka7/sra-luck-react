"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, History, Search, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, SectionHeading } from "@/components/admin/ExecutiveUI";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

interface RelatorioDef { id: string; modulo: string; nome: string; desc: string; icone: string; }
interface ModuloInfo { label: string; sub: string; icone: string; }
interface GrupoRelatorios { modulo: string; label: string; sub: string; icone: string; itens: RelatorioDef[]; }
interface CatalogoResposta { modulos: Record<string, ModuloInfo>; grupos: GrupoRelatorios[]; total: number; }
interface Filtros { periodoInicio?: string; periodoFim?: string; busca?: string; }
interface PreviewResposta { relatorio: RelatorioDef; colunas: string[]; linhas: string[][]; resumo: { label: string; value: string }[]; totalRegistros: number; indisponivel?: string; }
interface HistoricoItem { id: string; relatorioNome: string; formato: string; total_linhas: number; nome_arquivo: string; geradoPorNome: string; created_at: string; }

const PERIODOS = [
  { id: "todos", label: "Todos os registros" },
  { id: "30d", label: "Últimos 30 dias" },
  { id: "mes_atual", label: "Mês atual" },
  { id: "mes_anterior", label: "Mês anterior" },
  { id: "personalizado", label: "Personalizado" },
] as const;

function calcularPeriodo(opcao: string, inicioCustom: string, fimCustom: string): Filtros {
  const hoje = new Date();
  if (opcao === "30d") {
    const inicio = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { periodoInicio: inicio.toISOString().slice(0, 10), periodoFim: hoje.toISOString().slice(0, 10) };
  }
  if (opcao === "mes_atual") {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return { periodoInicio: inicio.toISOString().slice(0, 10), periodoFim: hoje.toISOString().slice(0, 10) };
  }
  if (opcao === "mes_anterior") {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return { periodoInicio: inicio.toISOString().slice(0, 10), periodoFim: fim.toISOString().slice(0, 10) };
  }
  if (opcao === "personalizado") return { periodoInicio: inicioCustom || undefined, periodoFim: fimCustom || undefined };
  return {};
}

async function baixarArquivo(relatorioId: string, formato: "pdf" | "xlsx", filtros: Filtros, periodoLabel: string) {
  const resposta = await fetch("/api/admin/relatorios/gerar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relatorioId, formato, filtros, periodoLabel }),
  });
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({}));
    throw new Error(corpo?.erro ?? "Não foi possível gerar o relatório.");
  }
  const blob = await resposta.blob();
  const nomeArquivo = resposta.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `relatorio.${formato}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function RelatoriosPage() {
  const [catalogo, setCatalogo] = useState<CatalogoResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [categoria, setCategoria] = useState("all");
  const [busca, setBusca] = useState("");
  const [periodoOpcao, setPeriodoOpcao] = useState<string>("todos");
  const [inicioCustom, setInicioCustom] = useState("");
  const [fimCustom, setFimCustom] = useState("");

  const [drawerAberto, setDrawerAberto] = useState(false);
  const [selecionado, setSelecionado] = useState<RelatorioDef | null>(null);
  const [colunasAtivas, setColunasAtivas] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PreviewResposta | null>(null);
  const [carregandoPreview, setCarregandoPreview] = useState(false);
  const [gerando, setGerando] = useState<"idle" | "gerando" | "pronto">("idle");

  const [historico, setHistorico] = useState<HistoricoItem[]>([]);
  const [mostrarHistorico, setMostrarHistorico] = useState(true);

  useEffect(() => {
    let ativo = true;
    fetch("/api/admin/relatorios/catalogo", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (ativo) setCatalogo(d); })
      .catch(() => toast.error("Não foi possível carregar o catálogo de relatórios."))
      .finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    let ativo = true;
    fetch("/api/admin/relatorios/historico", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (ativo) setHistorico(d.historico ?? []); })
      .catch(() => {});
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
    return [{ id: "all", label: "Todos", count: catalogo.total }, ...catalogo.grupos.map((g) => ({ id: g.modulo, label: g.label, count: g.itens.length }))];
  }, [catalogo]);

  async function abrirRelatorio(relatorio: RelatorioDef) {
    setSelecionado(relatorio);
    setDrawerAberto(true);
    setGerando("idle");
    setCarregandoPreview(true);
    try {
      const resposta = await fetch("/api/admin/relatorios/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relatorioId: relatorio.id, filtros }),
      });
      const dados: PreviewResposta = await resposta.json();
      if (!resposta.ok) throw new Error((dados as any)?.erro ?? "Falha ao gerar prévia.");
      setPreview(dados);
      setColunasAtivas(new Set(dados.colunas));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar a prévia.");
      setPreview(null);
    } finally {
      setCarregandoPreview(false);
    }
  }

  async function exportarRapido(relatorio: RelatorioDef, formato: "pdf" | "xlsx") {
    try {
      await baixarArquivo(relatorio.id, formato, filtros, periodoLabel);
      toast.success(`${relatorio.nome} exportado em ${formato.toUpperCase()}.`);
      setGerando((g) => (g === "idle" ? "pronto" : g));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível exportar.");
    }
  }

  async function gerarNoDrawer(formato: "pdf" | "xlsx") {
    if (!selecionado) return;
    setGerando("gerando");
    try {
      await baixarArquivo(selecionado.id, formato, filtros, periodoLabel);
      setGerando("pronto");
      toast.success("Relatório exportado com sucesso.");
    } catch (error) {
      setGerando("idle");
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o relatório.");
    }
  }

  return <div className="space-y-3 pb-8">
    <PageHeader eyebrow="Relatórios" title="Relatórios operacionais e gerenciais" description="Gere relatórios reais de Clientes, Financeiro, Agenda, Previsões, Operação, Equipe e Integrações em PDF ou Excel." />

    {carregando || !catalogo ? <Panel className="p-8 text-center text-sm text-clay/45">Carregando catálogo…</Panel> : <>
      <div className="flex gap-1.5 overflow-auto rounded-xl border border-burgundy/10 bg-white/70 p-1.5 dark:border-white/10 dark:bg-white/[0.04]">
        {abas.map((aba) => <button key={aba.id} onClick={() => setCategoria(aba.id)} className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-[0.68rem] font-semibold transition", categoria === aba.id ? "bg-burgundy text-cream" : "text-clay/60 hover:bg-blush/60")}>{aba.label} <span className="opacity-60">{aba.count}</span></button>)}
      </div>

      <Panel className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/8 p-3">
          <div className="relative flex-1" style={{ minWidth: 220 }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-clay/30" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar relatório…" className="pl-9" />
          </div>
          <select value={periodoOpcao} onChange={(e) => setPeriodoOpcao(e.target.value)} className="h-9 rounded-lg border border-burgundy/15 bg-white/80 px-2.5 text-[0.68rem] text-burgundy dark:bg-white/[0.04] dark:text-pearl">
            {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {periodoOpcao === "personalizado" && <>
            <input type="date" value={inicioCustom} onChange={(e) => setInicioCustom(e.target.value)} className="h-9 rounded-lg border border-burgundy/15 bg-white/80 px-2 text-[0.65rem] text-burgundy dark:bg-white/[0.04] dark:text-pearl" />
            <input type="date" value={fimCustom} onChange={(e) => setFimCustom(e.target.value)} className="h-9 rounded-lg border border-burgundy/15 bg-white/80 px-2 text-[0.65rem] text-burgundy dark:bg-white/[0.04] dark:text-pearl" />
          </>}
        </div>

        <div className="max-h-[620px] overflow-auto">
          {grupos.length === 0 ? <div className="p-10 text-center text-sm text-clay/45">Nenhum relatório encontrado para essa busca.</div> : grupos.map((g) => <div key={g.modulo}>
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-white/8 bg-blush/40 px-3.5 py-2 dark:bg-white/[0.03]">
              <div className="flex items-center gap-2"><span className="text-xs">{g.icone}</span><div><p className="text-[0.72rem] font-bold text-burgundy dark:text-pearl">{g.label}</p><p className="text-[0.58rem] text-clay/45">{g.sub}</p></div></div>
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[0.58rem] font-semibold text-burgundy/70 dark:bg-white/10">{g.itens.length} relatórios</span>
            </div>
            {g.itens.map((r) => <div key={r.id} onClick={() => abrirRelatorio(r)} className="flex cursor-pointer items-center gap-3 border-b border-white/6 px-3.5 py-2.5 hover:bg-blush/25 dark:hover:bg-white/[0.03]">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-blush/60 text-[0.6rem] font-bold text-burgundy dark:bg-white/10">{r.icone}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-[0.72rem] font-semibold text-burgundy dark:text-pearl">{r.nome}</p><p className="truncate text-[0.6rem] text-clay/45">{r.desc}</p></div>
              <button onClick={(e) => { e.stopPropagation(); exportarRapido(r, "pdf"); }} title="Gerar PDF" className="h-7 rounded-md border border-burgundy/15 px-2 text-[0.6rem] font-bold text-alert hover:bg-alert/10">PDF</button>
              <button onClick={(e) => { e.stopPropagation(); exportarRapido(r, "xlsx"); }} title="Gerar Excel" className="h-7 rounded-md border border-burgundy/15 px-2 text-[0.6rem] font-bold text-success hover:bg-success/10">XLSX</button>
              <button onClick={(e) => { e.stopPropagation(); abrirRelatorio(r); }} className="h-7 rounded-md bg-burgundy px-2.5 text-[0.6rem] font-semibold text-cream">Gerar</button>
            </div>)}
          </div>)}
        </div>
      </Panel>

      <Panel className="overflow-hidden p-0">
        <button onClick={() => setMostrarHistorico((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-xs font-semibold text-burgundy dark:text-pearl"><History className="h-3.5 w-3.5" />Histórico de exportações</span>
          <ChevronDown className={cn("h-4 w-4 text-clay/40 transition-transform", mostrarHistorico && "rotate-180")} />
        </button>
        {mostrarHistorico && <div className="overflow-auto border-t border-white/8">
          {historico.length === 0 ? <p className="p-6 text-center text-[0.65rem] text-clay/40">Nenhuma exportação registrada ainda.</p> : <div className="min-w-[640px]">
            <div className="grid grid-cols-[1.4fr_0.7fr_0.9fr_0.7fr] gap-2 border-b border-white/8 bg-white/[0.03] px-3.5 py-2 text-[0.55rem] font-bold uppercase tracking-wider text-clay/40">
              <span>Relatório</span><span>Formato</span><span>Quando</span><span>Usuário</span>
            </div>
            {historico.map((h) => <div key={h.id} className="grid grid-cols-[1.4fr_0.7fr_0.9fr_0.7fr] items-center gap-2 border-b border-white/6 px-3.5 py-2 text-[0.65rem]">
              <span className="truncate font-semibold text-burgundy dark:text-pearl">{h.relatorioNome}</span>
              <span className={cn("inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[0.55rem] font-bold", h.formato === "pdf" ? "bg-alert/10 text-alert" : "bg-success/10 text-success")}>{h.formato.toUpperCase()}</span>
              <span className="text-clay/50">{new Date(h.created_at).toLocaleString("pt-BR")}</span>
              <span className="truncate text-clay/50">{h.geradoPorNome}</span>
            </div>)}
          </div>}
        </div>}
      </Panel>
    </>}

    {drawerAberto && selecionado && <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setDrawerAberto(false)} />
      <aside className="animate-slideInRight fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-white/10 bg-white shadow-2xl dark:bg-[#141619]">
        <div className="flex items-start justify-between gap-3 border-b border-white/8 p-4">
          <div className="min-w-0"><p className="text-[0.6rem] font-bold uppercase tracking-wider text-rose">{catalogo?.modulos[selecionado.modulo]?.label}</p><h2 className="mt-1 text-base font-semibold text-burgundy dark:text-pearl">{selecionado.nome}</h2><p className="mt-1 text-[0.65rem] text-clay/50">{selecionado.desc}</p></div>
          <button onClick={() => setDrawerAberto(false)} className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-burgundy/15 text-clay/50"><X className="h-3.5 w-3.5" /></button>
        </div>

        {carregandoPreview ? <div className="p-8 text-center text-xs text-clay/45">Carregando prévia…</div> : preview?.indisponivel ? <div className="p-4"><SectionHeading title="Sem dados disponíveis" /><p className="rounded-lg border border-gold/30 bg-gold/10 p-3 text-[0.7rem] text-burgundy dark:text-pearl">{preview.indisponivel}</p></div> : preview && <>
          <div className="border-b border-white/8 p-4">
            <SectionHeading title="Resumo do período" />
            <div className="grid grid-cols-2 gap-2">{preview.resumo.map((s) => <div key={s.label} className="rounded-lg border border-white/8 bg-blush/20 p-2.5 dark:bg-white/[0.03]"><p className="text-[0.58rem] text-clay/45">{s.label}</p><p className="mt-0.5 text-sm font-bold text-burgundy dark:text-pearl">{s.value}</p></div>)}</div>
          </div>

          <div className="border-b border-white/8 p-4">
            <div className="mb-2 flex items-center justify-between"><p className="text-[0.62rem] font-bold uppercase tracking-wider text-rose">Colunas do relatório</p><span className="text-[0.58rem] text-clay/40">personalizável</span></div>
            <div className="grid grid-cols-2 gap-1.5">{preview.colunas.map((c) => <label key={c} className="flex items-center gap-1.5 rounded-md border border-white/8 bg-blush/10 px-2 py-1.5 text-[0.6rem] dark:bg-white/[0.02]"><input type="checkbox" checked={colunasAtivas.has(c)} onChange={() => setColunasAtivas((atual) => { const n = new Set(atual); n.has(c) ? n.delete(c) : n.add(c); return n; })} />{c}</label>)}</div>
          </div>

          <div className="border-b border-white/8 p-4">
            <div className="mb-2 flex items-center justify-between"><p className="text-[0.62rem] font-bold uppercase tracking-wider text-rose">Prévia dos dados</p><span className="text-[0.58rem] text-clay/40">{preview.linhas.length} de {preview.totalRegistros} registros</span></div>
            <div className="overflow-auto rounded-lg border border-white/8"><table className="w-full text-[0.6rem]"><thead><tr className="bg-blush/30 dark:bg-white/[0.03]">{preview.colunas.filter((c) => colunasAtivas.has(c)).map((c) => <th key={c} className="px-2 py-1.5 text-left font-bold uppercase tracking-wide text-rose">{c}</th>)}</tr></thead><tbody>{preview.linhas.map((linha, i) => <tr key={i} className="border-t border-white/6">{preview.colunas.map((c, j) => colunasAtivas.has(c) && <td key={c} className="px-2 py-1.5 text-clay/70">{linha[j]}</td>)}</tr>)}</tbody></table></div>
          </div>

          <div className="p-4">
            <div className="mb-2 flex items-center justify-between text-[0.6rem] text-clay/45"><span>{periodoLabel}</span><span>{gerando === "pronto" ? "Concluído" : gerando === "gerando" ? "Gerando…" : "Pronto para gerar"}</span></div>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={gerando === "gerando"} onClick={() => gerarNoDrawer("pdf")} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-burgundy/15 text-[0.68rem] font-bold text-alert hover:bg-alert/10 disabled:opacity-50"><FileText className="h-3.5 w-3.5" />Baixar PDF</button>
              <button disabled={gerando === "gerando"} onClick={() => gerarNoDrawer("xlsx")} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-burgundy/15 text-[0.68rem] font-bold text-success hover:bg-success/10 disabled:opacity-50"><FileSpreadsheet className="h-3.5 w-3.5" />Baixar Excel</button>
            </div>
          </div>
        </>}
      </aside>
    </>}
  </div>;
}
