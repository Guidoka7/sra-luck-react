import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { CalendarDays, FileInput, Landmark, Plus, RefreshCw, Search, TableProperties } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/admin/ExecutiveUI";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { financeiroApi } from "./financeiroApi";
import { FinanceiroOverview } from "./FinanceiroOverview";
import { BaixaManualModal, EditarRecebivelModal, GerarParcelasModal, RecebivelDrawer, ValidacaoModal } from "./FinanceiroOperacoes";
import { RecebiveisTable } from "./RecebiveisTable";
import type { AbaFinanceiro, ClienteFinanceiro, ListaRecebiveis, PeriodoFinanceiro, Recebivel, ResumoFinanceiro } from "./types";

const PERIODOS = [
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "mes", label: "Mês atual" },
  { value: "30d", label: "30 dias" },
  { value: "60d", label: "60 dias" },
  { value: "90d", label: "90 dias" },
] as const;

const STATUS_FILTROS = [
  { value: "todos", label: "Todos" },
  { value: "nao_pago", label: "Em aberto" },
  { value: "vencido", label: "Vencidos" },
  { value: "pendente_confirmacao", label: "Validação" },
  { value: "pago", label: "Pagos" },
] as const;

const ABAS: Array<{ id: AbaFinanceiro; label: string; icon: typeof TableProperties }> = [
  { id: "visao-geral", label: "Visão geral", icon: CalendarDays },
  { id: "recebiveis", label: "Contas a receber", icon: TableProperties },
  { id: "validacao", label: "Validação", icon: FileInput },
  { id: "contratos", label: "Contratos recebidos", icon: FileInput },
  { id: "conciliacao", label: "Conciliação", icon: Landmark },
];

function iso(date: Date) { return date.toISOString().slice(0, 10); }
function inicioMes() { const now = new Date(); return iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))); }
function fimMes() { const now = new Date(); return iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))); }
function abaInicial(): AbaFinanceiro {
  const value = new URLSearchParams(window.location.search).get("aba");
  return ABAS.some((item) => item.id === value) ? value as AbaFinanceiro : "visao-geral";
}

function periodoPreset(value: string): PeriodoFinanceiro {
  const end = new Date(); const start = new Date(end);
  if (value === "hoje") return { inicio: iso(end), fim: iso(end) };
  if (value === "mes") return { inicio: inicioMes(), fim: fimMes() };
  const dias = Number(value.replace("d", "")); start.setUTCDate(start.getUTCDate() - Math.max(0, dias - 1));
  return { inicio: iso(start), fim: iso(end) };
}

function estadoFuturo(titulo: string, descricao: string) {
  return <Panel className="p-6 dark:border-white/8 dark:bg-[#171519]/92"><div className="mx-auto flex min-h-[320px] max-w-xl flex-col items-center justify-center text-center"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blush text-burgundy dark:bg-white/7 dark:text-rose"><Landmark className="h-5 w-5" /></span><h2 className="mt-4 text-lg font-semibold text-burgundy dark:text-cream">{titulo}</h2><p className="mt-2 text-xs leading-5 text-clay/58 dark:text-white/48">{descricao}</p><span className="mt-4 rounded-full border border-gold/25 bg-gold/[0.06] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.16em] text-burgundy dark:text-gold">Estrutura preparada · integração desativada</span></div></Panel>;
}

export default function AdminFinanceiro() {
  const [aba, setAba] = useState<AbaFinanceiro>(abaInicial);
  const [periodo, setPeriodo] = useState<PeriodoFinanceiro>(() => ({ inicio: inicioMes(), fim: fimMes() }));
  const [preset, setPreset] = useState("mes"); const [busca, setBusca] = useState(""); const buscaDiferida = useDeferredValue(busca); const [status, setStatus] = useState("todos");
  const [resumo, setResumo] = useState<ResumoFinanceiro | null>(null); const [lista, setLista] = useState<ListaRecebiveis | null>(null); const [validacoes, setValidacoes] = useState<ListaRecebiveis | null>(null);
  const [carregando, setCarregando] = useState(true); const [erro, setErro] = useState(""); const [revisao, setRevisao] = useState(0);
  const [drawerId, setDrawerId] = useState<string | null>(null); const [baixa, setBaixa] = useState<Recebivel | null>(null); const [editar, setEditar] = useState<Recebivel | null>(null); const [validar, setValidar] = useState<Recebivel | null>(null);
  const [gerar, setGerar] = useState(false); const [clientes, setClientes] = useState<ClienteFinanceiro[]>([]);

  const navegar = useCallback((novaAba: AbaFinanceiro, novoStatus?: string) => {
    setAba(novaAba); if (novoStatus) setStatus(novoStatus);
    const url = new URL(window.location.href); url.searchParams.set("aba", novaAba); window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, []);

  useEffect(() => {
    let ativo = true; setCarregando(true); setErro("");
    const tarefa = aba === "visao-geral" ? financeiroApi.resumo(periodo).then((data) => { if (ativo) setResumo(data); })
      : aba === "recebiveis" ? financeiroApi.recebiveis({ ...periodo, busca: buscaDiferida, status, limite: 100 }).then((data) => { if (ativo) setLista(data); })
        : aba === "validacao" ? financeiroApi.validacoes().then((data) => { if (ativo) setValidacoes(data); }) : Promise.resolve();
    tarefa.catch((error) => { if (ativo) setErro(error instanceof Error ? error.message : "Falha ao carregar o Financeiro."); }).finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [aba, buscaDiferida, periodo, revisao, status]);

  const atualizar = useCallback(() => setRevisao((value) => value + 1), []);
  function concluir(mensagem: string) { setBaixa(null); setEditar(null); setValidar(null); setGerar(false); setDrawerId(null); atualizar(); toast.success(mensagem); }
  async function abrirGeracao() { setGerar(true); if (!clientes.length) { try { setClientes(await financeiroApi.clientes()); } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao carregar clientes."); } } }

  function aplicarPreset(value: string) { setPreset(value); if (value !== "personalizado") setPeriodo(periodoPreset(value)); }
  function pesquisar(value: string) { setBusca(value); if (value && aba !== "recebiveis") navegar("recebiveis"); }

  return <div className="space-y-4 pb-8 text-clay dark:text-[#e7dedd]">
    <PageHeader eyebrow="Operação financeira" title="Financeiro Unificado" description="Recebimentos, comprovantes, parcelas e auditoria em uma única superfície operacional." actions={<><Button size="sm" variant="secondary" onClick={() => void abrirGeracao()}><Plus className="h-4 w-4" />Adicionar parcelas</Button><Button size="sm" onClick={atualizar}><RefreshCw className={cn("h-4 w-4", carregando && "animate-spin")} />Atualizar</Button></>} />

    <Panel className="p-2.5 dark:border-white/8 dark:bg-[#171519]/92">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5">
          <span className="mr-1 shrink-0 text-[10px] font-bold uppercase tracking-[.14em] text-clay/42 dark:text-white/38">Período</span>
          {PERIODOS.map((item) => <button key={item.value} type="button" onClick={() => aplicarPreset(item.value)} className={cn("shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition", preset === item.value ? "bg-burgundy text-cream shadow-sm dark:bg-[#7f3546]" : "text-clay/58 hover:bg-blush hover:text-burgundy dark:text-white/48 dark:hover:bg-white/7 dark:hover:text-cream")}>{item.label}</button>)}
          <button type="button" onClick={() => aplicarPreset("personalizado")} className={cn("shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition", preset === "personalizado" ? "bg-burgundy text-cream shadow-sm dark:bg-[#7f3546]" : "text-clay/58 hover:bg-blush hover:text-burgundy dark:text-white/48 dark:hover:bg-white/7 dark:hover:text-cream")}>Personalizado</button>
        </div>
        <label className="relative min-w-0 flex-1 lg:max-w-[330px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-clay/35" />
          <Input aria-label="Busca financeira global" className="h-9 rounded-lg py-1.5 pl-9 text-xs" value={busca} onChange={(e) => pesquisar(e.target.value)} placeholder="Buscar cliente, CPF, parcela ou ID" />
        </label>
        {preset === "personalizado" ? <div className="flex shrink-0 items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-rose" />
          <Input aria-label="Data inicial" className="h-9 w-[126px] rounded-lg py-1.5 text-[11px]" type="date" value={periodo.inicio} onChange={(e) => setPeriodo((current) => ({ ...current, inicio: e.target.value }))} />
          <span className="text-[10px] text-clay/35">até</span>
          <Input aria-label="Data final" className="h-9 w-[126px] rounded-lg py-1.5 text-[11px]" type="date" value={periodo.fim} onChange={(e) => setPeriodo((current) => ({ ...current, fim: e.target.value }))} />
        </div> : null}
        <span className="shrink-0 text-right text-[10px] text-clay/38 dark:text-white/32">{resumo?.ultimaAtualizacao ? `Atualizado ${new Date(resumo.ultimaAtualizacao).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Aguardando atualização"}</span>
      </div>
    </Panel>

    <nav aria-label="Seções do Financeiro" className="flex gap-1 overflow-x-auto rounded-2xl border border-white/70 bg-white/70 p-1.5 shadow-sm dark:border-white/8 dark:bg-[#171519]/80">
      {ABAS.map((item) => <button key={item.id} type="button" onClick={() => navegar(item.id)} className={cn("inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-[.11em] transition", aba === item.id ? "bg-burgundy text-cream shadow-sm dark:bg-[#7f3546]" : "text-clay/52 hover:bg-blush/60 hover:text-burgundy dark:text-white/45 dark:hover:bg-white/6 dark:hover:text-cream")}><item.icon className="h-3.5 w-3.5" />{item.label}</button>)}
    </nav>

    {erro ? <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-alert/20 bg-alert/[0.06] p-3 text-xs text-alert"><span>{erro}</span><button type="button" onClick={atualizar} className="font-bold uppercase tracking-[.1em]">Tentar novamente</button></div> : null}
    {resumo?.truncado || lista?.truncado ? <p className="rounded-xl border border-gold/25 bg-gold/[0.06] p-3 text-xs text-clay/60 dark:text-white/50">A consulta atingiu o limite operacional de 5.000 parcelas. Refine o período antes de tomar uma decisão financeira.</p> : null}

    {aba === "visao-geral" ? <FinanceiroOverview resumo={resumo} carregando={carregando} onNavegar={navegar} /> : null}
    {aba === "recebiveis" ? <Panel className="overflow-hidden p-3 dark:border-white/8 dark:bg-[#171519]/92">
      <div className="mb-3 flex flex-col gap-2 border-b border-rose/10 pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-white/8">
        <div><h2 className="text-base text-burgundy dark:text-cream">Contas a receber</h2><p className="mt-0.5 text-xs text-clay/50 dark:text-white/42">{lista?.total ?? 0} lançamento(s) no período selecionado.</p></div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-blush/45 p-1 dark:bg-white/[0.04]">
          {STATUS_FILTROS.map((item) => <button key={item.value} type="button" onClick={() => setStatus(item.value)} className={cn("shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition", status === item.value ? "bg-white text-burgundy shadow-sm dark:bg-white/10 dark:text-cream" : "text-clay/55 hover:text-burgundy dark:text-white/45 dark:hover:text-cream")}>{item.label}</button>)}
        </div>
      </div>
      <RecebiveisTable itens={lista?.itens ?? []} carregando={carregando} onAbrir={(item) => setDrawerId(item.id)} />
    </Panel> : null}
    {aba === "validacao" ? <Panel className="overflow-hidden p-3 dark:border-white/8 dark:bg-[#171519]/92">
      <div className="mb-3 flex flex-col gap-2 border-b border-rose/10 pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-white/8">
        <div><h2 className="text-base text-burgundy dark:text-cream">Validação</h2><p className="mt-0.5 text-xs text-clay/50 dark:text-white/42">Comprovantes pendentes, organizados pelos vencimentos mais antigos.</p></div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-gold/15 px-2.5 py-1 text-[10px] font-bold text-burgundy dark:text-gold">{validacoes?.total ?? 0} pendentes</span>
          <span className="hidden rounded-full bg-blush/60 px-2.5 py-1 text-[10px] font-medium text-clay/55 sm:inline-flex dark:bg-white/[0.05] dark:text-white/45">Fila prioritária</span>
        </div>
      </div>
      <RecebiveisTable itens={validacoes?.itens ?? []} carregando={carregando} validacao onAbrir={(item) => setValidar(item)} />
    </Panel> : null}

    {aba === "contratos" ? estadoFuturo("Contratos recebidos", "Área preparada para uma futura estrutura de staging. Não há dados simulados, importação do RD Station ou botão de sincronização nesta fase.") : null}
    {aba === "conciliacao" ? estadoFuturo("Conciliação", "Área preparada para comparar ledger interno e provedores homologados no futuro. Nenhum banco, Mercado Pago ou Conta Azul foi consultado.") : null}

    {drawerId ? <RecebivelDrawer id={drawerId} onClose={() => setDrawerId(null)} onUpdated={atualizar} onAction={(action, item) => { setDrawerId(null); if (action === "baixa") setBaixa(item); else if (action === "editar") setEditar(item); else setValidar(item); }} /> : null}
    {baixa ? <BaixaManualModal recebivel={baixa} onClose={() => setBaixa(null)} onSuccess={() => concluir("Baixa manual registrada com auditoria.")} /> : null}
    {editar ? <EditarRecebivelModal recebivel={editar} onClose={() => setEditar(null)} onSuccess={() => concluir("Recebível atualizado.")} /> : null}
    {validar ? <ValidacaoModal recebivel={validar} onClose={() => setValidar(null)} onSuccess={() => concluir("Validação registrada com auditoria.")} /> : null}
    {gerar ? <GerarParcelasModal clientes={clientes} onClose={() => setGerar(false)} onSuccess={() => concluir("Parcelas adicionadas ao contrato.")} /> : null}
  </div>;
}
