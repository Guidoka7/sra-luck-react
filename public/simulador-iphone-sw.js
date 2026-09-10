const CACHE = 'sra-luck-pwa-v12';
const SHELL = [
  '/simulador-iphone.html',
  '/simulador-iphone.webmanifest',
  '/brand/sra-luck-mark.png',
  '/icons/sra-luck-192.png',
  '/icons/sra-luck-512.png'
];

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
  if (url.pathname === '/simulador-iphone.html' || url.pathname === '/simulador-iphone.webmanifest' || url.pathname === '/brand/sra-luck-mark.png' || url.pathname === '/icons/sra-luck-192.png' || url.pathname === '/icons/sra-luck-512.png') {
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
  const options = { body: data.body || 'Você recebeu uma nova notificação.', icon: notificationIcon, badge: notificationIcon, tag: data.tag || 'sra-luck-notificacao', renotify: true, requireInteraction: false, data: { url: data.url || '/agenda', notificationId: data.notificationId || null, installmentId: data.installmentId || null, action: data.action || null } };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); const targetUrl = new URL(event.notification.data?.url || '/agenda', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => { const existing = clients.find((client) => 'focus' in client); if (existing) return existing.focus().then(() => existing.navigate(targetUrl)); return self.clients.openWindow(targetUrl); }));
});
