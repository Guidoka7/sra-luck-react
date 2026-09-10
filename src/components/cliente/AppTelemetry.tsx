"use client";

import { useEffect } from "react";

function deviceType() {
  const width = window.innerWidth;
  return width < 768 ? "mobile" : width < 1024 ? "tablet" : "desktop";
}

function displayMode() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
    ? "standalone" : "browser";
}

function deviceKey() {
  const key = "sra-luck-device-key";
  let value = localStorage.getItem(key);
  if (!value) {
    value = `${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    localStorage.setItem(key, value);
  }
  return value;
}

async function getPushActive() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return false;
    if (Notification.permission !== "granted") return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export function AppTelemetry() {
  useEffect(() => {
    let cancelado = false;
    let enviando = false;

    const enviar = async () => {
      if (cancelado || enviando) return;
      enviando = true;
      try {
        const standalone = displayMode() === "standalone";
        const pushActive = await getPushActive();
        if (cancelado) return;

        await fetch(`/api/cliente/app-telemetry?t=${Date.now()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
          cache: "no-store",
          body: JSON.stringify({
            deviceKey: deviceKey(),
            deviceType: deviceType(),
            displayMode: displayMode(),
            isPwaInstalled: standalone,
            notificationPermission: "Notification" in window ? Notification.permission : "default",
            pushActive,
          }),
          keepalive: true,
        });
      } catch {
        // Telemetria nunca deve impedir o uso do aplicativo.
      } finally {
        enviando = false;
      }
    };

    enviar();
    const interval = window.setInterval(enviar, 60 * 1000);
    window.addEventListener("resize", enviar, { passive: true });
    window.addEventListener("focus", enviar);
    document.addEventListener("visibilitychange", enviar);
    navigator.serviceWorker?.addEventListener("controllerchange", enviar);

    return () => {
      cancelado = true;
      window.clearInterval(interval);
      window.removeEventListener("resize", enviar);
      window.removeEventListener("focus", enviar);
      document.removeEventListener("visibilitychange", enviar);
      navigator.serviceWorker?.removeEventListener("controllerchange", enviar);
    };
  }, []);

  return null;
}
