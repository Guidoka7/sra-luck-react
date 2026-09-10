"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Registra o Service Worker na área /agenda e avisa o instalador quando estiver pronto. */
export function PwaRegister() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname?.startsWith("/agenda")) return;
    if (!("serviceWorker" in navigator)) return;

    let ativo = true;
    const avisar = () => {
      if (ativo) window.dispatchEvent(new Event("sra-luck-pwa-ready"));
    };

    navigator.serviceWorker
      .register("/simulador-iphone-sw.js", { scope: "/agenda", updateViaCache: "none" })
      .then(async (registration) => {
        try { await registration.update(); } catch {}
        try { await navigator.serviceWorker.ready; } catch {}
        avisar();
      })
      .catch(() => {});

    const onControllerChange = () => avisar();
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      ativo = false;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [pathname]);

  return null;
}
