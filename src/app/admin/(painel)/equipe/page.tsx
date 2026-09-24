"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";
import { PermissoesColaborador } from "@/features/admin/PermissoesColaborador";
import { ABAS_PERMISSOES } from "@/lib/permissoesEquipe";

/**
 * Aba EQUIPE — membros, cargo (rótulo) e permissões por aba/funcionalidade
 * (src/lib/permissoesEquipe.ts). O acesso ao painel vem das permissões
 * ligadas pelo Admin; o cargo Administrativo tem acesso total.
 */

type Cargo = "vendedora" | "sdr" | "financeiro" | "gestao" | "administrativo";
type Colaborador = { id: string; nome: string; email: string; cargo: Cargo; ativo: boolean; permissoes: string[]; created_at: string; updated_at: string; };

const CARGOS: Array<{ value: Cargo; label: string; descricao: string; area: string }> = [
  { value: "vendedora", label: "Vendedora", descricao: "Portal comercial; no painel, só o que for ligado.", area: "Comercial" },
  { value: "sdr", label: "SDR", descricao: "Agenda e comparecimentos; no painel, só o que for ligado.", area: "Comercial" },
  { value: "financeiro", label: "Financeiro", descricao: "No painel, só o que for ligado nas permissões.", area: "Operação" },
  { value: "gestao", label: "Gestão", descricao: "No painel, só o que for ligado nas permissões.", area: "Gestão" },
  { value: "administrativo", label: "Administrativo", descricao: "Acesso total ao painel.", area: "Gestão" },
];

/** Resumo do que a pessoa acessa no painel (coluna "Acesso"). */
function resumoAcesso(c: { cargo: string; permissoes: string[] }) {
  if (c.cargo === "administrativo") return "Acesso total";
  const abas = ABAS_PERMISSOES.filter((a) => a.permissoes.some((p) => c.permissoes?.includes(p.chave)));
  return abas.length ? abas.map((a) => a.nome).join(", ") : "Sem acesso ao painel";
}

function iniciais(nome: string) { const p = nome.trim().split(/\s+/); return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "—"; }

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as T & { erro?: string };
  if (!response.ok) throw new Error(body.erro ?? "Não foi possível concluir a operação.");
  return body;
}

const fieldInput: React.CSSProperties = { height: 34, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", padding: "0 10px", fontSize: 11.5, width: "100%" };

export default function EquipeAdminPage() {
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cargo, setCargo] = useState<Cargo>("vendedora");
  const [senha, setSenha] = useState("");
  const [filtroCargo, setFiltroCargo] = useState<Cargo | "todos">("todos");
  const [drawer, setDrawer] = useState<Colaborador | null>(null);
  const [souAdministrativo, setSouAdministrativo] = useState(false);
  useEffect(() => { fetch("/api/admin/session", { cache: "no-store" }).then((r) => r.json()).then((d) => setSouAdministrativo(d?.cargo === "administrativo" || d?.acessoTotal === true)).catch(() => undefined); }, []);

  async function carregar() {
    setLoading(true);
    try { const body = await requestJson<{ colaboradores: Colaborador[] }>("/api/admin/staff"); setColaboradores(body.colaboradores ?? []); setErro(null); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível carregar a equipe."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void carregar(); }, []);

  async function criar(event: FormEvent) {
    event.preventDefault(); setCriando(true); setErro(null);
    try { await requestJson("/api/admin/staff", { method: "POST", body: JSON.stringify({ nome, email, cargo, senhaTemporaria: senha }) }); setModal(false); setNome(""); setEmail(""); setCargo("vendedora"); setSenha(""); await carregar(); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível criar o acesso."); }
    finally { setCriando(false); }
  }

  async function atualizar(id: string, patch: Partial<Pick<Colaborador, "cargo" | "ativo" | "permissoes">>) {
    setSalvando(id); setErro(null);
    try { const body = await requestJson<{ colaborador: Colaborador }>(`/api/admin/staff/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }); setColaboradores((atual) => atual.map((item) => item.id === id ? body.colaborador : item)); if (drawer?.id === id) setDrawer(body.colaborador); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível atualizar o acesso."); await carregar(); }
    finally { setSalvando(null); }
  }

  const filtrados = useMemo(() => filtroCargo === "todos" ? colaboradores : colaboradores.filter((c) => c.cargo === filtroCargo), [colaboradores, filtroCargo]);

  return <div className="zip-animate-fade-in">
    {erro && <div style={{ marginBottom: 10, borderRadius: 9, border: "1px solid var(--badbg)", background: "var(--badbg)", color: "var(--bad)", padding: "8px 12px", fontSize: 11 }}>{erro}</div>}

    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><h2 style={{ fontSize: 15 }}>Equipe</h2><div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Usuários internos, perfis de acesso e histórico recente.</div></div>
        <button onClick={() => setModal(true)} style={{ height: 31, padding: "0 12px", borderRadius: 9, border: "1px solid var(--bg)", background: "var(--bg)", color: "var(--on-accent)", fontSize: 11, fontWeight: 700 }}>+ Novo membro</button>
      </div>
      <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--line)", display: "flex", gap: 6, overflow: "auto" }}>
        {(["todos", ...CARGOS.map((c) => c.value)] as const).map((v) => { const on = filtroCargo === v; const label = v === "todos" ? "Todos" : CARGOS.find((c) => c.value === v)?.label; return <button key={v} onClick={() => setFiltroCargo(v)} style={{ height: 26, padding: "0 10px", borderRadius: 999, border: `1px solid ${on ? "var(--bg)" : "var(--line)"}`, background: on ? "var(--robg)" : "var(--s0)", color: on ? "var(--bg)" : "var(--soft)", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</button>; })}
      </div>
      <div style={{ overflow: "auto", maxHeight: 620 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.2fr) 120px minmax(160px,1.3fr) 110px 140px", gap: 10, minWidth: 800, padding: "9px 14px", background: "var(--s1)", borderBottom: "1px solid var(--line)" }}>{["Usuário", "Cargo", "Acesso ao painel", "Status", "Atualizado"].map((h) => <div key={h} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>{h}</div>)}</div>
        {loading && colaboradores.length === 0 ? <div style={{ padding: 32, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Carregando equipe...</div> : filtrados.length === 0 ? <div style={{ padding: 32, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Nenhum colaborador nesse filtro.</div> : filtrados.map((item) => <div key={item.id} onClick={() => setDrawer(item)} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.2fr) 120px minmax(160px,1.3fr) 110px 140px", gap: 10, minWidth: 800, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line2)", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 28, height: 28, borderRadius: 999, background: "var(--s2)", color: "var(--bg)", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700 }}>{iniciais(item.nome)}</div><div><div style={{ fontSize: 12, fontWeight: 700 }}>{item.nome}</div><div style={{ fontSize: 9.5, color: "var(--soft)" }}>{item.email}</div></div></div>
          <div style={{ fontSize: 11, color: "var(--soft)" }}>{CARGOS.find((c) => c.value === item.cargo)?.label}</div>
          <div title={resumoAcesso(item)} style={{ fontSize: 11, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{resumoAcesso(item)}</div>
          <span style={zipChip(item.ativo ? "ok" : "bad")}>{item.ativo ? "Ativo" : "Desativado"}</span>
          <div className="zip-mono" style={{ fontSize: 10.5, color: "var(--soft)" }}>{new Date(item.updated_at).toLocaleString("pt-BR")}</div>
        </div>)}
      </div>
    </div>

    {modal && <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--overlay-bg-strong)", backdropFilter: "blur(3px)", padding: 20 }} className="zip-animate-fade-in">
      <div className="zip-animate-pop-in" style={{ width: 430, maxWidth: "100%", background: "var(--s0)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "var(--sh)", overflow: "hidden" }}>
        <div style={{ padding: "15px 18px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}><h2 style={{ fontSize: 16 }}>Criar acesso da equipe</h2><button onClick={() => !criando && setModal(false)} style={{ height: 28, width: 28, borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)" }}>✕</button></div>
        <form onSubmit={criar} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <div><label style={{ display: "block", fontSize: 10.5, fontWeight: 600, color: "var(--soft)", marginBottom: 4 }}>Nome</label><input style={fieldInput} value={nome} onChange={(e) => setNome(e.target.value)} required /></div>
          <div><label style={{ display: "block", fontSize: 10.5, fontWeight: 600, color: "var(--soft)", marginBottom: 4 }}>E-mail corporativo</label><input type="email" style={fieldInput} value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><label style={{ display: "block", fontSize: 10.5, fontWeight: 600, color: "var(--soft)", marginBottom: 4 }}>Cargo</label><select style={fieldInput} value={cargo} onChange={(e) => setCargo(e.target.value as Cargo)}>{CARGOS.map((o) => <option key={o.value} value={o.value}>{o.label} — {o.descricao}</option>)}</select></div>
          <div><label style={{ display: "block", fontSize: 10.5, fontWeight: 600, color: "var(--soft)", marginBottom: 4 }}>Senha temporária</label><input type="password" style={fieldInput} value={senha} onChange={(e) => setSenha(e.target.value)} minLength={12} required /><p style={{ marginTop: 4, fontSize: 10, color: "var(--soft)" }}>Mínimo de 12 caracteres.</p></div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}><button type="button" onClick={() => setModal(false)} disabled={criando} style={{ height: 34, padding: "0 13px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--soft)", fontSize: 12, fontWeight: 600 }}>Cancelar</button><button type="submit" disabled={criando} style={{ height: 34, padding: "0 15px", border: "1px solid var(--bg)", borderRadius: 9, background: "var(--bg)", color: "var(--on-accent)", fontSize: 12, fontWeight: 600 }}>{criando ? "Criando…" : "Criar acesso"}</button></div>
        </form>
      </div>
    </div>}

    {drawer && <>
      <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", zIndex: 60 }} onClick={() => setDrawer(null)} />
      <aside className="zip-animate-slide-in" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 61, width: "min(540px,100vw)", background: "var(--s0)", borderLeft: "1px solid var(--line)", boxShadow: "var(--sh)", overflowY: "auto" }}>
        <div style={{ padding: "14px 15px 12px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div><div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--rose)" }}>Equipe</div><h2 style={{ fontSize: 16, marginTop: 4 }}>{drawer.nome}</h2></div>
          <button onClick={() => setDrawer(null)} style={{ height: 28, width: 28, borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 13 }}>✕</button>
        </div>
        <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 8 }}>
          {[["E-mail", drawer.email], ["Cargo", CARGOS.find((c) => c.value === drawer.cargo)?.label ?? drawer.cargo], ["Acesso", resumoAcesso(drawer)], ["Status", drawer.ativo ? "Ativo" : "Desativado"], ["Cadastro atualizado", new Date(drawer.updated_at).toLocaleString("pt-BR")]].map(([l, v]) => <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>{l}</span><span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span></div>)}
          <div><label style={{ display: "block", fontSize: 10.5, fontWeight: 600, color: "var(--soft)", margin: "8px 0 4px" }}>Cargo</label><select style={fieldInput} value={drawer.cargo} disabled={salvando === drawer.id} onChange={(e) => void atualizar(drawer.id, { cargo: e.target.value as Cargo })}>{CARGOS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        </div>
        <div style={{ margin: "0 15px", borderTop: "1px solid var(--line)" }} />
        <div style={{ padding: "13px 15px" }}>
          <PermissoesColaborador cargo={drawer.cargo} permissoes={drawer.permissoes ?? []} podeEditar={souAdministrativo} salvando={salvando === drawer.id} onSalvar={(permissoes) => void atualizar(drawer.id, { permissoes })} />
        </div>
        <div style={{ padding: "0 15px 15px", display: "flex", justifyContent: "flex-end" }}>
          <button disabled={salvando === drawer.id} onClick={() => { const acao = drawer.ativo ? "desativar" : "ativar"; if (window.confirm(`Deseja ${acao} o acesso de ${drawer.nome}?`)) void atualizar(drawer.id, { ativo: !drawer.ativo }); }} style={{ height: 31, padding: "0 10px", border: `1px solid ${drawer.ativo ? "var(--bad)" : "var(--bg)"}`, borderRadius: 9, background: drawer.ativo ? "var(--badbg)" : "var(--bg)", color: drawer.ativo ? "var(--bad)" : "var(--on-accent)", fontSize: 10.5, fontWeight: 700 }}>{drawer.ativo ? "Desativar acesso" : "Ativar acesso"}</button>
        </div>
      </aside>
    </>}
  </div>;
}
