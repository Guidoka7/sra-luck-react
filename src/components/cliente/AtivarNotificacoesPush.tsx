"use client";

import { useEffect, useState } from "react";
import { Bell, Loader2, X } from "lucide-react";
import { toast } from "sonner";

const DISMISS_KEY = "sra-luck-push-prompt-dismissed-date";
const PUSH_AFTER_INSTALL_KEY = "sra-luck-push-after-install";
const INSTALLED_KEY = "sra-luck-pwa-installed-v1";

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

function foiDispensadoHoje() {
  try {
    return localStorage.getItem(DISMISS_KEY) === hoje();
  } catch {
    return false;
  }
}

function temSolicitacaoPosInstalacao() {
  try {
    return localStorage.getItem(PUSH_AFTER_INSTALL_KEY) === "pending";
  } catch {
    return false;
  }
}

function limparSolicitacaoPosInstalacao() {
  try {
    localStorage.removeItem(PUSH_AFTER_INSTALL_KEY);
  } catch {}
}

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
    return localStorage.getItem(INSTALLED_KEY) === "true" || temSolicitacaoPosInstalacao();
  } catch {
    return temSolicitacaoPosInstalacao();
  }
}

function fluxoDeNotificacoesDisponivel() {
  return isKnownInstalled();
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function obterDeviceKey() {
  const key = "sra-luck-device-key";
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, value);
  }
  return value;
}

async function atualizarTelemetria(pushActive: boolean) {
  try {
    const deviceKey = obterDeviceKey();
    await fetch("/api/cliente/app-telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceKey,
        deviceType:
          window.innerWidth < 768 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop",
        displayMode: isStandalone() ? "standalone" : "browser",
        isPwaInstalled: isKnownInstalled(),
        notificationPermission: Notification.permission,
        pushActive,
      }),
      keepalive: true,
    });
  } catch {}
}

export function AtivarNotificacoesPush() {
  const [visivel, setVisivel] = useState(false);
  const [ativando, setAtivando] = useState(false);
  const [ativo, setAtivo] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);

  async function ativar() {
    if (!fluxoDeNotificacoesDisponivel()) {
      toast.info("Instale o aplicativo antes de ativar as notificações.");
      window.dispatchEvent(new Event("sra-luck-pwa-install-request"));
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      toast.error("Este navegador não oferece suporte às notificações do aplicativo.");
      return;
    }

    if (!window.isSecureContext) {
      toast.error("Para receber notificações, abra o aplicativo em uma conexão segura.");
      return;
    }

    if (Notification.permission === "denied") {
      setBloqueado(true);
      setVisivel(true);
      toast.error("As notificações estão bloqueadas nas configurações do celular/navegador.");
      return;
    }

    setAtivando(true);

    try {
      let permission = Notification.permission;
      if (permission === "default") {
        // requestPermission() acontece diretamente a partir do clique da cliente.
        permission = await Notification.requestPermission();
      }

      if (permission !== "granted") {
        await atualizarTelemetria(false);
        setBloqueado(permission === "denied");
        setVisivel(true);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();

      if (!subscription) {
        const keyRes = await fetch("/api/cliente/push/vapid", { cache: "no-store" });
        const keyData = await keyRes.json().catch(() => ({}));
        if (!keyRes.ok || !keyData?.publicKey) {
          throw new Error(keyData?.erro ?? "Servidor de notificações não configurado.");
        }

        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
        });
      }

      const deviceKey = obterDeviceKey();
      const saveRes = await fetch("/api/cliente/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON(), deviceKey }),
      });
      const saveData = await saveRes.json().catch(() => ({}));

      if (!saveRes.ok) {
        throw new Error(saveData?.erro ?? "Não foi possível registrar este celular.");
      }

      limparSolicitacaoPosInstalacao();
      await atualizarTelemetria(true);
      setAtivo(true);
      setVisivel(false);
      setBloqueado(false);
      window.dispatchEvent(new Event("sra-luck-push-updated"));
      toast.success("🔔 Notificações ativadas neste celular.");
    } catch (error: any) {
      await atualizarTelemetria(false);
      toast.error(error?.message ?? "Não foi possível ativar as notificações.");
    } finally {
      setAtivando(false);
    }
  }

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return;
    }

    let cancelado = false;

    async function sincronizarAssinaturaPendente() {
      try {
        const raw = localStorage.getItem("sra-luck-pending-push-subscription");
        if (!raw) return false;

        const subscription = JSON.parse(raw);
        if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
          return false;
        }

        const deviceKey = obterDeviceKey();
        const response = await fetch("/api/cliente/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription, deviceKey }),
        });

        if (response.ok) {
          localStorage.removeItem("sra-luck-pending-push-subscription");
          limparSolicitacaoPosInstalacao();
          if (!cancelado) setAtivo(true);
          await atualizarTelemetria(true);
          window.dispatchEvent(new Event("sra-luck-push-updated"));
          return true;
        }
      } catch {}

      return false;
    }

    async function verificarAssinatura() {
      if (!fluxoDeNotificacoesDisponivel()) return;
      if (await sincronizarAssinaturaPendente()) return;

      if (Notification.permission === "granted") {
        try {
          const reg = await navigator.serviceWorker.ready;
          const subscription = await reg.pushManager.getSubscription();
          if (subscription) {
            limparSolicitacaoPosInstalacao();
            if (!cancelado) setAtivo(true);
            await atualizarTelemetria(true);
            window.dispatchEvent(new Event("sra-luck-push-updated"));
            return;
          }
        } catch {}
      }

      await atualizarTelemetria(false);

      if (cancelado) return;

      if (Notification.permission === "denied") {
        setBloqueado(true);
        if (!foiDispensadoHoje()) setVisivel(true);
        return;
      }

      setBloqueado(false);
      if (!foiDispensadoHoje()) setVisivel(true);
    }

    const iniciarAposInstalacao = () => {
      try {
        localStorage.setItem(INSTALLED_KEY, "true");
      } catch {}
      setVisivel(true);
      void verificarAssinatura();
    };

    const solicitarNotificacoes = () => {
      setVisivel(true);
      void ativar();
    };

    const verificarAoRetomar = () => {
      if (document.visibilityState === "visible") {
        void verificarAssinatura();
      }
    };

    window.addEventListener("sra-luck-pwa-installed", iniciarAposInstalacao);
    window.addEventListener("sra-luck-push-request", solicitarNotificacoes);
    window.addEventListener("pageshow", iniciarAposInstalacao);
    document.addEventListener("visibilitychange", verificarAoRetomar);

    void verificarAssinatura();

    return () => {
      cancelado = true;
      window.removeEventListener("sra-luck-pwa-installed", iniciarAposInstalacao);
      window.removeEventListener("sra-luck-push-request", solicitarNotificacoes);
      window.removeEventListener("pageshow", iniciarAposInstalacao);
      document.removeEventListener("visibilitychange", verificarAoRetomar);
    };
  }, []);

  function dispensar() {
    try {
      localStorage.setItem(DISMISS_KEY, hoje());
    } catch {}
    setVisivel(false);
  }

  if (ativo || !visivel || !fluxoDeNotificacoesDisponivel()) return null;

  return (
    <div className="mb-4 rounded-2xl border border-burgundy/10 bg-white/95 p-4 shadow-card dark:border-white/10 dark:bg-white/[0.055]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blush text-burgundy dark:bg-white/10 dark:text-[#F4D9DC]">
          <Bell className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-burgundy dark:text-pearl">
            {bloqueado ? "Notificações bloqueadas" : "Receba avisos no celular"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-clay/60 dark:text-pearl/55">
            {bloqueado
              ? "Libere as notificações nas configurações do celular/navegador e tente novamente."
              : "Aplicativo instalado. Ative as notificações para receber mensagens da Sra. Luck mesmo com o aplicativo fechado."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={ativar}
              disabled={ativando}
              className="inline-flex items-center gap-2 rounded-xl bg-burgundy px-3.5 py-2 text-xs font-semibold text-pearl disabled:opacity-60"
            >
              {ativando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              {ativando ? "Ativando..." : bloqueado ? "Verificar permissão" : "Permitir notificações"}
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
          aria-label="Não ativar agora"
          onClick={dispensar}
          className="flex h-8 w-8 items-center justify-center rounded-full text-clay/40 hover:bg-blush dark:hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
