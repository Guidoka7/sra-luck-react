import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { DrawerIcon } from "./ClienteDrawerIcons";
import {
  INSTALLMENT_LABELS, apiJson, formatCurrency, formatDate, paymentMethodCode,
  type DrawerFinancialModel, type DrawerInstallment,
} from "./clienteDrawerModel";
import styles from "./ClienteDetailDrawer.module.css";

interface Props {
  clienteId: string;
  clientName: string;
  financial: DrawerFinancialModel;
  installments: DrawerInstallment[];
  focusInstallmentId?: string | null;
  onOpenProof?: (item: DrawerInstallment) => void;
  allowInteraction?: boolean;
  onReload: () => Promise<void>;
  onUpdated: () => void;
  notify: (message: string, error?: boolean) => void;
}

type Modal =
  | { type: "details" | "edit" | "delete" | "payment" | "receipt"; item: DrawerInstallment }
  | { type: "contract" }
  | { type: "reject" | "confirm"; item: DrawerInstallment };

export function ClienteInstallments({ clienteId, clientName, financial, installments, focusInstallmentId = null, onOpenProof, allowInteraction = true, onReload, onUpdated, notify }: Props) {
  const [menu, setMenu] = useState<{ item: DrawerInstallment; left: number; top: number } | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiptTarget, setReceiptTarget] = useState<DrawerInstallment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    if (!menu && !modal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (modal) setModal(null); else setMenu(null);
    };
    const onPointer = (event: PointerEvent) => {
      if (menu && !(event.target as HTMLElement).closest('[data-client-installment-menu]')) setMenu(null);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onPointer); };
  }, [menu, modal]);

  useEffect(() => {
    if (!focusInstallmentId) return;
    const row = rowRefs.current[focusInstallmentId];
    if (!row) return;
    const timer = window.setTimeout(() => row.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
    return () => window.clearTimeout(timer);
  }, [focusInstallmentId, installments]);

  function openMenu(event: MouseEvent<HTMLButtonElement>, item: DrawerInstallment) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 172;
    const drawerLeft = Math.max(0, window.innerWidth - Math.min(620, window.innerWidth));
    const left = Math.max(drawerLeft + 8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const estimatedHeight = item.status === "review" ? 250 : 205;
    const top = rect.bottom + 4 + estimatedHeight > window.innerHeight ? Math.max(8, rect.top - estimatedHeight - 4) : rect.bottom + 4;
    setMenu({ item, left, top });
  }

  function runMenu(action: string, item: DrawerInstallment) {
    setMenu(null);
    if (action === "details") setModal({ type: "details", item });
    if (action === "edit") setModal({ type: "edit", item });
    if (action === "delete") {
      if (item.status === "paid" || item.status === "review") notify("Parcelas pagas ou em conferência não podem ser excluídas.", true);
      else setModal({ type: "delete", item });
    }
    if (action === "payment") setModal({ type: "payment", item });
    if (action === "attach") chooseReceipt(item);
    if (action === "receipt") setModal({ type: "receipt", item });
    if (action === "confirm") setModal({ type: "confirm", item });
    if (action === "reject") setModal({ type: "reject", item });
  }

  function chooseReceipt(item: DrawerInstallment) {
    setReceiptTarget(item);
    requestAnimationFrame(() => fileRef.current?.click());
  }

  async function uploadReceipt(item: DrawerInstallment, file: File) {
    const form = new FormData();
    form.append("arquivo", file);
    await apiJson(`/api/admin/financeiro/recebiveis/${encodeURIComponent(item.id)}/comprovante`, { method: "POST", body: form });
  }

  async function onReceiptFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const item = receiptTarget;
    event.target.value = "";
    setReceiptTarget(null);
    if (!file || !item) return;
    setBusy(true);
    try {
      await uploadReceipt(item, file);
      await onReload();
      onUpdated();
      notify("Comprovante anexado.");
    } catch (e) { notify(message(e), true); } finally { setBusy(false); }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, item: DrawerInstallment) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const dueDate = String(data.get("dueDate") || "");
    const value = Number(data.get("value"));
    const desiredStatus = String(data.get("status") || item.status);
    if (!dueDate || !Number.isFinite(value) || value <= 0) return notify("Preencha vencimento e valor corretamente.", true);
    if (item.status === "paid" || item.status === "review") return notify("Parcelas pagas ou em conferência preservam o histórico. Use as ações financeiras específicas.", true);
    if (desiredStatus === "paid") return notify('Use "Registrar pagamento" para liquidar a parcela com trilha financeira.', true);
    if (desiredStatus === "review" || desiredStatus === "rejected") return notify("Esse status é controlado pela validação real de comprovantes.", true);

    setBusy(true);
    try {
      await apiJson(`/api/admin/financeiro/recebiveis/${encodeURIComponent(item.id)}`, {
        method: "PATCH", body: JSON.stringify({ acao: "editar", valor: value, dataVencimento: dueDate }),
      });
      if (desiredStatus === "suspended" && item.status !== "suspended") {
        await apiJson(`/api/admin/financeiro/recebiveis/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ acao: "suspender" }) });
      } else if (desiredStatus !== "suspended" && item.status === "suspended") {
        await apiJson(`/api/admin/financeiro/recebiveis/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ acao: "reabrir" }) });
      }
      setModal(null);
      await onReload(); onUpdated(); notify("Parcela atualizada com sucesso.");
    } catch (e) { notify(message(e), true); } finally { setBusy(false); }
  }

  async function deleteInstallment(item: DrawerInstallment) {
    setBusy(true);
    try {
      await apiJson(`/api/admin/financeiro/recebiveis/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ acao: "excluir" }) });
      setModal(null); await onReload(); onUpdated(); notify("Parcela excluída com sucesso.");
    } catch (e) { notify(message(e), true); } finally { setBusy(false); }
  }

  async function registerPayment(event: FormEvent<HTMLFormElement>, item: DrawerInstallment) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const paymentDate = String(data.get("paymentDate") || "");
    if (!paymentDate) return notify("Informe a data do pagamento.", true);
    const file = data.get("receipt");
    setBusy(true);
    try {
      if (file instanceof File && file.size > 0) await uploadReceipt(item, file);
      await apiJson(`/api/admin/financeiro/recebiveis/${encodeURIComponent(item.id)}/baixa`, {
        method: "POST",
        body: JSON.stringify({
          dataPagamento: paymentDate,
          juros: 0, multa: 0, desconto: 0,
          formaPagamento: paymentMethodCode(String(data.get("method") || "")),
          instituicaoConta: String(data.get("institution") || ""),
          observacao: String(data.get("note") || ""),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setModal(null); await onReload(); onUpdated(); notify("Pagamento registrado com sucesso.");
    } catch (e) { notify(message(e), true); } finally { setBusy(false); }
  }

  async function validateReceipt(item: DrawerInstallment, action: "confirmar" | "rejeitar", observation = "") {
    setBusy(true);
    try {
      await apiJson(`/api/admin/financeiro/validacoes/${encodeURIComponent(item.id)}/${action}`, {
        method: "POST", body: JSON.stringify({ observacao: observation, idempotencyKey: crypto.randomUUID() }),
      });
      setModal(null); await onReload(); onUpdated(); notify(action === "confirmar" ? "Comprovante confirmado." : "Comprovante rejeitado.");
    } catch (e) { notify(message(e), true); } finally { setBusy(false); }
  }

  async function viewReceipt(item: DrawerInstallment) {
    setBusy(true);
    try {
      const data = await apiJson<{ url: string }>(`/api/admin/financeiro/recebiveis/${encodeURIComponent(item.id)}/comprovante`);
      window.open(data.url, "_blank", "noopener,noreferrer");
      setModal(null);
    } catch (e) { notify(message(e), true); } finally { setBusy(false); }
  }

  return <>
    <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" hidden onChange={(e) => void onReceiptFile(e)}/>
    <article className={`${styles.card} ${styles.financeCard}`}>
      <div className={styles.cardHead}><h3 className={styles.cardTitle}><DrawerIcon name="document"/>Parcelas</h3><button className={styles.linkBtn} type="button" onClick={() => setModal({type:"contract"})}><DrawerIcon name="document"/> Ver contrato</button></div>
      <div className={styles.cardBody} style={{paddingTop:3}}>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Pagamento</th><th>Comprovante</th><th>Ações</th></tr></thead>
          <tbody>{installments.length ? installments.map((item)=><tr
            key={item.id}
            ref={(node) => { rowRefs.current[item.id] = node; }}
            className={`${focusInstallmentId === item.id ? styles.installmentFocused : ""} ${allowInteraction ? styles.installmentInteractive : ""}`}
            tabIndex={allowInteraction ? 0 : undefined}
            aria-label={allowInteraction ? `Abrir detalhes da parcela ${item.number}` : undefined}
            onClick={(event) => {
              if (!allowInteraction) return;
              if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
              if (item.status === "review" && onOpenProof) onOpenProof(item);
              else setModal({ type: "details", item });
            }}
            onKeyDown={(event) => {
              if (!allowInteraction || !["Enter", " "].includes(event.key)) return;
              event.preventDefault();
              if (item.status === "review" && onOpenProof) onOpenProof(item);
              else setModal({ type: "details", item });
            }}
          >
            <td>{item.number}/{financial.totalInstallments}</td><td>{formatDate(item.dueDate)}</td><td>{formatCurrency(item.value)}</td>
            <td><span className={`${styles.pill} ${pillClass(item.status)}`}>{INSTALLMENT_LABELS[item.status]}</span></td><td>{formatDate(item.paymentDate)}</td>
            <td>{item.receipt ? <button className={styles.rowBtn} type="button" aria-label={`Ver comprovante da parcela ${item.number}`} onClick={(event) => { event.stopPropagation(); setModal({type:"receipt",item}); }}><DrawerIcon name="document"/></button> : <button className={styles.rowBtn} type="button" disabled aria-label="Sem comprovante"><DrawerIcon name="document"/></button>}</td>
            <td>{allowInteraction ? <button className={styles.rowBtn} data-client-installment-menu type="button" aria-haspopup="menu" aria-label={`Ações da parcela ${item.number}`} onClick={(e)=>openMenu(e,item)}><DrawerIcon name="dots"/></button> : <span className={styles.readOnlyDash}>—</span>}</td>
          </tr>) : <tr><td colSpan={7}><div className={styles.empty}>Nenhuma parcela cadastrada.</div></td></tr>}</tbody>
        </table></div>
      </div>
    </article>

    {menu ? <div className={styles.menu} data-client-installment-menu role="menu" style={{left:menu.left,top:menu.top}}>
      <button type="button" onClick={()=>runMenu("details",menu.item)}>Ver detalhes</button>
      <button type="button" onClick={()=>runMenu("edit",menu.item)}>Editar parcela</button>
      {menu.item.status === "review" ? <>
        {menu.item.receipt ? <button type="button" onClick={()=>runMenu("receipt",menu.item)}>Ver comprovante</button> : null}
        <button type="button" onClick={()=>runMenu("confirm",menu.item)}>Confirmar comprovante</button>
        <button type="button" onClick={()=>runMenu("reject",menu.item)}>Rejeitar comprovante</button>
      </> : menu.item.status === "paid" ? menu.item.receipt ? <button type="button" onClick={()=>runMenu("receipt",menu.item)}>Ver comprovante</button> : null : <>
        <button type="button" onClick={()=>runMenu("payment",menu.item)}>Registrar pagamento</button>
        {menu.item.receipt ? <button type="button" onClick={()=>runMenu("receipt",menu.item)}>Ver comprovante</button> : <button type="button" onClick={()=>runMenu("attach",menu.item)}>Anexar comprovante</button>}
      </>}
      <div className={styles.separator}/><button className={styles.danger} type="button" onClick={()=>runMenu("delete",menu.item)}>Excluir parcela</button>
    </div> : null}

    {modal ? <ModalShell title={modalTitle(modal)} onClose={() => !busy && setModal(null)}>
      {modal.type === "details" ? <Details item={modal.item} total={financial.totalInstallments}/> : null}
      {modal.type === "edit" ? <form onSubmit={(e)=>void saveEdit(e,modal.item)}><div className={styles.modalGrid}>
        <Box label="Parcela" value={`${modal.item.number} de ${financial.totalInstallments}`}/>
        <Field label="Vencimento"><input className={styles.input} name="dueDate" type="date" defaultValue={modal.item.dueDate}/></Field>
        <Field label="Valor"><input className={styles.input} name="value" type="number" min="0.01" step="0.01" defaultValue={modal.item.value}/></Field>
        <Field label="Status"><select className={styles.input} name="status" defaultValue={modal.item.status}>{Object.entries(INSTALLMENT_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
        <Field label="Data do pagamento"><input className={styles.input} type="date" value={modal.item.paymentDate} disabled/></Field>
        <div className={`${styles.modalValue} ${styles.span2}`}><b>Comprovante</b>{modal.item.receipt ? "Disponível — use a ação Ver comprovante." : "Não anexado — use a ação Anexar comprovante."}</div>
      </div><Actions busy={busy} submitLabel="Salvar parcela" onCancel={()=>setModal(null)}/></form> : null}
      {modal.type === "delete" ? <><div className={styles.warning}><strong>Esta ação remove a parcela {modal.item.number}/{financial.totalInstallments}.</strong><br/>O número de parcelas e o valor total do plano serão recalculados com base nas parcelas restantes.</div><div className={styles.modalGrid} style={{marginTop:10}}><Box label="Vencimento" value={formatDate(modal.item.dueDate)}/><Box label="Valor" value={formatCurrency(modal.item.value)}/><Box label="Status" value={INSTALLMENT_LABELS[modal.item.status]}/><Box label="Pagamento" value={formatDate(modal.item.paymentDate)}/></div><div className={styles.modalActions}><button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={()=>setModal(null)}>Cancelar</button><button className={`${styles.modalBtn} ${styles.deleteBtn}`} type="button" disabled={busy} onClick={()=>void deleteInstallment(modal.item)}>{busy?"Excluindo...":"Excluir parcela"}</button></div></> : null}
      {modal.type === "payment" ? <form onSubmit={(e)=>void registerPayment(e,modal.item)}><div className={styles.modalGrid}><Box label="Parcela" value={`${modal.item.number}/${financial.totalInstallments}`}/><Box label="Valor" value={formatCurrency(modal.item.value)}/><Field label="Data do pagamento"><input className={styles.input} name="paymentDate" type="date" defaultValue={new Date().toISOString().slice(0,10)}/></Field><Field label="Forma de pagamento"><select className={styles.input} name="method" defaultValue={financial.paymentMethod || "PIX"}><option>PIX</option><option>Cartão de crédito</option><option>Boleto</option><option>Cheque</option><option>Dinheiro</option><option>Transferência</option><option>Outro</option></select></Field><div className={`${styles.field} ${styles.span2}`}><label>Instituição</label><input className={styles.input} name="institution" defaultValue={financial.institution}/></div><div className={`${styles.field} ${styles.span2}`}><label>Observação</label><textarea className={styles.input} name="note" rows={2}/></div><div className={`${styles.field} ${styles.span2}`}><label>Comprovante</label><input className={styles.input} name="receipt" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"/></div></div><Actions busy={busy} submitLabel="Confirmar pagamento" onCancel={()=>setModal(null)}/></form> : null}
      {modal.type === "receipt" ? <><div className={styles.modalGrid}><div className={`${styles.modalValue} ${styles.span2}`}><b>Comprovante da parcela</b>{modal.item.number}/{financial.totalInstallments}</div><Box label="Data" value={formatDate(modal.item.paymentDate || modal.item.dueDate)}/></div><div className={styles.modalActions}><button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={()=>setModal(null)}>Fechar</button><button className={`${styles.modalBtn} ${styles.primary}`} type="button" disabled={busy} onClick={()=>void viewReceipt(modal.item)}>Visualizar</button></div></> : null}
      {modal.type === "contract" ? <><div className={styles.modalGrid}><div className={`${styles.modalValue} ${styles.span2}`}><b>Cliente</b>{clientName}</div><Box label="Plano" value={`${financial.totalInstallments}x de ${formatCurrency(financial.installmentValue)}`}/><Box label="Valor total" value={formatCurrency(financial.totalPlan)}/><Box label="Início" value={formatDate(financial.planStart)}/><Box label="Instituição" value={financial.institution || "—"}/><Box label="Status" value={financial.status === "Ativa" ? "Ativo" : "Suspenso"}/></div><div className={styles.modalActions}><button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={()=>setModal(null)}>Fechar</button></div></> : null}
      {modal.type === "confirm" ? <><div className={styles.warning}>Confirme o comprovante real da parcela {modal.item.number}/{financial.totalInstallments}. A confirmação dará baixa na parcela pelo fluxo financeiro auditado.</div><div className={styles.modalActions}><button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={()=>setModal(null)}>Cancelar</button><button className={`${styles.modalBtn} ${styles.primary}`} type="button" disabled={busy} onClick={()=>void validateReceipt(modal.item,"confirmar")}>Confirmar comprovante</button></div></> : null}
      {modal.type === "reject" ? <RejectForm busy={busy} item={modal.item} onCancel={()=>setModal(null)} onSubmit={(reason)=>void validateReceipt(modal.item,"rejeitar",reason)}/> : null}
    </ModalShell> : null}
  </>;
}

function modalTitle(modal: Modal) {
  if (modal.type === "details") return "Detalhes da parcela";
  if (modal.type === "edit") return `Editar parcela ${modal.item.number}`;
  if (modal.type === "delete") return "Excluir parcela";
  if (modal.type === "payment") return "Registrar pagamento";
  if (modal.type === "receipt") return `Comprovante da parcela ${modal.item.number}`;
  if (modal.type === "contract") return "Contrato financeiro";
  if (modal.type === "confirm") return "Confirmar comprovante";
  return "Rejeitar comprovante";
}
function pillClass(status: DrawerInstallment["status"]) { return status==="paid"?styles.pPaid:status==="pending"?styles.pPending:status==="overdue"?styles.pOverdue:status==="review"?styles.pReview:status==="rejected"?styles.pRejected:styles.pSuspended; }
function ModalShell({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) { return <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose();}}><div className={styles.modal}><div className={styles.modalHead}><h4>{title}</h4><button className={styles.iconBtn} type="button" onClick={onClose} aria-label="Fechar"><DrawerIcon name="close"/></button></div><div className={styles.modalBody}>{children}</div></div></div>; }
function Details({item,total}:{item:DrawerInstallment;total:number}) { return <><div className={styles.modalGrid}><Box label="Parcela" value={`${item.number} de ${total}`}/><Box label="Vencimento" value={formatDate(item.dueDate)}/><Box label="Valor" value={formatCurrency(item.value)}/><Box label="Status" value={INSTALLMENT_LABELS[item.status]}/><Box label="Pagamento" value={formatDate(item.paymentDate)}/><Box label="Comprovante" value={item.receipt?"Disponível":"—"}/></div></>; }
function Box({label,value}:{label:string;value:string}) { return <div className={styles.modalValue}><b>{label}</b>{value}</div>; }
function Field({label,children}:{label:string;children:ReactNode}) { return <div className={styles.field}><label>{label}</label>{children}</div>; }
function Actions({busy,submitLabel,onCancel}:{busy:boolean;submitLabel:string;onCancel:()=>void}) { return <div className={styles.modalActions}><button className={`${styles.modalBtn} ${styles.secondary}`} type="button" onClick={onCancel}>Cancelar</button><button className={`${styles.modalBtn} ${styles.primary}`} type="submit" disabled={busy}>{busy?"Salvando...":submitLabel}</button></div>; }
function RejectForm({busy,item,onCancel,onSubmit}:{busy:boolean;item:DrawerInstallment;onCancel:()=>void;onSubmit:(reason:string)=>void}) {
  const [reason,setReason]=useState("");
  const [error,setError]=useState("");
  return <form onSubmit={(e)=>{
    e.preventDefault();
    const normalized=reason.trim();
    if(!normalized){setError("Informe o motivo da rejeição.");return;}
    setError("");
    onSubmit(normalized);
  }}>
    <div className={styles.warning}>Informe o motivo da rejeição do comprovante da parcela {item.number}.</div>
    <div className={styles.field} style={{marginTop:10}}><label>Motivo</label><textarea className={styles.input} value={reason} onChange={(e)=>{setReason(e.target.value);if(error)setError("");}}/></div>
    {error ? <div className={styles.errorBox} role="alert" style={{marginTop:8}}>{error}</div> : null}
    <Actions busy={busy} submitLabel="Rejeitar comprovante" onCancel={onCancel}/>
  </form>;
}
function message(error: unknown) { return error instanceof Error ? error.message : "Não foi possível concluir a operação."; }
