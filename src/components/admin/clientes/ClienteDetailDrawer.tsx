import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Cliente } from "@/types/database";
import { deriveJourneySteps } from "@/lib/journeySteps";
import { ClienteFinanceTab, type ClienteFinanceTabHandle } from "./ClienteFinanceTab";
import { ClienteProfileTab, type ProfileEditState } from "./ClienteProfileTab";
import { DrawerIcon } from "./ClienteDrawerIcons";
import {
  CLIENT_STATUS_OPTIONS, apiJson, buildJourneyFlags, initialFinancialModel, mapBoletoToDrawerInstallment,
  mapClienteToDrawerModel, mapHistory, mergePlanClient, statusDb,
  type DrawerClientModel, type DrawerFinancialModel, type DrawerHistoryResponse, type DrawerInstallment,
  type DrawerJourneyResponse, type DrawerPlanResponse, type FinancialHistoryItem, type JourneyContract,
} from "./clienteDrawerModel";
import styles from "./ClienteDetailDrawer.module.css";

interface Props {
  cliente: Cliente | null;
  open: boolean;
  creating?: boolean;
  onClose: () => void;
  onUpdated: (cliente?: Cliente) => void;
  onCreated?: (cliente: Cliente) => void;
}

const emptyClient: DrawerClientModel = {
  id: "", status: "Ativa", name: "", birthDate: "", cpf: "", phone: "", email: "", procedure: "",
  planValue: null, seller: "", campaign: "", bank: "", notes: "", releaseForecast: "",
};
const emptyFinancial: DrawerFinancialModel = {
  procedure: "", totalPlan: 0, totalInstallments: 0, installmentValue: 0, eligibilityPercentage: 70,
  planStart: "", paymentMethod: "", institution: "", billingDay: null, status: "Ativa",
};
const emptyEditing: ProfileEditState = { personal: false, procedure: false, sale: false, notes: false };

export function ClienteDetailDrawer({ cliente, open, creating = false, onClose, onUpdated, onCreated }: Props) {
  const [entered, setEntered] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "finance">("profile");
  const [savedClient, setSavedClient] = useState<DrawerClientModel>(emptyClient);
  const [draftClient, setDraftClient] = useState<DrawerClientModel>(emptyClient);
  const [financial, setFinancial] = useState<DrawerFinancialModel>(emptyFinancial);
  const [installments, setInstallments] = useState<DrawerInstallment[]>([]);
  const [history, setHistory] = useState<FinancialHistoryItem[]>([]);
  const [journeyContract, setJourneyContract] = useState<JourneyContract | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProfileEditState>(emptyEditing);
  const [favorite, setFavorite] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);

  const drawerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const financeRef = useRef<ClienteFinanceTabHandle>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const financeRequestRef = useRef(0);

  const notify = useCallback((message: string, error = false) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ message, error });
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  const resetFromClient = useCallback((next: Cliente | null) => {
    financeRequestRef.current += 1;
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    const mapped = next ? mapClienteToDrawerModel(next) : emptyClient;
    const fin = next ? initialFinancialModel(next) : emptyFinancial;
    setSavedClient(mapped); setDraftClient(mapped); setFinancial(fin);
    setInstallments([]); setHistory([]); setJourneyContract(null);
    setEditing(emptyEditing); setFavorite(false); setStatusOpen(false); setActiveTab("profile");
    setFinanceError(null); setFinanceLoading(Boolean(next?.id)); setToast(null);
    requestAnimationFrame(() => { if (contentRef.current) contentRef.current.scrollTop = 0; });
  }, []);

  useLayoutEffect(() => { resetFromClient(cliente); }, [cliente?.id, creating, resetFromClient]);

  useEffect(() => {
    if (!open) return;
    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => { setEntered(true); drawerRef.current?.focus(); });
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = ""; };
  }, [open]);

  const requestClose = useCallback(() => {
    if (closeTimer.current) return;
    setStatusOpen(false); setEntered(false);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      onClose();
      requestAnimationFrame(() => lastFocusedRef.current?.focus());
    }, 250);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (statusOpen) { event.preventDefault(); setStatusOpen(false); return; }
      event.preventDefault(); requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, statusOpen, requestClose]);

  useEffect(() => {
    if (!statusOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('[data-client-status-control]')) setStatusOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [statusOpen]);

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const loadFinancial = useCallback(async () => {
    if (!cliente?.id) return;
    const clientId = cliente.id;
    const requestId = ++financeRequestRef.current;
    setFinanceLoading(true); setFinanceError(null);
    try {
      const id = encodeURIComponent(clientId);
      const [planData, historyData, journeyData] = await Promise.all([
        apiJson<DrawerPlanResponse>(`/api/admin/clientes/${id}/boletos`),
        apiJson<DrawerHistoryResponse>(`/api/admin/clientes/${id}/historico`),
        apiJson<DrawerJourneyResponse>(`/api/admin/clientes/${id}/jornada`),
      ]);
      if (financeRequestRef.current !== requestId) return;
      const sourceRows: Record<string, unknown>[] = planData.boletos ?? planData.parcelas ?? [];
      const rows: DrawerInstallment[] = sourceRows.map(mapBoletoToDrawerInstallment);
      let nextFinancial = mergePlanClient(initialFinancialModel(cliente), planData.cliente);
      if (!nextFinancial.totalInstallments && rows.length) nextFinancial = { ...nextFinancial, totalInstallments: rows.length };
      if (!nextFinancial.installmentValue && rows.length) nextFinancial = { ...nextFinancial, installmentValue: rows.find((x) => x.status !== "paid")?.value ?? rows[0].value };
      if (!nextFinancial.planStart && rows.length) nextFinancial = { ...nextFinancial, planStart: rows[0].dueDate };
      setFinancial(nextFinancial);
      setInstallments(rows);
      setHistory(mapHistory(historyData.historico ?? historyData.logs ?? []));
      setJourneyContract(journeyData.contrato ?? null);
    } catch (e) {
      if (financeRequestRef.current !== requestId) return;
      setFinanceError(e instanceof Error ? e.message : "Falha ao carregar dados financeiros.");
    } finally {
      if (financeRequestRef.current === requestId) setFinanceLoading(false);
    }
  }, [cliente]);

  useEffect(() => { if (cliente?.id) void loadFinancial(); }, [cliente?.id, loadFinancial]);

  const journeySteps = useMemo(() => {
    if (!cliente) return [];
    const summaryPaid = installments.filter((item) => item.status === "paid").length;
    const progress = financial.totalInstallments > 0 ? summaryPaid / financial.totalInstallments * 100 : 0;
    const minimum = Math.ceil(financial.totalInstallments * financial.eligibilityPercentage / 100);
    const flags = buildJourneyFlags(cliente, journeyContract);
    return deriveJourneySteps({
      percentualPagamento: progress,
      percentualAtingido: summaryPaid >= minimum && minimum > 0,
      ...flags,
    }).map((step) => ({ title: step.title, description: step.description, status: step.status }));
  }, [cliente, journeyContract, installments, financial.totalInstallments, financial.eligibilityPercentage]);

  function cancelProfileSection(key: keyof ProfileEditState) {
    const patch: Partial<DrawerClientModel> = {};
    if (key === "personal") Object.assign(patch, { name: savedClient.name, cpf: savedClient.cpf, birthDate: savedClient.birthDate, phone: savedClient.phone, email: savedClient.email });
    if (key === "procedure") Object.assign(patch, { procedure: savedClient.procedure, planValue: savedClient.planValue, releaseForecast: savedClient.releaseForecast });
    if (key === "sale") Object.assign(patch, { seller: savedClient.seller, campaign: savedClient.campaign, bank: savedClient.bank });
    if (key === "notes") Object.assign(patch, { notes: savedClient.notes });
    setDraftClient((current) => ({ ...current, ...patch }));
    setEditing((current) => ({ ...current, [key]: false }));
  }

  async function saveProfile() {
    setProfileSaving(true);
    try {
      const payload = {
        nomeCompleto: draftClient.name.trim() || null,
        cpf: draftClient.cpf.trim() || null,
        dataNascimento: draftClient.birthDate || null,
        telefone: draftClient.phone.trim() || null,
        email: draftClient.email.trim() || null,
        procedimento: draftClient.procedure.trim() || null,
        consultora: draftClient.seller.trim() || null,
        valorContrato: draftClient.planValue,
        origemVenda: draftClient.campaign.trim() || null,
        banco: draftClient.bank.trim() || null,
        observacoes: draftClient.notes.trim() || null,
      };
      if (creating || !cliente?.id) {
        const data = await apiJson<{ cliente: Cliente }>("/api/admin/clientes", { method: "POST", body: JSON.stringify(payload) });
        setEditing(emptyEditing); notify("Cliente cadastrada com sucesso.");
        onCreated?.(data.cliente);
        return;
      }
      const data = await apiJson<{ cliente: Cliente }>(`/api/admin/clientes/${encodeURIComponent(cliente.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
      const merged = { ...cliente, ...data.cliente, banco: draftClient.bank || null, origem_venda: draftClient.campaign || null } as Cliente;
      const mapped = mapClienteToDrawerModel(merged);
      setSavedClient(mapped); setDraftClient(mapped); setEditing(emptyEditing);
      setFinancial((current) => ({ ...current, procedure: mapped.procedure }));
      onUpdated(merged); notify("Alterações salvas com sucesso.");
    } catch (e) { notify(e instanceof Error ? e.message : "Falha ao salvar alterações.", true); }
    finally { setProfileSaving(false); }
  }

  async function changeStatus(label: DrawerClientModel["status"]) {
    if (!cliente?.id || label === savedClient.status) { setStatusOpen(false); return; }
    setStatusSaving(true);
    try {
      const db = statusDb(label);
      const payload: Record<string, unknown> = { status: db };
      if (db === "suspenso") payload.suspensoDesde = new Date().toISOString().slice(0, 10);
      const data = await apiJson<{ cliente: Cliente }>(`/api/admin/clientes/${encodeURIComponent(cliente.id)}/status-contrato`, { method: "POST", body: JSON.stringify(payload) });
      const merged = { ...cliente, ...data.cliente } as Cliente;
      const mapped = mapClienteToDrawerModel(merged);
      setSavedClient((current) => ({ ...current, status: mapped.status }));
      setDraftClient((current) => ({ ...current, status: mapped.status }));
      setStatusOpen(false); onUpdated(merged); notify(`Status alterado para ${mapped.status}.`);
    } catch (e) { notify(e instanceof Error ? e.message : "Falha ao alterar status.", true); }
    finally { setStatusSaving(false); }
  }

  async function saveCurrentTab() {
    if (activeTab === "finance") return financeRef.current?.save();
    await saveProfile();
  }

  if (!open) return null;
  return <div className={styles.root}>
    <div className={`${styles.overlay} ${entered ? styles.open : ""}`} aria-hidden={!entered} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}/>
    <aside ref={drawerRef} className={`${styles.drawer} ${entered ? styles.open : ""}`} role="dialog" aria-modal="true" aria-labelledby="client-drawer-title" tabIndex={-1}>
      <header className={styles.header}>
        <div className={styles.clientHead}><h2 className={styles.title} id="client-drawer-title">{creating ? "Nova cliente" : draftClient.name || "Cliente"}</h2></div>
        <div className={styles.actions}>
          {!creating ? <div className={styles.statusWrap} data-client-status-control>
            <button className={styles.status} data-status={draftClient.status.toLocaleLowerCase("pt-BR")} type="button" aria-haspopup="menu" aria-expanded={statusOpen} aria-label={`Status da cliente: ${draftClient.status}. Clique para alterar.`} disabled={statusSaving} onClick={() => setStatusOpen((value) => !value)}>{draftClient.status}</button>
            {statusOpen ? <div className={styles.statusMenu} role="menu" aria-label="Status da cliente">{CLIENT_STATUS_OPTIONS.map((option) => <button key={option.db} className={styles.statusOpt} type="button" role="menuitemradio" aria-checked={draftClient.status === option.label} onClick={() => void changeStatus(option.label)}><span className={styles.dot} style={{color:option.color}}/>{option.label}</button>)}</div> : null}
          </div> : null}
          <button className={`${styles.iconBtn} ${styles.heart} ${favorite ? styles.fav : ""}`} type="button" aria-label="Favoritar cliente" aria-pressed={favorite} onClick={() => setFavorite((v) => !v)}><DrawerIcon name="heart"/></button>
          <button className={styles.iconBtn} type="button" aria-label="Fechar perfil" onClick={requestClose}><DrawerIcon name="close"/></button>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Seções da cliente"><div className={styles.tabsShell} role="tablist">
        <button className={styles.tab} type="button" role="tab" aria-selected={activeTab === "profile"} aria-controls="client-drawer-content" onClick={() => { setActiveTab("profile"); requestAnimationFrame(() => { if(contentRef.current) contentRef.current.scrollTop=0; }); }}><DrawerIcon name="user"/>PERFIL</button>
        <button className={styles.tab} type="button" role="tab" aria-selected={activeTab === "finance"} aria-controls="client-drawer-content" disabled={creating} onClick={() => { setActiveTab("finance"); requestAnimationFrame(() => { if(contentRef.current) contentRef.current.scrollTop=0; }); }}><DrawerIcon name="finance"/>FINANCEIRO</button>
      </div></nav>

      <section ref={contentRef} className={styles.content} id="client-drawer-content" role="tabpanel" aria-label={activeTab === "profile" ? "Perfil" : "Financeiro"} tabIndex={0}>
        {activeTab === "profile" ? <ClienteProfileTab client={draftClient} financial={financial} editing={editing} journeySteps={journeySteps} onEdit={(key) => setEditing((state) => ({...state,[key]:true}))} onCancel={cancelProfileSection} onDone={(key) => setEditing((state) => ({...state,[key]:false}))} onChange={(patch) => setDraftClient((current) => ({...current,...patch}))}/> :
        cliente ? <ClienteFinanceTab ref={financeRef} clienteId={cliente.id} clientName={draftClient.name} financial={financial} installments={installments} history={history} loading={financeLoading} error={financeError} onReload={loadFinancial} onUpdated={() => onUpdated()} notify={notify}/> : null}
      </section>

      <footer className={styles.footer}><button className={`${styles.footerBtn} ${styles.closeBtn}`} type="button" onClick={requestClose}>Fechar</button><button className={`${styles.footerBtn} ${styles.saveBtn}`} type="button" disabled={profileSaving || statusSaving} onClick={() => void saveCurrentTab()}><DrawerIcon name="save"/> {profileSaving ? "Salvando..." : "Salvar alterações"}</button></footer>
    </aside>
    {toast ? <div className={`${styles.toast} ${toast.error ? styles.error : ""}`} role="status" aria-live="polite"><DrawerIcon name={toast.error ? "alert" : "check"}/><span>{toast.message}</span></div> : null}
  </div>;
}
