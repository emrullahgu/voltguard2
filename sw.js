/* =====================================================
   VoltGuard – Service Worker
   Ağ-öncelikli strateji: çevrimiçiyken her zaman taze içerik servis edilir
   (bayat CSS/JS riski yok); yalnızca çevrimdışıyken önbellekten yanıt verilir.
   Sürüm artırıldığında eski önbellekler temizlenir.
   ===================================================== */
const VERSION = 'vg-2026-08-29';
const CORE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/main.js',
  '/js/calculator-config.js',
  '/manifest.json',
  '/404.html',
  '/hesaplama-araclari/',
  '/public/icon-192.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) { return cache.addAll(CORE); }).catch(function () { /* no-op */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  // Çapraz-köken istekleri (Google Fonts, Font Awesome, Maps, Turnstile, Apollo) hiç dokunma.
  if (url.origin !== self.location.origin) return;

  // Ağ-öncelikli: çevrimiçiyken taze yanıt; başarılı yanıtı önbelleğe kopyala.
  event.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(VERSION).then(function (cache) { cache.put(req, copy); }).catch(function () { /* no-op */ });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (cached) {
          if (cached) return cached;
          // Navigasyon isteği çevrimdışıysa kabuk sayfasına düş.
          if (req.mode === 'navigate') return caches.match('/index.html');
          return Response.error();
        });
      })
  );
});
