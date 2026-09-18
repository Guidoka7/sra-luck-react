import { useEffect, useState } from "react";
import { agendaApi } from "@/features/agenda/agendaApi";
import type { AgendaFlowPayload, AgendaPlannerRow } from "@/features/agenda/types";
import { DrawerIcon } from "./ClienteDrawerIcons";
import { formatCurrency, formatDate } from "./clienteDrawerModel";
import styles from "./ClienteDetailDrawer.module.css";

const QUITATION_OPTIONS = [
  { code: "cartao", label: "Cartão de crédito" },
  { code: "pix", label: "PIX 100%" },
  { code: "boleto_100", label: "Boleto — mediante análise" },
  { code: "cheques", label: "Cheques — mediante análise" },
] as const;

export function AgendaReviewPanel({ flow, loading, onRefresh, notify }: {
  flow: AgendaFlowPayload | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [balance, setBalance] = useState("");
  const [forms, setForms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!flow) return;
    setBalance(String(flow.client.settlementBalance ?? flow.client.calculatedBalance ?? 0));
    setForms(flow.client.allowedMethods ?? []);
  }, [flow]);

  if (loading && !flow) return <article className={styles.card}><div className={styles.cardBody}><div className={styles.skeleton}/></div></article>;
  if (!flow) return null;

  const clientId = flow.client.clientId;
  const confirmed = Boolean(flow.client.reviewConfirmedAt);
  const toggle = (code: string) => setForms((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);

  async function confirm() {
    const value = Number(balance);
    if (!Number.isFinite(value) || value < 0) return notify("Informe um saldo restante válido.", true);
    if (!forms.length) return notify("Selecione ao menos uma forma de quitação.", true);
    setSaving(true);
    try {
      await agendaApi.confirmReview(clientId, { saldoFinal: value, formasQuitacao: forms });
      notify("Levantamento financeiro confirmado e publicado no app.");
      await onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível confirmar o levantamento.", true);
    } finally {
      setSaving(false);
    }
  }

  return <article className={styles.card}>
    <div className={styles.cardHead}>
      <h3 className={styles.cardTitle}><DrawerIcon name="finance"/>Levantamento financeiro</h3>
      <span className={styles.agendaStateBadge + " " + (confirmed ? styles.agendaStateDone : styles.agendaStateCurrent)}>{confirmed ? "Confirmado" : "Em análise"}</span>
    </div>
    <div className={styles.cardBody}>
      <div className={styles.agendaFinancialMetrics}>
        <div><span>Valor total do plano</span><strong>{formatCurrency(flow.client.planTotal)}</strong><small>Soma de todas as parcelas reais geradas.</small></div>
        <div><span>Saldo restante calculado</span><strong>{formatCurrency(flow.client.calculatedBalance)}</strong><small>Soma das parcelas ainda não pagas.</small></div>
      </div>
      <div className={styles.agendaReviewGrid}>
        <label className={styles.field}><span>Saldo restante para quitação</span><input className={styles.input} type="number" min="0" step="0.01" value={balance} disabled={confirmed} onChange={(event) => setBalance(event.target.value)}/></label>
        <div className={styles.agendaMethods}>
          <span className={styles.agendaFieldLabel}>Formas disponíveis no app</span>
          <div>{QUITATION_OPTIONS.map((option) => <button key={option.code} className={styles.agendaMethod + " " + (forms.includes(option.code) ? styles.agendaMethodActive : "")} type="button" disabled={confirmed} onClick={() => toggle(option.code)}><span className={styles.agendaCheck}>{forms.includes(option.code) ? "✓" : ""}</span>{option.label}</button>)}</div>
        </div>
      </div>
      {!confirmed ? <button className={styles.agendaPrimaryAction} type="button" disabled={saving} onClick={() => void confirm()}>{saving ? "Confirmando..." : "Confirmar levantamento e liberar Etapa 3"}</button> :
      <div className={styles.agendaSuccessNote}><DrawerIcon name="check"/> O saldo e as formas de quitação já estão disponíveis no app da cliente.</div>}
    </div>
  </article>;
}

export function AgendaOperationalFinance({ mode, clientName, flow, loading, onRefresh, notify }: {
  mode: "finance-release" | "surgery-final";
  clientName: string;
  flow: AgendaFlowPayload | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [forecast, setForecast] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!flow?.appointment) return;
    setForecast(flow.appointment.forecastDate ?? flow.appointment.forecastSuggestedDate ?? "");
  }, [flow]);

  if (loading && !flow) return <div className={styles.loading}><div className={styles.skeleton}/><div className={styles.skeleton}/><div className={styles.skeleton}/></div>;
  if (!flow) return <div className={styles.errorBox}>Não foi possível carregar o contexto da Agenda.</div>;
  if (mode === "surgery-final") return <SurgeryFinalPanel flow={flow} clientName={clientName}/>;

  const appointment = flow.appointment;
  if (!appointment) return <div className={styles.agendaReturnCard}><strong>Cliente retornou à Etapa 4.</strong><span>O atendimento anterior foi preservado no histórico e a vaga foi devolvida à Agenda de Termos.</span></div>;

  const appointmentTermsDate = appointment.termsDate;
  const appointmentSuggestedDate = appointment.forecastSuggestedDate;
  const forecastConfirmed = Boolean(appointment.forecastConfirmedAt);
  const attended = appointment.attendanceStatus === "compareceu";
  const paid = appointment.settlementStatus === "paga";
  const released = Boolean(appointment.surgeryAgendaReleasedAt);

  function selectMonth(row: AgendaPlannerRow) {
    const base = appointmentSuggestedDate ?? appointmentTermsDate ?? new Date().toISOString().slice(0,10);
    const day = Number(base.slice(8,10)) || 1;
    const parts = row.month.split("-").map(Number);
    const last = new Date(Date.UTC(parts[0],parts[1],0)).getUTCDate();
    let candidate = row.month + "-" + String(Math.min(day,last)).padStart(2,"0");
    const today = new Date().toISOString().slice(0,10);
    const minimum = [today, appointmentTermsDate ?? today].sort().pop() ?? today;
    if (candidate < minimum) candidate = minimum;
    setForecast(candidate);
  }

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await action();
      notify(success);
      await onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível concluir a operação.", true);
    } finally {
      setBusy(null);
    }
  }

  return <div className={styles.stack + " " + styles.financeStack}>
    <article className={styles.card + " " + styles.financeCard}>
      <div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="finance"/>Resumo financeiro</h3></div>
      <div className={styles.cardBody}><div className={styles.summary}>
        <Metric label="Valor total do plano" value={formatCurrency(flow.client.planTotal)} sub="Soma das parcelas reais"/>
        <Metric label="Saldo para quitação" value={formatCurrency(flow.client.settlementBalance)} sub="Definido no levantamento" className={styles.openValue}/>
        <Metric label="Carta de crédito" value={formatCurrency(flow.client.creditLetter)} sub="Base da capacidade cirúrgica"/>
        <Metric label="Forma escolhida" value={labelQuitation(flow.client.paymentChoice)} sub="Etapa 3 concluída"/>
      </div></div>
    </article>

    <article className={styles.card + " " + styles.financeCard}>
      <div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="clock"/>Planejamento inteligente da cirurgia</h3><span className={styles.agendaStateBadge + " " + (forecastConfirmed ? styles.agendaStateDone : styles.agendaStateCurrent)}>{forecastConfirmed ? "Previsão confirmada" : "Definir previsão"}</span></div>
      <div className={styles.cardBody}>
        <div className={styles.plannerIntro}><span>Referência automática · assinatura + 90 dias</span><strong>{formatDate(appointment.forecastSuggestedDate)}</strong><small>A referência é uma sugestão. A previsão pode ser antecipada ou postergada, respeitando a data dos termos e o presente.</small></div>
        <div className={styles.plannerRows}>{flow.planner.map((row) => <button key={row.month} type="button" className={styles.plannerRow + " " + plannerClass(row.classification)} onClick={() => selectMonth(row)}>
          <div className={styles.plannerMonth}><strong>{formatMonth(row.month)}</strong><span>{row.classification === "safe" ? "Seguro" : row.classification === "attention" ? "Atenção" : "Ultrapassa"}</span></div>
          <div className={styles.plannerNumbers}><span>Atual <b>{formatCurrency(row.current)}</b></span><span>+ carta <b>{formatCurrency(row.creditLetter)}</b></span><span>Projeção <b>{formatCurrency(row.projected)}</b></span><span>Folga <b>{formatCurrency(row.remaining)}</b></span></div>
          <div className={styles.plannerTrack}><span className={styles.plannerCommitted} style={{width: Math.min(100,(row.current/row.cap)*100) + "%"}}/><span className={styles.plannerImpact} style={{left: Math.min(100,(row.current/row.cap)*100) + "%",width: Math.max(0,Math.min(100,row.percent)-Math.min(100,(row.current/row.cap)*100)) + "%"}}/></div>
          <div className={styles.plannerPercent}>{Math.round(row.percent)}%</div>
        </button>)}</div>
        <div className={styles.forecastControl}>
          <label><span>Próxima data prevista</span><input className={styles.input} type="date" value={forecast} min={maxIso(appointment.termsDate,new Date().toISOString().slice(0,10))} onChange={(event) => setForecast(event.target.value)}/></label>
          <button className={styles.agendaPrimaryAction} type="button" disabled={!forecast || busy === "forecast"} onClick={() => void run("forecast",() => agendaApi.confirmForecast(flow.client.clientId,forecast),"Previsão de cirurgia confirmada.")}>{busy === "forecast" ? "Confirmando..." : forecastConfirmed ? "Atualizar previsão" : "Confirmar previsão"}</button>
        </div>
      </div>
    </article>

    <article className={styles.card + " " + styles.financeCard}>
      <div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="clock"/>Atendimento presencial · assinatura dos termos</h3></div>
      <div className={styles.cardBody}><div className={styles.termsAppointment}><div><span>Data</span><strong>{formatDate(appointment.termsDate)}</strong></div><div><span>Horário</span><strong>{appointment.termsTime || "—"}</strong></div></div></div>
    </article>

    <div className={styles.agendaDecisionGrid}>
      <article className={styles.card + " " + styles.financeCard}>
        <div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="usercard"/>Presença</h3></div>
        <div className={styles.cardBody}>
          <p className={styles.agendaDecisionCopy}>{attended ? "Presença confirmada para a assinatura dos termos." : "Confirme o comparecimento presencial. A ausência devolve automaticamente a cliente à Etapa 4."}</p>
          <button className={styles.agendaDecision + " " + styles.agendaDecisionPositive} type="button" disabled={!forecastConfirmed || attended || busy !== null} onClick={() => void run("attendance",() => agendaApi.attendance(flow.client.clientId,true),"Presença confirmada.")}><DrawerIcon name="check"/>{attended ? "Cliente compareceu" : "CLIENTE COMPARECEU"}</button>
          {!attended ? <button className={styles.agendaDecision + " " + styles.agendaDecisionNegative} type="button" disabled={busy !== null} onClick={() => void run("absence",() => agendaApi.attendance(flow.client.clientId,false),"Ausência registrada. Cliente retornou à Etapa 4.")}>REGISTRAR AUSÊNCIA</button> : null}
          {!forecastConfirmed ? <small className={styles.agendaGateNote}>Confirme a previsão antes da ação positiva.</small> : null}
        </div>
      </article>

      <article className={styles.card + " " + styles.financeCard}>
        <div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="wallet"/>Quitação do saldo</h3></div>
        <div className={styles.cardBody}>
          <div className={styles.settlementLine}><span>Saldo restante</span><strong>{formatCurrency(flow.client.settlementBalance)}</strong></div>
          <div className={styles.settlementLine}><span>Forma escolhida</span><strong>{labelQuitation(flow.client.paymentChoice)}</strong></div>
          <button className={styles.agendaDecision + " " + styles.agendaDecisionPositive} type="button" disabled={!forecastConfirmed || paid || busy !== null} onClick={() => void run("payment",() => agendaApi.settlement(flow.client.clientId,true),"Quitação integral confirmada.")}><DrawerIcon name="check"/>{paid ? "Pagamento recebido" : "PAGAMENTO RECEBIDO"}</button>
          {!paid ? <button className={styles.agendaDecision + " " + styles.agendaDecisionNegative} type="button" disabled={busy !== null} onClick={() => void run("not-paid",() => agendaApi.settlement(flow.client.clientId,false),"Pagamento não realizado. Cliente retornou à Etapa 4.")}>PAGAMENTO NÃO REALIZADO</button> : null}
          {!forecastConfirmed ? <small className={styles.agendaGateNote}>Confirme a previsão antes da ação positiva.</small> : null}
        </div>
      </article>
    </div>

    <article className={styles.card + " " + styles.releaseStateCard + " " + (released ? styles.releaseStateReleased : "")}>
      <div className={styles.releaseIcon}><DrawerIcon name={released ? "check" : "alert"}/></div>
      <div><span className={styles.journeyKicker}>Estado de liberação</span><strong>{released ? "AGENDA CIRÚRGICA LIBERADA NO APP" : "Agenda cirúrgica bloqueada"}</strong><p>{released ? "Previsão confirmada, presença confirmada e saldo quitado. A cliente já pode escolher data e horário da cirurgia no app." : "A liberação exige previsão confirmada + presença confirmada + saldo quitado."}</p></div>
    </article>
  </div>;
}

function SurgeryFinalPanel({ flow, clientName }: { flow: AgendaFlowPayload; clientName: string }) {
  const appointment = flow.appointment;
  return <div className={styles.stack + " " + styles.financeStack}>
    <article className={styles.card + " " + styles.surgeryHero}>
      <span className={styles.journeyKicker}>Último estágio</span>
      <h3>{clientName}</h3>
      <div className={styles.surgeryHeroDate}>{formatDate(appointment?.surgeryDate)} <span>·</span> {appointment?.surgeryTime || "—"}</div>
      <span className={styles.agendaStateBadge + " " + styles.agendaStateDone}>Cirurgia confirmada</span>
    </article>
    <article className={styles.card}><div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="finance"/>Resumo financeiro</h3></div><div className={styles.cardBody}><div className={styles.summary}>
      <Metric label="Valor total do plano" value={formatCurrency(flow.client.planTotal)}/>
      <Metric label="Carta de crédito" value={formatCurrency(flow.client.creditLetter)}/>
      <Metric label="Saldo quitado" value={formatCurrency(flow.client.settlementBalance)} sub="Quitação confirmada"/>
      <Metric label="Forma escolhida" value={labelQuitation(flow.client.paymentChoice)}/>
    </div></div></article>
    <article className={styles.card}><div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="history"/>Marcos concluídos</h3></div><div className={styles.cardBody}><div className={styles.milestoneList}>
      <Milestone label="Levantamento financeiro" value={flow.client.reviewConfirmedAt ? "Concluído" : "—"}/>
      <Milestone label="Forma de quitação" value={labelQuitation(flow.client.paymentChoice)}/>
      <Milestone label="Termos" value={appointment?.termsDate ? formatDate(appointment.termsDate) + " · " + (appointment.termsTime || "—") : "—"}/>
      <Milestone label="Presença" value={appointment?.attendanceStatus === "compareceu" ? "Confirmada" : "—"}/>
      <Milestone label="Quitação" value={appointment?.settlementStatus === "paga" ? "Confirmada" : "—"}/>
      <Milestone label="Previsão confirmada" value={formatDate(appointment?.forecastDate)}/>
      <Milestone label="Agenda cirúrgica" value={appointment?.surgeryAgendaReleasedAt ? "Liberada no app" : "—"}/>
    </div></div></article>
  </div>;
}

function Metric({label,value,sub,className}:{label:string;value:string;sub?:string;className?:string}) {
  return <div className={styles.kpi}><span className={styles.kpiLabel}>{label}</span><strong className={styles.kpiValue + " " + (className ?? "")}>{value}</strong>{sub ? <span className={styles.kpiSub}>{sub}</span> : null}</div>;
}
function Milestone({label,value}:{label:string;value:string}) {
  return <div className={styles.milestone}><span className={styles.milestoneCheck}>✓</span><div><span>{label}</span><strong>{value}</strong></div></div>;
}
function plannerClass(value: AgendaPlannerRow["classification"]) {
  return value === "safe" ? styles.planner_safe : value === "attention" ? styles.planner_attention : styles.planner_over;
}
function labelQuitation(value: string | null | undefined) {
  if (value === "cartao") return "Cartão de crédito";
  if (value === "pix") return "PIX 100%";
  if (value === "boleto_100") return "Boleto";
  if (value === "cheques") return "Cheques";
  return "—";
}
function formatMonth(value:string) {
  const parts=value.split("-").map(Number);
  if(parts.length!==2)return value;
  const date=new Date(Date.UTC(parts[0],parts[1]-1,1));
  const formatted=new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"}).format(date);
  return formatted.charAt(0).toUpperCase()+formatted.slice(1);
}
function maxIso(a:string|null|undefined,b:string){ return a && a>b ? a : b; }
