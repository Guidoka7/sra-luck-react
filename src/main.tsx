import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgendaPage } from "./pages/AgendaPage";
import { LoginPage } from "./pages/LoginPage";
import "./app/globals.css";

function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (path === "/") {
      window.history.replaceState({}, "", "/login");
      setPath("/login");
    }
  }, [path]);

  if (path === "/login") return <LoginPage />;
  if (path === "/agenda") return <AgendaPage />;

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
