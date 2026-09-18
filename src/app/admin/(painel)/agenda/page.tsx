"use client";

import {
  CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, Search, Stethoscope,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ClienteDetailDrawer } from "@/components/admin/clientes/ClienteDetailDrawer";
import { agendaApi } from "@/features/agenda/agendaApi";
import type {
  AgendaCalendarDay,
  AgendaClientRow,
  AgendaPrimaryTab,
  AgendaReleaseRow,
  AgendaSurgeriesPayload,
  AgendaSurgeryRow,
  AgendaTermsConfirmedRow,
  AgendaTermsPayload,
  AgendaTermsView,
} from "@/features/agenda/types";
import type { Cliente } from "@/types/database";
import styles from "./AgendaPage.module.css";

const WEEK = ["D","S","T","Q","Q","S","S"];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

function currentMonthIso() {
  return todayIso().slice(0, 7);
}

function shiftMonth(month: string, delta: number) {
  const parts = month.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1));
  return String(date.getUTCFullYear()) + "-" + String(date.getUTCMonth() + 1).padStart(2,"0");
}

function monthLabel(month: string) {
  const parts = month.split("-").map(Number);
  const text = new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"}).format(new Date(parts[0],parts[1]-1,1));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dateLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  const parts = iso.slice(0,10).split("-");
  return parts.length === 3 ? parts[2] + "/" + parts[1] + "/" + parts[0] : iso;
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(value || 0));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "SL";
}

function cpf(value: string | null) {
  const digits = String(value ?? "").replace(/\D/g,"");
  if (digits.length !== 11) return value || "CPF não informado";
  return digits.slice(0,3) + "." + digits.slice(3,6) + "." + digits.slice(6,9) + "-" + digits.slice(9);
}

function calendarCells(month: string, days: AgendaCalendarDay[]) {
  const parts = month.split("-").map(Number);
  const first = new Date(parts[0],parts[1]-1,1);
  const count = new Date(parts[0],parts[1],0).getDate();
  const map = new Map(days.map((day) => [day.date,day]));
  const cells: Array<{date:string;day:number;record:AgendaCalendarDay|null}|null> = [];
  for (let index=0; index<first.getDay(); index+=1) cells.push(null);
  for (let day=1; day<=count; day+=1) {
    const date = month + "-" + String(day).padStart(2,"0");
    cells.push({date,day,record:map.get(date) ?? null});
  }
  while(cells.length%7) cells.push(null);
  return cells;
}

function effectiveState(record: AgendaCalendarDay | null, date: string) {
  if (date < todayIso()) return "past";
  return record?.state ?? "neutral";
}

type DrawerContext = "default" | "terms-flow" | "finance-release" | "surgery-final";

export default function AgendaPage() {
  const [tab,setTab] = useState<AgendaPrimaryTab>("terms");
  const [termsView,setTermsView] = useState<AgendaTermsView>("eligible");
  const [month,setMonth] = useState(currentMonthIso());
  const [terms,setTerms] = useState<AgendaTermsPayload | null>(null);
  const [release,setRelease] = useState<AgendaReleaseRow[]>([]);
  const [surgeries,setSurgeries] = useState<AgendaSurgeriesPayload | null>(null);
  const [clients,setClients] = useState<Cliente[]>([]);
  const [selectedDate,setSelectedDate] = useState(todayIso());
  const [search,setSearch] = useState("");
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string | null>(null);
  const [drawer,setDrawer] = useState<{client:Cliente;context:DrawerContext;tab:"profile"|"finance"}|null>(null);
  const [notice,setNotice] = useState<string | null>(null);

  const load = useCallback(async (silent=false) => {
    if(!silent) setLoading(true);
    try {
      const [clientList,termsData,releaseData,surgeryData] = await Promise.all([
        agendaApi.clients(),
        agendaApi.terms(month),
        agendaApi.release(),
        agendaApi.surgeries(month),
      ]);
      setClients(clientList);
      setTerms(termsData);
      setRelease(releaseData.rows);
      setSurgeries(surgeryData);
      setError(null);
      const monthPrefix = selectedDate.slice(0,7);
      if(monthPrefix !== month) setSelectedDate(month + "-01");
    } catch(e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar a Agenda.");
    } finally {
      if(!silent) setLoading(false);
    }
  },[month]);

  useEffect(() => { void load(); },[load]);

  const openClient = useCallback((row: AgendaClientRow,context:DrawerContext,initialTab:"profile"|"finance"="finance") => {
    const client = clients.find((item) => item.id === row.clientId);
    if(!client) {
      setNotice("Não foi possível localizar o perfil completo desta cliente.");
      window.setTimeout(() => setNotice(null),2600);
      return;
    }
    setDrawer({client,context,tab:initialTab});
  },[clients]);

  const subtitle = tab === "finance"
    ? "Fila operacional entre a assinatura dos termos, presença, quitação e liberação da agenda de cirurgia."
    : tab === "surgeries"
      ? "Capacidade cirúrgica, confirmações finais e cartas de crédito comprometidas por mês."
      : "Solicitações, levantamento financeiro e assinatura dos termos cirúrgicos em um único espaço.";

  const currentCalendar = tab === "surgeries" ? surgeries?.calendar ?? [] : terms?.calendar ?? [];
  const cells = useMemo(() => calendarCells(month,currentCalendar),[month,currentCalendar]);
  const selectedRecord = currentCalendar.find((item) => item.date === selectedDate) ?? null;

  const selectedClients = useMemo(() => {
    if(tab === "surgeries") return (surgeries?.rows ?? []).filter((item) => item.date === selectedDate);
    return (terms?.confirmed ?? []).filter((item) => item.date === selectedDate);
  },[tab,surgeries?.rows,terms?.confirmed,selectedDate]);

  const tableRows = useMemo(() => {
    const query=search.trim().toLocaleLowerCase("pt-BR");
    const filter=<T extends AgendaClientRow>(rows:T[]) => rows.filter((row) =>
      !query || (row.name+" "+(row.cpf ?? "")).toLocaleLowerCase("pt-BR").includes(query)
    );
    if(tab==="finance") return filter(release);
    if(tab==="surgeries") return filter(surgeries?.rows ?? []);
    return termsView==="eligible" ? filter(terms?.eligible ?? []) : filter(terms?.confirmed ?? []);
  },[tab,termsView,terms?.eligible,terms?.confirmed,release,surgeries?.rows,search]);

  async function saveCapacity(action:"open"|"close"|"reopen",total:number) {
    if(!selectedDate || selectedDate<todayIso()) return;
    try {
      if(tab==="surgeries") await agendaApi.setSurgeryCapacity(selectedDate,{action,total});
      else await agendaApi.setTermsCapacity(selectedDate,{action,total});
      setNotice(action==="close" ? "Data fechada." : "Capacidade atualizada.");
      await load(true);
    } catch(e) {
      setNotice(e instanceof Error ? e.message : "Não foi possível atualizar a data.");
    } finally {
      window.setTimeout(() => setNotice(null),2600);
    }
  }

  return <main className={styles.page}>
    <section className={styles.pageHeader}>
      <h1 className={styles.pageTitle}>Agenda</h1>
      <div className={styles.pageSubtitle}>{subtitle}</div>
    </section>

    <section className={styles.agendaTabs}>
      <div className={cx(styles.segmented,styles.primaryTabs)} role="tablist" aria-label="Áreas da Agenda">
        <button className={tab==="terms"?styles.active:""} type="button" onClick={() => setTab("terms")}><CalendarDays size={15}/>Termos cirúrgicos</button>
        <button className={tab==="finance"?styles.active:""} type="button" onClick={() => setTab("finance")}><CircleDollarSign size={15}/>Liberação financeira</button>
        <button className={tab==="surgeries"?styles.active:""} type="button" onClick={() => setTab("surgeries")}><Stethoscope size={15}/>Cirurgias</button>
      </div>
      {tab==="terms" ? <div className={cx(styles.segmented,styles.secondary)} role="tablist" aria-label="Filtrar termos">
        <button className={termsView==="eligible"?styles.active:""} type="button" onClick={() => setTermsView("eligible")}>Levantamentos</button>
        <button className={termsView==="confirmed"?styles.active:""} type="button" onClick={() => setTermsView("confirmed")}>Termos confirmados</button>
      </div> : null}
    </section>

    {error ? <div className={styles.errorBox}><strong>Não foi possível carregar a Agenda.</strong><span>{error}</span><button type="button" onClick={() => void load()}>Tentar novamente</button></div> : null}

    {tab!=="finance" ? <section className={styles.agendaWorkspace}>
      <CalendarCard
        tab={tab}
        month={month}
        loading={loading}
        cells={cells}
        selectedDate={selectedDate}
        selectedRecord={selectedRecord}
        selectedClients={selectedClients as Array<AgendaTermsConfirmedRow|AgendaSurgeryRow>}
        onMonth={(delta) => { const next=shiftMonth(month,delta); setMonth(next); setSelectedDate(next+"-01"); }}
        onDate={setSelectedDate}
        onCapacity={saveCapacity}
        onClient={(row) => openClient(row,tab==="surgeries"?"surgery-final":"terms-flow")}
      />
      <ListCard
        tab={tab}
        termsView={termsView}
        rows={tableRows as AgendaClientRow[]}
        search={search}
        loading={loading}
        onSearch={setSearch}
        onOpen={(row) => openClient(row,tab==="surgeries"?"surgery-final":"terms-flow")}
      />
    </section> :
    <section className={styles.financeOnly}>
      <ListCard
        tab="finance"
        termsView={termsView}
        rows={tableRows as AgendaClientRow[]}
        search={search}
        loading={loading}
        onSearch={setSearch}
        onOpen={(row) => openClient(row,"finance-release")}
      />
    </section>}

    {tab==="surgeries" && surgeries ? <MonthlyChart data={surgeries}/> : null}

    <ClienteDetailDrawer
      cliente={drawer?.client ?? null}
      open={Boolean(drawer)}
      initialTab={drawer?.tab ?? "finance"}
      context={drawer?.context ?? "default"}
      financeMode="full"
      onClose={() => setDrawer(null)}
      onUpdated={(updated) => {
        if(updated) setClients((current) => current.map((item) => item.id===updated.id?updated:item));
        void load(true);
      }}
    />

    {notice ? <div className={styles.toast} role="status">{notice}</div> : null}
  </main>;
}

function CalendarCard({
  tab,month,loading,cells,selectedDate,selectedRecord,selectedClients,onMonth,onDate,onCapacity,onClient,
}:{
  tab:"terms"|"surgeries";
  month:string;
  loading:boolean;
  cells:Array<{date:string;day:number;record:AgendaCalendarDay|null}|null>;
  selectedDate:string;
  selectedRecord:AgendaCalendarDay|null;
  selectedClients:Array<AgendaTermsConfirmedRow|AgendaSurgeryRow>;
  onMonth:(delta:number)=>void;
  onDate:(date:string)=>void;
  onCapacity:(action:"open"|"close"|"reopen",total:number)=>Promise<void>;
  onClient:(row:AgendaClientRow)=>void;
}) {
  const [total,setTotal]=useState(1);
  useEffect(() => { setTotal(selectedRecord?.total || 1); },[selectedDate,selectedRecord?.total]);
  const state=effectiveState(selectedRecord,selectedDate);
  const canEdit=selectedDate>=todayIso();
  const title=tab==="surgeries"?"Calendário de cirurgias":"Calendário dos termos";

  return <div className={styles.calendarCompositeCard}>
    <div className={styles.calendarArea}>
      <div className={styles.calendarHead}>
        <div className={styles.calendarTitleRow}><div className={styles.calendarTitle}>{title}</div><div className={styles.calendarMonthLabel}>{monthLabel(month)}</div></div>
        <div className={styles.monthControl}><button type="button" aria-label="Mês anterior" onClick={() => onMonth(-1)}><ChevronLeft size={15}/></button><span>{monthLabel(month)}</span><button type="button" aria-label="Próximo mês" onClick={() => onMonth(1)}><ChevronRight size={15}/></button></div>
      </div>
      <div className={styles.legend}>
        <span className={styles.legendItem}><i className={cx(styles.legendDot,styles.available)}/>Disponível</span>
        <span className={styles.legendItem}><i className={cx(styles.legendDot,styles.pending)}/>Sem definição</span>
        <span className={styles.legendItem}><i className={cx(styles.legendDot,styles.unavailable)}/>Fechada / lotada</span>
      </div>
      <div className={styles.dowGrid}>{WEEK.map((item,index)=><div key={item+index} className={styles.dow}>{item}</div>)}</div>
      <div className={styles.calendarGrid}>
        {cells.map((cell,index) => {
          if(!cell) return <div key={"blank-"+index} className={cx(styles.dayCell,styles.blank)}/>;
          const dayState=effectiveState(cell.record,cell.date);
          const selected=cell.date===selectedDate;
          return <button
            key={cell.date}
            type="button"
            className={cx(styles.dayCell,styles.valid,styles["state_"+dayState],selected&&styles.selected)}
            disabled={dayState==="past"}
            onClick={() => onDate(cell.date)}
          >
            <span className={styles.dayNumber}>{cell.day}</span>
            <i className={styles.dayIndicator}/>
            {cell.record && cell.record.total>0 ? <span className={styles.capacityMini}>{cell.record.used}/{cell.record.total}</span> : null}
          </button>;
        })}
      </div>
      {loading ? <div className={styles.calendarLoading}>Atualizando...</div> : null}
    </div>
    <aside className={styles.selectedDayPanel}>
      <div className={styles.selectedTitle}>Dia selecionado</div>
      <div className={styles.selectedDate}>{dateLabel(selectedDate)}</div>
      <StatusPill state={state}/>
      <div className={styles.selectedMetrics}>
        <Metric label="Vagas ocupadas" value={String(selectedRecord?.used ?? 0)}/>
        <Metric label="Capacidade" value={selectedRecord?.total ? String(selectedRecord.total) : "Não definida"}/>
        <Metric label="Vagas restantes" value={selectedRecord?.total ? String(selectedRecord.remaining) : "—"}/>
      </div>
      <div className={styles.selectedPeople}>
        <span>{tab==="surgeries"?"Cirurgias do dia":"Termos do dia"}</span>
        {selectedClients.length ? selectedClients.map((row)=><button key={row.clientId} type="button" onClick={() => onClient(row)}><i>{initials(row.name)}</i><span>{row.name}<small>{"time" in row && row.time ? row.time : ""}</small></span></button>) : <div>Nenhuma cliente agendada neste dia.</div>}
      </div>
      {canEdit ? <div className={styles.capacityControl}>
        <label><span>Vagas liberadas</span><input type="number" min={0} max={99} value={total} onChange={(event)=>setTotal(Math.max(0,Number(event.target.value||0)))}/></label>
        <button className={styles.openDate} type="button" onClick={() => void onCapacity(selectedRecord?.manualClosed?"reopen":"open",total)}>{selectedRecord ? "Salvar vagas" : "Liberar data"}</button>
        {selectedRecord && state!=="closed" ? <button className={styles.closeDate} type="button" onClick={() => void onCapacity("close",Math.max(total,selectedRecord.used))}>Fechar data</button> : null}
        {selectedRecord && state==="closed" ? <button className={styles.reopenDate} type="button" onClick={() => void onCapacity("reopen",Math.max(total,selectedRecord.used,1))}>Reabrir data</button> : null}
      </div> : <div className={styles.pastNotice}>Data passada · somente consulta</div>}
    </aside>
  </div>;
}

function StatusPill({state}:{state:string}) {
  const label=state==="available"?"Disponível":state==="full"?"Lotada":state==="closed"?"Fechada":state==="past"?"Data passada":"Sem definição";
  const Icon=state==="available"?CheckCircle2:state==="full"||state==="closed"?XCircle:CalendarDays;
  return <div className={cx(styles.statusPill,styles["pill_"+state])}><Icon size={12}/><span>{label}</span></div>;
}

function Metric({label,value}:{label:string;value:string}) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>;
}

function ListCard({
  tab,termsView,rows,search,loading,onSearch,onOpen,
}:{
  tab:AgendaPrimaryTab;
  termsView:AgendaTermsView;
  rows:AgendaClientRow[];
  search:string;
  loading:boolean;
  onSearch:(value:string)=>void;
  onOpen:(row:AgendaClientRow)=>void;
}) {
  const title=tab==="finance"?"Liberação financeira":tab==="surgeries"?"Cirurgias":termsView==="eligible"?"Levantamentos":"Termos confirmados";
  const subtitle=tab==="finance"
    ?"Clientes com termos escolhidos que aguardam ou concluíram presença, quitação e liberação da agenda cirúrgica."
    : tab==="surgeries"
      ?"Último estágio: clientes que escolheram data e horário da cirurgia no app."
      : termsView==="eligible"
        ?"Clientes com pelo menos 70% das parcelas reais pagas e aguardando o fluxo financeiro."
        :"Clientes da Etapa 4 com data e horário dos termos efetivamente escolhidos no app.";

  return <div className={styles.agendaListCard}>
    <div className={styles.listHead}><div><div className={styles.listTitle}>{title}</div><div className={styles.listSub}>{subtitle}</div></div><div className={styles.countPill}>{rows.length} {rows.length===1?"cliente":"clientes"}</div></div>
    {tab==="finance" ? <div className={styles.financeReleaseSummary}><strong>Fila operacional</strong><span>Sem calendário. A cliente permanece aqui até escolher efetivamente a cirurgia no app.</span></div> : null}
    <label className={styles.searchWrap}><Search size={16}/><input className={styles.search} type="search" placeholder="Buscar por cliente..." value={search} onChange={(event)=>onSearch(event.target.value)}/></label>
    <div className={styles.tableWrap}>
      <TableHead tab={tab} termsView={termsView}/>
      {loading ? <div className={styles.empty}>Carregando Agenda...</div> : rows.length ? rows.map((row)=><AgendaRow key={row.clientId+"-"+("appointmentId" in row?String((row as any).appointmentId):row.stage)} tab={tab} termsView={termsView} row={row} onOpen={onOpen}/>) : <div className={styles.empty}>Nenhuma cliente nesta lista.</div>}
    </div>
  </div>;
}

function TableHead({tab,termsView}:{tab:AgendaPrimaryTab;termsView:AgendaTermsView}) {
  if(tab==="finance") return <div className={cx(styles.tableHead,styles.colsFinance)}><span>Cliente</span><span>Termos</span><span>Confirmações</span><span>Liberação</span></div>;
  if(tab==="surgeries") return <div className={cx(styles.tableHead,styles.colsSurgeries)}><span>Cliente</span><span>Carta de crédito</span><span>Data / horário</span><span>Status</span></div>;
  if(termsView==="confirmed") return <div className={cx(styles.tableHead,styles.colsTerms)}><span>Cliente</span><span>Data / horário</span><span>Parcelas pagas</span><span>Status</span></div>;
  return <div className={cx(styles.tableHead,styles.colsTerms)}><span>Cliente</span><span>Parcelas pagas</span><span>Status</span><span>Ação</span></div>;
}

function AgendaRow({tab,termsView,row,onOpen}:{tab:AgendaPrimaryTab;termsView:AgendaTermsView;row:AgendaClientRow;onOpen:(row:AgendaClientRow)=>void}) {
  function key(event:KeyboardEvent<HTMLDivElement>) {
    if(!["Enter"," "].includes(event.key)) return;
    event.preventDefault();
    onOpen(row);
  }
  if(tab==="finance") {
    const item=row as AgendaReleaseRow;
    return <div className={cx(styles.tableRow,styles.colsFinance)} role="button" tabIndex={0} onClick={()=>onOpen(row)} onKeyDown={key}>
      <ClientCell row={row}/>
      <div className={styles.cellStrong}>{dateLabel(item.termsDate)}<small>{item.termsTime}</small></div>
      <div className={styles.confirmationDots}><span className={item.forecastConfirmedAt?styles.ok:styles.wait}>P</span><span className={item.attendanceStatus==="compareceu"?styles.ok:styles.wait}>C</span><span className={item.settlementStatus==="paga"?styles.ok:styles.wait}>Q</span></div>
      <Status text={item.surgeryAgendaReleasedAt?"Agenda liberada":"Em liberação"} tone={item.surgeryAgendaReleasedAt?"green":"amber"}/>
    </div>;
  }
  if(tab==="surgeries") {
    const item=row as AgendaSurgeryRow;
    return <div className={cx(styles.tableRow,styles.colsSurgeries)} role="button" tabIndex={0} onClick={()=>onOpen(row)} onKeyDown={key}>
      <ClientCell row={row}/><div className={styles.cellStrong}>{money(row.creditLetter)}</div><div className={styles.cellStrong}>{dateLabel(item.date)}<small>{item.time}</small></div><Status text={item.status} tone="green"/>
    </div>;
  }
  if(termsView==="confirmed") {
    const item=row as AgendaTermsConfirmedRow;
    return <div className={cx(styles.tableRow,styles.colsTerms)} role="button" tabIndex={0} onClick={()=>onOpen(row)} onKeyDown={key}>
      <ClientCell row={row}/><div className={styles.cellStrong}>{dateLabel(item.date)}<small>{item.time||"—"}</small></div><div className={styles.cellStrong}>{row.paidInstallments}/{row.totalInstallments}<small>{Math.round(row.paidPercentage)}%</small></div><Status text="Termos confirmados" tone="green"/>
    </div>;
  }
  return <div className={cx(styles.tableRow,styles.colsTerms)} role="button" tabIndex={0} onClick={()=>onOpen(row)} onKeyDown={key}>
    <ClientCell row={row}/><div className={styles.cellStrong}>{row.paidInstallments}/{row.totalInstallments}<small>{Math.round(row.paidPercentage)}%</small></div><Status text={row.reviewConfirmedAt?"Levantamento concluído":"Aguardando levantamento"} tone={row.reviewConfirmedAt?"green":"amber"}/><span className={styles.rowActionText}>{row.reviewConfirmedAt?"Abrir Financeiro":"Realizar levantamento"} →</span>
  </div>;
}

function ClientCell({row}:{row:AgendaClientRow}) {
  return <div className={styles.clientCell}><i>{initials(row.name)}</i><span><strong>{row.name}</strong><small>{cpf(row.cpf)}</small></span></div>;
}

function Status({text,tone}:{text:string;tone:"green"|"amber"|"red"}) {
  return <span className={cx(styles.rowStatus,styles["status_"+tone])}><i/>{text}</span>;
}

function MonthlyChart({data}:{data:AgendaSurgeriesPayload}) {
  const max=Math.max(data.monthlyCap,...data.chart.map((item)=>item.value),1);
  const total=data.chart.reduce((sum,item)=>sum+item.value,0);
  return <section className={styles.monthlyReleaseCard} aria-label="Valores liberados por mês">
    <div className={styles.monthlyReleaseHead}><div><div className={styles.monthlyReleaseTitle}>Valores liberados por mês</div><div className={styles.monthlyReleaseSub}>Soma das cartas de crédito das clientes com cirurgia confirmada no último estágio.</div></div><div className={styles.monthlyReleaseSummary}><strong>{money(total)}</strong><span>Ano exibido · teto mensal {money(data.monthlyCap)}</span></div></div>
    <div className={styles.monthlyPlot}>{data.chart.map((item)=><div key={item.month} className={styles.monthBarWrap}><div className={styles.monthBarTrack}><div className={styles.monthBar} style={{height:Math.max(2,(item.value/max)*100)+"%"}}><span>{item.value?money(item.value):"R$ 0"}</span></div></div><div className={styles.monthBarLabel}>{new Intl.DateTimeFormat("pt-BR",{month:"short"}).format(new Date(Number(item.month.slice(0,4)),Number(item.month.slice(5,7))-1,1)).replace(".","")}</div></div>)}</div>
  </section>;
}
