/* Problemas Sistêmicos — service worker */
const VERSION = '1.18.0';
const CACHE = 'sistemicos-v' + VERSION;
const CORE = ['./', 'index.html', 'config.js', 'cripto.js', 'caixa.js', 'push.js', 'painel.js', 'notif.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // dados.json nunca passa pelo cache do SW: a última cópia válida (cifrada) fica guardada pelo próprio app
  if (/\/(dados\.json|sistemas\.txt|notificacao\.txt)$/.test(url.pathname)) return;
  // app: rede primeiro, sempre conferindo com o servidor (sem usar cópia velha do navegador); sem rede, usa a cópia guardada
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })
    .then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
// Aviso do MAPI (push), mesmo com o app fechado. O conteúdo chega cifrado de ponta a ponta e o navegador já o abre aqui:
// {t: título, b: texto, tag: agrupa/atualiza o aviso, u: endereço ao tocar}.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { b: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(d.t || 'Problemas Sistêmicos'), {
    body: String(d.b || ''), tag: String(d.tag || 'ps-push'), renotify: true,
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { u: './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
