"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Ativa recursos PWA exclusivamente na área de cliente (/agenda). */
export function PwaRegister() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname?.startsWith("/agenda")) return;

    let manifestLink = document.querySelector<HTMLLinkElement>('link[data-sra-luck-client-manifest="true"]');
    if (!manifestLink) {
      manifestLink = document.createElement("link");
      manifestLink.rel = "manifest";
      manifestLink.href = "/simulador-iphone.webmanifest";
      manifestLink.dataset.sraLuckClientManifest = "true";
      document.head.appendChild(manifestLink);
    }

    let appleTitle = document.querySelector<HTMLMetaElement>('meta[data-sra-luck-client-pwa="title"]');
    if (!appleTitle) {
      appleTitle = document.createElement("meta");
      appleTitle.name = "apple-mobile-web-app-title";
      appleTitle.content = "Sra. Luck";
      appleTitle.dataset.sraLuckClientPwa = "title";
      document.head.appendChild(appleTitle);
    }

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
