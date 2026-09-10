"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, CircleX, Activity, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/admin/ExecutiveUI";

interface Item { cliente_id: string; device_type: string | null; display_mode: string | null; is_pwa_installed: boolean; notification_permission: string; push_active: boolean; first_access_at: string | null; last_access_at: string | null; cliente: { id: string; nome_completo: string; cpf: string; ativo: boolean }; }
interface Erro { id: string; criado_em: string; origem: string; nivel: string; rota: string | null; metodo: string | null; status_http: number | null; codigo: string | null; mensagem: string; stack: string | null; componente: string | null; request_id: string | null; ambiente: string | null; detalhes: Record<string, unknown>; }
interface Check { nome: string; ok: boolean; detalhe: string; ms: number; }

const card = "rounded-2xl border border-burgundy/10 bg-white/75 p-4 shadow-[0_14px_45px_-32px_rgba(88,25,38,.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.045]";
function dataHora(value: string | null) { if (!value) return "Ainda não registrado"; return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
function IconDevice({ type }: { type: string | null }) { return type === "mobile" ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />; }

export default function MonitoramentoPage() {
  const [dados, setDados] = useState<{ dispositivos: Item[]; resumo: Item[]; metricas: Record<string, number> } | null>(null);
  const [erros, setErros] = useState<{ resumo: { ultimaHora: number; ultimas24h: number; criticos24h: number; totalCarregado: number }; topRotas: { rota: string; total: number }[]; eventos: Erro[] } | null>(null);
  const [diagnostico, setDiagnostico] = useState<{ ok: boolean; geradoEm: string; checks: Check[] } | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    try {
      const headers = { "Cache-Control": "no-cache" };
      const [appRes, erroRes, diagRes] = await Promise.all([
        fetch(`/api/admin/monitoramento-app?t=${Date.now()}`, { cache: "no-store", headers }),
        fetch(`/api/admin/monitoramento-erros?t=${Date.now()}`, { cache: "no-store", headers }),
        fetch(`/api/admin/diagnostico?t=${Date.now()}`, { cache: "no-store", headers }),
      ]);
      if (appRes.ok) setDados(await appRes.json());
      if (erroRes.ok) setErros(await erroRes.json());
      if (diagRes.ok) setDiagnostico(await diagRes.json());
    } finally { setCarregando(false); }
  }

  useEffect(() => {
    carregar();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") carregar(); }, 10000);
    const atualizar = () => { if (document.visibilityState === "visible") carregar(); };
    document.addEventListener("visibilitychange", atualizar); window.addEventListener("focus", atualizar);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", atualizar); window.removeEventListener("focus", atualizar); };
  }, []);

  const rows = dados?.resumo ?? [];
  const statusGeral = diagnostico?.ok !== false && (erros?.resumo.criticos24h ?? 0) === 0;

  return (
    <div className="space-y-4 pb-8">
      <PageHeader eyebrow="Configurações · Operações" title="Monitoramento do sistema" description="Detecta falhas de frontend, APIs, banco e integrações e mantém um histórico técnico para investigação." actions={<button onClick={carregar} className="inline-flex items-center gap-2 rounded-xl border border-burgundy/10 bg-white/70 px-3 py-2 text-xs font-semibold text-burgundy dark:border-white/10 dark:bg-white/[0.04] dark:text-pearl"><RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} /> Atualizar</button>} />

      <section className="grid grid-cols-4 gap-3">
        <div className={card}><div className="flex items-center gap-2 text-xs font-semibold text-clay/50"><Activity className="h-4 w-4" /> Saúde geral</div><p className={`mt-2 text-lg font-semibold ${statusGeral ? "text-success" : "text-alert"}`}>{statusGeral ? "Operacional" : "Atenção necessária"}</p></div>
        <div className={card}><p className="text-[10px] uppercase tracking-wider text-clay/40">Erros · última hora</p><p className="mt-2 text-2xl font-semibold text-burgundy">{erros?.resumo.ultimaHora ?? "—"}</p></div>
        <div className={card}><p className="text-[10px] uppercase tracking-wider text-clay/40">Eventos · 24 horas</p><p className="mt-2 text-2xl font-semibold text-burgundy">{erros?.resumo.ultimas24h ?? "—"}</p></div>
        <div className={card}><p className="text-[10px] uppercase tracking-wider text-clay/40">Críticos · 24 horas</p><p className={`mt-2 text-2xl font-semibold ${(erros?.resumo.criticos24h ?? 0) ? "text-alert" : "text-success"}`}>{erros?.resumo.criticos24h ?? "—"}</p></div>
      </section>

      <section className={card}>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-burgundy dark:text-pearl">Diagnóstico automático</h2><p className="text-xs text-clay/45 dark:text-pearl/35">Testa conexões essenciais diretamente no Worker e no Supabase.</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${diagnostico?.ok ? "bg-success/10 text-success" : "bg-alert/10 text-alert"}`}>{diagnostico?.ok ? "Tudo OK" : diagnostico ? "Falha detectada" : "Aguardando"}</span></div>
        <div className="grid grid-cols-3 gap-2">{(diagnostico?.checks ?? []).map((check) => <div key={check.nome} className="rounded-xl border border-burgundy/8 px-3 py-2 dark:border-white/8"><div className="flex items-center gap-2">{check.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <CircleX className="h-4 w-4 text-alert" />}<span className="text-xs font-semibold text-burgundy dark:text-pearl">{check.nome}</span></div><p className="mt-1 truncate text-[10px] text-clay/45">{check.ok ? `${check.detalhe} · ${check.ms} ms` : check.detalhe}</p></div>)}</div>
      </section>

      <section className={card}>
        <div className="mb-3"><h2 className="text-sm font-semibold text-burgundy dark:text-pearl">Falhas detectadas</h2><p className="text-xs text-clay/45 dark:text-pearl/35">Eventos capturados automaticamente no navegador e nas chamadas da API.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-xs"><thead><tr className="border-b border-burgundy/8 text-[10px] uppercase tracking-wider text-clay/40 dark:border-white/8"><th className="px-3 py-2">Quando</th><th className="px-3 py-2">Nível</th><th className="px-3 py-2">Origem</th><th className="px-3 py-2">Rota</th><th className="px-3 py-2">HTTP</th><th className="px-3 py-2">Erro</th></tr></thead><tbody>{(erros?.eventos ?? []).map((e) => <tr key={e.id} className="border-b border-burgundy/5 dark:border-white/5"><td className="px-3 py-3 whitespace-nowrap text-clay/55">{dataHora(e.criado_em)}</td><td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${e.nivel === "critical" ? "bg-alert/10 text-alert" : e.nivel === "warning" ? "bg-amber-500/10 text-amber-700" : "bg-burgundy/8 text-burgundy"}`}><AlertTriangle className="h-3 w-3" />{e.nivel}</span></td><td className="px-3 py-3">{e.origem}</td><td className="max-w-[240px] truncate px-3 py-3 font-medium text-burgundy/70 dark:text-pearl/65">{e.rota || "—"}</td><td className="px-3 py-3">{e.status_http ?? "—"}</td><td className="max-w-[420px] truncate px-3 py-3 text-clay/65 dark:text-pearl/55" title={e.mensagem}>{e.codigo ? `[${e.codigo}] ` : ""}{e.mensagem}</td></tr>)}</tbody></table></div>
        {!(erros?.eventos?.length) && <p className="py-7 text-center text-sm text-success/80">Nenhum erro registrado no período carregado.</p>}
      </section>

      <section className={card}><div className="mb-3"><h2 className="text-sm font-semibold text-burgundy dark:text-pearl">Rotas com mais falhas · últimas 24h</h2></div><div className="grid grid-cols-2 gap-2">{(erros?.topRotas ?? []).map((item) => <div key={item.rota} className="flex items-center justify-between rounded-xl border border-burgundy/8 px-3 py-2 text-xs dark:border-white/8"><span className="truncate text-clay/65">{item.rota}</span><strong className="ml-3 text-burgundy">{item.total}</strong></div>)}</div></section>

      <section className={card}>
        <div className="mb-3"><h2 className="text-sm font-semibold text-burgundy dark:text-pearl">Clientes e dispositivos</h2><p className="text-xs text-clay/45 dark:text-pearl/35">Acompanhe acessos, instalação do PWA e notificações.</p></div>
        {carregando && !dados ? <div className="text-sm text-clay/50">Carregando monitoramento...</div> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead><tr className="border-b border-burgundy/8 text-[10px] uppercase tracking-wider text-clay/40 dark:border-white/8"><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Acesso</th><th className="px-3 py-2">PWA</th><th className="px-3 py-2">Notificações</th><th className="px-3 py-2">Primeiro acesso</th><th className="px-3 py-2">Último acesso</th></tr></thead><tbody>{rows.map((item) => <tr key={item.cliente_id} className="border-b border-burgundy/5 dark:border-white/5"><td className="px-3 py-3"><p className="font-semibold text-burgundy dark:text-pearl">{item.cliente?.nome_completo ?? "Cliente"}</p><p className="text-[10px] text-clay/40">{item.cliente?.cpf ?? ""}</p></td><td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-blush/70 px-2 py-1 text-[10px] font-semibold text-burgundy dark:bg-white/8 dark:text-pearl"><IconDevice type={item.device_type} /> {item.display_mode === "standalone" ? "PWA" : item.display_mode === "browser" ? "Web" : "Sem acesso"}</span></td><td className="px-3 py-3">{item.is_pwa_installed ? <span className="inline-flex items-center gap-1 font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Instalado</span> : <span className="text-clay/45">Não instalado</span>}</td><td className="px-3 py-3">{item.push_active && item.notification_permission === "granted" ? <span className="font-semibold text-success">Ativas</span> : item.notification_permission === "denied" ? <span className="inline-flex items-center gap-1 font-semibold text-alert"><Ban className="h-3.5 w-3.5" /> Bloqueadas</span> : <span className="text-clay/45">Não ativadas</span>}</td><td className="px-3 py-3 text-clay/55 dark:text-pearl/45">{dataHora(item.first_access_at)}</td><td className="px-3 py-3 font-medium text-burgundy/75 dark:text-pearl/65">{dataHora(item.last_access_at)}</td></tr>)}</tbody></table></div>}
        {!rows.length && !carregando && <p className="py-8 text-center text-sm text-clay/45">Nenhuma cliente ativa encontrada.</p>}
      </section>
    </div>
  );
}
