import { useEffect, useState } from "react";

/** Registra o Service Worker na área /agenda e avisa o instalador quando estiver pronto. */
export function PwaRegister() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const atualizarRota = () => setPathname(window.location.pathname);

    window.addEventListener("popstate", atualizarRota);
    return () => window.removeEventListener("popstate", atualizarRota);
  }, []);

  useEffect(() => {
    if (!pathname.startsWith("/agenda")) return;
    if (!("serviceWorker" in navigator)) return;

    let ativo = true;

    const avisar = () => {
      if (ativo) {
        window.dispatchEvent(new Event("sra-luck-pwa-ready"));
      }
    };

    navigator.serviceWorker
      .register("/simulador-iphone-sw.js", {
        scope: "/agenda",
        updateViaCache: "none",
      })
      .then(async (registration) => {
        try {
          await registration.update();
        } catch {}

        try {
          await navigator.serviceWorker.ready;
        } catch {}

        avisar();
      })
      .catch(() => {});

    const onControllerChange = () => avisar();

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange
    );

    return () => {
      ativo = false;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange
      );
    };
  }, [pathname]);

  return null;
}
