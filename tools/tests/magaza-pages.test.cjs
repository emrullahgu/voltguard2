'use strict';
// Mağaza sayfaları gerçek PHP sunucusunda: vitrin, kategori, ürün, sitemap, 404, TL fiyat, kapalı mağaza, kaçış, sızıntı denetimi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn, spawnSync} = require('node:child_process');
const {seed} = require('./fixtures/magaza/pages/seed.cjs');
const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || 'C:/Users/emrul/OneDrive/Masaüstü/voltguardcomtr/.qa/php/runtime/php.exe';
const fx = path.join(root, 'tools/tests/fixtures/magaza');
const router = path.join(fx, 'pages/router.php');
const P1 = '/magaza/urun/deneme-marka-dm-450-450w-gunes-paneli/';
const FREIGHT = '/magaza/urun/deneme-marka-dm-bat-10-10kwh-lityum-aku/';

async function server(env) {
  const l = net.createServer(); await new Promise(r => l.listen(0, '127.0.0.1', r));
  const port = l.address().port; await new Promise(r => l.close(r));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(php, ['-n', '-S', `127.0.0.1:${port}`, '-t', root, router], {env: {...process.env, ...env}, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true});
  const logs = []; child.stderr.on('data', c => logs.push(String(c)));
  for (let i = 0; i < 100; i++) { try { await fetch(`${base}/magaza/sitemap.xml`); break; } catch { if (i === 99) throw Error('PHP did not start'); await new Promise(r => setTimeout(r, 50)); } }
  return {base, logs, stop: () => new Promise(r => { child.kill(); if (child.exitCode !== null) r(); else { child.once('exit', r); setTimeout(r, 3000); } })};
}
const get = async (s, p) => { const r = await fetch(s.base + p, {redirect: 'manual'}); return {status: r.status, type: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '', text: await r.text()}; };
const ldBlocks = html => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m => JSON.parse(m[1]));

async function withShop(opts, catalog, fn) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vgm-pages-'));
  if (opts.seed !== false) seed(data, opts.seed || {});
  const env = {VG_DATA_DIR: data, VG_MAGAZA_CATALOG: catalog || path.join(fx, 'katalog.json')};
  if (opts.firma) env.VG_MAGAZA_FIRMA = opts.firma;
  const s = await server(env);
  try { await fn(s, data); } finally { await s.stop(); fs.rmSync(data, {recursive: true, force: true}); }
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
    const cat = await get(s, '/magaza/kategori/gunes-panelleri/');
    assert.equal(cat.status, 200); assert.ok(cat.text.includes('5.760,00 ₺'));
    const prod = await get(s, P1);
    assert.equal(prod.status, 200);
    assert.ok(prod.text.includes('5.760,00 ₺')); assert.match(prod.text, /KDV dahil/);
    assert.match(prod.text, /Fiyat güncelleme tarihi: <time[^>]*>\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}<\/time>/);
    assert.match(prod.text, /Fiyatlar her gün TCMB döviz kuruyla güncellenir/);
    assert.match(prod.text, /data-vgm-add="vgm-9001"/); assert.match(prod.text, /Sepete ekle/);
    assert.match(prod.text, /<meta name="robots" content="index/);
    assert.match(prod.text, /<link rel="canonical" href="https:\/\/voltguard\.com\.tr\/magaza\/urun\/deneme-marka-dm-450-450w-gunes-paneli\/">/);
    assert.match(prod.text, /th-paper/); assert.match(prod.text, /\/magaza\/odeme-ve-teslimat\.html/); assert.match(prod.text, /\/magaza\/iade-ve-cayma\.html/);
    assert.doesNotMatch(hub.text, /144,00 ₺/);
    for (const page of [hub, cat, prod, await get(s, FREIGHT), await get(s, '/magaza/sitemap.xml')]) {
      assert.doesNotMatch(page.text, /USD/); assert.doesNotMatch(page.text, /example\.test/); assert.doesNotMatch(page.text, /tedarikci/i);
    }
    // JSON-LD: Product + Offer (TRY, render anındaki fiyat) + BreadcrumbList
    const ld = ldBlocks(prod.text);
    const product = ld.find(b => b['@type'] === 'Product'), crumbs = ld.find(b => b['@type'] === 'BreadcrumbList');
    assert.ok(product && crumbs);
    assert.equal(product.offers.priceCurrency, 'TRY'); assert.equal(product.offers.price, '5760.00');
    assert.equal(product.offers.availability, 'https://schema.org/InStock'); assert.equal(product.offers.seller.name, 'VoltGuard');
    assert.equal(crumbs.itemListElement.length, 4);
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
    assert.match(stale.text, /Fiyat teyidi bekleniyor/); assert.match(stale.text, /Güncel fiyat için teklif isteyin/); assert.doesNotMatch(stale.text, /144,00 ₺/); assert.doesNotMatch(stale.text, /"offers"/); assert.doesNotMatch(stale.text, /data-vgm-add/);
  });
});

test('varsayılan satıcı (boş alanlar): kapalı mağaza bandı, sepete ekleme yok', async () => {
  await withShop({}, null, async s => {
    for (const p of ['/magaza/', '/magaza/kategori/gunes-panelleri/', P1]) {
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

test('404: bilinmeyen ürün ve kategori; eksik / yönlendirilir; sitemap ürünleri listeler', async () => {
  await withShop({firma: path.join(fx, 'firma-tam.json')}, null, async s => {
    for (const p of ['/magaza/urun/yok-boyle-bir-urun/', '/magaza/kategori/yok-boyle-kategori/']) {
      const r = await get(s, p);
      assert.equal(r.status, 404, p); assert.equal(r.cache, 'no-store'); assert.match(r.text, /noindex/); assert.match(r.text, /Mağazaya dön/);
    }
    const redirect = await get(s, '/magaza/urun/deneme-marka-dm-450-450w-gunes-paneli');
    assert.equal(redirect.status, 301);
    const map = await get(s, '/magaza/sitemap.xml');
    assert.equal(map.status, 200); assert.match(map.type, /application\/xml/);
    for (const slug of ['deneme-marka-dm-450-450w-gunes-paneli', 'deneme-marka-dm-inv-5k-5kw-on-grid-inverter']) assert.ok(map.text.includes(`https://voltguard.com.tr/magaza/urun/${slug}/`));
    assert.ok(map.text.includes('https://voltguard.com.tr/magaza/kategori/gunes-panelleri/'));
    assert.doesNotMatch(map.text, /kategori\/kablolar\//);   // ürünü olmayan kategori yok
  });
});

test('ürün adındaki <script> kaçışlanır; JSON-LD geçerli kalır; belge bağlantısı rel=noopener', async () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(fx, 'katalog.json'), 'utf8'));
  catalog.products[0].name = 'Deneme <script>alert(1)</script> "Panel" & Co';
  catalog.products[0].documents = [{title: 'Veri sayfası (PDF)', url: 'https://dokuman.example.org/dm-450.pdf'}, {title: 'Kötü', url: 'javascript:alert(1)'}];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vgm-cat-')), 'katalog.json');
  fs.writeFileSync(file, JSON.stringify(catalog));
  await withShop({firma: path.join(fx, 'firma-tam.json')}, file, async s => {
    for (const p of [P1, '/magaza/', '/magaza/kategori/gunes-panelleri/']) {
      const r = await get(s, p);
      assert.equal(r.status, 200);
      assert.doesNotMatch(r.text, /<script>alert\(1\)/); assert.match(r.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      for (const b of ldBlocks(r.text)) assert.ok(b['@type']);
    }
    const prod = await get(s, P1);
    assert.match(prod.text, /href="https:\/\/dokuman\.example\.org\/dm-450\.pdf" target="_blank" rel="noopener"/);
    assert.doesNotMatch(prod.text, /javascript:/);
    assert.equal(ldBlocks(prod.text).find(b => b['@type'] === 'Product').name, 'Deneme <script>alert(1)</script> "Panel" & Co');
  });
  fs.rmSync(path.dirname(file), {recursive: true, force: true});
});

test('boş katalog: Ürünler hazırlanıyor, hata yok; fiyat/kur dosyası yoksa teklif isteyin', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vgm-cat-')), 'katalog.json');
  fs.copyFileSync(path.join(root, 'api/lib/magaza/katalog.json'), file);
  const real = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (real.products.length) { real.products = []; fs.writeFileSync(file, JSON.stringify(real)); }
  await withShop({seed: false}, file, async s => {
    const hub = await get(s, '/magaza/');
    assert.equal(hub.status, 200); assert.match(hub.text, /Ürünler hazırlanıyor/); assert.match(hub.text, /href="\/hizmetler\/"/); assert.match(hub.text, /href="\/iletisim\.html/);
    assert.match(hub.text, /content="noindex, follow"/);
    const cat = await get(s, '/magaza/kategori/gunes-panelleri/');
    assert.equal(cat.status, 200); assert.match(cat.text, /hazırlanıyor/);
    assert.equal((await get(s, '/magaza/sitemap.xml')).status, 200);
  });
  await withShop({seed: false}, null, async s => {   // kur yok: TL fiyat yok, teklif yönlendirmesi
    const p = await get(s, P1);
    assert.equal(p.status, 200); assert.match(p.text, /Güncel fiyat için teklif isteyin/); assert.doesNotMatch(p.text, /"offers"/);
  });
  fs.rmSync(path.dirname(file), {recursive: true, force: true});
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
      // Hukuki metinler herkese açık ve sitemapte; taslak uyarısı taşır, tedarikçi adı / USD içermez
      assert.match(html, /<meta name="robots" content="index, follow">/, f);
      assert.ok(sitemap.includes('<loc>https://voltguard.com.tr/' + f + '</loc>'), f + ' sitemapte');
      assert.match(html, /Taslak – hukuki inceleme önerilir/, f); assert.doesNotMatch(html, /USD|dolar/i, f);
    } else {
      assert.match(html, /<meta name="robots" content="noindex/, f);
    }
  }
  const od = fs.readFileSync(path.join(root, 'magaza/odeme.html'), 'utf8');
  assert.match(od, /href="\/magaza\/kvkk-aydinlatma\.html"/); assert.doesNotMatch(od, /name="consents\.kvkk"/);
  const tpl = fs.readFileSync(path.join(root, 'magaza/index.html'), 'utf8');
  assert.match(tpl, /<!--vgm:meta-->[\s\S]*<!--\/vgm:meta-->/); assert.match(tpl, /<!--vgm:main-->[\s\S]*<!--\/vgm:main-->/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'js/magaza.js'), 'utf8'), /USD/);
});
