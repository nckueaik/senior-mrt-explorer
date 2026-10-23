// 離線快取：頁面與資料「先網路後快取」（有網路就拿最新），圖片「先快取」。
// 安裝時預先下載所有景點圖片，讓長輩在地下站沒訊號也看得到。
const CACHE = 'mrt-explorer-v3'; // 更新程式或資料時改版本號
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/route.js', 'js/fare.js', 'js/draw.js', 'js/store.js', 'js/speak.js', 'js/map.js', 'js/photos.js',
  'data/network.json', 'data/fares.json', 'data/map-layout.json', 'data/spots.json',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    try {
      const spots = await (await fetch('data/spots.json')).json();
      const imgs = Object.values(spots.stations).flatMap(st => st.spots.map(s => s.image?.src)).filter(Boolean);
      await cache.addAll([...new Set(imgs)]);
    } catch { /* 圖片之後瀏覽時再補快取 */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isImage = url.pathname.includes('/img/');
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isImage) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
    }
    const fromNet = fetch(e.request).then(res => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    // 地下站訊號差時網路可能卡很久：超過 3 秒就先用快取
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
    try {
      return await Promise.race([fromNet, timeout]);
    } catch {
      const hit = (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match('index.html'));
      return hit || fromNet;
    }
  })());
});
