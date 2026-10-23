/* =====================================================
   VoltGuard – Service Worker
   -----------------------------------------------------
   Amaç: tekrar ziyaretlerde ve sayfalar arası geçişte hız, çevrimdışıyken de çalışma,
   ama ASLA bayat HTML ile kullanıcıyı sıkıştırmamak.

   Stratejiler
   - Kurulumda küçük bir "uygulama kabuğu" önbelleğe alınır: ana sayfadaki css/js/yazı tipi
     dosyaları (gerçek, ?v= sürümlü URL'ler ana sayfa HTML'inden okunur) + /404.html.
   - HTML gezintileri (navigate): navigation preload + ağ-öncelikli, 2.5 sn zaman aşımı.
     Ağ yanıt vermezse (çevrimdışı ya da çok yavaş) son iyi kopya; o da yoksa çevrimdışı bilgi sayfası.
     Yavaş istek arka planda tamamlanır ve önbelleği tazeler. Yönlendirme/hata/no-store yanıtları saklanmaz.
     Sunucu 502/503/504 (ağ geçidi/bakım) dönerse ve iyi bir kopya varsa o gösterilir; 500 ve diğer hatalar
     olduğu gibi iletilir. 404/410 dönen sayfanın eski kopyası önbellekten silinir (kaldırılan sayfa geri gelmez).
   - /hesap/ sayfaları: yalnızca ağ (preload ile); asla önbelleğe yazılmaz ve önbellekten verilmez.
     (/hesap/ altında statik dosya yoktur; hesap sayfalarının css/js'i /css/ ve /js/ altından ?v= ile gelir.)
   - css/js/yazı tipi/görsel (aynı köken): stale-while-revalidate.
       * ?v= sürümlü URL ve yazı tipleri değişmez kabul edilir: önbellekten anında, 7 günden eskiyse arka planda tazelenir.
       * Sürümsüz css/js/görsel: önbellekten anında + arka planda tazele (HTTP başlıkları geçerlidir).
   - ASLA önbelleğe alınmaz / hiç dokunulmaz: POST ve diğer GET-dışı istekler, /api/, *.php (contact.php),
     /_vgdata/ /vg-data/, Range (video), Authorization başlıklı istekler, çapraz köken istekler.
     Hesap/kullanıcı verisi yalnızca API üzerinden gelir; SW bunu hiçbir zaman saklamaz.

   Güncelleme: sw.js sunucuda no-cache; VERSION değişince install -> skipWaiting -> activate -> clients.claim,
   eski önbellekler silinir. Sayfa tarafı için mesajlar:
     postMessage({type:'VG_CLEAR_CACHES'})  tüm vgsw önbelleklerini siler (örn. çıkış yaparken)
     postMessage({type:'VG_VERSION'})        sürümü döndürür
   ===================================================== */
'use strict';

const VERSION = '2026-10-23.1';
const PREFIX = 'vgsw-';
const CACHE_STATIC = PREFIX + 'static-' + VERSION;
const CACHE_PAGES = PREFIX + 'pages-' + VERSION;
const CURRENT_CACHES = [CACHE_STATIC, CACHE_PAGES];
const LEGACY_CACHE_RE = /^vg-\d{4}-\d{2}-\d{2}/; // eski sw.js: 'vg-2026-10-11'

const NAV_TIMEOUT_MS = 2500;       // ağ bu sürede yanıt vermezse önbellekteki kopya gösterilir
const MAX_PAGES = 60;              // saklanan HTML sayfası sayısı üst sınırı
const MAX_IMAGES = 120;            // saklanan görsel sayısı üst sınırı
const VERSIONED_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SHELL = 28;              // kurulumda indirilecek en fazla kabuk dosyası

// Ana sayfadan okunamazsa kullanılacak sabit kabuk listesi (olmayanlar sessizce atlanır).
const SHELL_FIXED = [
  '/css/style.css',
  '/css/fonts.css',
  '/css/fa-subset.css',
  '/css/vg-shell.css',
  '/js/vg-shell.js',
  '/js/main.js',
  '/js/voltguard-auth.js',
  '/public/icon-192.png',
  '/public/voltguard-logo.webp'
];
const SHELL_PAGES = ['/404.html'];  // '/' ayrıca kurulumda indirilir

const STATIC_RE = /\.(?:css|m?js|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico)$/i;
const IMAGE_RE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i;
const FONT_RE = /\.(?:woff2?|ttf|otf)$/i;
const NEVER_PREFIXES = ['/api/', '/calisan/uygulama/', '/_vgdata/', '/vg-data/', '/vgdata/', '/vesikalar/', '/VoltGame/', '/voltgame/', '/tools/'];
// Bu yollardaki HTML sayfaları ağdan gelir ama ASLA saklanmaz / önbellekten verilmez (hesap alanı).
const PRIVATE_PAGE_PREFIXES = ['/hesap/', '/calisan/'];

function noop() { /* yoksay */ }

/* ---------- yardımcılar ---------- */

function sameOriginUrl(href, base) {
  try {
    const u = new URL(href, base || (self.location.origin + '/'));
    return u.origin === self.location.origin ? u : null;
  } catch (e) { return null; }
}

function isNeverCached(url, req) {
  const p = url.pathname;
  if (/\.php$/i.test(p)) return true;
  for (let i = 0; i < NEVER_PREFIXES.length; i++) if (p.indexOf(NEVER_PREFIXES[i]) === 0) return true;
  if (p === '/sw.js') return true;
  if (url.searchParams.has('nosw')) return true;          // hata ayıklama: ?nosw=1 SW'yi devre dışı bırakır
  if (req.headers.has('range') || req.headers.has('authorization')) return true;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return true;
  return false;
}

function isPrivatePage(url) {
  const p = url.pathname.toLowerCase();
  for (let i = 0; i < PRIVATE_PAGE_PREFIXES.length; i++) if (p.indexOf(PRIVATE_PAGE_PREFIXES[i]) === 0) return true;
  return false;
}

function pageKey(url) {
  let p = url.pathname;
  if (/\/index\.html$/.test(p)) p = p.slice(0, -'index.html'.length);
  return new Request(url.origin + p);
}

function isHtmlResponse(res) {
  return (res.headers.get('content-type') || '').toLowerCase().indexOf('text/html') !== -1;
}

function storableBasic(res) {
  return !!res && res.status === 200 && res.type === 'basic' && !res.redirected &&
    !/no-store/i.test(res.headers.get('cache-control') || '');
}

function raceTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    const t = setTimeout(function () { reject(new Error('timeout')); }, ms);
    promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}

async function trim(cache, max, predicate) {
  const keys = (await cache.keys()).filter(function (k) { return predicate(new URL(k.url)); });
  const extra = keys.length - max;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

// Aynı yolun eski ?v= sürümlerini sil (yeni sürüm kaydedildiğinde). Sürümsüz kopya kalır.
async function dropOtherVersions(cache, url) {
  const keys = await cache.keys();
  await Promise.all(keys.filter(function (k) {
    const u = new URL(k.url);
    return u.pathname === url.pathname && u.searchParams.has('v') && u.search !== url.search;
  }).map(function (k) { return cache.delete(k); }));
}

/* ---------- kurulum: küçük uygulama kabuğu ---------- */

function discoverShell(html) {
  const found = [];
  const tagRe = /<(link|script)\b([^>]*)>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const get = function (name) {
      const r = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(attrs);
      return r ? (r[1] || r[2] || r[3] || '') : '';
    };
    if (tag === 'link') {
      const rel = get('rel').toLowerCase();
      const as = get('as').toLowerCase();
      const ok = /\bstylesheet\b/.test(rel) || (/\bpreload\b/.test(rel) && as === 'font');
      if (!ok) continue;
    }
    const href = tag === 'link' ? get('href') : get('src');
    const u = href && sameOriginUrl(href);
    if (u && STATIC_RE.test(u.pathname)) found.push(u.pathname + u.search);
  }
  return found;
}

async function precache() {
  const statics = await caches.open(CACHE_STATIC);
  const pages = await caches.open(CACHE_PAGES);
  const isUpdate = !!(self.registration && self.registration.active);
  const wanted = new Map(); // pathname -> pathname+search (sürümlü URL tercih edilir)

  // 1) Ana sayfa: HTML'i sakla ve içindeki gerçek (sürümlü) kabuk URL'lerini oku.
  try {
    const res = await fetch('/', { cache: 'no-cache' });
    if (storableBasic(res) && isHtmlResponse(res)) {
      await pages.put(pageKey(new URL(self.location.origin + '/')), res.clone());
      const html = await res.text();
      discoverShell(html).forEach(function (u) {
        const p = u.split('?')[0];
        if (!wanted.has(p) || u.indexOf('?') !== -1) wanted.set(p, u);
      });
    }
  } catch (e) { /* çevrimdışı kurulum: sabit listeye düş */ }

  // 2) Sabit liste + /fonts/manifest.json içindeki preload yazı tipleri (varsa).
  SHELL_FIXED.forEach(function (p) { if (!wanted.has(p)) wanted.set(p, p); });
  try {
    const r = await fetch('/fonts/manifest.json', { cache: 'no-cache' });
    if (r.ok) {
      const fm = await r.json();
      (fm.preload || []).forEach(function (p) {
        const u = sameOriginUrl(p);
        if (u && FONT_RE.test(u.pathname) && !wanted.has(u.pathname)) wanted.set(u.pathname, u.pathname);
      });
    }
  } catch (e) { /* manifest yok ya da bozuk: yoksay */ }

  // 3) Kabuk dosyalarını indir (her biri bağımsız; eksik olan tüm kurulumu bozmaz).
  const list = Array.from(wanted.values()).slice(0, MAX_SHELL);
  await Promise.all(list.map(async function (u) {
    try {
      const url = new URL(u, self.location.origin);
      const versioned = url.searchParams.has('v');
      const res = await fetch(new Request(url.href, { cache: (isUpdate && !versioned) ? 'reload' : 'default' }));
      if (storableBasic(res) && !isHtmlResponse(res)) await statics.put(new Request(url.href), res);
    } catch (e) { /* tek dosya başarısız: yoksay */ }
  }));

  // 4) Çevrimdışı/404 sayfası ve diğer kabuk sayfaları.
  await Promise.all(SHELL_PAGES.map(async function (p) {
    try {
      const res = await fetch(p, { cache: 'no-cache' });
      // /404.html sunucuda 404 durumuyla dönebilir; bu yüzden status yerine içeriğe bakarız.
      if (res && res.type === 'basic' && !res.redirected && isHtmlResponse(res) && res.status < 500) {
        await pages.put(new Request(self.location.origin + p), res);
      }
    } catch (e) { /* yoksay */ }
  }));
}

self.addEventListener('install', function (event) {
  event.waitUntil(precache().catch(noop).then(function () { return self.skipWaiting(); }));
});

/* ---------- etkinleştirme ---------- */

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.filter(function (k) {
      if (CURRENT_CACHES.indexOf(k) !== -1) return false;
      return k.indexOf(PREFIX) === 0 || LEGACY_CACHE_RE.test(k);
    }).map(function (k) { return caches.delete(k); }));
    if (self.registration && self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) { /* yoksay */ }
    }
    await self.clients.claim();
  })());
});

/* ---------- fetch ---------- */

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;                       // POST vb.: tarayıcıya bırak
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // CDN, Turnstile, Maps, Apollo: dokunma
  if (isNeverCached(url, req)) return;

  if (req.mode === 'navigate') {
    // Yalnızca HTML sayfa gezintileri (uzantısız, / ile biten ya da .html). PDF, video vb. doğrudan tarayıcıya kalır.
    if (/\.[a-z0-9]{2,6}$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname)) return;
    event.respondWith(handleNavigation(event, url));
    return;
  }
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(handleStatic(event, url));
  }
});

/* --- HTML gezintileri: preload + ağ-öncelikli (zaman aşımlı) --- */

function startNetwork(event) {
  const p = (async function () {
    const pre = await event.preloadResponse;
    if (pre) return pre;
    return fetch(event.request);
  })();
  p.catch(noop); // zaman aşımından sonra reddedilirse "unhandled rejection" olmasın
  return p;
}

async function storePage(request, res) {
  if (isPrivatePage(new URL(request.url))) return;
  try {
    const cache = await caches.open(CACHE_PAGES);
    await cache.put(pageKey(new URL(request.url)), res);
    await trim(cache, MAX_PAGES, function (u) { return u.pathname !== '/' && u.pathname !== '/404.html'; });
  } catch (e) { /* önbellek hatası kullanıcıyı etkilemesin */ }
}

// Yalnızca saklanabilir (200, aynı köken, yönlendirilmemiş, no-store değil) HTML yanıtları kopyalanır ve saklanır.
function rememberPage(event, res) {
  if (!res || res.type === 'opaqueredirect' || !storableBasic(res) || !isHtmlResponse(res)) return;
  const p = storePage(event.request, res.clone());
  event.waitUntil(p);
  return p;
}

async function matchPage(url) {
  if (isPrivatePage(url)) return null;
  const cache = await caches.open(CACHE_PAGES);
  return (await cache.match(pageKey(url), { ignoreVary: true })) || null;
}

// Sunucu sayfanın artık olmadığını söylüyorsa (404/410) eski kopyayı sil: çevrimdışıyken de geri gelmesin.
function forgetPage(event, url) {
  if (url.pathname === '/' || url.pathname === '/404.html') return; // kabuk sayfaları korunur
  const p = caches.open(CACHE_PAGES).then(function (cache) { return cache.delete(pageKey(url)); }).catch(noop);
  event.waitUntil(p);
}

// Ağdan gelen gezinti yanıtına göre önbelleği güncelle: 200 HTML saklanır, 404/410 eski kopyayı siler.
function settlePage(event, url, res) {
  if (res && (res.status === 404 || res.status === 410)) { forgetPage(event, url); return; }
  return rememberPage(event, res);
}

async function handleNavigation(event, url) {
  const network = startNetwork(event);
  if (isPrivatePage(url)) {
    // Hesap alanı: yalnızca ağ. Önbelleğe yazılmaz, önbellekten okunmaz; ağ yoksa çevrimdışı bilgi sayfası.
    try { return await network; } catch (e) { return offlineResponse(true); }
  }
  try {
    const res = await raceTimeout(network, NAV_TIMEOUT_MS);
    if (res && res.status >= 502 && res.status <= 504) {
      // Ağ geçidi/bakım hatası (502/503/504): önbellekte iyi bir kopya varsa onu göster.
      // Kopya saklanmaz/değişmez; sunucu düzelince sonraki gezinti yine ağdan (taze) gelir.
      const good = await matchPage(url);
      if (good) return good;
    }
    settlePage(event, url, res);
    return res;
  } catch (err) {
    // Ağ yok ya da çok yavaş: son iyi kopya.
    const cached = await matchPage(url);
    if (cached) {
      // Yavaş istek arka planda bitsin ve önbelleği tazelesin (sonraki gezinti taze olsun).
      event.waitUntil(network.then(function (res) { return settlePage(event, url, res); }).catch(noop));
      return cached;
    }
    // Kopya yok: zaman aşımıysa ağı beklemeye devam et; ağ gerçekten yoksa bilgi sayfası göster.
    try {
      const res = await network;
      settlePage(event, url, res);
      return res;
    } catch (e2) {
      return offlineResponse();
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function labelFor(pathname) {
  if (pathname === '/') return 'Ana sayfa';
  let seg = pathname.replace(/\/$/, '').split('/').pop().replace(/\.html?$/i, '');
  try { seg = decodeURIComponent(seg); } catch (e) { /* olduğu gibi */ }
  seg = seg.replace(/-/g, ' ');
  return seg.charAt(0).toLocaleUpperCase('tr') + seg.slice(1);
}

// Çevrimdışı bilgi sayfası (503, no-store). Satır içi betik: "online" olayında hemen yenilemez; 1.5 sn bekler,
// HEAD isteğiyle bağlantıyı doğrular ve kullanıcı başka sayfaya geçiyorsa (pagehide/beforeunload/bağlantı tıklaması)
// hiç yenilemez. Böylece sahte/çakışan "online" olayları gezintiyi iptal edip yenileme döngüsü yaratamaz.
async function offlineResponse(isPrivate) {
  let links = '<li><a href="/">Ana sayfa</a></li>';
  try {
    const cache = await caches.open(CACHE_PAGES);
    const keys = await cache.keys();
    const seen = { '/': true, '/404.html': true };
    keys.slice(-12).reverse().forEach(function (k) {
      const p = new URL(k.url).pathname;
      if (seen[p] || isPrivatePage(new URL(k.url))) return;
      seen[p] = true;
      links += '<li><a href="' + escapeHtml(p) + '">' + escapeHtml(labelFor(p)) + '</a></li>';
    });
  } catch (e) { /* yalnızca ana sayfa bağlantısı */ }

  const html = '<!doctype html><html lang="tr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><meta name="theme-color" content="#0a1628">' +
    '<title>Çevrimdışı | VoltGuard</title>' +
    '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Cpath fill=%27%23f59e0b%27 d=%27M13 2 4 14h7l-1 8 9-12h-7z%27/%3E%3C/svg%3E">' +
    '<style>' +
    'html{color-scheme:dark}' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;' +
    'background:radial-gradient(1200px 600px at 20% -10%,#12305a 0,#0a1628 60%);color:#e6edf7;' +
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.55}' +
    'main{max-width:520px;width:100%;text-align:center}' +
    '.bolt{font-size:56px;line-height:1;color:#f59e0b;filter:drop-shadow(0 0 18px rgba(245,158,11,.45))}' +
    'h1{font-size:1.6rem;margin:.6em 0 .3em}' +
    'p{color:#b6c3d6;margin:.4em 0 1.2em}' +
    'button,.btn{display:inline-block;border:0;border-radius:10px;padding:12px 22px;font:inherit;font-weight:600;cursor:pointer;' +
    'background:#f59e0b;color:#0a1628;text-decoration:none}' +
    'button:focus-visible,a:focus-visible{outline:3px solid #3b82f6;outline-offset:3px}' +
    'h2{font-size:.95rem;font-weight:600;margin:2em 0 .6em;color:#b6c3d6}' +
    'ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}' +
    'li a{display:block;padding:8px 14px;border:1px solid rgba(255,255,255,.18);border-radius:999px;color:#e6edf7;text-decoration:none;font-size:.9rem}' +
    'li a:hover{border-color:#f59e0b;color:#f59e0b}' +
    '</style></head><body><main>' +
    '<div class="bolt" aria-hidden="true">&#9889;</div>' +
    '<h1>Şu an çevrimdışısınız</h1>' +
    '<p>' + (isPrivate
      ? 'Hesap sayfaları güvenliğiniz için cihazda saklanmaz; bağlantı olmadan açılamaz.'
      : 'Bu sayfa daha önce açılmadığı için çevrimdışı gösterilemiyor.') +
    ' İnternet bağlantınız geri geldiğinde sayfa kendiliğinden yenilenir.</p>' +
    '<button type="button" id="retry">Yeniden dene</button>' +
    '<h2>Çevrimdışı açılabilen sayfalar</h2><ul>' + links + '</ul>' +
    '</main><script>' +
    '(function(){var leaving=false,timer=0;' +
    'function leave(){leaving=true;clearTimeout(timer);}' +
    'addEventListener("pagehide",leave);addEventListener("beforeunload",leave);' +
    'document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(a)leave();},true);' +
    'function check(){if(leaving||document.visibilityState==="hidden")return;' +
    'fetch(location.href,{method:"HEAD",cache:"no-store"}).then(function(r){if(!leaving&&r.status<500)location.reload();},function(){});}' +
    'addEventListener("online",function(){clearTimeout(timer);timer=setTimeout(check,1500);});' +
    'document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible"&&navigator.onLine){clearTimeout(timer);timer=setTimeout(check,500);}});' +
    'document.getElementById("retry").addEventListener("click",function(){location.reload();});' +
    '})();' +
    '</script></body></html>';

  return new Response(html, {
    status: 503,
    statusText: 'Service Unavailable',
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '30'
    }
  });
}

/* --- css/js/yazı tipi/görsel: stale-while-revalidate --- */

async function handleStatic(event, url) {
  const req = event.request;
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req, { ignoreVary: true });
  const versioned = url.searchParams.has('v');
  const immutable = versioned || FONT_RE.test(url.pathname);

  const refresh = async function () {
    const res = await fetch(req);
    if (storableBasic(res) && !isHtmlResponse(res)) {
      await cache.put(req, res.clone());
      if (versioned) await dropOtherVersions(cache, url);
      if (IMAGE_RE.test(url.pathname)) await trim(cache, MAX_IMAGES, function (u) { return IMAGE_RE.test(u.pathname); });
    }
    return res;
  };

  if (cached) {
    let stale = !immutable; // sürümsüz dosyalar her seferinde arka planda doğrulanır
    if (immutable) {
      const d = Date.parse(cached.headers.get('date') || '');
      stale = !d || (Date.now() - d) > VERSIONED_REFRESH_MS; // sürümlü: 7 günden eskiyse tazele
    }
    if (stale) event.waitUntil(refresh().catch(noop));
    return cached;
  }

  try {
    return await refresh();
  } catch (e) {
    // Çevrimdışı: aynı yolun başka bir sürümü varsa onu ver (kabuk kopyası).
    const alt = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
    if (alt) return alt;
    return Response.error();
  }
}

/* ---------- sayfa -> SW mesajları ---------- */

function reply(event, msg) {
  if (event.ports && event.ports[0]) event.ports[0].postMessage(msg);
  else if (event.source && event.source.postMessage) event.source.postMessage(msg);
}

self.addEventListener('message', function (event) {
  const d = event.data || {};
  if (d.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (d.type === 'VG_VERSION') {
    reply(event, { type: 'VG_VERSION', version: VERSION });
  } else if (d.type === 'VG_CLEAR_CACHES') {
    event.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { reply(event, { type: 'VG_CLEARED' }); }));
  }
});
