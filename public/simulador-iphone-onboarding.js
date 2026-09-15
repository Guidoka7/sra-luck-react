(() => {
  "use strict";
  const SW = "/simulador-iphone-sw.js";
  const VAPID = "/api/cliente/push/vapid";
  const SUBSCRIBE = "/api/cliente/push/subscribe";
  const PENDING = "sra-luck-pending-push-subscription";
  let deferredInstall = null;
  let busy = false;
  let installReady = false;
  let notificationDone = false;

  const $ = (id) => document.getElementById(id);
  const primary = $("primary");
  const continueBtn = $("continue");
  const status = $("status");
  const title = $("title");
  const text = $("text");
  const note = $("note");
  const iosSteps = $("iosSteps");
  if (!primary || !continueBtn || !status || !title || !text || !note || !iosSteps) return;

  function isStandalone() {
    return Boolean(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function isMobile() { return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent); }
  function base64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(Array.from(raw).map((c) => c.charCodeAt(0)));
  }
  function setStatus(value) { status.textContent = value || ""; }
  function savePending(subscription) {
    try { localStorage.setItem(PENDING, JSON.stringify(subscription.toJSON ? subscription.toJSON() : subscription)); }
    catch { /* storage pode estar indisponível; a assinatura ainda funciona na sessão atual */ }
  }
  async function registerSW() {
    if (!("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.register(SW, { scope: "/", updateViaCache: "none" });
    await registration.update().catch(() => undefined);
    await navigator.serviceWorker.ready;
    return registration;
  }
  async function activateNotifications() {
    if (notificationDone) return true;
    if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
      setStatus("Este navegador não oferece Web Push.");
      return false;
    }
    if (!window.isSecureContext) {
      setStatus("Para Push no celular, use HTTPS. localhost só é seguro no próprio aparelho que executa o servidor.");
      return false;
    }
    try {
      let permission = Notification.permission;
      if (permission === "default") permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("Notificações não autorizadas. Elas podem ser ativadas depois.");
        return false;
      }
      const registration = await navigator.serviceWorker.ready;
      const keyRes = await fetch(VAPID, { cache: "no-store", credentials: "same-origin" });
      if (!keyRes.ok) throw new Error("Servidor de notificações não configurado.");
      const { publicKey } = await keyRes.json();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToUint8Array(publicKey) });
      savePending(subscription);
      try {
        const response = await fetch(SUBSCRIBE, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
        if (response.ok) localStorage.removeItem(PENDING);
      } catch { /* o app principal tenta sincronizar novamente */ }
      notificationDone = true;
      setStatus("✓ Notificações autorizadas neste celular.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível ativar as notificações.");
      return false;
    }
  }
  function setupInstallEvents() {
    if (isStandalone()) return;
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstall = event;
      installReady = true;
      primary.disabled = false;
    });
    window.addEventListener("appinstalled", () => {
      deferredInstall = null;
      installReady = false;
      setStatus("✓ Aplicativo instalado. Abra o ícone Sra. Luck pela tela inicial.");
    });
  }
  async function install() {
    if (isStandalone()) { setStatus("O aplicativo já está instalado neste celular."); return true; }
    if (isIOS()) { iosSteps.classList.remove("hidden"); setStatus("No iPhone, use Compartilhar → Adicionar à Tela de Início."); return false; }
    if (deferredInstall) {
      const promptEvent = deferredInstall;
      deferredInstall = null;
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      setStatus(choice.outcome === "accepted" ? "✓ Instalação confirmada." : "Instalação cancelada.");
      return choice.outcome === "accepted";
    }
    if (!installReady) setStatus(isMobile() ? "Use o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”." : "Abra este acesso no Chrome/Edge para instalar o aplicativo.");
    return false;
  }
  async function primaryAction() {
    if (busy) return;
    busy = true;
    primary.disabled = true;
    try { await registerSW(); await activateNotifications(); await install(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível concluir a ativação."); }
    finally { busy = false; primary.disabled = false; }
  }

  primary.addEventListener("click", primaryAction);
  continueBtn.addEventListener("click", () => { window.location.assign("/agenda"); });
  setupInstallEvents();
  registerSW().catch(() => undefined);

  if (isStandalone()) {
    title.textContent = "Sra. Luck está instalada";
    text.textContent = "Você já está usando a experiência da cliente como aplicativo.";
    primary.textContent = "Ativar notificações";
    continueBtn.textContent = "Abrir minha agenda";
  } else if (isIOS()) {
    iosSteps.classList.remove("hidden");
    note.textContent = "No iPhone, a instalação é feita pelo menu Compartilhar do Safari.";
  }
})();
