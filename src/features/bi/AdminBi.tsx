import { useEffect, useState } from 'react';
import { ArrowUpRight, BarChart3, Database, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { BI_AREAS, mesSaoPaulo, periodoBi, type BiArea, type BiMetric, type BiOverview } from './bi-contract';
import styles from './AdminBi.module.css';
function areaUrl():BiArea {const a=new URLSearchParams(window.location.search).get('area');return BI_AREAS.find(x=>x.id===a)?.id??'geral';}
export default function AdminBi(){
  const [area,setArea]=useState<BiArea>(areaUrl);
  const [periodo,setPeriodo]=useState(mesSaoPaulo);
  const [draft,setDraft]=useState(periodo);
  const [revision,setRevision]=useState(0);
  const [data,setData]=useState<BiOverview|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{const fn=()=>setArea(areaUrl());window.addEventListener('popstate',fn);return()=>window.removeEventListener('popstate',fn);},[]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setData(null);
    fetch('/api/admin/bi/overview?periodo='+encodeURIComponent(periodo),{cache:'no-store',signal:controller.signal})
      .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.erro||'Não foi possível consultar o BI.');return d as BiOverview;})
      .then(d=>{if(!controller.signal.aborted)setData(d);})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Falha ao consultar o BI.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[periodo,revision]);
  const current=BI_AREAS.find(x=>x.id===area)!;
  const number=(v:number|null)=>v===null?'Indisponível':v.toLocaleString('pt-BR');
  const metric=(m:BiMetric)=><article className={styles.metric} key={m.id}><span>{m.label}</span><strong>{number(m.value)}</strong><small>{m.error||m.scope}</small></article>;
  function navigate(id:BiArea){setArea(id);window.history.pushState({},'',`/admin/bi?area=${id}`);}
  return <div className={styles.page}>
    <header className={styles.header}><div><span className={styles.eyebrow}>SRA. LUCK / INTELIGÊNCIA DE NEGÓCIO</span><h1>Visão para decidir.<br/><em>Dados para confiar.</em></h1><p>Marketing, comercial e financeiro, com origem e contexto.</p></div><div className={styles.brand}><BarChart3 size={32}/><span>BI <b>Sra. Luck</b></span></div></header>
    <nav className={styles.tabs} aria-label="Áreas do BI">{BI_AREAS.map(a=><button key={a.id} type="button" aria-current={area===a.id?'page':undefined} onClick={()=>navigate(a.id)}>{a.label}</button>)}</nav>
    <section className={styles.toolbar}><div><h2>{current.label}</h2><p>{current.description}</p></div>{area==='geral'?<form onSubmit={e=>{e.preventDefault();if(periodoBi(draft))setPeriodo(draft);}}><label>Mês de cadastro<input aria-label="Mês de cadastro" type="month" required min="2000-01" max="2099-12" value={draft} onChange={e=>setDraft(e.target.value)}/></label><button disabled={!periodoBi(draft)||loading} type="submit">Aplicar</button><button type="button" aria-label="Atualizar dados" disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16}/></button></form>:<button type="button" disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16}/> Atualizar</button>}</section>
    <div className={styles.notice}><Info size={19}/><p><b>Base operacional do app.</b> A coleta exclusiva do BI via RD Station, Conta Azul e n8n ainda não foi implementada. Os números locais abaixo não representam o total da empresa nem uma sincronização externa.</p></div>
    {loading?<section className={styles.empty} role="status"><RefreshCw size={24}/><h3>Consultando a base do app…</h3></section>:error?<section className={styles.empty} role="alert"><h3>Não foi possível abrir os dados</h3><p>{error}</p><button onClick={()=>setRevision(v=>v+1)}>Tentar novamente</button></section>:data&&<>
      {area==='geral'&&<><div className={styles.metrics}>{data.metrics.map(metric)}</div><div className={styles.grid}><section className={styles.panel}><div className={styles.sectionTitle}><h3>Contratos no app</h3><span>Posição atual · não filtrada por mês</span></div><p className={styles.muted}>Distribuição por status cadastrado. Outras situações não estão incluídas.</p><div className={styles.bars}>{data.contracts.map(c=><div key={c.id}><div><span>{c.label}</span><b>{number(c.value)}</b></div>{c.value===null?<small>{c.error}</small>:<div className={styles.track}><div style={{width:`${c.value/Math.max(1,...data.contracts.map(x=>x.value??0))*100}%`}}/></div>}</div>)}</div></section><section className={styles.panel}><ShieldCheck size={23}/><h3>Cada resultado precisa de origem</h3><p>Pessoa, atendimento e negociação são medidas diferentes. SDR e vendedora também.</p><p>Fonte, campanha ou responsável ausente deve gerar pendência, nunca uma atribuição inventada.</p><button onClick={()=>navigate('qualidade')}>Ver qualidade dos dados <ArrowUpRight size={16}/></button></section></div></>}
      {area==='comercial'&&<div className={styles.metrics}>{data.metrics.filter(m=>m.id==='vendas_pendentes'||m.id==='sem_vinculo').map(metric)}</div>}
      {area==='qualidade'&&<div className={styles.metrics}>{data.metrics.filter(m=>m.id==='sem_vinculo').map(metric)}</div>}
      {area!=='geral'&&<section className={styles.panel}><div className={styles.sectionTitle}><h3>{area==='qualidade'?'Conferência do BI':'Indicadores da integração'}</h3><span>Aguardando implementação da coleta</span></div><div className={styles.indicators}>{current.indicators.map(i=><div key={i}><span>{i}</span><strong aria-label="Ainda não disponível">—</strong><small>Sem base BI homologada</small></div>)}</div><p className={styles.muted}>{area==='marketing'?'Custo e retorno por campanha também exigem uma fonte de investimento publicitário.':area==='financeiro'?'Nenhum valor do app será apresentado como recebido da Conta Azul. Recebidos, atrasados, parcelas e estornos precisam de conciliação própria.':area==='qualidade'?'A fila de qualidade do BI ainda não está conectada. A contagem local acima indica ausência de vínculo, não ausência comprovada de nome no CRM.':'Os indicadores serão liberados após a coleta completa e a validação dos campos de cada funil.'}</p></section>}
      <section className={styles.sources}><div><Database size={19}/><h3>Origem e atualização</h3></div><dl><div><dt>Sra. Luck</dt><dd>Consulta local · {new Date(data.consultedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</dd></div><div><dt>RD Station / Conta Azul</dt><dd>Coleta BI não implementada</dd></div><div><dt>Automações e agentes</dt><dd>Não ativados · configuração exclusiva no painel Dev</dd></div></dl></section>
      <footer className={styles.footer}><span>As contagens locais usam consultas exatas, sem amostragem de registros.</span><Link href="/admin/relatorios">Abrir relatórios operacionais <ArrowUpRight size={15}/></Link></footer>
    </>}
  </div>;
}
