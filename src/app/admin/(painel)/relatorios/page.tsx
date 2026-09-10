"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, FileCheck2, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, SectionHeading, StatusPill } from "@/components/admin/ExecutiveUI";
import { Input } from "@/components/ui/Input";
import { formatarMoeda } from "@/lib/utils";

interface ClienteTermo { agendamentoId: string; nome: string; responsavel: string | null; statusFinanceiro: "pago" | "a_pagar" | "parcial"; statusCirurgia: "nao_agendada" | "agendada" | "realizada" | "cancelada"; valorContrato: number; data: string | null; }
interface MesTermos { mes: number; nome: string; total: number; clientes: ClienteTermo[]; }
interface TermosData { ano: number; meses: MesTermos[]; }
interface Liberacao { agendamentoId: string; clienteId: string; nome: string; previsaoAtual: string | null; }

export default function RelatoriosPage() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [aba, setAba] = useState<"termos" | "liberacao">("termos");
  const [termos, setTermos] = useState<TermosData | null>(null);
  const [liberacoes, setLiberacoes] = useState<Liberacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [mesesAbertos, setMesesAbertos] = useState<Set<number>>(new Set());
  const [busca, setBusca] = useState("");

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    Promise.all([
      fetch(`/api/admin/agenda-mensal?ano=${ano}`, { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/clientes-agendamentos", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([agenda, financeiro]) => {
      if (!ativo) return;
      setTermos(agenda);
      setLiberacoes(financeiro.clientes ?? []);
      setMesesAbertos(new Set((agenda.meses ?? []).filter((m: MesTermos) => m.total > 0).map((m: MesTermos) => m.mes)));
    }).catch(() => toast.error("Não foi possível carregar os relatórios."))
      .finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, [ano]);

  const liberacoesFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return liberacoes.filter((item) => !termo || item.nome.toLowerCase().includes(termo));
  }, [liberacoes, busca]);

  const totalTermos = termos?.meses.reduce((s, m) => s + m.total, 0) ?? 0;
  const totalLiberacoes = liberacoes.length;
  const comDataLiberacao = liberacoes.filter((l) => l.previsaoAtual).length;

  return <div className="space-y-3 pb-8">
    <PageHeader eyebrow="Relatórios" title="Relatórios operacionais" description="Somente os dois relatórios que fazem sentido para a gestão da agenda: termos cirúrgicos e liberação financeira." actions={<div className="flex items-center gap-1 rounded-full border border-burgundy/10 bg-white/70 p-1 dark:border-white/10 dark:bg-white/[0.04]"><button onClick={() => setAno((v) => v - 1)} className="flex h-7 w-7 items-center justify-center rounded-full text-burgundy hover:bg-blush" aria-label="Ano anterior"><ChevronLeft className="h-3.5 w-3.5" /></button><span className="w-14 text-center text-xs font-semibold text-burgundy dark:text-pearl">{ano}</span><button onClick={() => setAno((v) => v + 1)} className="flex h-7 w-7 items-center justify-center rounded-full text-burgundy hover:bg-blush" aria-label="Próximo ano"><ChevronRight className="h-3.5 w-3.5" /></button></div>} />

    <div className="grid grid-cols-2 gap-2">
      <button onClick={() => setAba("termos")} className={`rounded-xl border px-3 py-2.5 text-left transition ${aba === "termos" ? "border-rose/30 bg-rose/[0.06]" : "border-white/8 bg-white/[0.02]"}`}><span className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-rose" /><span className="text-xs font-semibold text-burgundy dark:text-pearl">Agenda de termos</span></span><span className="mt-1 block text-[0.58rem] text-clay/45">{totalTermos} agendamento(s) no ano</span></button>
      <button onClick={() => setAba("liberacao")} className={`rounded-xl border px-3 py-2.5 text-left transition ${aba === "liberacao" ? "border-gold/30 bg-gold/[0.06]" : "border-white/8 bg-white/[0.02]"}`}><span className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-gold" /><span className="text-xs font-semibold text-burgundy dark:text-pearl">Liberação financeira</span></span><span className="mt-1 block text-[0.58rem] text-clay/45">{comDataLiberacao} com previsão definida</span></button>
    </div>

    {carregando || !termos ? <Panel className="p-8 text-center text-sm text-clay/45">Carregando relatório…</Panel> : aba === "termos" ? <RelatorioTermos dados={termos} mesesAbertos={mesesAbertos} setMesesAbertos={setMesesAbertos} /> : <RelatorioLiberacao itens={liberacoesFiltradas} busca={busca} setBusca={setBusca} total={totalLiberacoes} />}
  </div>;
}

function RelatorioTermos({ dados, mesesAbertos, setMesesAbertos }: { dados: TermosData; mesesAbertos: Set<number>; setMesesAbertos: React.Dispatch<React.SetStateAction<Set<number>>> }) {
  return <Panel className="p-3.5 sm:p-4"><SectionHeading title="Agenda dos termos cirúrgicos" description="Acompanhamento mensal de clientes agendadas, situação e valor de contrato." /><div className="mt-3 space-y-1.5">{dados.meses.map((mes) => { const aberto = mesesAbertos.has(mes.mes); return <div key={mes.mes} className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.02]"><button className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-white/[0.025]" onClick={() => setMesesAbertos((atual) => { const n = new Set(atual); n.has(mes.mes) ? n.delete(mes.mes) : n.add(mes.mes); return n; })}><span className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose/10 text-rose"><CalendarDays className="h-3.5 w-3.5" /></span><span><span className="block text-xs font-semibold text-burgundy dark:text-pearl">{mes.nome}</span><span className="text-[0.58rem] text-clay/40">{mes.total} cliente{mes.total === 1 ? "" : "s"}</span></span></span><ChevronDown className={`h-4 w-4 text-clay/30 transition-transform ${aberto ? "rotate-180" : ""}`} /></button>{aberto && <div className="space-y-1 border-t border-white/7 p-2">{mes.clientes.length ? mes.clientes.map((item) => <div key={item.agendamentoId} className="grid gap-2 rounded-lg border border-white/7 bg-white/[0.02] px-2.5 py-2 md:grid-cols-[1.4fr_.7fr_.8fr_.7fr] md:items-center"><div><p className="text-[0.72rem] font-semibold text-burgundy dark:text-pearl">{item.nome}</p><p className="text-[0.56rem] text-clay/40">{item.responsavel ? `Responsável: ${item.responsavel}` : "Sem responsável"}</p></div><div><span className="text-[0.52rem] uppercase tracking-wider text-clay/35">Data</span><p className="text-[0.62rem] text-burgundy dark:text-pearl">{item.data ? item.data.split("-").reverse().join("/") : "Sem data"}</p></div><div className="flex gap-1.5"><StatusPill tone={item.statusFinanceiro === "pago" ? "success" : item.statusFinanceiro === "parcial" ? "gold" : "alert"}>{item.statusFinanceiro === "pago" ? "Pago" : item.statusFinanceiro === "parcial" ? "Parcial" : "A pagar"}</StatusPill><StatusPill tone={item.statusCirurgia === "realizada" ? "success" : item.statusCirurgia === "cancelada" ? "alert" : "rose"}>{item.statusCirurgia === "realizada" ? "Concluído" : item.statusCirurgia === "cancelada" ? "Cancelado" : "Agendado"}</StatusPill></div><p className="text-right text-[0.68rem] font-semibold text-burgundy dark:text-pearl">{formatarMoeda(item.valorContrato)}</p></div>) : <p className="px-2 py-3 text-center text-[0.62rem] text-clay/40">Nenhum agendamento neste mês.</p>}</div>}</div>; })}</div></Panel>;
}

function RelatorioLiberacao({ itens, busca, setBusca, total }: { itens: Liberacao[]; busca: string; setBusca: (v: string) => void; total: number }) {
  return <Panel className="p-3.5 sm:p-4"><SectionHeading title="Agenda de liberação financeira" description="Clientes com agendamento confirmado e previsão de liberação registrada." /><div className="relative mt-3"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-clay/30" /><Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar cliente…" className="pl-9" /></div><div className="mt-3 overflow-hidden rounded-xl border border-white/8"><div className="grid grid-cols-[1fr_130px_100px] gap-2 border-b border-white/7 bg-white/[0.025] px-3 py-2 text-[0.52rem] uppercase tracking-wider text-clay/35"><span>Cliente</span><span>Previsão</span><span className="text-right">Situação</span></div>{itens.length ? itens.map((item) => <div key={item.agendamentoId} className="grid grid-cols-[1fr_130px_100px] items-center gap-2 border-b border-white/6 px-3 py-2.5 last:border-0"><div className="min-w-0"><p className="truncate text-[0.7rem] font-semibold text-burgundy dark:text-pearl">{item.nome}</p><p className="text-[0.54rem] text-clay/35">Agendamento confirmado</p></div><p className="text-[0.62rem] text-burgundy dark:text-pearl">{item.previsaoAtual ? item.previsaoAtual.split("-").reverse().join("/") : "Sem previsão"}</p><span className={`ml-auto rounded-full px-2 py-1 text-[0.5rem] font-semibold ${item.previsaoAtual ? "bg-success/10 text-success" : "bg-gold/10 text-gold"}`}>{item.previsaoAtual ? "Programada" : "Pendente"}</span></div>) : <p className="p-8 text-center text-xs text-clay/40">Nenhuma liberação encontrada.</p>}</div><p className="mt-2 text-[0.56rem] text-clay/35">Total de agendamentos confirmados: {total}</p></Panel>;
}
