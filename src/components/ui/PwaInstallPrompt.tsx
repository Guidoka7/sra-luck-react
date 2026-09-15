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

  useEffect(() => {
    setIos(isIOS());

    if (isStandalone()) {
      marcarInstalado();
      return;
    }

    const sincronizar = () => {
      const capturado = (window as WindowWithInstallPrompt)[GLOBAL_EVENT_KEY] ?? null;
      if (capturado) setEvento(capturado);
      if (!isKnownInstalled() && !foiDispensadoHoje()) setVisivel(true);
    };

    const instalado = () => {
      (window as WindowWithInstallPrompt)[GLOBAL_EVENT_KEY] = null;
      setEvento(null);
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

    window.addEventListener("sra-luck-pwa-ready", sincronizar);
    window.addEventListener("appinstalled", instalado);
    window.addEventListener("sra-luck-pwa-install-request", solicitarInstalacao);
    window.addEventListener("pageshow", sincronizar);
    document.addEventListener("visibilitychange", sincronizar);

    sincronizar();

    return () => {
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
          await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((resolve) => window.setTimeout(resolve, 1800)),
          ]).catch(() => undefined);
        }
        promptEvent = await aguardarPrompt();
      }

      if (!promptEvent) {
        toast.info("O Chrome ainda não liberou o instalador. Mantenha esta tela aberta por alguns segundos e tente novamente; se necessário use ⋮ → Adicionar à tela inicial.");
        setVisivel(true);
        return;
      }

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
      <div className="w-full max-w-[420px] overflow-hidden rounded-[28px] border border-white/70 bg-[#FFFDFC] shadow-[0_24px_70px_rgba(38,25,23,.28)]">
        <div className="relative px-5 pb-5 pt-6 sm:px-6 sm:pb-6">
          <button
            type="button"
            aria-label="Fechar convite de instalação"
            onClick={dispensar}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-[#F6EFED] text-[#8A7772] transition-colors hover:bg-[#EFE3E0]"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#F7E9E8] text-[#6B1F2E]">
            <Smartphone className="h-7 w-7" />
          </div>

          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#B86575]">Seu aplicativo Sra. Luck</p>
          <h2 id="pwa-install-title" className="mt-1 font-heading text-[27px] font-semibold leading-[1.08] text-[#2E2422]">
            Instale na tela inicial
          </h2>
          <p className="mt-3 text-[12px] font-light leading-[1.6] text-[#756561]">
            {ios
              ? "No iPhone, a instalação é feita pelo Safari: Compartilhar → Adicionar à Tela de Início."
              : "Instale diretamente por esta tela. Depois da instalação, vamos pedir autorização para receber notificações importantes."}
          </p>

          <div className="mt-5 rounded-[16px] border border-[#EFE3E0] bg-[#FBF7F5] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className={`h-2 w-2 rounded-full ${evento ? "bg-[#3F7D5B]" : "bg-[#D19A54]"}`} />
              <span className="text-[10.5px] font-medium text-[#5E4D49]">
                {ios
                  ? "Use o menu Compartilhar do Safari para concluir."
                  : evento
                    ? "O Chrome está pronto para instalar o aplicativo."
                    : "O Chrome está preparando o instalador."}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={instalar}
            disabled={instalando}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#6B1F2E] px-4 py-[13px] text-[12px] font-semibold text-white shadow-[0_8px_20px_rgba(107,31,46,.18)] disabled:opacity-60"
          >
            {instalando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {instalando ? "Preparando..." : ios ? "Como instalar no iPhone" : "Instalar aplicativo"}
          </button>

          <button
            type="button"
            onClick={dispensar}
            className="mt-2.5 w-full rounded-[13px] px-4 py-3 text-[11px] font-medium text-[#8A7772]"
          >
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
}
