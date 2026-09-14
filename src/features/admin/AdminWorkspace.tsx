"use client";

import { useState } from "react";
import { Bell, Cable, Gauge, Settings2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminSettingsPanel } from "./AdminSettingsPanel";
import AdminNotificacoes from "@/app/admin/(painel)/notificacoes/page";
import MonitoramentoPage from "@/app/admin/(painel)/configuracoes/monitoramento/page";
import EquipeAdminPage from "@/app/admin/(painel)/equipe/page";
import IntegracoesAdminPage from "@/app/admin/(painel)/integracoes/page";

type AbaWorkspace = "geral" | "notificacoes" | "monitoramento" | "equipe" | "integracoes";

const ABAS: Array<{ id: AbaWorkspace; label: string; icon: typeof Settings2 }> = [
  { id: "geral", label: "Geral", icon: Settings2 },
  { id: "notificacoes", label: "Notificações", icon: Bell },
  { id: "monitoramento", label: "Monitoramento", icon: Gauge },
  { id: "equipe", label: "Equipe", icon: Users },
  { id: "integracoes", label: "Integrações", icon: Cable },
];

function abaDaUrl(): AbaWorkspace {
  const path = window.location.pathname;
  if (path.startsWith("/admin/notificacoes")) return "notificacoes";
  if (path === "/admin/configuracoes/monitoramento") return "monitoramento";
  if (path.startsWith("/admin/equipe")) return "equipe";
  if (path.startsWith("/admin/integracoes")) return "integracoes";
  const aba = new URLSearchParams(window.location.search).get("aba");
  return ABAS.some((a) => a.id === aba) ? (aba as AbaWorkspace) : "geral";
}

/**
 * Workspace unificado de Configurações (Fase 7): Geral / Notificações /
 * Monitoramento / Equipe / Integrações como abas de uma única tela, sem
 * navegação de página — cada aba renderiza o componente real já existente
 * (nenhuma lógica de negócio foi duplicada ou reescrita aqui). Rotas antigas
 * (/admin/equipe, /admin/integracoes, /admin/notificacoes,
 * /admin/configuracoes/monitoramento) continuam funcionando e abrem
 * diretamente na aba correspondente.
 */
export function AdminWorkspace() {
  const [aba, setAba] = useState<AbaWorkspace>(abaDaUrl);

  function navegar(novaAba: AbaWorkspace) {
    setAba(novaAba);
    window.history.replaceState({}, "", `/admin/configuracoes?aba=${novaAba}`);
  }

  return <div className="space-y-4 pb-8">
    <nav aria-label="Seções de Configurações" className="flex gap-1 overflow-x-auto rounded-2xl border border-white/70 bg-white/70 p-1.5 shadow-sm dark:border-white/8 dark:bg-[#171519]/80">
      {ABAS.map((item) => <button key={item.id} type="button" onClick={() => navegar(item.id)} className={cn("inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-[.11em] transition", aba === item.id ? "bg-burgundy text-cream shadow-sm dark:bg-[#7f3546]" : "text-clay/52 hover:bg-blush/60 hover:text-burgundy dark:text-white/45 dark:hover:bg-white/6 dark:hover:text-cream")}><item.icon className="h-3.5 w-3.5" />{item.label}</button>)}
    </nav>

    <div hidden={aba !== "geral"}><AdminSettingsPanel /></div>
    <div hidden={aba !== "notificacoes"}><AdminNotificacoes /></div>
    <div hidden={aba !== "monitoramento"}><MonitoramentoPage /></div>
    <div hidden={aba !== "equipe"}><EquipeAdminPage /></div>
    <div hidden={aba !== "integracoes"}><IntegracoesAdminPage /></div>
  </div>;
}
