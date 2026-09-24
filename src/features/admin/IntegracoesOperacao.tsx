"use client";

/**
 * Operação das integrações configuráveis no Admin:
 * - FormularioFuncao: formulário genérico a partir do catálogo (/api/admin/integrations/catalogo);
 * - CrmOperacao: importar agora, histórico de importações e revisão de duplicidades;
 * - ContaAzulOperacao: conexão OAuth, sincronizar, conflitos, fila, vínculos e envio por cliente.
 * Nada aqui mostra segredos; credenciais seguem no formulário de credenciais do cofre.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { zipChip, type ZipKind } from "@/components/admin-zip/zipUi";

type Json = Record<string, any>;
type Campo = {
  chave: string; rotulo: string; tipo: "booleano" | "numero" | "texto" | "texto_longo" | "selecao" | "multi_selecao" | "mapeamento" | "grupo_booleano";
  ajuda?: string; placeholder?: string; min?: number; max?: number; passo?: number; maxLength?: number;
  opcoes?: { valor: string; rotulo: string }[]; opcoesDe?: "rd_funis" | "rd_etapas" | "rd_campos" | "ca_contas" | "ca_categorias"; itens?: { chave: string; rotulo: string }[];
};

const input: React.CSSProperties = { height: 31, border: "1px solid var(--line)", borderRadius: 8, background: "var(--s0)", color: "var(--ink)", padding: "0 8px", fontSize: 10.5, width: "100%" };
const btn: React.CSSProperties = { height: 30, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--bg)", fontSize: 10.5, fontWeight: 700 };
const btnPrim: React.CSSProperties = { ...btn, background: "var(--bg)", color: "var(--on-accent)", borderColor: "var(--bg)" };
const titulo: React.CSSProperties = { fontSize: 8.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--rose)", margin: "14px 0 8px" };
const caixa: React.CSSProperties = { border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 9, padding: "8px 9px", fontSize: 10.5 };
const muted: React.CSSProperties = { color: "var(--soft)", fontSize: 10 };

async function api(url: string, init?: { method?: string; body?: unknown }) {
  const r = await fetch(url, { method: init?.method ?? "GET", cache: "no-store", credentials: "same-origin", headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined, body: init?.body !== undefined ? JSON.stringify(init.body) : init?.method === "POST" ? "{}" : undefined });
  const corpo = await r.json().catch(() => ({})) as Json;
  if (!r.ok) throw new Error(String(corpo.erro ?? `Falha (HTTP ${r.status}).`));
  return corpo;
}
/** Chip alinhado à direita: em grade não estica a coluna inteira. */
const chip = (k: ZipKind): React.CSSProperties => ({ ...zipChip(k), justifySelf: "end", alignSelf: "start" });
const dataHora = (v?: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");

function Aviso({ texto, tipo }: { texto: string | null; tipo: "ok" | "bad" }) {
  if (!texto) return null;
  return <div style={{ marginTop: 8, borderRadius: 9, padding: "7px 9px", fontSize: 10.5, background: tipo === "ok" ? "var(--okbg)" : "var(--badbg)", color: tipo === "ok" ? "var(--ok)" : "var(--bad)" }}>{texto}</div>;
}

// ------------------------------------------------------------------ formulário genérico por função

export function FormularioFuncao({ provedor, funcao }: { provedor: string; funcao: string }) {
  const [fn, setFn] = useState<Json | null>(null);
  const [valores, setValores] = useState<Json>({});
  const [opcoes, setOpcoes] = useState<Json | null>(null);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const c = await api("/api/admin/integrations/catalogo");
      const f = (c.integracoes ?? []).find((i: Json) => i.id === provedor)?.funcoes?.find((x: Json) => x.id === funcao) ?? null;
      setFn(f); setValores(f?.config ?? {});
    } catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
  }, [provedor, funcao]);
  useEffect(() => { void carregar(); }, [carregar]);

  const precisa = (fn?.campos ?? []).some((c: Campo) => c.opcoesDe);
  useEffect(() => {
    if (!precisa || opcoes) return;
    const url = provedor === "rd_station" ? "/api/admin/integrations/rd-station/opcoes" : "/api/admin/integrations/conta-azul/opcoes";
    api(url).then(setOpcoes).catch((e) => setOpcoes({ erro: (e as Error).message }));
  }, [precisa, opcoes, provedor]);

  const listaDe = (c: Campo): { valor: string; rotulo: string }[] => {
    if (c.opcoes) return c.opcoes;
    if (!opcoes || opcoes.erro) return [];
    if (c.opcoesDe === "rd_funis") return (opcoes.funis ?? []).map((f: Json) => ({ valor: f.id, rotulo: f.nome }));
    if (c.opcoesDe === "rd_etapas") return ((opcoes.funis ?? []).find((f: Json) => f.id === valores.pipelineId)?.etapas ?? []).map((e: Json) => ({ valor: e.id, rotulo: e.nome }));
    if (c.opcoesDe === "ca_contas") return (opcoes.contas ?? []).map((x: Json) => ({ valor: x.id, rotulo: `${x.nome}${x.tipo ? ` (${String(x.tipo).toLowerCase()})` : ""}` }));
    if (c.opcoesDe === "ca_categorias") return (opcoes.categorias ?? []).map((x: Json) => ({ valor: x.id, rotulo: x.nome }));
    return [];
  };
  const fontesMapeamento = useMemo(() => [
    { valor: "auto", rotulo: "Automático" }, { valor: "ignorar", rotulo: "Não importar" },
    ...((opcoes?.campos ?? []) as Json[]).map((c) => ({ valor: `${c.entidade}:${c.slug}`, rotulo: `${c.entidade === "deal" ? "Negociação" : "Contato"}: ${c.nome}` })),
  ], [opcoes]);

  async function salvar() {
    setSalvando(true); setMsg(null);
    try {
      const r = await api("/api/admin/integrations/config", { method: "POST", body: { provedor, funcao, config: valores, versao: fn?.versao ?? 0 } });
      setMsg({ t: `Configuração salva (versão ${r.versao}).`, ok: true }); await carregar();
    } catch (e) { setMsg({ t: (e as Error).message, ok: false }); } finally { setSalvando(false); }
  }

  if (!fn) return <div style={muted}>{msg?.t ?? "Carregando configuração…"}</div>;
  const set = (k: string, v: unknown) => setValores((a) => ({ ...a, [k]: v }));
  return <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
    {opcoes?.erro && <div style={{ ...caixa, color: "var(--gold)" }}>Listas do provedor indisponíveis: {opcoes.erro}</div>}
    {(fn.campos as Campo[]).map((c) => <label key={c.chave} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, fontWeight: 600 }}>
      {c.tipo === "booleano"
        ? <span style={{ display: "flex", alignItems: "center", gap: 7 }}><input type="checkbox" checked={Boolean(valores[c.chave])} onChange={(e) => set(c.chave, e.target.checked)} />{c.rotulo}</span>
        : <span>{c.rotulo}</span>}
      {c.tipo === "numero" && <input style={input} type="number" min={c.min} max={c.max} step={c.passo} placeholder={c.placeholder} value={valores[c.chave] ?? ""} onChange={(e) => set(c.chave, e.target.value === "" ? null : Number(e.target.value))} />}
      {c.tipo === "texto" && <input style={input} maxLength={c.maxLength} placeholder={c.placeholder} value={valores[c.chave] ?? ""} onChange={(e) => set(c.chave, e.target.value || null)} />}
      {c.tipo === "texto_longo" && <textarea style={{ ...input, height: 64, padding: 8 }} maxLength={c.maxLength} value={valores[c.chave] ?? ""} onChange={(e) => set(c.chave, e.target.value || null)} />}
      {c.tipo === "selecao" && <select style={input} value={valores[c.chave] == null ? "" : String(valores[c.chave])} onChange={(e) => set(c.chave, e.target.value === "" ? null : c.chave === "frequenciaMinutos" ? Number(e.target.value) : e.target.value)}>
        {!c.opcoes && <option value="">—</option>}
        {listaDe(c).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>}
      {c.tipo === "multi_selecao" && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {listaDe(c).length === 0 ? <span style={muted}>{valores.pipelineId ? "Sem etapas." : "Escolha o funil primeiro."}</span> : listaDe(c).map((o) => {
          const lista: string[] = Array.isArray(valores[c.chave]) ? valores[c.chave] : [];
          return <span key={o.valor} style={{ display: "inline-flex", gap: 4, alignItems: "center", fontWeight: 500 }}><input type="checkbox" checked={lista.includes(o.valor)} onChange={(e) => set(c.chave, e.target.checked ? [...lista, o.valor] : lista.filter((x) => x !== o.valor))} />{o.rotulo}</span>;
        })}
      </div>}
      {c.tipo === "mapeamento" && <div style={{ display: "grid", gridTemplateColumns: "minmax(110px,1fr) 1.4fr", gap: 5, alignItems: "center", fontWeight: 500 }}>
        {(c.itens ?? []).map((it) => <FragmentoLinha key={it.chave} rotulo={it.rotulo} valor={valores[c.chave]?.[it.chave] ?? "auto"} opcoes={fontesMapeamento} onChange={(v) => set(c.chave, { ...(valores[c.chave] ?? {}), [it.chave]: v })} />)}
      </div>}
      {c.tipo === "grupo_booleano" && <div style={{ display: "flex", gap: 12, fontWeight: 500 }}>{(c.itens ?? []).map((it) => <span key={it.chave} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={valores[c.chave]?.[it.chave] !== false} onChange={(e) => set(c.chave, { ...(valores[c.chave] ?? {}), [it.chave]: e.target.checked })} />{it.rotulo}</span>)}</div>}
      {c.ajuda && <span style={{ ...muted, fontWeight: 400 }}>{c.ajuda}</span>}
    </label>)}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={muted}>{fn.versao ? `Versão ${fn.versao} · ${dataHora(fn.atualizadoEm)}` : "Sem configuração salva: valem os padrões."}</span>
      <button style={btnPrim} disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar configuração"}</button>
    </div>
    <Aviso texto={msg?.t ?? null} tipo={msg?.ok ? "ok" : "bad"} />
  </div>;
}

function FragmentoLinha({ rotulo, valor, opcoes, onChange }: { rotulo: string; valor: string; opcoes: { valor: string; rotulo: string }[]; onChange: (v: string) => void }) {
  const lista = opcoes.some((o) => o.valor === valor) ? opcoes : [...opcoes, { valor, rotulo: valor }];
  return <>
    <span>{rotulo}</span>
    <select style={input} value={valor} onChange={(e) => onChange(e.target.value)}>{lista.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}</select>
  </>;
}

// ------------------------------------------------------------------ CRM

const RESULTADO: Record<string, [string, ZipKind]> = {
  criada: ["Aguardando cadastro", "ok"], atualizada: ["Snapshot atualizado", "neutral"], duplicada: ["Duplicada", "warn"],
  cliente_existente: ["Cliente já existe", "warn"], ignorada: ["Ignorada", "neutral"], erro: ["Erro", "bad"], importada_apos_revisao: ["Importada após revisão", "blue"],
};

function ItemImportacao({ it, onAcao }: { it: Json; onAcao?: (id: string, acao: "importar" | "descartar") => void }) {
  const [r, k] = RESULTADO[it.resultado] ?? [it.resultado, "neutral"];
  return <div style={{ ...caixa, display: "flex", flexDirection: "column", gap: 4 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{it.dados?.nome ?? it.externalId}</strong><span style={chip(k)}>{r}</span></div>
    <span style={muted}>{[it.dados?.cpf, it.dados?.telefone, it.dados?.email].filter(Boolean).join(" · ") || "Sem contato"}{it.motivo ? ` — ${it.motivo}` : ""}</span>
    {(it.correspondencias ?? []).map((c: Json) => <span key={`${c.tipo}${c.id}`} style={muted}>↳ {c.tipo === "cliente" ? "Cliente" : "Venda pendente"} {c.nome ?? c.id} (mesmo {c.por.join(", ")})</span>)}
    {onAcao && !it.revisadoEm && ["duplicada", "cliente_existente"].includes(it.resultado) && <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
      <button style={btn} onClick={() => onAcao(it.id, "descartar")}>É a mesma pessoa</button>
      <button style={btnPrim} onClick={() => onAcao(it.id, "importar")}>Importar mesmo assim</button>
    </div>}
  </div>;
}

/** modo "equipe": só importar e revisar (a configuração da importação é do Dev). */
export function CrmOperacao({ modo = "completo" }: { modo?: "completo" | "equipe" } = {}) {
  const [imps, setImps] = useState<Json | null>(null);
  const [revisao, setRevisao] = useState<Json[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [itens, setItens] = useState<Json[]>([]);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([api("/api/admin/integrations/rd-station/importacoes"), api("/api/admin/integrations/rd-station/importacoes/revisao")]);
      setImps(a); setRevisao(b.itens ?? []);
    } catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function importar() {
    setOcupado(true); setMsg(null);
    try {
      const r = await api("/api/admin/integrations/rd-station/importar", { method: "POST" });
      setMsg({ t: `RD: ${r.totalRd} negociação(ões) · ${r.criadas} nova(s) em Aguardando cadastro · ${r.duplicadas + r.clienteExistente} para revisar · ${r.ignoradas} ignorada(s)${r.erros ? ` · ${r.erros} erro(s)` : ""}.`, ok: !r.erros });
      await carregar();
    } catch (e) { setMsg({ t: (e as Error).message, ok: false }); } finally { setOcupado(false); }
  }
  async function abrir(id: string) {
    if (aberta === id) { setAberta(null); return; }
    setAberta(id); setItens([]);
    try { setItens((await api(`/api/admin/integrations/rd-station/importacoes/${id}/itens`)).itens ?? []); } catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
  }
  async function revisar(id: string, acao: "importar" | "descartar") {
    try { await api(`/api/admin/integrations/rd-station/importacoes/itens/${id}/${acao}`, { method: "POST" }); setMsg({ t: acao === "importar" ? "Venda criada em Aguardando cadastro." : "Marcada como a mesma pessoa; nada foi criado.", ok: true }); await carregar(); }
    catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
  }

  return <div>
    {modo === "completo" && <><div style={titulo}>Importação configurável</div>
    <FormularioFuncao provedor="rd_station" funcao="importacao" /></>}
    <div style={titulo}>Importar e revisar</div>
    <div style={{ ...caixa, lineHeight: 1.5 }}>Toda cliente nova entra em <strong>Aguardando cadastro</strong>. A importação nunca cria cliente nem encaminha ao Financeiro; a venda só avança quando a cliente tem parcelas e acesso ao app liberado.</div>
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}><button style={btnPrim} disabled={ocupado} onClick={() => void importar()}>{ocupado ? "Importando…" : "Importar agora"}</button></div>
    <Aviso texto={msg?.t ?? null} tipo={msg?.ok ? "ok" : "bad"} />
    {revisao.length > 0 && <><div style={titulo}>Aguardando revisão ({revisao.length})</div><div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{revisao.map((it) => <ItemImportacao key={it.id} it={it} onAcao={(id, a) => void revisar(id, a)} />)}</div></>}
    <div style={titulo}>Histórico de importações</div>
    {imps && !imps.disponivel && <div style={{ ...caixa, color: "var(--gold)" }}>Estrutura de histórico ainda não aplicada (migration_091).</div>}
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {(imps?.importacoes ?? []).map((i: Json) => <div key={i.id}>
        <button onClick={() => void abrir(i.id)} style={{ ...caixa, width: "100%", textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span><strong>{dataHora(i.iniciado_em)}</strong> · {i.origem}<br /><span style={muted}>{i.totais?.totalRd ?? 0} lida(s) · {i.totais?.criadas ?? 0} nova(s) · {(i.totais?.duplicadas ?? 0) + (i.totais?.clienteExistente ?? 0)} duplicidade(s){i.erro ? ` · ${i.erro}` : ""}</span></span>
          <span style={chip(i.status === "concluida" ? "ok" : i.status === "erro" ? "bad" : "warn")}>{i.status}</span>
        </button>
        {aberta === i.id && <div style={{ display: "flex", flexDirection: "column", gap: 5, margin: "6px 0 4px 10px" }}>{itens.length ? itens.map((it) => <ItemImportacao key={it.id} it={it} />) : <span style={muted}>Sem itens (negociações só atualizadas não aparecem).</span>}</div>}
      </div>)}
      {imps?.disponivel && !(imps.importacoes ?? []).length && <span style={muted}>Nenhuma importação ainda.</span>}
    </div>
  </div>;
}

// ------------------------------------------------------------------ Conta Azul

const ACOES: Record<string, { rotulo: string; acoes: [string, string][] }> = {
  alterada_na_conta_azul: { rotulo: "Alterada na Conta Azul", acoes: [["aplicar_sra", "Reaplicar valores do Sra Luck"], ["manter", "Manter como está"]] },
  alterada_nos_dois_lados: { rotulo: "Alterada nos dois lados", acoes: [["aplicar_sra", "Enviar valores do Sra Luck"], ["manter", "Manter como está"]] },
  baixa_na_conta_azul: { rotulo: "Baixa na Conta Azul", acoes: [["aplicar_baixa_conta_azul", "Dar baixa no Sra Luck"], ["manter", "Não aplicar"]] },
  baixa_removida_na_conta_azul: { rotulo: "Baixa removida na Conta Azul", acoes: [["estornar_no_sra", "Estornar no Sra Luck"], ["aplicar_sra", "Reenviar a baixa"], ["manter", "Manter como está"]] },
  estorno_de_baixa_externa: { rotulo: "Estorno de baixa externa", acoes: [["manter", "Resolvido na Conta Azul"]] },
  recebido_parcial: { rotulo: "Recebido parcial", acoes: [["aplicar_baixa_conta_azul", "Dar baixa no Sra Luck"], ["manter", "Aguardar"]] },
  ca_cancelado: { rotulo: "Cancelada na Conta Azul", acoes: [["desvincular", "Desvincular"], ["manter", "Manter vínculo"]] },
  ca_renegociado: { rotulo: "Renegociada na Conta Azul", acoes: [["desvincular", "Desvincular"], ["manter", "Manter vínculo"]] },
  ca_perdido: { rotulo: "Perdida na Conta Azul", acoes: [["desvincular", "Desvincular"], ["manter", "Manter vínculo"]] },
  parcela_nao_editavel: { rotulo: "Parcela não editável", acoes: [["manter", "Ciente"]] },
  baixa_nao_enviada: { rotulo: "Baixa não enviada", acoes: [["aplicar_sra", "Tentar de novo"], ["manter", "Ciente"]] },
  vinculo_divergente: { rotulo: "Vínculo divergente", acoes: [["aplicar_sra", "Enviar valores do Sra Luck"], ["desvincular", "Desfazer vínculo"]] },
  divergente_na_criacao: { rotulo: "Divergente na criação", acoes: [["aplicar_sra", "Enviar valores do Sra Luck"], ["manter", "Ciente"]] },
  marcador_duplicado: { rotulo: "Marcador duplicado", acoes: [["manter", "Resolvido na Conta Azul"]] },
  nao_confirmado: { rotulo: "Vínculo não confirmado", acoes: [["manter", "Ciente"]] },
  nao_localizado: { rotulo: "Lançamento não localizado", acoes: [["manter", "Ciente"]] },
  parcela_sumiu: { rotulo: "Excluída na Conta Azul", acoes: [["desvincular", "Desvincular"], ["manter", "Ciente"]] },
};

/** modo "equipe": conflitos, fila, vínculos, histórico e sincronização (conexão e configuração são do Dev). */
export function ContaAzulOperacao({ modo = "completo" }: { modo?: "completo" | "equipe" } = {}) {
  const [painel, setPainel] = useState<Json | null>(null);
  const [aba, setAba] = useState<"conflitos" | "fila" | "vinculos" | "historico" | "enviar">("conflitos");
  const [lista, setLista] = useState<Json[]>([]);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try { setPainel(await api("/api/admin/integrations/conta-azul/painel")); } catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
  }, []);
  const carregarLista = useCallback(async (qual: string) => {
    if (qual === "enviar") return;
    try { setLista((await api(`/api/admin/integrations/conta-azul/${qual}`)).itens ?? []); } catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { void carregarLista(aba); }, [aba, carregarLista]);

  async function acao(chave: string, f: () => Promise<Json>, sucesso: (r: Json) => string) {
    setOcupado(chave); setMsg(null);
    try { const r = await f(); setMsg({ t: sucesso(r), ok: r.status !== "erro" }); await Promise.all([carregar(), carregarLista(aba)]); }
    catch (e) { setMsg({ t: (e as Error).message, ok: false }); } finally { setOcupado(null); }
  }
  async function conectar() {
    try { const r = await api("/api/admin/integrations/conta-azul/authorize-url"); window.location.assign(r.url); } catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
  }

  const con = painel?.conexao;
  return <div>
    <div style={titulo}>Conexão</div>
    {painel && !painel.estruturaAplicada && <div style={{ ...caixa, color: "var(--gold)", marginBottom: 8 }}>Estrutura de sincronização ainda não aplicada (migration_091).</div>}
    <div style={{ ...caixa, display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center" }}>
      <span>OAuth</span><span style={chip(con?.autorizada ? "ok" : con?.clientConfigurado ? "warn" : "bad")}>{con?.autorizada ? "Conectada" : con?.tokenManual ? "Token manual (sem renovação)" : con?.clientConfigurado ? "Aguardando autorização" : "Client ID/Secret ausentes"}</span>
      <span>Token renova sozinho</span><span className="zip-mono" style={muted}>{con?.expiraEm ? `expira ${dataHora(con.expiraEm)}` : "—"}</span>
      <span>Última sincronização</span><span style={muted}>{painel?.ultimaSincronizacao ? `${dataHora(painel.ultimaSincronizacao.created_at)} · ${painel.ultimaSincronizacao.status}` : "Nunca"}</span>
    </div>
    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
      {modo === "completo" && <button style={btn} disabled={!con?.clientConfigurado} onClick={() => void conectar()}>{con?.autorizada ? "Reconectar" : "Conectar Conta Azul"}</button>}
      <button style={btnPrim} disabled={ocupado === "sync" || !(con?.autorizada || con?.tokenManual)} onClick={() => void acao("sync", () => api("/api/admin/integrations/conta-azul/sincronizar", { method: "POST" }), (r) => r.executada === false ? `Não executada: ${r.motivo}.` : r.status === "erro" ? `Falhou: ${r.erro}` : `Sincronizado: ${r.envio?.enfileiradas ?? 0} envio(s), ${r.leitura?.baixasAplicadas ?? 0} baixa(s) aplicada(s), ${r.leitura?.conflitos ?? 0} conflito(s), fila ${r.fila?.concluidas ?? 0}/${r.fila?.processadas ?? 0}.`)}>{ocupado === "sync" ? "Sincronizando…" : "Sincronizar agora"}</button>
    </div>
    <Aviso texto={msg?.t ?? null} tipo={msg?.ok ? "ok" : "bad"} />

    {modo === "completo" && <><div style={titulo}>Configuração</div>
    <FormularioFuncao provedor="conta_azul" funcao="sincronizacao" /></>}

    <div style={titulo}>Operação</div>
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
      {([["conflitos", `Conflitos (${painel?.conflitosAbertos ?? "—"})`], ["fila", `Fila (${(painel?.fila?.pendente ?? 0) + (painel?.fila?.erro ?? 0)})`], ["vinculos", `Vínculos (${painel?.vinculos?.vinculado ?? 0})`], ["historico", "Histórico"], ["enviar", "Enviar / vincular"]] as const).map(([k, l]) =>
        <button key={k} onClick={() => setAba(k)} style={{ ...btn, background: aba === k ? "var(--robg)" : "var(--s0)" }}>{l}</button>)}
    </div>
    {aba === "conflitos" && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {lista.length === 0 && <span style={muted}>Nenhum conflito aberto.</span>}
      {lista.map((c) => <div key={c.id} style={{ ...caixa, display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{ACOES[c.tipo]?.rotulo ?? c.tipo}</strong><span style={muted}>{dataHora(c.created_at)}</span></div>
        <span>{c.descricao}</span>
        {(c.dados_sra?.valor != null || c.dados_externos?.valorBruto != null) && <span className="zip-mono" style={muted}>Sra Luck: {c.dados_sra?.valor ?? "—"} · venc. {c.dados_sra?.vencimento ?? "—"} · {c.dados_sra?.status ?? "—"} | Conta Azul: {c.dados_externos?.valorBruto ?? "—"} · venc. {c.dados_externos?.vencimento ?? "—"} · {c.dados_externos?.status ?? "—"}</span>}
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {(ACOES[c.tipo]?.acoes ?? [["manter", "Ciente"]]).map(([a, l]) => <button key={a} style={a === "manter" ? btn : btnPrim} disabled={ocupado === c.id}
            onClick={() => void acao(c.id, () => api(`/api/admin/integrations/conta-azul/conflitos/${c.id}/resolver`, { method: "POST", body: { acao: a } }), () => "Conflito resolvido.")}>{l}</button>)}
        </div>
      </div>)}
    </div>}
    {aba === "fila" && <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {lista.length === 0 && <span style={muted}>Fila vazia.</span>}
      {lista.map((o) => <div key={o.id} style={{ ...caixa, display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
        <strong>{String(o.operacao).replace(/_/g, " ")}</strong><span style={chip(o.estado === "concluida" ? "ok" : o.estado === "erro" ? "bad" : o.estado === "pendente" ? "warn" : "neutral")}>{o.estado}</span>
        <span style={muted}>{o.tentativas}/{o.max_tentativas} tentativa(s) · {o.estado === "pendente" ? `próxima ${dataHora(o.proxima_tentativa_em)}` : dataHora(o.concluida_em ?? o.created_at)}{o.ultimo_erro ? ` — ${o.ultimo_erro}` : ""}</span>
        {o.estado === "erro" && <button style={btn} disabled={ocupado === o.id} onClick={() => void acao(o.id, () => api(`/api/admin/integrations/conta-azul/fila/${o.id}/reprocessar`, { method: "POST" }), () => "Reprocessada.")}>Reprocessar</button>}
      </div>)}
    </div>}
    {aba === "vinculos" && <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {lista.length === 0 && <span style={muted}>Nenhum vínculo.</span>}
      {lista.map((v) => <div key={v.id} style={{ ...caixa, display: "grid", gridTemplateColumns: "1fr auto", gap: 3 }}>
        <strong>{v.clientes?.nome_completo ?? "—"} · parcela {v.boletos?.numero_parcela}/{v.boletos?.total_parcelas}</strong><span style={chip(v.estado === "vinculado" ? "ok" : v.estado === "conflito" || v.estado === "erro_criacao" ? "bad" : "warn")}>{v.estado}</span>
        <span className="zip-mono" style={muted}>{v.marcador} · R$ {Number(v.boletos?.valor ?? 0).toFixed(2)} · {v.boletos?.data_vencimento} · {v.boletos?.status}{v.baixa_origem ? ` · baixa: ${v.baixa_origem === "sra" ? "Sra Luck" : "Conta Azul"}` : ""}</span>
        <span className="zip-mono" style={muted}>{v.ca_parcela_id ?? "sem parcela na Conta Azul"}{v.ultimo_erro ? ` — ${v.ultimo_erro}` : ""}</span>
      </div>)}
    </div>}
    {aba === "historico" && <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {lista.length === 0 && <span style={muted}>Sem execuções.</span>}
      {lista.map((e) => <div key={e.id} style={{ ...caixa, display: "grid", gridTemplateColumns: "1fr auto", gap: 3 }}>
        <strong>{String(e.event_type).replace(/_/g, " ")}</strong><span style={chip(e.status === "processado" ? "ok" : e.status === "erro" ? "bad" : "warn")}>{e.status}</span>
        <span style={muted}>{dataHora(e.created_at)}{e.erro ? ` — ${e.erro}` : e.payload?.leitura ? ` · ${e.payload.leitura.eventos} evento(s), ${e.payload.leitura.baixasAplicadas} baixa(s), ${e.payload.leitura.conflitos} conflito(s)` : ""}</span>
      </div>)}
    </div>}
    {aba === "enviar" && <EnviarVincular onFeito={(t, ok) => { setMsg({ t, ok }); void carregar(); }} />}
  </div>;
}

function EnviarVincular({ onFeito }: { onFeito: (t: string, ok: boolean) => void }) {
  const [clientes, setClientes] = useState<Json[]>([]);
  const [busca, setBusca] = useState("");
  const [cliente, setCliente] = useState<Json | null>(null);
  const [parcelas, setParcelas] = useState<Json[]>([]);
  const [idCa, setIdCa] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { api("/api/admin/clientes").then((r) => setClientes(r.clientes ?? [])).catch(() => setClientes([])); }, []);
  const achadas = useMemo(() => { const q = busca.trim().toLowerCase(); return q.length < 2 ? [] : clientes.filter((c) => String(c.nome_completo ?? "").toLowerCase().includes(q) || String(c.cpf ?? "").includes(q)).slice(0, 8); }, [busca, clientes]);
  async function escolher(c: Json) {
    setCliente(c); setBusca("");
    try { setParcelas((await api(`/api/admin/clientes/${c.id}/parcelas`)).parcelas ?? []); } catch { setParcelas([]); }
  }
  async function enviar() {
    if (!cliente) return;
    setOcupado(true);
    try { const r = await api("/api/admin/integrations/conta-azul/enviar-cliente", { method: "POST", body: { clienteId: cliente.id } }); onFeito(`${r.enfileiradas} parcela(s) em aberto enviada(s) para a fila; ${r.jaVinculadas} já vinculada(s).`, true); }
    catch (e) { onFeito((e as Error).message, false); } finally { setOcupado(false); }
  }
  async function vincular(boletoId: string) {
    setOcupado(true);
    try { const r = await api("/api/admin/integrations/conta-azul/vincular", { method: "POST", body: { boletoId, contaAzulParcelaId: (idCa[boletoId] ?? "").trim() } }); onFeito(r.vinculado ? "Vínculo seguro criado." : "Vínculo criado com divergência: conflito aberto para revisão.", r.vinculado); }
    catch (e) { onFeito((e as Error).message, false); } finally { setOcupado(false); }
  }
  return <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
    <input style={input} placeholder="Buscar cliente por nome ou CPF…" value={busca} onChange={(e) => setBusca(e.target.value)} />
    {achadas.map((c) => <button key={c.id} style={{ ...caixa, textAlign: "left", cursor: "pointer" }} onClick={() => void escolher(c)}>{c.nome_completo}</button>)}
    {cliente && <div style={{ ...caixa, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><strong>{cliente.nome_completo}</strong><button style={btnPrim} disabled={ocupado} onClick={() => void enviar()}>Enviar parcelas em aberto</button></div>
      <span style={muted}>A cliente precisa existir na Conta Azul com o mesmo CPF. Parcelas pagas não são enviadas. Para um lançamento que já existe lá, informe o ID da parcela na Conta Azul: o vínculo só é seguro se valor e vencimento baterem.</span>
      {parcelas.map((p) => <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr 150px auto", gap: 5, alignItems: "center" }}>
        <span className="zip-mono" style={{ fontSize: 10 }}>{p.numero_parcela}/{p.total_parcelas} · R$ {Number(p.valor).toFixed(2)} · {p.data_vencimento} · {p.status}</span>
        <input style={input} placeholder="ID da parcela na Conta Azul" value={idCa[p.id] ?? ""} onChange={(e) => setIdCa((a) => ({ ...a, [p.id]: e.target.value }))} />
        <button style={btn} disabled={ocupado || !(idCa[p.id] ?? "").trim()} onClick={() => void vincular(p.id)}>Vincular</button>
      </div>)}
    </div>}
  </div>;
}
