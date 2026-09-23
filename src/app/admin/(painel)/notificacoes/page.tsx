'use client';
import { fetchInstant, refreshInstant, getInstantCache } from "@/lib/instantCache";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { zipChip } from "@/components/admin-zip/zipUi";

/**
 * Aba NOTIFICAÇÕES — reprodução de Admin Configuracoes.dc.html (canal
 * atual, régua automática, tabela de eventos, tabela de templates).
 * A automação real (D-2/D-1/D0 + atraso), envio manual e histórico não
 * existem como seções explícitas no ZIP, mas são funcionalidades reais
 * que precisavam continuar acessíveis — foram adicionadas abaixo, no
 * mesmo padrão visual de card/tabela.
 */

type Template = { id: string; tipo: string; dias_referencia: number | null; titulo: string; corpo: string; emoji: string | null; is_active: boolean; updated_at?: string };
type Log = { id: string; cliente_id: string; tipo: string; titulo?: string; corpo?: string; status: string; erro_mensagem?: string; created_at: string; clientes?: { nome_completo?: string } };
type Cliente = { id: string; nome_completo: string; telefone?: string | null; ativo?: boolean };
type Config = { atraso_habilitado: boolean; frequencia_atraso_horas: number; max_tentativas: number };

const emptyConfig: Config = { atraso_habilitado: true, frequencia_atraso_horas: 24, max_tentativas: 3 };
const fieldInput: React.CSSProperties = { height: 33, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", padding: "0 9px", fontSize: 11 };

function rotuloEvento(t: Template) {
  if (t.tipo === "parcela_vencer") return t.dias_referencia === 0 ? "Vence hoje (D0)" : `D-${t.dias_referencia}`;
  return `${t.dias_referencia}º dia de atraso`;
}

export default function AdminNotificacoes() {
  const [config, setConfig] = useState<Config>(emptyConfig);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [atrasadas, setAtrasadas] = useState(0);
  const [aVencer, setAVencer] = useState(0);
  const [webPushConfigurado, setWebPushConfigurado] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningVencer, setRunningVencer] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const [clienteId, setClienteId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [qTemplate, setQTemplate] = useState('');
  const [drawer, setDrawer] = useState<Template | null>(null);
  const [edit, setEdit] = useState<{ titulo: string; corpo: string; emoji: string }>({ titulo: '', corpo: '', emoji: '' });

  const carregar = useCallback(async (force = false) => {
    const url = '/api/admin/notificacoes/automacao';
    const cached = !force ? getInstantCache<any>(url) : null;
    if (cached) {
      setConfig({ ...emptyConfig, ...cached.config }); setTemplates(cached.templates ?? []); setLogs(cached.logs ?? []);
      setClientes(cached.clientes ?? []); setAtrasadas(cached.atrasadas ?? 0); setAVencer(cached.aVencer ?? 0);
      setLoading(false);
    } else setLoading(true);
    try {
      const [data, statusResp] = await Promise.all([
        force ? refreshInstant<any>(url, { cache: 'no-store' }) : fetchInstant<any>(url),
        fetch("/api/admin/integrations/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      setConfig({ ...emptyConfig, ...(data?.config ?? {}) });
      setTemplates(Array.isArray(data?.templates) ? data.templates : []);
      setLogs(Array.isArray(data?.logs) ? data.logs : []);
      setClientes(Array.isArray(data?.clientes) ? data.clientes : []);
      setAtrasadas(Number(data?.atrasadas ?? 0));
      setAVencer(Number(data?.aVencer ?? 0));
      const webPush = statusResp?.integracoes?.find((i: any) => i.id === "web_push");
      setWebPushConfigurado(Boolean(webPush?.credenciaisConfiguradas));
    } catch (e: any) {
      if (!cached) setFeedback({ type: 'error', text: e.message || 'Falha ao carregar o painel.' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const eventosOrdenados = useMemo(() => [...templates].sort((a, b) => (a.tipo === b.tipo ? (a.dias_referencia ?? 0) - (b.dias_referencia ?? 0) : a.tipo === "parcela_vencer" ? -1 : 1)), [templates]);
  const templatesFiltrados = useMemo(() => { const q = qTemplate.trim().toLowerCase(); return eventosOrdenados.filter((t) => !q || [rotuloEvento(t), t.titulo, t.corpo].join(" ").toLowerCase().includes(q)); }, [eventosOrdenados, qTemplate]);
  const enviadas = logs.filter((l) => l.status === 'enviada').length;

  async function salvarConfig() {
    setSaving(true); setFeedback(null);
    try {
      const res = await fetch('/api/admin/notificacoes/automacao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao salvar.');
      setConfig({ ...emptyConfig, ...data.config });
      setFeedback({ type: 'ok', text: 'Configurações salvas.' });
    } catch (e: any) { setFeedback({ type: 'error', text: e.message }); } finally { setSaving(false); }
  }
  async function executarAgora() {
    setRunning(true); setFeedback(null);
    try {
      const res = await fetch('/api/admin/notificacoes/automacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'verificar_atrasos' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha na execução.');
      setFeedback({ type: 'ok', text: `${data.enviadas ?? 0} envio(s) realizado(s), ${data.ignoradas ?? 0} já dentro do intervalo.` });
      await carregar();
    } catch (e: any) { setFeedback({ type: 'error', text: e.message }); } finally { setRunning(false); }
  }
  async function executarVencer() {
    setRunningVencer(true); setFeedback(null);
    try {
      const res = await fetch('/api/admin/notificacoes/automacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'verificar_momentos_especiais' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha na execução.');
      setFeedback({ type: 'ok', text: `${data.enviadas ?? 0} lembrete(s) D-2/D-1/D0 enviado(s), ${data.ignoradas ?? 0} já registrados.` });
      await carregar();
    } catch (e: any) { setFeedback({ type: 'error', text: e.message }); } finally { setRunningVencer(false); }
  }
  async function enviarAgoraTodas() {
    if (!window.confirm(`Enviar agora os templates de cobrança para todas as clientes com parcelas vencidas e não pagas?`)) return;
    setSendingAll(true); setFeedback(null);
    try {
      const res = await fetch('/api/admin/notificacoes/automacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'enviar_agora_todas' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao enviar agora.');
      setFeedback({ type: 'ok', text: `Envio imediato concluído: ${data.enviadas ?? 0} notificação(ões), ${data.falhas ?? 0} falha(s).` });
      await carregar();
    } catch (e: any) { setFeedback({ type: 'error', text: e.message }); } finally { setSendingAll(false); }
  }
  function abrirDrawer(t: Template) { setDrawer(t); setEdit({ titulo: t.titulo, corpo: t.corpo, emoji: t.emoji || '💬' }); }
  async function salvarTemplate(t: Template, patch: Partial<{ titulo: string; corpo: string; emoji: string; is_active: boolean }>) {
    try {
      const res = await fetch('/api/admin/notificacoes/templates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, titulo: edit.titulo, corpo: edit.corpo, emoji: edit.emoji, is_active: t.is_active, ...patch }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao salvar template.');
      setTemplates((old) => old.map((item) => item.id === t.id ? data.template : item));
      setFeedback({ type: 'ok', text: 'Template atualizado.' });
    } catch (e: any) { setFeedback({ type: 'error', text: e.message }); }
  }
  async function enviarManual(e: React.FormEvent) {
    e.preventDefault(); setEnviando(true); setFeedback(null);
    try {
      const res = await fetch('/api/admin/notificacoes/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId, titulo, mensagem }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha no envio.');
      setFeedback({ type: 'ok', text: `Notificação enviada para ${data.cliente?.nome ?? 'a cliente'}.` });
      setClienteId(''); setTitulo(''); setMensagem('');
      await carregar();
    } catch (e: any) { setFeedback({ type: 'error', text: e.message }); } finally { setEnviando(false); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", fontSize: 12, color: "var(--soft)" }}>Carregando painel...</div>;

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }} className="zip-animate-fade-in">
    {feedback && <div style={{ borderRadius: 9, border: `1px solid ${feedback.type === "ok" ? "var(--okbg)" : "var(--badbg)"}`, background: feedback.type === "ok" ? "var(--okbg)" : "var(--badbg)", color: feedback.type === "ok" ? "var(--ok)" : "var(--bad)", padding: "8px 12px", fontSize: 11 }}>{feedback.text}</div>}

    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--robg)", color: "var(--bg)", display: "grid", placeItems: "center", fontSize: 15 }}>↗</div><div><div style={{ fontSize: 13, fontWeight: 700 }}>Canal atual: Web Push / PWA</div><div style={{ marginTop: 2, fontSize: 10.5, color: "var(--soft)" }}>Único canal ativo nesta primeira versão.</div></div></div>
      <span style={zipChip(webPushConfigurado ? "ok" : "neutral")}>{webPushConfigurado ? "Configurado" : "Não configurado"}</span>
    </div>

    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div><h2 style={{ fontSize: 15 }}>Régua automática de parcelas</h2><div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Os lembretes param quando a parcela é confirmada como paga.</div></div><span style={zipChip(config.atraso_habilitado ? "ok" : "neutral")}>{config.atraso_habilitado ? "Ativa" : "Inativa"}</span></div>
      <div style={{ padding: "14px 15px", display: "grid", gridTemplateColumns: "repeat(4,minmax(150px,1fr))", gap: 9, overflow: "auto" }}>
        {[["D-2", "Faltam 2 dias", "Lembrete leve com acesso ao boleto.", "blue"], ["D-1", "Vence amanhã", "Reforço amigável um dia antes.", "warn"], ["D0", "Vence hoje", "Aviso objetivo no dia do vencimento.", "rose"], ["D+1", "Parcela em atraso", "Inicia o template humanizado de atraso.", "bad"]].map(([when, t, desc, kind]) => <div key={when as string} style={{ minWidth: 150, border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 11, padding: 11 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><span style={zipChip(kind as any)}>{when}</span><span style={{ color: "var(--ok)", fontSize: 11 }}>✓</span></div>
          <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700 }}>{t}</div><div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)", lineHeight: 1.45 }}>{desc}</div>
        </div>)}
      </div>
    </div>

    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--line)" }}><h2 style={{ fontSize: 15 }}>Eventos de notificação</h2><div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Defina quais eventos geram Web Push.</div></div>
      <div style={{ overflow: "auto", maxHeight: 310 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(190px,1.2fr) minmax(210px,1.3fr) 130px 90px 34px", gap: 10, minWidth: 760, padding: "9px 14px", background: "var(--s1)", borderBottom: "1px solid var(--line)", position: "sticky", top: 0 }}>{["Evento", "Template associado", "Status", "Ativo", ""].map((h) => <div key={h} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>{h}</div>)}</div>
        {eventosOrdenados.map((t) => <div key={t.id} onClick={() => abrirDrawer(t)} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "minmax(190px,1.2fr) minmax(210px,1.3fr) 130px 90px 34px", gap: 10, minWidth: 760, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line2)", cursor: "pointer" }}>
          <div><div style={{ fontSize: 12, fontWeight: 700 }}>{rotuloEvento(t)}</div></div>
          <div style={{ fontSize: 11, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.titulo}</div>
          <span style={zipChip(t.is_active ? "ok" : "neutral")}>{t.is_active ? "Ativo" : "Inativo"}</span>
          <button onClick={(e) => { e.stopPropagation(); void salvarTemplate(t, { is_active: !t.is_active }); }} style={{ height: 24, width: 42, borderRadius: 999, border: `1px solid ${t.is_active ? "var(--bg)" : "var(--line)"}`, background: t.is_active ? "var(--bg)" : "var(--s2)", padding: 2, display: "flex", justifyContent: t.is_active ? "flex-end" : "flex-start" }}><span style={{ width: 18, height: 18, borderRadius: 999, background: "var(--on-accent)", boxShadow: "0 3px 8px rgba(0,0,0,.14)" }} /></button>
          <span style={{ fontSize: 14, color: "var(--soft)" }}>›</span>
        </div>)}
      </div>
    </div>

    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><div><h2 style={{ fontSize: 15 }}>Templates Web Push</h2><div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)" }}>Textos humanizados, editáveis por régua.</div></div></div>
      <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "center" }}><div style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, height: 32, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", padding: "0 10px" }}><span style={{ color: "var(--soft)", fontSize: 11 }}>⌕</span><input value={qTemplate} onChange={(e) => setQTemplate(e.target.value)} placeholder="Buscar template..." style={{ width: "100%", border: 0, outline: "none", background: "transparent", color: "var(--ink)", fontSize: 11.5 }} /></div></div>
      <div style={{ overflow: "auto", maxHeight: 330 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.3fr) minmax(170px,1fr) 100px 130px 34px", gap: 10, minWidth: 730, padding: "9px 14px", background: "var(--s1)", borderBottom: "1px solid var(--line)" }}>{["Template", "Evento", "Status", "Última edição", ""].map((h) => <div key={h} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>{h}</div>)}</div>
        {templatesFiltrados.map((t) => <div key={t.id} onClick={() => abrirDrawer(t)} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.3fr) minmax(170px,1fr) 100px 130px 34px", gap: 10, minWidth: 730, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line2)", cursor: "pointer" }}>
          <div><div style={{ fontSize: 12, fontWeight: 700 }}>{t.titulo}</div><div style={{ marginTop: 2, fontSize: 10, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.corpo.replace(/\{\{cliente_nome\}\}/g, "Maria").slice(0, 60)}…</div></div>
          <div style={{ fontSize: 11, color: "var(--soft)" }}>{rotuloEvento(t)}</div>
          <span style={zipChip(t.is_active ? "ok" : "neutral")}>{t.is_active ? "Ativo" : "Inativo"}</span>
          <div style={{ fontSize: 10.5, color: "var(--soft)" }} className="zip-mono">{t.updated_at ? new Date(t.updated_at).toLocaleString("pt-BR") : "—"}</div>
          <span style={{ fontSize: 14, color: "var(--soft)" }}>›</span>
        </div>)}
      </div>
    </div>

    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, padding: "14px 15px", display: "grid", gridTemplateColumns: "1.2fr .8fr", gap: 16 }}>
      <div>
        <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 9 }}>Automação de cobrança</div>
        <label style={{ display: "flex", cursor: "pointer", alignItems: "center", justifyContent: "space-between", borderRadius: 9, border: "1px solid var(--line)", background: "var(--s1)", padding: 10 }}><span><span style={{ display: "block", fontSize: 11.5, fontWeight: 600 }}>Ativar automação de atraso</span><span style={{ fontSize: 10, color: "var(--soft)" }}>Somente parcelas vencidas e não pagas.</span></span><input type="checkbox" checked={config.atraso_habilitado} onChange={(e) => setConfig({ ...config, atraso_habilitado: e.target.checked })} /></label>
        <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: "var(--soft)" }}>Reenviar a cada<select style={{ ...fieldInput, width: "100%", marginTop: 4 }} value={config.frequencia_atraso_horas} onChange={(e) => setConfig({ ...config, frequencia_atraso_horas: Number(e.target.value) })}>{[6, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} horas</option>)}</select></label>
          <label style={{ fontSize: 10, fontWeight: 700, color: "var(--soft)" }}>Máx. tentativas<input type="number" min={1} max={10} style={{ ...fieldInput, width: "100%", marginTop: 4 }} value={config.max_tentativas} onChange={(e) => setConfig({ ...config, max_tentativas: Number(e.target.value) })} /></label>
        </div>
        <button onClick={salvarConfig} disabled={saving} style={{ marginTop: 10, height: 33, padding: "0 14px", border: "1px solid var(--bg)", borderRadius: 9, background: "var(--bg)", color: "var(--on-accent)", fontSize: 11, fontWeight: 700 }}>{saving ? "Salvando..." : "Salvar configuração"}</button>
      </div>
      <div>
        <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 9 }}>Execução ({aVencer} a vencer · {atrasadas} atrasadas)</div>
        <div style={{ display: "grid", gap: 7 }}>
          <button onClick={executarVencer} disabled={running || sendingAll || runningVencer} style={{ height: 33, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", fontSize: 10.5, fontWeight: 700 }}>{runningVencer ? "Verificando..." : "Verificar régua D-2/D-1/D0"}</button>
          <button onClick={executarAgora} disabled={running || sendingAll || runningVencer} style={{ height: 33, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", fontSize: 10.5, fontWeight: 700 }}>{running ? "Verificando..." : "Verificar atrasos agora"}</button>
          <button onClick={enviarAgoraTodas} disabled={running || sendingAll || atrasadas === 0} style={{ height: 33, border: "1px solid var(--bg)", borderRadius: 9, background: "var(--bg)", color: "var(--on-accent)", fontSize: 10.5, fontWeight: 700 }}>{sendingAll ? "Enviando..." : "Enviar agora para todas atrasadas"}</button>
        </div>
      </div>
    </div>

    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, padding: "14px 15px", display: "grid", gridTemplateColumns: ".75fr 1.25fr", gap: 16 }}>
      <div><div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 9 }}>Envio manual</div><select style={{ ...fieldInput, width: "100%" }} value={clienteId} onChange={(e) => setClienteId(e.target.value)}><option value="">Selecione uma cliente...</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_completo}</option>)}</select></div>
      <form onSubmit={enviarManual}><div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 9 }}>Mensagem</div><input style={{ ...fieldInput, width: "100%", marginBottom: 8 }} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título" /><textarea style={{ ...fieldInput, width: "100%", height: 60, padding: 8 }} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Mensagem..." /><div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}><button disabled={enviando} style={{ height: 32, padding: "0 14px", border: "1px solid var(--bg)", borderRadius: 9, background: "var(--bg)", color: "var(--on-accent)", fontSize: 10.5, fontWeight: 700 }}>{enviando ? "Enviando..." : "Enviar agora"}</button></div></form>
    </div>

    <div style={{ border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}><h2 style={{ fontSize: 15 }}>Histórico de envios</h2><span style={{ fontSize: 10.5, color: "var(--soft)" }}>{logs.length} registros · {enviadas} enviados</span></div>
      <div style={{ maxHeight: 260, overflowY: "auto" }}>{logs.length === 0 ? <div style={{ padding: 24, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Nenhum envio registrado.</div> : logs.slice(0, 30).map((log) => <div key={log.id} style={{ display: "grid", gridTemplateColumns: "1fr 130px 90px", gap: 8, padding: "9px 14px", borderBottom: "1px solid var(--line2)", alignItems: "center" }}>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{log.clientes?.nome_completo || log.cliente_id.slice(0, 8)} <span style={{ color: "var(--soft)", fontWeight: 400 }}>· {log.tipo}</span></div></div>
        <div style={{ fontSize: 10, color: "var(--soft)" }} className="zip-mono">{new Date(log.created_at).toLocaleString("pt-BR")}</div>
        <span style={zipChip(log.status === "enviada" ? "ok" : log.status === "erro" || log.status === "falha" ? "bad" : "warn")}>{log.status}</span>
      </div>)}</div>
    </div>

    {drawer && <>
      <div className="zip-animate-fade-in" style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", zIndex: 60 }} onClick={() => setDrawer(null)} />
      <aside className="zip-animate-slide-in" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 61, width: "min(396px,100vw)", background: "var(--s0)", borderLeft: "1px solid var(--line)", boxShadow: "var(--sh)", overflowY: "auto" }}>
        <div style={{ padding: "14px 15px 12px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div><div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--rose)" }}>Template Web Push</div><h2 style={{ fontSize: 16, marginTop: 4 }}>{rotuloEvento(drawer)}</h2></div>
          <button onClick={() => setDrawer(null)} style={{ height: 28, width: 28, borderRadius: 8, border: "1px solid var(--line)", background: "var(--s0)", color: "var(--soft)", fontSize: 13 }}>✕</button>
        </div>
        <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 9 }}>
            <div><label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--soft)", marginBottom: 4 }}>Título do Web Push</label><input style={{ ...fieldInput, width: "100%" }} value={edit.titulo} onChange={(e) => setEdit({ ...edit, titulo: e.target.value })} /></div>
            <div><label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--soft)", marginBottom: 4 }}>Emoji</label><input style={{ ...fieldInput, width: "100%" }} value={edit.emoji} onChange={(e) => setEdit({ ...edit, emoji: e.target.value })} /></div>
          </div>
          <div><label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--soft)", marginBottom: 4 }}>Mensagem</label><textarea rows={6} style={{ ...fieldInput, width: "100%", height: "auto", padding: 9 }} value={edit.corpo} onChange={(e) => setEdit({ ...edit, corpo: e.target.value })} /></div>
          <div style={{ border: "1px solid var(--line)", background: "var(--s1)", borderRadius: 10, padding: 10 }}><div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" }}>Variáveis disponíveis</div><div style={{ marginTop: 7, display: "flex", flexWrap: "wrap", gap: 5 }}>{["{{cliente_nome}}", "{{data_vencimento}}", "{{valor_parcela}}", "{{numero_parcela}}", "{{dias_atraso}}"].map((v) => <code key={v} style={{ fontSize: 9.5, padding: "4px 6px", borderRadius: 6, background: "var(--s2)", color: "var(--bg)" }}>{v}</code>)}</div></div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 7 }}>
            <button onClick={() => setDrawer(null)} style={{ height: 32, padding: "0 11px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--soft)", fontSize: 10.5, fontWeight: 700 }}>Cancelar</button>
            <button onClick={() => { void salvarTemplate(drawer, {}); setDrawer(null); }} style={{ height: 32, padding: "0 12px", border: "1px solid var(--bg)", borderRadius: 9, background: "var(--bg)", color: "var(--on-accent)", fontSize: 10.5, fontWeight: 700 }}>Salvar alterações</button>
          </div>
        </div>
      </aside>
    </>}
  </div>;
}
