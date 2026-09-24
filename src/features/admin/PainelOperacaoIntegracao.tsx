import { useState, type ReactNode } from "react";

/**
 * Botão + painel lateral para a operação de uma integração dentro das telas
 * da equipe (Clientes, Financeiro). Chaves e configuração ficam com o Dev.
 */
export function PainelOperacaoIntegracao({ rotulo, titulo, descricao, children }: { rotulo: string; titulo: string; descricao: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  return <>
    <button type="button" onClick={() => setAberto(true)} style={{ height: 32, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer" }}>{rotulo}</button>
    {aberto && <>
      <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", zIndex: 60 }} onClick={() => setAberto(false)} />
      <aside className="zip-admin zip-animate-slide-in" role="dialog" aria-label={titulo} style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 61, width: "min(620px,100vw)", background: "var(--s0)", borderLeft: "1px solid var(--line)", boxShadow: "var(--sh)", overflowY: "auto", color: "var(--ink)" }}>
        <div style={{ padding: "14px 15px 12px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 12, position: "sticky", top: 0, background: "var(--s0)", zIndex: 1 }}>
          <div><div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--rose)" }}>Operação</div><h2 style={{ fontSize: 16, marginTop: 4 }}>{titulo}</h2><div style={{ marginTop: 4, fontSize: 10.5, color: "var(--soft)" }}>{descricao}</div></div>
          <button type="button" aria-label="Fechar" onClick={() => setAberto(false)} style={{ height: 28, width: 28, borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 13 }}>✕</button>
        </div>
        <div style={{ padding: "4px 15px 18px" }}>{children}</div>
      </aside>
    </>}
  </>;
}
