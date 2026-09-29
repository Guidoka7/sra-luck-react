import { useEffect, useState } from 'react';
import { BarChart3, Database, Info, RefreshCw, Search, ShieldCheck, ArrowRight } from 'lucide-react';
import { BI_AREAS, type BiArea, type BiOverview } from './bi-contract';
import styles from './AdminBi.module.css';

function areaUrl():BiArea {
  const area=new URLSearchParams(window.location.search).get('area');
  return BI_AREAS.find(item=>item.id===area)?.id??'geral';
}
export default function AdminBi(){
  const [area,setArea]=useState<BiArea>(areaUrl);
  const [revision,setRevision]=useState(0);
  const [data,setData]=useState<BiOverview|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    const sync=()=>setArea(areaUrl());
    window.addEventListener('popstate',sync);
    return()=>window.removeEventListener('popstate',sync);
  },[]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setData(null);
    fetch('/api/admin/bi/overview',{cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const result=await response.json();
        if(!response.ok)throw new Error(result.erro||'Não foi possível abrir o Power BI.');
        if(result.source!=='rd_station'||result.scope!=='company_commercial')throw new Error('A API do BI está em outra versão. Atualize a página após o deploy.');
        return result as BiOverview;
      })
      .then(result=>{if(!controller.signal.aborted)setData(result);})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Falha ao consultar o BI.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[revision]);
  const current=BI_AREAS.find(item=>item.id===area)!;
  function navigate(id:BiArea){setArea(id);window.history.pushState({},'',`/admin/power-bi?area=${id}`);}
  return <div className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>SRA. LUCK EMPRESA / COMERCIAL</span><h1>Power BI</h1><p>A origem de cada lead. A evolução de cada negociação. O resultado de cada vendedora.</p></div>
      <div className={styles.brand}><BarChart3 size={30}/><span>Comercial<b>Fonte: RD Station CRM</b></span></div>
    </header>
    <nav className={styles.tabs} aria-label="Análises comerciais">{BI_AREAS.map(item=><button key={item.id} type="button" aria-current={area===item.id?'page':undefined} onClick={()=>navigate(item.id)}>{item.label}</button>)}</nav>
    <section className={styles.toolbar}><div><h2>{current.label}</h2><p>{current.description}</p></div><button type="button" disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16}/> Verificar disponibilidade</button></section>
    {loading?<section className={styles.empty} role="status"><RefreshCw size={24}/><h3>Verificando a disponibilidade do BI…</h3></section>:error?<section className={styles.empty} role="alert"><h3>Não foi possível abrir o BI</h3><p>{error}</p><button onClick={()=>setRevision(v=>v+1)}>Tentar novamente</button></section>:data&&<>
      <div className={styles.notice}><Info size={19}/><p><b>Estrutura comercial pronta para receber o CRM.</b> A carga histórica e a atualização de novos leads ainda precisam ser implementadas. Os indicadores ficam indisponíveis até essa coleta ser validada.</p></div>
      <section className={styles.filterPanel} aria-label="Filtros aguardando a coleta do CRM">
        <div><Search size={16}/><span>Explorar o comercial</span></div>
        <fieldset disabled><legend>Filtros disponíveis após a carga inicial</legend>{['Período de entrada / evento','Fonte','Campanha','Funil e etapa','SDR','Vendedora'].map(label=><label key={label}>{label}<select aria-label={label}><option>Aguardando dados do RD</option></select></label>)}</fieldset>
      </section>
      <div className={styles.indicators}>{current.indicators.map(label=><article key={label}><span>{label}</span><strong aria-label="Indicador indisponível">—</strong><small>Aguardando carga do CRM</small></article>)}</div>
      {area==='geral'?<div className={styles.grid}>
        <section className={styles.panel}><h3>Da origem à venda</h3><p>Etapas de análise — os nomes e movimentos dos funis virão do RD.</p><ol className={styles.journey}>{['Entrada do lead e origem','Atendimento e responsável','Agendamento e confirmação','Reunião e comparecimento','Venda, perda ou negociação em aberto'].map((step,index)=><li key={step}><span>{String(index+1).padStart(2,'0')}</span><b>{step}</b><ArrowRight size={15}/></li>)}</ol><button onClick={()=>navigate('leads')}>Explorar a jornada dos leads <ArrowRight size={15}/></button></section>
        <section className={styles.panel}><ShieldCheck size={23}/><h3>Atribuição comercial sem confusão</h3><p><b>Vendedora:</b> identificada pelos campos “Nome da vendedora” e “Vendedora que realizou a Reunião?” do CRM.</p><p><b>SDR e responsável do lead:</b> vínculos próprios. Nunca substituirão automaticamente a vendedora.</p><p>Ausência ou conflito permanece visível como pendência. Uma venda sem atribuição não desaparece do BI.</p><button onClick={()=>navigate('qualidade')}>Ver estrutura de pendências <ArrowRight size={15}/></button></section>
      </div>:<section className={styles.panel}>
        <div className={styles.sectionTitle}><h3>{area==='leads'?'Todos os leads e suas negociações':current.label}</h3><span>Base exclusiva do RD Station</span></div>
        <div className={styles.tableWrap}><table><thead><tr>{current.columns.map(column=><th key={column} scope="col">{column}</th>)}</tr></thead><tbody><tr><td colSpan={current.columns.length}><Database size={25}/><strong>A primeira carga do CRM ainda não está disponível</strong><p>Esta tabela exibirá os registros reais, com paginação e acesso ao detalhe. Nenhum registro do app será usado como substituto.</p></td></tr></tbody></table></div>
        {area==='leads'&&<details className={styles.dictionary}><summary>O que acompanhar na jornada de cada lead</summary><p>Data de entrada, fonte, campanha, responsável, SDR, histórico de etapas, agendamentos, confirmação, modalidade, comparecimento, vendedora, vendas e motivos de perda.</p><p>Atendimentos repetidos ficam no histórico da mesma pessoa. Negociações e contratos diferentes mantêm seus próprios identificadores.</p></details>}
        {area==='vendas'&&<p className={styles.muted}>A mesma negociação não será contada duas vezes. Nomes divergentes nos campos de vendedora exigem conferência; nome de SDR não será usado como reserva.</p>}
        {area==='funis'&&<p className={styles.muted}>Conversão por coorte de entrada e resultados por data do evento serão apresentados separadamente, com denominador explícito.</p>}
      </section>}
      <section className={styles.sources}><div><Database size={19}/><h3>Cobertura da coleta</h3></div><dl><div><dt>Histórico do RD Station</dt><dd>Não carregado · completude ainda não comprovada</dd></div><div><dt>Novos leads e alterações</dt><dd>Atualização contínua ainda não ativada</dd></div><div><dt>Última sincronização do BI</dt><dd>Ainda não realizada</dd></div></dl></section>
      <footer className={styles.footer}><span>BI comercial da empresa · independente da importação de clientes do app.</span><span>Conexões e automações administradas pelo painel Dev.</span></footer>
    </>}
  </div>;
}
