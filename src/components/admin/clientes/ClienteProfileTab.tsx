import type { ReactNode } from "react";
import type { AppAccessRequirements } from "@/lib/appAccess";
import type { DrawerClientModel, DrawerFinancialModel } from "./clienteDrawerModel";
import { formatCurrency, formatDate, formatDateTime, formatNumberBR } from "./clienteDrawerModel";
import { DrawerIcon } from "./ClienteDrawerIcons";
import styles from "./ClienteDetailDrawer.module.css";

export type ProfileEditState = { personal: boolean; procedure: boolean; sale: boolean; notes: boolean };
export type JourneyViewStep = { title: string; description: string; status: "done" | "current" | "upcoming" };

interface Props {
  client: DrawerClientModel;
  financial: DrawerFinancialModel;
  editing: ProfileEditState;
  journeySteps: JourneyViewStep[];
  appAccessRequirements: AppAccessRequirements;
  appAccessSaving: boolean;
  onReleaseAppAccess: () => void;
  onEdit: (key: keyof ProfileEditState) => void;
  onCancel: (key: keyof ProfileEditState) => void;
  onDone: (key: keyof ProfileEditState) => void;
  onChange: (patch: Partial<DrawerClientModel>) => void;
}

function SectionHeader({
  title, icon, editKey, editing, onEdit, onCancel, onDone,
}: {
  title: string;
  icon: "usercard" | "procedure" | "tag" | "document" | "clock";
  editKey?: keyof ProfileEditState;
  editing?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onDone?: () => void;
}) {
  return <div className={styles.cardHead}>
    <h3 className={styles.cardTitle}><DrawerIcon name={icon}/>{title}</h3>
    {editKey ? editing ? <span>
      <button className={styles.cancel} type="button" onClick={onCancel}>Cancelar</button>
      <button className={styles.done} type="button" onClick={onDone}>Concluir</button>
    </span> : <button className={styles.edit} type="button" onClick={onEdit} aria-label={`Editar ${title}`}><DrawerIcon name="edit"/> Editar</button> : null}
  </div>;
}

export function ClienteProfileTab({ client, financial, editing, journeySteps, appAccessRequirements, appAccessSaving, onReleaseAppAccess, onEdit, onCancel, onDone, onChange }: Props) {
  const current = journeySteps.find((step) => step.status === "current") ?? journeySteps[journeySteps.length - 1];
  return <div className={styles.stack}>
    <article className={styles.card}>
      <SectionHeader title="Dados principais" icon="usercard" editKey="personal" editing={editing.personal} onEdit={() => onEdit("personal")} onCancel={() => onCancel("personal")} onDone={() => onDone("personal")}/>
      <div className={styles.cardBody}>
        {editing.personal ? <div className={styles.formGrid}>
          <Field label="Nome completo"><input className={styles.input} value={client.name} onChange={(e) => onChange({ name: e.target.value })}/></Field>
          <Field label="CPF"><input className={styles.input} value={client.cpf} onChange={(e) => onChange({ cpf: e.target.value })}/></Field>
          <Field label="Data de nascimento"><input className={styles.input} type="date" value={client.birthDate} onChange={(e) => onChange({ birthDate: e.target.value })}/></Field>
          <Field label="Telefone"><input className={styles.input} value={client.phone} onChange={(e) => onChange({ phone: e.target.value })}/></Field>
          <Field label="E-mail"><input className={styles.input} type="email" value={client.email} onChange={(e) => onChange({ email: e.target.value })}/></Field>
        </div> : <div className={styles.infoGrid}>
          <Info label="Nome completo" value={client.name}/>
          <Info label="CPF" value={client.cpf}/>
          <Info label="Data de nascimento" value={formatDate(client.birthDate)}/>
          <div><span className={styles.label}>Telefone</span><div className={`${styles.value} ${styles.inline}`}>{client.phone || "—"}<DrawerIcon name="whatsapp" className={styles.wa}/></div></div>
          <Info label="E-mail" value={client.email}/>
        </div>}
      </div>
    </article>

    <article className={styles.card}>
      <SectionHeader title="Acesso ao aplicativo" icon="usercard"/>
      <div className={styles.cardBody}>
        <div className={styles.appAccessHeader}>
          <div>
            <span className={styles.appAccessKicker}>Status</span>
            <strong className={client.appAccessReleased ? styles.appAccessReleased : appAccessRequirements.canRelease ? styles.appAccessReady : styles.appAccessWaiting}>
              {client.appAccessReleased ? "● Acesso liberado" : appAccessRequirements.canRelease ? "Pronta para acesso" : "Aguardando requisitos"}
            </strong>
          </div>
          {client.appAccessReleased ? <span className={styles.appAccessBadge}>Liberado</span> : null}
        </div>

        <div className={styles.appAccessChecklist} aria-label="Requisitos para liberação do aplicativo">
          <AccessRequirement ok={appAccessRequirements.hasName} complete="Nome cadastrado" incomplete="Nome ainda não cadastrado"/>
          <AccessRequirement ok={appAccessRequirements.hasCpf} complete="CPF válido" incomplete="CPF válido ainda não cadastrado"/>
          <AccessRequirement ok={appAccessRequirements.hasBirthDate} complete="Data de nascimento cadastrada" incomplete="Data de nascimento ainda não cadastrada"/>
          <AccessRequirement ok={appAccessRequirements.hasFinancial} complete="Financeiro criado" incomplete="Financeiro ainda não criado"/>
        </div>

        {client.appAccessReleased ? (
          <div className={styles.appAccessReleasedInfo}>
            <span>Data da liberação</span>
            <strong>{client.appAccessReleasedAt ? formatDateTime(client.appAccessReleasedAt) : "Acesso legado — data não registrada"}</strong>
          </div>
        ) : (
          <>
            <button
              className={styles.appAccessButton}
              type="button"
              disabled={!appAccessRequirements.canRelease || appAccessSaving}
              onClick={onReleaseAppAccess}
            >
              {appAccessSaving ? "Liberando..." : "Liberar acesso ao app"}
            </button>
            {!appAccessRequirements.canRelease ? <p className={styles.appAccessHint}>Conclua os requisitos acima para liberar o acesso.</p> : null}
          </>
        )}
      </div>
    </article>

    <article className={styles.card}>
      <SectionHeader title="Procedimento" icon="procedure" editKey="procedure" editing={editing.procedure} onEdit={() => onEdit("procedure")} onCancel={() => onCancel("procedure")} onDone={() => onDone("procedure")}/>
      <div className={styles.cardBody}>
        {editing.procedure ? <div className={styles.formGrid}>
          <Field label="Procedimento"><input className={styles.input} value={client.procedure} onChange={(e) => onChange({ procedure: e.target.value })}/></Field>
          <Field label="Valor da carta de crédito"><input className={styles.input} type="number" min="0" step="0.01" value={client.planValue ?? ""} onChange={(e) => onChange({ planValue: e.target.value === "" ? null : Number(e.target.value) })}/></Field>
          <Field label="Parcelamento"><div className={styles.modalValue}>{financial.totalInstallments || 0}x {formatNumberBR(financial.installmentValue)}</div></Field>
          <Field label="Previsão de liberação"><div className={styles.modalValue}>{formatDate(client.releaseForecast)}</div></Field>
        </div> : <div className={styles.infoGrid}>
          <Info label="Procedimento" value={client.procedure}/>
          <Info label="Valor da carta de crédito" value={formatCurrency(client.planValue)}/>
          <Info label="Parcelamento" value={`${financial.totalInstallments || 0}x ${formatNumberBR(financial.installmentValue)}`}/>
          <Info label="Previsão de liberação" value={formatDate(client.releaseForecast)}/>
        </div>}
      </div>
    </article>

    <article className={styles.card}>
      <SectionHeader title="Informações da venda" icon="tag" editKey="sale" editing={editing.sale} onEdit={() => onEdit("sale")} onCancel={() => onCancel("sale")} onDone={() => onDone("sale")}/>
      <div className={styles.cardBody}>
        {editing.sale ? <div className={styles.formGrid}>
          <Field label="Vendedora"><input className={styles.input} value={client.seller} onChange={(e) => onChange({ seller: e.target.value })}/></Field>
          <Field label="Campanha / Origem"><input className={styles.input} value={client.campaign} onChange={(e) => onChange({ campaign: e.target.value })}/></Field>
          <Field label="Banco"><input className={styles.input} value={client.bank} onChange={(e) => onChange({ bank: e.target.value })}/></Field>
        </div> : <div className={styles.saleGrid}>
          <Info label="Vendedora" value={client.seller}/>
          <Info label="Campanha / Origem" value={client.campaign}/>
          <div><span className={styles.label}>Banco</span><div className={`${styles.value} ${styles.inline}`}><DrawerIcon name="bank" className={styles.bank}/>{client.bank || "—"}</div></div>
        </div>}
      </div>
    </article>

    <article className={styles.card}>
      <SectionHeader title="Observações internas" icon="document" editKey="notes" editing={editing.notes} onEdit={() => onEdit("notes")} onCancel={() => onCancel("notes")} onDone={() => onDone("notes")}/>
      <div className={styles.cardBody}>
        {editing.notes
          ? <textarea className={styles.input} value={client.notes} onChange={(e) => onChange({ notes: e.target.value })}/>
          : <div className={styles.notes}>{client.notes || "Nenhuma observação interna cadastrada."}</div>}
      </div>
    </article>

    <article className={styles.card}>
      <SectionHeader title="Jornada da cliente" icon="clock"/>
      <div className={styles.journeyBody}>
        {current ? <div className={styles.journeyCurrent}>
          <div>
            <span className={styles.journeyKicker}>Etapa atual no app</span>
            <div className={styles.journeyNow}>{current.title}</div>
            <div className={styles.journeyDetail}>{current.description}</div>
          </div>
          <span className={styles.journeyBadge}><DrawerIcon name="usercard"/> Jornada no app</span>
        </div> : null}
        <div className={styles.journeyHeading}>
          <div><span className={styles.journeyKicker}>Passo a passo</span><strong>Do contrato à sua cirurgia</strong></div>
          <span className={styles.journeyLegend}>Concluído · Agora · Próximos</span>
        </div>
        <div className={styles.journeyList} aria-label="Etapas da jornada da cliente">
          {journeySteps.map((step, index) => {
            const stateClass = step.status === "done" ? styles.complete : step.status === "current" ? styles.current : styles.upcoming;
            const label = step.status === "done" ? "Concluído" : step.status === "current" ? "Agora" : "Próximo";
            return <div key={`${step.title}-${index}`} className={`${styles.journeyStep} ${stateClass}`}>
              <div className={styles.marker} aria-hidden="true">{step.status === "done" ? <DrawerIcon name="check"/> : <span>{index + 1}</span>}</div>
              <div>
                <div className={styles.stage}>Etapa {index + 1}</div>
                <div className={styles.journeyTitle}>{step.title}</div>
                <div className={styles.journeyText}>{step.description}</div>
              </div>
              <span className={`${styles.journeyState} ${stateClass}`}>{label}</span>
            </div>;
          })}
        </div>
      </div>
    </article>
  </div>;
}

function AccessRequirement({ ok, complete, incomplete }: { ok: boolean; complete: string; incomplete: string }) {
  return <div className={`${styles.appAccessRequirement} ${ok ? styles.appAccessRequirementDone : ""}`}>
    <span className={styles.appAccessRequirementIcon} aria-hidden="true">{ok ? <DrawerIcon name="check"/> : "○"}</span>
    <span>{ok ? complete : incomplete}</span>
  </div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><span className={styles.label}>{label}</span><div className={styles.value}>{value || "—"}</div></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.field}><label>{label}</label>{children}</div>;
}
