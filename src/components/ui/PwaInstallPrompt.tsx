"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, MoreVertical, RefreshCw, Smartphone, X } from "lucide-react";
import { toast } from "sonner";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const GLOBAL_EVENT_KEY = "__sraLuckBeforeInstallPrompt";
const PUSH_AFTER_INSTALL_KEY = "sra-luck-push-after-install";
const INSTALLED_KEY = "sra-luck-pwa-installed-v1";
const FIRST_ACCESS_MODAL_KEY = "sra-luck-pwa-install-modal-v1-seen";

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

function prepararNotificacoesPosInstalacao(dispararEvento = false) {
  try {
    localStorage.setItem(INSTALLED_KEY, "true");
    localStorage.setItem(FIRST_ACCESS_MODAL_KEY, "true");
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
        displayMode: isStandalone() ? "standalone" : "browser",
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
  const [mostrarPassos, setMostrarPassos] = useState(false);
  const [swAtivo, setSwAtivo] = useState<boolean | null>(null);

  function eventoAtual() {
    return evento ?? (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] ?? null;
  }

  async function atualizarDiagnostico() {
    if (!("serviceWorker" in navigator)) {
      setSwAtivo(false);
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      setSwAtivo(Boolean(registration?.active || registration?.waiting || registration?.installing));
    } catch {
      setSwAtivo(false);
    }
  }

  async function instalar() {
    if (isKnownInstalled()) {
      setVisivel(false);
      toast.success("O aplicativo Sra. Luck já está instalado neste celular.");
      return;
    }

    if (isIOS()) {
      setMostrarPassos(true);
      return;
    }

    const installEvent = eventoAtual();

    if (!installEvent) {
      // Não existe API que permita forçar o instalador do Chrome sem o
      // BeforeInstallPromptEvent. Mostramos o caminho nativo real do Android.
      setMostrarPassos(true);
      void atualizarDiagnostico();
      return;
    }

    setInstalando(true);

    try {
      await installEvent.prompt();
      const escolha = await installEvent.userChoice;

      (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] = null;
      setEvento(null);
      marcarModalComoVisto();

      if (escolha.outcome === "accepted") {
        prepararNotificacoesPosInstalacao(false);
        setVisivel(false);
      } else {
        setVisivel(false);
      }
    } catch {
      setMostrarPassos(true);
      toast.error("O Chrome não abriu o instalador. Use o menu do navegador para concluir a instalação.");
    } finally {
      setInstalando(false);
    }
  }

  useEffect(() => {
    if (isKnownInstalled()) return;

    setIos(isIOS());
    void atualizarDiagnostico();

    if (!modalPrimeiroAcessoJaVisto()) {
      setVisivel(true);
    }

    const recuperar = () => {
      const e = (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] ?? null;
      if (e) {
        setEvento(e);
        setMostrarPassos(false);
      }
      void atualizarDiagnostico();
    };

    const receber = (event: Event) => {
      const e = event as BeforeInstallPromptEvent;
      event.preventDefault();
      (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] = e;
      setEvento(e);
      setMostrarPassos(false);

      if (!modalPrimeiroAcessoJaVisto() && !isKnownInstalled()) {
        setVisivel(true);
      }
    };

    const instalado = () => {
      (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] = null;
      setEvento(null);
      setVisivel(false);
      setMostrarPassos(false);
      prepararNotificacoesPosInstalacao(true);
      registrarInstalacao();
      toast.success("Aplicativo instalado. Agora ative as notificações.");
    };

    const solicitarInstalacao = () => {
      if (isKnownInstalled()) {
        toast.success("O aplicativo Sra. Luck já está instalado neste celular.");
        return;
      }
      setVisivel(true);
      const e = (window as WindowWithInstallEvent)[GLOBAL_EVENT_KEY] ?? null;
      if (!e) setMostrarPassos(true);
      else void instalar();
    };

    window.addEventListener("beforeinstallprompt", receber);
    window.addEventListener("sra-luck-pwa-ready", recuperar);
    window.addEventListener("sra-luck-pwa-install-request", solicitarInstalacao);
    window.addEventListener("appinstalled", instalado);
    window.addEventListener("pageshow", recuperar);
    document.addEventListener("visibilitychange", recuperar);
    recuperar();

    return () => {
      window.removeEventListener("beforeinstallprompt", receber);
      window.removeEventListener("sra-luck-pwa-ready", recuperar);
      window.removeEventListener("sra-luck-pwa-install-request", solicitarInstalacao);
      window.removeEventListener("appinstalled", instalado);
      window.removeEventListener("pageshow", recuperar);
      document.removeEventListener("visibilitychange", recuperar);
    };
  }, []);

  function dispensar() {
    marcarModalComoVisto();
    setVisivel(false);
  }

  function recarregarVerificacao() {
    // Mantém o modal elegível para reaparecer depois do reload.
    try {
      localStorage.removeItem(FIRST_ACCESS_MODAL_KEY);
    } catch {}
    window.location.reload();
  }

  if (!visivel || isKnownInstalled()) return null;

  const prontoParaInstalar = Boolean(eventoAtual());

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

          {!mostrarPassos ? (
            <div className="mt-5 rounded-[16px] border border-[#EFE3E0] bg-[#FBF7F5] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className={`h-2 w-2 rounded-full ${prontoParaInstalar ? "bg-[#3F7D5B]" : "bg-[#D19A54]"}`} />
                <span className="text-[10.5px] font-medium text-[#5E4D49]">
                  {ios
                    ? "No iPhone, a instalação é feita pelo menu Compartilhar."
                    : prontoParaInstalar
                      ? "O Chrome está pronto para instalar o aplicativo."
                      : swAtivo === false
                        ? "O navegador ainda está preparando os recursos do aplicativo."
                        : "O Chrome ainda não liberou o instalador automático."}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-[18px] border border-[#E8D9D5] bg-[#FBF7F5] p-4">
              <div className="flex items-center gap-2 text-[#6B1F2E]">
                <MoreVertical className="h-4 w-4" />
                <span className="text-[11px] font-semibold">Instalar pelo menu do navegador</span>
              </div>
              <ol className="mt-3 space-y-2.5 text-[10.5px] leading-[1.5] text-[#665652]">
                {ios ? (
                  <>
                    <li><strong>1.</strong> Toque em <strong>Compartilhar</strong>.</li>
                    <li><strong>2.</strong> Escolha <strong>Adicionar à Tela de Início</strong>.</li>
                    <li><strong>3.</strong> Confirme em <strong>Adicionar</strong>.</li>
                  </>
                ) : (
                  <>
                    <li><strong>1.</strong> Toque nos <strong>três pontinhos ⋮</strong> no canto superior direito do Chrome.</li>
                    <li><strong>2.</strong> Escolha <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</li>
                    <li><strong>3.</strong> Confirme a instalação do <strong>Sra. Luck</strong>.</li>
                  </>
                )}
              </ol>
              {!ios && (
                <button
                  type="button"
                  onClick={recarregarVerificacao}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[11px] border border-[#D9C6C1] bg-white px-3 py-2.5 text-[10px] font-semibold text-[#6B1F2E]"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Atualizar e verificar novamente
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={instalar}
            disabled={instalando}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#6B1F2E] px-4 py-[13px] text-[12px] font-semibold text-white shadow-[0_8px_20px_rgba(107,31,46,.18)] disabled:opacity-60"
          >
            {instalando ? <Loader2 className="h-4 w-4 animate-spin" /> : prontoParaInstalar ? <Download className="h-4 w-4" /> : <MoreVertical className="h-4 w-4" />}
            {instalando
              ? "Abrindo instalação..."
              : ios
                ? "Ver como instalar"
                : prontoParaInstalar
                  ? "Instalar aplicativo"
                  : "Como instalar no Chrome"}
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
