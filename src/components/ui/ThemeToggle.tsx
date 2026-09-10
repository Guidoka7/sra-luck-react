"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/utils";

/**
 * Alternador de tema propositalmente simples: um único controle, sem o antigo
 * seletor duplo. A prop compact é usada no cabeçalho mobile/cliente.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"}
      aria-pressed={dark}
      title={dark ? "Modo claro" : "Modo escuro"}
      className={cn(
        "group inline-flex items-center justify-center rounded-xl border transition-colors duration-200",
        "border-rose/15 bg-white/75 text-burgundy hover:bg-blush/70 hover:border-rose/25",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose/25 focus-visible:ring-offset-2",
        "dark:border-white/10 dark:bg-white/[0.06] dark:text-[#F4D9DC] dark:hover:bg-white/[0.10]",
        compact ? "h-10 w-10" : "h-10 w-full gap-2.5 px-3"
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
          dark
            ? "bg-white/10 text-[#F4D9DC]"
            : "bg-blush/65 text-burgundy"
        )}
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </span>

      {!compact && (
        <span className="text-xs font-medium tracking-wide">
          {dark ? "Modo claro" : "Modo escuro"}
        </span>
      )}
    </button>
  );
}
