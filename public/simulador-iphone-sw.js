const CACHE_PREFIX = 'sra-luck-pwa-';
const CACHE = 'sra-luck-pwa-v17';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Mantém um fetch handler ativo para compatibilidade com critérios de PWA,
// mas sem cachear a página/manifest e sem interferir nas APIs.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return;
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
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
      action: data.action || null
    }
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
    })
  );
});
