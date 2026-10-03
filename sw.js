// Fuse Biomechanics service worker
// - 外殼（index.html、anatomy3d.js、圖示）安裝時預先快取
// - index.html：網絡優先（有網就一定攞到最新版），冇網先用快取
// - 3D模型(.bin.gz)、Three.js、字體：第一次載入後快取，之後離線都用到
// - 其他同源檔案：先出快取、背後更新（stale-while-revalidate）
// 改咗網站內容唔使手動改呢度；只有想強制全部用戶重新下載快取先需要加 VERSION。
const VERSION = 'fuse-v6';
const SHELL = [
  './', './index.html', './anatomy3d.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './models/atlas.json'
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('fuse-') && k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function put(cache, req, res) {
  if (res && (res.ok || res.type === 'opaque')) { try { await cache.put(req, res.clone()); } catch (e) {} }
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN_HOSTS.includes(url.hostname)) return;
  if (sameOrigin && url.pathname.includes('/versions/')) return;

  const isHTML = req.mode === 'navigate' || (sameOrigin && (url.pathname.endsWith('/') || url.pathname.endsWith('.html')));

  if (isHTML) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(req);
        await put(cache, './index.html', res);
        return res;
      } catch (e) {
        return (await cache.match('./index.html', { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }

  const cacheFirst = !sameOrigin || url.pathname.includes('/models/') && !url.pathname.endsWith('atlas.json');
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    if (cacheFirst) {
      if (hit) return hit;
      try { return await put(cache, req, await fetch(req)); } catch (e) { return hit || Response.error(); }
    }
    const network = fetch(req).then(res => put(cache, req, res)).catch(() => null);
    return hit || (await network) || Response.error();
  })());
});
