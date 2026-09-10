"use client";

import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/admin/ExecutiveUI";

interface Item {
  cliente_id: string;
  device_type: string | null;
  display_mode: string | null;
  is_pwa_installed: boolean;
  notification_permission: string;
  push_active: boolean;
  first_access_at: string | null;
  last_access_at: string | null;
  cliente: { id: string; nome_completo: string; cpf: string; ativo: boolean };
}

const card = "rounded-2xl border border-burgundy/10 bg-white/75 p-4 shadow-[0_14px_45px_-32px_rgba(88,25,38,.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.045]";

function dataHora(value: string | null) {
  if (!value) return "Ainda não registrado";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function IconDevice({ type }: { type: string | null }) {
  if (type === "mobile") return <Smartphone className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
}

export default function MonitoramentoPage() {
  const [dados, setDados] = useState<{ dispositivos: Item[]; resumo: Item[]; metricas: Record<string, number> } | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    try {
      const res = await fetch(`/api/admin/monitoramento-app?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) throw new Error();
      setDados(await res.json());
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") carregar();
    }, 5000);
    const atualizarAoVoltar = () => {
      if (document.visibilityState === "visible") carregar();
    };
    document.addEventListener("visibilitychange", atualizarAoVoltar);
    window.addEventListener("focus", atualizarAoVoltar);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", atualizarAoVoltar);
      window.removeEventListener("focus", atualizarAoVoltar);
    };
  }, []);

  const rows = dados?.resumo ?? [];

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        eyebrow="Configurações · Aplicativo"
        title="Monitoramento de acesso"
        description="Acompanhe como cada cliente está acessando o sistema, a instalação do PWA e as notificações."
        actions={<button onClick={carregar} className="inline-flex items-center gap-2 rounded-xl border border-burgundy/10 bg-white/70 px-3 py-2 text-xs font-semibold text-burgundy transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm active:scale-[.98] dark:border-white/10 dark:bg-white/[0.04] dark:text-pearl"><RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} /> Atualizar</button>}
      />

      {carregando && !dados ? <div className="text-sm text-clay/50">Carregando monitoramento...</div> : (
        <section className={card}>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-burgundy dark:text-pearl">Clientes e dispositivos</h2>
              <p className="text-xs text-clay/45 dark:text-pearl/35">Acompanhe os acessos diretamente na lista, sem os cards intermediários.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-xs">
              <thead><tr className="border-b border-burgundy/8 text-[10px] uppercase tracking-wider text-clay/40 dark:border-white/8 dark:text-pearl/30"><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Acesso</th><th className="px-3 py-2">PWA</th><th className="px-3 py-2">Notificações</th><th className="px-3 py-2">Primeiro acesso</th><th className="px-3 py-2">Último acesso</th></tr></thead>
              <tbody>{rows.map((item) => <tr key={item.cliente_id} className="border-b border-burgundy/5 dark:border-white/5">
                <td className="px-3 py-3"><p className="font-semibold text-burgundy dark:text-pearl">{item.cliente?.nome_completo ?? "Cliente"}</p><p className="text-[10px] text-clay/40">{item.cliente?.cpf ?? ""}</p></td>
                <td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-blush/70 px-2 py-1 text-[10px] font-semibold text-burgundy dark:bg-white/8 dark:text-pearl"><IconDevice type={item.device_type} /> {item.display_mode === "standalone" ? "PWA" : item.display_mode === "browser" ? "Web" : "Sem acesso"}</span></td>
                <td className="px-3 py-3">{item.is_pwa_installed ? <span className="inline-flex items-center gap-1 font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Instalado</span> : <span className="text-clay/45">Não instalado</span>}</td>
                <td className="px-3 py-3">{item.push_active && item.notification_permission === "granted" ? <span className="font-semibold text-success">Ativas</span> : item.notification_permission === "denied" ? <span className="inline-flex items-center gap-1 font-semibold text-alert"><Ban className="h-3.5 w-3.5" /> Bloqueadas</span> : <span className="text-clay/45">Não ativadas</span>}</td>
                <td className="px-3 py-3 text-clay/55 dark:text-pearl/45">{dataHora(item.first_access_at)}</td>
                <td className="px-3 py-3 font-medium text-burgundy/75 dark:text-pearl/65">{dataHora(item.last_access_at)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {!rows.length && <p className="py-8 text-center text-sm text-clay/45">Nenhuma cliente ativa encontrada.</p>}
        </section>
      )}
    </div>
  );
}
