"use client";

import { useEffect } from "react";

/**
 * Permite fechar os modais de pagamento tocando/clicando no backdrop.
 * O clique só é tratado quando o alvo é o próprio backdrop, portanto
 * interações dentro do modal continuam funcionando normalmente.
 */
export function PaymentModalBackdropCloser() {
  useEffect(() => {
    const isPaymentBackdrop = (element: Element) => {
      if (!(element instanceof HTMLElement)) return false;
      const classes = element.className;
      return typeof classes === "string" && classes.includes("fixed") && classes.includes("inset-0") && (classes.includes("z-[80]") || classes.includes("z-[90]"));
    };

    const closeFromBackdrop = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !isPaymentBackdrop(target)) return;

      const closeButton = target.querySelector("button[aria-label='Fechar'], button");
      if (closeButton instanceof HTMLButtonElement) closeButton.click();
    };

    document.addEventListener("click", closeFromBackdrop);
    return () => document.removeEventListener("click", closeFromBackdrop);
  }, []);

  return null;
}
