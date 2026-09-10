"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, ReceiptText, Search, X } from "lucide-react";
import { toast } from "sonner";
import { fetchInstant, getInstantCache, refreshInstant } from "@/lib/instantCache";
import { PageHeader, Panel, SectionHeading, StatusPill } from "@/components/admin/ExecutiveUI";
import { Portal } from "@/components/ui/Portal";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { cn, formatarMoeda } from "@/lib/utils";
import { formatarCpf } from "@/lib/cpf";
import type { Boleto, StatusBoleto } from "@/types/database";
import { STATUS_BOLETO_LABEL } from "@/types/database";

const STATUS_TONE: Record<StatusBoleto, "neutral" | "success" | "alert" | "gold"> = { nao_pago: "neutral", pago: "success", pendente_confirmacao: "gold", rejeitado: "alert" };

function formatarData(data: string | null) {
  if (!data) return "—";
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(ano, mes - 1, dia).toLocaleDateString("pt-BR");
}
function diasEmAtraso(data: string | null) {
  if (!data) return 0;
  const [ano, mes, dia] = data.split("-").map(Number);
  const vencimento = new Date(ano, mes - 1, dia); vencimento.setHours(0, 0, 0, 0);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((hoje.getTime() - vencimento.getTime()) / 86400000));
}

export default function PagamentosPage() { return <Suspense fallback={<SkeletonRows count={5} />}><PagamentosConteudo /></Suspense>; }

function PagamentosConteudo() {
  const searchParams = useSearchParams();
  const clienteIdFiltro = searchParams.get("cliente_id");
  const statusInicial = searchParams.get("status");
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState(statusInicial ?? "pendente_confirmacao");
  const [busca, setBusca] = useState("");
  const [boletoAtivo, setBoletoAtivo] = useState<Boleto | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [processando, setProcessando] = useState(false);

  async function carregar(force = false) {
    const params = new URLSearchParams();
    if (filtroStatus !== "todos") params.set("status", filtroStatus);
    if (clienteIdFiltro) params.set("cliente_id", clienteIdFiltro);
    const url = `/api/admin/boletos?${params.toString()}`;
    const cached = !force ? getInstantCache<{ boletos?: Boleto[] }>(url) : null;
    if (cached) { setBoletos(cached.boletos ?? []); setCarregando(false); } else setCarregando(true);
    try {
      const data = force ? await refreshInstant<{ boletos?: Boleto[] }>(url) : await fetchInstant<{ boletos?: Boleto[] }>(url);
      setBoletos(data.boletos ?? []); setSelecionados(new Set());
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível carregar os pagamentos."); }
    finally { setCarregando(false); }
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filtroStatus, clienteIdFiltro]);

  const boletosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = !termo ? boletos : boletos.filter((b) => b.clientes?.nome_completo.toLowerCase().includes(termo));
    return [...lista].sort((a, b) => { const atrasoA = diasEmAtraso(a.data_vencimento); const atrasoB = diasEmAtraso(b.data_vencimento); if (atrasoB !== atrasoA) return atrasoB - atrasoA; return Number(a.numero_parcela) - Number(b.numero_parcela); });
  }, [boletos, busca]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, { clienteId: string; nome: string; cpf: string; parcelas: Boleto[] }>();
    for (const boleto of boletosFiltrados) {
      if (!mapa.has(boleto.cliente_id)) mapa.set(boleto.cliente_id, { clienteId: boleto.cliente_id, nome: boleto.clientes?.nome_completo ?? "Cliente", cpf: boleto.clientes?.cpf ?? "", parcelas: [] });
      mapa.get(boleto.cliente_id)!.parcelas.push(boleto);
    }
    return Array.from(mapa.values()).sort((a, b) => { const aguardandoA = a.parcelas.filter((p) => p.status === "pendente_confirmacao").length; const aguardandoB = b.parcelas.filter((p) => p.status === "pendente_confirmacao").length; if (aguardandoB !== aguardandoA) return aguardandoB - aguardandoA; return a.nome.localeCompare(b.nome, "pt-BR"); });
  }, [boletosFiltrados]);

  function alternarSelecionado(id: string) { setSelecionados((atual) => { const novo = new Set(atual); novo.has(id) ? novo.delete(id) : novo.add(id); return novo; }); }
  async function marcarSelecionadosComoPagos() {
    if (!selecionados.size) return; setProcessando(true);
    try {
      const res = await fetch("/api/admin/boletos/lote", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selecionados), acao: "marcar_pago" }) });
      const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.erro ?? "Não foi possível marcar as parcelas como pagas.");
      toast.success(`${Number(data.total ?? 0)} parcela(s) marcada(s) como paga(s).`); await carregar(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível concluir a operação."); }
    finally { setProcessando(false); }
  }
  const pendentes = boletos.filter((b) => b.status === "pendente_confirmacao").length;

  return <div className="space-y-4 pb-8">
    <PageHeader eyebrow="Gestão" title="Pagamentos" description={pendentes > 0 ? `${pendentes} comprovante${pendentes > 1 ? "s" : ""} aguardando conferência.` : "Confira comprovantes e marque parcelas como pagas."} />
    <Panel className="p-4 sm:p-5">
      <SectionHeading title="Pagamentos" description="A conferência acontece diretamente nesta lista, sem cards intermediários." />
      <div className="mb-4 mt-3 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-clay/30" /><Input placeholder="Buscar pelo nome…" value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-10" /></div>
        <Select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="w-auto"><option value="pendente_confirmacao">Aguardando confirmação</option><option value="nao_pago">Não pagos</option><option value="pago">Pagos</option><option value="rejeitado">Rejeitados</option><option value="todos">Todos</option></Select>
      </div>
      {selecionados.size > 0 && <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-burgundy/15 bg-burgundy/[0.06] px-3 py-2.5"><span className="text-xs font-medium text-burgundy">{selecionados.size} parcela(s) selecionada(s)</span><Button size="sm" loading={processando} onClick={marcarSelecionadosComoPagos}><CheckCircle2 className="h-3.5 w-3.5" /> Marcar como pagas</Button></div>}
      {carregando ? <SkeletonRows count={5} /> : grupos.length === 0 ? <div className="rounded-xl border border-dashed border-rose/20 bg-blush/15 p-8 text-center text-xs text-clay/45">Nenhum pagamento encontrado.</div> : <div className="space-y-2.5">{grupos.map((grupo) => <ClientePagamentos key={grupo.clienteId} grupo={grupo} selecionados={selecionados} onSelecionar={alternarSelecionado} onAbrir={setBoletoAtivo} />)}</div>}
    </Panel>
    {boletoAtivo && <ModalValidarComprovante boleto={boletoAtivo} onClose={() => setBoletoAtivo(null)} onResolvido={() => { setBoletoAtivo(null); carregar(true); }} />}
  </div>;
}

type GrupoCliente = { clienteId: string; nome: string; cpf: string; parcelas: Boleto[] };
function ClientePagamentos({ grupo, selecionados, onSelecionar, onAbrir }: { grupo: GrupoCliente; selecionados: Set<string>; onSelecionar: (id: string) => void; onAbrir: (b: Boleto) => void }) {
  const aguardando = grupo.parcelas.filter((p) => p.status === "pendente_confirmacao").length;
  return <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold text-burgundy">{grupo.nome}</p><p className="text-[0.6rem] text-clay/40">CPF {formatarCpf(grupo.cpf)} · {grupo.parcelas.length} parcela(s)</p></div>{aguardando > 0 && <span className="rounded-full bg-gold/10 px-2 py-1 text-[0.55rem] font-semibold text-gold">{aguardando} aguardando</span>}</div>
    <div className="divide-y divide-white/7">{grupo.parcelas.map((boleto) => { const atraso = diasEmAtraso(boleto.data_vencimento); const vencida = boleto.status !== "pago" && atraso > 0; const aberto = boleto.status !== "pago"; const aguardandoConfirmacao = boleto.status === "pendente_confirmacao"; return <div key={boleto.id} className={cn("px-3 py-2.5", vencida && "bg-alert/[0.035]", aguardandoConfirmacao && "bg-gold/[0.035]")}>
      <div className="flex flex-wrap items-center gap-2.5">{aberto && <input type="checkbox" checked={selecionados.has(boleto.id)} onChange={() => onSelecionar(boleto.id)} className="h-4 w-4 accent-burgundy" aria-label={`Selecionar parcela ${boleto.numero_parcela}`} />}<div className="flex min-w-[74px] items-center gap-2"><ReceiptText className="h-3.5 w-3.5 text-burgundy/45" /><span className="text-xs font-semibold text-burgundy">{boleto.numero_parcela}/{boleto.total_parcelas}</span></div><div className="min-w-[100px] text-[0.66rem] text-clay/50">Vence {formatarData(boleto.data_vencimento)}</div><div className="ml-auto text-right"><p className="text-sm font-bold text-burgundy">{formatarMoeda(boleto.valor)}</p>{vencida && <p className="flex items-center justify-end gap-1 text-[0.58rem] font-semibold text-alert"><AlertTriangle className="h-3 w-3" /> Vencida há {atraso} dia{atraso === 1 ? "" : "s"}</p>}</div><StatusPill tone={STATUS_TONE[boleto.status]}>{STATUS_BOLETO_LABEL[boleto.status]}</StatusPill></div>
      {aguardandoConfirmacao && <div className="mt-2 grid gap-2 rounded-lg border border-gold/15 bg-gold/[0.035] p-2.5 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="text-[0.62rem] font-semibold text-gold">Comprovante enviado</p><p className="mt-0.5 text-[0.58rem] text-clay/45">Abra o comprovante para conferir.</p></div><Button size="sm" onClick={() => onAbrir(boleto)}><ReceiptText className="h-3.5 w-3.5" /> Conferir</Button></div>}
      {boleto.status !== "pendente_confirmacao" && boleto.comprovante_url && <div className="mt-1.5 flex justify-end"><button type="button" onClick={() => onAbrir(boleto)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[0.58rem] text-burgundy/55 hover:bg-blush hover:text-burgundy"><ReceiptText className="h-3 w-3" /> Ver comprovante</button></div>}
    </div>; })}</div></div>;
}

function ModalValidarComprovante({ boleto, onClose, onResolvido }: { boleto: Boleto; onClose: () => void; onResolvido: () => void }) {
  const [observacoes, setObservacoes] = useState(""); const [processando, setProcessando] = useState(false);
  async function resolver(acao: "confirmar" | "rejeitar") {
    setProcessando(true);
    try { const res = await fetch(`/api/admin/boletos/${boleto.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao, observacoes: observacoes || undefined }) }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.erro ?? "Não foi possível atualizar o pagamento."); toast.success(acao === "confirmar" ? "Pagamento confirmado." : "Comprovante rejeitado."); onResolvido(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o pagamento."); }
    finally { setProcessando(false); }
  }
  return <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-burgundy-dark/55 p-3 backdrop-blur-md" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[24px] border border-white/10 bg-[#1b181b] p-4 text-pearl shadow-2xl sm:p-5"><div className="flex items-start justify-between gap-3 border-b border-white/8 pb-3"><div><p className="text-[0.62rem] uppercase tracking-[0.16em] text-gold">Conferência</p><h2 className="mt-1 text-lg font-semibold text-rose">Parcela {boleto.numero_parcela}/{boleto.total_parcelas}</h2><p className="text-xs text-pearl/45">{boleto.clientes?.nome_completo ?? "Cliente"} · vencimento {formatarData(boleto.data_vencimento)}</p></div><button onClick={onClose} className="rounded-full p-2 text-pearl/35 hover:bg-white/5 hover:text-pearl" aria-label="Fechar"><X className="h-4 w-4" /></button></div><div className="mt-4 grid grid-cols-2 gap-2"><InfoBox label="Valor da parcela" valor={formatarMoeda(boleto.valor)} /><InfoBox label="Status" valor={STATUS_BOLETO_LABEL[boleto.status]} /></div>{boleto.comprovante_url ? <a href={`/api/admin/boletos/${boleto.id}/comprovante`} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-between rounded-xl border border-rose/15 bg-rose/[0.05] px-3 py-3 text-xs text-rose"><span className="flex items-center gap-2"><ReceiptText className="h-4 w-4" /> Abrir comprovante para conferência</span><ExternalLink className="h-4 w-4" /></a> : <div className="mt-3 rounded-xl border border-alert/20 bg-alert/[0.05] px-3 py-3 text-xs text-alert">Nenhum comprovante foi anexado a esta parcela.</div>}<div className="mt-3"><label className="mb-1 block text-[0.58rem] uppercase tracking-[0.12em] text-pearl/35">Observação (opcional)</label><Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Observação da conferência…" /></div><div className="mt-4 flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="button" variant="danger" loading={processando} onClick={() => resolver("rejeitar")}>Rejeitar</Button><Button type="button" loading={processando} onClick={() => resolver("confirmar")}><CheckCircle2 className="h-3.5 w-3.5" /> Confirmar pagamento</Button></div></div></div></Portal>;
}
function InfoBox({ label, valor }: { label: string; valor: string }) { return <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3"><p className="text-[0.56rem] uppercase tracking-[0.13em] text-pearl/35">{label}</p><p className="mt-1 text-sm font-bold text-pearl">{valor}</p></div>; }