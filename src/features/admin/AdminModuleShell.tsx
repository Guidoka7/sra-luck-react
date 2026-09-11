import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3, Bell, CalendarDays, CircleDollarSign, FileCheck2, LayoutDashboard, Link2, LogOut, Menu,
  Settings, UserCog, Users, WalletCards, X,
} from "lucide-react";
import { ThemeToggle } from "../../components/ui/ThemeToggle";
import { aplicarPaleta, lerPaletaLocal, paletaDeConfiguracoes, salvarPaletaLocal } from "./adminAppearance";

const NAV = [
  ["/admin/visao-geral", "Visão Geral", LayoutDashboard],
  ["/admin/agenda", "Agenda", CalendarDays],
  ["/admin/clientes", "Clientes & Contratos", Users],
  ["/admin/liberacoes", "Liberações", FileCheck2],
  ["/admin/financeiro", "Financeiro", CircleDollarSign],
  ["/admin/parcelas", "Parcelas & Boletos", WalletCards],
  ["/admin/integracoes", "Integrações", Link2],
  ["/admin/relatorios", "Relatórios", BarChart3],
  ["/admin/equipe", "Equipe", UserCog],
  ["/admin/notificacoes", "Notificações", Bell],
  ["/admin/configuracoes", "Configurações", Settings],
] as const;

function navigate(href: string) {
  window.history.pushState({}, "", href);
  window.dispatchEvent(new Event("app:navigate"));
}

export function AdminAppearanceBootstrap() {
  useEffect(() => {
    const local = lerPaletaLocal();
    aplicarPaleta(local);
    const controller = new AbortController();
    fetch("/api/admin/configuracoes", { cache: "no-store", credentials: "include", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ configuracoes?: Record<string, unknown> }> : null)
      .then((payload) => {
        const server = paletaDeConfiguracoes(payload?.configuracoes);
        if (server) salvarPaletaLocal(server);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return null;
}

export function AdminThemeDock() {
  return <div className="sl-theme-dock" aria-label="Preferências de aparência"><ThemeToggle compact /></div>;
}

export function AdminModuleShell({ path, title, children }: { path: string; title: string; children: ReactNode }) {
  const [mobile, setMobile] = useState(false);
  const current = useMemo(() => NAV.find(([href]) => path.startsWith(href))?.[1] ?? title, [path, title]);

  async function logout() {
    try { await fetch("/api/admin/logout", { method: "POST", credentials: "include" }); }
    finally { navigate("/admin/login"); }
  }

  return (
    <div className="sl-admin sl-admin-refined">
      <AdminAppearanceBootstrap />
      <aside className={mobile ? "open" : ""}>
        <div className="sl-brand">
          <img src="/brand/sra-luck-logo.png" alt="Sra. Luck" />
          <span>Crédito que realiza</span>
        </div>
        <nav>
          {NAV.map(([href, label, Icon]) => (
            <button key={href} type="button" className={path.startsWith(href) ? "active" : ""} onClick={() => { navigate(href); setMobile(false); }}>
              <Icon size={18} /><span>{label}</span>{label === "Notificações" && <b>•</b>}
            </button>
          ))}
        </nav>
        <div className="sl-sidebar-quote">Mais conquistas<br />para mais histórias.</div>
        <button className="sl-logout" type="button" onClick={() => void logout()}><LogOut size={17} /> Sair</button>
      </aside>

      <div className="sl-admin-main">
        <button className="sl-mobile-menu" type="button" aria-label={mobile ? "Fechar menu" : "Abrir menu"} onClick={() => setMobile((value) => !value)}>
          {mobile ? <X /> : <Menu />}
        </button>
        <div className="sl-top-mini">
          <span>{current}</span>
          <div className="sl-top-actions">
            <ThemeToggle compact />
            <Bell size={18} />
            <span className="sl-user-dot">SL</span>
            <strong>Administração</strong>
          </div>
        </div>
        <main>{children}</main>
      </div>
    </div>
  );
}
