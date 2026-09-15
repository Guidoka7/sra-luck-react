const PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "notify.windows.com",
]);

function hostPermitido(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (PUSH_HOSTS.has(host)) return true;
  return host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
}

/**
 * Web Push é um dos poucos pontos em que a aplicação faz fetch para uma URL
 * originalmente fornecida pelo navegador. Para evitar SSRF/DNS rebinding,
 * não aceitamos HTTPS arbitrário: somente os push services conhecidos dos
 * principais navegadores podem ser persistidos e chamados pelo Worker.
 */
export function isAllowedPushEndpoint(value: string): boolean {
  if (!value || value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    if (!hostPermitido(url.hostname)) return false;
    if (url.hash) return false;
    return true;
  } catch {
    return false;
  }
}
