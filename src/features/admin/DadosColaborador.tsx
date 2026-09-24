import { useEffect, useState } from "react";

/**
 * Dados e acesso do colaborador (Configurações > Equipe): nome, e-mail de
 * login, cargo e redefinição de senha. E-mail, senha e cargo só pelo cargo
 * Administrativo (regra do Worker e da função admin_salvar_colaborador_auditado).
 */
type Cargo = "vendedora" | "sdr" | "financeiro" | "gestao" | "administrativo";
type Dados = { id: string; nome: string; email: string; cargo: Cargo; ativo: boolean; updated_at: string };

const campo: React.CSSProperties = { height: 34, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", padding: "0 10px", fontSize: 11.5, width: "100%", fontWeight: 400 };
const rotulo: React.CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "var(--soft)", marginBottom: 4 };
const botao: React.CSSProperties = { height: 31, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", fontSize: 10.5, fontWeight: 700 };
const botaoPrincipal: React.CSSProperties = { ...botao, border: "1px solid var(--bg)", background: "var(--bg)", color: "var(--on-accent)" };

export function DadosColaborador({ colaborador, cargos, resumoAcesso, souAdministrativo, salvando, onSalvar }: {
  colaborador: Dados;
  cargos: { value: Cargo; label: string }[];
  resumoAcesso: string;
  souAdministrativo: boolean;
  salvando: boolean;
  onSalvar: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(colaborador.nome);
  const [email, setEmail] = useState(colaborador.email);
  const [cargo, setCargo] = useState<Cargo>(colaborador.cargo);
  const [senhaAberta, setSenhaAberta] = useState(false);
  const [senha, setSenha] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => { setEditando(false); setNome(colaborador.nome); setEmail(colaborador.email); setCargo(colaborador.cargo); setSenhaAberta(false); setSenha(""); setAviso(null); }, [colaborador.id, colaborador.nome, colaborador.email, colaborador.cargo]);

  async function salvarDados() {
    const patch: Record<string, unknown> = {};
    if (nome.trim() !== colaborador.nome) patch.nome = nome.trim();
    if (souAdministrativo && email.trim().toLowerCase() !== colaborador.email) patch.email = email.trim().toLowerCase();
    if (souAdministrativo && cargo !== colaborador.cargo) patch.cargo = cargo;
    if (!Object.keys(patch).length) { setEditando(false); return; }
    if (await onSalvar(patch)) { setEditando(false); setAviso("Dados atualizados."); }
  }

  async function redefinirSenha() {
    if (senha.length < 12) { setAviso("A senha temporária deve ter ao menos 12 caracteres."); return; }
    if (await onSalvar({ senhaTemporaria: senha })) { setSenha(""); setSenhaAberta(false); setAviso("Senha redefinida. Envie a nova senha temporária para a pessoa."); }
  }

  return <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--rose)" }}>Dados e acesso</div>
      {!editando && <button type="button" onClick={() => { setEditando(true); setAviso(null); }} style={botao}>Editar dados</button>}
    </div>

    {!editando ? <>
      {[["Nome", colaborador.nome], ["E-mail de login", colaborador.email], ["Cargo", cargos.find((c) => c.value === colaborador.cargo)?.label ?? colaborador.cargo], ["Acesso ao painel", resumoAcesso], ["Status", colaborador.ativo ? "Ativo" : "Desativado"], ["Atualizado", new Date(colaborador.updated_at).toLocaleString("pt-BR")]].map(([l, v]) =>
        <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}><span style={{ color: "var(--soft)" }}>{l}</span><span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span></div>)}
    </> : <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 11, border: "1px solid var(--line)", borderRadius: 12, background: "var(--s1)" }}>
      <label style={rotulo}>Nome<input style={{ ...campo, marginTop: 4 }} value={nome} maxLength={200} onChange={(e) => setNome(e.target.value)} /></label>
      <label style={rotulo}>E-mail de login<input type="email" style={{ ...campo, marginTop: 4 }} value={email} disabled={!souAdministrativo} onChange={(e) => setEmail(e.target.value)} /></label>
      <label style={rotulo}>Cargo<select style={{ ...campo, marginTop: 4 }} value={cargo} disabled={!souAdministrativo} onChange={(e) => setCargo(e.target.value as Cargo)}>{cargos.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      {!souAdministrativo && <span style={{ fontSize: 10, color: "var(--gold)" }}>E-mail e cargo só o cargo Administrativo altera.</span>}
      <span style={{ fontSize: 10, color: "var(--soft)" }}>Trocar o e-mail muda o login da pessoa no mesmo instante.</span>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}>
        <button type="button" onClick={() => { setEditando(false); setNome(colaborador.nome); setEmail(colaborador.email); setCargo(colaborador.cargo); }} disabled={salvando} style={{ ...botao, color: "var(--soft)" }}>Cancelar</button>
        <button type="button" onClick={() => void salvarDados()} disabled={salvando || !nome.trim()} style={botaoPrincipal}>{salvando ? "Salvando..." : "Salvar dados"}</button>
      </div>
    </div>}

    {souAdministrativo && <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "9px 11px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div><div style={{ fontSize: 11.5, fontWeight: 700 }}>Senha de acesso</div><div style={{ fontSize: 10, color: "var(--soft)" }}>Defina uma senha temporária nova; a antiga deixa de funcionar.</div></div>
        {!senhaAberta && <button type="button" onClick={() => setSenhaAberta(true)} style={botao}>Redefinir senha</button>}
      </div>
      {senhaAberta && <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
        <input type="password" autoComplete="new-password" placeholder="Nova senha (mínimo 12 caracteres)" style={campo} value={senha} onChange={(e) => setSenha(e.target.value)} />
        <button type="button" onClick={() => { setSenhaAberta(false); setSenha(""); }} style={{ ...botao, color: "var(--soft)" }}>Cancelar</button>
        <button type="button" onClick={() => void redefinirSenha()} disabled={salvando || senha.length < 12} style={botaoPrincipal}>Salvar</button>
      </div>}
    </div>}

    {aviso && <div style={{ fontSize: 10.5, color: aviso.includes("ao menos") ? "var(--bad)" : "var(--ok)" }}>{aviso}</div>}
  </div>;
}
