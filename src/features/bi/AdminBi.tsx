import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, ArrowLeft, ArrowRight, BarChart3, CalendarDays, ChevronDown, ChevronRight, Clock3, Database, Filter, GitBranch, Info, LayoutDashboard, LogOut, Maximize2, Megaphone, Minimize2, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, ShieldCheck, Sun, TrendingUp, Users, X, type LucideIcon } from 'lucide-react';
import { useTheme } from '@/components/ui/ThemeProvider';
import { BI_AREAS, type BiArea, type BiOverview } from './bi-contract';
import styles from './AdminBi.module.css';

const AREA_ICONS: Record<BiArea, LucideIcon> = { geral: LayoutDashboard, origens: Megaphone, funis: GitBranch, agendamentos: CalendarDays, vendas: TrendingUp, leads: Users, qualidade: ShieldCheck };
const FILTERS = ['Data de entrada ou do evento', 'Período', 'Fonte', 'Campanha', 'Funil', 'Etapa', 'SDR', 'Vendedora'];

function areaUrl(): BiArea {
  const area = new URLSearchParams(window.location.search).get('area');
  return BI_AREAS.find(item => item.id === area)?.id ?? 'geral';
}
function Panel({ title, subtitle, action, children }: { title: string; subtitle: string; action?: { label: string; run: () => void }; children: ReactNode }) {
  return <section className={styles.panel}>
    <header className={styles.panelHeading}><div><h3>{title}</h3><p>{subtitle}</p></div>{action && <button type="button" onClick={action.run} aria-label={action.label} title={action.label}><ArrowRight size={17}/></button>}</header>
    {children}
  </section>;
}
function EmptyVisual({ icon: Icon = BarChart3, label = 'Aguardando dados validados', detail = 'Os indicadores dependem da coleta e da conferência do CRM.' }: { icon?: LucideIcon; label?: string; detail?: string }) {
  return <div className={styles.emptyVisual}><div className={styles.plotGrid} aria-hidden="true"/><div className={styles.emptyVisualContent}><span><Icon size={22}/></span><strong>{label}</strong><p>{detail}</p></div></div>;
}
function EmptyTable({ columns }: { columns: string[] }) {
  return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Tabela do relatório, com rolagem horizontal"><table><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody><tr><td colSpan={columns.length}><Database size={23}/><strong>Nenhum indicador validado ainda</strong><span>A coleta e a validação comercial precisam ser concluídas para preencher este relatório.</span></td></tr></tbody></table></div>;
}

export default function AdminBi() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [area, setArea] = useState<BiArea>(areaUrl);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<BiOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    const sync = () => setArea(areaUrl());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    fetch('/api/admin/bi/overview', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.erro || 'Não foi possível abrir o Power BI.');
        if (result.source !== 'rd_station' || result.scope !== 'company_commercial') throw new Error('A API do BI está em outra versão. Atualize a página após o deploy.');
        return result as BiOverview;
      })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Falha ao consultar o BI.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const current = BI_AREAS.find(item => item.id === area)!;
  const collectionLabels={not_configured:'Conexão pendente',configured:'Aguardando carga comercial',receiving:'Recebendo dados',paused:'Coleta pausada',received_unvalidated:'Carga recebida · em validação'};
  const collectionLabel=data?collectionLabels[data.collection.state]:'Verificando coleta';
  const syncedAt=data?.collection.lastSyncedAt?new Date(data.collection.lastSyncedAt).toLocaleString('pt-BR'):'Nenhuma carga concluída';
  const showPages = pagesOpen && !focusMode;
  const showFilters = filtersOpen && !focusMode;
  function navigate(id: BiArea) {
    setArea(id);
    window.history.pushState({}, '', `/admin/power-bi?area=${id}`);
  }
  async function logout() {
    setSigningOut(true);
    try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' }); }
    finally { router.replace('/admin/login'); }
  }
  return <div className={styles.workspace} data-theme={theme}>
    <a href="#bi-report" className={styles.skipLink}>Ir para o relatório</a>
    <header className={styles.appBar}>
      <div className={styles.product}><span className={styles.productIcon}><BarChart3 size={22}/></span><h1>Power BI</h1><span className={styles.appDivider}/><span className={styles.company}>Sra. Luck</span></div>
      <div className={styles.appActions}>
        <Link href="/admin" className={styles.backLink}><ArrowLeft size={15}/><span>Voltar ao Admin</span></Link>
        <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'} title={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button>
        <button type="button" onClick={logout} disabled={signingOut} aria-label="Sair da conta" title="Sair da conta"><LogOut size={17}/></button>
      </div>
    </header>
    <div className={styles.commandBar}>
      <div className={styles.breadcrumb}><span>Relatórios</span><ChevronRight size={13}/><b>Comercial</b><span className={styles.readOnly}>Leitura</span></div>
      <div className={styles.commands}>
        <button type="button" disabled={loading} onClick={() => setRevision(v => v + 1)} title="Consultar a disponibilidade dos dados; não inicia uma sincronização"><RefreshCw size={15} className={loading ? styles.spin : undefined}/><span>Verificar dados</span></button>
        <button type="button" aria-pressed={focusMode} onClick={() => setFocusMode(v => !v)}>{focusMode ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}<span>{focusMode ? 'Sair do foco' : 'Modo foco'}</span></button>
        <button type="button" aria-expanded={showFilters} aria-controls="bi-filters" onClick={() => { setFiltersOpen(!showFilters); setFocusMode(false); }}><Filter size={15}/><span>Filtros</span></button>
      </div>
    </div>
    <div className={`${styles.body} ${showPages ? styles.withPages : ''} ${showFilters ? styles.withFilters : ''}`}>
      {showPages && <aside className={styles.pages} id="bi-pages" aria-label="Páginas do relatório">
        <div className={styles.pagesTitle}><span>PÁGINAS DO RELATÓRIO</span><button type="button" aria-label="Recolher páginas" onClick={() => setPagesOpen(false)}><PanelLeftClose size={16}/></button></div>
        <nav>{BI_AREAS.map((item, index) => { const Icon = AREA_ICONS[item.id]; return <button type="button" key={item.id} aria-current={area === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon size={17}/><span>{item.label}</span><small>{String(index + 1).padStart(2, '0')}</small></button>; })}</nav>
        <div className={styles.dataset}><span className={styles.datasetIcon}><Database size={19}/></span><strong>RD Station CRM</strong><span>Base comercial da empresa</span><p><i/> {collectionLabel}</p></div>
        <div className={styles.pagesFooter}>SRA. LUCK <span>INTELIGÊNCIA COMERCIAL</span></div>
      </aside>}
      <div className={styles.report} id="bi-report" tabIndex={-1}>
        <section className={styles.reportHeader}>
          <div className={styles.reportTitle}>{!showPages && <button type="button" aria-label="Mostrar páginas do relatório" aria-controls="bi-pages" aria-expanded={false} onClick={() => { setPagesOpen(true); setFocusMode(false); }}><PanelLeftOpen size={19}/></button>}<div><span className={styles.eyebrow}>COMERCIAL / {String(BI_AREAS.indexOf(current) + 1).padStart(2, '0')}</span><h2>{current.label}</h2><p>{current.description}</p></div></div>
          <div className={styles.period}><CalendarDays size={16}/><div><small>PERÍODO DE ANÁLISE</small><span>Aguardando carga</span></div><ChevronDown size={14}/></div>
        </section>
        {loading ? <section className={styles.state} role="status"><RefreshCw className={styles.spin} size={25}/><h3>Verificando disponibilidade…</h3><p>Consultando a base comercial.</p></section> : error ? <section className={styles.state} role="alert"><Info size={25}/><h3>Não foi possível abrir o relatório</h3><p>{error}</p><button type="button" onClick={() => setRevision(v => v + 1)}>Tentar novamente</button></section> : data && <>
          <div className={styles.notice}><Info size={17}/><p><strong>{collectionLabel}.</strong> Os indicadores serão liberados após a conferência da cobertura, do mapeamento e das atribuições comerciais.</p><span>SEM INDICADORES VALIDADOS</span></div>
          <div className={styles.indicators}>{current.indicators.map((label, index) => <article key={label}><div><span>{label}</span>{index === 0 ? <Users size={17}/> : index === 1 ? <CalendarDays size={17}/> : index === 2 ? <Activity size={17}/> : <TrendingUp size={17}/>}</div><strong aria-label="Indicador indisponível">—</strong><small><span/> Dados indisponíveis</small></article>)}</div>
          {area === 'geral' ? <>
            <div className={styles.visualGrid}>
              <Panel title="Evolução comercial" subtitle="Entrada de leads e resultados ao longo do tempo" action={{ label: 'Abrir jornada dos leads', run: () => navigate('leads') }}>
                <div className={styles.legend}><span><i className={styles.leadColor}/> Novos leads</span><span><i className={styles.saleColor}/> Vendas ganhas</span></div><EmptyVisual icon={Activity} detail="A série temporal depende do histórico do CRM."/>
              </Panel>
              <Panel title="Conversão da jornada" subtitle="Da entrada do lead à venda" action={{ label: 'Abrir funis e conversão', run: () => navigate('funis') }}>
                <div className={styles.stageList}>{['Leads recebidos', 'Agendamentos', 'Reuniões realizadas', 'Vendas ganhas'].map((label, index) => <div key={label}><span className={styles.stageNumber}>{index + 1}</span><span>{label}</span><b aria-label="Indisponível">—</b></div>)}</div><div className={styles.panelNote}>Sem base para calcular conversão. Etapas reais virão do RD.</div>
              </Panel>
              <Panel title="Fontes e campanhas" subtitle="Origem dos leads e participação nas vendas" action={{ label: 'Abrir fontes e campanhas', run: () => navigate('origens') }}><EmptyVisual icon={Megaphone} label="Origens ainda não carregadas" detail="Fonte e campanha serão preservadas por lead."/></Panel>
              <Panel title="Desempenho por vendedora" subtitle="Vendas com atribuição validada no CRM" action={{ label: 'Abrir vendas e vendedoras', run: () => navigate('vendas') }}><EmptyTable columns={['Vendedora', 'Reuniões', 'Vendas', 'Valor vendido']}/></Panel>
            </div>
            <button type="button" className={styles.qualityLink} onClick={() => navigate('qualidade')}><ShieldCheck size={20}/><span><strong>Qualidade e atribuição dos dados</strong><small>Origens ausentes, responsáveis e possíveis duplicidades.</small></span><span className={styles.qualityStatus}>Aguardando análise</span><ChevronRight size={17}/></button>
          </> : <>
            {area !== 'leads' && area !== 'qualidade' && <div className={styles.secondaryVisuals}>
              <Panel title={area === 'origens' ? 'Resultado por origem' : area === 'funis' ? 'Movimentação entre etapas' : area === 'agendamentos' ? 'Confirmação e comparecimento' : 'Vendas ao longo do tempo'} subtitle={area === 'origens' ? 'Leads, agendamentos e vendas por fonte' : area === 'funis' ? 'Funis e etapas configurados no CRM' : area === 'agendamentos' ? 'Situação das reuniões por SDR' : 'Resultados pela data efetiva da venda'}><EmptyVisual/></Panel>
              <Panel title={area === 'vendas' ? 'Atribuição por vendedora' : area === 'agendamentos' ? 'Modalidade das reuniões' : area === 'funis' ? 'Conversão por coorte' : 'Conversão por campanha'} subtitle="Indicadores após a validação da coleta"><EmptyVisual icon={AREA_ICONS[area]}/></Panel>
            </div>}
            <Panel title={area === 'leads' ? 'Todos os leads e suas negociações' : area === 'qualidade' ? 'Registros que precisam de conferência' : 'Detalhamento do relatório'} subtitle="Registros e identificadores do RD Station CRM"><EmptyTable columns={current.columns}/></Panel>
            {area === 'leads' && <details className={styles.dictionary}><summary>O que acompanhar na jornada de cada lead <ChevronDown size={15}/></summary><p>Entrada, fonte, campanha, responsável, SDR, movimentações entre etapas, agendamentos, confirmação, modalidade, comparecimento, vendedora, vendas e motivos de perda.</p><p>Atendimentos da mesma pessoa ficam no histórico. Negociações e contratos distintos mantêm seus identificadores.</p></details>}
            {area === 'vendas' && <p className={styles.ruleNote}><ShieldCheck size={16}/> Vendedora e SDR são papéis distintos. Vendas sem atribuição ou com nomes conflitantes permanecerão visíveis para conferência.</p>}
            {area === 'funis' && <p className={styles.ruleNote}><Info size={16}/> Conversão por coorte de entrada e resultados por data do evento terão denominadores próprios e explícitos.</p>}
          </>}
          <details className={styles.dictionary}><summary><span><Database size={15}/> Cobertura e regras do relatório</span><ChevronDown size={15}/></summary><div className={styles.coverage}><div><span>Histórico do CRM</span><strong>Cobertura ainda não validada</strong></div><div><span>Novos leads e alterações</span><strong>{collectionLabel}</strong></div><div><span>Última sincronização</span><strong>{syncedAt}</strong></div></div><p>Vendedora: campos “Nome da vendedora” e “Vendedora que realizou a Reunião?” do CRM. Ausência ou conflito exige conferência; SDR e responsável do lead não substituem a vendedora.</p><p>Conexões e automações são administradas exclusivamente pelo painel Dev. O BI comercial funciona em paralelo ao sistema operacional Sra. Luck.</p></details>
        </>}
        <footer className={styles.reportFooter}><span>Página {BI_AREAS.indexOf(current) + 1} de {BI_AREAS.length}<i/>{current.label}</span><span><Clock3 size={13}/> {collectionLabel}</span></footer>
      </div>
      {showFilters && <aside className={styles.filters} id="bi-filters" aria-label="Filtros do relatório"><header><h2><Filter size={17}/> Filtros</h2><button type="button" aria-label="Fechar filtros" onClick={() => setFiltersOpen(false)}><X size={17}/></button></header><p>Refine o período e os recortes do relatório.</p><div className={styles.filterNotice}><Info size={15}/><span>Disponíveis após a primeira carga do CRM.</span></div><fieldset disabled><legend>Filtros deste relatório</legend>{FILTERS.map(label => <label key={label}>{label}<select><option>Aguardando dados</option></select></label>)}</fieldset><div className={styles.filterFoot}><Database size={15}/><span>Fonte de dados<br/><b>RD Station CRM</b></span></div></aside>}
    </div>
  </div>;
}
