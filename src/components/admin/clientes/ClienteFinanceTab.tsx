import { forwardRef, useEffect, useImperativeHandle, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { agendaApi } from "@/features/agenda/agendaApi";
import type { AgendaFlowPayload } from "@/features/agenda/types";
import { AgendaOperationalFinance, AgendaReviewPanel } from "./ClienteAgendaFinancePanels";
import { DrawerIcon } from "./ClienteDrawerIcons";
import {
  INSTITUTIONS, PAYMENT_METHODS, apiJson, calculateFinancialSummary, formatCurrency, formatDate,
  type DrawerFinancialModel, type DrawerInstallment, type FinancialHistoryItem,
} from "./clienteDrawerModel";
import { ClienteInstallments } from "./ClienteInstallments";
import styles from "./ClienteDetailDrawer.module.css";

export interface ClienteFinanceTabHandle { save: () => Promise<void>; }

interface Props {
  clienteId: string;
  clientName: string;
  financial: DrawerFinancialModel;
  installments: DrawerInstallment[];
  history: FinancialHistoryItem[];
  loading: boolean;
  error: string | null;
  compact?: boolean;
  focusInstallmentId?: string | null;
  onOpenProof?: (item: DrawerInstallment) => void;
  agendaContext?: "default" | "terms-flow" | "finance-release" | "surgery-final";
  onReload: () => Promise<void>;
  onUpdated: () => void;
  notify: (message: string, error?: boolean) => void;
}

type EditState = { plan: boolean; payment: boolean };

export const ClienteFinanceTab = forwardRef<ClienteFinanceTabHandle, Props>(function ClienteFinanceTab({
  clienteId, clientName, financial, installments, history, loading, error, compact = false, focusInstallmentId = null, onOpenProof, agendaContext = "default", onReload, onUpdated, notify,
}, ref) {
  const [editing, setEditing] = useState<EditState>({ plan: false, payment: false });
  const [draft, setDraft] = useState<DrawerFinancialModel>(financial);
  const [saving, setSaving] = useState(false);
  const [confirmAdjust, setConfirmAdjust] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [agendaFlow, setAgendaFlow] = useState<AgendaFlowPayload | null>(null);
  const [agendaLoading, setAgendaLoading] = useState(false);

  async function loadAgendaFlow() {
    setAgendaLoading(true);
    try {
      setAgendaFlow(await agendaApi.clientFlow(clienteId));
    } catch (e) {
      setAgendaFlow(null);
      if (agendaContext !== "default") {
        notify(e instanceof Error ? e.message : "Falha ao carregar o fluxo da Agenda.", true);
      }
    } finally {
      setAgendaLoading(false);
    }
  }

  useEffect(() => { setDraft(financial); }, [financial]);
  useEffect(() => { void loadAgendaFlow(); }, [clienteId, agendaContext]);

  const displayFinancial = useMemo(() => agendaContext === "default" ? financial : ({
    ...financial,
    totalPlan: installments.reduce((sum, item) => sum + Number(item.value || 0), 0),
    totalInstallments: installments.length || financial.totalInstallments,
  }), [agendaContext, financial, installments]);
  const summary = useMemo(() => calculateFinancialSummary(displayFinancial, installments), [displayFinancial, installments]);
  const installmentsInteractive = Boolean(
    agendaFlow && !["formacao_saldo", "levantamento"].includes(agendaFlow.client.stage),
  );
  const moneyPercent = displayFinancial.totalPlan > 0 ? Math.min(100, summary.totalPaid / displayFinancial.totalPlan * 100) : 0;
  const openPercent = displayFinancial.totalPlan > 0 ? Math.max(0, 100 - moneyPercent) : 0;

  async function persist() {
    if (!draft.totalInstallments || draft.totalInstallments < 1) return notify("Informe a quantidade de parcelas.", true);
    if (!Number.isFinite(draft.installmentValue) || draft.installmentValue <= 0) return notify("Informe o valor da parcela.", true);
    if (!Number.isFinite(draft.totalPlan) || draft.totalPlan < 0) return notify("Informe o valor total do plano.", true);
    if (!draft.planStart) return notify("Informe o início do plano.", true);
    setSaving(true);
    try {
      await apiJson(`/api/admin/clientes/${encodeURIComponent(clienteId)}/boletos`, {
        method: "POST",
        body: JSON.stringify({
          quantidadeParcelas: Math.max(1, Math.round(draft.totalInstallments)),
          valorTotalPlano: draft.totalPlan,
          valorParcela: draft.installmentValue,
          primeiroVencimento: draft.planStart,
          formaPagamento: draft.paymentMethod || null,
          instituicao: draft.institution || null,
          diaCobranca: draft.billingDay,
          statusPlano: draft.status,
          recalcularAbertas: true,
        }),
      });
      setConfirmAdjust(false);
      setEditing({ plan: false, payment: false });
      await onReload();
      onUpdated();
      notify("Alterações financeiras salvas.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Falha ao salvar alterações financeiras.", true);
    } finally { setSaving(false); }
  }

  async function save() {
    if (!editing.plan && !editing.payment) {
      notify("Alterações financeiras salvas.");
      return;
    }
    const changedCount = Math.round(draft.totalInstallments) !== Math.round(financial.totalInstallments);
    if (changedCount) { setConfirmAdjust(true); return; }
    await persist();
  }

  useImperativeHandle(ref, () => ({ save }), [editing, draft, financial, installments]);

  function startEdit(key: keyof EditState) { setDraft(financial); setEditing((s) => ({ ...s, [key]: true })); }
  function cancelEdit(key: keyof EditState) { setDraft(financial); setEditing((s) => ({ ...s, [key]: false })); }

  if (loading) return <div className={styles.stack}><div className={styles.loading}><div className={styles.skeleton}/><div className={styles.skeleton}/><div className={styles.skeleton}/></div><div className={styles.loading}><div className={styles.skeleton}/><div className={styles.skeleton}/></div></div>;
  if (error) return <div className={styles.errorBox}><strong>Não foi possível carregar o Financeiro.</strong><div>{error}</div><button className={styles.edit} type="button" onClick={() => void onReload()}>Tentar novamente</button></div>;

  if (agendaContext === "finance-release" || agendaContext === "surgery-final") {
    return <AgendaOperationalFinance
      mode={agendaContext}
      clientName={clientName}
      flow={agendaFlow}
      loading={agendaLoading}
      onRefresh={async () => { await loadAgendaFlow(); await onReload(); onUpdated(); }}
      notify={notify}
    />;
  }

  return <div className={`${styles.stack} ${styles.financeStack}`}>
    {agendaContext === "terms-flow" ? <AgendaReviewPanel flow={agendaFlow} loading={agendaLoading} onRefresh={async () => { await loadAgendaFlow(); await onReload(); onUpdated(); }} notify={notify}/> : null}
    {!compact ? <>
    <article className={`${styles.card} ${styles.financeCard}`}>
      <div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="finance"/>Resumo financeiro</h3></div>
      <div className={styles.cardBody}><div className={styles.summary}>
        <Kpi label="Valor total do plano" value={formatCurrency(displayFinancial.totalPlan)}/>
        <Kpi label="Total pago" value={formatCurrency(summary.totalPaid)} sub={`${Math.round(moneyPercent)}% do plano`} valueClass={styles.paid}/>
        <Kpi label="Saldo em aberto" value={formatCurrency(summary.openBalance)} sub={`${Math.round(openPercent)}% do plano`} valueClass={styles.openValue}/>
        <Kpi label="Parcelas pagas" value={`${summary.paidCount} de ${financial.totalInstallments}`} sub={`${Math.round(summary.installmentProgress)}% concluído`}/>
      </div></div>
    </article>

    <article className={`${styles.card} ${styles.financeCard}`}>
      <div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="wallet"/>Progresso por parcelas</h3></div>
      <div className={styles.cardBody}><div className={styles.progressLayout}>
        <div style={{display:"grid",placeItems:"center"}}>
          <div className={`${styles.ring} ${summary.eligible ? styles.eligible : ""}`} style={{ "--progress": Math.max(0, Math.min(100, summary.installmentProgress)).toFixed(2) } as CSSProperties}>
            <span className={styles.ringValue}>{Math.round(summary.installmentProgress)}%</span>
          </div>
        </div>
        <div className={styles.progressCopy}><strong>{summary.paidCount} de {financial.totalInstallments} parcelas pagas</strong><p><DrawerIcon name="info" style={{width:13,height:13,marginRight:5,verticalAlign:"-2px",color:"#AD686B"}}/>A cliente se torna elegível após {financial.eligibilityPercentage}% das parcelas pagas.</p></div>
        <div className={styles.eligibility}>
          {summary.eligible ? <><div className={styles.eligibilityMain}><DrawerIcon name="check"/>Percentual mínimo atingido</div><span className={styles.eligibleBadge}>✓ Elegível</span><p>A cliente já atingiu o percentual mínimo necessário.</p></> :
          <><div className={styles.eligibilityMain}><DrawerIcon name="alert"/>{summary.missing === 1 ? "Falta 1 parcela" : `Faltam ${summary.missing} parcelas`} para a liberação.</div><p>Com {financial.eligibilityPercentage}% das parcelas pagas, a cliente se torna elegível para os próximos passos.</p></>}
        </div>
      </div></div>
    </article>

    <div className={styles.financePair}>
      <article className={`${styles.card} ${styles.financeCard}`}>
        <CardHeader title="Plano financeiro" icon="document" editing={editing.plan} onEdit={() => startEdit("plan")} onCancel={() => cancelEdit("plan")}/>
        <div className={styles.cardBody}>{editing.plan ? <div className={styles.formGrid}>
          <div className={`${styles.field} ${styles.span2}`}><label>Procedimento</label><div className={styles.modalValue}>{draft.procedure || "—"}</div></div>
          <Field label="Valor total"><input className={styles.input} type="number" min="0" step="0.01" value={draft.totalPlan} onChange={(e) => setDraft((d) => ({...d,totalPlan:Number(e.target.value||0)}))}/></Field>
          <Field label="Nº de parcelas"><input className={styles.input} type="number" min="1" step="1" value={draft.totalInstallments} onChange={(e) => setDraft((d) => ({...d,totalInstallments:Number(e.target.value||0)}))}/></Field>
          <Field label="Valor da parcela"><input className={styles.input} type="number" min="0" step="0.01" value={draft.installmentValue} onChange={(e) => setDraft((d) => ({...d,installmentValue:Number(e.target.value||0)}))}/></Field>
          <Field label="Início do plano"><input className={styles.input} type="date" value={draft.planStart} onChange={(e) => setDraft((d) => ({...d,planStart:e.target.value}))}/></Field>
        </div> : <div className={styles.finInfo}>
          <Info wide label="Procedimento" value={financial.procedure}/>
          <Info label="Valor total" value={formatCurrency(displayFinancial.totalPlan)}/><Info label="Nº de parcelas" value={`${financial.totalInstallments} parcelas`}/>
          <Info label="Valor da parcela" value={formatCurrency(financial.installmentValue)}/><Info label="Início do plano" value={formatDate(financial.planStart)}/>
        </div>}</div>
      </article>

      <article className={`${styles.card} ${styles.financeCard}`}>
        <CardHeader title="Forma de pagamento" icon="card" editing={editing.payment} onEdit={() => startEdit("payment")} onCancel={() => cancelEdit("payment")}/>
        <div className={styles.cardBody}>{editing.payment ? <div className={styles.formGrid}>
          <Field label="Método"><select className={styles.input} value={draft.paymentMethod} onChange={(e) => setDraft((d)=>({...d,paymentMethod:e.target.value}))}><option value="">Selecione</option>{PAYMENT_METHODS.map((x)=><option key={x}>{x}</option>)}</select></Field>
          <Field label="Instituição"><select className={styles.input} value={draft.institution} onChange={(e) => setDraft((d)=>({...d,institution:e.target.value}))}><option value="">Selecione</option>{Array.from(new Set([...INSTITUTIONS, draft.institution].filter(Boolean))).map((x)=><option key={x}>{x}</option>)}</select></Field>
          <Field label="Dia de cobrança"><input className={styles.input} type="number" min="1" max="31" value={draft.billingDay ?? ""} onChange={(e)=>setDraft((d)=>({...d,billingDay:e.target.value?Number(e.target.value):null}))}/></Field>
          <Field label="Status"><select className={styles.input} value={draft.status} onChange={(e)=>setDraft((d)=>({...d,status:e.target.value==="Suspensa"?"Suspensa":"Ativa"}))}><option>Ativa</option><option>Suspensa</option></select></Field>
        </div> : <div className={styles.finInfo}>
          <Info label="Método" value={financial.paymentMethod}/><Info label="Instituição" value={financial.institution}/>
          <Info label="Dia de cobrança" value={financial.billingDay ? `Todo dia ${financial.billingDay}` : "—"}/>
          <div><span className={styles.label}>Status</span><div className={styles.value}><span className={`${styles.finBadge} ${financial.status==="Ativa"?styles.active:styles.suspended}`}>{financial.status}</span></div></div>
        </div>}</div>
      </article>
    </div>

    </> : null}

    <ClienteInstallments clienteId={clienteId} clientName={clientName} financial={displayFinancial} installments={installments} focusInstallmentId={focusInstallmentId} onOpenProof={onOpenProof} allowInteraction={installmentsInteractive} onReload={onReload} onUpdated={onUpdated} notify={notify}/>

    <article className={`${styles.card} ${styles.financeCard}`}>
      <div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="history"/>Histórico financeiro</h3><button className={styles.linkBtn} type="button" onClick={() => setHistoryExpanded((v)=>!v)}>{historyExpanded?"Mostrar menos":"Ver todos"}</button></div>
      <div className={styles.cardBody}>{history.length ? <div className={styles.history}>
        {(historyExpanded ? history : history.slice(0,4)).map((item)=><div key={item.id} className={`${styles.historyRow} ${item.type==="payment"?styles.payment:""}`}><div className={styles.historyDate}>{formatDate(item.date)}</div><div className={styles.historyEvent}>{item.description}</div><div className={styles.historyAuthor}>Por {item.author}</div></div>)}
      </div> : <div className={styles.empty}>Nenhum evento financeiro registrado.</div>}</div>
    </article>

    {confirmAdjust ? <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-label="Ajustar quantidade de parcelas"><div className={styles.modal}><div className={styles.modalHead}><h4>Ajustar quantidade de parcelas</h4><button className={styles.iconBtn} type="button" onClick={() => setConfirmAdjust(false)}><DrawerIcon name="close"/></button></div><div className={styles.modalBody}><div className={styles.warning}>A quantidade de parcelas foi alterada. Deseja ajustar o plano mantendo as parcelas pagas e em conferência intactas?</div><div className={styles.modalActions}><button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={() => setConfirmAdjust(false)}>Cancelar</button><button className={`${styles.modalBtn} ${styles.primary}`} type="button" disabled={saving} onClick={() => void persist()}>{saving?"Salvando...":"Ajustar plano"}</button></div></div></div></div> : null}
  </div>;
});

function CardHeader({title,icon,editing,onEdit,onCancel}:{title:string;icon:"document"|"card";editing:boolean;onEdit:()=>void;onCancel:()=>void}) {
  return <div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name={icon}/>{title}</h3>{editing?<button className={styles.cancel} type="button" onClick={onCancel}>Cancelar</button>:<button className={styles.edit} type="button" onClick={onEdit}><DrawerIcon name="edit"/> Editar</button>}</div>;
}
function Kpi({label,value,sub,valueClass}:{label:string;value:string;sub?:string;valueClass?:string}) { return <div className={styles.kpi}><span className={styles.kpiLabel}>{label}</span><strong className={`${styles.kpiValue} ${valueClass??""}`}>{value}</strong>{sub?<span className={styles.kpiSub}>{sub}</span>:null}</div>; }
function Info({label,value,wide}:{label:string;value:string;wide?:boolean}) { return <div className={wide?styles.span2:undefined}><span className={styles.label}>{label}</span><div className={styles.value}>{value||"—"}</div></div>; }
function Field({label,children}:{label:string;children:ReactNode}) { return <div className={styles.field}><label>{label}</label>{children}</div>; }
