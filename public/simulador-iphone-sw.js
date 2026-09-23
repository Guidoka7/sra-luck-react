const CACHE_PREFIX = 'sra-luck-pwa-';
const CACHE = 'sra-luck-pwa-v18';

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

// Cache para o app abrir "sólido" ao atualizar a página, sem nunca tocar nas APIs:
// - /assets/* (arquivos do build com hash no nome, imutáveis): cache-first;
// - marca, ícones e fontes: servidos do cache e revalidados em segundo plano;
// - navegação (HTML): rede primeiro, com a última cópia como reserva offline.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

function guardar(request, response) {
  if (response && (response.ok || response.type === 'opaque')) {
    const copia = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copia)).catch(() => {});
  }
  return response;
}

function cacheFirst(request) {
  return caches.match(request).then((salvo) => salvo || fetch(request).then((res) => guardar(request, res)));
}

function staleWhileRevalidate(event, request) {
  const rede = fetch(request).then((res) => guardar(request, res));
  event.waitUntil(rede.catch(() => {}));
  return caches.match(request).then((salvo) => salvo || rede);
}

function networkFirst(request) {
  return fetch(request)
    .then((res) => guardar(request, res))
    .catch(() => caches.match(request).then((salvo) => salvo || caches.match('/')));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.pathname.startsWith('/brand/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(fetch(request));
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
