const CACHE_PREFIX = 'sra-luck-pwa-';
const CACHE = 'sra-luck-pwa-v14';

self.addEventListener('install', (event) => {
  // O push não depende de pré-cache. Evitamos cache.addAll() aqui porque um
  // único asset indisponível impediria a instalação inteira do Service Worker.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // O manifest precisa refletir imediatamente o deploy atual.
  if (url.pathname === '/simulador-iphone.webmanifest') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {}

  const title = data.title || 'Sra. Luck';
  const notificationIcon = '/brand/sra-luck-mark.png';
  const options = {
    body: data.body || 'Você recebeu uma nova notificação.',
    icon: notificationIcon,
    badge: notificationIcon,
    tag: data.tag || 'sra-luck-notificacao',
    renotify: true,
    requireInteraction: false,
    data: {
      url: data.url || '/agenda',
      notificationId: data.notificationId || null,
      installmentId: data.installmentId || null,
      action: data.action || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/agenda', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);
      if (existing) return existing.focus().then(() => existing.navigate(targetUrl));
      return self.clients.openWindow(targetUrl);
    }),
  );
});
