import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app/globals.css";

function App() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bloom px-6">
      <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-rose/10 blur-3xl animate-drift" />
      <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-burgundy/8 blur-3xl animate-drift" style={{ animationDelay: "2s" }} />

      <div className="relative z-10 flex max-w-2xl flex-col items-center text-center animate-fadeUp">
        <img
          src="/brand/sra-luck-mark.png"
          alt="Sra. Luck"
          className="mb-5 h-16 w-16 object-contain drop-shadow-[0_4px_10px_rgba(122,38,50,0.22)]"
        />
        <img
          src="/brand/sra-luck-logo.png"
          alt="Sra. Luck — Cirurgia Programada"
          className="h-auto w-full max-w-[340px] object-contain drop-shadow-[0_6px_18px_rgba(122,38,50,0.16)]"
        />

        <p className="mt-8 max-w-xl text-balance text-lg leading-8 text-clay/72 sm:text-xl">
          Uma experiência elegante, acolhedora e intuitiva para conduzir cada etapa
          do agendamento com a sofisticação da identidade Sra. Luck.
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <a
            href="/login"
            className="inline-flex items-center justify-center rounded-full bg-burgundy px-8 py-3.5 text-sm font-medium uppercase tracking-[0.18em] text-pearl shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:bg-burgundy-light"
          >
            Acessar minha agenda
          </a>
          <a
            href="/admin/login"
            className="inline-flex items-center justify-center rounded-full border border-burgundy/15 bg-white/70 px-8 py-3.5 text-sm font-medium uppercase tracking-[0.18em] text-burgundy shadow-soft transition-all duration-300 hover:-translate-y-0.5"
          >
            Administração
          </a>
        </div>

        <div className="mt-12 rounded-full border border-burgundy/10 bg-white/55 px-5 py-2 text-xs uppercase tracking-[0.18em] text-clay/55 backdrop-blur">
          React + Vite · Cloudflare Workers · Supabase
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
