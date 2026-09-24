import { useEffect, useMemo, useState } from "react";
import { ABAS_PERMISSOES, MODELOS_CARGO, PERMISSOES_VALIDAS } from "@/lib/permissoesEquipe";

/**
 * Permissões de um colaborador: uma chave estilo iPhone por aba e por
 * funcionalidade (catálogo em src/lib/permissoesEquipe.ts). O que estiver
 * desligado some do painel da pessoa e é recusado pelo servidor.
 * Só o cargo Administrativo altera permissões (regra do Worker).
 */

export function ChaveIos({ ligada, onClick, desabilitada, rotulo }: { ligada: boolean; onClick?: () => void; desabilitada?: boolean; rotulo: string }) {
  return <button type="button" role="switch" aria-checked={ligada} aria-label={rotulo} disabled={desabilitada} onClick={onClick}
    style={{ position: "relative", flex: "none", width: 44, height: 26, borderRadius: 999, border: 0, padding: 0, cursor: desabilitada ? "default" : "pointer", background: ligada ? "var(--bg)" : "var(--s2)", boxShadow: ligada ? "none" : "inset 0 0 0 1px var(--line)", transition: "background .2s ease", opacity: desabilitada && !ligada ? .55 : 1 }}>
    <span style={{ position: "absolute", top: 2, left: ligada ? 20 : 2, width: 22, height: 22, borderRadius: 999, background: "#FFFFFF", boxShadow: "0 2px 5px rgba(0,0,0,.22)", transition: "left .2s cubic-bezier(.3,.7,.4,1)" }} />
  </button>;
}

export function PermissoesColaborador({ cargo, permissoes, podeEditar, salvando, onSalvar }: {
  cargo: string;
  permissoes: string[];
  podeEditar: boolean;
  salvando: boolean;
  onSalvar: (permissoes: string[]) => void;
}) {
  const acessoTotal = cargo === "administrativo";
  const inicial = useMemo(() => permissoes.filter((p) => PERMISSOES_VALIDAS.has(p)), [permissoes]);
  const [rascunho, setRascunho] = useState<string[]>(inicial);
  useEffect(() => { setRascunho(inicial); }, [inicial]);

  const ativas = new Set(acessoTotal ? ABAS_PERMISSOES.flatMap((a) => a.permissoes.map((p) => p.chave)) : rascunho);
  const alterado = !acessoTotal && JSON.stringify([...rascunho].sort()) !== JSON.stringify([...inicial].sort());
  const editavel = podeEditar && !acessoTotal && !salvando;
  const abasComAcesso = ABAS_PERMISSOES.filter((a) => a.permissoes.some((p) => ativas.has(p.chave)));
  const total = ABAS_PERMISSOES.reduce((n, a) => n + a.permissoes.length, 0);

  const alternar = (chave: string) => setRascunho((r) => (r.includes(chave) ? r.filter((x) => x !== chave) : [...r, chave]));
  const alternarAba = (chaves: string[], ligar: boolean) => setRascunho((r) => (ligar ? [...new Set([...r, ...chaves])] : r.filter((x) => !chaves.includes(x))));

  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--rose)" }}>Permissões de acesso</div>
      <span style={{ fontSize: 10.5, color: "var(--soft)" }}>{acessoTotal ? "Acesso total" : `${ativas.size} de ${total} ligadas`}</span>
    </div>
    <div style={{ fontSize: 10.5, color: "var(--soft)", lineHeight: 1.5 }}>
      {acessoTotal ? "O cargo Administrativo acessa todo o painel. Para limitar, mude o cargo e ligue só o necessário."
        : abasComAcesso.length ? <>Acessa: <strong style={{ color: "var(--ink)" }}>{abasComAcesso.map((a) => a.nome).join(", ")}</strong>. O resto do painel fica oculto e bloqueado.</>
          : "Sem nenhuma permissão ligada, esta pessoa não entra no painel administrativo."}
    </div>

    {editavel && <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
      <span style={{ fontSize: 10, color: "var(--soft)", marginRight: 2 }}>Começar pelo modelo:</span>
      {(["financeiro", "vendedora", "sdr", "gestao"] as const).map((m) => <button key={m} type="button" title={MODELOS_CARGO[m].descricao} onClick={() => setRascunho([...MODELOS_CARGO[m].permissoes])}
        style={{ height: 24, padding: "0 9px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--s1)", color: "var(--ink)", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>{MODELOS_CARGO[m].nome}</button>)}
      <button type="button" onClick={() => setRascunho([])} style={{ height: 24, padding: "0 9px", borderRadius: 999, border: 0, background: "transparent", color: "var(--soft)", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Desligar tudo</button>
    </div>}
    {!podeEditar && !acessoTotal && <div style={{ fontSize: 10, color: "var(--gold)" }}>Somente o cargo Administrativo altera permissões.</div>}

    {ABAS_PERMISSOES.map((aba) => {
      const chaves = aba.permissoes.map((p) => p.chave);
      const ligadas = chaves.filter((c) => ativas.has(c)).length;
      const verChave = aba.permissoes.find((p) => p.tipo === "ver")?.chave;
      const soPorAcao = verChave && !ativas.has(verChave) && ligadas > 0;
      return <section key={aba.id} style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", background: "var(--s0)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 11px", background: "var(--s1)", borderBottom: "1px solid var(--line2)" }}>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 700 }}>{aba.nome}</div><div style={{ fontSize: 9.5, color: "var(--soft)" }}>{aba.descricao}</div></div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 9.5, color: "var(--soft)" }}>{ligadas}/{chaves.length}</span>
            <ChaveIos rotulo={`Aba ${aba.nome}`} ligada={ligadas === chaves.length} desabilitada={!editavel} onClick={() => alternarAba(chaves, ligadas !== chaves.length)} />
          </div>
        </div>
        {aba.permissoes.map((p) => <div key={p.chave} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 11px", borderTop: "1px solid var(--line2)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600 }}>{p.nome}{p.tipo === "ver" && <span style={{ marginLeft: 6, fontSize: 8.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--soft)" }}>leitura</span>}</div>
            <div style={{ fontSize: 10, color: "var(--soft)", lineHeight: 1.4 }}>{p.descricao}</div>
          </div>
          <ChaveIos rotulo={p.nome} ligada={ativas.has(p.chave)} desabilitada={!editavel} onClick={() => alternar(p.chave)} />
        </div>)}
        {soPorAcao && <div style={{ padding: "6px 11px 8px", fontSize: 9.5, color: "var(--soft)" }}>Com uma ação ligada, a aba já aparece para leitura.</div>}
      </section>;
    })}

    {editavel && <div style={{ position: "sticky", bottom: 0, display: "flex", justifyContent: "flex-end", gap: 7, padding: "10px 0 2px", background: "linear-gradient(transparent, var(--s0) 30%)" }}>
      <button type="button" disabled={!alterado} onClick={() => setRascunho(inicial)} style={{ height: 32, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--soft)", fontSize: 11, fontWeight: 700 }}>Descartar</button>
      <button type="button" disabled={!alterado || salvando} onClick={() => onSalvar(rascunho)} style={{ height: 32, padding: "0 14px", border: "1px solid var(--bg)", borderRadius: 9, background: "var(--bg)", color: "var(--on-accent)", fontSize: 11, fontWeight: 700, opacity: alterado ? 1 : .55 }}>{salvando ? "Salvando..." : "Salvar permissões"}</button>
    </div>}
  </div>;
}
