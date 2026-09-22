import { motion } from "framer-motion";

export type ClientTab = "inicio" | "parcelas" | "notificacoes" | "mais";

interface BottomNavProps {
  aba: ClientTab;
  onSelecionar: (aba: ClientTab) => void;
  naoLidas?: number;
}

function Icone({ id }: { id: ClientTab }) {
  if (id === "inicio") return <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeLinejoin="round"><path d="M4 9.5 11 4l7 5.5V18H4z"/><path d="M9 18v-5h4v5"/></svg>;
  if (id === "parcelas") return <svg viewBox="0 0 22 22" fill="none" stroke="currentColor"><rect x="3.5" y="4.5" width="15" height="5" rx="1.8"/><rect x="3.5" y="12.5" width="15" height="5" rx="1.8"/></svg>;
  if (id === "notificacoes") return <svg viewBox="0 0 22 22" fill="none" stroke="currentColor"><path d="M6 9.4a5 5 0 0 1 10 0v3.4l1.4 2.4H4.6L6 12.8z"/><path d="M9.2 17.4a2 2 0 0 0 3.6 0"/></svg>;
  return <svg viewBox="0 0 22 22" fill="none" stroke="currentColor"><path d="M4 7h14M4 11h14M4 15h9"/></svg>;
}

const ITEMS: { id: ClientTab; label: string }[] = [
  { id: "inicio", label: "Início" },
  { id: "parcelas", label: "Parcelas" },
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
            className={`sl-bottom-item ${ativo ? "active" : ""}`}
          >
            <span className="relative flex h-[21px] w-[21px] items-center justify-center">
              {ativo && (
                <>
                  <motion.span
                    layoutId="sl-bottom-active-glow"
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-[6px] z-0 rounded-full"
                    style={{
                      background: "radial-gradient(circle, rgba(182,91,103,.13) 0%, rgba(182,91,103,.055) 48%, rgba(182,91,103,0) 76%)",
                    }}
                    transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.64 }}
                  />
                  <motion.span
                    layoutId="sl-bottom-active-mark"
                    aria-hidden="true"
                    className="pointer-events-none absolute -bottom-[4px] left-[2px] right-[2px] z-[1] h-[1.5px] rounded-full bg-[#B65B67]/65"
                    transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.6 }}
                  />
                </>
              )}

              <span className="relative z-[1] flex items-center justify-center">
                <Icone id={id} />
              </span>
            </span>

            <span className="relative z-[1]">{label}</span>
            {id === "notificacoes" && naoLidas > 0 && <span className="sl-nav-badge z-[2]">{naoLidas}</span>}
          </button>
        );
      })}
    </nav>
  );
}
