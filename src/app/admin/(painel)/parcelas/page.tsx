"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock3, History, Plus, RotateCcw, Save, Search, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, SectionHeading } from "@/components/admin/ExecutiveUI";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import type { Boleto, Cliente, LogAlteracao } from "@/types/database";

function moedaInput(valor: string) {
  const digitos = valor.replace(/\D/g, "");
  if (!digitos) return "R$ 0,00";
  return `R$ ${(Number(digitos) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function moedaNumero(valor: string) { return Number(valor.replace(/\D/g, "") || "0") / 100; }
function moeda(valor: number) { return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

export default function ParcelasPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [busca, setBusca] = useState("");
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [historico, setHistorico] = useState<LogAlteracao[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [suspendendo, setSuspendendo] = useState(false);
  const [quantidadeGerar, setQuantidadeGerar] = useState("1");
  const [valorGerar, setValorGerar] = useState("");
  const [vencimentoGerar, setVencimentoGerar] = useState("");
  const [gerando, setGerando] = useState(false);

  async function carregarClientes() {
    try {
      const res = await fetch("/api/admin/clientes", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível carregar as clientes.");
      setClientes(data.clientes ?? []);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao carregar clientes."); }
  }
  async function carregarParcelas(id = clienteId) {
    if (!id) { setBoletos([]); setHistorico([]); return; }
    setCarregando(true);
    try {
      const res = await fetch(`/api/admin/clientes/${id}/parcelas`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível carregar as parcelas.");
      setBoletos(data.boletos ?? []); setHistorico(data.historico ?? []); setSelecionadas(new Set());
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao carregar parcelas."); }
    finally { setCarregando(false); }
  }
  useEffect(() => { carregarClientes(); }, []);
  useEffect(() => { carregarParcelas(); }, [clienteId]);

  const resultados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (termo.length < 2) return [];
    return clientes.filter((c) => c.nome_completo.toLowerCase().includes(termo)).slice(0, 8);
  }, [clientes, busca]);

  async function editar(boleto: Boleto, campo: "valor" | "data_vencimento", valor: string) {
    if (boleto.status === "pago") return;
    setSalvando(`${boleto.id}:${campo}`);
    try {
      const body = campo === "valor" ? { valor: moedaNumero(valor) } : { dataVencimento: valor || null };
      const res = await fetch(`/api/admin/clientes/${clienteId}/parcelas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "editar", boletoId: boleto.id, ...body }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível alterar a parcela.");
      setBoletos((atual) => atual.map((b) => b.id === boleto.id ? { ...b, ...data.boleto, valor: Number(data.boleto.valor) } : b));
      toast.success("Parcela atualizada.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao alterar parcela."); }
    finally { setSalvando(null); }
  }
  async function reabrir(boleto: Boleto) {
    if (boleto.status === "pago") return;
    const res = await fetch(`/api/admin/clientes/${clienteId}/parcelas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "reabrir", boletoId: boleto.id }) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.erro ?? "Não foi possível reabrir.");
    toast.success("Parcela voltou para em aberto."); await carregarParcelas();
  }
  async function excluir(boleto: Boleto) {
    if (boleto.status === "pago") return;
    if (!window.confirm(`Excluir a parcela ${boleto.numero_parcela}/${boleto.total_parcelas}?`)) return;
    try {
      const res = await fetch(`/api/admin/clientes/${clienteId}/parcelas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "excluir", boletoId: boleto.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Não foi possível excluir.");
      toast.success("Parcela excluída."); await carregarParcelas();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao excluir parcela."); }
  }
  async function gerar() {
    const quantidade = Number(quantidadeGerar);
    if (!clienteId || !Number.isInteger(quantidade) || quantidade < 1) return toast.error("Informe uma quantidade válida.");
    setGerando(true);
    try {
      const valor = valorGerar.trim() ? moedaNumero(valorGerar) : undefined;
      const res = await fetch(`/api/admin/clientes/${clienteId}/parcelas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "gerar", quantidade, valorParcela: valor, primeiroVencimento: vencimentoGerar || undefined }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.erro ?? "Não foi possível gerar as parcelas.");
      toast.success(`${quantidade} parcela(s) adicionada(s).`); setQuantidadeGerar("1"); setValorGerar(""); setVencimentoGerar(""); await carregarParcelas();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao gerar parcelas."); }
    finally { setGerando(false); }
  }
  async function suspenderSelecionadas() {
    if (!selecionadas.size) return;
    setSuspendendo(true);
    try {
      const res = await fetch(`/api/admin/clientes/${clienteId}/parcelas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "suspender", ids: Array.from(selecionadas) }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.erro ?? "Não foi possível suspender as parcelas.");
      toast.success(data.mensagem ?? "Parcelas suspensas."); await carregarParcelas();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao suspender parcelas."); }
    finally { setSuspendendo(false); }
  }

  const pagas = boletos.filter((b) => b.status === "pago").length;
  const abertas = boletos.filter((b) => b.status !== "pago").length;
  const suspensas = boletos.filter((b) => b.suspensa).length;

  return <div className="space-y-4 pb-8">
    <PageHeader eyebrow="Gestão financeira" title="Gestão de parcelas" description="Pesquise uma cliente pelo nome para abrir o carnê. Alterar o vencimento não altera o valor." />

    <Panel className="relative z-50 p-4 sm:p-5">
      <SectionHeading title="Pesquisar cliente" description="Digite o nome para localizar a cliente." />
      <div className="relative z-50 mt-3 max-w-xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-clay/30" />
        <Input className="pl-10" placeholder="Buscar pelo nome…" value={busca} onChange={(e) => { setBusca(e.target.value); if (!e.target.value.trim()) setClienteId(""); }} />
        {resultados.length > 0 && !clienteId && <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[100] overflow-hidden rounded-2xl border border-rose/10 bg-[rgb(var(--surface-2))] p-1.5 shadow-card dark:border-white/10 dark:bg-[#1b181b]">
          {resultados.map((c) => <button key={c.id} type="button" onClick={() => { setClienteId(c.id); setBusca(c.nome_completo); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-blush/40 dark:hover:bg-white/5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose/10 text-rose"><UserRound className="h-3.5 w-3.5" /></span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-burgundy dark:text-pearl">{c.nome_completo}</span><span className="text-[0.62rem] text-clay/50 dark:text-pearl/40">Cliente</span></span></button>)}
        </div>}
      </div>
      {clienteId && <div className="mt-3 flex items-center justify-between rounded-xl border border-success/15 bg-success/5 px-3 py-2"><span className="text-xs font-medium text-burgundy">Cliente selecionada: {busca}</span><button type="button" onClick={() => { setClienteId(""); setBusca(""); }} className="text-[0.62rem] text-rose hover:underline">Trocar</button></div>}
    </Panel>

    {!clienteId && resultados.length === 0 ? <Panel className="relative z-0 p-10 text-center"><UserRound className="mx-auto h-8 w-8 text-burgundy/15" /><p className="mt-3 font-heading text-lg text-burgundy">Pesquise uma cliente para começar</p><p className="mt-1 text-sm text-clay/45">O carnê e as ferramentas de gestão aparecem somente depois da seleção.</p></Panel> : !clienteId ? null : <>
      <div className="relative z-0 grid grid-cols-2 gap-2 sm:grid-cols-4"><Resumo label="Total" valor={boletos.length} /><Resumo label="Pagas" valor={pagas} destaque /><Resumo label="Em aberto" valor={abertas} /><Resumo label="Realocadas" valor={suspensas} /></div>
      <Panel className="relative z-0 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><SectionHeading title="Adicionar parcelas" description="Gere parcelas adicionais sem alterar as já existentes." /><span className="rounded-xl bg-blush/40 px-3 py-2 text-xs font-semibold text-burgundy">{boletos.length} parcelas</span></div>
        <div className="mt-3 grid gap-2.5 md:grid-cols-4"><Input type="number" min="1" max="240" value={quantidadeGerar} onChange={(e) => setQuantidadeGerar(e.target.value)} placeholder="Quantidade" /><Input inputMode="numeric" placeholder="R$ 0,00" value={valorGerar} onChange={(e) => setValorGerar(moedaInput(e.target.value))} /><Input type="date" value={vencimentoGerar} onChange={(e) => setVencimentoGerar(e.target.value)} /><Button loading={gerando} onClick={gerar}><Plus className="h-3.5 w-3.5" /> Gerar parcelas</Button></div>
      </Panel>

      <Panel className="relative z-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3.5 sm:px-5"><SectionHeading title="Carnê da cliente" description="Valor e vencimento são campos independentes." />{selecionadas.size > 0 && <Button size="sm" loading={suspendendo} onClick={suspenderSelecionadas}><Clock3 className="h-3.5 w-3.5" /> Suspender {selecionadas.size}</Button>}</div>
        {carregando ? <p className="py-10 text-center text-sm text-clay/45">Carregando parcelas…</p> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead className="bg-white/[0.025] text-[0.58rem] uppercase tracking-[0.14em] text-clay/40"><tr><th className="w-10 px-3 py-2.5"></th><th className="px-3 py-2.5">Parcela</th><th className="px-3 py-2.5">Vencimento</th><th className="px-3 py-2.5">Valor</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Ações</th></tr></thead><tbody className="divide-y divide-white/6">{boletos.map((b) => <ParcelaRow key={b.id} boleto={b} selecionada={selecionadas.has(b.id)} onSelecionar={() => setSelecionadas((atual) => { const n = new Set(atual); n.has(b.id) ? n.delete(b.id) : n.add(b.id); return n; })} onEditar={editar} onReabrir={reabrir} onExcluir={excluir} salvando={salvando} />)}</tbody></table></div>}
      </Panel>

      <Panel className="relative z-0 p-4"><button className="flex w-full items-center justify-between text-left" onClick={() => setMostrarHistorico((v) => !v)}><div className="flex items-center gap-2"><History className="h-4 w-4 text-burgundy" /><div><p className="text-sm font-semibold text-burgundy">Histórico de alterações</p><p className="text-[0.62rem] text-clay/45">Exclusões, suspensões, reaberturas e alterações ficam registrados.</p></div></div>{mostrarHistorico ? <ChevronUp className="h-4 w-4 text-clay/40" /> : <ChevronDown className="h-4 w-4 text-clay/40" />}</button>{mostrarHistorico && <div className="mt-3 space-y-1.5">{historico.length ? historico.map((log) => <div key={log.id} className="rounded-lg border border-white/7 bg-white/[0.02] px-3 py-2"><div className="flex justify-between gap-2"><span className="text-[0.62rem] font-semibold text-rose">{log.acao.replaceAll("_", " ")}</span><span className="text-[0.56rem] text-clay/35">{new Date(log.created_at).toLocaleString("pt-BR")}</span></div></div>) : <p className="text-xs text-clay/45">Nenhuma alteração registrada.</p>}</div>}</Panel>
    </>}
  </div>;
}

function Resumo({ label, valor, destaque }: { label: string; valor: number; destaque?: boolean }) { return <div className={cn("rounded-xl border px-3 py-2.5", destaque ? "border-gold/25 bg-gold/5" : "border-white/8 bg-white/[0.02]")}><p className="text-[0.55rem] uppercase tracking-[0.14em] text-clay/40">{label}</p><p className={cn("mt-0.5 text-base font-semibold", destaque ? "text-gold" : "text-burgundy")}>{valor}</p></div>; }

function ParcelaRow({ boleto, selecionada, onSelecionar, onEditar, onReabrir, onExcluir, salvando }: { boleto: Boleto; selecionada: boolean; onSelecionar: () => void; onEditar: (b: Boleto, campo: "valor" | "data_vencimento", valor: string) => void; onReabrir: (b: Boleto) => void; onExcluir: (b: Boleto) => void; salvando: string | null }) {
  const paga = boleto.status === "pago";
  const [valor, setValor] = useState(moedaInput(String(Math.round(Number(boleto.valor) * 100))));
  const [data, setData] = useState(boleto.data_vencimento ?? "");
  useEffect(() => { setValor(moedaInput(String(Math.round(Number(boleto.valor) * 100)))); setData(boleto.data_vencimento ?? ""); }, [boleto.valor, boleto.data_vencimento]);
  const salvarValor = () => { const n = moedaNumero(valor); if (Number.isFinite(n) && n > 0) onEditar(boleto, "valor", valor); else toast.error("Valor inválido."); };
  const salvarData = () => { if (data !== (boleto.data_vencimento ?? "")) onEditar(boleto, "data_vencimento", data); };
  return <tr className={cn(paga && "bg-success/[0.035]", boleto.suspensa && "bg-gold/[0.04]")}>
    <td className="px-3 py-2"><input type="checkbox" checked={selecionada} disabled={paga} onChange={onSelecionar} aria-label={`Selecionar parcela ${boleto.numero_parcela}`} /></td>
    <td className="px-3 py-2"><span className="text-xs font-semibold text-burgundy">{boleto.numero_parcela}/{boleto.total_parcelas}</span>{boleto.suspensa && <span className="ml-1.5 text-[0.55rem] text-gold">Realocada</span>}</td>
    <td className="px-3 py-2"><Input type="date" value={data} disabled={paga} onChange={(e) => setData(e.target.value)} onBlur={salvarData} className="w-[145px] text-xs" /></td>
    <td className="px-3 py-2"><Input inputMode="numeric" value={valor} disabled={paga} onChange={(e) => setValor(moedaInput(e.target.value))} onBlur={salvarValor} className="w-[145px] text-xs font-semibold" /></td>
    <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-1 text-[0.55rem] font-semibold", paga ? "bg-success/10 text-success" : boleto.status === "pendente_confirmacao" ? "bg-gold/10 text-gold" : "bg-burgundy/5 text-burgundy/70")}>{paga ? "Pago — protegido" : boleto.status === "pendente_confirmacao" ? "Aguardando confirmação" : "Em aberto"}</span></td>
    <td className="px-3 py-2"><div className="flex gap-1">{!paga && <>{boleto.status !== "nao_pago" && <Button variant="ghost" size="sm" onClick={() => onReabrir(boleto)} title="Voltar para em aberto"><RotateCcw className="h-3 w-3" /></Button>}<Button variant="ghost" size="sm" onClick={salvarValor} disabled={salvando?.startsWith(boleto.id)} title="Salvar valor"><Save className="h-3 w-3" /></Button><Button variant="ghost" size="sm" onClick={() => onExcluir(boleto)} title="Excluir parcela"><Trash2 className="h-3 w-3 text-alert" /></Button></>}</div></td>
  </tr>;
}