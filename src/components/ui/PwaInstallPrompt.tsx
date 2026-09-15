"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Smartphone, X } from "lucide-react";
import { toast } from "sonner";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const GLOBAL_EVENT_KEY = "__sraLuckBeforeInstallPrompt";
const PUSH_AFTER_INSTALL_KEY = "sra-luck-push-after-install";

type WindowWithInstallEvent = Window & {
  [GLOBAL_EVENT_KEY]?: BeforeInstallPromptEvent | null;
};

function isStandalone() {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone)))
  );
}

function isIOS() {
  return (
    typeof navigator !== "undefined" &&
    (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
  );
}

function prepararNotificacoesPosInstalacao(dispararEvento = false) {
  try {
    localStorage.setItem(PUSH_AFTER_INSTALL_KEY, "pending");
  } catch {}

  if (dispararEvento) {
    window.dispatchEvent(new Event("sra-luck-pwa-installed"));
  }
}

function registrarInstalacao() {
  try {
    const deviceKey = localStorage.getItem("sra-luck-device-key");
    if (!deviceKey) return;

    void fetch("/api/cliente/app-telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceKey,
        deviceType:
          window.innerWidth < 768 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop",
        displayMode: "standalone",
        isPwaInstalled: true,
        notificationPermission: "Notification" in window ? Notification.permission : "default",
        pushActive: false,
      }),
      keepalive: true,
    });
  } catch {}
}

export function PwaInstallPrompt() {
  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null);
  const [visivel, setVisivel] = useState(false);
  const [instalando, setInstalando] = useState(false);
  const [ios, setIos] = useState(false);
  const [preparando, setPreparando] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    setIos(isIOS());
    setVisivel(true);

    const recuperar = () => {
      const e = (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] ?? null;
      if (e) {
        setEvento(e);
        setPreparando(false);
      }
      if (!isStandalone()) setVisivel(true);
    };

    const receber = (event: Event) => {
      const e = event as BeforeInstallPromptEvent;
      event.preventDefault();
      (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] = e;
      setEvento(e);
      setPreparando(false);
      setVisivel(true);
    };

    const instalado = () => {
      (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] = null;
      setEvento(null);
      setVisivel(false);
      setPreparando(false);
      prepararNotificacoesPosInstalacao(true);
      registrarInstalacao();
      toast.success("Aplicativo instalado. Agora ative as notificações.");
    };

    window.addEventListener("beforeinstallprompt", receber);
    window.addEventListener("sra-luck-pwa-ready", recuperar);
    window.addEventListener("appinstalled", instalado);
    window.addEventListener("pageshow", recuperar);
    document.addEventListener("visibilitychange", recuperar);
    recuperar();

    const interval = window.setInterval(recuperar, 1000);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("beforeinstallprompt", receber);
      window.removeEventListener("sra-luck-pwa-ready", recuperar);
      window.removeEventListener("appinstalled", instalado);
      window.removeEventListener("pageshow", recuperar);
      document.removeEventListener("visibilitychange", recuperar);
    };
  }, []);

  async function instalar() {
    if (ios) {
      toast.info("No iPhone, toque em Compartilhar e depois em 'Adicionar à Tela de Início'.");
      return;
    }

    let eventoAtual = evento ?? (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] ?? null;

    if (!eventoAtual) {
      setPreparando(true);
      window.dispatchEvent(new Event("sra-luck-pwa-ready"));
      await new Promise((resolve) => setTimeout(resolve, 1200));
      eventoAtual = (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] ?? null;
    }

    if (!eventoAtual) {
      setPreparando(false);
      toast.info(
        "O Chrome ainda está preparando a instalação. Use a página por alguns segundos e toque novamente em Instalar aplicativo. Se preferir, abra o menu ⋮ do Chrome e escolha Adicionar à tela inicial.",
      );
      return;
    }

    setInstalando(true);

    try {
      await eventoAtual.prompt();
      const escolha = await eventoAtual.userChoice;

      if (escolha.outcome === "accepted") {
        prepararNotificacoesPosInstalacao(false);
        setVisivel(false);
      }

      (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] = null;
      setEvento(null);
    } catch {
      toast.error(
        "O navegador não conseguiu abrir a instalação. Tente novamente pelo botão Instalar aplicativo.",
      );
    } finally {
      setInstalando(false);
      setPreparando(false);
    }
  }

  function dispensar() {
    // A dispensa vale somente para esta visualização. Em uma nova visita o convite
    // reaparece, evitando que testes antigos ocultem indefinidamente a instalação.
    setVisivel(false);
  }

  if (!visivel || isStandalone()) return null;

  return (
    <div className="mb-4 rounded-2xl border border-burgundy/10 bg-white/95 p-4 shadow-card backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.055]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blush text-burgundy dark:bg-white/10 dark:text-[#F4D9DC]">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-burgundy dark:text-pearl">Instale o aplicativo Sra. Luck</p>
          <p className="mt-0.5 text-xs leading-relaxed text-clay/60 dark:text-pearl/55">
            {ios
              ? "No iPhone, use Compartilhar → Adicionar à Tela de Início para abrir como aplicativo."
              : evento
                ? "O aplicativo está pronto para ser instalado neste celular."
                : "Deixe esta tela aberta por alguns segundos. Assim que o Chrome liberar a instalação, toque no botão abaixo."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={instalar}
              disabled={instalando || preparando}
              className="inline-flex items-center gap-2 rounded-xl bg-burgundy px-3.5 py-2 text-xs font-semibold text-pearl disabled:opacity-60"
            >
              {instalando || preparando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {ios
                ? "Como instalar"
                : instalando
                  ? "Abrindo instalação..."
                  : preparando
                    ? "Verificando..."
                    : "Instalar aplicativo"}
            </button>
            <button
              type="button"
              onClick={dispensar}
              className="inline-flex items-center gap-2 rounded-xl border border-burgundy/10 px-3.5 py-2 text-xs font-semibold text-burgundy dark:border-white/10 dark:text-pearl"
            >
              Agora não
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Não instalar agora"
          onClick={dispensar}
          className="flex h-8 w-8 items-center justify-center rounded-full text-clay/40 hover:bg-blush dark:hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
