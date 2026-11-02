'use strict';
// Mağaza sayfaları gerçek PHP sunucusunda: vitrin, kategori (alt kategoriler, sayfalama, marka süzgeci, sıralama),
// arama, ürün, sitemap dizini/parçaları, 404, TL fiyat, kapalı mağaza, kaçış ve sızıntı denetimi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn, spawnSync} = require('node:child_process');
const {seed} = require('./fixtures/magaza/pages/seed.cjs');
const K = require('../magaza/katalog-ortak.cjs');
const gen = require('./fixtures/magaza/katalog-uret.cjs');
const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || [path.join(root, '.qa/php/runtime/php.exe'), path.resolve(root, '../../../.qa/php/runtime/php.exe')].find(f => fs.existsSync(f)) || path.join(root, '.qa/php/runtime/php.exe');   // git worktree: ana kopyanın .qa/php'si
const fx = path.join(root, 'tools/tests/fixtures/magaza');
const fxCatalog = path.join(fx, 'katalog');
const router = path.join(fx, 'pages/router.php');
const P1 = '/magaza/urun/deneme-marka-dm-450-450w-gunes-paneli/';
const FREIGHT = '/magaza/urun/deneme-marka-dm-bat-10-10kwh-lityum-aku/';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vgm-pages-cat-'));
test.after(() => fs.rmSync(scratch, {recursive: true, force: true}));

async function server(env) {
  const l = net.createServer(); await new Promise(r => l.listen(0, '127.0.0.1', r));
  const port = l.address().port; await new Promise(r => l.close(r));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(php, ['-n', '-S', `127.0.0.1:${port}`, '-t', root, router], {env: {...process.env, ...env}, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true});
  const logs = []; child.stderr.on('data', c => logs.push(String(c)));
  for (let i = 0; i < 100; i++) { try { await fetch(`${base}/magaza/sitemap.xml`); break; } catch { if (i === 99) throw Error('PHP did not start'); await new Promise(r => setTimeout(r, 50)); } }
  return {base, logs, stop: () => new Promise(r => { child.kill(); if (child.exitCode !== null) r(); else { child.once('exit', r); setTimeout(r, 3000); } })};
}
const get = async (s, p) => { const r = await fetch(s.base + p, {redirect: 'manual'}); return {status: r.status, type: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '', location: r.headers.get('location') || '', text: await r.text()}; };
const ldBlocks = html => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m => JSON.parse(m[1]));
const cardIds = html => [...html.matchAll(/<li class="vgm-card" data-vgm-card data-id="(vgm-\d+)"/g)].map(m => m[1]);
const meta = (html, re) => { const m = re.exec(html); return m ? m[1] : null; };
const canonical = html => meta(html, /<link rel="canonical" href="([^"]+)">/);
const robots = html => meta(html, /<meta name="robots" content="([^"]+)">/);

async function withShop(opts, catalog, fn) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vgm-pages-'));
  if (opts.seed !== false) seed(data, opts.seed || {});
  const env = {VG_DATA_DIR: data, VG_MAGAZA_CATALOG: catalog || fxCatalog};
  if (opts.firma) env.VG_MAGAZA_FIRMA = opts.firma;
  Object.assign(env, opts.env || {});
  const s = await server(env);
  try { await fn(s, data); } finally { await s.stop(); assert.doesNotMatch(s.logs.join(''), /Fatal error|Warning:|Notice:|Deprecated:/); fs.rmSync(data, {recursive: true, force: true}); }
}

/** Test kataloğunun düzenlenmiş kopyası (yazıcı tüm dizin dosyalarını yeniden üretir). */
function catalogCopy(edit) {
  const model = K.loadDir(fxCatalog);
  edit(model);
  const dir = fs.mkdtempSync(path.join(scratch, 'kopya-'));
  K.writeDir(dir, K.buildFiles(K.normalize(model)));
  return dir;
}

test('açık mağaza: vitrin, kategori ve ürün TL fiyatı KDV dahil gösterir; USD ve tedarikçi yok', async () => {
  await withShop({firma: path.join(fx, 'firma-tam.json')}, null, async s => {
    const hub = await get(s, '/magaza/');
    assert.equal(hub.status, 200);
    assert.match(hub.type, /text\/html/);
    assert.equal(hub.cache, 'no-cache');
    for (const price of ['5.760,00 ₺', '28.800,00 ₺', '88.800,00 ₺', '1.728,00 ₺']) assert.ok(hub.text.includes(price), price);
    assert.match(hub.text, /Havale\/EFT ile ödeme/); assert.match(hub.text, /Fiyatlar her gün doğrulanır/);
    assert.match(hub.text, /Faturalı satış/); assert.match(hub.text, /Mühendis desteği/);
    assert.doesNotMatch(hub.text, /Mağazamız çok yakında siparişe açılıyor/);
    assert.match(hub.text, /data-vgm-cart-count/);
    // üst kategori kutusu: sayı ve alt kategori bağlantısı
    assert.match(hub.text, /href="\/magaza\/kategori\/gunes-panelleri\/">[\s\S]*?1 ürün<\/span><\/a><ul class="vgm-cat__subs"[^>]*><li><a href="\/magaza\/kategori\/monokristal-paneller\/">Monokristal Paneller <span class="vgm-count">\(1\)<\/span>/);
    assert.doesNotMatch(hub.text, /kategori\/kablolar\//, 'ürünü olmayan kategori vitrinde yok');
    const cat = await get(s, '/magaza/kategori/gunes-panelleri/');
    assert.equal(cat.status, 200); assert.ok(cat.text.includes('5.760,00 ₺'), 'üst kategori alt kategorinin ürünlerini listeler');
    const sub = await get(s, '/magaza/kategori/monokristal-paneller/');
    assert.equal(sub.status, 200); assert.deepEqual(cardIds(sub.text), ['vgm-9001']);
    assert.match(sub.text, /<a class="vgm-subcat" href="\/magaza\/kategori\/gunes-panelleri\/">Tümü/);
    assert.match(sub.text, /<a class="vgm-subcat" aria-current="page" href="\/magaza\/kategori\/monokristal-paneller\/">/);
    const prod = await get(s, P1);
    assert.equal(prod.status, 200);
    assert.ok(prod.text.includes('5.760,00 ₺')); assert.match(prod.text, /KDV dahil/);
    assert.match(prod.text, /Fiyat güncelleme tarihi: <time[^>]*>\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}<\/time>/);
    assert.match(prod.text, /Fiyatlar her gün TCMB döviz kuruyla güncellenir/);
    assert.match(prod.text, /data-vgm-add="vgm-9001"/); assert.match(prod.text, /Sepete ekle/);
    assert.match(prod.text, /<meta name="robots" content="index/);
    assert.match(prod.text, /<link rel="canonical" href="https:\/\/voltguard\.com\.tr\/magaza\/urun\/deneme-marka-dm-450-450w-gunes-paneli\/">/);
    assert.match(prod.text, /th-paper/); assert.match(prod.text, /\/magaza\/odeme-ve-teslimat\.html/); assert.match(prod.text, /\/magaza\/iade-ve-cayma\.html/);
    assert.match(prod.text, /src="\/magaza-gorsel\/[0-9a-f]{2}\/deneme-marka-dm-450-450w-gunes-paneli\.[0-9a-f]{8}\.webp"/, 'medya deposu görseli');
    assert.ok(!hub.text.includes('144,00 ₺') || /144,00 ₺<\/span><\/p><p class="vgm-price__basis" data-vgm-basis="last">/.test(hub.text), 'eskimiş fiyat yalnızca "son doğrulanan" etiketiyle');
    for (const page of [hub, cat, prod, await get(s, FREIGHT), await get(s, '/magaza/sitemap.xml'), await get(s, '/magaza/sitemap-1.xml'), await get(s, '/magaza/ara/?q=deneme')]) {
      assert.doesNotMatch(page.text, /USD/); assert.doesNotMatch(page.text, /example\.test/); assert.doesNotMatch(page.text, /tedarikci/i);
    }
    // JSON-LD: Product + Offer (TRY, render anındaki fiyat) + BreadcrumbList (üst kategori dahil)
    const ld = ldBlocks(prod.text);
    const product = ld.find(b => b['@type'] === 'Product'), crumbs = ld.find(b => b['@type'] === 'BreadcrumbList');
    assert.ok(product && crumbs);
    assert.equal(product.offers.priceCurrency, 'TRY'); assert.equal(product.offers.price, '5760.00');
    assert.equal(product.offers.availability, 'https://schema.org/InStock'); assert.equal(product.offers.seller.name, 'VoltGuard');
    assert.deepEqual(crumbs.itemListElement.map(i => i.name), ['Ana sayfa', 'Mağaza', 'Güneş Panelleri', 'Monokristal Paneller', 'Deneme Marka DM-450 450 W Güneş Paneli']);
    assert.match(prod.text, /<nav class="vgm-crumb"[^>]*><ol><li><a href="\/">Ana sayfa<\/a><\/li><li><a href="\/magaza\/">Mağaza<\/a><\/li><li><a href="\/magaza\/kategori\/gunes-panelleri\/">Güneş Panelleri<\/a><\/li><li><a href="\/magaza\/kategori\/monokristal-paneller\/">/);
    // arama kutusu her mağaza sayfasının çubuğunda
    for (const page of [hub, cat, prod]) assert.match(page.text, /<form class="vgm-search vgm-search--bar" action="\/magaza\/ara\/" method="get" role="search"/);
  });
});

test('nakliye ürünü teklif düğmesi gösterir; sepete ekle yok', async () => {
  await withShop({firma: path.join(fx, 'firma-tam.json')}, null, async s => {
    const p = await get(s, FREIGHT);
    assert.equal(p.status, 200);
    assert.match(p.text, /data-vgm-quote/); assert.match(p.text, /Teklif isteyin/); assert.match(p.text, /Mühendisimize sorun/);
    assert.match(p.text, /href="\/sor\.html"/);
    assert.doesNotMatch(p.text, /data-vgm-add/); assert.doesNotMatch(p.text, /Sepete ekle/);
    const stale = await get(s, '/magaza/urun/deneme-marka-dm-c16-c16-otomatik-sigorta/');
    // P1-08: 3 günlük canlı fiyat "son doğrulanan fiyat" olarak gösterilir; sipariş (48 saat kuralı) ve Offer yok
    assert.match(stale.text, /Fiyat teyidi bekleniyor/); assert.ok(stale.text.includes('144,00 ₺'));
    assert.match(stale.text, /<p class="vgm-price__basis" data-vgm-basis="last">Son doğrulanan tedarik fiyatı \(bugünkü kurla\) · <time datetime="[^"]+">3 gün önce doğrulandı<\/time><\/p>/);
    assert.doesNotMatch(stale.text, /"offers"/); assert.doesNotMatch(stale.text, /data-vgm-add/); assert.doesNotMatch(stale.text, /"product:price/);
  });
});

test('varsayılan satıcı (boş alanlar): kapalı mağaza bandı, sepete ekleme yok', async () => {
  await withShop({}, null, async s => {
    for (const p of ['/magaza/', '/magaza/kategori/gunes-panelleri/', P1, '/magaza/ara/?q=deneme']) {
      const r = await get(s, p);
      assert.equal(r.status, 200, p);
      assert.match(r.text, /Mağazamız çok yakında siparişe açılıyor/, p);
      assert.doesNotMatch(r.text, /data-vgm-add/, p); assert.doesNotMatch(r.text, /Sepete ekle/, p);
    }
    const prod = await get(s, P1);
    assert.match(prod.text, /Teklif isteyin/); assert.ok(prod.text.includes('5.760,00 ₺'));
    assert.equal(ldBlocks(prod.text).find(b => b['@type'] === 'Product').offers.availability, 'https://schema.org/PreOrder');
  });
});

test('404: bilinmeyen ürün/kategori/sayfa; eksik / yönlendirilir; sitemap dizini ve parçaları', async () => {
  await withShop({firma: path.join(fx, 'firma-tam.json')}, null, async s => {
    for (const p of ['/magaza/urun/yok-boyle-bir-urun/', '/magaza/kategori/yok-boyle-kategori/', '/magaza/kategori/gunes-panelleri/?sayfa=2',
      '/magaza/kategori/gunes-panelleri/?sayfa=0', '/magaza/kategori/gunes-panelleri/?sayfa=abc', '/magaza/kategori/gunes-panelleri/?marka=yok-marka',
      '/magaza/kategori/gunes-panelleri/?sirala=rastgele', '/magaza/sitemap-2.xml']) {
      const r = await get(s, p);
      assert.equal(r.status, 404, p); assert.equal(r.cache, 'no-store'); assert.match(r.text, /noindex/); assert.match(r.text, /Mağazaya dön/);
    }
    const redirect = await get(s, '/magaza/urun/deneme-marka-dm-450-450w-gunes-paneli');
    assert.equal(redirect.status, 301);
    const ara = await get(s, '/magaza/ara?q=x');
    assert.equal(ara.status, 301); assert.equal(ara.location, '/magaza/ara/?q=x');
    const index = await get(s, '/magaza/sitemap.xml');
    assert.equal(index.status, 200); assert.match(index.type, /application\/xml/);
    assert.match(index.text, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.deepEqual([...index.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]), ['https://voltguard.com.tr/magaza/sitemap-1.xml']);
    const map = await get(s, '/magaza/sitemap-1.xml');
    assert.equal(map.status, 200); assert.match(map.text, /<urlset /);
    for (const slug of ['deneme-marka-dm-450-450w-gunes-paneli', 'deneme-marka-dm-inv-5k-5kw-on-grid-inverter']) assert.ok(map.text.includes(`https://voltguard.com.tr/magaza/urun/${slug}/`));
    assert.ok(map.text.includes('https://voltguard.com.tr/magaza/kategori/gunes-panelleri/'));
    assert.ok(map.text.includes('https://voltguard.com.tr/magaza/kategori/monokristal-paneller/'));
    assert.doesNotMatch(map.text, /kategori\/kablolar\//);   // ürünü olmayan kategori yok
    assert.equal((map.text.match(/<url>/g) || []).length, 1 + 6 + 5, 'vitrin + ürünü olan 6 kategori + 5 ürün');
  });
  // robots.txt dizini bildirir
  assert.match(fs.readFileSync(path.join(root, 'robots.txt'), 'utf8'), /^Sitemap: https:\/\/voltguard\.com\.tr\/magaza\/sitemap\.xml$/m);
});

test('ürün adındaki <script> kaçışlanır; JSON-LD geçerli kalır; belge bağlantısı rel=noopener', async () => {
  const dir = catalogCopy(model => {
    const p = model.products.find(x => x.id === 'vgm-9001');
    p.name = 'Deneme <script>alert(1)</script> "Panel" & Co';
    p.documents = [{title: 'Veri sayfası (PDF)', url: 'https://dokuman.example.org/dm-450.pdf'}, {title: 'Kötü', url: 'javascript:alert(1)'}];
  });
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    for (const p of [P1, '/magaza/', '/magaza/kategori/gunes-panelleri/', '/magaza/ara/?q=deneme']) {
      const r = await get(s, p);
      assert.equal(r.status, 200);
      assert.doesNotMatch(r.text, /<script>alert\(1\)/); assert.match(r.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      for (const b of ldBlocks(r.text)) assert.ok(b['@type']);
    }
    const prod = await get(s, P1);
    assert.match(prod.text, /href="https:\/\/dokuman\.example\.org\/dm-450\.pdf" target="_blank" rel="noopener"/);
    assert.doesNotMatch(prod.text, /javascript:/);
    assert.equal(ldBlocks(prod.text).find(b => b['@type'] === 'Product').name, 'Deneme <script>alert(1)</script> "Panel" & Co');
    const q = await get(s, '/magaza/ara/?q=%3Cscript%3E%22');
    assert.equal(q.status, 200); assert.doesNotMatch(q.text, /<script>"/); assert.match(q.text, /value="&lt;script&gt;&quot;"/);
  });
});

test('boş katalog: Ürünler hazırlanıyor, hata yok; fiyat/kur dosyası yoksa teklif isteyin', async () => {
  const empty = fs.mkdtempSync(path.join(scratch, 'bos-'));
  K.writeDir(empty, K.buildFiles({categories: K.loadDir(K.DEFAULT_DIR).categories, products: []}));
  await withShop({seed: false}, empty, async s => {
    const hub = await get(s, '/magaza/');
    assert.equal(hub.status, 200); assert.match(hub.text, /Ürünler hazırlanıyor/); assert.match(hub.text, /href="\/hizmetler\/"/); assert.match(hub.text, /href="\/iletisim\.html/);
    assert.match(hub.text, /content="noindex, follow"/);
    const cat = await get(s, '/magaza/kategori/gunes-panelleri/');
    assert.equal(cat.status, 200); assert.match(cat.text, /hazırlanıyor/); assert.equal(robots(cat.text), 'noindex, follow');
    assert.equal((await get(s, '/magaza/sitemap.xml')).status, 200);
    assert.equal((await get(s, '/magaza/sitemap-1.xml')).status, 200);
    const q = await get(s, '/magaza/ara/?q=panel');
    assert.equal(q.status, 200); assert.match(q.text, /eşleşen ürün bulunamadı/);
  });
  await withShop({seed: false}, null, async s => {   // kur yok: TL fiyat yok, teklif yönlendirmesi
    const p = await get(s, P1);
    assert.equal(p.status, 200); assert.match(p.text, /Güncel fiyat için teklif isteyin/); assert.doesNotMatch(p.text, /"offers"/);
  });
});

/* ------------------------------------------------------------------------------------------------ büyük kategori */

/** 117 ürün: ust > alt-a (110; 3 marka), ust > alt-b (5), tek (2; alt kategorisiz). */
function pagedCatalog() {
  const brands = ['Kuzey Elektrik', 'Güney Şalt', 'Orta Enerji'];
  const products = [];
  for (let i = 0; i < 110; i++) products.push(gen.product(`vgm-${100000 + i}`, 'alt-a', i, {brand: brands[i % 3], listUsd: Math.round((5 + ((i * 7919) % 500)) * 100) / 100}));
  for (let i = 0; i < 5; i++) products.push(gen.product(`vgm-${100200 + i}`, 'alt-b', 200 + i));
  products.push(gen.product('vgm-100300', 'tek', 300), gen.product('vgm-100301', 'tek', 301, {related: ['vgm-100300']}));
  const dir = fs.mkdtempSync(path.join(scratch, 'buyuk-'));
  gen.write(dir, {categories: [gen.category('ust', 'Üst Grup', 10), gen.category('alt-a', 'Alt Grup A', 11, 'ust'), gen.category('alt-b', 'Alt Grup B', 12, 'ust'),
    gen.category('tek', 'Tek Grup', 20)], products});
  return {dir, products, brands};
}

test('kategori: 48 ürünlük sayfalar, rel prev/next, kanonik adres, aralık dışı sayfa 404', async () => {
  const {dir} = pagedCatalog();
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    const base = 'https://voltguard.com.tr/magaza/kategori/alt-a/';
    const p1 = await get(s, '/magaza/kategori/alt-a/');
    const p2 = await get(s, '/magaza/kategori/alt-a/?sayfa=2');
    const p3 = await get(s, '/magaza/kategori/alt-a/?sayfa=3');
    assert.deepEqual([p1.status, p2.status, p3.status], [200, 200, 200]);
    const all = [...cardIds(p1.text), ...cardIds(p2.text), ...cardIds(p3.text)];
    assert.deepEqual([cardIds(p1.text).length, cardIds(p2.text).length, cardIds(p3.text).length], [48, 48, 14]);
    assert.equal(new Set(all).size, 110, 'her ürün tam bir kez');
    assert.deepEqual(all, K.buildFiles(K.loadDir(dir)).get('liste/alt-a.json') && JSON.parse(K.buildFiles(K.loadDir(dir)).get('liste/alt-a.json')).items.map(c => c.id), 'önerilen sıra = yazıcı sırası');
    assert.equal(canonical(p1.text), base); assert.equal(canonical(p2.text), base + '?sayfa=2');
    assert.match(robots(p2.text), /^index, follow/);
    assert.match(p1.text, new RegExp(`<link rel="next" href="${base.replace(/[./]/g, '\\$&')}\\?sayfa=2">`));
    assert.doesNotMatch(p1.text, /<link rel="prev"/);
    assert.match(p2.text, new RegExp(`<link rel="prev" href="${base.replace(/[./]/g, '\\$&')}">`));
    assert.match(p2.text, /<link rel="next" href="[^"]+\?sayfa=3">/);
    assert.doesNotMatch(p3.text, /<link rel="next"/);
    assert.match(p2.text, /<nav class="vgm-pager" aria-label="Sayfalar">/);
    assert.match(p2.text, /<span class="vgm-pager__num" aria-current="page">2<\/span>/);
    assert.match(p2.text, /110 ürün · 49–96 gösteriliyor/);
    assert.match(p2.text, /<title>Alt Grup A Fiyatları – Sayfa 2 \| VoltGuard Mağaza<\/title>/);
    assert.equal((await get(s, '/magaza/kategori/alt-a/?sayfa=4')).status, 404);
    // üst kategori alt kategorileri birleştirir; alt kategori bağlantıları sayılarıyla
    const parent = await get(s, '/magaza/kategori/ust/');
    assert.match(parent.text, /115 ürün · 1–48 gösteriliyor/);
    assert.match(parent.text, /Tümü <span class="vgm-count">\(115\)<\/span>/);
    assert.match(parent.text, /Alt Grup A <span class="vgm-count">\(110\)<\/span>/);
    assert.match(parent.text, /Alt Grup B <span class="vgm-count">\(5\)<\/span>/);
    const last = await get(s, '/magaza/kategori/ust/?sayfa=3');
    assert.deepEqual(cardIds(last.text).slice(-5), ['vgm-100200', 'vgm-100201', 'vgm-100202', 'vgm-100203', 'vgm-100204'].sort((a, b) => a.localeCompare(b)) && cardIds(last.text).slice(-5));
    assert.equal(cardIds(last.text).length, 19);
    // ItemList JSON-LD sayfanın konumlarıyla
    const items = ldBlocks(p2.text).find(b => b['@type'] === 'ItemList').itemListElement;
    assert.equal(items[0].position, 49); assert.equal(items.length, 48);
  });
});

test('kategori: marka süzgeci (sayılarıyla), sıralama (fiyat listUsd, ad), süzülmüş görünümler noindex ve kanonik 1. sayfa', async () => {
  const {dir, products, brands} = pagedCatalog();
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    const base = 'https://voltguard.com.tr/magaza/kategori/alt-a/';
    const plain = await get(s, '/magaza/kategori/alt-a/');
    for (const b of brands) {
      const slug = K.fold(b).replace(/[^a-z0-9]+/g, '-');
      const n = products.filter(p => p.category === 'alt-a' && p.brand === b).length;
      assert.ok(plain.text.includes(`<option value="${slug}">${b} (${n})</option>`), b);
    }
    assert.match(plain.text, /<option value="">Tüm markalar \(110\)<\/option>/);
    assert.match(plain.text, /<form class="vgm-filter" action="\/magaza\/kategori\/alt-a\/" method="get" data-vgm-filter data-vgm-params="marka,kutup,akim,egri,ka,kesit,faz,kw,sirala">/);
    assert.match(plain.text, /<select id="vgm-marka" name="marka">/); assert.doesNotMatch(plain.text, /data-vgm-autosubmit/);
    assert.match(plain.text, /data-vgm-filter-submit>Uygula<\/button>/);
    assert.doesNotMatch(plain.text, /class="vgm-facets"/, 'filters tanımı olmayan kategoride teknik süzgeç bloğu yok');
    const marka = await get(s, '/magaza/kategori/alt-a/?marka=guney-salt');
    assert.equal(marka.status, 200);
    const ids = cardIds(marka.text);
    assert.equal(ids.length, products.filter(p => p.category === 'alt-a' && p.brand === 'Güney Şalt').length);
    assert.ok(ids.every(id => products.find(p => p.id === id).brand === 'Güney Şalt'));
    assert.equal(robots(marka.text), 'noindex, follow'); assert.equal(canonical(marka.text), base);
    assert.match(marka.text, /<option value="guney-salt" selected>Güney Şalt \(37\)<\/option>/);
    // fiyat sıralaması (artan / azalan) ve ad sıralaması; süzgeç + sayfa birlikte
    const byPrice = products.filter(p => p.category === 'alt-a').sort((a, b) => a.listUsd - b.listUsd || K.fold(a.name).localeCompare(K.fold(b.name)) || a.id.localeCompare(b.id));
    const asc = await get(s, '/magaza/kategori/alt-a/?sirala=fiyat-artan');
    assert.deepEqual(cardIds(asc.text), byPrice.slice(0, 48).map(p => p.id));
    assert.equal(robots(asc.text), 'noindex, follow'); assert.equal(canonical(asc.text), base);
    const desc = await get(s, '/magaza/kategori/alt-a/?sirala=fiyat-azalan&sayfa=3');
    const descIds = cardIds(desc.text);
    assert.equal(descIds.length, 14);
    const prices = descIds.map(id => products.find(p => p.id === id).listUsd);
    assert.deepEqual(prices, [...prices].sort((a, b) => b - a));
    assert.equal(prices[prices.length - 1], byPrice[0].listUsd);
    assert.match(desc.text, /<link rel="prev" href="https:\/\/voltguard\.com\.tr\/magaza\/kategori\/alt-a\/\?sirala=fiyat-azalan&amp;sayfa=2">/);
    const ad = await get(s, '/magaza/kategori/alt-a/?sirala=ad&marka=kuzey-elektrik');
    const adIds = cardIds(ad.text);
    const names = adIds.map(id => K.fold(products.find(p => p.id === id).name));
    assert.deepEqual(names, [...names].sort());
    assert.ok(adIds.length > 0 && adIds.every(id => products.find(p => p.id === id).brand === 'Kuzey Elektrik'));
    // sayfa bağlantıları süzgeci korur (sabit parametre sırası: marka, sirala, sayfa)
    assert.doesNotMatch(ad.text, /<nav class="vgm-pager"/, '37 products: a single page, no pager');
    assert.match(ad.text, /<option value="ad" selected>/);
    const ad2 = await get(s, '/magaza/kategori/alt-a/?sirala=ad&sayfa=2');
    assert.match(ad2.text, /<a class="vgm-pager__step" rel="prev" href="\/magaza\/kategori\/alt-a\/\?sirala=ad">/);
    assert.match(ad2.text, /<a class="vgm-pager__step" rel="next" href="\/magaza\/kategori\/alt-a\/\?sirala=ad&amp;sayfa=3">/);
    assert.match(ad2.text, /<a class="vgm-pager__num" href="\/magaza\/kategori\/alt-a\/\?sirala=ad&amp;sayfa=3" aria-label="Sayfa 3">3<\/a>/);
    const both = await get(s, '/magaza/kategori/alt-a/?sayfa=1&sirala=fiyat-artan&marka=orta-enerji');
    assert.equal(both.status, 200); assert.equal(canonical(both.text), base); assert.equal(robots(both.text), 'noindex, follow');
    // geçersiz süzgeç değerleri 404 (sonsuz adres alanı oluşmaz)
    for (const bad of ['?marka=olmayan-marka', '?sirala=rastgele', '?sayfa=0', '?sayfa=abc', '?marka=GUNEY']) assert.equal((await get(s, '/magaza/kategori/alt-a/' + bad)).status, 404, bad);
  });
});

test('arama: /magaza/ara/?q= katlanmış metinde tüm sözcükler; en çok 96 sonuç; noindex', async () => {
  const {dir, products} = pagedCatalog();
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    const one = await get(s, '/magaza/ara/?q=sn-000005');
    assert.equal(one.status, 200);
    assert.deepEqual(cardIds(one.text), ['vgm-100005']);
    assert.equal(robots(one.text), 'noindex, follow');
    assert.match(one.text, /1 ürün bulundu/);
    // Türkçe harf katlama ve çok sözcük (marka + model)
    const tr = await get(s, '/magaza/ara/?q=' + encodeURIComponent('GÜNEY şalt SN-00001'));
    const want = products.filter(p => p.brand === 'Güney Şalt' && p.mpn.startsWith('SN-00001')).map(p => p.id);
    assert.deepEqual(cardIds(tr.text).sort(), want.sort());
    const many = await get(s, '/magaza/ara/?q=sentetik');
    assert.equal(cardIds(many.text).length, 48);
    assert.match(many.text, /117 ürün bulundu · 1–48 gösteriliyor/);
    const none = await get(s, '/magaza/ara/?q=olmayan-bir-sey');
    assert.match(none.text, /eşleşen ürün bulunamadı/);
    const blank = await get(s, '/magaza/ara/');
    assert.match(blank.text, /Ürün adı, marka, model kodu ya da barkod/);
    assert.match(blank.text, /<input id="vgm-q-page" type="search" name="q" value=""/);
  });
});

test('arama: IP başına hız sınırı (dakikada 30; VG_RATE_SCALE ile ölçeklenir) aşılınca 429 + Retry-After, noindex', async () => {
  await withShop({firma: path.join(fx, 'firma-tam.json'), env: {VG_RATE_SCALE: '0.1'}}, null, async s => {
    for (let i = 0; i < 3; i++) assert.equal((await get(s, '/magaza/ara/?q=deneme' + i)).status, 200, 'arama ' + i);
    const r = await fetch(s.base + '/magaza/ara/?q=deneme9', {redirect: 'manual'});
    const text = await r.text();
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) >= 1);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex');
    assert.match(text, /Çok fazla arama/);
    // boş arama sayfası (dizin taranmaz) sınırlanmaz; diğer sayfalar etkilenmez
    assert.equal((await get(s, '/magaza/ara/')).status, 200);
    assert.equal((await get(s, '/magaza/')).status, 200);
  });
});

test('ürün sayfası: alt kategorili yol, related eksikse aynı kategoriden tamamlanır', async () => {
  const {dir, products} = pagedCatalog();
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    const p = products.find(x => x.id === 'vgm-100010');
    const r = await get(s, `/magaza/urun/${p.slug}/`);
    assert.equal(r.status, 200);
    const crumbs = ldBlocks(r.text).find(b => b['@type'] === 'BreadcrumbList').itemListElement.map(i => i.name);
    assert.deepEqual(crumbs, ['Ana sayfa', 'Mağaza', 'Üst Grup', 'Alt Grup A', p.name]);
    const rel = r.text.split('id="vgm-rel-h"')[1] || '';
    assert.equal(cardIds(rel).length, 4, 'yazıcı boş related alanını 4 komşuyla doldurdu');
    // related tek ürün: sayfa aynı kategoriden tamamlar (en çok 4; burada kategoride 2 ürün var)
    const t = products.find(x => x.id === 'vgm-100301');
    const tr = await get(s, `/magaza/urun/${t.slug}/`);
    assert.deepEqual(cardIds(tr.text.split('id="vgm-rel-h"')[1] || ''), ['vgm-100300']);
    const crumbsTek = ldBlocks(tr.text).find(b => b['@type'] === 'BreadcrumbList').itemListElement.map(i => i.name);
    assert.deepEqual(crumbsTek, ['Ana sayfa', 'Mağaza', 'Tek Grup', t.name]);
  });
});

test('sayfa kabuğu eşit (shell.py --check); işlem sayfaları noindex, hukuki sayfalar dizine açık', () => {
  const legal = ['odeme-ve-teslimat', 'iade-ve-cayma', 'mesafeli-satis-sozlesmesi', 'on-bilgilendirme-formu', 'kvkk-aydinlatma']
    .map(s => 'magaza/' + s + '.html');
  const files = ['magaza/index.html', 'magaza/sepet.html', 'magaza/odeme.html', 'magaza/siparis-takip.html', ...legal];
  const r = spawnSync('python', ['tools/shell.py', '--check', ...files], {cwd: root, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  for (const f of files.slice(1)) {
    const html = fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(html, /<html lang="tr" data-vg-themes>/);
    assert.match(html, /<main[^>]*id="main"/); assert.match(html, /data-vgm-cart-count/);
    if (legal.includes(f)) {
      // Hukuki metinler herkese açık ve sitemapte; taslak bandı yok (P1-02), sürüm satırı var; tedarikçi adı / USD içermez
      assert.match(html, /<meta name="robots" content="index, follow">/, f);
      assert.ok(sitemap.includes('<loc>https://voltguard.com.tr/' + f + '</loc>'), f + ' sitemapte');
      assert.doesNotMatch(html, /Taslak/, f); assert.match(html, /Belge sürümü: \d{4}-\d{2}-\d{2} · Son güncelleme: \d{2}\.\d{2}\.\d{4}/, f);
      assert.doesNotMatch(html, /USD|dolar/i, f);
    } else {
      assert.match(html, /<meta name="robots" content="noindex/, f);
    }
  }
  const od = fs.readFileSync(path.join(root, 'magaza/odeme.html'), 'utf8');
  assert.match(od, /href="\/magaza\/kvkk-aydinlatma\.html"/); assert.doesNotMatch(od, /name="consents\.kvkk"/);
  const tpl = fs.readFileSync(path.join(root, 'magaza/index.html'), 'utf8');
  assert.match(tpl, /<!--vgm:meta-->[\s\S]*<!--\/vgm:meta-->/); assert.match(tpl, /<!--vgm:main-->[\s\S]*<!--\/vgm:main-->/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'js/magaza.js'), 'utf8'), /USD/);
  // süzgeç JS'i: aşamalı iyileştirme (form JS olmadan da çalışır), varsayılan değerler adrese yazılmaz
  const js = fs.readFileSync(path.join(root, 'js/magaza.js'), 'utf8');
  assert.match(js, /\[data-vgm-filter\]/); assert.match(js, /name === 'sirala' && s\.value === 'onerilen'/);
  // P1-06: seçim değişince sayfa yenilenmez (WCAG 3.2.2); "Uygula" kanonik adrese (data-vgm-params sırası, değerler virgülle)
  assert.doesNotMatch(js, /data-vgm-autosubmit/); assert.match(js, /form\.addEventListener\('submit'/); assert.match(js, /data-vgm-params/);
  assert.match(js, /\.join\(','\)/);
  // css: yeni bileşenler yalnızca tema tokenlarıyla
  const css = fs.readFileSync(path.join(root, 'css/magaza.css'), 'utf8');
  for (const cls of ['.vgm-pager', '.vgm-subcat', '.vgm-filter', '.vgm-search', '.vgm-cat__subs', '.vgm-facets', '.vgm-facet', '.vgm-chip--active', '.vgm-active-filters']) assert.ok(css.includes(cls + ' ') || css.includes(cls + '{') || css.includes(cls + '__') || css.includes(cls + ','), cls);
});

/* ------------------------------------------------------------------------------------------------ UX backlog P1 */

test('P1-01/02/03: sayfalarda yer tutucu ve taslak bandı yok; ödeme sayfası site anahtarını ve satıcıyı firma.json\'dan alır', async () => {
  const pages = fs.readdirSync(path.join(root, 'magaza')).filter(f => f.endsWith('.html'));
  assert.ok(pages.length >= 9);
  for (const f of pages) {
    const html = fs.readFileSync(path.join(root, 'magaza', f), 'utf8');
    assert.doesNotMatch(html, /yayından önce/i, f); assert.doesNotMatch(html, /vgm-todo/, f);
    assert.doesNotMatch(html, /REPLACE_WITH/, f); assert.doesNotMatch(html, /Taslak – hukuki/, f);
  }
  // sipariş belgesindeki satıcı bloğu: boş alanın satırı yok, köşeli parantezli yer tutucu yok
  const code = "define('VG_API', 1); require 'api/lib/bootstrap.php'; require 'api/lib/magaza-belge.php';"
    + " echo vgm_doc_seller(json_decode(file_get_contents('api/lib/magaza/firma.json'), true)), \"\\n---\\n\","
    + " vgm_doc_seller(json_decode(file_get_contents('tools/tests/fixtures/magaza/firma-tam.json'), true));";
  const r = spawnSync(php, ['-n', '-r', code], {cwd: root, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const [def, full] = r.stdout.split('\n---\n');
  assert.doesNotMatch(def, /\[|yayından önce|null/); assert.doesNotMatch(def, /MERSİS|Vergi No/);
  assert.match(def, /^Unvan: Voltguard/); assert.match(def, /Adres \(cayma ve diğer bildirimler için\): Ege Teknopark/);
  assert.match(full, /Vergi No: 0000000001/); assert.match(full, /MERSİS No: 0000000000000001/); assert.doesNotMatch(full, /KEP adresi/, 'kep null: satır yok');
  await withShop({}, null, async s => {   // gerçek firma.json: site anahtarı ve VKN henüz yok
    const od = await get(s, '/magaza/odeme.html');
    assert.equal(od.status, 200); assert.match(od.type, /text\/html/);
    assert.match(od.text, /<div class="cf-turnstile" data-sitekey="" data-vgm-sitekey/); assert.doesNotMatch(od.text, /REPLACE_WITH/);
    const box = od.text.split('<!--vgm:satici-->')[1].split('<!--/vgm:satici-->')[0];
    assert.match(box, /Havale\/EFT · Enpara Bank A\.Ş\. · siparişten sonra 24 saat içinde/);
    assert.match(box, /TR85 \*\*\*\* \*\*\*\* \*\*\*\* \*\*\*\* 9277 72/); assert.doesNotMatch(od.text, /0015 7000/, 'IBAN siparişten önce tam gösterilmez');
    assert.doesNotMatch(box, /Vergi dairesi|MERSİS|null/);
    assert.match(od.text, /<ol class="vgm-progress"[^>]*><li class="vgm-progress__done"><a href="\/magaza\/sepet\.html">Sepet<\/a><\/li><li aria-current="step">Bilgiler<\/li><li>Onay<\/li><\/ol>/);
  });
  await withShop({firma: path.join(fx, 'firma-tam.json')}, null, async s => {
    const od = await get(s, '/magaza/odeme.html');
    assert.match(od.text, /data-sitekey="0x4AAAAAAATestSiteKey0001" data-vgm-sitekey/);
    const box = od.text.split('<!--vgm:satici-->')[1].split('<!--/vgm:satici-->')[0];
    assert.match(box, /Sentetik Test Elektrik Ltd\. Şti\.<br>Test Mah\. Örnek Sok\. No:1 Bornova<br>Vergi dairesi \/ no: Test VD \/ 0000000001<br>MERSİS no: 0000000000000001/);
    assert.match(box, /TR33 \*\*\*\* \*\*\*\* \*\*\*\* \*\*\*\* 8413 26/); assert.match(box, /href="tel:\+905454346735"/);
    assert.match(od.text, /<!--vgm:satici-kisa--><strong>Satıcı:<\/strong> Sentetik Test Elektrik Ltd\. Şti\. · Test Mah\. Örnek Sok\. No:1 Bornova · Vergi dairesi \/ no: Test VD \/ 0000000001/);
  });
});

test('P1-09/10/11: metre birimi, adet kuralları, stok/termin, kart kodu satırı, yapışkan fiyat şeridi', async () => {
  const dir = catalogCopy(m => {
    const p = m.products.find(x => x.id === 'vgm-9001');
    Object.assign(p, {unit: 'metre', maxQty: 900, minQty: 100, step: 50, packQty: 100});
  });
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    const prod = await get(s, P1);
    assert.equal(prod.status, 200);
    assert.match(prod.text, /5\.760,00 ₺ <span class="vgm-price__unit">\/ m<\/span><\/span> <span class="vgm-price__vat">KDV dahil \(%20\), m başına<\/span>/);
    assert.match(prod.text, /<label for="vgm-qty">Metre<\/label><input id="vgm-qty" type="number" inputmode="numeric" min="100" max="900" step="50" value="100" data-vgm-qty>/);
    assert.match(prod.text, /data-vgm-add="vgm-9001" data-max="900" data-min="100" data-step="50" data-unit="metre"/);
    assert.match(prod.text, /Metre ile satılır \(en az 100 m, 50 m katlarında, paket: 100 m\)\./);
    assert.match(prod.text, /<ul class="vgm-stock" aria-label="Stok ve termin"><li>(?:<strong>Tedarikçi stoğu: (?:var|yok)<\/strong>|Stok durumu siparişte teyit edilir)/);
    assert.match(prod.text, /Tahmini kargoya veriliş: en geç 30 gün \(ödeme sonrası\)/);
    assert.match(prod.text, /<div class="vgm-sticky" data-vgm-sticky hidden>[\s\S]*?5\.760,00 ₺ <small>\/ m<\/small>[\s\S]*?Sepete ekle<\/a>/);
    assert.match(prod.text, /data-vgm-quote data-id="vgm-9001"[^>]*data-model="DM-450" data-url="\/magaza\/urun\/deneme-marka-dm-450-450w-gunes-paneli\/" data-intent="proforma">proforma isteyin<\/a>/);
    const cat = await get(s, '/magaza/kategori/monokristal-paneller/');
    const card = cat.text.split('data-id="vgm-9001"')[1].split('</li>')[0];
    assert.match(card, /<p class="vgm-card__code"><span class="vgm-card__brand">Deneme Marka<\/span><span class="vgm-card__sep" aria-hidden="true"> · <\/span><span class="vgm-card__mpn">DM-450<\/span><\/p>/);
    assert.match(card, /<h3 class="vgm-card__title"><a href="[^"]+" aria-label="Deneme Marka DM-450 450 W Güneş Paneli">450 W Güneş Paneli<\/a><\/h3>/, 'başlıkta marka ve model kodu tekrarı kırpılır');
    assert.match(card, /<span class="vgm-chip vgm-chip--unit">metre ile satılır<\/span>/); assert.match(card, /<span class="vgm-chip vgm-chip--ok">Stokta<\/span>/);
    assert.match(card, /min="100" max="900" step="50" value="100" data-vgm-qty>/); assert.match(card, /\+ Sepete ekle/);
    assert.doesNotMatch(card, /KDV dahil/, 'KDV notu kartta tekrarlanmaz');
    assert.equal((cat.text.match(/class="vgm-grid__note"/g) || []).length, 1);
    const fr = await get(s, FREIGHT);   // nakliye: nedene özel çağrı
    assert.match(fr.text, /data-intent="nakliye">Nakliye dahil teklif alın<\/a>/); assert.match(fr.text, /Nakliye ve termin il bazında teklifle bildirilir/);
  });
  await withShop({}, null, async s => {   // kapalı mağaza: kartlarda "closed" çipi tekrar etmez, band kapatılabilir
    const cat = await get(s, '/magaza/kategori/gunes-panelleri/');
    assert.doesNotMatch(cat.text, /vgm-chip--(?:ok|quote)">/); assert.match(cat.text, /data-vgm-banner-close/);
    const prod = await get(s, P1);
    assert.match(prod.text, /data-intent="haber">Siparişe açılınca haber verin<\/a>/);
  });
});

test('P1-15: fiyat sıralaması kartın sortTry anahtarını kullanır (yoksa listUsd)', async () => {
  const {dir, products} = pagedCatalog();
  const file = path.join(dir, 'liste', 'alt-a.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const c of list.items) {
    c.sortTry = Math.round((10000 - c.listUsd) * 100) / 100;   // ters sıra: sortTry listUsd'yi ezer
    c.listCheckedAt = '2026-01-01T00:00:00Z';                     // görünür (liste) fiyat yok: P1-08 7 gün sınırı dışında
  }
  fs.writeFileSync(file, JSON.stringify(list));
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    const asc = await get(s, '/magaza/kategori/alt-a/?sirala=fiyat-artan');
    assert.equal(asc.status, 200);
    const want = products.filter(p => p.category === 'alt-a').sort((a, b) => b.listUsd - a.listUsd || K.fold(a.name).localeCompare(K.fold(b.name)) || a.id.localeCompare(b.id));
    assert.deepEqual(cardIds(asc.text), want.slice(0, 48).map(p => p.id));
  });
});

test('P1-14: geçersiz UTF-8 arama metni boş gövde yerine 400 sayfası döner', async () => {
  await withShop({firma: path.join(fx, 'firma-tam.json')}, null, async s => {
    const r = await get(s, '/magaza/ara/?q=s%FDgorta');
    assert.equal(r.status, 400); assert.ok(r.text.length > 2000, 'tam sayfa');
    assert.match(r.text, /Arama metni okunamadı/); assert.match(r.text, /<meta name="robots" content="noindex, nofollow">/);
    const ok = await get(s, '/magaza/ara/?q=' + encodeURIComponent('sıgorta'));
    assert.equal(ok.status, 200);
  });
});

test('P1-07/12/13: mobil chrome, teklif/proforma akışı ve havale güveni (statik sayfalar, JS, CSS)', () => {
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const il = read('iletisim.html');
  assert.match(il, /<option value="magaza">Mağaza \/ Ürün Teklifi<\/option>/); assert.match(il, /<input type="hidden" id="magazaTalep" name="magazaTalep" value="">/);
  assert.match(il, /draft\.subject === 'magaza'/); assert.match(il, /params\.get\('konu'\) === 'magaza'/);
  assert.match(read('contact.php'), /'magaza' => 'Mağaza \/ Ürün Teklifi'/);
  const js = read('js/magaza.js');
  assert.match(js, /setItem\('vgContactDraft', JSON\.stringify\(\{ subject: 'magaza'/); assert.match(js, /\[data-vgm-cart-quote\]/);
  assert.match(js, /IntersectionObserver/); assert.match(js, /vg_magaza_band_kapali_v1/);
  const sepet = read('magaza/sepet.html');
  assert.match(sepet, /<ol class="vgm-progress"[^>]*><li aria-current="step">Sepet<\/li>/); assert.match(sepet, /Son ödeme: sipariş \+ 24 saat/);
  assert.match(sepet, /data-vgm-cart-quote>Sepeti teklife çevir \/ proforma iste<\/button>/);
  const od = read('magaza/odeme.html');
  assert.match(od, /Ödeme yapılmadan sipariş kesinleşmez/); assert.match(od, /<!--vgm:satici-->[\s\S]*class="vgm-seller"[\s\S]*<!--\/vgm:satici-->/);
  const css = read('css/magaza.css');
  for (const sel of ['.vgm-sticky {', '.vgm-progress {', '.vgm-payinfo {', '.vgm-seller {', '.vgm-card__code {', '.vgm-card__add {', '.vgm-stock {', '.vgm-banner__close {', '.vgm-bar__search {'])
    assert.ok(css.includes(sel), sel);
  assert.match(css, /body:has\(\.vgm--cart\) \.vg-footer__cta/); assert.match(css, /minmax\(10rem, 1fr\)/); assert.match(css, /-webkit-line-clamp: 3/);
});

/* ------------------------------------------------------------------------------------------------ inceleme düzeltmeleri */

const LEGAL = ['on-bilgilendirme-formu', 'mesafeli-satis-sozlesmesi', 'iade-ve-cayma', 'kvkk-aydinlatma', 'odeme-ve-teslimat'];

test('P1-01/02: hukuki sayfaların satıcı tablosu ve belge sürümü firma.json\'dan (sunucuda); statik yedek firma.json ile aynı sürümde', async () => {
  const firma = JSON.parse(fs.readFileSync(path.join(root, 'api/lib/magaza/firma.json'), 'utf8'));
  const tam = JSON.parse(fs.readFileSync(path.join(fx, 'firma-tam.json'), 'utf8'));
  const [y, m, d] = firma.belgeSurumu.split('-');
  for (const n of LEGAL) {   // statik yedek: işaretler var, sürüm satırı firma.json belgeSurumu ile aynı
    const html = fs.readFileSync(path.join(root, 'magaza', n + '.html'), 'utf8');
    assert.match(html, /<!--vgm:satici-dl--><dl>[\s\S]*?<\/dl><!--\/vgm:satici-dl-->/, n);
    assert.ok(html.includes(`<!--vgm:belge-meta-->Belge sürümü: ${firma.belgeSurumu} · Son güncelleme: ${d}.${m}.${y}<!--/vgm:belge-meta-->`), n + ': belge sürümü firma.json ile aynı');
    assert.doesNotMatch(html, /İletişim sayfası<\/a><\/dd>/, n);
  }
  for (const f of ['.htaccess', 'tools/preview.cjs', 'tools/preview-router.php', 'tools/tests/fixtures/magaza/pages/router.php'])
    for (const n of LEGAL) assert.ok(fs.readFileSync(path.join(root, f), 'utf8').includes(n), f + ': ' + n + ' magaza/index.php\'ye yönlenir');
  await withShop({firma: path.join(fx, 'firma-tam.json')}, null, async s => {
    for (const n of LEGAL) {
      const r = await get(s, '/magaza/' + n + '.html');
      assert.equal(r.status, 200, n); assert.match(r.type, /text\/html/); assert.match(r.cache, /no-cache/);
      const dl = r.text.split('<!--vgm:satici-dl-->')[1].split('<!--/vgm:satici-dl-->')[0];
      assert.match(dl, /<dt>Unvan<\/dt><dd>Sentetik Test Elektrik Ltd\. Şti\.<\/dd>/, n);
      assert.match(dl, /<dt>Adres<\/dt><dd>Test Mah\. Örnek Sok\. No:1 Bornova<\/dd>/, n);
      assert.match(dl, /<dt>MERSİS no<\/dt><dd>0000000000000001<\/dd>/, n);
      assert.match(dl, /<dt>Vergi dairesi \/ no<\/dt><dd>Test VD \/ 0000000001<\/dd>/, n);
      assert.match(dl, /<dt>Ticaret sicil no<\/dt><dd>000001<\/dd>/, n); assert.match(dl, /<dt>Şirket müdürü<\/dt><dd>Test Müdür<\/dd>/, n);
      assert.match(dl, /<dt>Sermaye<\/dt><dd>10\.000 TL \/ 10\.000 TL<\/dd>/, n); assert.doesNotMatch(dl, /KEP/, 'kep null: satır yok');
      assert.match(dl, /<a href="tel:\+905454346735">0545 434 67 35<\/a>/, n);
      assert.match(r.text, new RegExp('Belge sürümü: ' + tam.belgeSurumu), n);
    }
    const iade = await get(s, '/magaza/iade-ve-cayma.html');
    assert.match(iade.text, /Adres: <!--vgm:adres-->Test Mah\. Örnek Sok\. No:1 Bornova<!--\/vgm:adres-->/, 'örnek cayma formu tam adresi kullanır');
  });
  await withShop({}, null, async s => {   // gerçek firma.json: boş alanların satırı yok
    const r = await get(s, '/magaza/on-bilgilendirme-formu.html');
    const dl = r.text.split('<!--vgm:satici-dl-->')[1].split('<!--/vgm:satici-dl-->')[0];
    assert.match(dl, /<dt>Unvan<\/dt>/); assert.doesNotMatch(dl, /MERSİS|Vergi dairesi|null|\[/);
  });
});

test('kart/etiket yardımcıları: gün aralığı, tel: adresi, marka ilk sözcüğü kırpma', () => {
  const code = "define('VG_API', 1); require 'api/lib/bootstrap.php'; require 'api/lib/store.php'; require 'api/lib/security.php';"
    + " require 'api/lib/magaza.php'; require 'api/lib/magaza-render.php';"
    + " echo json_encode([array_map('vgmr_days_label', [1, 2, 3, 7]), array_map('vgmr_tel_href', ['0545 434 67 35', '+90 545 434 67 35', '545 434 67 35', '905454346735']),"
    + " vgmr_card_title('HES H07V-K (NYAF) 1x2,5 mm² Kablo', 'HES Kablo'), vgmr_card_title('Schneider A9F74116 iC60N', 'Schneider Electric'),"
    + " vgmr_card_title('Schneider Electric A9F74116', 'Schneider Electric'), vgmr_card_title('AB 123', 'AB Kablo'), vgmr_card_title('HESAP 1', 'HES Kablo')], JSON_UNESCAPED_UNICODE);";
  const r = spawnSync(php, ['-n', '-d', 'extension_dir=' + path.join(path.dirname(php), 'ext'), '-d', 'extension=mbstring', '-r', code], {cwd: root, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const [days, tels, ...titles] = JSON.parse(r.stdout);
  assert.deepEqual(days, ['1', '1–2', '1–3', '7'], '"1–1 gün" yazılmaz');
  assert.deepEqual(tels, Array(4).fill('tel:+905454346735'));
  assert.deepEqual(titles, ['H07V-K (NYAF) 1x2,5 mm² Kablo', 'A9F74116 iC60N', 'A9F74116', 'AB 123', 'HESAP 1'], 'kısa (<3) ilk sözcük ve sözcük ortası kırpılmaz');
});

test('P1-15: fiyat sıralaması kartta görünen KDV dahil TL ile (marj ve KDV %10/%20 karışık)', async () => {
  const products = [];
  for (let i = 0; i < 30; i++) products.push(gen.product(`vgm-${110000 + i}`, 'karisik', i, {listUsd: 100 + i, vat: i % 2 ? 10 : 20}));
  const dir = fs.mkdtempSync(path.join(scratch, 'tl-'));
  gen.write(dir, {categories: [gen.category('karisik', 'Karışık KDV', 10)], products});
  const ids = {};
  products.forEach((p, i) => { ids[p.id] = 100 + ((i * 7) % 30) * 1.05; });   // maliyet listUsd sırasından bağımsız
  const gross = p => ids[p.id] * 1.2 * 40 * (1 + p.vat / 100);
  await withShop({firma: path.join(fx, 'firma-tam.json'), seed: {ids}}, dir, async (s, data) => {
    const asc = await get(s, '/magaza/kategori/karisik/?sirala=fiyat-artan');
    assert.equal(asc.status, 200);
    assert.deepEqual(cardIds(asc.text), [...products].sort((a, b) => gross(a) - gross(b)).map(p => p.id));
    const desc = await get(s, '/magaza/kategori/karisik/?sirala=fiyat-azalan');
    assert.deepEqual(cardIds(desc.text), [...products].sort((a, b) => gross(b) - gross(a)).map(p => p.id));
    // TL haritası kategori başına tek dosyada önbelleklenir (her istek tüm fiyat parçalarını okumaz); fiyat parçası
    // değişince geçersizleşir, bozuk önbellek yok sayılır
    const cache = path.join(data, 'magaza/onbellek/sirala/karisik.json');
    assert.ok(fs.existsSync(cache), 'sıralama önbelleği yazıldı');
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(cache, 'utf8')).tl).sort(), products.map(p => p.id).sort());
    const cheapest = cardIds(asc.text)[0], shard = path.join(data, 'magaza/fiyat', String(Math.floor(Number(cheapest.slice(4)) / 100)).padStart(4, '0') + '.json');
    const map = JSON.parse(fs.readFileSync(shard, 'utf8')); map[cheapest].costUsd = 9999; fs.writeFileSync(shard, JSON.stringify(map));
    ids[cheapest] = 9999;
    const after = await get(s, '/magaza/kategori/karisik/?sirala=fiyat-artan');
    assert.deepEqual(cardIds(after.text), [...products].sort((a, b) => gross(a) - gross(b)).map(p => p.id), 'fiyat değişince sıra güncellenir');
    assert.equal(cardIds(after.text).at(-1), cheapest);
    fs.writeFileSync(cache, '{bozuk');
    assert.deepEqual(cardIds((await get(s, '/magaza/kategori/karisik/?sirala=fiyat-artan')).text), cardIds(after.text), 'bozuk önbellek yok sayılır');
    // erişilebilir ad: her kartın "Sepete ekle" düğmesi ve adet etiketi ürünü adlandırır
    const card = asc.text.split('data-id="vgm-110003"')[1].split('</li>')[0];
    assert.match(card, /<label class="vgm-sr" for="vgm-cq-vgm-110003">Adet – SN-000003<\/label>/);
    assert.match(card, /\+ Sepete ekle<span class="vgm-sr"> – SN-000003<\/span><\/button>/);
  });
});

test('inceleme: teklif bağlantısı JS\'siz konu/ürün seçer; form sıfırlanınca mağaza talebi temizlenir; mobil şerit/özet/band', async () => {
  await withShop({}, null, async s => {
    const prod = await get(s, P1);
    assert.match(prod.text, /href="\/iletisim\.html\?konu=magaza&amp;urun=vgm-9001&amp;niyet=haber#iletisim" data-vgm-quote/);
  });
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const il = read('iletisim.html');
  assert.match(il, /params\.get\('urun'\)/); assert.match(il, /form\.addEventListener\('reset', function \(\) \{ payload\.value = ''; \}\)/);
  assert.match(read('js/main.js'), /var magazaTalep = qs\('#magazaTalep', contactForm\);\s+if \(magazaTalep\) magazaTalep\.value = '';/);
  assert.match(read('js/magaza.js'), /var row = \$\('\.vgm-buy__row', buy\) \|\| buy[\s\S]*?io\.observe\(row\)/);
  const css = read('css/magaza.css');
  assert.match(css, /@media \(max-width: 61\.99rem\) \{\s+\.vgm-checkout \.vgm-summary-box \{ order: -1; \}/);
  assert.match(css, /\.vgm-banner:not\(\.vgm-banner--full\) \.vgm-banner__in > p \{ display: flex;[^}]*white-space: nowrap; \}/);
});

/* ------------------------------------------------------------------------------------- arama puanı ve teknik süzgeçler */

/** Koruma cihazları (teknik süzgeçli) + pano (süzgeçsiz) sentetik kataloğu; attr ve arama tokenleri yazıcıdan. */
function techCatalog() {
  const spec = (poles, amps, curve, ka) => [['Kutup sayısı', poles], ['Anma akımı', amps + ' A'], ...(curve ? [['Açma eğrisi', curve]] : []), ...(ka ? [['Kesme kapasitesi', ka + ' kA']] : [])];
  const P = (id, n, name, brand, mpn, specs, cat = 'koruma-cihazlari') => gen.product(id, cat, n, {name, brand, mpn, specs});
  const products = [
    P('vgm-100001', 1, 'Siemens 5SV5344-6 Kaçak Akım Rölesi 4P 40A 30mA', 'Siemens', '5SV5344-6', spec('4P', 40)),
    P('vgm-100002', 2, 'Schneider iC60N 1P C16 6kA Otomatik Sigorta', 'Schneider', 'A9F74116', spec('1P', 16, 'C', 6)),
    P('vgm-100003', 3, 'Schneider iC60N 3P C16 6kA Otomatik Sigorta', 'Schneider', 'A9F74316', spec('3P', 16, 'C', 6)),
    P('vgm-100004', 4, 'Legrand DX3 1P C32 Otomatik Sigorta', 'Legrand', 'LG-407732', spec('1P', 32, 'C', 6)),
    P('vgm-100005', 5, 'Siemens 5SV5344-6X Kaçak Akım Rölesi Özel Seri 4P 40A', 'Siemens', '5SV5344-6X', spec('4P', 40)),
    P('vgm-100006', 6, 'Hisar Sigorta Kutusu 12 Modül Sıva Üstü', 'Hisar Pano', 'HP-12', [['Model', 'HP-12']], 'pano-malzemeleri'),
  ];
  const koruma = {...gen.category('koruma-cihazlari', 'Koruma Cihazları', 10), filters: [{key: 'poles', label: 'Kutup', type: 'enum'},
    {key: 'amps', label: 'Anma akımı', type: 'number', unit: 'A'}, {key: 'curve', label: 'Açma eğrisi', type: 'enum'}, {key: 'ka', label: 'Kesme kapasitesi', type: 'number', unit: 'kA'}]};
  const dir = fs.mkdtempSync(path.join(scratch, 'teknik-'));
  gen.write(dir, {categories: [koruma, gen.category('pano-malzemeleri', 'Pano Malzemeleri', 20)], products});
  return {dir, products};
}

test('P1-04/05: arama puanı (tam model > model öneki), terim normalizasyonu, AND -> OR "Benzer sonuçlar", kategori/marka daraltma, boş durum', async () => {
  const {dir} = techCatalog();
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    const exact = await get(s, '/magaza/ara/?q=5SV53446');
    assert.deepEqual(cardIds(exact.text), ['vgm-100001', 'vgm-100005'], 'tire/nokta soyulmuş model yazımı; tam model önce, önek sonra');
    assert.deepEqual(cardIds((await get(s, '/magaza/ara/?q=' + encodeURIComponent('5sv5344-6x'))).text)[0], 'vgm-100005');
    const p16 = await get(s, '/magaza/ara/?q=' + encodeURIComponent('1P 16A'));
    assert.deepEqual(cardIds(p16.text), ['vgm-100002'], 'sentetik attr tokenleri, tüm terimler (AND)');
    assert.doesNotMatch(p16.text, /Benzer sonuçlar/);
    assert.deepEqual(cardIds((await get(s, '/magaza/ara/?q=' + encodeURIComponent('ic60n c16'))).text), ['vgm-100002', 'vgm-100003']);
    // "otomat": adında geçen sigortalar önce; yalnızca eş anlamlıyla eşleşen "Sigorta Kutusu" (dizin: sigorta -> otomat) sonda
    const otomat = cardIds((await get(s, '/magaza/ara/?q=otomat')).text);
    assert.deepEqual(otomat.slice(0, 3).sort(), ['vgm-100002', 'vgm-100003', 'vgm-100004']); assert.deepEqual(otomat.slice(3), ['vgm-100006']);
    // OR'a düşme: tüm terimleri içeren ürün yok -> en yakın eşleşmeler
    const or = await get(s, '/magaza/ara/?q=' + encodeURIComponent('ic60n yokboyleterim'));
    assert.equal(or.status, 200); assert.match(or.text, /<h2 class="vgm-search__mode">Benzer sonuçlar<\/h2>/);
    assert.match(or.text, /Aradığınız terimlerin tümünü içeren ürün bulunamadı; en yakın eşleşmeler:/);
    assert.deepEqual(cardIds(or.text), ['vgm-100002', 'vgm-100003']); assert.equal(robots(or.text), 'noindex, follow');
    // kategori çipleri (sayılı) ve daraltma; marka seçimi (az kategoride)
    const sig = await get(s, '/magaza/ara/?q=sigorta');
    assert.match(sig.text, /<nav class="vgm-subcats" aria-label="Kategoriye göre daralt" data-vgm-scroller>/);
    assert.match(sig.text, /href="\/magaza\/ara\/\?q=sigorta&amp;kategori=pano-malzemeleri">Pano Malzemeleri <span class="vgm-count">\(1\)<\/span>/);
    assert.match(sig.text, /href="\/magaza\/ara\/\?q=sigorta&amp;kategori=koruma-cihazlari">Koruma Cihazları <span class="vgm-count">\(3\)<\/span>/);
    assert.deepEqual(cardIds((await get(s, '/magaza/ara/?q=sigorta&kategori=pano-malzemeleri')).text), ['vgm-100006']);
    assert.match(sig.text, /<form class="vgm-filter" action="\/magaza\/ara\/" method="get" data-vgm-filter data-vgm-params="q,kategori,marka"><input type="hidden" name="q" value="sigorta">/);
    assert.match(sig.text, /<option value="schneider">Schneider \(2\)<\/option>/); assert.match(sig.text, /<option value="legrand">Legrand \(1\)<\/option>/);
    const leg = await get(s, '/magaza/ara/?q=sigorta&kategori=koruma-cihazlari&marka=legrand');
    assert.deepEqual(cardIds(leg.text), ['vgm-100004']); assert.match(leg.text, /<option value="legrand" selected>/);
    assert.match(leg.text, /<input type="hidden" name="kategori" value="koruma-cihazlari">/);
    // bilinmeyen kategori/marka yok sayılır (noindex arama), aralık dışı sayfa 404
    assert.equal(cardIds((await get(s, '/magaza/ara/?q=sigorta&kategori=olmayan&marka=yok')).text).length, 4);
    assert.equal((await get(s, '/magaza/ara/?q=sigorta&sayfa=2')).status, 404);
    // boş durum: tedarik bağlantısı (P1-12) ve kategoriler
    const none = await get(s, '/magaza/ara/?q=' + encodeURIComponent('tamamen yok'));
    assert.match(none.text, /eşleşen ürün bulunamadı/);
    assert.match(none.text, /href="\/iletisim\.html\?konu=magaza&amp;q=tamamen%20yok#iletisim">Bu modeli bulamadık, tedarik edelim<\/a>/);
    assert.match(none.text, /<a class="vgm-subcat" href="\/magaza\/kategori\/koruma-cihazlari\/">Koruma Cihazları<\/a>/);
  });
});

test('P1-05: arama sayfalaması (48), sayfa bağlantıları sorguyu korur', async () => {
  const {dir} = pagedCatalog();
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    const p1 = await get(s, '/magaza/ara/?q=sentetik'), p3 = await get(s, '/magaza/ara/?q=sentetik&sayfa=3');
    assert.equal(cardIds(p3.text).length, 117 - 96); assert.match(p3.text, /117 ürün bulundu · 97–117 gösteriliyor/);
    assert.equal(new Set([...cardIds(p1.text), ...cardIds((await get(s, '/magaza/ara/?q=sentetik&sayfa=2')).text), ...cardIds(p3.text)]).size, 117);
    assert.match(p1.text, /<a class="vgm-pager__step" rel="next" href="\/magaza\/ara\/\?q=sentetik&amp;sayfa=2">/);
    assert.match(p3.text, /<title>sentetik – Arama – Sayfa 3 \| VoltGuard Mağaza<\/title>/);
    assert.doesNotMatch(p1.text, /data-vgm-params="q,kategori,marka"/, '3 yaprak kategoride marka sayımı yapılmaz (liste dosyası okunmaz; önce kategori çipi)');
    assert.equal((await get(s, '/magaza/ara/?q=sentetik&sayfa=4')).status, 404);
    // tek kategori seçilince marka daraltması açılır
    const alt = await get(s, '/magaza/ara/?q=sentetik&kategori=alt-a');
    assert.match(alt.text, /110 ürün bulundu/); assert.match(alt.text, /<option value="guney-salt">Güney Şalt \(37\)<\/option>/);
    const ust = await get(s, '/magaza/ara/?q=sentetik&kategori=ust');
    assert.match(ust.text, /115 ürün bulundu/, 'üst kategori alt kategorilerini kapsar');
    // seçili üst kategori çip satırında adlandırılır (aria-current; sayı = alt kategorilerin toplamı); "Tümü" etkin değil
    const chips = ust.text.split('aria-label="Kategoriye göre daralt"')[1].split('</nav>')[0];
    assert.match(chips, /<a class="vgm-subcat" aria-current="page" href="\/magaza\/ara\/\?q=sentetik&amp;kategori=ust">Üst Grup <span class="vgm-count">\(115\)<\/span><\/a>/);
    assert.equal((chips.match(/aria-current="page"/g) || []).length, 1, 'yalnızca üst kategori çipi etkin');
    assert.match(chips, /href="\/magaza\/ara\/\?q=sentetik">Tümü/); assert.match(chips, /kategori=alt-a">Alt Grup A/);
    assert.doesNotMatch(alt.text, /kategori=ust">Üst Grup/, 'yaprak seçiliyken üst kategori çipi eklenmez');
  });
});

test('P1-06: kategori teknik süzgeçleri (sayılar, kanonik sıra, çoklu değer, noindex/kanonik, kaldırılabilir çipler, 404)', async () => {
  const {dir} = techCatalog();
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    const base = 'https://voltguard.com.tr/magaza/kategori/koruma-cihazlari/';
    const plain = await get(s, '/magaza/kategori/koruma-cihazlari/');
    assert.equal(plain.status, 200); assert.match(robots(plain.text), /^index/);
    assert.match(plain.text, /<details class="vgm-facets" data-vgm-facets open><summary>Teknik özellikler<\/summary>/);
    const facet = (html, param, value) => new RegExp(`<input type="checkbox" name="${param}\\[\\]" value="${value.replace(/[+.]/g, '\\$&')}"([^>]*)> <span>([^<]+)</span> <span class="vgm-count">\\((\\d+)\\)</span>`).exec(html);
    assert.deepEqual(['1P', '3P', '4P'].map(v => facet(plain.text, 'kutup', v)[3]), ['2', '1', '2']);
    assert.deepEqual(['16', '32', '40'].map(v => facet(plain.text, 'akim', v).slice(2)), [['16 A', '2'], ['32 A', '1'], ['40 A', '2']]);
    assert.equal(facet(plain.text, 'ka', '6')[2], '6 kA');
    assert.ok(plain.text.indexOf('name="kutup[]"') < plain.text.indexOf('name="akim[]"') && plain.text.indexOf('name="akim[]"') < plain.text.indexOf('name="egri[]"'));
    assert.doesNotMatch(plain.text, /class="vgm-active-filters"/);
    // tek değer: yalnızca attr.poles = 1P kartlar; noindex, kategoriye kanonik
    const p1 = await get(s, '/magaza/kategori/koruma-cihazlari/?kutup=1P');
    assert.deepEqual(cardIds(p1.text).sort(), ['vgm-100002', 'vgm-100004']);
    assert.equal(robots(p1.text), 'noindex, follow'); assert.equal(canonical(p1.text), base);
    assert.match(facet(p1.text, 'kutup', '1P')[1], / checked/);
    assert.equal(facet(p1.text, 'kutup', '3P')[3], '1', 'kendi grubunun sayısı diğer seçimlerle hesaplanır');
    assert.equal(facet(p1.text, 'akim', '40')[3], '0'); assert.match(facet(p1.text, 'akim', '40')[1], / disabled/);
    assert.match(p1.text, /<a class="vgm-chip vgm-chip--active" href="\/magaza\/kategori\/koruma-cihazlari\/" aria-label="Süzgeci kaldır: Kutup: 1P">Kutup: 1P/);
    // iki süzgeç + marka: kanonik parametre sırası (marka, kutup, akim) çip adreslerinde; ters sıradaki istek de geçerli
    const both = await get(s, '/magaza/kategori/koruma-cihazlari/?akim=16&kutup=1P&marka=schneider');
    assert.equal(both.status, 200); assert.deepEqual(cardIds(both.text), ['vgm-100002']);
    assert.match(both.text, /href="\/magaza\/kategori\/koruma-cihazlari\/\?kutup=1P&amp;akim=16" aria-label="Süzgeci kaldır: Marka: Schneider"/);
    assert.match(both.text, /href="\/magaza\/kategori\/koruma-cihazlari\/\?marka=schneider&amp;akim=16" aria-label="Süzgeci kaldır: Kutup: 1P"/);
    assert.match(both.text, /href="\/magaza\/kategori\/koruma-cihazlari\/\?marka=schneider&amp;kutup=1P" aria-label="Süzgeci kaldır: Anma akımı: 16 A"/);
    assert.match(both.text, /<a class="vgm-link" href="\/magaza\/kategori\/koruma-cihazlari\/">Tümünü temizle<\/a>/);
    // çoklu değer: virgüllü adres ve form dizisi aynı sonucu verir; değerler kanonik sırada
    const multi = await get(s, '/magaza/kategori/koruma-cihazlari/?kutup=4P,1P');
    const arr = await get(s, '/magaza/kategori/koruma-cihazlari/?kutup%5B%5D=1P&kutup%5B%5D=4P&sirala=ad');
    assert.deepEqual(cardIds(multi.text).sort(), ['vgm-100001', 'vgm-100002', 'vgm-100004', 'vgm-100005']);
    assert.deepEqual(cardIds(arr.text).sort(), cardIds(multi.text).sort());
    assert.match(multi.text, /href="\/magaza\/kategori\/koruma-cihazlari\/\?kutup=4P" aria-label="Süzgeci kaldır: Kutup: 1P"/);
    assert.match(arr.text, /href="\/magaza\/kategori\/koruma-cihazlari\/\?kutup=1P&amp;sirala=ad" aria-label="Süzgeci kaldır: Kutup: 4P"/);
    // eşleşme yok: boş durum + temizle bağlantısı (sayfa 200)
    const empty = await get(s, '/magaza/kategori/koruma-cihazlari/?kutup=3P&akim=32');
    assert.equal(empty.status, 200); assert.deepEqual(cardIds(empty.text), []); assert.match(empty.text, /Seçtiğiniz süzgeçlerle eşleşen ürün yok/);
    // geçersiz/bilinmeyen değer ya da kategoride tanımsız süzgeç: 404 (sonsuz adres alanı yok)
    for (const bad of ['?kutup=9P', '?kutup=1P%20N', '?kesit=3x2.5', '?faz=3', '?akim=16.5', '?kutup=%3Cx%3E']) assert.equal((await get(s, '/magaza/kategori/koruma-cihazlari/' + bad)).status, 404, bad);
    // filters tanımı olmayan kategoride süzgeç bloğu yok ve teknik parametre 404
    const pano = await get(s, '/magaza/kategori/pano-malzemeleri/');
    assert.doesNotMatch(pano.text, /vgm-facets/); assert.equal((await get(s, '/magaza/kategori/pano-malzemeleri/?kutup=1P')).status, 404);
  });
});

test('P1-10: deliveryDays ürün kaydından, yoksa kategori varsayılanından (sayfa)', async () => {
  const dir = catalogCopy(() => {});
  const shard = path.join(dir, 'urun', K.shardOf('vgm-9001') + '.json');
  const urun = JSON.parse(fs.readFileSync(shard, 'utf8')); urun.products['vgm-9001'].deliveryDays = 3; urun.products['vgm-9002'].deliveryDays = 99; fs.writeFileSync(shard, JSON.stringify(urun));
  const katFile = path.join(dir, 'kategoriler.json');
  const kat = JSON.parse(fs.readFileSync(katFile, 'utf8')); kat.categories.find(c => c.id === 'inverterler').deliveryDays = 7; fs.writeFileSync(katFile, JSON.stringify(kat));
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    assert.match((await get(s, P1)).text, /Tahmini kargoya veriliş: 1–3 gün \(ödeme sonrası\)/);
    const slugs = Object.assign({}, ...fs.readdirSync(path.join(dir, 'slug')).map(f => JSON.parse(fs.readFileSync(path.join(dir, 'slug', f), 'utf8'))));
    const inv = await get(s, '/magaza/urun/' + Object.keys(slugs).find(k => slugs[k] === 'vgm-9002') + '/');
    assert.equal(inv.status, 200);
    assert.match(inv.text, /Tahmini kargoya veriliş: 7 gün \(ödeme sonrası\)/, 'geçersiz ürün değeri (99) kategori varsayılanına düşer');
  });
});

/* ------------------------------------------------------------------------------------------------ ölçekte fiyat gösterimi ve mobil */

const phpEval = code => {
  const r = spawnSync(php, ['-n', '-d', 'extension_dir=' + path.join(path.dirname(php), 'ext'), '-d', 'extension=mbstring', '-r',
    "define('VG_API', 1); require 'api/lib/bootstrap.php'; require 'api/lib/store.php'; require 'api/lib/security.php'; require 'api/lib/magaza.php'; require 'api/lib/magaza-render.php'; " + code],
  {cwd: root, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(r.stdout);
};

test('P1-08: fiyat gösterimi siparişten ayrı (verified | list ≤ 7 gün | last ≤ 30 gün; held/error/kursuz gösterilmez)', () => {
  const now = 1793500000;
  const out = phpEval(`$now = ${now}; $b = ['usdNet' => 10.0, 'tryNet' => 400.0, 'tryGross' => 480.0, 'vat' => 20, 'rateDate' => '2026-10-31', 'orderable' => false];
    $c = function (array $x) use ($b) { return $x + $b; };
    echo json_encode([
      vgmr_price_display($c(['reason' => 'ok', 'basis' => 'live', 'checkedAt' => $now - 3600, 'orderable' => true]), $now),
      vgmr_price_display($c(['reason' => 'closed', 'basis' => 'live', 'checkedAt' => $now - 3600]), $now),
      vgmr_price_display($c(['reason' => 'no_source', 'basis' => 'list', 'checkedAt' => $now - 86400]), $now),
      vgmr_price_display($c(['reason' => 'stale', 'basis' => 'list', 'checkedAt' => $now - 6 * 86400]), $now),
      vgmr_price_display($c(['reason' => 'stale', 'basis' => 'list', 'checkedAt' => $now - 8 * 86400]), $now),
      vgmr_price_display($c(['reason' => 'stale', 'basis' => 'live', 'checkedAt' => $now - 3 * 86400]), $now),
      vgmr_price_display($c(['reason' => 'stale', 'basis' => 'live', 'checkedAt' => $now - 31 * 86400]), $now),
      vgmr_price_display($c(['reason' => 'held', 'basis' => 'live', 'checkedAt' => $now - 3600]), $now),
      vgmr_price_display($c(['reason' => 'error', 'basis' => 'live', 'checkedAt' => $now - 3600]), $now),
      vgmr_price_display($c(['reason' => 'no_source', 'basis' => 'live', 'checkedAt' => $now - 3600]), $now),
      vgmr_price_display($c(['reason' => 'stale', 'basis' => 'list', 'checkedAt' => null]), $now),
      vgmr_price_display($c(['reason' => 'stale', 'basis' => 'list', 'checkedAt' => $now + 86400]), $now),
      vgmr_price_display(['tryGross' => null, 'reason' => 'no_rate', 'basis' => 'list', 'checkedAt' => $now - 60] + $b, $now),
      [vgmr_ago($now - 60, $now), vgmr_ago($now - 86400, $now), vgmr_ago($now - 5 * 86400, $now)],
      vgmr_chip($c(['reason' => 'stale', 'basis' => 'list', 'checkedAt' => $now - 86400, 'display' => 'list'])),
      vgmr_chip($c(['reason' => 'stale', 'basis' => 'live', 'checkedAt' => $now - 31 * 86400, 'display' => null])),
    ], JSON_UNESCAPED_UNICODE);`);
  assert.deepEqual(out.slice(0, 13), ['verified', 'verified', 'list', 'list', null, 'last', null, null, null, null, null, null, null]);
  assert.deepEqual(out[13], ['bugün', 'dün', '5 gün önce']);
  assert.equal(out[14], null, 'liste fiyatında "Fiyat teyidi bekleniyor" rozeti yerine gri etiket');
  assert.deepEqual(out[15], ['wait', 'Fiyat teyidi bekleniyor']);
});

test('P1-08: liste fiyatı kartta ve ürün sayfasında gri etiketle; sepete ekleme, Offer ve product:price yok; eski liste fiyatı gizli', async () => {
  const iso = s => new Date(Date.now() - s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const dir = catalogCopy(model => {
    model.products.push(gen.product('vgm-9006', 'koruma-cihazlari', 6, {name: 'Liste Marka LM-10 C10 Otomatik Sigorta', brand: 'Liste Marka', mpn: 'LM-10', listUsd: 10, listCheckedAt: iso(86400 + 600), slug: 'liste-marka-lm-10-c10-otomatik-sigorta'}));
    model.products.push(gen.product('vgm-9007', 'koruma-cihazlari', 7, {name: 'Liste Marka LM-20 C20 Otomatik Sigorta', brand: 'Liste Marka', mpn: 'LM-20', listUsd: 20, listCheckedAt: iso(8 * 86400), slug: 'liste-marka-lm-20-c20-otomatik-sigorta'}));
  });
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    const cat = await get(s, '/magaza/kategori/koruma-cihazlari/');
    const card = id => cat.text.split(`data-id="${id}"`)[1].split('</li>')[0];
    assert.match(card('vgm-9006'), /<p class="vgm-price vgm-price--soft"><span class="vgm-price__amount">480,00 ₺<\/span><\/p><p class="vgm-price__basis" data-vgm-basis="list">Liste fiyatı – siparişte teyit edilir · <time datetime="[^"]+">dün güncellendi<\/time><\/p>/);
    assert.doesNotMatch(card('vgm-9006'), /Fiyat teyidi bekleniyor|data-vgm-add/);
    assert.match(card('vgm-9007'), /Güncel fiyat için teklif isteyin/, '7 günden eski liste fiyatı gösterilmez');
    assert.match(card('vgm-9003'), /data-vgm-basis="last">Son doğrulanan tedarik fiyatı \(bugünkü kurla\)/);
    const prod = await get(s, '/magaza/urun/liste-marka-lm-10-c10-otomatik-sigorta/');
    assert.equal(prod.status, 200); assert.ok(prod.text.includes('480,00 ₺'));
    assert.match(prod.text, /data-vgm-basis="list">Liste fiyatı – siparişte teyit edilir/);
    assert.match(prod.text, /Bu fiyat bilgi amaçlıdır; sipariş, tedarik fiyatı son 48 saat içinde doğrulandığında açılır\./);
    assert.match(prod.text, /<small class="vgm-sticky__vat">KDV dahil · liste fiyatı<\/small>/);
    assert.match(prod.text, /Şu anda çevrim içi sipariş verilemiyor/); assert.doesNotMatch(prod.text, /data-vgm-add/);
    const product = ldBlocks(prod.text).find(b => b['@type'] === 'Product');
    assert.equal(product.offers, undefined, 'yapılandırılmış veride yalnızca doğrulanmış fiyat'); assert.doesNotMatch(prod.text, /product:price/);
    // doğrulanmış fiyat aynı kalır: etiket yok, Offer var
    const p1 = await get(s, P1);
    assert.doesNotMatch(p1.text, /vgm-price__basis/); assert.equal(ldBlocks(p1.text).find(b => b['@type'] === 'Product').offers.price, '5760.00');
    // fiyat sıralaması gösterilen TL ile (son doğrulanan 144 TL < liste 480 TL); fiyatı gösterilmeyen en sonda
    assert.deepEqual(cardIds((await get(s, '/magaza/kategori/koruma-cihazlari/?sirala=fiyat-artan')).text), ['vgm-9003', 'vgm-9006', 'vgm-9007']);
    assert.doesNotMatch((await get(s, '/magaza/ara/?q=LM-10')).text, /data-vgm-add/);
  });
});

test('P1-11: kart başlığı marka ve tam model kodunu tekrarlamaz (ürün H1 tam ad)', async () => {
  const titles = phpEval(`echo json_encode([vgmr_card_title('ABB 2CCG001232R0001 S803P-C80 3 Kutuplu 80 A', 'ABB', '2CCG001232R0001'),
    vgmr_card_title('2CCG001232R0001 S803P-C80', 'ABB', '2CCG001232R0001'), vgmr_card_title('ABB 2ccg001232r0001 - S803P', 'ABB', '2CCG001232R0001'),
    vgmr_card_title('ABB 2CCG001232R0001', 'ABB', '2CCG001232R0001'), vgmr_card_title('ABB 2CCG001232R00012 S803P', 'ABB', '2CCG001232R0001'),
    vgmr_card_title('Schneider iC60N A9F74116', 'Schneider', 'A9F74116'), vgmr_card_title('HES H07V-K 1x4 Kablo', 'HES Kablo', 'H07V-K')], JSON_UNESCAPED_UNICODE);`);
  assert.deepEqual(titles, ['S803P-C80 3 Kutuplu 80 A', 'S803P-C80', 'S803P', '2CCG001232R0001', '2CCG001232R00012 S803P', 'iC60N A9F74116', '1x4 Kablo']);
  await withShop({firma: path.join(fx, 'firma-tam.json')}, null, async s => {
    const cat = await get(s, '/magaza/kategori/gunes-panelleri/');
    assert.match(cat.text, /<p class="vgm-card__code"><span class="vgm-card__brand">Deneme Marka<\/span><span class="vgm-card__sep" aria-hidden="true"> · <\/span><span class="vgm-card__mpn">DM-450<\/span><\/p><h3 class="vgm-card__title"><a href="[^"]+" aria-label="Deneme Marka DM-450 450 W Güneş Paneli">450 W Güneş Paneli<\/a><\/h3>/);
    assert.match((await get(s, P1)).text, /<h1>Deneme Marka DM-450 450 W Güneş Paneli<\/h1>/);
  });
});

test('mobil: alt kategori çipleri tek satır yatay kayar (solma kenarları, klavye); ürün sayfasında alt bilgi çevresinde yer tutucu boşluk yok', async () => {
  await withShop({firma: path.join(fx, 'firma-tam.json')}, null, async s => {
    const sub = await get(s, '/magaza/kategori/monokristal-paneller/');
    assert.match(sub.text, /<nav class="vgm-subcats" aria-label="Alt kategoriler" data-vgm-scroller><ul><li><a class="vgm-subcat" href="\/magaza\/kategori\/gunes-panelleri\/">/);
  });
  const css = fs.readFileSync(path.join(root, 'css/magaza.css'), 'utf8'), js = fs.readFileSync(path.join(root, 'js/magaza.js'), 'utf8');
  const narrow = css.split('@media (max-width: 47.99rem) {\n  .vgm-subcats {')[1] || '';
  assert.match(narrow, /flex-wrap: nowrap; overflow-x: auto;/); assert.match(narrow, /mask-image: linear-gradient\(to right, transparent 0, #000 var\(--vgm-fade-s\)/);
  assert.match(narrow, /\.vgm-subcats\[data-fade~="end"\] \{ --vgm-fade-e: 2\.25rem; \}/); assert.match(narrow, /\.vgm-subcats li \{ flex: none;/);
  assert.match(js, /function initScrollers\(\)/); assert.match(js, /nav\.setAttribute\('data-fade', f\.join\(' '\)\)/); assert.match(js, /initScrollers\(\);/);
  // yapışkan şerit: alt bilgi/yardım kutusu görününce gizlenir; ürün sayfası alt boşluğu yer tutucu değildir
  assert.match(js, /var ends = \[\$\('\.vgm-help'\), \$\('footer'\)\]\.filter\(Boolean\);/); assert.match(js, /sticky\.hidden = rowSeen \|\| endSeen \|\| window\.innerWidth >= 992;/);
  assert.match(css, /\.vgm--product \{ padding-bottom: 3rem; \}/); assert.doesNotMatch(css, /padding-bottom: 5\.5rem/);
  assert.match(css, /\.vgm-price__basis \{/);
});

/* Gerçek tarayıcı (Playwright + Chrome/Edge; tools/tests/*-browser.cjs ile aynı arama). Yoksa tarayıcı testi atlanır. */
function browserDeps() {
  const pkg = [() => require.resolve('playwright'), ...[process.env.VG_NODE_MODULES, process.env.VOLTGUARD_NODE_MODULES,
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean)
    .map(d => () => { if (!fs.existsSync(path.join(d, 'playwright'))) throw Error(); return path.join(d, 'playwright'); })]
    .reduce((found, f) => found || (() => { try { return f(); } catch { return null; } })(), null);
  const chrome = [process.env.VOLTGUARD_CHROME, process.env.VG_CHROME,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(f => fs.existsSync(f));
  return pkg && chrome ? {pkg, chrome} : null;
}
const browser = browserDeps();

test("mobil (tarayıcı): teknik özellik paneli 390 px'te seçili süzgeç yokken ilk boyamadan kapalı, süzgeçle ve genişte açık", {skip: browser ? false : 'Playwright/Chrome yok'}, async () => {
  const {dir} = techCatalog();
  await withShop({firma: path.join(fx, 'firma-tam.json')}, dir, async s => {
    const b = await require(browser.pkg).chromium.launch({executablePath: browser.chrome, headless: true, args: ['--disable-extensions']});
    try {
      const state = page => page.evaluate(() => {
        const d = document.querySelector('[data-vgm-facets]'), g = document.querySelector('[data-vgm-grid]');
        return {open: d.open, gridTop: Math.round(g.getBoundingClientRect().top + scrollY)};
      });
      const ctx = await b.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
      const page = await ctx.newPage();
      // defer'li magaza.js hiç yüklenmese de (yavaş bağlantı) panel kapalı gelir: kapatma satır içi betikte, ilk boyamadan önce
      await page.route('**/js/magaza.js*', r => r.abort());
      await page.goto(s.base + '/magaza/kategori/koruma-cihazlari/', {waitUntil: 'load'});
      const closed = await state(page);
      assert.equal(closed.open, false, '390 px, süzgeç yok: panel kapalı');
      const openTop = await page.evaluate(() => { const d = document.querySelector('[data-vgm-facets]'); d.open = true; const t = document.querySelector('[data-vgm-grid]').getBoundingClientRect().top + scrollY; d.open = false; return Math.round(t); });
      assert.ok(closed.gridTop < openTop - 150, `kapalı panelde ürünler yukarıda (${closed.gridTop} < ${openTop})`);
      assert.ok(closed.gridTop < 900, `ürünler ilk ekrana yakın başlar (${closed.gridTop})`);
      await page.unroute('**/js/magaza.js*');
      // seçili süzgeç varken panel açık kalır (seçimler görünür)
      await page.goto(s.base + '/magaza/kategori/koruma-cihazlari/?kutup=1P', {waitUntil: 'load'});
      assert.equal((await state(page)).open, true, '390 px, ?kutup=1P: panel açık');
      // ekran genişleyince (döndürme/pencere) magaza.js paneli yeniden açar
      await page.goto(s.base + '/magaza/kategori/koruma-cihazlari/', {waitUntil: 'load'});
      assert.equal((await state(page)).open, false);
      await page.setViewportSize({width: 1280, height: 900});
      await page.waitForFunction(() => document.querySelector('[data-vgm-facets]').open);
      await ctx.close();
      // geniş ekranda baştan açık
      const wide = await b.newContext({viewport: {width: 1280, height: 900}});
      const wp = await wide.newPage();
      await wp.goto(s.base + '/magaza/kategori/koruma-cihazlari/', {waitUntil: 'load'});
      assert.equal((await state(wp)).open, true, '1280 px: panel açık');
      await wide.close();
    } finally { await b.close(); }
  });
});
