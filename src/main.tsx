import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LoginPage } from "./pages/LoginPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AgendaPage } from "./pages/AgendaPage";
import { StaffPwa } from "./features/staff/StaffPwa";
import { StaffLoginPage } from "./features/staff/StaffLoginPage";
import { SessionGate } from "./features/auth/SessionGate";
import { ThemeProvider } from "./components/ui/ThemeProvider";
import { AppErrorBoundary } from "./components/ui/AppErrorBoundary";
import { PwaRegister } from "./components/ui/PwaRegister";
import { instalarMonitoramentoGlobal } from "./lib/monitoramento";
import { AdminAppearanceBootstrap } from "./features/admin/AdminModuleShell";
import { AdminSettingsPanel } from "./features/admin/AdminSettingsPanel";
import AdminLayout from "./app/admin/(painel)/layout";
import VisaoGeralPage from "./app/admin/(painel)/visao-geral/page";
import AgendaAdminPage from "./app/admin/(painel)/agenda/page";
import ClientesPage from "./app/admin/(painel)/clientes/page";
import PagamentosPage from "./app/admin/(painel)/pagamentos/page";
import ParcelasPage from "./app/admin/(painel)/parcelas/page";
import RelatoriosPage from "./app/admin/(painel)/relatorios/page";
import EquipeAdminPage from "./app/admin/(painel)/equipe/page";
import AdminNotificationsPanel from "./app/admin/(painel)/notificacoes/page";
import AdminMonitoringPanel from "./app/admin/(painel)/configuracoes/monitoramento/page";
import "./app/globals.css";
import "./styles/typography.css";
import "./styles/admin-desktop.css";
import "./styles/admin-refinements.css";
import "./styles/staff-real.css";

function RedirectTo({ to }: { to: string }) {
  useEffect(() => {
    window.history.replaceState({}, "", to);
    window.dispatchEvent(new Event("app:navigate"));
  }, [to]);
  return null;
}

function AdminUnavailableModule({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-burgundy/10 bg-white/80 p-7 text-center shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
      <h1 className="font-heading text-2xl text-burgundy dark:text-pearl">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-clay/55 dark:text-pearl/45">
        Este módulo novo ainda está em integração com o backend. Dados simulados e botões sem ação foram retirados do runtime para não parecerem funções prontas.
      </p>
    </div>
  );
}

function AdminRoute({ path }: { path: string }) {
  if (path === "/admin" || path === "/admin/") return <RedirectTo to="/admin/visao-geral" />;
  if (path.startsWith("/admin/visao-geral")) return <VisaoGeralPage />;
  if (path.startsWith("/admin/liberacoes")) return <RedirectTo to="/admin/agenda?aba=liberacao" />;
  if (path.startsWith("/admin/agenda")) return <AgendaAdminPage />;
  if (path.startsWith("/admin/clientes")) return <ClientesPage />;
  if (path.startsWith("/admin/financeiro") || path.startsWith("/admin/pagamentos")) return <PagamentosPage />;
  if (path.startsWith("/admin/parcelas")) return <ParcelasPage />;
  if (path.startsWith("/admin/relatorios")) return <RelatoriosPage />;
  if (path.startsWith("/admin/equipe")) return <EquipeAdminPage />;
  if (path.startsWith("/admin/notificacoes")) return <AdminNotificationsPanel />;
  if (path === "/admin/configuracoes/monitoramento") return <AdminMonitoringPanel />;
  if (path.startsWith("/admin/configuracoes")) return <AdminSettingsPanel />;
  if (path.startsWith("/admin/integracoes")) return <AdminUnavailableModule title="Integrações" />;
  return <VisaoGeralPage />;
}

function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onNavigate = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onNavigate);
    window.addEventListener("app:navigate", onNavigate);
    return () => {
      window.removeEventListener("popstate", onNavigate);
      window.removeEventListener("app:navigate", onNavigate);
    };
  }, []);

  useEffect(() => {
    if (path === "/") {
      window.history.replaceState({}, "", "/login");
      setPath("/login");
    }
  }, [path]);

  if (path === "/login") return <LoginPage />;
  if (path === "/agenda" || path === "/app" || path === "/cliente" || path === "/agenda-legado") {
    return <SessionGate audience="cliente"><PwaRegister /><AgendaPage /></SessionGate>;
  }
  if (path === "/equipe/login") return <StaffLoginPage />;
  if (path === "/equipe" || path.startsWith("/equipe/")) return <SessionGate audience="equipe"><PwaRegister /><StaffPwa /></SessionGate>;
  if (path === "/admin/login") return <AdminLoginPage />;
  if (path === "/admin" || path === "/admin/" || path.startsWith("/admin/")) {
    return (
      <SessionGate audience="admin">
        <AdminAppearanceBootstrap />
        <AdminLayout>
          <AdminRoute path={path} />
        </AdminLayout>
      </SessionGate>
    );
  }

  return (
    <main className="min-h-screen bg-bloom px-6 flex items-center justify-center">
      <section className="surface-glass luxury-ring max-w-md rounded-3xl p-8 text-center">
        <img src="/brand/sra-luck-mark.png" alt="Sra. Luck" className="mx-auto mb-4 h-12 w-12" />
        <h1 className="text-xl font-semibold text-burgundy">Página não encontrada</h1>
        <p className="mt-2 text-sm text-clay/60">A área solicitada não existe neste portal.</p>
        <a href="/login" className="mt-5 inline-flex rounded-full bg-burgundy px-5 py-2.5 text-xs uppercase tracking-label text-pearl">Ir para o login</a>
      </section>
    </main>
  );
}

const cleanupMonitoramento = instalarMonitoramentoGlobal();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);

void cleanupMonitoramento;
