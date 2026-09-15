"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone, X } from "lucide-react";
import { toast } from "sonner";

const INSTALLED_KEY = "sra-luck-pwa-installed-v1";
const FIRST_ACCESS_MODAL_KEY = "sra-luck-pwa-install-modal-v2-seen";

function isStandalone() {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone)))
  );
}

function isKnownInstalled() {
  if (isStandalone()) return true;
  try {
    return localStorage.getItem(INSTALLED_KEY) === "true";
  } catch {
    return false;
  }
}

function modalPrimeiroAcessoJaVisto() {
  try {
    return localStorage.getItem(FIRST_ACCESS_MODAL_KEY) === "true";
  } catch {
    return false;
  }
}

function marcarModalComoVisto() {
  try {
    localStorage.setItem(FIRST_ACCESS_MODAL_KEY, "true");
  } catch {}
}

function abrirInstaladorDedicado() {
  marcarModalComoVisto();
  try {
    sessionStorage.setItem("sra-luck-install-return", "/agenda");
  } catch {}
  window.location.assign("/simulador-iphone.html?return=%2Fagenda");
}

export function PwaInstallPrompt() {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (isKnownInstalled()) return;

    if (!modalPrimeiroAcessoJaVisto()) {
      setVisivel(true);
    }

    const instalado = () => {
      try {
        localStorage.setItem(INSTALLED_KEY, "true");
      } catch {}
      setVisivel(false);
    };

    const solicitarInstalacao = () => {
      if (isKnownInstalled()) {
        toast.success("O aplicativo Sra. Luck já está instalado neste celular.");
        return;
      }
      abrirInstaladorDedicado();
    };

    window.addEventListener("appinstalled", instalado);
    window.addEventListener("sra-luck-pwa-installed", instalado);
    window.addEventListener("sra-luck-pwa-install-request", solicitarInstalacao);

    return () => {
      window.removeEventListener("appinstalled", instalado);
      window.removeEventListener("sra-luck-pwa-installed", instalado);
      window.removeEventListener("sra-luck-pwa-install-request", solicitarInstalacao);
    };
  }, []);

  function instalar() {
    if (isKnownInstalled()) {
      setVisivel(false);
      toast.success("O aplicativo Sra. Luck já está instalado neste celular.");
      return;
    }
    abrirInstaladorDedicado();
  }

  function dispensar() {
    marcarModalComoVisto();
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
            Tenha acesso mais rápido à sua jornada, parcelas e avisos. Depois da instalação, vamos pedir sua autorização para receber notificações importantes.
          </p>

          <div className="mt-5 rounded-[16px] border border-[#EFE3E0] bg-[#FBF7F5] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-[#3F7D5B]" />
              <span className="text-[10.5px] font-medium text-[#5E4D49]">
                Vamos abrir o instalador dedicado do Sra. Luck.
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={instalar}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#6B1F2E] px-4 py-[13px] text-[12px] font-semibold text-white shadow-[0_8px_20px_rgba(107,31,46,.18)]"
          >
            <Download className="h-4 w-4" />
            Instalar aplicativo
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
