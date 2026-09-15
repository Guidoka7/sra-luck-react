/** Fonte única de verdade para o estado de instalação do PWA da cliente. */

export const PWA_INSTALLED_KEY = "sra-luck-pwa-installed-v2";
export const PWA_DISMISS_KEY = "sra-luck-pwa-install-dismissed-date-v3";
export const PWA_PUSH_AFTER_INSTALL_KEY = "sra-luck-push-after-install";

/**
 * Flags de versões anteriores do fluxo de instalação. Nunca são usadas como
 * evidência de instalação real — apenas removidas para não contaminar o
 * estado atual (ex.: cliente que nunca instalou ficando marcada como instalada).
 */
const LEGACY_PWA_KEYS = [
  "sra-luck-pwa-installed-v1",
  "sra-luck-pwa-install-modal-v1-seen",
  "sra-luck-pwa-install-modal-v2-seen",
  "sra-luck-pwa-engagement-start-v1",
  "sra-luck-pwa-engagement-click-v1",
];

export function limparFlagsPwaAntigas() {
  try {
    for (const key of LEGACY_PWA_KEYS) localStorage.removeItem(key);
  } catch {}
}

export function isStandalonePwa(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone)))
  );
}

export function isIOSDevice(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
  );
}

/** Só retorna true com evidência real: display-mode standalone ou confirmação prévia de `appinstalled`. */
export function isPwaInstalada(): boolean {
  if (isStandalonePwa()) return true;
  try {
    return localStorage.getItem(PWA_INSTALLED_KEY) === "true";
  } catch {
    return false;
  }
}

/** Só deve ser chamada a partir de evidência real (evento `appinstalled` ou display-mode standalone). */
export function marcarPwaInstalada() {
  try {
    localStorage.setItem(PWA_INSTALLED_KEY, "true");
    localStorage.setItem(PWA_PUSH_AFTER_INSTALL_KEY, "pending");
    localStorage.removeItem(PWA_DISMISS_KEY);
  } catch {}
}
