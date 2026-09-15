import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: Record<string, unknown>): string;
      remove(widgetId: string): void;
      reset(widgetId?: string): void;
    };
  }
}

const SCRIPT_ID = "sra-luck-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile indisponível")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile indisponível"));
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({ onToken, theme = "light" }: { onToken: (token: string | null) => void; theme?: "light" | "dark" | "auto" }) {
  const siteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!siteKey || !ref.current) { onToken(null); return; }
    let widgetId: string | null = null;
    let cancelled = false;
    void loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widgetId = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        theme,
        size: "flexible",
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    }).catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      onToken(null);
    };
  }, [onToken, siteKey, theme]);

  if (!siteKey) return null;
  return <div ref={ref} className="min-h-[65px] w-full overflow-hidden" aria-label="Verificação de segurança" />;
}
