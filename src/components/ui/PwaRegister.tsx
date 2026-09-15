import { useEffect } from "react";
import { registrarErro } from "@/lib/monitoramento";

/** Ativa os recursos PWA nas áreas React de cliente e colaboradores. */
export function PwaRegister() {
  useEffect(() => {
    const pathname = window.location.pathname;
    const areaPwa = pathname.startsWith("/agenda") || pathname.startsWith("/app") || pathname.startsWith("/cliente") || pathname.startsWith("/equipe");
    if (!areaPwa) return;

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
      appleTitle.content = pathname.startsWith("/equipe") ? "Sra. Luck Equipe" : "Sra. Luck";
      appleTitle.dataset.sraLuckClientPwa = "title";
      document.head.appendChild(appleTitle);
    }

    if (!("serviceWorker" in navigator)) return;
    let ativo = true;
    const avisar = () => { if (ativo) window.dispatchEvent(new Event("sra-luck-pwa-ready")); };

    navigator.serviceWorker
      .register("/simulador-iphone-sw.js", { scope: "/", updateViaCache: "none" })
      .then(async (registration) => {
        try {
          await registration.update();
        } catch (error) {
          registrarErro({ mensagem: error instanceof Error ? error.message : "Falha ao atualizar Service Worker", nivel: "warn", codigo: "PWA_SW_UPDATE_FAILED", action: "pwa.service_worker.update" });
        }
        try {
          await navigator.serviceWorker.ready;
        } catch (error) {
          registrarErro({ mensagem: error instanceof Error ? error.message : "Service Worker não ficou pronto", nivel: "warn", codigo: "PWA_SW_READY_FAILED", action: "pwa.service_worker.ready" });
        }
        avisar();
      })
      .catch((error) => {
        registrarErro({ mensagem: error instanceof Error ? error.message : "Falha ao registrar Service Worker", nivel: "error", codigo: "PWA_SW_REGISTER_FAILED", action: "pwa.service_worker.register" });
      });

    const onControllerChange = () => avisar();
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      ativo = false;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
