'use client';
import { fetchInstant, refreshInstant, getInstantCache } from "@/lib/instantCache";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { zipChip } from "@/components/admin-zip/zipUi";

/**
 * Aba NOTIFICAÇÕES (Configurações). Tudo numa tela compacta:
 *   - barra de números + automação (liga/desliga, intervalos) + execução manual;
 *   - régua de parcelas: D-2, D-1, D0, um texto por dia de 1 a 30 e o texto
 *     único 31+ (worker/notificacao-templates-padrao.ts), com editor ao lado,
 *     versão "2 ou mais parcelas" e pré-visualização;
 *   - histórico e envio manual em abas.
 * O envio é sempre unificado: uma notificação por cliente por rodada.
 */

type Template = { id: string; tipo: string; dias_referencia: number | null; titulo: string; corpo: string; titulo_multiplas?: string | null; corpo_multiplas?: string | null; emoji: string | null; is_active: boolean; updated_at?: string };
type Padrao = { tipo: string; dias: number; emoji: string; titulo: string; corpo: string; titulo_multiplas: string; corpo_multiplas: string };
type Variavel = { chave: string; descricao: string };
type Log = { id: string; cliente_id: string; tipo: string; titulo?: string; corpo?: string; status: string; erro_mensagem?: string; created_at: string; clientes?: { nome_completo?: string } };
type Cliente = { id: string; nome_completo: string; telefone?: string | null; ativo?: boolean };
type Config = { atraso_habilitado: boolean; frequencia_atraso_horas: number; max_tentativas: number; atraso_recorrente_intervalo_dias: number };
type Edicao = { titulo: string; corpo: string; titulo_multiplas: string; corpo_multiplas: string; emoji: string };

const emptyConfig: Config = { atraso_habilitado: true, frequencia_atraso_horas: 24, max_tentativas: 3, atraso_recorrente_intervalo_dias: 1 };
const fieldInput: React.CSSProperties = { height: 33, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", padding: "0 9px", fontSize: 11, fontWeight: 400 };
const rotulo: React.CSSProperties = { fontSize: 8.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--rose)" };
const cartao: React.CSSProperties = { border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 14 };
const botao: React.CSSProperties = { height: 30, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", color: "var(--ink)", fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" };
const botaoPrincipal: React.CSSProperties = { ...botao, border: "1px solid var(--bg)", background: "var(--bg)", color: "var(--on-accent)" };

/** Faixas da régua: agrupam os templates na lista da esquerda. */
const FAIXAS: { id: string; titulo: string; descricao: string; tipo: string; de: number; ate: number }[] = [
  { id: "antes", titulo: "Antes do vencimento", descricao: "D-2, D-1 e no dia", tipo: "parcela_vencer", de: 0, ate: 2 },
  { id: "a1", titulo: "1 a 7 dias", descricao: "Lembrete leve e acolhedor", tipo: "parcela_atrasada", de: 1, ate: 7 },
  { id: "a2", titulo: "8 a 14 dias", descricao: "Firme, com apoio da equipe", tipo: "parcela_atrasada", de: 8, ate: 14 },
  { id: "a3", titulo: "15 a 21 dias", descricao: "Importância do plano em dia", tipo: "parcela_atrasada", de: 15, ate: 21 },
  { id: "a4", titulo: "22 a 30 dias", descricao: "Atenção necessária, com respeito", tipo: "parcela_atrasada", de: 22, ate: 30 },
  { id: "rec", titulo: "31 dias ou mais", descricao: "Mensagem única; só a quantidade muda", tipo: "parcela_atrasada", de: 31, ate: 31 },
];

// Exemplo usado só na pré-visualização do painel (nunca é enviado).
const EXEMPLO: Record<string, string> = { nome: "Maria", cliente: "Maria Silva", parcela: "3", total: "12", valor: "R$ 520,00", vencimento: "10/09/2026", dias_atraso: "5", quantidade: "2", valor_total: "R$ 1.040,00" };

function renderizar(texto: string, dias: number | null, tipo: string) {
  const vars: Record<string, string> = { ...EXEMPLO, dias_atraso: String(tipo === "parcela_atrasada" ? Math.max(1, dias ?? 1) : 0) };
  return texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => vars[k] ?? m);
}

function rotuloEvento(t: { tipo: string; dias_referencia: number | null }) {
  if (t.tipo === "parcela_vencer") return t.dias_referencia === 0 ? "No dia" : `D-${t.dias_referencia}`;
  return (t.dias_referencia ?? 0) >= 31 ? "31+ dias" : `${t.dias_referencia}º dia`;
}

function corDia(t: { tipo: string; dias_referencia: number | null }) {
  if (t.tipo === "parcela_vencer") return "blue" as const;
  const d = t.dias_referencia ?? 0;
  return d <= 7 ? "warn" as const : d <= 21 ? "rose" as const : "bad" as const;
}

function edicaoDe(t: Template): Edicao {
  return { titulo: t.titulo, corpo: t.corpo, titulo_multiplas: t.titulo_multiplas ?? "", corpo_multiplas: t.corpo_multiplas ?? "", emoji: t.emoji || "💬" };
}

export default function AdminNotificacoes() {
  const [config, setConfig] = useState<Config>(emptyConfig);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [padroes, setPadroes] = useState<Padrao[]>([]);
  const [variaveis, setVariaveis] = useState<Variavel[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [atrasadas, setAtrasadas] = useState(0);
  const [aVencer, setAVencer] = useState(0);
  const [dispositivos, setDispositivos] = useState(0);
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
  const [busca, setBusca] = useState('');
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [versao, setVersao] = useState<'uma' | 'varias'>('uma');
  const [edit, setEdit] = useState<Edicao>({ titulo: '', corpo: '', titulo_multiplas: '', corpo_multiplas: '', emoji: '' });
  const [salvandoTemplate, setSalvandoTemplate] = useState(false);
  const [aba, setAba] = useState<'manual' | 'historico'>('historico');

  function aplicarDados(data: any) {
    setConfig({ ...emptyConfig, ...(data?.config ?? {}) });
    setTemplates(Array.isArray(data?.templates) ? data.templates : []);
    setPadroes(Array.isArray(data?.padroes) ? data.padroes : []);
    setVariaveis(Array.isArray(data?.variaveis) ? data.variaveis : []);
    setLogs(Array.isArray(data?.logs) ? data.logs : []);
    setClientes(Array.isArray(data?.clientes) ? data.clientes : []);
    setAtrasadas(Number(data?.atrasadas ?? 0));
    setAVencer(Number(data?.aVencer ?? 0));
    setDispositivos(Number(data?.pushSubscriptions ?? 0));
  }

  const carregar = useCallback(async (force = false) => {
    const url = '/api/admin/notificacoes/automacao';
    const cached = !force ? getInstantCache<any>(url) : null;
    if (cached) { aplicarDados(cached); setLoading(false); } else setLoading(true);
    try {
      const [data, statusResp] = await Promise.all([
        force ? refreshInstant<any>(url, { cache: 'no-store' }) : fetchInstant<any>(url),
        fetch("/api/admin/integrations/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      aplicarDados(data);
      const webPush = statusResp?.integracoes?.find((i: any) => i.id === "web_push");
      setWebPushConfigurado(Boolean(webPush?.credenciaisConfiguradas));
    } catch (e: any) {
      if (!cached) setFeedback({ type: 'error', text: e.message || 'Falha ao carregar o painel.' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const ordenados = useMemo(() => [...templates].sort((a, b) => (a.tipo === b.tipo ? (a.tipo === "parcela_vencer" ? (b.dias_referencia ?? 0) - (a.dias_referencia ?? 0) : (a.dias_referencia ?? 0) - (b.dias_referencia ?? 0)) : a.tipo === "parcela_vencer" ? -1 : 1)), [templates]);
  const filtrados = useMemo(() => { const q = busca.trim().toLowerCase(); return ordenados.filter((t) => !q || [rotuloEvento(t), t.titulo, t.corpo, t.titulo_multiplas, t.corpo_multiplas].join(" ").toLowerCase().includes(q)); }, [ordenados, busca]);
  const selecionado = templates.find((t) => t.id === selecionadoId) ?? null;
  const padraoDoSelecionado = selecionado ? padroes.find((p) => p.tipo === selecionado.tipo && p.dias === selecionado.dias_referencia) : undefined;
  const ativos = templates.filter((t) => t.is_active).length;
  const enviadas = logs.filter((l) => l.status === 'enviada').length;
  const alterado = selecionado ? JSON.stringify(edicaoDe(selecionado)) !== JSON.stringify(edit) : false;

  useEffect(() => { if (!selecionadoId && ordenados.length) selecionar(ordenados[0]); }, [ordenados, selecionadoId]);

  function selecionar(t: Template) {
    if (alterado && !window.confirm("Descartar as alterações deste template?")) return;
    setSelecionadoId(t.id); setEdit(edicaoDe(t)); setVersao('uma');
  }

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
  async function salvarTemplate(t: Template, patch: Record<string, unknown>, aviso = 'Template atualizado.') {
    const res = await fetch('/api/admin/notificacoes/templates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, ...patch }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Falha ao salvar template.');
    setTemplates((old) => old.map((item) => item.id === t.id ? data.template : item));
    setFeedback({ type: 'ok', text: aviso });
    return data.template as Template;
  }
  async function alternar(t: Template) {
    try { await salvarTemplate(t, { is_active: !t.is_active }, t.is_active ? `${rotuloEvento(t)} desligado: nesse dia a cliente não recebe aviso.` : `${rotuloEvento(t)} ligado.`); }
    catch (e: any) { setFeedback({ type: 'error', text: e.message }); }
  }
  async function salvarTexto() {
    if (!selecionado) return;
    setSalvandoTemplate(true); setFeedback(null);
    try { const novo = await salvarTemplate(selecionado, edit, `Texto de ${rotuloEvento(selecionado)} salvo.`); setEdit(edicaoDe(novo)); }
    catch (e: any) { setFeedback({ type: 'error', text: e.message }); }
    finally { setSalvandoTemplate(false); }
  }
  function restaurarPadrao() {
    if (!padraoDoSelecionado) return;
    setEdit({ titulo: padraoDoSelecionado.titulo, corpo: padraoDoSelecionado.corpo, titulo_multiplas: padraoDoSelecionado.titulo_multiplas, corpo_multiplas: padraoDoSelecionado.corpo_multiplas, emoji: padraoDoSelecionado.emoji });
    setFeedback({ type: 'ok', text: 'Texto padrão carregado. Salve para aplicar.' });
  }
  function inserirVariavel(chave: string) {
    const campo = versao === 'uma' ? 'corpo' : 'corpo_multiplas';
    setEdit((e) => ({ ...e, [campo]: `${e[campo]}${e[campo].endsWith(' ') || !e[campo] ? '' : ' '}{{${chave}}}` }));
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

  const campoTitulo = versao === 'uma' ? 'titulo' : 'titulo_multiplas';
  const campoCorpo = versao === 'uma' ? 'corpo' : 'corpo_multiplas';
  const previaTitulo = selecionado ? renderizar(edit[campoTitulo] || edit.titulo, selecionado.dias_referencia, selecionado.tipo) : '';
  const previaCorpo = selecionado ? renderizar(edit[campoCorpo] || edit.corpo, selecionado.dias_referencia, selecionado.tipo) : '';

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }} className="zip-animate-fade-in">
    {feedback && <div role="status" style={{ borderRadius: 9, border: `1px solid ${feedback.type === "ok" ? "var(--okbg)" : "var(--badbg)"}`, background: feedback.type === "ok" ? "var(--okbg)" : "var(--badbg)", color: feedback.type === "ok" ? "var(--ok)" : "var(--bad)", padding: "8px 12px", fontSize: 11 }}>{feedback.text}</div>}

    {/* Barra de controle: canal, números do dia, automação e execução */}
    <div style={{ ...cartao, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
      {[
        ["Canal Web Push", webPushConfigurado ? "Configurado" : "Não configurado", webPushConfigurado ? "var(--ok)" : "var(--gold)", `${dispositivos} dispositivo(s)`],
        ["Vencendo em 2 dias", String(aVencer), "var(--ink)", "parcelas D-2 a D0"],
        ["Em atraso", String(atrasadas), atrasadas ? "var(--bad)" : "var(--ok)", "parcelas não pagas"],
        ["Régua", `${ativos}/${templates.length}`, "var(--ink)", "dias com aviso ligado"],
      ].map(([r, v, cor, sub], i) => <div key={r} style={{ padding: "11px 14px", borderLeft: i ? "1px solid var(--line2)" : "none" }}>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--soft)" }}>{r}</div>
        <div style={{ marginTop: 3, fontSize: 18, fontWeight: 700, color: cor }}>{v}</div>
        <div style={{ fontSize: 10, color: "var(--soft)" }}>{sub}</div>
      </div>)}
    </div>

    <div style={{ ...cartao, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
        <input type="checkbox" checked={config.atraso_habilitado} onChange={(e) => setConfig({ ...config, atraso_habilitado: e.target.checked })} />
        Atraso automático
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--soft)" }} title="Tempo mínimo entre dois avisos para a mesma cliente">Intervalo
        <select style={{ ...fieldInput, height: 28 }} value={config.frequencia_atraso_horas} onChange={(e) => setConfig({ ...config, frequencia_atraso_horas: Number(e.target.value) })}>{[6, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} horas</option>)}</select>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--soft)" }}>31+ dias a cada
        <select style={{ ...fieldInput, height: 28 }} value={config.atraso_recorrente_intervalo_dias} onChange={(e) => setConfig({ ...config, atraso_recorrente_intervalo_dias: Number(e.target.value) })}>{[1, 2, 3, 5, 7, 10, 15, 30].map((d) => <option key={d} value={d}>{d === 1 ? "1 dia" : `${d} dias`}</option>)}</select>
      </label>
      <button onClick={salvarConfig} disabled={saving} style={botao}>{saving ? "Salvando..." : "Salvar"}</button>
      <div style={{ flex: 1 }} />
      <button onClick={executarVencer} disabled={running || sendingAll || runningVencer} style={botao}>{runningVencer ? "Verificando..." : "Rodar D-2 a D0"}</button>
      <button onClick={executarAgora} disabled={running || sendingAll || runningVencer} style={botao}>{running ? "Verificando..." : "Rodar atrasos"}</button>
      <button onClick={enviarAgoraTodas} disabled={running || sendingAll || atrasadas === 0} title="Envia agora o aviso de atraso para todas as clientes com parcela vencida" style={botaoPrincipal}>{sendingAll ? "Enviando..." : "Enviar agora"}</button>
    </div>

    {/* Régua: lista compacta + editor com pré-visualização */}
    <div style={{ ...cartao, overflow: "hidden", display: "grid", gridTemplateColumns: "minmax(280px,.9fr) minmax(360px,1.1fr)" }}>
      <div style={{ borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--line)" }}>
          <h2 style={{ fontSize: 15 }}>Régua de parcelas</h2>
          <div style={{ marginTop: 3, fontSize: 10.5, color: "var(--soft)", lineHeight: 1.45 }}>Uma notificação por cliente, com todas as parcelas em aberto. Para quando a parcela é paga.</div>
          <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 7, height: 30, border: "1px solid var(--line)", borderRadius: 9, background: "var(--s0)", padding: "0 10px" }}><span style={{ color: "var(--soft)", fontSize: 11 }}>⌕</span><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por dia ou texto..." style={{ flex: 1, border: 0, outline: 0, background: "transparent", color: "var(--ink)", fontSize: 11 }} /></div>
        </div>
        <div style={{ overflowY: "auto", maxHeight: 560 }}>
          {templates.length === 0 && <div style={{ padding: 24, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Nenhum template cadastrado. Aplique a migration_092 para carregar a régua padrão.</div>}
          {FAIXAS.map((f) => {
            const itens = filtrados.filter((t) => t.tipo === f.tipo && (t.dias_referencia ?? -1) >= f.de && (t.dias_referencia ?? -1) <= f.ate);
            if (!itens.length) return null;
            return <div key={f.id}>
              <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 14px 6px", background: "var(--s1)", borderBottom: "1px solid var(--line2)" }}>
                <span style={rotulo}>{f.titulo}</span><span style={{ fontSize: 9.5, color: "var(--soft)" }}>{f.descricao}</span>
              </div>
              {itens.map((t) => {
                const ativo = t.id === selecionadoId;
                return <div key={t.id} onClick={() => selecionar(t)} className="zip-row-hover" style={{ display: "grid", gridTemplateColumns: "58px 1fr 36px", gap: 8, alignItems: "center", padding: "7px 14px", borderBottom: "1px solid var(--line2)", cursor: "pointer", background: ativo ? "var(--robg)" : undefined, opacity: t.is_active ? 1 : .55 }}>
                  <span style={{ ...zipChip(corDia(t)), justifySelf: "start" }}>{rotuloEvento(t)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.emoji} {t.titulo}</div>
                    <div style={{ fontSize: 10, color: "var(--soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{renderizar(t.corpo, t.dias_referencia, t.tipo)}</div>
                  </div>
                  <button aria-label={t.is_active ? `Desligar ${rotuloEvento(t)}` : `Ligar ${rotuloEvento(t)}`} onClick={(e) => { e.stopPropagation(); void alternar(t); }} style={{ height: 20, width: 34, borderRadius: 999, border: `1px solid ${t.is_active ? "var(--bg)" : "var(--line)"}`, background: t.is_active ? "var(--bg)" : "var(--s2)", padding: 2, display: "flex", justifyContent: t.is_active ? "flex-end" : "flex-start" }}><span style={{ width: 14, height: 14, borderRadius: 999, background: "var(--s0)" }} /></button>
                </div>;
              })}
            </div>;
          })}
        </div>
      </div>

      <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {!selecionado ? <div style={{ padding: 30, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Selecione um dia da régua para editar.</div> : <>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div><div style={rotulo}>{selecionado.tipo === "parcela_vencer" ? "Antes do vencimento" : "Parcela em atraso"}</div><h2 style={{ fontSize: 16, marginTop: 3 }}>{rotuloEvento(selecionado)}{(selecionado.dias_referencia ?? 0) >= 31 && selecionado.tipo === "parcela_atrasada" ? " · mensagem única" : ""}</h2></div>
            <span style={zipChip(selecionado.is_active ? "ok" : "neutral")}>{selecionado.is_active ? "Ligado" : "Desligado"}</span>
          </div>

          <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 9, background: "var(--s2)", alignSelf: "flex-start" }}>
            {([['uma', '1 parcela'], ['varias', '2 ou mais parcelas']] as const).map(([v, r]) => <button key={v} onClick={() => setVersao(v)} style={{ height: 26, padding: "0 12px", border: 0, borderRadius: 7, background: versao === v ? "var(--s0)" : "transparent", color: versao === v ? "var(--ink)" : "var(--soft)", fontSize: 10.5, fontWeight: 700, boxShadow: versao === v ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}>{r}</button>)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 64px", gap: 8 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: "var(--soft)" }}>Título <span style={{ fontWeight: 500 }}>({edit[campoTitulo].length}/80)</span>
              <input maxLength={80} style={{ ...fieldInput, width: "100%", marginTop: 4 }} value={edit[campoTitulo]} placeholder={versao === 'varias' ? edit.titulo : ''} onChange={(e) => setEdit({ ...edit, [campoTitulo]: e.target.value })} /></label>
            <label style={{ fontSize: 10, fontWeight: 700, color: "var(--soft)" }}>Ícone
              <input maxLength={4} style={{ ...fieldInput, width: "100%", marginTop: 4, textAlign: "center" }} value={edit.emoji} onChange={(e) => setEdit({ ...edit, emoji: e.target.value })} /></label>
          </div>
          <label style={{ fontSize: 10, fontWeight: 700, color: "var(--soft)" }}>Mensagem <span style={{ fontWeight: 500 }}>({edit[campoCorpo].length}/300)</span>
            <textarea maxLength={300} rows={4} style={{ ...fieldInput, width: "100%", height: "auto", padding: 9, marginTop: 4, lineHeight: 1.45, resize: "vertical" }} value={edit[campoCorpo]} placeholder={versao === 'varias' ? 'Vazio: usa o texto de 1 parcela.' : ''} onChange={(e) => setEdit({ ...edit, [campoCorpo]: e.target.value })} /></label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {variaveis.map((v) => <button key={v.chave} type="button" title={v.descricao} onClick={() => inserirVariavel(v.chave)} style={{ fontFamily: "var(--mono, monospace)", fontSize: 9.5, padding: "3px 7px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--s1)", color: "var(--bg)" }}>{`{{${v.chave}}}`}</button>)}
          </div>

          <div>
            <div style={{ ...rotulo, marginBottom: 6 }}>Como a cliente vê</div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 16, background: "var(--s1)", border: "1px solid var(--line)" }}>
              <div style={{ width: 34, height: 34, flex: "none", borderRadius: 9, display: "grid", placeItems: "center", background: "linear-gradient(145deg,#B0526A,#7A2632)", color: "#fff", fontSize: 16 }}>{edit.emoji || "🔔"}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 9.5, color: "var(--soft)" }}><span style={{ fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>Sra. Luck</span><span>agora</span></div>
                <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700 }}>{previaTitulo}</div>
                <div style={{ marginTop: 1, fontSize: 11.5, lineHeight: 1.4 }}>{previaCorpo}</div>
              </div>
            </div>
            <div style={{ marginTop: 5, fontSize: 9.5, color: "var(--soft)" }}>Exemplo com dados fictícios: Maria, parcela 3/12 de R$ 520,00{versao === 'varias' ? ", 2 parcelas somando R$ 1.040,00" : ""}.</div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 7, marginTop: 2 }}>
            <button onClick={restaurarPadrao} disabled={!padraoDoSelecionado} style={{ ...botao, color: "var(--soft)" }}>Restaurar texto padrão</button>
            <div style={{ display: "flex", gap: 7 }}>
              <button onClick={() => setEdit(edicaoDe(selecionado))} disabled={!alterado} style={{ ...botao, color: "var(--soft)" }}>Descartar</button>
              <button onClick={() => void salvarTexto()} disabled={!alterado || salvandoTemplate} style={{ ...botaoPrincipal, opacity: !alterado ? .55 : 1 }}>{salvandoTemplate ? "Salvando..." : "Salvar texto"}</button>
            </div>
          </div>
        </>}
      </div>
    </div>

    {/* Histórico e envio manual */}
    <div style={{ ...cartao, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 9, background: "var(--s2)" }}>
          {([['historico', `Histórico (${logs.length})`], ['manual', 'Envio manual']] as const).map(([v, r]) => <button key={v} onClick={() => setAba(v)} style={{ height: 26, padding: "0 12px", border: 0, borderRadius: 7, background: aba === v ? "var(--s0)" : "transparent", color: aba === v ? "var(--ink)" : "var(--soft)", fontSize: 10.5, fontWeight: 700 }}>{r}</button>)}
        </div>
        {aba === 'historico' && <span style={{ fontSize: 10.5, color: "var(--soft)" }}>{enviadas} enviados · últimos 30 exibidos</span>}
      </div>
      {aba === 'historico'
        ? <div style={{ maxHeight: 260, overflowY: "auto" }}>{logs.length === 0 ? <div style={{ padding: 24, textAlign: "center", fontSize: 11, color: "var(--soft)" }}>Nenhum envio registrado.</div> : logs.slice(0, 30).map((log) => <div key={log.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 130px 90px", gap: 8, padding: "8px 14px", borderBottom: "1px solid var(--line2)", alignItems: "center" }}>
            <div style={{ minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{log.clientes?.nome_completo || log.cliente_id.slice(0, 8)} <span style={{ color: "var(--soft)", fontWeight: 400 }}>· {log.titulo || log.tipo}</span></div></div>
            <div style={{ fontSize: 10, color: "var(--soft)" }} className="zip-mono">{new Date(log.created_at).toLocaleString("pt-BR")}</div>
            <span style={zipChip(log.status === "enviada" ? "ok" : log.status === "erro" || log.status === "falha" ? "bad" : "warn")}>{log.status}</span>
          </div>)}</div>
        : <form onSubmit={enviarManual} style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "minmax(200px,.7fr) 1.3fr", gap: 10 }}>
            <select style={{ ...fieldInput, width: "100%" }} value={clienteId} onChange={(e) => setClienteId(e.target.value)}><option value="">Selecione uma cliente...</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_completo}</option>)}</select>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input style={{ ...fieldInput, width: "100%" }} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título" />
              <textarea style={{ ...fieldInput, width: "100%", height: 60, padding: 8 }} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Mensagem..." />
              <div style={{ display: "flex", justifyContent: "flex-end" }}><button disabled={enviando} style={botaoPrincipal}>{enviando ? "Enviando..." : "Enviar agora"}</button></div>
            </div>
          </form>}
    </div>
  </div>;
}
