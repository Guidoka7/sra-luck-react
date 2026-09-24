const CACHE_PREFIX = 'sra-luck-pwa-';
const CACHE = 'sra-luck-pwa-v20';

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

// Arquivo de build só entra no cache se for mesmo o arquivo: depois de um deploy,
// um hash antigo pode voltar como página HTML (ou 404) e isso não pode ser guardado.
function arquivoDeBuildValido(response) {
  if (!response || !response.ok) return false;
  const tipo = response.headers.get('content-type') || '';
  return !tipo.includes('text/html');
}

function cacheFirst(request) {
  return caches.match(request).then((salvo) => {
    if (salvo && arquivoDeBuildValido(salvo)) return salvo;
    return fetch(request).then((res) => {
      if (arquivoDeBuildValido(res)) {
        const copia = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copia)).catch(() => {});
      }
      return res;
    });
  });
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
      action: data.action || null,
      destino: data.destino || null
    }
  };
  // Além de mostrar a notificação, avisa o app aberto para buscar os dados
  // novos na hora (sem recarregar a página).
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => clients.forEach((client) => client.postMessage({ type: 'sra-luck:atualizar' })))
      .catch(() => {})
  ]));
});

const AREA_CLIENTE = ['/agenda', '/app', '/cliente'];

function naAreaDaCliente(client) {
  try {
    const url = new URL(client.url);
    return url.origin === self.location.origin && AREA_CLIENTE.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'));
  } catch (_) {
    return false;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/agenda', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // App já aberto: foca e pede para ele mesmo abrir a aba certa, sem
      // navegação (navigate() recarregaria a página inteira).
      const aberto = clients.find((client) => naAreaDaCliente(client) && 'focus' in client);
      if (aberto) {
        aberto.postMessage({ type: 'sra-luck:abrir', url: targetUrl, destino: event.notification.data?.destino || null });
        return aberto.focus();
      }
      const existing = clients.find((client) => 'focus' in client);
      if (existing) return existing.focus().then(() => existing.navigate(targetUrl));
      return self.clients.openWindow(targetUrl);
    })
  );
});
