'use client';
import { fetchInstant, refreshInstant, invalidateInstantCache, getInstantCache } from "@/lib/instantCache";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bell, Check, Clock3, FileText, History, MessageSquare, Play, RefreshCw, Save, Send, Settings2, Users } from 'lucide-react';

type Template = { id: string; tipo: string; dias_referencia: number | null; titulo: string; corpo: string; emoji: string | null; is_active: boolean; updated_at?: string };
type Log = { id: string; cliente_id: string; tipo: string; titulo?: string; corpo?: string; status: string; erro_mensagem?: string; created_at: string; clientes?: { nome_completo?: string } };
type Cliente = { id: string; nome_completo: string; telefone?: string | null; ativo?: boolean };

type Config = { atraso_habilitado: boolean; frequencia_atraso_horas: number; max_tentativas: number };

const emptyConfig: Config = { atraso_habilitado: true, frequencia_atraso_horas: 24, max_tentativas: 3 };

function statusLabel(status: string) {
  if (status === 'enviada') return 'Enviada';
  if (status === 'erro' || status === 'falha') return 'Erro';
  return status;
}

function statusClass(status: string) {
  if (status === 'enviada') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900';
  if (status === 'erro' || status === 'falha') return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900';
  return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900';
}

export default function AdminNotificacoes() {
  const [tab, setTab] = useState<'visao' | 'automacao' | 'templates' | 'enviar' | 'logs'>('visao');
  const [config, setConfig] = useState<Config>(emptyConfig);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [atrasadas, setAtrasadas] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const [clienteId, setClienteId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);

  const [templateEdit, setTemplateEdit] = useState<Record<string, { titulo: string; corpo: string; emoji: string; is_active: boolean }>>({});

  const carregar = useCallback(async (force = false) => {
    const url = '/api/admin/notificacoes/automacao';
    const cached = !force ? getInstantCache<any>(url) : null;
    if (cached) {
      setConfig({ ...emptyConfig, ...cached.config });
      setTemplates(cached.templates ?? []);
      setLogs(cached.logs ?? []);
      setClientes(cached.clientes ?? []);
      setAtrasadas(cached.atrasadas ?? 0);
      setLoading(false);
    } else setLoading(true);
    try {
      // O cache é somente para pintura imediata. A aba sempre valida os dados
      // atuais para evitar ficar presa em uma resposta antiga/incompatível.
      const data = await refreshInstant<any>(url, { cache: 'no-store' });
      setConfig({ ...emptyConfig, ...(data?.config ?? {}) });
      setTemplates(Array.isArray(data?.templates) ? data.templates : []);
      setLogs(Array.isArray(data?.logs) ? data.logs : []);
      setClientes(Array.isArray(data?.clientes) ? data.clientes : []);
      setAtrasadas(Number(data?.atrasadas ?? 0));
    } catch (e: any) {
      if (!cached) setFeedback({ type: 'error', text: e.message || 'Falha ao carregar o painel.' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const templatesAtraso = useMemo(() => templates.filter((t) => t.tipo === 'parcela_atrasada'), [templates]);
  const enviadas = logs.filter((l) => l.status === 'enviada').length;
  const erros = logs.filter((l) => l.status === 'erro' || l.status === 'falha').length;

  async function salvarConfig() {
    setSaving(true); setFeedback(null);
    try {
      const res = await fetch('/api/admin/notificacoes/automacao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao salvar.');
      setConfig({ ...emptyConfig, ...data.config });
      setFeedback({ type: 'ok', text: 'Configurações salvas.' });
    } catch (e: any) { setFeedback({ type: 'error', text: e.message }); }
    finally { setSaving(false); }
  }

  async function executarAgora() {
    setRunning(true); setFeedback(null);
    try {
      const res = await fetch('/api/admin/notificacoes/automacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'verificar_atrasos' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha na execução.');
      setFeedback({ type: 'ok', text: `${data.enviadas ?? 0} envio(s) realizado(s), ${data.ignoradas ?? 0} já dentro do intervalo.` });
      await carregar();
    } catch (e: any) { setFeedback({ type: 'error', text: e.message }); }
    finally { setRunning(false); }
  }

  async function enviarAgoraTodas() {
    if (!window.confirm(`Enviar agora os templates de cobrança para todas as clientes que possuem parcelas vencidas e não pagas?\n\nEste envio ignora o intervalo configurado e pode gerar um novo registro mesmo que a cliente tenha recebido um aviso recentemente.`)) return;
    setSendingAll(true); setFeedback(null);
    try {
      const res = await fetch('/api/admin/notificacoes/automacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'enviar_agora_todas' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao enviar agora.');
      setFeedback({ type: 'ok', text: `Envio imediato concluído: ${data.enviadas ?? 0} notificação(ões) enviada(s), ${data.falhas ?? 0} falha(s).` });
      await carregar();
    } catch (e: any) { setFeedback({ type: 'error', text: e.message }); }
    finally { setSendingAll(false); }
  }

  function iniciarEdicao(t: Template) {
    setTemplateEdit((old) => ({ ...old, [t.id]: { titulo: t.titulo, corpo: t.corpo, emoji: t.emoji || '💬', is_active: t.is_active } }));
  }

  async function salvarTemplate(t: Template) {
    const edit = templateEdit[t.id];
    if (!edit) return;
    try {
      const res = await fetch('/api/admin/notificacoes/templates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, ...edit }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao salvar template.');
      setTemplates((old) => old.map((item) => item.id === t.id ? data.template : item));
      setTemplateEdit((old) => { const copy = { ...old }; delete copy[t.id]; return copy; });
      setFeedback({ type: 'ok', text: 'Template atualizado.' });
    } catch (e: any) { setFeedback({ type: 'error', text: e.message }); }
  }

  async function enviarManual(e: React.FormEvent) {
    e.preventDefault(); setEnviando(true); setFeedback(null);
    try {
      const res = await fetch('/api/admin/notificacoes/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId, titulo, mensagem }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha no envio.');
      const push = data.push;
      const pushTexto = push
        ? push.enviadas > 0
          ? ` Push entregue em ${push.enviadas} dispositivo(s).`
          : push.falhas > 0
            ? ` Atenção: push falhou (${push.erros?.[0] ?? 'ver logs'}).`
            : ' Nenhum dispositivo com push ativado para esta cliente.'
        : '';
      setFeedback({ type: push?.falhas > 0 ? 'error' : 'ok', text: `Notificação enviada para ${data.cliente?.nome ?? 'a cliente'}.${pushTexto}` });
      setClienteId(''); setTitulo(''); setMensagem('');
      await carregar();
    } catch (e: any) { setFeedback({ type: 'error', text: e.message }); }
    finally { setEnviando(false); }
  }

  const input = 'w-full rounded-xl border border-burgundy/10 bg-white px-3 py-2.5 text-sm text-clay outline-none transition focus:border-burgundy/35 focus:ring-2 focus:ring-burgundy/10 dark:border-white/10 dark:bg-white/[0.04] dark:text-pearl';
  const card = 'rounded-2xl border border-burgundy/10 bg-white/75 shadow-[0_12px_40px_-28px_rgba(122,38,50,.35)] backdrop-blur dark:border-white/10 dark:bg-white/[0.045]';

  return (
    <div className="min-h-full pb-8 text-clay dark:text-pearl">
      <header className="mb-5 flex flex-col gap-4 rounded-3xl border border-white/70 bg-white/75 p-5 shadow-soft backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.045] md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-burgundy text-pearl shadow-soft"><Bell className="h-5 w-5" /></div>
          <div><p className="text-xs uppercase tracking-[.25em] text-burgundy/45 dark:text-pearl/40">Gestão</p><h1 className="text-xl font-semibold text-burgundy dark:text-pearl">Notificações</h1><p className="text-xs text-clay/55 dark:text-pearl/45">Automação, mensagens e histórico em um único painel.</p></div>
        </div>
        <button onClick={() => carregar()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-burgundy/10 bg-white px-3 py-2 text-xs font-medium text-burgundy hover:bg-blush dark:border-white/10 dark:bg-white/[.05] dark:text-pearl"><RefreshCw className="h-4 w-4" /> Atualizar</button>
      </header>

      {feedback && <div className={`mb-4 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs ${feedback.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300'}`}>{feedback.type === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{feedback.text}</div>}

      <nav className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-burgundy/10 bg-white/65 p-1.5 dark:border-white/10 dark:bg-white/[.035]">
        {([['visao','Visão geral',Bell],['automacao','Automação',Settings2],['templates','Templates',FileText],['enviar','Enviar',Send],['logs','Logs',History]] as const).map(([key, label, Icon]) => <button key={key} onClick={() => setTab(key)} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition ${tab === key ? 'bg-burgundy text-pearl shadow-soft' : 'text-clay/60 hover:bg-blush/60 hover:text-burgundy dark:text-pearl/55 dark:hover:bg-white/10 dark:hover:text-pearl'}`}><Icon className="h-4 w-4" />{label}</button>)}
      </nav>

      {loading ? <div className={`${card} p-8 text-center text-sm text-clay/50 dark:text-pearl/45`}>Carregando painel...</div> : (
        <>
          {tab === 'visao' && <section className="grid gap-4 md:grid-cols-4">
            <div className={`${card} p-4`}><p className="text-[11px] uppercase tracking-wider text-clay/45 dark:text-pearl/40">Parcelas atrasadas</p><p className="mt-2 text-2xl font-semibold text-burgundy dark:text-pearl">{atrasadas}</p><p className="mt-1 text-xs text-clay/45 dark:text-pearl/40">elegíveis para verificação</p></div>
            <div className={`${card} p-4`}><p className="text-[11px] uppercase tracking-wider text-clay/45 dark:text-pearl/40">Envios registrados</p><p className="mt-2 text-2xl font-semibold text-burgundy dark:text-pearl">{enviadas}</p><p className="mt-1 text-xs text-clay/45 dark:text-pearl/40">no histórico carregado</p></div>
            <div className={`${card} p-4`}><p className="text-[11px] uppercase tracking-wider text-clay/45 dark:text-pearl/40">Erros</p><p className="mt-2 text-2xl font-semibold text-burgundy dark:text-pearl">{erros}</p><p className="mt-1 text-xs text-clay/45 dark:text-pearl/40">últimos 200 registros</p></div>
            <div className={`${card} p-4`}><p className="text-[11px] uppercase tracking-wider text-clay/45 dark:text-pearl/40">Intervalo</p><p className="mt-2 text-2xl font-semibold text-burgundy dark:text-pearl">{config.frequencia_atraso_horas}h</p><p className="mt-1 text-xs text-clay/45 dark:text-pearl/40">por parcela</p></div>
            <div className={`${card} p-5 md:col-span-4`}><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><h2 className="font-semibold text-burgundy dark:text-pearl">Status da automação</h2><p className="mt-1 text-xs text-clay/50 dark:text-pearl/45">A rotina verifica todas as clientes e respeita o intervalo configurado para cada parcela.</p></div><span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${config.atraso_habilitado ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300' : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-pearl/45'}`}><span className={`h-2 w-2 rounded-full ${config.atraso_habilitado ? 'bg-emerald-500' : 'bg-gray-400'}`} />{config.atraso_habilitado ? 'Ativa' : 'Desativada'}</span></div></div>
          </section>}

          {tab === 'automacao' && <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
            <div className={`${card} p-5`}><div className="mb-5 flex items-start justify-between"><div><h2 className="font-semibold text-burgundy dark:text-pearl">Cobrança automática de parcelas atrasadas</h2><p className="mt-1 text-xs text-clay/50 dark:text-pearl/45">Envia para todas as clientes elegíveis sem repetir antes do intervalo.</p></div><Clock3 className="h-5 w-5 text-burgundy/45" /></div>
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-burgundy/10 bg-burgundy/[.025] p-3 dark:border-white/10 dark:bg-white/[.025]"><span><span className="block text-sm font-medium">Ativar automação</span><span className="text-xs text-clay/45 dark:text-pearl/40">Somente parcelas vencidas e não pagas.</span></span><input type="checkbox" checked={config.atraso_habilitado} onChange={e => setConfig({ ...config, atraso_habilitado: e.target.checked })} className="h-5 w-5 accent-[#7A2632]" /></label>
              <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-medium">Reenviar a cada<select className={`${input} mt-1`} value={config.frequencia_atraso_horas} onChange={e => setConfig({ ...config, frequencia_atraso_horas: Number(e.target.value) })}><option value={6}>6 horas</option><option value={12}>12 horas</option><option value={24}>24 horas</option><option value={48}>48 horas</option><option value={72}>72 horas</option></select></label><label className="text-xs font-medium">Máx. tentativas por ciclo<input className={`${input} mt-1`} type="number" min={1} max={10} value={config.max_tentativas} onChange={e => setConfig({ ...config, max_tentativas: Number(e.target.value) })} /></label></div>
              <button onClick={salvarConfig} disabled={saving} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-burgundy px-4 py-2.5 text-xs font-semibold text-pearl shadow-soft disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Salvando...' : 'Salvar configuração'}</button>
            </div>
            <div className={`${card} p-5`}><h3 className="font-semibold text-burgundy dark:text-pearl">Execução</h3><p className="mt-1 text-xs text-clay/50 dark:text-pearl/45">Use a verificação normal para respeitar o intervalo ou force um envio imediato para todas as clientes elegíveis.</p><div className="mt-5 grid gap-2"><button onClick={executarAgora} disabled={running || sendingAll} className="flex w-full items-center justify-center gap-2 rounded-xl border border-burgundy/15 bg-burgundy/[.04] px-4 py-3 text-xs font-semibold text-burgundy hover:bg-blush disabled:opacity-50 dark:border-white/10 dark:bg-white/[.04] dark:text-pearl"><Play className="h-4 w-4" />{running ? 'Verificando...' : 'Verificar atrasos agora'}</button><button onClick={enviarAgoraTodas} disabled={running || sendingAll || atrasadas === 0} className="flex w-full items-center justify-center gap-2 rounded-xl bg-burgundy px-4 py-3 text-xs font-semibold text-pearl shadow-soft hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" />{sendingAll ? 'Enviando para todas...' : 'Enviar agora para todas com atraso'}</button></div><p className="mt-3 text-[11px] leading-relaxed text-clay/45 dark:text-pearl/40">Envia imediatamente para todas as clientes com parcela vencida e não paga, ignorando o intervalo de reenvio. A ação fica registrada nos logs.</p><div className="mt-4 rounded-xl bg-burgundy/[.035] p-3 text-xs text-clay/55 dark:bg-white/[.03] dark:text-pearl/45"><strong className="text-clay dark:text-pearl">Automático:</strong><br />o worker roda a cada 30 minutos e respeita o intervalo configurado para cada parcela.</div></div>
          </section>}

          {tab === 'templates' && <section className="space-y-3">{templatesAtraso.map(t => { const edit = templateEdit[t.id]; return <div key={t.id} className={`${card} p-4`}><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blush/60 text-lg">{edit?.emoji ?? t.emoji ?? '💬'}</span><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-burgundy dark:text-pearl">{t.dias_referencia}º dia de atraso</h3><span className="rounded-full border border-burgundy/10 px-2 py-0.5 text-[10px] text-clay/45 dark:border-white/10 dark:text-pearl/40">parcela atrasada</span></div><p className="mt-1 text-xs text-clay/45 dark:text-pearl/40">Você pode usar: {'{{cliente}}'}, {'{{parcela}}'}, {'{{total}}'}, {'{{valor}}'}, {'{{dias_atraso}}'}, {'{{vencimento}}'}</p></div></div>{!edit && <button onClick={() => iniciarEdicao(t)} className="rounded-xl border border-burgundy/10 px-3 py-2 text-xs font-medium text-burgundy hover:bg-blush dark:border-white/10 dark:text-pearl">Editar</button>}</div>{edit && <div className="mt-4 grid gap-3"><div className="grid gap-3 sm:grid-cols-[70px_1fr]"><input className={input} value={edit.emoji} onChange={e => setTemplateEdit({ ...templateEdit, [t.id]: { ...edit, emoji: e.target.value } })} /><input className={input} value={edit.titulo} onChange={e => setTemplateEdit({ ...templateEdit, [t.id]: { ...edit, titulo: e.target.value } })} /></div><textarea className={`${input} min-h-[100px] resize-y`} value={edit.corpo} onChange={e => setTemplateEdit({ ...templateEdit, [t.id]: { ...edit, corpo: e.target.value } })} /><div className="flex gap-2"><button onClick={() => salvarTemplate(t)} className="inline-flex items-center gap-2 rounded-xl bg-burgundy px-3 py-2 text-xs font-semibold text-pearl"><Save className="h-4 w-4" />Salvar</button><button onClick={() => setTemplateEdit(({ [t.id]: _, ...rest }) => rest)} className="rounded-xl border border-burgundy/10 px-3 py-2 text-xs text-clay dark:border-white/10 dark:text-pearl">Cancelar</button></div></div>}</div> })}</section>}

          {tab === 'enviar' && <section className="grid gap-4 lg:grid-cols-[.75fr_1.25fr]"><div className={`${card} p-5`}><div className="mb-4 flex items-center gap-3"><Users className="h-5 w-5 text-burgundy/55" /><div><h2 className="font-semibold text-burgundy dark:text-pearl">Destinatária</h2><p className="text-xs text-clay/45 dark:text-pearl/40">Envio individual imediato.</p></div></div><select className={input} value={clienteId} onChange={e => setClienteId(e.target.value)}><option value="">Selecione uma cliente...</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.nome_completo}</option>)}</select></div><form onSubmit={enviarManual} className={`${card} p-5`}><div className="mb-4 flex items-center gap-3"><MessageSquare className="h-5 w-5 text-burgundy/55" /><div><h2 className="font-semibold text-burgundy dark:text-pearl">Mensagem manual</h2><p className="text-xs text-clay/45 dark:text-pearl/40">Campo estável, sem perder o foco enquanto você digita.</p></div></div><div className="space-y-3"><input className={input} value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Título da notificação" /><textarea className={`${input} min-h-[160px] resize-y`} value={mensagem} onChange={e => setMensagem(e.target.value)} placeholder="Digite a mensagem..." /> <div className="flex justify-end"><button disabled={enviando} className="inline-flex items-center gap-2 rounded-xl bg-burgundy px-4 py-2.5 text-xs font-semibold text-pearl disabled:opacity-50"><Send className="h-4 w-4" />{enviando ? 'Enviando...' : 'Enviar agora'}</button></div></div></form></section>}

          {tab === 'logs' && <section className={`${card} overflow-hidden`}><div className="flex items-center justify-between border-b border-burgundy/10 px-4 py-3 dark:border-white/10"><div><h2 className="font-semibold text-burgundy dark:text-pearl">Histórico de envios</h2><p className="text-xs text-clay/45 dark:text-pearl/40">Quem recebeu, quando e qual foi o resultado.</p></div><span className="text-xs text-clay/45 dark:text-pearl/40">{logs.length} registros</span></div><div className="divide-y divide-burgundy/5 dark:divide-white/5">{logs.length === 0 ? <div className="p-8 text-center text-sm text-clay/45 dark:text-pearl/40">Nenhum envio registrado.</div> : logs.map(log => <div key={log.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_130px_120px] md:items-center"><div className="min-w-0"><p className="truncate text-sm font-medium text-clay dark:text-pearl">{log.clientes?.nome_completo || log.cliente_id.slice(0, 8)} <span className="font-normal text-clay/40 dark:text-pearl/35">· {log.tipo}</span></p><p className="truncate text-xs text-clay/45 dark:text-pearl/40">{log.titulo || log.erro_mensagem || 'Sem título'}</p></div><p className="text-xs text-clay/45 dark:text-pearl/40">{new Date(log.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p><span className={`w-fit rounded-full border px-2 py-1 text-[10px] font-semibold uppercase ${statusClass(log.status)}`}>{statusLabel(log.status)}</span></div>)}</div></section>}
        </>
      )}
    </div>
  );
}
