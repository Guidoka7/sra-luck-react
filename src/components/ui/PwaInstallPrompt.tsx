"use client";

import { useEffect, useState } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  PWA_DISMISS_KEY,
  isIOSDevice,
  isPwaInstalada,
  isStandalonePwa,
  marcarPwaInstalada,
} from "@/lib/pwaInstall";
import "@/styles/convite-app.css";

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

  const ponto = ios || evento ? "sl-convite-ponto--ok" : semPromptDisponivel ? "sl-convite-ponto--alerta" : "";

  return (
    <div className="sl-convite-fundo" onClick={(e) => { if (e.target === e.currentTarget && !instalando) dispensar(); }}>
      <div className="sl-convite" role="dialog" aria-modal="true" aria-labelledby="pwa-install-title">
        <div className="sl-convite-icone" aria-hidden><Smartphone className="h-7 w-7" /></div>
        <h2 id="pwa-install-title" className="sl-convite-titulo">Instale na tela inicial</h2>
        <p className="sl-convite-texto">
          {ios
            ? "No iPhone, a instalação é feita pelo Safari: Compartilhar → Adicionar à Tela de Início."
            : "Instale para acessar mais rápido e receber avisos importantes."}
        </p>

        <div className="sl-convite-status">
          <div className="sl-convite-status-linha">
            <span className={`sl-convite-ponto ${ponto}`} />
            <span>
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
            <p>
              Toque no menu <b>⋮</b> do Chrome (canto superior direito) e escolha <b>Instalar aplicativo</b> ou <b>Adicionar à tela inicial</b>. Depois, abra o ícone Sra. Luck pela tela inicial para ativar as notificações.
            </p>
          )}
        </div>

        <div className="sl-convite-acoes">
        <button type="button" className="sl-convite-principal" onClick={instalar} disabled={instalando}>
          {instalando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {instalando ? "Preparando..." : ios ? "Como instalar no iPhone" : "Instalar aplicativo"}
        </button>
        <button type="button" className="sl-convite-secundario" onClick={dispensar}>
          Agora não
        </button>
        </div>
      </div>
    </div>
  );
}
