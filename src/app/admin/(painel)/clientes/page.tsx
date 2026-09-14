"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, UserRound, LayoutGrid, List, CheckCircle2, CalendarClock, Ban } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { formatarCpf } from "@/lib/cpf";
import { formatarMoeda } from "@/lib/utils";
import { fetchInstant, getInstantCache, refreshInstant } from "@/lib/instantCache";
import type { Cliente, NovaVenda } from "@/types/database";
import { STATUS_CONTRATO_LABEL } from "@/types/database";
import { ModalClienteCompactoV3 } from "@/components/admin/ModalClienteCompactoV3";

type Funil = "novas" | "aguardando" | "cadastradas" | "canceladas";

const statusPagamento = (c: Cliente) => { const p = c.porcentagem_pagamento; if (p == null) return "Sem parcelas"; if (p >= 100) return "Quitado"; return `${p}% pago`; };
function BadgesCiclo({ cliente }: { cliente: Cliente }) { const quitada = Boolean(cliente.custeio_confirmado_em) || cliente.status_financeiro === "pago"; const cirurgia = cliente.status_cirurgia === "realizada"; const termos = Boolean(cliente.termos_assinados_em); return <div className="mt-1 flex flex-wrap gap-1">{termos && <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[0.5rem] font-semibold text-success"><CheckCircle2 className="h-2.5 w-2.5" /> Termos assinados</span>}{quitada && <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[0.5rem] font-semibold text-success"><CheckCircle2 className="h-2.5 w-2.5" /> Quitada</span>}{cirurgia && <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[0.5rem] font-semibold text-success"><CheckCircle2 className="h-2.5 w-2.5" /> Cirurgia realizada</span>}</div>; }
function StatusContratoBadge({ cliente }: { cliente: Cliente }) {
  const status = cliente.status_contrato ?? "ativo";
  if (status === "ativo") return null;
  const tom = status === "suspenso" ? "bg-amber-50 text-amber-700 dark:bg-amber-300/10 dark:text-amber-200" : "bg-alert/10 text-alert";
  return <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.5rem] font-semibold ${tom}`}><Ban className="h-2.5 w-2.5" /> {STATUS_CONTRATO_LABEL[status]}</span>;
}
function AgendaClienteCompacta({ cliente }: { cliente: Cliente }) { if (cliente.termos_assinados_em) return <span className="mt-1 flex items-center gap-1 text-[0.52rem] text-success"><CheckCircle2 className="h-2.5 w-2.5" /> Termos assinados</span>; if (!cliente.proximo_agendamento_data) return null; return <span className="mt-1 flex items-center gap-1 text-[0.52rem] text-rose"><CalendarClock className="h-2.5 w-2.5" /> Termos: {cliente.proximo_agendamento_data.split("-").reverse().join("/")}{cliente.proximo_agendamento_horario ? ` · ${cliente.proximo_agendamento_horario}` : ""}</span>; }

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]); const [novasVendas, setNovasVendas] = useState<NovaVenda[]>([]); const [carregando, setCarregando] = useState(true); const [erro, setErro] = useState<string | null>(null); const [busca, setBusca] = useState(""); const [visualizacao, setVisualizacao] = useState<"lista" | "cards">("lista"); const [modal, setModal] = useState<Cliente | null | false>(false); const [funil, setFunil] = useState<Funil>("cadastradas");
  async function carregar(force = false) {
    const url = "/api/admin/clientes"; const cached = !force ? getInstantCache<{ clientes?: Cliente[] }>(url) : null;
    if (cached) { setClientes(cached.clientes ?? []); setCarregando(false); } else setCarregando(true);
    setErro(null);
    try {
      const [data] = await Promise.all([
        force ? refreshInstant<{ clientes?: Cliente[] }>(url) : fetchInstant<{ clientes?: Cliente[] }>(url),
      ]);
      setClientes(data.clientes ?? []);
      try { const r = await fetch("/api/admin/novas-vendas", { cache: "no-store" }); const d = await r.json(); if (r.ok) setNovasVendas(d.vendas ?? []); } catch { /* staging de vendas é opcional para a tela funcionar */ }
    } catch (e: any) { if (!cached) { setErro(e?.message ?? "Falha ao carregar clientes."); setClientes([]); } } finally { setCarregando(false); }
  }
  useEffect(() => { void carregar(); const intervalo = window.setInterval(() => void carregar(true), 30000); return () => window.clearInterval(intervalo); }, []);

  const novas = useMemo(() => novasVendas.filter((v) => !v.cliente_id && v.status === "aguardando_cadastro"), [novasVendas]);
  const aguardandoCadastro = useMemo(() => novasVendas.filter((v) => v.cliente_id && v.status === "aguardando_boletos"), [novasVendas]);
  const cadastradas = useMemo(() => clientes.filter((c) => c.status_contrato !== "cancelado"), [clientes]);
  const canceladas = useMemo(() => clientes.filter((c) => c.status_contrato === "cancelado"), [clientes]);

  const termo = busca.trim().toLowerCase();
  const filtradas = useMemo(() => { const base = funil === "canceladas" ? canceladas : cadastradas; if (!termo) return base; return base.filter((c) => c.nome_completo.toLowerCase().includes(termo)); }, [cadastradas, canceladas, funil, termo]);
  const vendasFiltradas = useMemo(() => { const base = funil === "novas" ? novas : aguardandoCadastro; if (!termo) return base; return base.filter((v) => v.nome_completo.toLowerCase().includes(termo)); }, [novas, aguardandoCadastro, funil, termo]);
  const fecharESalvar = () => { setModal(false); void carregar(true); };

  const abas: { id: Funil; label: string; total: number }[] = [
    { id: "novas", label: "Novas", total: novas.length },
    { id: "aguardando", label: "Aguardando cadastro", total: aguardandoCadastro.length },
    { id: "cadastradas", label: "Cadastradas", total: cadastradas.length },
    { id: "canceladas", label: "Contratos cancelados", total: canceladas.length },
  ];

  return <div className="space-y-5 pb-8">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-rose">Gestão</p><h1 className="mt-1 text-2xl font-semibold text-burgundy sm:text-3xl">Clientes</h1><p className="mt-1 text-sm text-clay/50">Perfil, crédito, parcelas e andamento dos termos em um único espaço.</p></div><Button onClick={() => setModal(null)}><Plus className="h-4 w-4" /> Nova cliente</Button></div>
    <div className="flex flex-wrap gap-1.5 rounded-2xl border border-rose/10 bg-cream p-1.5">{abas.map((a) => <button key={a.id} type="button" onClick={() => setFunil(a.id)} className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${funil === a.id ? "bg-burgundy text-pearl shadow-card" : "text-clay/55 hover:bg-blush/40"}`}>{a.label}<span className={`rounded-full px-1.5 py-0.5 text-[0.6rem] ${funil === a.id ? "bg-white/20" : "bg-rose/10 text-rose"}`}>{a.total}</span></button>)}</div>
    <Card className="flex flex-wrap items-center gap-2.5 p-3"><div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-clay/30" /><Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome…" className="pl-10" /></div>{(funil === "cadastradas" || funil === "canceladas") && <div className="flex items-center gap-1 rounded-full border border-rose/10 bg-cream p-1"><button onClick={() => setVisualizacao("lista")} className={`rounded-full p-2 ${visualizacao === "lista" ? "bg-burgundy text-cream" : "text-clay/40"}`} aria-label="Lista"><List className="h-3.5 w-3.5" /></button><button onClick={() => setVisualizacao("cards")} className={`rounded-full p-2 ${visualizacao === "cards" ? "bg-burgundy text-cream" : "text-clay/40"}`} aria-label="Cards"><LayoutGrid className="h-3.5 w-3.5" /></button></div>}</Card>
    {carregando ? <SkeletonCards count={6} /> : erro ? <Card className="p-8 text-center"><p className="text-sm text-alert">{erro}</p><Button size="sm" className="mt-3" onClick={() => carregar(true)}>Tentar novamente</Button></Card> : (funil === "novas" || funil === "aguardando") ? (
      vendasFiltradas.length === 0 ? <Card className="p-10 text-center text-sm text-clay/45">{funil === "novas" ? "Nenhuma venda nova aguardando conferência. Assim que o RD Station estiver conectado, elas aparecem aqui." : "Nenhuma cliente aguardando geração de parcelas."}</Card> : <Card className="overflow-hidden p-0"><div className="divide-y divide-rose/5">{vendasFiltradas.map((v) => <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5"><div className="min-w-0"><p className="truncate text-sm font-semibold text-burgundy">{v.nome_completo}</p><p className="text-[0.68rem] text-clay/40">{v.origem_venda || "Origem não informada"} · {formatarMoeda(Number(v.valor_contrato ?? 0))}</p></div>{funil === "novas" ? <Button size="sm" onClick={() => { const cpf = window.prompt("CPF da cliente (11 dígitos):", v.cpf ?? ""); const nascimento = cpf ? window.prompt("Data de nascimento (AAAA-MM-DD):") : null; if (!cpf || !nascimento) return; void fetch(`/api/admin/novas-vendas/${v.id}/cadastrar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cpf, dataNascimento: nascimento }) }).then(() => carregar(true)); }}>Conferir e cadastrar</Button> : <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[0.6rem] font-semibold text-amber-700 dark:bg-amber-300/10 dark:text-amber-200">Falta gerar parcelas</span>}</div>)}</div></Card>
    ) : filtradas.length === 0 ? <Card className="p-10 text-center text-sm text-clay/45">Nenhuma cliente encontrada.</Card> : visualizacao === "lista" ? <Card className="overflow-hidden p-0"><div className="divide-y divide-rose/5">{filtradas.map((c) => <button key={c.id} type="button" onClick={() => setModal(c)} className="grid w-full grid-cols-[minmax(0,1.5fr)_minmax(120px,.7fr)_minmax(150px,.9fr)_auto] items-center gap-3 px-4 py-3.5 text-left transition hover:bg-blush/20 sm:px-5"><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blush text-burgundy"><UserRound className="h-4 w-4" /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-burgundy">{c.nome_completo}</span><span className="block text-[0.68rem] text-clay/40">{formatarCpf(c.cpf)}</span><AgendaClienteCompacta cliente={c} /></span></div><span className="hidden text-xs text-clay/55 sm:block">{c.procedimento || "Sem procedimento"}</span><span className="text-xs text-clay/55"><span className="block">{statusPagamento(c)}</span><BadgesCiclo cliente={c} /><StatusContratoBadge cliente={c} /></span><span className="text-right text-sm font-semibold text-burgundy">{formatarMoeda(c.valor_contrato)}</span></button>)}</div></Card> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{filtradas.map((c) => <Card key={c.id} onClick={() => setModal(c)} className="cursor-pointer p-4 transition hover:-translate-y-0.5 hover:shadow-soft"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-blush text-burgundy"><UserRound className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-burgundy">{c.nome_completo}</p><p className="text-[0.68rem] text-clay/40">{formatarCpf(c.cpf)}</p><AgendaClienteCompacta cliente={c} /><BadgesCiclo cliente={c} /><StatusContratoBadge cliente={c} /></div></div><div className="mt-3 flex items-end justify-between border-t border-rose/10 pt-3"><div><p className="text-[0.58rem] uppercase tracking-label text-rose">Pagamento</p><p className="mt-1 text-xs text-clay/55">{statusPagamento(c)}</p></div><p className="text-lg font-semibold text-burgundy">{formatarMoeda(c.valor_contrato)}</p></div></Card>)}</div>}
    {modal !== false && <ModalClienteCompactoV3 cliente={modal} onClose={() => setModal(false)} onSalvo={fecharESalvar} />}
  </div>;
}
