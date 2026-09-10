import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgendaPage } from "./pages/AgendaPage";
import { LoginPage } from "./pages/LoginPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AdminVisaoGeralPage } from "./pages/AdminVisaoGeralPage";
import AdminLayout from "./app/admin/(painel)/layout";
import AdminAgendaPage from "./app/admin/(painel)/agenda/page";
import AdminClientesPage from "./app/admin/(painel)/clientes/page";
import AdminPagamentosPage from "./app/admin/(painel)/pagamentos/page";
import AdminParcelasPage from "./app/admin/(painel)/parcelas/page";
import AdminRelatoriosPage from "./app/admin/(painel)/relatorios/page";
import AdminConfiguracoesPage from "./app/admin/(painel)/configuracoes/page";
import MonitoramentoPage from "./app/admin/(painel)/configuracoes/monitoramento/page";
import AdminNotificacoesPage from "./app/admin/(painel)/notificacoes/page";
import { ThemeProvider } from "./components/ui/ThemeProvider";
import { PwaRegister } from "./components/ui/PwaRegister";
import "./app/globals.css";
import "./styles/typography.css";
import "./styles/admin-desktop.css";

function AdminPanelRoute({ path }: { path: string }) {
  const normalized = path.replace(/\/+$/, "") || "/admin/visao-geral";
  let page: React.ReactNode;
  switch (normalized) {
    case "/admin/agenda": page = <AdminAgendaPage />; break;
    case "/admin/clientes": page = <AdminClientesPage />; break;
    case "/admin/pagamentos": page = <AdminPagamentosPage />; break;
    case "/admin/parcelas": page = <AdminParcelasPage />; break;
    case "/admin/relatorios": page = <AdminRelatoriosPage />; break;
    case "/admin/notificacoes": page = <AdminNotificacoesPage />; break;
    case "/admin/configuracoes/monitoramento": page = <MonitoramentoPage />; break;
    case "/admin/configuracoes": page = <AdminConfiguracoesPage />; break;
    case "/admin/visao-geral":
    default: page = <AdminVisaoGeralPage />; break;
  }
  return <AdminLayout>{page}</AdminLayout>;
}

function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onNavigate = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onNavigate);
    window.addEventListener("app:navigate", onNavigate);
    return () => { window.removeEventListener("popstate", onNavigate); window.removeEventListener("app:navigate", onNavigate); };
  }, []);
  useEffect(() => { if (path === "/") { window.history.replaceState({}, "", "/login"); setPath("/login"); } }, [path]);
  if (path === "/login") return <LoginPage />;
  if (path === "/agenda") return <><PwaRegister /><AgendaPage /></>;
  if (path === "/admin/login") return <AdminLoginPage />;
  if (path === "/admin" || path === "/admin/" || path.startsWith("/admin/")) return <AdminPanelRoute path={path} />;
  return <main className="min-h-screen bg-bloom px-6 flex items-center justify-center"><section className="surface-glass luxury-ring max-w-md rounded-3xl p-8 text-center"><img src="/brand/sra-luck-mark.png" alt="Sra. Luck" className="mx-auto mb-4 h-12 w-12" /><h1 className="text-xl font-semibold text-burgundy">Página não encontrada</h1><p className="mt-2 text-sm text-clay/60">A área solicitada não existe neste portal.</p><a href="/login" className="mt-5 inline-flex rounded-full bg-burgundy px-5 py-2.5 text-xs uppercase tracking-label text-pearl">Ir para o login</a></section></main>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
