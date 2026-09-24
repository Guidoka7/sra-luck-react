"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  FileText,
  Lightbulb,
  Scissors,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { formatarMoeda } from "@/lib/utils";
import RelatoriosCatalogo from "./RelatoriosCatalogo";
import styles from "./relatorios.module.css";

type StatusContrato = "todos" | "ativo" | "suspenso" | "negativado" | "cancelado";
interface DashboardData {
  periodo: string;
  opcoes: { responsaveis: string[]; procedimentos: string[] };
  kpis: {
    recebimentos: { valor: number; variacao: number | null };
    reativacoes: { valor: number; variacao: number | null };
    cancelamentos: { valor: number; variacao: number | null };
    liberacoes: { valor: number; variacao: number | null };
  };
  funil: Array<{ id: string; label: string; valor: number }>;
  meses: Array<{ mes: string; recebimentos: number; inadimplencia: number; cirurgiasConfirmadas: number; cirurgiasCanceladas: number }>;
  desempenho: Array<{ nome: string; total: number }>;
  insights: {
    taxaInadimplencia: number;
    melhorResponsavel: { nome: string; total: number } | null;
    recebimentosVariacao: number | null;
    reativacoes: number;
    cancelamentos: number;
  };
}
const MES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const STATUS_LABEL: Record<StatusContrato,string> = { todos:"Todos", ativo:"Ativos", suspenso:"Suspensos", negativado:"Negativados", cancelado:"Cancelados" };

function periodoAtual() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function labelPeriodo(p: string) {
  const [a,m] = p.split("-").map(Number);
  return (MES[m-1] ?? "") + "/" + a;
}
function opcoesPeriodo() {
  const d = new Date();
  return Array.from({length:12},(_,i)=>{
    const x=new Date(d.getFullYear(),d.getMonth()-i,1);
    const value=x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0");
    return {value,label:labelPeriodo(value)};
  });
}
function pct(v:number|null, invert=false) {
  if (v == null) return { text:"Sem comparação", tone:"neutral" as const };
  const positive=v>=0;
  const good=invert ? !positive : positive;
  return { text:(positive?"↑ ":"↓ ")+Math.abs(v).toLocaleString("pt-BR",{maximumFractionDigits:1})+"%", tone:good?"good" as const:"bad" as const };
}
function abreviar(v:number) {
  if (v>=1_000_000) return (v/1_000_000).toLocaleString("pt-BR",{maximumFractionDigits:1})+" mi";
  if (v>=1_000) return Math.round(v/1_000).toLocaleString("pt-BR")+" mil";
  return v.toLocaleString("pt-BR");
}

export default function RelatoriosPage() {
  const [catalogo,setCatalogo]=useState(false);
  const [dados,setDados]=useState<DashboardData|null>(null);
  const [carregando,setCarregando]=useState(true);
  const [erroCarga,setErroCarga]=useState<string|null>(null);
  const [periodo,setPeriodo]=useState(periodoAtual);
  const [responsavel,setResponsavel]=useState("todos");
  const [procedimento,setProcedimento]=useState("todos");
  const [status,setStatus]=useState<StatusContrato>("todos");

  useEffect(()=>{
    const controller=new AbortController();
    setCarregando(true);
    setErroCarga(null);
    const qs=new URLSearchParams({periodo,responsavel,procedimento,status});
    fetch("/api/admin/relatorios/dashboard?"+qs.toString(),{cache:"no-store",signal:controller.signal})
      .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d?.erro||"Falha ao carregar relatórios.");return d as DashboardData;})
      .then(setDados)
      .catch(e=>{if(e?.name!=="AbortError"){setDados(null);setErroCarga(e instanceof Error?e.message:"Falha ao carregar relatórios.");}})
      .finally(()=>{if(!controller.signal.aborted)setCarregando(false);});
    return ()=>controller.abort();
  },[periodo,responsavel,procedimento,status]);

  const maxFin=Math.max(1,...(dados?.meses??[]).flatMap(m=>[m.recebimentos,m.inadimplencia]));
  const maxCir=Math.max(1,...(dados?.meses??[]).flatMap(m=>[m.cirurgiasConfirmadas,m.cirurgiasCanceladas]));
  const maxResp=Math.max(1,...(dados?.desempenho??[]).map(d=>d.total));
  const maxFunil=Math.max(1,...(dados?.funil??[]).map(f=>f.valor));
  const totalFunil=dados?.funil?.[0]?.valor||1;
  const meses4=(dados?.meses??[]).slice(-4);

  const kpis=dados ? [
    {label:"Recebimentos do mês",value:formatarMoeda(dados.kpis.recebimentos.valor),icon:<CircleDollarSign size={20}/>,trend:pct(dados.kpis.recebimentos.variacao),note:"em relação ao mês anterior"},
    {label:"Reativações",value:dados.kpis.reativacoes.valor.toLocaleString("pt-BR"),icon:<Users size={20}/>,trend:pct(dados.kpis.reativacoes.variacao),note:"contratos reativados no período"},
    {label:"Cancelamentos",value:dados.kpis.cancelamentos.valor.toLocaleString("pt-BR"),icon:<XCircle size={20}/>,trend:pct(dados.kpis.cancelamentos.variacao,true),note:"alterações registradas no período"},
    {label:"Liberações concluídas",value:dados.kpis.liberacoes.valor.toLocaleString("pt-BR"),icon:<CheckCircle2 size={20}/>,trend:pct(dados.kpis.liberacoes.variacao),note:"liberações registradas no período"},
  ] : [];

  function exportarPlanilha(){
    if(!dados)return;
    const rows=[
      ["Indicador","Valor"],
      ["Recebimentos do mês",String(dados.kpis.recebimentos.valor)],
      ["Reativações",String(dados.kpis.reativacoes.valor)],
      ["Cancelamentos",String(dados.kpis.cancelamentos.valor)],
      ["Liberações",String(dados.kpis.liberacoes.valor)],
      [],
      ["Mês","Recebimentos","Inadimplência","Cirurgias confirmadas","Cirurgias canceladas"],
      ...dados.meses.map(m=>[m.mes,String(m.recebimentos),String(m.inadimplencia),String(m.cirurgiasConfirmadas),String(m.cirurgiasCanceladas)])
    ];
    const csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(";")).join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download="relatorios-sra-luck-"+periodo+".csv";a.click();URL.revokeObjectURL(url);
  }

  if(catalogo){
    return <div className="zip-admin"><button type="button" className={styles.backButton} onClick={()=>setCatalogo(false)}>← Voltar ao painel de relatórios</button><RelatoriosCatalogo/></div>;
  }

  return <div className={["zip-admin",styles.page].join(" ")}>
    <header className={styles.hero}>
      <div><div className={styles.eyebrow}>RELATÓRIOS</div><h1>Relatórios</h1><p>Acompanhe resultados e transforme dados em decisões.</p></div>
      <div className={styles.quote}>Disciplina hoje,<br/>mais histórias amanhã.<span/></div>
    </header>

    <section className={styles.filters}>
      <label><span>Período</span><div className={styles.selectBox}><CalendarDays size={17}/><select value={periodo} onChange={e=>setPeriodo(e.target.value)}>{opcoesPeriodo().map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select><ChevronDown size={14}/></div></label>
      <label><span>Responsável</span><div className={styles.selectBox}><UserRound size={17}/><select value={responsavel} onChange={e=>setResponsavel(e.target.value)}><option value="todos">Todos</option>{dados?.opcoes.responsaveis.map(r=><option key={r} value={r}>{r}</option>)}</select><ChevronDown size={14}/></div></label>
      <label><span>Procedimento</span><div className={styles.selectBox}><Scissors size={17}/><select value={procedimento} onChange={e=>setProcedimento(e.target.value)}><option value="todos">Todos</option>{dados?.opcoes.procedimentos.map(p=><option key={p} value={p}>{p}</option>)}</select><ChevronDown size={14}/></div></label>
      <label><span>Status</span><div className={styles.selectBox}><CircleDollarSign size={17}/><select value={status} onChange={e=>setStatus(e.target.value as StatusContrato)}>{(Object.keys(STATUS_LABEL) as StatusContrato[]).map(s=><option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select><ChevronDown size={14}/></div></label>
      <div className={styles.exports}><button type="button" className={styles.exportPrimary} onClick={()=>window.print()} title="Abre a janela de impressão, onde é possível salvar em PDF."><FileText size={16}/>Imprimir / PDF</button><button type="button" onClick={exportarPlanilha}><FileSpreadsheet size={16}/>Exportar CSV</button></div>
    </section>

    {carregando?<div className={styles.loading}>Consolidando dados reais do período…</div>:!dados?<div className={styles.loading} role="alert"><strong>Não foi possível carregar os relatórios.</strong><br/>{erroCarga||"Tente novamente em instantes."}</div>:<>
      <section className={styles.kpis}>{kpis.map(k=><article className={styles.kpi} key={k.label}><div className={styles.kpiTop}><span>{k.icon}</span>{k.label}</div><strong>{k.value}</strong><div className={styles.kpiFoot}><em data-tone={k.trend.tone}>{k.trend.text}</em><small>{k.note}</small></div></article>)}</section>

      <section className={styles.middleGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Funil de conversão operacional</h2><button type="button" onClick={()=>setCatalogo(true)}>Ver detalhes <ArrowRight size={13}/></button></div>
          <div className={styles.funnel}>
            <div className={styles.funnelSteps}>{dados.funil.map((f,i)=><div className={styles.funnelStep} key={f.id}><span className={styles.funnelIcon}>{[<Users key="u" size={18}/>,<FileText key="f" size={18}/>,<CalendarDays key="c" size={18}/>,<Scissors key="s" size={18}/>,<CheckCircle2 key="o" size={18}/>][i]}</span><div>{f.label}</div><strong>{f.valor.toLocaleString("pt-BR")}</strong>{i<dados.funil.length-1&&<ArrowRight size={14}/>}</div>)}</div>
            <div className={styles.funnelBar}>{dados.funil.map((f,i)=><span key={f.id} style={{flexGrow:f.valor>0?f.valor/maxFunil*10:0,flexBasis:f.valor>0?8:0,minWidth:f.valor>0?3:0}} data-tone={i}/>)}</div>
            <div className={styles.funnelPct}>{dados.funil.map(f=><span key={f.id}>{Math.round(f.valor/totalFunil*100)}%</span>)}</div>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Recebimentos x inadimplência</h2><span className={styles.monthPill}>{labelPeriodo(periodo)}</span></div>
          <div className={styles.chartLegend}><span><i className={styles.receivedDot}/>Recebimentos (R$)</span><span><i className={styles.overdueDot}/>Inadimplência (R$)</span></div>
          <div className={styles.dualChart}>{meses4.map(m=><div className={styles.monthBars} key={m.mes}><div className={styles.bars}><i className={styles.receivedBar} style={{height:(m.recebimentos>0?Math.max(3,m.recebimentos/maxFin*100):0)+"%"}}/><i className={styles.overdueBar} style={{height:(m.inadimplencia>0?Math.max(3,m.inadimplencia/maxFin*100):0)+"%"}}/></div><strong>{MES[Number(m.mes.slice(5,7))-1]}</strong><small>{abreviar(m.recebimentos)}</small></div>)}</div>
        </article>
      </section>

      <section className={styles.bottomGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Cirurgias por mês</h2><span className={styles.monthPill}>Últimos 6 meses</span></div>
          <div className={styles.chartLegend}><span><i className={styles.receivedDot}/>Com data</span><span><i className={styles.overdueDot}/>Canceladas</span></div>
          <div className={styles.surgeryChart}>{dados.meses.map(m=><div className={styles.surgeryMonth} key={m.mes}><div className={styles.bars}><i className={styles.receivedBar} style={{height:(m.cirurgiasConfirmadas>0?Math.max(3,m.cirurgiasConfirmadas/maxCir*100):0)+"%"}}/><i className={styles.overdueBar} style={{height:(m.cirurgiasCanceladas>0?Math.max(3,m.cirurgiasCanceladas/maxCir*100):0)+"%"}}/></div><span>{MES[Number(m.mes.slice(5,7))-1]}</span></div>)}</div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Desempenho por responsável</h2><span className={styles.monthPill}>Cirurgias no período</span></div>
          <div className={styles.performance}>{dados.desempenho.length===0?<div className={styles.empty}>Sem cirurgias com data neste recorte.</div>:dados.desempenho.map((r,i)=><div className={styles.performanceRow} key={r.nome}><span className={styles.avatar}>{r.nome.split(/\s+/).slice(0,2).map(p=>p[0]).join("").toUpperCase()}</span><strong>{r.nome}</strong><div><i style={{width:(r.total/maxResp*100)+"%"}}/></div><b>{r.total}</b></div>)}</div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}><h2><Lightbulb size={17}/>Insights do período</h2></div>
          <div className={styles.insights}>
            <div><span className={dados.insights.recebimentosVariacao!=null&&dados.insights.recebimentosVariacao<0?styles.insightRose:styles.insightGood}>{dados.insights.recebimentosVariacao==null?"•":dados.insights.recebimentosVariacao<0?"↓":"↑"}</span><p><strong>{dados.insights.recebimentosVariacao==null?"Primeiro período comparável":(dados.insights.recebimentosVariacao>=0?"Aumento de ":"Queda de ")+Math.abs(dados.insights.recebimentosVariacao).toLocaleString("pt-BR",{maximumFractionDigits:1})+"%"}</strong><small>nos recebimentos em relação ao mês anterior.</small></p></div>
            <div><span className={styles.insightRose}><Users size={14}/></span><p><strong>{dados.insights.reativacoes} reativações</strong><small>registradas por mudança real de status no período.</small></p></div>
            <div><span className={styles.insightRose}><CircleDollarSign size={14}/></span><p><strong>Inadimplência em {dados.insights.taxaInadimplencia.toLocaleString("pt-BR",{maximumFractionDigits:1})}%</strong><small>do valor das parcelas com vencimento no período.</small></p></div>
            <div><span className={styles.insightRose}>★</span><p><strong>{dados.insights.melhorResponsavel?dados.insights.melhorResponsavel.nome:"Sem destaque no período"}</strong><small>{dados.insights.melhorResponsavel?dados.insights.melhorResponsavel.total+" cirurgias com data no recorte.":"Não houve cirurgias suficientes para comparar."}</small></p></div>
          </div>
        </article>
      </section>
      <footer className={styles.footer}><span>♡</span>Cada paciente representa um sonho. Obrigada por fazer parte dessa jornada!<i/>Sra. Luck Cirurgias Programadas</footer>
    </>}
  </div>;
}
