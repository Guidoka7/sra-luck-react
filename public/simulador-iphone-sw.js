const CACHE = 'sra-luck-pwa-v13';
const SHELL = [
  '/simulador-iphone.html',
  '/simulador-iphone-onboarding.js',
  '/simulador-iphone.webmanifest',
  '/brand/sra-luck-mark.png',
  '/icons/sra-luck-192.png',
  '/icons/sra-luck-512.png'
];

function safeTarget(raw) {
  try {
    const parsed = new URL(String(raw || '/agenda'), self.location.origin);
    if (parsed.origin === self.location.origin) return parsed.href;
  } catch (_) {}
  return new URL('/agenda', self.location.origin).href;
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return;
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    })));
  }
});
self.addEventListener('push', (event) => {
  let data = {}; try { data = event.data ? event.data.json() : {}; } catch (_) {}
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
      url: safeTarget(data.url),
      notificationId: data.notificationId || null,
      installmentId: data.installmentId || null,
      action: data.action || null
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = safeTarget(event.notification.data?.url);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => 'focus' in client);
    if (existing) return existing.focus().then(() => existing.navigate(targetUrl));
    return self.clients.openWindow(targetUrl);
  }));
});
