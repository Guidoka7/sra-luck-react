"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Banknote, Calendar, Check, ChevronLeft, ChevronRight, Lock, RefreshCw, Search, Star, Unlock } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn, formatarMoeda, nomeMes } from "@/lib/utils";

const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
type Estado = "verde" | "amarelo" | "vermelho" | "cinza" | "passado";
type AcaoData = "liberar" | "fechar" | null;
interface Dia { data: string; dia: number; estado: Estado; oracamentoAntes: number; oracamentoDepois: number; ultrapassagem: number; dentroOrcamento: boolean; ocupante: { nome: string; valor: number } | null }
interface Analise { orcamentoMensal: number; calendario: { dias: Dia[] }; melhorData: { data: string } | null }
interface Solicitacao { id: string; cliente_id: string; forma_custeio: string; saldo_restante: number; status: string; clientes?: { nome_completo: string } | null; data_termos: string | null; previsao_sugerida: string | null }
interface ClienteAgenda { agendamentoId: string; clienteId: string; nome: string; dataTermos: string | null; previsaoAtual: string | null; valor: number; custeioConfirmado: boolean; cirurgiaRealizada: boolean; statusFinanceiro: string | null; formaCusteio: string | null; saldoRestante: number | null }
interface DataLiberacao { id: string; data: string; status: string; vagasOcupadas: number; clientes: { nome: string; valor: number }[] }

const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const curta = (x: string | null) => x ? x.split("-").reverse().join("/") : "—";
const forma = (x: string | null) => x === "cartao" ? "Cartão de crédito" : x === "pix" ? "PIX" : x === "boleto_100" ? "100% boleto" : x === "cheques" ? "Cheques" : "—";

export function CicloLiberacaoFinanceiraV2() {
  const hoje = hojeIso();
  const now = new Date();
  const [ano,setAno] = useState(now.getFullYear());
  const [mes,setMes] = useState(now.getMonth()+1);
  const [selecionado,setSelecionado] = useState("");
  const [busca,setBusca] = useState("");
  const [solicitacoes,setSolicitacoes] = useState<Solicitacao[]>([]);
  const [clientes,setClientes] = useState<ClienteAgenda[]>([]);
  const [datasLiberacao,setDatasLiberacao] = useState<DataLiberacao[]>([]);
  const [analise,setAnalise] = useState<Analise|null>(null);
  const [data,setData] = useState<string|null>(null);
  const [acaoData,setAcaoData] = useState<AcaoData>(null);
  const [confirmacao,setConfirmacao] = useState(false);
  const [amarela,setAmarela] = useState(false);
  const [modalCirurgia,setModalCirurgia] = useState<ClienteAgenda|null>(null);
  const [salvando,setSalvando] = useState(false);
  const [carregando,setCarregando] = useState(false);

  async function carregarDatasLiberacao() {
    const r = await fetch(`/api/admin/datas-liberacao-financeira?ano=${ano}&mes=${mes}`, { cache:"no-store" });
    if (!r.ok) return;
    const j = await r.json();
    setDatasLiberacao(j.datas ?? []);
  }

  async function buscar() {
    const [a,b] = await Promise.all([
      fetch("/api/admin/solicitacoes-liberacao-financeira", { cache:"no-store" }),
      fetch("/api/admin/clientes-agendamentos", { cache:"no-store" }),
      carregarDatasLiberacao(),
    ]);
    if (a.ok) setSolicitacoes((await a.json()).solicitacoes ?? []);
    if (b.ok) setClientes((await b.json()).clientes ?? []);
  }

  async function calendario() {
    setCarregando(true);
    try {
      const q = new URLSearchParams({ ano:String(ano), mes:String(mes) });
      if (selecionado) q.set("agendamento_id", selecionado);
      const r = await fetch(`/api/admin/liberacao-inteligente?${q}`, { cache:"no-store" });
      if (r.ok) setAnalise(await r.json());
    } finally { setCarregando(false); }
  }

  useEffect(() => { void buscar(); const t = window.setInterval(() => void buscar(), 5000); return () => clearInterval(t); }, [ano,mes]);
  useEffect(() => { void calendario(); }, [ano,mes,selecionado]);

  useEffect(() => {
    const due = clientes.find(c => c.previsaoAtual && c.previsaoAtual <= hoje && !c.cirurgiaRealizada);
    if (!due) return;
    const k = `ciclo-${due.agendamentoId}-${due.previsaoAtual}`;
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k,"1");
    setModalCirurgia(due);
  }, [clientes,hoje]);

  const q = busca.trim().toLocaleLowerCase("pt-BR");
  const previsoes = useMemo(() => solicitacoes.filter(s => ["pendente","em_analise","aprovada"].includes(s.status) && (!q || (s.clientes?.nome_completo ?? "").toLocaleLowerCase("pt-BR").includes(q))), [solicitacoes,q]);
  const confirmadas = useMemo(() => clientes.filter(c => Boolean(c.previsaoAtual) && (!q || c.nome.toLocaleLowerCase("pt-BR").includes(q))).sort((a,b) => (a.previsaoAtual ?? "").localeCompare(b.previsaoAtual ?? "")), [clientes,q]);
  const selecionada = useMemo(() => clientes.find(c => c.agendamentoId === selecionado) ?? null, [clientes,selecionado]);
  const dias = analise?.calendario.dias ?? [];
  const orc = analise?.orcamentoMensal ?? 0;
  const liberado = dias[0]?.oracamentoAntes ?? 0;
  const datasMap = useMemo(() => new Map(datasLiberacao.map(d => [d.data,d])), [datasLiberacao]);

  function mesDelta(n:number) {
    let m = mes+n, a = ano;
    if (m > 12) { m=1; a++; }
    if (m < 1) { m=12; a--; }
    setMes(m); setAno(a);
  }

  function selecionarSolicitacao(s:Solicitacao) {
    const c = clientes.find(x => x.clienteId === s.cliente_id);
    if (!c) { toast.error("Agendamento confirmado não encontrado para esta solicitação."); return; }
    setSelecionado(c.agendamentoId);
    if (s.status === "aprovada") {
      const sugestao = s.previsao_sugerida || (c.dataTermos ? (() => { const d = new Date(`${c.dataTermos}T00:00:00`); d.setDate(d.getDate()+90); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })() : null);
      setData(sugestao);
      if (sugestao) { setMes(Number(sugestao.slice(5,7))); setAno(Number(sugestao.slice(0,4))); }
    } else {
      setData(null);
    }
  }

  async function confirmarCusteio(s:Solicitacao) {
    setSalvando(true);
    try {
      const r = await fetch("/api/admin/solicitacoes-liberacao-financeira", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ id:s.id, status:"aprovada" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.erro ?? "Não foi possível confirmar o custeio."); return; }
      toast.success("Forma de custeio confirmada. Agora escolha a data da liberação financeira.");
      await buscar();
    } finally { setSalvando(false); }
  }

  async function alternarLiberacaoData() {
    if (!data || !acaoData) return;
    setSalvando(true);
    try {
      const url = "/api/admin/datas-liberacao-financeira";
      const r = acaoData === "liberar"
        ? await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data})})
        : await fetch(`${url}?data=${encodeURIComponent(data)}`,{method:"DELETE"});
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.erro ?? "Não foi possível atualizar a data."); return; }
      toast.success(acaoData === "liberar" ? "Data liberada para previsão financeira." : "Data fechada para novas previsões.");
      setAcaoData(null);
      await Promise.all([carregarDatasLiberacao(),calendario()]);
    } finally { setSalvando(false); }
  }

  function clicarDia(x:Dia) {
    if (x.estado === "passado" || x.estado === "vermelho") return;
    if (selecionado) {
      if (!datasMap.has(x.data)) {
        setData(x.data);
        setAcaoData("liberar");
        return;
      }
      setData(x.data);
      if (x.estado === "amarelo") setAmarela(true); else setConfirmacao(true);
      return;
    }
    setData(x.data);
    setAcaoData(datasMap.has(x.data) ? "fechar" : "liberar");
  }

  async function salvarPrevisao() {
    if (!selecionado || !data) return;
    if (!datasMap.has(data)) { setAcaoData("liberar"); return; }
    setSalvando(true);
    try {
      const r = await fetch(`/api/admin/agendamentos/${selecionado}/previsao`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({previsaoLiberacaoFinanceira:data}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.erro ?? "Não foi possível confirmar a previsão."); return; }
      toast.success("Liberação financeira confirmada.");
      setConfirmacao(false); setAmarela(false); setData(null); setSelecionado("");
      await Promise.all([buscar(),calendario(),carregarDatasLiberacao()]);
    } finally { setSalvando(false); }
  }

  async function cirurgiaRealizada(c:ClienteAgenda) {
    setSalvando(true);
    try {
      const r = await fetch(`/api/admin/agendamentos/${c.agendamentoId}/ciclo`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({cirurgiaRealizada:true}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.erro ?? "Não foi possível atualizar."); return; }
      toast.success("Cirurgia marcada como realizada.");
      setModalCirurgia(null);
      await buscar();
    } finally { setSalvando(false); }
  }

  return <div className="animate-fadeUp flex flex-col gap-3 pb-6">
    <Card className="overflow-hidden p-0 shadow-sm">
      <div className="border-b border-rose/10 bg-gradient-to-r from-blush/35 via-transparent to-gold/5 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gold/12"><Calendar className="h-3.5 w-3.5 text-gold"/></span><div><h2 className="font-heading text-sm text-burgundy sm:text-base">Agenda de liberação financeira</h2><p className="hidden text-[0.62rem] text-clay/50 sm:block">Defina datas disponíveis e confirme a previsão financeira das clientes.</p></div></div>
          </div>
          <div className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5",liberado>=orc ? "border-alert/20 bg-alert/8 text-alert" : "border-success/20 bg-success/8 text-success")}><span className="text-[0.55rem] font-semibold uppercase tracking-label">Mês</span><strong className="text-[0.68rem]">{formatarMoeda(liberado)}</strong><span className="text-[0.55rem] opacity-50">/ {formatarMoeda(orc)}</span></div>
        </div>
      </div>

      {selecionada && <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/20 bg-gold/8 px-3 py-2 sm:mx-5"><div className="flex min-w-0 items-center gap-2.5"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/15 text-[0.62rem] font-bold text-burgundy">{selecionada.nome.slice(0,1).toUpperCase()}</div><div className="min-w-0"><p className="text-[0.52rem] font-bold uppercase tracking-label text-gold">Cliente selecionada</p><p className="truncate text-xs font-bold text-burgundy">{selecionada.nome}</p></div><div className="hidden h-5 w-px bg-gold/20 sm:block"/><div className="hidden text-[0.58rem] text-clay/55 sm:block">Termos <strong className="text-clay/70">{curta(selecionada.dataTermos)}</strong> · Sugestão <strong className="text-burgundy">{curta(data ?? null)}</strong></div></div><button onClick={()=>{setSelecionado("");setData(null)}} className="rounded-md border border-rose/12 bg-[rgb(var(--surface-1))] px-2 py-1 text-[0.55rem] font-semibold text-clay/65 transition-colors hover:bg-blush">Voltar</button></div>}

      <div className="px-4 pt-3 sm:px-5"><div className="mx-auto flex max-w-3xl items-center justify-between rounded-lg border border-rose/10 bg-[rgb(var(--surface-2))] px-1.5 py-1"><button onClick={()=>mesDelta(-1)} aria-label="Mês anterior" className="flex h-7 w-7 items-center justify-center rounded-md text-burgundy transition-colors hover:bg-blush"><ChevronLeft className="h-3.5 w-3.5"/></button><div className="flex items-center gap-2"><span className="font-heading text-xs text-burgundy sm:text-sm">{nomeMes(mes)} {ano}</span>{carregando&&<RefreshCw className="h-3 w-3 animate-spin text-gold"/>}</div><button onClick={()=>mesDelta(1)} aria-label="Próximo mês" className="flex h-7 w-7 items-center justify-center rounded-md text-burgundy transition-colors hover:bg-blush"><ChevronRight className="h-3.5 w-3.5"/></button></div></div>

      <div className="px-4 py-3 sm:px-5 sm:py-4"><div className="mx-auto w-full max-w-3xl"><div className="mb-1.5 grid grid-cols-7 text-center">{DIAS.map((x,i)=><span key={i} className="text-[0.52rem] font-bold uppercase tracking-label text-rose/65">{x}</span>)}</div><div className="grid grid-cols-7 gap-1.5 sm:gap-2">{dias.map(x=>{const liberada=datasMap.has(x.data);const sugestao=data===x.data;const cl=x.estado==="vermelho"?"border-burgundy/80 bg-burgundy font-semibold text-cream":x.estado==="amarelo"?"border-gold/50 bg-gold/12 font-semibold text-burgundy hover:bg-gold/20":x.estado==="passado"?"border-transparent bg-transparent text-clay/18":liberada?"border-success/30 bg-success/8 font-semibold text-success hover:bg-success/13":x.estado==="verde"?"border-success/18 bg-success/4 font-semibold text-success/75 hover:bg-success/8":"border-clay/[0.07] bg-clay/[0.025] text-clay/40 hover:bg-clay/[0.06]";return <button key={x.data} disabled={x.estado==="passado"||x.estado==="vermelho"} onClick={()=>clicarDia(x)} className={cn("group relative flex aspect-square min-h-9 flex-col items-center justify-center rounded-lg border text-xs font-medium transition-all sm:min-h-10 sm:rounded-xl",cl,!liberada&&x.estado!=="passado"&&x.estado!=="vermelho"&&"opacity-60",x.data===hoje&&"ring-1.5 ring-gold/70 ring-offset-1",sugestao&&"ring-2 ring-gold ring-offset-1")}>{x.dia}{sugestao&&<Star className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-gold p-0.5 text-white"/>}{liberada&&<span className="absolute bottom-1 h-1 w-1 rounded-full bg-success"/>}</button>})}</div><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rose/8 pt-2.5 text-[0.55rem] text-clay/50"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success"/>Liberada</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-gold"/>Acima do orçamento</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-burgundy"/>Ocupada</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-clay/20"/>Fechada</span></div><p className="mt-2 text-[0.58rem] text-clay/40">{selecionado ? "Clique em uma data para definir a liberação desta cliente." : "Selecione uma solicitação para escolher a data."}</p></div></div>
    </Card>

    <section className="rounded-xl border border-rose/10 bg-[rgb(var(--surface-1))] p-3 shadow-sm sm:p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold/10"><Banknote className="h-3.5 w-3.5 text-gold"/></span><div><div className="flex items-center gap-2"><h2 className="font-heading text-sm text-burgundy">Fluxo financeiro</h2><span className="rounded-full bg-blush px-1.5 py-0.5 text-[0.5rem] font-bold text-burgundy">{previsoes.length + confirmadas.length}</span></div><p className="hidden text-[0.58rem] text-clay/45 sm:block">Selecione uma cliente, valide o custeio e confirme a data.</p></div></div><button onClick={()=>void buscar()} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rose/10 bg-[rgb(var(--surface-2))] px-2.5 text-[0.55rem] font-semibold text-burgundy transition-colors hover:bg-blush"><RefreshCw className="h-3 w-3"/> Atualizar</button></div>
      <div className="relative mt-2.5"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-clay/35"/><input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar pelo nome..." className="h-8 w-full rounded-lg border border-rose/9 bg-[rgb(var(--surface-2))] pl-8 pr-3 text-[0.65rem] text-burgundy outline-none transition-colors placeholder:text-clay/30 focus:border-gold/30"/></div>
      <div className="mt-2.5 grid gap-2 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-success/12 bg-[rgb(var(--surface-2))]"><div className="flex items-center justify-between gap-2 border-b border-success/8 px-2.5 py-2"><div className="min-w-0"><p className="text-[0.55rem] font-bold uppercase tracking-label text-success">Solicitações de previsão</p><p className="hidden text-[0.52rem] text-clay/40 sm:block">Validação de custeio antes da escolha da data.</p></div><span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[0.55rem] font-bold text-success">{previsoes.length}</span></div>{previsoes.length ? <div className="grid max-h-[19rem] gap-1 overflow-y-auto p-1.5">{previsoes.map(s=>{const selecionadaNestaSolicitacao=Boolean(selecionado&&selecionada?.clienteId===s.cliente_id);const aguardando=s.status!=="aprovada";return <div key={s.id} className={cn("rounded-md border bg-[rgb(var(--surface-1))] px-2.5 py-2 text-left transition-colors",selecionadaNestaSolicitacao?"border-gold/40 bg-gold/5 ring-1 ring-gold/15":"border-rose/7 hover:border-rose/14")}><button onClick={()=>selecionarSolicitacao(s)} className="w-full text-left"><div className="flex items-center justify-between gap-2"><span className="truncate text-[0.68rem] font-bold text-burgundy">{s.clientes?.nome_completo ?? "Cliente"}</span><span className={cn("shrink-0 text-[0.48rem] font-bold uppercase tracking-wide",aguardando?"text-gold":"text-success")}>{aguardando?"Aguardando validação":"Custeio confirmado"}</span></div><div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.53rem] text-clay/48"><span>{forma(s.forma_custeio)}</span><strong className="text-burgundy">{formatarMoeda(+s.saldo_restante)}</strong>{s.data_termos ? <span>Termos {curta(s.data_termos)}</span> : <span>Aguardando termos</span>}{s.previsao_sugerida&&<span className="rounded bg-gold/8 px-1 py-0.5 font-semibold text-burgundy">Sug. {curta(s.previsao_sugerida)}</span>}</div></button>{aguardando && selecionadaNestaSolicitacao && <button disabled={salvando} onClick={()=>void confirmarCusteio(s)} className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md bg-burgundy px-2 py-1.5 text-[0.52rem] font-bold uppercase tracking-[0.08em] text-cream disabled:opacity-50"><Check className="h-3 w-3"/> Confirmar forma de custeio</button>}{!aguardando && selecionadaNestaSolicitacao && <p className="mt-1.5 rounded-md bg-success/8 px-2 py-1.5 text-[0.52rem] font-semibold text-success">Custeio confirmado. Escolha uma data no calendário acima.</p>}</div>})}</div> : <p className="px-2.5 py-4 text-center text-[0.58rem] text-clay/40">Nenhuma solicitação de previsão.</p>}</div>
        <div className="overflow-hidden rounded-lg border border-rose/10 bg-[rgb(var(--surface-2))]"><div className="flex items-center justify-between gap-2 border-b border-rose/8 px-2.5 py-2"><div className="min-w-0"><p className="text-[0.55rem] font-bold uppercase tracking-label text-rose">Liberações confirmadas</p><p className="hidden text-[0.52rem] text-clay/40 sm:block">Previsões financeiras já definidas.</p></div><span className="rounded-full bg-blush px-1.5 py-0.5 text-[0.55rem] font-bold text-burgundy">{confirmadas.length}</span></div>{confirmadas.length ? <div className="grid max-h-[19rem] gap-1 overflow-y-auto p-1.5">{confirmadas.map(c=><button key={c.agendamentoId} onClick={()=>{setSelecionado(c.agendamentoId);setData(c.previsaoAtual);if(c.previsaoAtual){setMes(Number(c.previsaoAtual.slice(5,7)));setAno(Number(c.previsaoAtual.slice(0,4)));}}} className="rounded-md border border-rose/7 bg-[rgb(var(--surface-1))] px-2.5 py-2 text-left transition-colors hover:border-rose/14 hover:bg-blush/10"><div className="flex items-center justify-between gap-2"><span className="truncate text-[0.68rem] font-bold text-burgundy">{c.nome}</span><span className="shrink-0 text-[0.68rem] font-bold tracking-tight text-success">{curta(c.previsaoAtual)}</span></div><div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[0.53rem] text-clay/48"><span>Termos {curta(c.dataTermos)}</span>{c.formaCusteio&&<span>{forma(c.formaCusteio)}</span>}{c.saldoRestante!==null&&<span>{formatarMoeda(c.saldoRestante)}</span>}</div></button>)}</div> : <p className="px-2.5 py-4 text-center text-[0.58rem] text-clay/40">Nenhuma liberação confirmada.</p>}</div>
      </div>
    </section>

    <div className="flex items-center gap-2 rounded-lg border border-gold/15 bg-gold/5 px-3 py-2"><div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/12 text-[0.58rem] font-bold text-gold">i</div><p className="text-[0.58rem] leading-relaxed text-clay/55"><strong className="text-burgundy">Sugestão automática:</strong> 90 dias após a assinatura dos termos. Você pode selecionar qualquer outra data disponível no calendário.</p></div>

    {acaoData && data && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"><Card className="w-full max-w-sm p-4 shadow-xl"><div className="flex gap-2.5"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blush">{acaoData === "liberar" ? <Unlock className="h-4 w-4 text-burgundy"/> : <Lock className="h-4 w-4 text-burgundy"/>}</div><div><h2 className="font-heading text-sm text-burgundy">{acaoData === "liberar" ? "Liberar esta data?" : "Fechar esta data?"}</h2><p className="mt-0.5 text-[0.62rem] text-clay/55">{curta(data)}</p></div></div><p className="mt-3 rounded-lg bg-clay/5 p-2.5 text-[0.58rem] leading-relaxed text-clay/60">{selecionado ? "Esta data será liberada para que a previsão desta cliente possa ser vinculada. Depois você poderá confirmar a liberação imediatamente." : acaoData === "liberar" ? "A data ficará disponível para novas previsões financeiras." : "A data deixará de aparecer como disponível para novas previsões."}</p><div className="mt-3 flex gap-1.5"><Button variant="secondary" size="sm" onClick={()=>setAcaoData(null)} className="flex-1">Cancelar</Button><Button size="sm" loading={salvando} onClick={()=>void alternarLiberacaoData()} className="flex-1">{acaoData === "liberar" ? "Liberar" : "Fechar data"}</Button></div></Card></div>}
    {(confirmacao||amarela) && data && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"><Card className="w-full max-w-sm p-4 shadow-xl"><h2 className="font-heading text-sm text-burgundy">{amarela ? "Atenção ao orçamento" : "Confirmar liberação financeira?"}</h2><p className="mt-1.5 text-[0.62rem] text-clay/55">Data: <strong className="text-burgundy">{curta(data)}</strong></p><p className="mt-2 rounded-lg bg-gold/8 p-2.5 text-[0.58rem] leading-relaxed text-burgundy">A sugestão padrão é 90 dias após a assinatura dos termos. Você pode confirmar esta ou escolher qualquer outra data liberada.</p>{amarela && <p className="mt-1.5 rounded-lg bg-alert/8 p-2.5 text-[0.58rem] leading-relaxed text-clay/65">Esta data ultrapassa o orçamento mensal.</p>}<div className="mt-3 flex gap-1.5"><Button variant="secondary" size="sm" onClick={()=>{setConfirmacao(false);setAmarela(false)}} className="flex-1">Cancelar</Button><Button size="sm" loading={salvando} onClick={()=>void salvarPrevisao()} className="flex-1">Confirmar</Button></div></Card></div>}
    {modalCirurgia && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"><Card className="w-full max-w-sm p-4 shadow-xl"><div className="flex gap-2.5"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blush"><AlertCircle className="h-4 w-4 text-burgundy"/></div><div><h2 className="font-heading text-sm text-burgundy">Hoje é a previsão de liberação</h2><p className="mt-1 text-[0.62rem] text-clay/60"><strong>{modalCirurgia.nome}</strong>: a cirurgia foi realizada?</p><p className="mt-0.5 text-[0.55rem] text-clay/45">Previsão: {curta(modalCirurgia.previsaoAtual)}</p></div></div><div className="mt-3 flex gap-1.5"><Button variant="secondary" size="sm" onClick={()=>setModalCirurgia(null)} className="flex-1">Ainda não</Button><Button size="sm" loading={salvando} onClick={()=>void cirurgiaRealizada(modalCirurgia)} className="flex-1">Sim, realizada</Button></div></Card></div>}
  </div>;
}