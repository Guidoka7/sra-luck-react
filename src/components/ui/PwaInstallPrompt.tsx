"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import {
  PWA_DISMISS_KEY,
  isIOSDevice,
  isPwaInstalada,
  isStandalonePwa,
  marcarPwaInstalada,
} from "@/lib/pwaInstall";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const GLOBAL_EVENT_KEY = "__sraLuckBeforeInstallPrompt";
const PWA_INSTALL_RELOAD_KEY = "sra-luck-pwa-install-reload-v1";

type WindowWithInstallPrompt = Window & {
  [GLOBAL_EVENT_KEY]?: BeforeInstallPromptEvent | null;
};

function hoje() {
  return new Date().toLocaleDateString("sv-SE");
}

const isStandalone = isStandalonePwa;
const isIOS = isIOSDevice;
const isKnownInstalled = isPwaInstalada;
const marcarInstalado = marcarPwaInstalada;

function foiDispensadoHoje() {
  try {
    return localStorage.getItem(PWA_DISMISS_KEY) === hoje();
  } catch {
    return false;
  }
}

async function aguardarPrompt(timeoutMs = 2500): Promise<BeforeInstallPromptEvent | null> {
  const existente = (window as WindowWithInstallPrompt)[GLOBAL_EVENT_KEY] ?? null;
  if (existente) return existente;

  return new Promise((resolve) => {
    let finalizado = false;

    const concluir = (evento: BeforeInstallPromptEvent | null) => {
      if (finalizado) return;
      finalizado = true;
      window.clearTimeout(timer);
      window.removeEventListener("sra-luck-pwa-ready", aoFicarPronto);
      resolve(evento);
    };

    const aoFicarPronto = () => {
      concluir((window as WindowWithInstallPrompt)[GLOBAL_EVENT_KEY] ?? null);
    };

    const timer = window.setTimeout(() => concluir(null), timeoutMs);
    window.addEventListener("sra-luck-pwa-ready", aoFicarPronto, { once: true });
  });
}

export function PwaInstallPrompt() {
  const [visivel, setVisivel] = useState(false);
  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null);
  const [instalando, setInstalando] = useState(false);
  const [ios, setIos] = useState(false);
  const [semPromptDisponivel, setSemPromptDisponivel] = useState(false);

  useEffect(() => {
    setIos(isIOS());

    if (isStandalone()) {
      marcarInstalado();
      return;
    }

    const sincronizar = () => {
      const capturado = (window as WindowWithInstallPrompt)[GLOBAL_EVENT_KEY] ?? null;
      if (capturado) {
        setEvento(capturado);
        setSemPromptDisponivel(false);
        try { sessionStorage.removeItem(PWA_INSTALL_RELOAD_KEY); } catch {}
      }
      if (!isKnownInstalled() && !foiDispensadoHoje()) setVisivel(true);
    };

    const receberPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      event.preventDefault();
      (window as WindowWithInstallPrompt)[GLOBAL_EVENT_KEY] = promptEvent;
      setEvento(promptEvent);
      setSemPromptDisponivel(false);
      try { sessionStorage.removeItem(PWA_INSTALL_RELOAD_KEY); } catch {}
      if (!foiDispensadoHoje()) setVisivel(true);
    };

    const instalado = () => {
      (window as WindowWithInstallPrompt)[GLOBAL_EVENT_KEY] = null;
      setEvento(null);
      try { sessionStorage.removeItem(PWA_INSTALL_RELOAD_KEY); } catch {}
      marcarInstalado();
      setVisivel(false);
      toast.success("Aplicativo instalado. Agora ative as notificações.");
    };

    const solicitarInstalacao = () => {
      if (isKnownInstalled()) {
        toast.success("O aplicativo Sra. Luck já está instalado neste celular.");
        return;
      }
      setVisivel(true);
      sincronizar();
    };

    window.addEventListener("beforeinstallprompt", receberPrompt);
    window.addEventListener("sra-luck-pwa-ready", sincronizar);
    window.addEventListener("appinstalled", instalado);
    window.addEventListener("sra-luck-pwa-install-request", solicitarInstalacao);
    window.addEventListener("pageshow", sincronizar);
    document.addEventListener("visibilitychange", sincronizar);

    sincronizar();

    return () => {
      window.removeEventListener("beforeinstallprompt", receberPrompt);
      window.removeEventListener("sra-luck-pwa-ready", sincronizar);
      window.removeEventListener("appinstalled", instalado);
      window.removeEventListener("sra-luck-pwa-install-request", solicitarInstalacao);
      window.removeEventListener("pageshow", sincronizar);
      document.removeEventListener("visibilitychange", sincronizar);
    };
  }, []);

  async function instalar() {
    if (isKnownInstalled()) {
      setVisivel(false);
      toast.success("O aplicativo Sra. Luck já está instalado neste celular.");
      return;
    }

    if (ios) {
      toast.info("No iPhone, toque em Compartilhar e depois em ‘Adicionar à Tela de Início’. Depois abra o ícone Sra. Luck.");
      return;
    }

    setInstalando(true);

    try {
      let promptEvent = evento ?? (window as WindowWithInstallPrompt)[GLOBAL_EVENT_KEY] ?? null;

      if (!promptEvent) {
        if ("serviceWorker" in navigator) {
          try {
            const registration = await navigator.serviceWorker.register("/simulador-iphone-sw.js", {
              scope: "/",
              updateViaCache: "none",
            });
            await registration.update().catch(() => undefined);
            await Promise.race([
              navigator.serviceWorker.ready,
              new Promise((resolve) => window.setTimeout(resolve, 2200)),
            ]);
          } catch {
            // O fallback visual abaixo continua disponível se o SW falhar.
          }
        }
        promptEvent = await aguardarPrompt(3500);
      }

      if (!promptEvent) {
        // Em alguns Androids o Chrome só reavalia a instalabilidade depois
        // que o SW assumiu controle da primeira navegação. Fazemos UMA única
        // recarga, acionada pelo clique da própria cliente, e nunca entramos
        // em loop.
        let jaRecarregou = false;
        try {
          jaRecarregou = sessionStorage.getItem(PWA_INSTALL_RELOAD_KEY) === "true";
        } catch {}

        if (!jaRecarregou) {
          try { sessionStorage.setItem(PWA_INSTALL_RELOAD_KEY, "true"); } catch {}
          window.location.reload();
          return;
        }

        toast.info("O Chrome não disponibilizou o instalador automático. Use ⋮ → Instalar aplicativo ou Adicionar à tela inicial.");
        setSemPromptDisponivel(true);
        setVisivel(true);
        return;
      }

      setSemPromptDisponivel(false);
      await promptEvent.prompt();
      const escolha = await promptEvent.userChoice;

      (window as WindowWithInstallPrompt)[GLOBAL_EVENT_KEY] = null;
      setEvento(null);

      if (escolha.outcome === "accepted") {
        // A instalação real só é confirmada pelo evento nativo "appinstalled" (ver `instalado`).
        setVisivel(false);
      } else {
        setVisivel(true);
      }
    } catch (error) {
      console.error("Falha ao abrir instalador PWA", error);
      toast.error("Não foi possível abrir a instalação. Tente novamente pelo botão Instalar aplicativo.");
      setVisivel(true);
    } finally {
      setInstalando(false);
    }
  }

  function dispensar() {
    try {
      localStorage.setItem(PWA_DISMISS_KEY, hoje());
    } catch {}
    setVisivel(false);
  }

  if (!visivel || isKnownInstalled()) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/45 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-6 backdrop-blur-[2px] sm:items-center sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-install-title"
    >
      <div className="w-full max-w-[360px] overflow-hidden rounded-[22px] border border-white/70 bg-[#FFFDFC] shadow-[0_20px_56px_rgba(38,25,23,.26)]">
        <div className="relative px-4 pb-3.5 pt-4.5 sm:px-5 sm:pb-4">
          <button
            type="button"
            aria-label="Fechar convite de instalação"
            onClick={dispensar}
            className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-full bg-[#F6EFED] text-[#8A7772] transition-colors hover:bg-[#EFE3E0]"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <div className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-[#F7E9E8] text-[#6B1F2E]">
            <Smartphone className="h-5 w-5" />
          </div>

          <p className="mt-3.5 text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#B86575]">Seu aplicativo Sra. Luck</p>
          <h2 id="pwa-install-title" className="mt-0.5 font-heading text-[22px] font-semibold leading-[1.08] text-[#2E2422]">
            Instale na tela inicial
          </h2>
          <p className="mt-2 text-[10.5px] font-light leading-[1.5] text-[#756561]">
            {ios
              ? "No iPhone, a instalação é feita pelo Safari: Compartilhar → Adicionar à Tela de Início."
              : "Instale para acessar mais rápido e receber avisos importantes."}
          </p>

          <div className="mt-3.5 rounded-[13px] border border-[#EFE3E0] bg-[#FBF7F5] px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className={`h-2 w-2 rounded-full ${evento ? "bg-[#3F7D5B]" : semPromptDisponivel ? "bg-[#B3342E]" : "bg-[#D19A54]"}`} />
              <span className="text-[9.5px] font-medium leading-[1.35] text-[#5E4D49]">
                {ios
                  ? "Use o menu Compartilhar do Safari para concluir."
                  : evento
                    ? "O Chrome está pronto para instalar o aplicativo."
                    : semPromptDisponivel
                      ? "O Chrome ainda não liberou o instalador nesta visita."
                      : "O Chrome está preparando o instalador."}
              </span>
            </div>
            {!ios && semPromptDisponivel && (
              <p className="mt-1.5 text-[9.5px] font-light leading-[1.4] text-[#8A7772]">
                Toque no menu <b>⋮</b> do Chrome (canto superior direito) e escolha <b>Instalar aplicativo</b> ou <b>Adicionar à tela inicial</b>. Depois, abra o ícone Sra. Luck pela tela inicial para ativar as notificações.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={instalar}
            disabled={instalando}
            className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#6B1F2E] px-4 py-[11px] text-[11px] font-semibold text-white shadow-[0_7px_18px_rgba(107,31,46,.16)] disabled:opacity-60"
          >
            {instalando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {instalando ? "Preparando..." : ios ? "Como instalar no iPhone" : "Instalar aplicativo"}
          </button>

          <button
            type="button"
            onClick={dispensar}
            className="mt-1.5 w-full rounded-[11px] px-4 py-2 text-[10px] font-medium text-[#8A7772]"
          >
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
}
