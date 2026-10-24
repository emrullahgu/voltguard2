'use strict';

// sitemap.xml ↔ dosyalar: her sitemap adresi gerçek bir sayfaya çözülür ve noindex değildir; dizine açık her
// içerik sayfası da sitemap'tedir. Temiz adresler netlify.toml'deki 200 kurallarıyla (ve .htaccess eşleriyle) çözülür.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const rewrites = Object.fromEntries(read('netlify.toml').split('[[redirects]]').slice(1)
  .map(b => [b.match(/from\s*=\s*"([^"]+)"/), b.match(/to\s*=\s*"(\/[^"]+\.html)"/), /status\s*=\s*200\b/.test(b)])
  .filter(([f, t, ok]) => f && t && ok).map(([f, t]) => [f[1], t[1]]));
function fileFor(u) {
  const rel = decodeURIComponent(rewrites[u] || u).replace(/^\//, '');
  const cands = rel === '' ? ['index.html'] : rel.endsWith('/') ? [rel.slice(0, -1) + '.html', rel + 'index.html'] : [rel];
  return cands.find(c => fs.existsSync(path.join(root, c)));
}
const urls = [...read('sitemap.xml').matchAll(/<loc>https:\/\/voltguard\.com\.tr(\/[^<]*)<\/loc>/g)].map(m => m[1]);

test('sitemap adresleri tekrarsız ve her biri mevcut, dizine açık bir sayfaya çözülür', () => {
  assert.equal(new Set(urls).size, urls.length, 'tekrarlanan adres');
  const missing = [], noindex = [];
  for (const u of urls) {
    const f = fileFor(u);
    if (!f) { missing.push(u); continue; }
    if (!f.endsWith('.html')) continue;
    const html = read(f);
    const phpRendered = fs.existsSync(path.join(root, path.dirname(f), 'index.php'));
    if (!phpRendered && /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html)) noindex.push(u);
  }
  assert.deepEqual(missing, [], 'dosyası olmayan sitemap adresleri');
  assert.deepEqual(noindex, [], 'noindex sayfalar sitemapte');
});

test('dizine açık içerik sayfaları sitemapte', () => {
  const inMap = new Set(urls.map(u => fileFor(u)).filter(Boolean));
  const dirs = ['bilgi', 'hizmetler', 'hesaplama', 'akademi', 'sor', 'mm', 'voltsim'];
  const pages = dirs.flatMap(d => fs.readdirSync(path.join(root, d), { recursive: true })
    .filter(f => String(f).endsWith('.html')).map(f => (d + '/' + String(f)).replace(/\\/g, '/')));
  const missing = pages.filter(p => {
    const html = read(p);
    if (/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html)) return false;
    return !inMap.has(p);
  });
  assert.deepEqual(missing, []);
});
