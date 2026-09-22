import { formatarCpf } from "@/lib/cpf";
import type { StatusContratoCliente } from "@/types/database";
import { STATUS_CONTRATO_LABEL } from "@/types/database";
import { zipChip } from "../zipUi";
import { Field, Row, Section, fieldInput, rowLabel, secondaryBtn, softLabel } from "./clienteUi";
import type { ClienteCadastro } from "./useClienteCadastro";

const STATUS_CONTRATO_OPCOES: StatusContratoCliente[] = ["ativo", "suspenso", "negativado", "cancelado"];

function statusColor(status: StatusContratoCliente) {
  if (status === "ativo") return { color: "var(--ok)" };
  if (status === "suspenso") return { color: "var(--gold)" };
  return { color: "var(--bad)" };
}

/** Perfil real da cliente (dados cadastrais, venda, contrato, observações, histórico). */
export function ClienteProfilePanel({ cad, formId }: { cad: ClienteCadastro; formId: string }) {
  const { editando, cliente } = cad;
  return <form id={formId} onSubmit={cad.salvarPerfil}>
    <div style={{ padding: "14px 0", display: "flex", flexDirection: "column", gap: 9 }}>
      <Field label="Nome completo"><input style={fieldInput} value={cad.nome} onChange={(e) => cad.setNome(e.target.value)} required /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="CPF"><input style={fieldInput} value={cad.cpf} maxLength={14} disabled={editando} onChange={(e) => cad.setCpf(formatarCpf(e.target.value))} /></Field>
        <Field label="Nascimento"><input type="date" style={fieldInput} value={cad.nascimento} onChange={(e) => cad.setNascimento(e.target.value)} required /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Telefone"><input style={fieldInput} value={cad.telefone ?? ""} onChange={(e) => cad.setTelefone(e.target.value)} /></Field>
        <Field label="E-mail"><input style={fieldInput} value={cad.email ?? ""} onChange={(e) => cad.setEmail(e.target.value)} /></Field>
      </div>
      <Field label="Procedimento"><input style={fieldInput} value={cad.procedimento ?? ""} onChange={(e) => cad.setProcedimento(e.target.value)} /></Field>
    </div>

    {editando && <Section title="Informações da venda">
      <Row label="Vendedora" value={cliente?.consultora || "—"} />
      <Row label="Campanha / origem" value={cliente?.origem_venda || "—"} />
      <Row label="Banco" value={cliente?.banco || "—"} />
    </Section>}

    {editando && <Section title="Contrato">
      <div style={{ ...rowLabel, alignItems: "center", position: "relative" }}>
        <span style={softLabel}>Status</span>
        <button type="button" onClick={() => cad.setStatusMenuAberto((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 6, height: 26, padding: "0 7px 0 9px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--s0)", fontSize: 11.5, fontWeight: 600, color: "var(--ink)" }}>
          <span style={zipChip(cad.statusKind)}>● {STATUS_CONTRATO_LABEL[cad.statusContrato]}</span><span style={{ fontSize: 9, color: "var(--soft)" }}>▾</span>
        </button>
        {cad.statusMenuAberto && <div className="zip-animate-pop-in" style={{ position: "absolute", top: 30, right: 0, zIndex: 8, width: 186, border: "1px solid var(--line)", background: "var(--s0)", borderRadius: 10, boxShadow: "var(--sh)", overflow: "hidden" }}>
          {STATUS_CONTRATO_OPCOES.map((o) => <div key={o} className="zip-row-hover" onClick={() => cad.aplicarStatusContrato(o)} style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, borderBottom: "1px solid var(--line2)", cursor: "pointer", display: "flex", justifyContent: "space-between" }}>{STATUS_CONTRATO_LABEL[o]}<span style={statusColor(o)}>●</span></div>)}
          <div style={{ padding: "8px 12px", fontSize: 10.5, color: "var(--soft)", lineHeight: 1.45 }}>Ativo é definido ao gerar as parcelas. Suspenso, negativado e cancelado são manuais.</div>
        </div>}
      </div>
      {cad.statusContrato === "suspenso" && <div style={{ borderRadius: 10, border: "1px solid var(--line)", background: "var(--s1)", padding: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Field label="Suspenso desde"><input type="date" style={fieldInput} value={cad.suspensoDesde ?? ""} onChange={(e) => cad.setSuspensoDesde(e.target.value)} /></Field>
        <Field label="Até (opcional)"><input type="date" style={fieldInput} value={cad.suspensoAte ?? ""} onChange={(e) => cad.setSuspensoAte(e.target.value)} /></Field>
        <div style={{ gridColumn: "1 / -1" }}><Field label="Motivo"><input style={fieldInput} value={cad.suspensaoMotivo ?? ""} onChange={(e) => cad.setSuspensaoMotivo(e.target.value)} placeholder="Ex.: inadimplência, revisão de contrato…" /></Field></div>
        <div style={{ gridColumn: "1 / -1" }}><button type="button" disabled={cad.salvandoStatus} onClick={() => cad.aplicarStatusContrato("suspenso")} style={{ ...secondaryBtn, width: "100%", borderColor: "var(--bad)", color: "var(--bad)" }}>Confirmar suspensão</button></div>
      </div>}
    </Section>}

    <Section title="Observações internas">
      <textarea value={cad.observacoes ?? ""} onChange={(e) => cad.setObservacoes(e.target.value)} rows={3} style={{ ...fieldInput, height: "auto", padding: 10, resize: "vertical" as const }} />
    </Section>

    {editando && <Section title="Histórico operacional">
      <button type="button" onClick={() => cad.setHistoricoAberto((v) => !v)} style={{ ...secondaryBtn, width: "100%" }}>{cad.historicoAberto ? "Ocultar histórico" : `Ver histórico (${cad.historico.length})`}</button>
      {cad.historicoAberto && (cad.historico.length === 0 ? <p style={{ fontSize: 11, color: "var(--soft)" }}>Nenhum evento registrado ainda.</p> : <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {cad.historico.slice(0, 30).map((h) => <div key={h.id} style={{ display: "flex", gap: 11, paddingBottom: 8, borderBottom: "1px solid var(--line2)" }}>
          <span style={{ width: 72, flex: "none", fontSize: 11, color: "var(--soft)" }} className="zip-mono">{new Date(h.created_at).toLocaleDateString("pt-BR")}</span>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 600 }}>{h.acao.replace(/_/g, " ")}</div><div style={{ fontSize: 11, color: "var(--soft)" }}>{new Date(h.created_at).toLocaleTimeString("pt-BR")}</div></div>
        </div>)}
      </div>)}
    </Section>}
  </form>;
}
