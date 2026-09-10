"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Banknote, Calendar, Check, ChevronLeft, ChevronRight, Clock3, RefreshCw, Search, Star } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn, formatarMoeda, nomeMes } from "@/lib/utils";

const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
type Estado = "verde" | "amarelo" | "vermelho" | "cinza" | "passado";
interface Dia { data: string; dia: number; estado: Estado; oracamentoAntes: number; oracamentoDepois: number; ultrapassagem: number; dentroOrcamento: boolean; ocupante: { nome: string; valor: number } | null; }
interface Analise { cliente: { id: string; nome: string; valor: number; dataTermos: string | null; } | null; orcamentoMensal: number; calendario: { ano: number; mes: number; dias: Dia[] }; melhorData: { data: string } | null; }
interface Solicitacao { id: string; cliente_id: string; forma_custeio: string; saldo_restante: number; total_com_taxa: number; status: string; clientes?: { nome_completo: string } | null; data_termos: string | null; previsao_sugerida: string | null; }
interface ClienteAgenda { agendamentoId: string; clienteId: string; nome: string; previsaoAtual: string | null; valor: number; custeioConfirmado: boolean; cirurgiaRealizada: boolean; statusFinanceiro: string | null; formaCusteio: string | null; saldoRestante: number | null; }

function dataHoje() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function dataCurta(iso: string | null) { return iso ? iso.split("-").reverse().join("/") : "—"; }
function diasAte(iso: string | null) { if (!iso) return null; const [y,m,d]=iso.split("-").map(Number); const [hy,hm,hd]=dataHoje().split("-").map(Number); return Math.round((Date.UTC(y,m-1,d)-Date.UTC(hy,hm-1,hd))/86400000); }
function formaLabel(forma: string | null) { if (forma === "cartao") return "Cartão de crédito"; if (forma === "pix") return "PIX"; if (forma === "boleto_100") return "100% boleto"; return "Cheques"; }

export function CicloLiberacaoFinanceira() {
  const hoje = dataHoje();
  const d = new Date();
  const [ano,setAno] = useState(d.getFullYear());
  const [mes,setMes] = useState(d.getMonth()+1);
  const [selecionado,setSelecionado] = useState("");
  const [solicitacoes,setSolicitacoes] = useState<Solicitacao[]>([]);
  const [clientes,setClientes] = useState<ClienteAgenda[]>([]);
  const [analise,setAnalise] = useState<Analise|null>(null);
  const [dataSelecionada,setDataSelecionada] = useState<string|null>(null);
  const [modalConfirmacao,setModalConfirmacao] = useState(false);
  const [modalAmarela,setModalAmarela] = useState(false);
  const [modalCirurgia,setModalCirurgia] = useState<ClienteAgenda|null>(null);
  const [busca,setBusca] = useState("");
  const [salvando,setSalvando] = useState(false);
  const [carregando,setCarregando] = useState(true);

  async function carregarSolicitacoes() {
    const r=await fetch("/api/admin/solicitacoes-liberacao-financeira",{cache:"no-store"});
    if(r.ok){const j=await r.json();setSolicitacoes(j.solicitacoes??[]);}
  }
  async function carregarClientes() {
    const r=await fetch("/api/admin/clientes-agendamentos",{cache:"no-store"});
    if(r.ok){const j=await r.json();setClientes(j.clientes??[]);}
  }
  async function carregarCalendario() {
    setCarregando(true);
    try {
      const q=new URLSearchParams({ano:String(ano),mes:String(mes)});
      if(selecionado) q.set("agendamento_id",selecionado);
      const r=await fetch(`/api/admin/liberacao-inteligente?${q}`,{cache:"no-store"});
      const j=await r.json(); if(r.ok)setAnalise(j); else toast.error(j.erro??"Não foi possível carregar a agenda.");
    } catch { toast.error("Não foi possível atualizar a agenda."); } finally { setCarregando(false); }
  }
  async function recarregarTudo() { await Promise.all([carregarSolicitacoes(),carregarClientes(),carregarCalendario()]); }

  useEffect(()=>{ recarregarTudo(); const t=window.setInterval(()=>{carregarSolicitacoes();carregarClientes();},5000); return()=>window.clearInterval(t); },[]);
  useEffect(()=>{ carregarCalendario(); },[ano,mes,selecionado]);

  useEffect(()=>{
    const devida=clientes.find(c=>c.previsaoAtual && c.previsaoAtual<=hoje && !c.cirurgiaRealizada);
    if(!devida) return;
    const chave=`ciclo-cirurgia-${devida.agendamentoId}-${devida.previsaoAtual}`;
    if(sessionStorage.getItem(chave)==="1") return;
    sessionStorage.setItem(chave,"1");
    setModalCirurgia(devida);
  },[clientes,hoje]);

  const pendentes=useMemo(()=>{const q=busca.trim().toLocaleLowerCase("pt-BR");return solicitacoes.filter(s=>(s.clientes?.nome_completo??"").toLocaleLowerCase("pt-BR").includes(q));},[solicitacoes,busca]);
  const confirmadas=useMemo(()=>{const q=busca.trim().toLocaleLowerCase("pt-BR");return clientes.filter(c=>!q||c.nome.toLocaleLowerCase("pt-BR").includes(q)).sort((a,b)=>(a.previsaoAtual??"").localeCompare(b.previsaoAtual??""));},[clientes,busca]);
  const dias=analise?.calendario.dias??[];
  const valorMes=useMemo(()=>dias[0]?.oracamentoAntes??0,[dias]);
  const orcamento=analise?.orcamentoMensal??0;
  const orcamentoCheio=valorMes>=orcamento;

  function selecionarSolicitacao(s:Solicitacao){
    const c=clientes.find(x=>x.clienteId===s.cliente_id);
    if(!c){toast.error("Não foi possível localizar o agendamento desta cliente.");return;}
    setSelecionado(c.agendamentoId);setDataSelecionada(s.previsao_sugerida);
    if(s.previsao_sugerida){setMes(Number(s.previsao_sugerida.slice(5,7)));setAno(Number(s.previsao_sugerida.slice(0,4)));}
  }
  function mudarMes(delta:number){let m=mes+delta,a=ano;if(m>12){m=1;a++;}if(m<1){m=12;a--;}setMes(m);setAno(a);setDataSelecionada(null);}
  async function salvarPrevisao(data:string){
    if(!selecionado)return; setSalvando(true);
    try{const r=await fetch(`/api/admin/agendamentos/${selecionado}/previsao`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({previsaoLiberacaoFinanceira:data})});const j=await r.json().catch(()=>({}));if(!r.ok){toast.error(j.erro??"Não foi possível salvar a previsão.");return;}toast.success("Previsão confirmada.");setModalConfirmacao(false);setModalAmarela(false);setDataSelecionada(null);await recarregarTudo();}finally{setSalvando(false);}
  }
  async function atualizarCiclo(c:ClienteAgenda,campo:"custeioConfirmado"|"cirurgiaRealizada",valor:boolean){
    setSalvando(true);try{const r=await fetch(`/api/admin/agendamentos/${c.agendamentoId}/ciclo`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({[campo]:valor})});const j=await r.json().catch(()=>({}));if(!r.ok){toast.error(j.erro??"Não foi possível atualizar o ciclo.");return;}toast.success(campo==="custeioConfirmado"?"Custeio confirmado.":"Cirurgia marcada como realizada.");setModalCirurgia(null);await carregarClientes();}finally{setSalvando(false);}
  }

  return <div className="animate-fadeUp space-y-3 pb-8">
    <section className="rounded-2xl border border-rose/12 bg-[rgb(var(--surface-1))] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="flex items-center gap-2"><Banknote className="h-4 w-4 text-gold"/><h2 className="font-heading text-sm text-burgundy">Solicitações de previsão</h2></div><p className="mt-0.5 text-[0.65rem] text-clay/50">Após confirmar a data, a cliente passa automaticamente para previsões confirmadas.</p></div><button type="button" onClick={recarregarTudo} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-rose/12 bg-[rgb(var(--surface-2))] px-2.5 text-[0.62rem] font-semibold text-burgundy"><RefreshCw className="h-3 w-3"/> Atualizar</button></div>
      <div className="relative mt-3"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-clay/40"/><input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar cliente…" className="h-9 w-full rounded-xl border border-rose/10 bg-[rgb(var(--surface-2))] pl-9 pr-3 text-xs text-burgundy outline-none placeholder:text-clay/35"/></div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <div className="rounded-xl border border-gold/15 bg-[rgb(var(--surface-2))] p-2.5"><div className="flex items-center justify-between px-1 pb-2"><p className="text-[0.58rem] font-bold uppercase tracking-label text-rose">Aguardando previsão</p><span className="rounded-full bg-gold/12 px-2 py-0.5 text-[0.6rem] font-bold text-burgundy">{pendentes.length}</span></div>{pendentes.length===0?<p className="rounded-lg bg-clay/5 px-3 py-3 text-[0.66rem] text-clay/45">Nenhuma cliente aguardando previsão.</p>:<div className="grid gap-1.5">{pendentes.slice(0,7).map(s=><button key={s.id} onClick={()=>selecionarSolicitacao(s)} className={cn("rounded-lg border bg-[rgb(var(--surface-1))] px-2.5 py-2 text-left",clientes.some(c=>c.agendamentoId===selecionado&&c.clienteId===s.cliente_id)?"border-gold/45 bg-gold/10":"border-rose/8")}><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-bold text-burgundy">{s.clientes?.nome_completo??"Cliente"}</span><span className="text-[0.52rem] font-bold uppercase text-burgundy">{s.status}</span></div><div className="mt-1 flex flex-wrap items-center gap-2 text-[0.57rem] text-clay/50"><span>{formaLabel(s.forma_custeio)}</span><strong className="text-burgundy">{formatarMoeda(Number(s.saldo_restante))}</strong>{s.previsao_sugerida&&<span className="rounded-full bg-gold/10 px-1.5 py-0.5 font-semibold text-burgundy">Sugestão: {dataCurta(s.previsao_sugerida)}</span>}</div></button>)}</div>}</div>
        <div className="rounded-xl border border-success/15 bg-[rgb(var(--surface-2))] p-2.5"><div className="flex items-center justify-between px-1 pb-2"><div><p className="text-[0.58rem] font-bold uppercase tracking-label text-success">Previsões confirmadas</p><p className="text-[0.6rem] text-clay/45">Custeio e cirurgia ficam visíveis até os dois checklists serem concluídos.</p></div><span className="rounded-full bg-success/10 px-2 py-0.5 text-[0.6rem] font-bold text-success">{confirmadas.length}</span></div>{confirmadas.length===0?<p className="rounded-lg bg-clay/5 px-3 py-3 text-[0.66rem] text-clay/45">Nenhuma previsão ativa.</p>:<div className="grid max-h-[22rem] gap-1.5 overflow-y-auto pr-1">{confirmadas.map(c=>{const diasRest=diasAte(c.previsaoAtual);const liberacaoChegou=diasRest!==null&&diasRest<=0;return <div key={c.agendamentoId} className="rounded-lg border border-success/10 bg-[rgb(var(--surface-1))] p-2.5"><button type="button" onClick={()=>{setSelecionado(c.agendamentoId);if(c.previsaoAtual){setMes(Number(c.previsaoAtual.slice(5,7)));setAno(Number(c.previsaoAtual.slice(0,4)));}}} className="flex w-full items-start justify-between gap-2 text-left"><div className="min-w-0"><p className="truncate text-xs font-bold text-burgundy">{c.nome}</p><div className="mt-1 flex flex-wrap gap-1"><span className="rounded-full bg-blush px-1.5 py-0.5 text-[0.52rem] text-clay/65">Liberação {dataCurta(c.previsaoAtual)}</span><span className="rounded-full bg-[rgb(var(--surface-2))] px-1.5 py-0.5 text-[0.52rem] text-clay/65">{formaLabel(c.formaCusteio)}</span>{c.saldoRestante!==null&&<span className="rounded-full bg-[rgb(var(--surface-2))] px-1.5 py-0.5 text-[0.52rem] text-clay/65">Restante {formatarMoeda(c.saldoRestante)}</span>}</div></div><Clock3 className={cn("h-4 w-4 shrink-0",liberacaoChegou?"text-alert":"text-success")}/></button><div className="mt-2 flex flex-wrap gap-1.5"><button type="button" disabled={salvando} onClick={()=>atualizarCiclo(c,"custeioConfirmado",!c.custeioConfirmado)} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[0.56rem] font-semibold",c.custeioConfirmado?"border-success/30 bg-success/10 text-success":"border-rose/10 bg-[rgb(var(--surface-2))] text-clay/65")}><Check className="h-3 w-3"/>{c.custeioConfirmado?"Custeio confirmado":"Confirmar custeio"}</button><button type="button" disabled={salvando||!liberacaoChegou} onClick={()=>liberacaoChegou&&atualizarCiclo(c,"cirurgiaRealizada",true)} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[0.56rem] font-semibold",c.cirurgiaRealizada?"border-success/30 bg-success/10 text-success":liberacaoChegou?"border-burgundy/15 bg-burgundy/5 text-burgundy":"border-clay/10 bg-clay/5 text-clay/35")}>{c.cirurgiaRealizada?"Cirurgia realizada":"Cirurgia realizada"}</button></div></div>})}</div>}</div>
      </div>
    </section>

    {analise&&<Card className="p-3 sm:p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-gold"/><h2 className="font-heading text-base text-burgundy">Agenda de liberação</h2></div><p className="mt-1 text-[0.68rem] text-clay/50">A sugestão do sistema é sempre 90 dias após a assinatura dos termos.</p></div><span className={cn("rounded-full border px-2.5 py-1 text-[0.58rem] font-semibold",orcamentoCheio?"border-alert/20 bg-alert/10 text-alert":"border-success/20 bg-success/10 text-success")}>Valor já liberado esse mês {formatarMoeda(valorMes)}/{formatarMoeda(orcamento)}</span></div>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-rose/10 bg-[rgb(var(--surface-2))] p-1"><button onClick={()=>mudarMes(-1)} className="flex h-7 w-7 items-center justify-center rounded-full text-burgundy"><ChevronLeft className="h-4 w-4"/></button><span className="text-xs font-semibold text-burgundy">{nomeMes(mes)} {ano}</span><button onClick={()=>mudarMes(1)} className="flex h-7 w-7 items-center justify-center rounded-full text-burgundy"><ChevronRight className="h-4 w-4"/></button></div>
      <div className="mx-auto mt-3 max-w-2xl"><div className="mb-2 grid grid-cols-7 text-center text-[0.58rem] uppercase tracking-label text-rose">{DIAS.map((x,i)=><span key={i}>{x}</span>)}</div><div className="grid grid-cols-7 gap-1.5 sm:gap-2">{dias.map(day=>{const ehSugestao=analise.melhorData?.data===day.data;let cl="border-transparent bg-clay/5 text-clay/35";if(day.estado==="verde")cl="border-success/30 bg-success/10 text-success";if(day.estado==="amarelo")cl="border-gold/40 bg-gold/10 text-burgundy";if(day.estado==="vermelho")cl="border-burgundy bg-burgundy text-cream";if(day.estado==="passado")cl="border-transparent bg-clay/5 text-clay/20";return <button key={day.data} disabled={day.estado==="passado"||day.estado==="vermelho"} onClick={()=>{setDataSelecionada(day.data);if(day.estado==="amarelo")setModalAmarela(true);else if(day.estado==="verde"&&selecionado)setModalConfirmacao(true);}} className={cn("relative flex aspect-square items-center justify-center rounded-xl border text-xs font-semibold",cl,day.data===hoje&&"ring-2 ring-gold ring-offset-1",day.data===dataSelecionada&&"ring-2 ring-burgundy ring-offset-2",ehSugestao&&"ring-2 ring-gold ring-offset-2")}><span>{day.dia}</span>{ehSugestao&&<Star className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-gold p-0.5 text-white"/>}</button>})}</div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.56rem] text-clay/55"><span>🟢 disponível</span><span>🟡 acima do orçamento</span><span>🔴 ocupada</span><span>⚪ não liberada</span></div></div></Card>}

    {modalCirurgia&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"><Card className="w-full max-w-sm p-5"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 text-burgundy"/><div><h2 className="font-heading text-base text-burgundy">Hoje é a previsão de liberação</h2><p className="mt-1 text-xs text-clay/60">A cirurgia de <strong>{modalCirurgia.nome}</strong> foi realizada?</p><p className="mt-1 text-[0.62rem] text-clay/45">Previsão: {dataCurta(modalCirurgia.previsaoAtual)}</p></div></div><div className="mt-4 flex gap-2"><Button variant="secondary" size="sm" onClick={()=>setModalCirurgia(null)} className="flex-1">Ainda não</Button><Button size="sm" loading={salvando} onClick={()=>atualizarCiclo(modalCirurgia,"cirurgiaRealizada",true)} className="flex-1">Sim, realizada</Button></div></Card></div>}
    {modalConfirmacao&&dataSelecionada&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"><Card className="w-full max-w-sm p-5"><h2 className="font-heading text-base text-success">Confirmar previsão?</h2><p className="mt-2 text-xs text-clay/60">Data selecionada: <strong>{dataCurta(dataSelecionada)}</strong></p><p className="mt-2 rounded-xl bg-gold/10 p-3 text-[0.62rem] text-burgundy">A sugestão padrão é 90 dias após a assinatura dos termos. Use outra data somente se necessário.</p><div className="mt-4 flex gap-2"><Button variant="secondary" size="sm" onClick={()=>setModalConfirmacao(false)} className="flex-1">Cancelar</Button><Button size="sm" loading={salvando} onClick={()=>salvarPrevisao(dataSelecionada)} className="flex-1">Confirmar</Button></div></Card></div>}
    {modalAmarela&&dataSelecionada&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"><Card className="w-full max-w-sm p-5"><h2 className="font-heading text-base text-burgundy">Atenção ao orçamento</h2><p className="mt-2 text-xs text-clay/60">Esta data ultrapassa o orçamento mensal. Deseja confirmar mesmo assim?</p><div className="mt-4 flex gap-2"><Button variant="secondary" size="sm" onClick={()=>setModalAmarela(false)} className="flex-1">Cancelar</Button><Button size="sm" loading={salvando} onClick={()=>salvarPrevisao(dataSelecionada)} className="flex-1">Confirmar</Button></div></Card></div>}
    {carregando&&<p className="py-3 text-center text-[0.65rem] text-clay/40">Atualizando agenda…</p>}
  </div>;
}
