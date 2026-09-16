import { motion } from "framer-motion";

export type ClientTab = "inicio" | "parcelas" | "jornada" | "notificacoes" | "mais";

interface BottomNavProps {
  aba: ClientTab;
  onSelecionar: (aba: ClientTab) => void;
  naoLidas?: number;
}

function Icone({ id }: { id: ClientTab }) {
  if (id === "inicio") return <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeLinejoin="round"><path d="M4 9.5 11 4l7 5.5V18H4z"/><path d="M9 18v-5h4v5"/></svg>;
  if (id === "parcelas") return <svg viewBox="0 0 22 22" fill="none" stroke="currentColor"><rect x="3.5" y="4.5" width="15" height="5" rx="1.8"/><rect x="3.5" y="12.5" width="15" height="5" rx="1.8"/></svg>;
  if (id === "jornada") return <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2"/><circle cx="16" cy="11" r="2"/><circle cx="8" cy="17" r="2"/><path d="M7.8 6.8c2.5.4 4.3 1.7 6.3 3.1M14.4 12.5c-1.4 1.8-2.8 3-4.7 3.8"/></svg>;
  if (id === "notificacoes") return <svg viewBox="0 0 22 22" fill="none" stroke="currentColor"><path d="M6 9.4a5 5 0 0 1 10 0v3.4l1.4 2.4H4.6L6 12.8z"/><path d="M9.2 17.4a2 2 0 0 0 3.6 0"/></svg>;
  return <svg viewBox="0 0 22 22" fill="none" stroke="currentColor"><path d="M4 7h14M4 11h14M4 15h9"/></svg>;
}

const ITEMS: { id: ClientTab; label: string }[] = [
  { id: "inicio", label: "Início" },
  { id: "parcelas", label: "Parcelas" },
  { id: "jornada", label: "Jornada" },
  { id: "notificacoes", label: "Notificações" },
  { id: "mais", label: "Mais" },
];

export function BottomNav({ aba, onSelecionar, naoLidas = 0 }: BottomNavProps) {
  return (
    <nav className="sl-bottom-nav" aria-label="Navegação principal">
      {ITEMS.map(({ id, label }) => {
        const ativo = aba === id;

        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelecionar(id)}
            aria-current={ativo ? "page" : undefined}
            className={`sl-bottom-item isolate overflow-visible ${ativo ? "active" : ""}`}
          >
            {ativo && (
              <>
                <motion.span
                  layoutId="sl-bottom-active-glow"
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1/2 top-[-7px] z-0 h-[48px] w-[64px] -translate-x-1/2 rounded-full"
                  style={{
                    background: "radial-gradient(ellipse at center, rgba(182,91,103,.14) 0%, rgba(182,91,103,.065) 44%, rgba(182,91,103,0) 74%)",
                  }}
                  transition={{ type: "spring", stiffness: 360, damping: 32, mass: 0.7 }}
                />
                <motion.span
                  layoutId="sl-bottom-active-mark"
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-[-4px] left-1/2 z-0 h-[2px] w-[18px] -translate-x-1/2 rounded-full bg-[#B65B67]/70"
                  transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.62 }}
                />
              </>
            )}

            <span className="relative z-[1] flex items-center justify-center">
              <Icone id={id} />
            </span>
            <span className="relative z-[1]">{label}</span>
            {id === "notificacoes" && naoLidas > 0 && <span className="sl-nav-badge z-[2]">{naoLidas}</span>}
          </button>
        );
      })}
    </nav>
  );
}
