"use client";

import { useState } from "react";
import { Bell, Cable, Gauge, Settings2, Users } from "lucide-react";
import "@/styles/admin-zip.css";
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

  return <div className="zip-admin">
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "2px 2px 14px" }}>
      <div><h1 style={{ fontSize: 27 }}>Configurações</h1><p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--soft)", maxWidth: "68ch" }}>Centralize preferências da operação, Web Push, monitoramento, equipe e conexões do sistema.</p></div>
    </div>

    <nav aria-label="Seções de Configurações" style={{ display: "flex", gap: 5, padding: 3, borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", width: "fit-content", maxWidth: "100%", overflow: "auto", marginBottom: 14, boxShadow: "0 12px 28px -25px rgba(122,38,50,.3)" }}>
      {ABAS.map((item) => { const on = aba === item.id; return <button key={item.id} type="button" onClick={() => navegar(item.id)} style={{ display: "flex", alignItems: "center", gap: 7, height: 31, padding: "0 13px", borderRadius: 9, border: on ? "1px solid var(--line)" : "1px solid transparent", background: on ? "var(--s0)" : "transparent", color: on ? "var(--ink)" : "var(--soft)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}><item.icon className="h-3.5 w-3.5" />{item.label}</button>; })}
    </nav>

    <div hidden={aba !== "geral"}><AdminSettingsPanel /></div>
    <div hidden={aba !== "notificacoes"}><AdminNotificacoes /></div>
    <div hidden={aba !== "monitoramento"}><MonitoramentoPage /></div>
    <div hidden={aba !== "equipe"}><EquipeAdminPage /></div>
    <div hidden={aba !== "integracoes"}><IntegracoesAdminPage /></div>
  </div>;
}
