import type { CSSProperties, ReactNode } from "react";

// Primitivas visuais do cadastro da cliente (Perfil/Financeiro), movidas sem
// alteração de ClienteZipDrawer para serem compartilhadas entre Clientes,
// Financeiro e o drawer da Central.

export const moedaNumero = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dataBrCurta = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

export const rowLabel: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 };
export const softLabel: CSSProperties = { color: "var(--soft)" };
export const strongVal: CSSProperties = { fontWeight: 600 };
export const fieldLabel: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "var(--soft)", marginBottom: 4 };
export const fieldInput: CSSProperties = { width: "100%", height: 33, padding: "0 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--ink)", fontSize: 12, outline: "none" };
export const sectionTitle: CSSProperties = { fontSize: 8.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 10 };
export const primaryBtn: CSSProperties = { height: 34, padding: "0 14px", borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "#FFFDFC", fontSize: 12, fontWeight: 600, width: "100%" };
export const secondaryBtn: CSSProperties = { height: 32, padding: "0 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 11.5, fontWeight: 600 };

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ minWidth: 0 }}><label style={fieldLabel}>{label}</label>{children}</div>;
}
export function Row({ label, value, style }: { label: string; value: ReactNode; style?: CSSProperties }) {
  return <div style={rowLabel}><span style={softLabel}>{label}</span><span style={{ ...strongVal, ...style }}>{value}</span></div>;
}
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div style={{ borderTop: "1px solid var(--line)", padding: "13px 0" }}><div style={sectionTitle}>{title}</div><div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{children}</div></div>;
}
