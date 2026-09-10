"use client";

import { useEffect } from "react";

/**
 * Detecta o ambiente real do dispositivo e deixa essa informação disponível
 * no <html> para a interface se adaptar sem criar versões separadas do app.
 * A responsividade visual continua sendo baseada principalmente no viewport;
 * esta camada serve para diferenciar mobile/tablet/desktop e navegador/PWA.
 */
export function DeviceRuntime() {
  useEffect(() => {
    const html = document.documentElement;

    const atualizar = () => {
      const largura = window.innerWidth;
      const touch = window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

      const dispositivo = largura < 768 ? "mobile" : largura < 1024 ? "tablet" : "desktop";
      html.dataset.device = dispositivo;
      html.dataset.touch = touch ? "true" : "false";
      html.dataset.displayMode = standalone ? "standalone" : "browser";
    };

    atualizar();
    window.addEventListener("resize", atualizar, { passive: true });
    window.addEventListener("orientationchange", atualizar, { passive: true });

    return () => {
      window.removeEventListener("resize", atualizar);
      window.removeEventListener("orientationchange", atualizar);
    };
  }, []);

  return null;
}
