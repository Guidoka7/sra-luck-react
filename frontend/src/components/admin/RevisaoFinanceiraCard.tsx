"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Clock, CreditCard, FileCheck2, Landmark, Search, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Panel, StatusPill } from "@/components/admin/ExecutiveUI";
import { Button } from "@/components/ui/Button";
import { formatarMoeda } from "@/lib/utils";
import { PRAZO_REVISAO_FINANCEIRA_DIAS_UTEIS } from "@/types/database";

type Forma = "cartao" | "pix" | "cheques" | "boleto_100";
interface Pendente { id: string; nome: string; cpf: string; valorContrato: number; quantidadeParcelas: number | null; porcentagemPagamento: number; dataAtingiuPercentual: string | null; saldoRestanteEstimado: number; }
const FORMAS: { value: Forma; label: string }[] = [
  { value: "cartao", label: "Cartão" }, { value: "pix", label: "PIX" }, { value: "cheques", label: "Cheques" }, { value: "boleto_100", label: "100% boleto" },
];
function diasUteisDesde(iso: string | null) { if (!iso) return 0; const inicio = new Date(iso); const hoje = new Date(); inicio.setHours(0,0,0,0); hoje.setHours(0,0,0,0); let dias = 0; while (inicio < hoje) { inicio.setDate(inicio.getDate()+1); const d = inicio.getDay(); if (d !== 0 && d !== 6) dias++; } return dias; }

export function RevisaoFinanceiraCard() {
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [processando, setProcessando] = useState<string | null>(null);
  const [financeiro, setFinanceiro] = useState<Record<string, { saldo: string; taxa: string; formas: Forma[] }>>({});

  async function carregar() {
    try {
      const res = await fetch("/api/admin/liberacoes-financeiras", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? "Falha ao carregar a fila financeira.");
      const lista = (data.pendentes ?? []) as Pendente[];
      setPendentes(lista);
      setFinanceiro((atual) => Object.fromEntries(lista.map((p) => [p.id, atual[p.id] ?? { saldo: String(p.saldoRestanteEstimado ?? 0), taxa: "5.4", formas: ["cartao", "pix", "cheques", "boleto_100"] as Forma[] }])));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível carregar a fila financeira."); }
    finally { setCarregando(false); }
  }
  useEffect(() => { carregar(); const intervalo = setInterval(carregar, 30000); return () => clearInterval(intervalo); }, []);
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
  return <Panel className="p-3.5 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[0.58rem] font-bold uppercase tracking-[0.2em] text-rose">Confirmação financeira</p><p className="mt-0.5 text-xs text-clay/50">Revise, escolha o custeio e libere a próxima etapa.</p></div><StatusPill tone={filtradas.length ? "rose" : "neutral"}>{filtradas.length} pendente(s)</StatusPill></div>
    <div className="relative mt-3"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-clay/35" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome…" className="h-9 w-full rounded-xl border border-rose/10 bg-[rgb(var(--surface-2))] pl-9 pr-3 text-xs text-burgundy outline-none placeholder:text-clay/35 focus:border-rose/25 focus:ring-1 focus:ring-rose/10" /></div>
    {filtradas.length === 0 ? <div className="mt-3 rounded-xl border border-dashed border-rose/15 bg-blush/15 px-4 py-5 text-center"><ShieldCheck className="mx-auto h-5 w-5 text-clay/25" /><p className="mt-1 text-xs text-clay/50">Nenhuma cliente aguardando confirmação financeira.</p></div> : <div className="mt-3 max-h-[28rem] space-y-1.5 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
      {filtradas.map((c) => {
        const config = financeiro[c.id] ?? { saldo: String(c.saldoRestanteEstimado ?? 0), taxa: "5.4", formas: [] as Forma[] };
        const dias = diasUteisDesde(c.dataAtingiuPercentual); const atrasado = dias >= PRAZO_REVISAO_FINANCEIRA_DIAS_UTEIS; const isOpen = aberta === c.id;
        return <div key={c.id} className={`overflow-hidden rounded-xl border transition ${isOpen ? "border-rose/20 bg-blush/15" : "border-rose/8 bg-[rgb(var(--surface-2))]"}`}>
          <button type="button" onClick={() => setAberta(isOpen ? null : c.id)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-rose/5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blush/45 text-burgundy"><FileCheck2 className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-burgundy">{c.nome}</span><span className="mt-0.5 block truncate text-[0.58rem] text-clay/45">{formatarMoeda(c.valorContrato)} · {c.quantidadeParcelas ?? "—"} parcelas · {c.porcentagemPagamento}% pago</span></span>
            <span className={`hidden shrink-0 items-center gap-1 text-[0.55rem] sm:flex ${atrasado ? "text-alert" : "text-clay/45"}`}><Clock className="h-3 w-3" />{atrasado ? "Prazo atingido" : `${dias}/${PRAZO_REVISAO_FINANCEIRA_DIAS_UTEIS} úteis`}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-clay/35 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </button>
          {isOpen && <div className="border-t border-rose/8 px-3 pb-3 pt-2.5">
            <div className="grid gap-2 sm:grid-cols-2"><label className="text-[0.56rem] font-bold uppercase tracking-[0.16em] text-clay/45">Saldo confirmado<input value={config.saldo} onChange={(e) => alterarFinanceiro(c.id, { saldo: e.target.value })} inputMode="decimal" className="mt-1 h-8 w-full rounded-lg border border-rose/10 bg-white px-2.5 text-xs text-burgundy outline-none focus:border-gold" /></label><label className="text-[0.56rem] font-bold uppercase tracking-[0.16em] text-clay/45">Taxa cartão (%)<input value={config.taxa} onChange={(e) => alterarFinanceiro(c.id, { taxa: e.target.value })} inputMode="decimal" className="mt-1 h-8 w-full rounded-lg border border-rose/10 bg-white px-2.5 text-xs text-burgundy outline-none focus:border-gold" /></label></div>
            <div className="mt-2.5"><p className="mb-1.5 text-[0.56rem] font-bold uppercase tracking-[0.16em] text-clay/45">Opções de custeio</p><div className="flex max-w-full gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">{FORMAS.map((f) => { const ativo = config.formas.includes(f.value); return <button type="button" key={f.value} onClick={() => alternarForma(c.id, f.value)} className={`flex min-w-max items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[0.58rem] font-semibold transition ${ativo ? "border-burgundy/30 bg-burgundy text-cream" : "border-rose/10 bg-white text-burgundy"}`}><span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15">{f.value === "cartao" ? <CreditCard className="h-3 w-3" /> : f.value === "pix" ? <Landmark className="h-3 w-3" /> : <FileCheck2 className="h-3 w-3" />}</span>{f.label}</button>; })}</div></div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/65 px-2.5 py-2"><div className="text-[0.6rem] text-clay/50">Cartão com taxa: <strong className="text-burgundy">{formatarMoeda(Number(config.saldo || 0) * (1 + Number(config.taxa || 0) / 100))}</strong></div><div className="flex gap-1.5"><Button size="sm" variant="secondary" loading={processando === c.id} onClick={() => decidir(c.id, "recusada")} className="!h-8 !px-2.5 !text-alert"><X className="h-3 w-3" />Recusar</Button><Button size="sm" loading={processando === c.id} onClick={() => decidir(c.id, "aprovada")} className="!h-8 !px-2.5"><Check className="h-3 w-3" />Confirmar</Button></div></div>
          </div>}
        </div>;
      })}
    </div>}
  </Panel>;
}