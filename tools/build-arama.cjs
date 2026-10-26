'use strict';

// arama.html (site içi arama sayfası) kabuğunu üretir. Sonuçlar tarayıcıda js/site-search.js ile
// js/search-index.js dizininden hesaplanır. Form kendi adresine (?q=) gönderir; CSP form-action 'self'.
//   node tools/build-arama.cjs          sayfayı yazar
//   node tools/build-arama.cjs --check  sayfa güncel değilse hata verir
const { compose, metaHead, emit } = require('./lib/bilgi-page.cjs');
const URL = 'https://voltguard.com.tr/arama.html';
const TIPS = ['kompanzasyon', 'topraklama direnci', 'kaçak akım rölesi', 'gerilim düşümü', 'kablo kesiti', 'trafo bakımı', 'periyodik kontrol', 'GES', 'harmonik', 'şarj istasyonu'];

const head = metaHead({
  title: 'Sitede Ara | VoltGuard',
  desc: 'VoltGuard hizmetleri, teknik rehberler, hesap araçları, VoltSim simülasyonları ve elektrik terimleri sözlüğünde arama yapın.',
  url: URL, type: 'website', robots: 'noindex, follow',
  extra: `  <style>
    .ss-form{display:flex;gap:.5rem;margin:1rem 0 .6rem}
    .ss-form input{flex:1;min-width:0;min-height:48px;padding:.6rem .9rem;border:1.5px solid #94a3b8;border-radius:10px;font:inherit;font-size:1.05rem;background:var(--th-surface)}
    .ss-form input:focus{outline:3px solid rgba(245,158,11,.45);outline-offset:1px;border-color:#f59e0b}
    .ss-form button{min-height:48px;padding:.6rem 1.2rem;border:0;border-radius:10px;background:#0a1628;color:#fff;font-weight:700;cursor:pointer}
    .ss-status{min-height:1.4em;color:var(--th-text-2);font-weight:600}
    .ss-list{list-style:none;margin:0;padding:0}
    .ss-item{padding:1rem 0;border-top:1px solid var(--th-border)}
    .ss-link{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem .55rem;text-decoration:none}
    .ss-link:hover .ss-title,.ss-link:focus-visible .ss-title{text-decoration:underline}
    .ss-title{font-size:1.08rem;font-weight:700;color:var(--th-heading)}
    .ss-tag{padding:.05rem .5rem;border-radius:999px;background:var(--th-tint-blue);color:var(--th-blue-ink);font-size:.75rem;font-weight:700}
    .ss-snip{margin:.3rem 0 .15rem;color:var(--th-text-2)}
    .ss-url{font-size:.8rem;color:var(--clr-text-muted);word-break:break-all}
    .ss-list mark{background:var(--th-tint-amber-2);color:inherit;padding:0 .05em;border-radius:2px}
    .ss-more{border-top:1px solid var(--th-border);padding-top:1rem}
    .ss-more button,.ss-tips button{min-height:44px;padding:.5rem 1rem;border:1px solid var(--th-border-strong);border-radius:999px;background:var(--th-surface);color:var(--th-heading);font:inherit;font-weight:600;cursor:pointer}
    .ss-tips ul{display:flex;flex-wrap:wrap;gap:.45rem;list-style:none;margin:.6rem 0 1.4rem;padding:0}
    .ss-tips button:hover{border-color:#f59e0b;background:var(--th-tint-amber)}
  </style>
  <script src="/js/search-index.js?v=0" defer></script>
  <script src="/js/site-search.js?v=0" defer></script>
`
});

const main = `  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="/">Ana Sayfa</a> &rsaquo; <span>Sitede Ara</span>
  </nav>

  <main class="article" id="main" tabindex="-1">
    <h1>Sitede Ara</h1>
    <form class="ss-form" id="site-search" role="search" action="/arama.html" method="get">
      <label for="ss-q" class="sr-only">Aranacak sözcük</label>
      <input id="ss-q" name="q" type="search" placeholder="Örn. topraklama direnci, kVA, kompanzasyon" autocomplete="off" enterkeyhint="search" maxlength="120">
      <button type="submit">Ara</button>
    </form>
    <noscript><p>Arama için tarayıcınızda JavaScript açık olmalıdır. Konulara <a href="/bilgi-bankasi.html">bilgi bankasından</a> da ulaşabilirsiniz.</p></noscript>
    <p class="ss-status" id="ss-status" role="status" aria-live="polite"></p>
    <ol class="ss-list" id="ss-results"></ol>
    <div class="ss-tips" id="ss-tips">
      <h2>Sık aranan konular</h2>
      <ul>${TIPS.map(t => `<li><button type="button" data-q="${t}">${t}</button></li>`).join('')}</ul>
      <p>Aradığınızı bulamazsanız <a href="/bilgi/elektrik-terimleri-sozlugu.html">elektrik terimleri sözlüğüne</a>, <a href="/bilgi-bankasi.html">bilgi bankasına</a> ya da <a href="/hesaplama-araclari/">hesap araçlarına</a> göz atın veya <a href="/iletisim.html#iletisim">bize yazın</a>.</p>
    </div>
  </main>
`;

emit('arama.html', compose({ head, main }));
