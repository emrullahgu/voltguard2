'use strict';

// Site içi arama dizini: sitemap.xml'deki her HTML sayfasından başlık, açıklama, H1–H3 başlıkları ve ana metinden
// kısa bir özet çıkarır; sözlük terimlerini ayrı kayıt olarak ekler. Çıktı js/search-index.js (window.VG_SEARCH_INDEX).
// Ayrı JSON yerine betik: CSP'de connect-src gerekmez ve tarayıcı önbelleği ?v= sürümüyle yönetilir.
//   node tools/build-search-index.cjs          dizini yazar
//   node tools/build-search-index.cjs --check  dizin güncel değilse hata verir
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const OUT = 'js/search-index.js';
const BODY_CHARS = 700;
const TERMS = require('./data/elektrik-terimleri.cjs');

// Adres → bölüm etiketi (arama sonucunda rozet olarak görünür)
const SECTIONS = [
  [/^\/hizmetler\//, 'Hizmet'], [/^\/bilgi\//, 'Rehber'], [/^\/hesaplama(-araclari)?\//, 'Hesap aracı'],
  [/^\/araclar\//, 'Mühendislik aracı'], [/^\/voltsim\//, 'VoltSim'], [/^\/akademi\//, 'Akademi'],
  [/^\/sor\//, 'Soru-cevap'], [/^\/mm\//, 'Mühendis merkezi']
];
const section = u => (SECTIONS.find(([re]) => re.test(u)) || [, 'Sayfa'])[1];

// Temiz adresi diskteki dosyaya çevir (/hesaplama/x/ → hesaplama/x.html, /dizin/ → dizin/index.html)
// netlify.toml'deki 200 (yeniden yazma) kuralları: /hesaplama-araclari/ → /teklif-araclari.html gibi
const REWRITES = Object.fromEntries(fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8').split('[[redirects]]').slice(1)
  .map(b => [b.match(/from\s*=\s*"([^"]+)"/), b.match(/to\s*=\s*"(\/[^"]+\.html)"/), /status\s*=\s*200\b/.test(b)])
  .filter(([f, t, ok]) => f && t && ok).map(([f, t]) => [f[1], t[1]]));
function fileFor(u) {
  const rel = decodeURIComponent(REWRITES[u] || u).replace(/^\//, '');
  const cands = rel === '' ? ['index.html'] : rel.endsWith('/') ? [rel.slice(0, -1) + '.html', rel + 'index.html'] : [rel];
  return cands.map(c => path.join(root, c)).find(f => fs.existsSync(f) && f.endsWith('.html'));
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsaquo: '›', larr: '←', rarr: '→', middot: '·', mdash: '—', ndash: '–', hellip: '…', deg: '°', times: '×', le: '≤', ge: '≥' };
const decode = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] != null ? ENT[e] : m));
// Her sayfada tekrarlanan başlıklar aramada gürültü yaratır
const GENERIC = /^(öne çıkanlar|sık sorulan sorular|sss|örnek hesap|kaynaklar|dayanak|ilgili .*|içindekiler)$/i;
const text = h => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function extract(html) {
  const pick = re => { const m = html.match(re); return m ? text(m[1]) : ''; };
  const title = pick(/<title>([\s\S]*?)<\/title>/i).replace(/\s*[|–-]\s*VoltGuard.*$/i, '');
  const desc = decode((html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [, ''])[1]);
  let body = html.replace(/<!--vg:header-->[\s\S]*?<!--\/vg:header-->/, '').replace(/<!--vg:footer-->[\s\S]*?<!--\/vg:footer-->/, '');
  const main = body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  body = (main ? main[1] : (body.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, ''])[1])
    .replace(/<(script|style|noscript|svg|template|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  const h1 = pick(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const heads = [...body.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map(m => text(m[1])).filter(h => h && !GENERIC.test(h));
  const plain = text(body.replace(/<h[1-3]\b[\s\S]*?<\/h[1-3]>/gi, ' ')).replace(/^Ana içeriğe geç\s*/, '');
  return { title: title || h1, h1: h1 && h1 !== title ? h1 : '', desc, heads: [...new Set(heads)].slice(0, 24).join(' · '), body: plain.slice(0, BODY_CHARS) };
}

function build() {
  const urls = [...fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8').matchAll(/<loc>https:\/\/voltguard\.com\.tr(\/[^<]*)<\/loc>/g)].map(m => m[1]);
  const items = [];
  for (const u of urls) {
    const f = fileFor(u);
    if (!f) continue; // PDF vb.
    const html = fs.readFileSync(f, 'utf8');
    // Yanında index.php olan şablonların (VoltHaber) asıl sayfasını PHP üretir; şablondaki noindex yalnız statik yedeğe aittir
    const phpRendered = fs.existsSync(path.join(path.dirname(f), 'index.php'));
    if (!phpRendered && /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html)) continue;
    const e = extract(html);
    const it = { u, s: section(u), t: e.title };
    if (e.h1) it.h = e.h1;
    if (e.desc) it.d = e.desc;
    if (e.heads) it.k = e.heads;
    if (e.body) it.b = e.body;
    items.push(it);
  }
  // Sözlük terimleri: kısa tanım soruları ("kVA nedir") doğrudan ilgili maddeye gider
  for (const t of TERMS) items.push({ u: '/bilgi/elektrik-terimleri-sozlugu.html#' + t.id, s: 'Sözlük', t: t.term, k: (t.alt || []).join(' · '), d: t.def });
  return '/* Otomatik üretildi: node tools/build-search-index.cjs — elle düzenlemeyin. */\n' +
    'window.VG_SEARCH_INDEX=' + JSON.stringify(items) + ';\n';
}

const out = build();
const file = path.join(root, OUT);
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (cur !== out) { console.error(OUT + ' güncel değil: node tools/build-search-index.cjs'); process.exit(1); }
  console.log(OUT + ' güncel');
} else {
  fs.writeFileSync(file, out);
  console.log(OUT + ' yazıldı (' + (out.match(/"u":/g) || []).length + ' kayıt, ' + Math.round(out.length / 1024) + ' KB)');
}
