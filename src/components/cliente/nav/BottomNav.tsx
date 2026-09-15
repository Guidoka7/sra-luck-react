import { Bell, Compass, Home, Menu, WalletCards } from "lucide-react";
import type { ElementType } from "react";
import { cn } from "@/lib/utils";

export type ClientTab = "inicio" | "parcelas" | "jornada" | "notificacoes" | "mais";

const ITEMS: { id: ClientTab; label: string; icon: ElementType }[] = [
  { id: "inicio", label: "Início", icon: Home },
  { id: "parcelas", label: "Parcelas", icon: WalletCards },
  { id: "jornada", label: "Jornada", icon: Compass },
  { id: "notificacoes", label: "Notificações", icon: Bell },
  { id: "mais", label: "Mais", icon: Menu },
];

interface BottomNavProps {
  aba: ClientTab;
  onSelecionar: (aba: ClientTab) => void;
  naoLidas?: number;
}

export function BottomNav({ aba, onSelecionar, naoLidas = 0 }: BottomNavProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rose/12 bg-cream/97 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur-xl"
      style={{ boxShadow: "0 -12px 30px -20px rgba(46,36,34,.18)" }}
    >
      <div className="mx-auto grid w-full max-w-[30rem] grid-cols-5">
        {ITEMS.map(({ id, label, icon: Icon }) => {
          const ativo = aba === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelecionar(id)}
              aria-current={ativo ? "page" : undefined}
              className="relative flex flex-col items-center justify-center gap-1 py-2.5 text-[0.58rem] font-semibold uppercase tracking-label transition-colors duration-200"
            >
              <span className="relative">
                <Icon
                  className={cn("h-5 w-5 transition-colors duration-200", ativo ? "text-burgundy" : "text-clay/40")}
                  strokeWidth={ativo ? 2 : 1.6}
                />
                {id === "notificacoes" && naoLidas > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-alert px-1 text-[0.5rem] font-bold text-pearl">
                    {naoLidas > 9 ? "9+" : naoLidas}
                  </span>
                )}
              </span>
              <span className={cn(ativo ? "text-burgundy" : "text-clay/40")}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
