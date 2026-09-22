"use client";

import { useState } from "react";
import type { Cliente } from "@/types/database";
import { STATUS_CONTRATO_LABEL } from "@/types/database";
import { zipChip } from "./zipUi";
import { useClienteCadastro } from "./cliente/useClienteCadastro";
import { ClienteProfilePanel } from "./cliente/ClienteProfilePanel";
import { ClienteFinancePanel } from "./cliente/ClienteFinancePanel";
import { ClienteCadastroModals } from "./cliente/ClienteCadastroModals";
import { primaryBtn, secondaryBtn } from "./cliente/clienteUi";

/**
 * Drawer lateral de Clientes e Financeiro, com as abas [ PERFIL ] [ FINANCEIRO ].
 * O conteúdo das abas é o cadastro real compartilhado (cliente/*), o mesmo
 * usado nas abas Perfil/Financeiro do drawer da Central de acompanhamento.
 */
export function ClienteZipDrawer({ cliente, onClose, onSalvo, abaInicial = "perfil" }: { cliente: Cliente | null; onClose: () => void; onSalvo: () => void; abaInicial?: "perfil" | "financeiro" }) {
  const cad = useClienteCadastro(cliente, { onSalvo, onClose });
  const { editando } = cad;
  const [aba, setAba] = useState<"perfil" | "financeiro">(editando ? abaInicial : "perfil");

  return <>
    <div className="zip-admin zip-animate-fade-in" style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(30,12,16,.42)", backdropFilter: "blur(3px)" }} onClick={onClose} />
    <aside className="zip-admin zip-animate-slide-in" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 61, width: "min(430px,100vw)", background: "var(--s0)", borderLeft: "1px solid var(--line)", boxShadow: "var(--sh)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 16px 13px", borderBottom: "1px solid var(--line)", display: "flex", gap: 11, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 16, lineHeight: 1.25 }}>{cad.nome || "Nova cliente"}</h2>
          {editando && <div style={{ marginTop: 6 }}><span style={zipChip(cad.statusKind)}>● {STATUS_CONTRATO_LABEL[cliente?.status_contrato ?? "ativo"]}</span></div>}
        </div>
        {editando && <button onClick={() => cad.setConfirmarExclusao(true)} title="Excluir perfil" style={{ height: 28, width: 28, flex: "none", borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--bad)", fontSize: 12 }}>🗑</button>}
        <button onClick={onClose} style={{ height: 28, width: 28, flex: "none", borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 13 }}>✕</button>
      </div>

      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 5 }}>
        <button onClick={() => setAba("perfil")} style={{ flex: 1, height: 30, borderRadius: 8, border: aba === "perfil" ? "1px solid var(--bg)" : "1px solid var(--line)", background: aba === "perfil" ? "var(--bg)" : "var(--s0)", color: aba === "perfil" ? "#FFFDFC" : "var(--soft)", fontSize: 11, fontWeight: 700 }}>PERFIL</button>
        <button onClick={() => setAba("financeiro")} disabled={!editando} style={{ flex: 1, height: 30, borderRadius: 8, border: aba === "financeiro" ? "1px solid var(--bg)" : "1px solid var(--line)", background: aba === "financeiro" ? "var(--bg)" : "var(--s0)", color: aba === "financeiro" ? "#FFFDFC" : "var(--soft)", fontSize: 11, fontWeight: 700, opacity: editando ? 1 : .4 }}>FINANCEIRO{cad.boletos.length > 0 ? ` · ${cad.boletos.length}` : ""}</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px" }}>
        {aba === "perfil" ? <ClienteProfilePanel cad={cad} formId="zip-drawer-perfil" /> : <ClienteFinancePanel cad={cad} />}
      </div>

      <div style={{ borderTop: "1px solid var(--line)", padding: "13px 16px", display: "flex", gap: 9, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} style={secondaryBtn}>Fechar</button>
        {aba === "perfil" && <button type="submit" form="zip-drawer-perfil" disabled={cad.salvandoPerfil} style={primaryBtn}>Salvar</button>}
      </div>

      <ClienteCadastroModals cad={cad} />
    </aside>
  </>;
}
