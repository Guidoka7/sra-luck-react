"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  PWA_PUSH_AFTER_INSTALL_KEY,
  isPwaInstalada,
  isStandalonePwa,
  marcarPwaInstalada,
} from "@/lib/pwaInstall";
import "@/styles/convite-app.css";

const DISMISS_KEY = "sra-luck-push-prompt-dismissed-date";

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

function limparSolicitacaoPosInstalacao() {
  try {
    localStorage.removeItem(PWA_PUSH_AFTER_INSTALL_KEY);
  } catch {}
}

function marcarInstaladoSeStandalone() {
  if (!isStandalonePwa()) return;
  marcarPwaInstalada();
}

function fluxoDeNotificacoesDisponivel() {
  return isPwaInstalada();
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

async function obterChavePublicaVapid() {
  const keyRes = await fetch("/api/cliente/push/vapid", { cache: "no-store" });
  const keyData = await keyRes.json().catch(() => ({}));
  if (!keyRes.ok || !keyData?.publicKey) {
    throw new Error(keyData?.erro ?? "Servidor de notificações não configurado.");
  }
  return keyData.publicKey as string;
}

async function salvarAssinaturaPush(subscription: PushSubscription) {
  const deviceKey = obterDeviceKey();
  const response = await fetch("/api/cliente/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), deviceKey }),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function garantirAssinaturaPushRegistrada(reg: ServiceWorkerRegistration) {
  let subscription = await reg.pushManager.getSubscription();

  if (!subscription) {
    const publicKey = await obterChavePublicaVapid();
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  let salvo = await salvarAssinaturaPush(subscription);

  // Se este endpoint ficou preso a outra sessão/cliente no backend, invalida
  // apenas a assinatura local e cria uma nova. O registro antigo será removido
  // quando o push service responder 404/410 no próximo envio.
  if (salvo.response.status === 409) {
    await subscription.unsubscribe().catch(() => false);
    const publicKey = await obterChavePublicaVapid();
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    salvo = await salvarAssinaturaPush(subscription);
  }

  if (!salvo.response.ok) {
    throw new Error(salvo.data?.erro ?? "Não foi possível registrar este celular.");
  }

  return subscription;
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
        displayMode: isStandalonePwa() ? "standalone" : "browser",
        isPwaInstalled: isPwaInstalada(),
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
      let permission: NotificationPermission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }

      if (permission !== "granted") {
        await atualizarTelemetria(false);
        setBloqueado(permission === "denied");
        setVisivel(true);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      await garantirAssinaturaPushRegistrada(reg);

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

    marcarInstaladoSeStandalone();
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
      marcarInstaladoSeStandalone();
      if (!fluxoDeNotificacoesDisponivel()) {
        if (!cancelado) setVisivel(false);
        return;
      }
      if (await sincronizarAssinaturaPendente()) return;

      if (Notification.permission === "granted") {
        try {
          const reg = await navigator.serviceWorker.ready;
          await garantirAssinaturaPushRegistrada(reg);
          limparSolicitacaoPosInstalacao();
          if (!cancelado) setAtivo(true);
          await atualizarTelemetria(true);
          window.dispatchEvent(new Event("sra-luck-push-updated"));
          return;
        } catch {
          await atualizarTelemetria(false);
        }
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
      marcarPwaInstalada();
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
    window.addEventListener("pageshow", verificarAoRetomar);
    document.addEventListener("visibilitychange", verificarAoRetomar);

    void verificarAssinatura();

    return () => {
      cancelado = true;
      window.removeEventListener("sra-luck-pwa-installed", iniciarAposInstalacao);
      window.removeEventListener("sra-luck-push-request", solicitarNotificacoes);
      window.removeEventListener("pageshow", verificarAoRetomar);
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
    <div className="sl-convite-fundo" onClick={(e) => { if (e.target === e.currentTarget && !ativando) dispensar(); }}>
      <div className="sl-convite" role="dialog" aria-modal="true" aria-labelledby="push-convite-titulo">
        <div className="sl-convite-icone" aria-hidden>{bloqueado ? <BellOff className="h-7 w-7" /> : <Bell className="h-7 w-7" />}</div>
        <h2 id="push-convite-titulo" className="sl-convite-titulo">
          {bloqueado ? "Notificações bloqueadas" : "Receba avisos no celular"}
        </h2>
        <p className="sl-convite-texto">
          {bloqueado
            ? "Libere as notificações nas configurações do celular/navegador e toque em verificar."
            : "Aplicativo instalado. Ative as notificações para receber mensagens da Sra. Luck mesmo com o aplicativo fechado."}
        </p>
        <div className="sl-convite-acoes">
        <button type="button" className="sl-convite-principal" onClick={ativar} disabled={ativando}>
          {ativando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {ativando ? "Ativando..." : bloqueado ? "Verificar permissão" : "Permitir notificações"}
        </button>
        <button type="button" className="sl-convite-secundario" onClick={dispensar}>
          Agora não
        </button>
        </div>
      </div>
    </div>
  );
}
