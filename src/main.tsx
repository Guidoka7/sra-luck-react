import { lazy, StrictMode, Suspense, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { LoginPage } from "./pages/LoginPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { SessionGate } from "./features/auth/SessionGate";
import { ThemeProvider } from "./components/ui/ThemeProvider";
import { AppErrorBoundary } from "./components/ui/AppErrorBoundary";
import { PwaRegister } from "./components/ui/PwaRegister";
import { instalarMonitoramentoGlobal } from "./lib/monitoramento";
import { limparFlagsPwaAntigas } from "./lib/pwaInstall";
import { AdminAppearanceBootstrap } from "./features/admin/AdminModuleShell";
import AdminLayout from "./app/admin/(painel)/layout";
import "./app/globals.css";
import "./styles/typography.css";
import "./styles/client-prototype.css";
import "./styles/client-prototype-overrides.css";
import "./styles/client-dark.generated.css";
import "./styles/client-dark.css";
import "./styles/client-topo.css";
import "./styles/admin-desktop.css";
import "./styles/admin-refinements.css";
import "./styles/staff-real.css";
import { MARK_SRC } from "@/assets/brand";

const AgendaPage = lazy(() => import("./pages/AgendaPage").then((m) => ({ default: m.AgendaPage })));
const StaffPwa = lazy(() => import("./features/staff/StaffPwa").then((m) => ({ default: m.StaffPwa })));
const StaffLoginPage = lazy(() => import("./features/staff/StaffLoginPage").then((m) => ({ default: m.StaffLoginPage })));
const AdminWorkspace = lazy(() => import("./features/admin/AdminWorkspace").then((m) => ({ default: m.AdminWorkspace })));
const VisaoGeralPage = lazy(() => import("./pages/AdminDashboardPage"));
const PrevisoesPage = lazy(() => import("./app/admin/(painel)/previsoes/page"));
const AgendaAdminPage = lazy(() => import("./app/admin/(painel)/agenda/page"));
const ClientesPage = lazy(() => import("./app/admin/(painel)/clientes/page"));
const FinanceiroPage = lazy(() => import("./app/admin/(painel)/financeiro/page"));
const FinanceiroAvancado = lazy(() => import("./features/financeiro/AdminFinanceiro"));
const RelatoriosPage = lazy(() => import("./app/admin/(painel)/relatorios/page"));
const ClubeAdminPage = lazy(() => import("./app/admin/(painel)/clube/page"));

function CarregandoRota() {
  return <div className="flex min-h-[50vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-burgundy/20 border-t-burgundy" /></div>;
}

function RedirectTo({ to }: { to: string }) {
  useEffect(() => {
    window.history.replaceState({}, "", to);
    window.dispatchEvent(new Event("app:navigate"));
  }, [to]);
  return null;
}

function AdminRoute({ path }: { path: string }) {
  if (path === "/admin" || path === "/admin/") return <RedirectTo to="/admin/visao-geral" />;
  if (path.startsWith("/admin/liberacoes")) return <RedirectTo to="/admin/agenda?aba=liberacao" />;
  if (path.startsWith("/admin/pagamentos")) return <RedirectTo to="/admin/financeiro/avancado?aba=validacao" />;
  if (path.startsWith("/admin/parcelas")) return <RedirectTo to="/admin/financeiro/avancado?aba=recebiveis" />;

  let conteudo: ReactNode;
  if (path.startsWith("/admin/visao-geral")) conteudo = <VisaoGeralPage />;
  else if (path.startsWith("/admin/previsoes")) conteudo = <PrevisoesPage />;
  else if (path.startsWith("/admin/agenda")) conteudo = <AgendaAdminPage />;
  else if (path.startsWith("/admin/clientes")) conteudo = <ClientesPage />;
  else if (path.startsWith("/admin/financeiro/avancado")) conteudo = <FinanceiroAvancado />;
  else if (path.startsWith("/admin/financeiro")) conteudo = <FinanceiroPage />;
  else if (path.startsWith("/admin/relatorios")) conteudo = <RelatoriosPage />;
  else if (path.startsWith("/admin/clube")) conteudo = <ClubeAdminPage />;
  else if (path.startsWith("/admin/equipe")) conteudo = <AdminWorkspace />;
  else if (path.startsWith("/admin/integracoes")) conteudo = <AdminWorkspace />;
  else if (path.startsWith("/admin/notificacoes")) conteudo = <AdminWorkspace />;
  else if (path.startsWith("/admin/configuracoes")) conteudo = <AdminWorkspace />;
  else conteudo = <VisaoGeralPage />;

  return <Suspense fallback={<CarregandoRota />}>{conteudo}</Suspense>;
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
    return <SessionGate audience="cliente"><PwaRegister /><Suspense fallback={<CarregandoRota />}><AgendaPage /></Suspense></SessionGate>;
  }
  if (path === "/equipe/login") return <Suspense fallback={<CarregandoRota />}><StaffLoginPage /></Suspense>;
  if (path === "/equipe" || path.startsWith("/equipe/")) return <SessionGate audience="equipe"><PwaRegister /><Suspense fallback={<CarregandoRota />}><StaffPwa /></Suspense></SessionGate>;
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
        <img src={MARK_SRC} alt="Sra. Luck" className="mx-auto mb-4 h-12 w-12" />
        <h1 className="text-xl font-semibold text-burgundy">Página não encontrada</h1>
        <p className="mt-2 text-sm text-clay/60">A área solicitada não existe neste portal.</p>
        <a href="/login" className="mt-5 inline-flex rounded-full bg-burgundy px-5 py-2.5 text-xs uppercase tracking-label text-pearl">Ir para o login</a>
      </section>
    </main>
  );
}

limparFlagsPwaAntigas();
const cleanupMonitoramento = instalarMonitoramentoGlobal();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AppErrorBoundary>
        <App />
        <Toaster position="top-center" richColors closeButton />
      </AppErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);

void cleanupMonitoramento;
