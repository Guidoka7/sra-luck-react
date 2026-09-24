import { useEffect, useMemo, useState } from "react";
import { zipChip } from "@/components/admin-zip/zipUi";

/**
 * Configurações > Notificações > "Avisos da jornada": textos e liga/desliga
 * dos avisos disparados pelo banco (agenda, pagamentos, jornada, Clube).
 * Fonte dos padrões: worker/notificacao-eventos-padrao.ts; gravação:
 * PATCH /api/admin/notificacoes/eventos (tabela notificacao_eventos, migration_093).
 */

export type EventoAviso = { chave: string; categoria: string; nome: string; quando: string; destino: string; titulo: string; corpo: string; emoji: string | null; variaveis: string[]; is_active: boolean; updated_at?: string };
type Edicao = { titulo: string; corpo: string; emoji: string };

const fieldInput: React.CSSProperties = { height: 33, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", padding: "0 9px", fontSize: 11, fontWeight: 400 };
const rotulo: React.CSSProperties = { fontSize: 8.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" };
const botao: React.CSSProperties = { height: 30, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" };
const botaoPrincipal: React.CSSProperties = { ...botao, border: "1px solid var(--bg)", background: "var(--bg)", color: "var(--on-accent)" };
const ORDEM = ["pagamentos", "jornada", "agenda", "clube"];

// Exemplo usado só na pré-visualização (nunca é enviado).
const EXEMPLO: Record<string, string> = { nome: "Maria", parcela: "3", total: "12", motivo: " Motivo: imagem ilegível.", data: "15/01/2027", horario: " às 14h", pontos: "50", beneficio: "voucher de consulta", indicada: "Ana", recompensa: "Kit Giovanna Baby" };
const renderizar = (texto: string) => texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => EXEMPLO[k] ?? m);
const edicaoDe = (e: EventoAviso): Edicao => ({ titulo: e.titulo, corpo: e.corpo, emoji: e.emoji || "🔔" });

export function AvisosJornada({ eventos, padroes, categorias, onAtualizado, onFeedback }: {
  eventos: EventoAviso[] | null;
  padroes: EventoAviso[];
  categorias: Record<string, string>;
  onAtualizado: (evento: EventoAviso) => void;
  onFeedback: (f: { type: "ok" | "error"; text: string }) => void;
}) {
  const [busca, setBusca] = useState("");
  const [chave, setChave] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edicao>({ titulo: "", corpo: "", emoji: "" });
  const [salvando, setSalvando] = useState(false);

  const lista = eventos ?? [];
  const selecionado = lista.find((e) => e.chave === chave) ?? null;
  const padrao = selecionado ? padroes.find((p) => p.chave === selecionado.chave) : undefined;
  const alterado = selecionado ? JSON.stringify(edicaoDe(selecionado)) !== JSON.stringify(edit) : false;
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lista.filter((e) => !q || [e.nome, e.quando, e.titulo, e.corpo].join(" ").toLowerCase().includes(q));
  }, [lista, busca]);

  useEffect(() => { if (!chave && lista.length) { setChave(lista[0].chave); setEdit(edicaoDe(lista[0])); } }, [lista, chave]);

  function selecionar(e: EventoAviso) {
    if (alterado && !window.confirm("Descartar as alterações deste aviso?")) return;
    setChave(e.chave); setEdit(edicaoDe(e));
  }

  async function salvar(e: EventoAviso, patch: Record<string, unknown>, aviso: string) {
    const res = await fetch("/api/admin/notificacoes/eventos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chave: e.chave, ...patch }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || "Falha ao salvar o aviso.");
    onAtualizado(data.evento);
    onFeedback({ type: "ok", text: aviso });
    return data.evento as EventoAviso;
  }

  async function alternar(e: EventoAviso) {
    try { await salvar(e, { is_active: !e.is_active }, e.is_active ? `"${e.nome}" desligado: a cliente deixa de receber este aviso.` : `"${e.nome}" ligado.`); }
    catch (err: any) { onFeedback({ type: "error", text: err.message }); }
  }

  async function salvarTexto() {
    if (!selecionado) return;
    setSalvando(true);
    try { const novo = await salvar(selecionado, edit, `Texto de "${selecionado.nome}" salvo.`); setEdit(edicaoDe(novo)); }
    catch (err: any) { onFeedback({ type: "error", text: err.message }); }
    finally { setSalvando(false); }
  }

  if (eventos === null) return <div style={{ padding: 28, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Os avisos da jornada ainda não estão disponíveis neste ambiente (migration_093).</div>;

  return <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,.9fr) minmax(360px,1.1fr)" }}>
    <div style={{ borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ fontSize: 10.5, color: "var(--soft)", lineHeight: 1.45 }}>Enviados sozinhos quando algo muda na jornada da cliente: pagamento, agenda, liberação e Clube. Cada aviso sai uma vez só.</div>
        <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 7, height: 30, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", padding: "0 10px" }}><span style={{ color: "var(--soft)", fontSize: 11 }}>⌕</span><input value={busca} onChange={(ev) => setBusca(ev.target.value)} placeholder="Buscar aviso..." style={{ flex: 1, border: 0, outline: 0, background: "transparent", color: "var(--ink)", fontSize: 11 }} /></div>
      </div>
      <div style={{ overflowY: "auto", maxHeight: 560 }}>
        {ORDEM.map((cat) => {
          const itens = filtrados.filter((e) => e.categoria === cat);
          if (!itens.length) return null;
          return <div key={cat}>
            <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "space-between", padding: "8px 14px 6px", background: "var(--s1)", borderBottom: "1px solid var(--line2)" }}>
              <span style={rotulo}>{categorias[cat] ?? cat}</span><span style={{ fontSize: 9.5, color: "var(--soft)" }}>{itens.filter((e) => e.is_active).length}/{itens.length} ligados</span>
            </div>
            {itens.map((e) => <div key={e.chave} onClick={() => selecionar(e)} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 36px", gap: 8, alignItems: "center", padding: "7px 14px", borderBottom: "1px solid var(--line2)", cursor: "pointer", background: e.chave === chave ? "var(--robg)" : undefined, opacity: e.is_active ? 1 : .55 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.emoji} {e.nome}</div>
                <div style={{ fontSize: 10, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.quando}</div>
              </div>
              <button aria-label={e.is_active ? `Desligar ${e.nome}` : `Ligar ${e.nome}`} onClick={(ev) => { ev.stopPropagation(); void alternar(e); }} style={{ height: 20, width: 34, borderRadius: 999, border: `1px solid ${e.is_active ? "var(--bg)" : "var(--line)"}`, background: e.is_active ? "var(--bg)" : "var(--s2)", padding: 2, display: "flex", justifyContent: e.is_active ? "flex-end" : "flex-start" }}><span style={{ width: 14, height: 14, borderRadius: 999, background: "var(--s0)" }} /></button>
            </div>)}
          </div>;
        })}
      </div>
    </div>

    <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      {!selecionado ? <div style={{ padding: 30, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Selecione um aviso para editar.</div> : <>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div><div style={rotulo}>{categorias[selecionado.categoria] ?? selecionado.categoria}</div><h2 style={{ fontSize: 16, marginTop: 3 }}>{selecionado.nome}</h2><div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Quando: {selecionado.quando.charAt(0).toLowerCase() + selecionado.quando.slice(1)}.</div></div>
          <span style={zipChip(selecionado.is_active ? "ok" : "neutral")}>{selecionado.is_active ? "Ligado" : "Desligado"}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 64px", gap: 8 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: "var(--soft)" }}>Título <span style={{ fontWeight: 500 }}>({edit.titulo.length}/80)</span>
            <input maxLength={80} style={{ ...fieldInput, width: "100%", marginTop: 4 }} value={edit.titulo} onChange={(ev) => setEdit({ ...edit, titulo: ev.target.value })} /></label>
          <label style={{ fontSize: 10, fontWeight: 700, color: "var(--soft)" }}>Ícone
            <input maxLength={4} style={{ ...fieldInput, width: "100%", marginTop: 4, textAlign: "center" }} value={edit.emoji} onChange={(ev) => setEdit({ ...edit, emoji: ev.target.value })} /></label>
        </div>
        <label style={{ fontSize: 10, fontWeight: 700, color: "var(--soft)" }}>Mensagem <span style={{ fontWeight: 500 }}>({edit.corpo.length}/300)</span>
          <textarea maxLength={300} rows={4} style={{ ...fieldInput, width: "100%", height: "auto", padding: 9, marginTop: 4, lineHeight: 1.45, resize: "vertical" }} value={edit.corpo} onChange={(ev) => setEdit({ ...edit, corpo: ev.target.value })} /></label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {selecionado.variaveis.map((v) => <button key={v} type="button" onClick={() => setEdit((x) => ({ ...x, corpo: `${x.corpo}${x.corpo.endsWith(" ") || !x.corpo ? "" : " "}{{${v}}}` }))} style={{ fontFamily: "var(--mono, monospace)", fontSize: 9.5, padding: "3px 7px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--s1)", color: "var(--bg)" }}>{`{{${v}}}`}</button>)}
        </div>
        <div>
          <div style={{ ...rotulo, marginBottom: 6 }}>Como a cliente vê</div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 16, background: "var(--s1)", border: "1px solid var(--line)" }}>
            <div style={{ width: 34, height: 34, flex: "none", borderRadius: 9, display: "grid", placeItems: "center", background: "linear-gradient(145deg,#B0526A,#7A2632)", color: "#fff", fontSize: 16 }}>{edit.emoji || "🔔"}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 9.5, color: "var(--soft)" }}><span style={{ fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>Sra. Luck</span><span>agora</span></div>
              <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700 }}>{renderizar(edit.titulo)}</div>
              <div style={{ marginTop: 1, fontSize: 11.5, lineHeight: 1.4 }}>{renderizar(edit.corpo)}</div>
            </div>
          </div>
          <div style={{ marginTop: 5, fontSize: 9.5, color: "var(--soft)" }}>Exemplo com dados fictícios. Variáveis vazias somem do texto.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 7, marginTop: 2 }}>
          <button onClick={() => padrao && setEdit({ titulo: padrao.titulo, corpo: padrao.corpo, emoji: padrao.emoji || "🔔" })} disabled={!padrao} style={{ ...botao, color: "var(--soft)" }}>Restaurar texto padrão</button>
          <div style={{ display: "flex", gap: 7 }}>
            <button onClick={() => setEdit(edicaoDe(selecionado))} disabled={!alterado} style={{ ...botao, color: "var(--soft)" }}>Descartar</button>
            <button onClick={() => void salvarTexto()} disabled={!alterado || salvando} style={{ ...botaoPrincipal, opacity: !alterado ? .55 : 1 }}>{salvando ? "Salvando..." : "Salvar texto"}</button>
          </div>
        </div>
      </>}
    </div>
  </div>;
}
