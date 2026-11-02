'use strict';
// Mağaza ölçeği (api/MAGAZA.md "Ölçek"): parçalı katalog aramaları (PHP), 50.000 ürünlük sentetik katalogda sayfa/arama/
// sepet süreleri ve hiçbir herkese açık isteğin tüm parçaları yüklemediği, tek dosyalı büyük özel yapılandırmanın
// (50.000 ürün / 150.000 kaynak) parçalanarak içe aktarılması ve medya deposu yükleme komutunun (gorsel-yukle) ad/başlık
// denetimleri. Gerçek PHP; veri ve katalog geçici klasörde. Çalıştırma: VG_PHP=<php.exe> node --test tools/tests/magaza-olcek.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const K = require('../magaza/katalog-ortak.cjs');
const gen = require('./fixtures/magaza/katalog-uret.cjs');
const ozel = require('./fixtures/magaza/ozel.cjs');
const { seed } = require('./fixtures/magaza/pages/seed.cjs');

const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || [path.join(root, '.qa/php/runtime/php.exe'), path.resolve(root, '../../../.qa/php/runtime/php.exe')].find(f => fs.existsSync(f)) || path.join(root, '.qa/php/runtime/php.exe');   // git worktree: ana kopyanın .qa/php'si
const fx = path.join(root, 'tools/tests/fixtures/magaza');
const cli = path.join(root, 'tools/magaza-admin.php');
const router = path.join(fx, 'pages/router.php');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-magaza-olcek-'));
test.after(() => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* geçici klasör */ } });
const tmp = name => fs.mkdtempSync(path.join(scratch, name + '-'));

/** Çekirdek kitaplıkla PHP parçası (katalog fonksiyonları); çıktı JSON. */
function phpJson(body, env = {}) {
  const file = path.join(scratch, `parca-${Math.random().toString(36).slice(2)}.php`);
  fs.writeFileSync(file, `<?php
declare(strict_types=1);
define('VG_API', 1);
foreach (['bootstrap', 'store', 'security', 'validate', 'magaza'] as $f) { require_once ${JSON.stringify(path.join(root, 'api/lib') + path.sep)} . $f . '.php'; }
${body}
`);
  const r = spawnSync(php, ['-n', file], { env: { ...process.env, VG_DATA_DIR: tmp('veri'), ...env }, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(r.stdout);
}
function admin(args, env = {}) {
  const r = spawnSync(php, ['-n', cli, ...args], { env: { ...process.env, VG_STORE: 'json', VG_MAIL_OUTBOX: '', ...env }, encoding: 'utf8',
    windowsHide: true, timeout: 600000, maxBuffer: 256 << 20 });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/* ------------------------------------------------------------------------ parçalı katalog aramaları (PHP) */

test('PHP katalog: ürün tek parçadan, slug iki dosyadan; kategori ağacı, üst kategori listesi ve arama', () => {
  const r = phpJson(`
$p = vgm_product('vgm-9001');
$s = vgm_product_by_slug('deneme-marka-dm-450-450w-gunes-paneli');
$cats = vgm_categories();
echo json_encode([
  'id' => $p['id'] ?? null, 'cat' => $p['category'] ?? null, 'slugId' => $s['id'] ?? null,
  'badSlug' => vgm_product_by_slug('olmayan-urun-adresi'), 'badSlug2' => vgm_product_by_slug('../kategoriler'),
  'missing' => vgm_product('vgm-9999'), 'bad' => vgm_product('vgm-12'), 'badLong' => vgm_product('vgm-1234567'),
  'shard' => [vgm_shard_of('vgm-0101'), vgm_shard_of('vgm-9001'), vgm_shard_of('vgm-123456')],
  'top' => array_values(array_keys(array_filter($cats, function ($c) { return $c['parent'] === null; }))),
  'children' => $cats['gunes-panelleri']['children'], 'count' => $cats['gunes-panelleri']['count'],
  'parentList' => array_column(vgm_list('gunes-panelleri'), 'id'), 'leafList' => array_column(vgm_list('monokristal-paneller'), 'id'),
  'cardCat' => vgm_list('gunes-panelleri')[0]['category'] ?? null,
  'search' => array_column(vgm_search('DENEME 450', 96)['items'], 'id'), 'searchTotal' => vgm_search('deneme', 2)['total'],
  'searchItems' => count(vgm_search('deneme', 2)['items']), 'empty' => vgm_search('   ', 10),
  'ids' => iterator_to_array(vgm_product_ids()), 'manifest' => vgm_manifest()['products'],
]);`, { VG_MAGAZA_CATALOG: path.join(fx, 'katalog') });
  assert.equal(r.id, 'vgm-9001'); assert.equal(r.cat, 'monokristal-paneller'); assert.equal(r.slugId, 'vgm-9001');
  for (const k of ['badSlug', 'badSlug2', 'missing', 'bad', 'badLong']) assert.equal(r[k], null, k);
  assert.deepEqual(r.shard, ['0001', '0090', '1234']);
  assert.ok(r.top.includes('gunes-panelleri') && !r.top.includes('monokristal-paneller'));
  assert.deepEqual(r.children, ['monokristal-paneller']); assert.equal(r.count, 1);
  assert.deepEqual(r.parentList, ['vgm-9001'], 'parent lists merge their children'); assert.deepEqual(r.leafList, ['vgm-9001']);
  assert.equal(r.cardCat, 'monokristal-paneller', 'cards carry their leaf category');
  assert.deepEqual(r.search, ['vgm-9001']);
  assert.equal(r.searchItems, 2); assert.ok(r.searchTotal >= 2);
  assert.deepEqual(r.empty, { items: [], total: 0, mode: 'and', all: [], facets: { category: [] } });
  assert.equal(Object.keys(r.ids).length, 5); assert.equal(r.manifest, 5);
});

/* ------------------------------------------------------------------------ 50.000 ürün */

const big = { dir: null, model: null };
function bigCatalog() {
  if (!big.dir) {
    const b = gen.bigModel(50000, 6000);
    big.dir = tmp('katalog-50k');
    gen.write(big.dir, b.model);
    big.model = b;
  }
  return big;
}

async function server(env) {
  const l = net.createServer(); await new Promise(r => l.listen(0, '127.0.0.1', r));
  const port = l.address().port; await new Promise(r => l.close(r));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(php, ['-n', '-S', `127.0.0.1:${port}`, '-t', root, router], { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const logs = []; child.stderr.on('data', c => logs.push(String(c)));
  for (let i = 0; i < 200; i++) { try { await fetch(`${base}/magaza/sitemap.xml`); break; } catch { if (i === 199) throw Error('PHP did not start'); await new Promise(r => setTimeout(r, 50)); } }
  return { base, logs, stop: () => new Promise(r => { child.kill(); if (child.exitCode !== null) r(); else { child.once('exit', r); setTimeout(r, 3000); } }) };
}

test('50.000 ürün: ürün, kategori (ilk/son sayfa), üst kategori, arama ve sepet 0,5 sn altında; istek tüm parçaları yüklemez', { timeout: 600000 }, async t => {
  const { dir, model } = bigCatalog();
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.products, 50000);
  assert.equal(fs.readdirSync(path.join(dir, 'urun')).length, 500, '100 ids per product shard');
  const heavy = JSON.parse(fs.readFileSync(path.join(dir, 'liste', model.heavyLeaf + '.json'), 'utf8')).items;
  assert.equal(heavy.length, 6000);
  const target = heavy[1234];
  const shardFile = path.join(dir, 'urun', K.shardOf(target.id) + '.json');
  const record = JSON.parse(fs.readFileSync(shardFile, 'utf8')).products[target.id];
  const cart = heavy.slice(1230, 1236).map(c => c.id);
  // Bu ürünün, ilgili ürünlerinin ve sepetin parçaları dışındaki TÜM ürün ve slug parçaları bozulur: herhangi bir istek
  // bunlardan birini okursa 503 döner (hiçbir herkese açık istek tüm parçaları yüklemez).
  const keepShards = new Set([target.id, ...record.related, ...cart].map(id => K.shardOf(id) + '.json'));
  for (const f of fs.readdirSync(path.join(dir, 'urun'))) if (!keepShards.has(f)) fs.writeFileSync(path.join(dir, 'urun', f), '{bozuk');
  for (const f of fs.readdirSync(path.join(dir, 'slug'))) if (f !== K.slugShard(target.slug) + '.json') fs.writeFileSync(path.join(dir, 'slug', f), '{bozuk');

  const data = tmp('veri-50k');
  seed(data, { ids: Object.fromEntries(cart.map((id, i) => [id, 10 + i])) });
  const s = await server({ VG_DATA_DIR: data, VG_STORE: 'json', VG_MAGAZA_CATALOG: dir, VG_MAGAZA_FIRMA: path.join(fx, 'firma-tam.json') });
  const timed = async (label, url, init, check) => {
    let best = Infinity;
    let last;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const res = await fetch(s.base + url, init);
      const text = await res.text();
      best = Math.min(best, performance.now() - t0);
      last = { status: res.status, text };
    }
    t.diagnostic(`${label}: ${best.toFixed(0)} ms`);
    assert.equal(last.status, 200, `${label}: ${last.text.slice(0, 300)}`);
    if (check) check(last.text);
    assert.ok(best < 500, `${label} took ${best.toFixed(0)} ms (limit 500 ms)`);
  };
  try {
    const pages = Math.ceil(6000 / 48);
    await timed('ürün sayfası', `/magaza/urun/${target.slug}/`, undefined, html => {
      assert.ok(html.includes(target.name)); assert.match(html, /id="vgm-rel-h"/);
    });
    await timed('kategori 1. sayfa (6.000 ürün)', `/magaza/kategori/${model.heavyLeaf}/`, undefined, html => {
      assert.match(html, /6000 ürün · 1–48 gösteriliyor/);
      assert.equal((html.match(/<li class="vgm-card" data-vgm-card/g) || []).length, 48);
    });
    await timed('kategori son sayfa', `/magaza/kategori/${model.heavyLeaf}/?sayfa=${pages}`, undefined, html => {
      assert.match(html, new RegExp(`aria-current="page">${pages}<`));
    });
    await timed('kategori fiyat sıralı + marka', `/magaza/kategori/${model.heavyLeaf}/?marka=${K.fold(gen.BRANDS[0]).replace(/[^a-z0-9]+/g, '-')}&sirala=fiyat-artan`);
    await timed('üst kategori (alt kategoriler birleşik)', `/magaza/kategori/${model.parent}/`, undefined, html => {
      assert.match(html, /<a class="vgm-subcat" aria-current="page" href="\/magaza\/kategori\/ust-01\/">Tümü/);
    });
    await timed('arama', `/magaza/ara/?q=${encodeURIComponent('SN-0012')}`, undefined, html => assert.match(html, /ürün bulundu/));
    await timed('vitrin', '/magaza/', undefined, html => assert.match(html, /50\.000 ürün/));
    await timed('sepet fiyatlama', '/api/magaza.php?action=sepet', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base },
      body: JSON.stringify({ items: cart.map(id => ({ id, qty: 2 })) }),
    }, text => {
      const j = JSON.parse(text);
      assert.equal(j.lines.length, 6); assert.ok(j.lines.every(l => l.orderable), JSON.stringify(j.lines.map(l => l.reason)));
      assert.ok(j.quote && j.quote.token);
    });
    await timed('fiyatlar ?ids=', `/api/magaza.php?action=fiyatlar&ids=${cart.join(',')}`, undefined, text => {
      assert.deepEqual(Object.keys(JSON.parse(text).items).sort(), [...cart].sort());
    });
    // site haritası: dizin + 10.000 adreslik parçalar (yalnızca liste dosyaları okunur)
    const idx = await (await fetch(s.base + '/magaza/sitemap.xml')).text();
    const parts = [...idx.matchAll(/<loc>[^<]+\/magaza\/sitemap-(\d+)\.xml<\/loc>/g)].map(m => Number(m[1]));
    assert.deepEqual(parts, [1, 2, 3, 4, 5, 6]);
    const p6 = await (await fetch(s.base + '/magaza/sitemap-6.xml')).text();
    const p1 = await (await fetch(s.base + '/magaza/sitemap-1.xml')).text();
    assert.equal((p1.match(/<url>/g) || []).length, 10000);
    assert.equal((p6.match(/<url>/g) || []).length, 1 + 60 + 50000 - 50000, 'last part: the remainder (1 hub + 60 categories + 50000 products - 5 × 10000)');
    const p7 = await fetch(s.base + '/magaza/sitemap-7.xml'); await p7.text();
    assert.equal(p7.status, 404);
    // bozuk parçaya giden ürün sayfası 503 verir (denetimin kendisi çalışıyor)
    const other = heavy[5999];
    assert.ok(!keepShards.has(K.shardOf(other.id) + '.json'));
    const broken = await fetch(`${s.base}/magaza/urun/${other.slug}/`); await broken.text();
    assert.equal(broken.status, 503);
  } finally {
    await s.stop();
  }
  assert.doesNotMatch(s.logs.join('').replace(/magaza catalog file is invalid \((urun|slug)\/[0-9a-f]+\.json\)/g, ''), /Fatal error|Warning:|Notice:|Deprecated:/);
});

/* ------------------------------------------------------------------------ büyük özel yapılandırma içe aktarma */

test('import: tek dosyalı 50.000 ürün / 150.000 kaynak yapılandırması parçalanır; eski parçalar atomik olarak değişir', { timeout: 900000 }, t => {
  const { dir } = bigCatalog();
  const env = { VG_MAGAZA_CATALOG: dir, VG_MAGAZA_FIRMA: path.join(fx, 'firma-tam.json') };
  const data = tmp('veri-import');
  const ids = [];
  for (let n = 0; n < 50000; n++) ids.push(`vgm-${100000 + n}`);
  const hosts = ['tedarikci-a.example.test', 'tedarikci-b.example.test', 'tedarikci-c.example.test'];
  const config = drop => {
    const sources = {};
    for (const id of ids) {
      if (drop && drop(id)) continue;
      sources[id] = hosts.map((h, i) => ({ url: `https://${h}/urun/${id}?ref=katalog-esleme-${i}`, supplier: h, vatIncluded: i !== 1,
        currency: i === 1 ? 'USD' : 'TRY', priority: i + 1, discount: i === 2 ? 0.05 : 0 }));
    }
    return { version: 1, open: false, margin: { default: 0.18, byCategory: { 'ust-01': 0.2 }, byProduct: {} },
      shipping: { feeTry: 0, freeOverTry: 0 }, paymentHours: 24, fxBuffer: 0, blockedSuppliers: ['kotu.example.test'],
      suppliers: { 'tedarikci-b.example.test': { spacing: 3 } }, sources };
  };
  const full = path.join(scratch, 'kaynaklar-50k.json');
  fs.writeFileSync(full, JSON.stringify(config(), null, 1));
  const mb = fs.statSync(full).size / 1048576;
  t.diagnostic(`config: ${mb.toFixed(1)} MB`);
  assert.ok(mb > 20 && mb < 64, `${mb} MB`);
  let t0 = Date.now();
  let r = admin(['import', full], { ...env, VG_DATA_DIR: data });
  t.diagnostic(`import 50k: ${Date.now() - t0} ms`);
  assert.equal(r.status, 0, r.err + r.out);
  assert.match(r.out, /50000 üründe toplam 150000 kaynak/);
  const mdir = path.join(data, 'magaza');
  const settings = JSON.parse(fs.readFileSync(path.join(mdir, 'kaynaklar.json'), 'utf8'));
  assert.equal('sources' in settings, false);
  assert.deepEqual(settings.suppliers, { 'tedarikci-b.example.test': { spacing: 3 } });
  assert.equal(fs.readdirSync(path.join(mdir, 'kaynak')).length, 500);
  const shard = JSON.parse(fs.readFileSync(path.join(mdir, 'kaynak', '1499.json'), 'utf8'));
  assert.equal(Object.keys(shard).length, 100); assert.equal(shard['vgm-149999'].length, 3);
  const queue = JSON.parse(fs.readFileSync(path.join(mdir, 'fiyat-sira.json'), 'utf8'));
  assert.equal(Object.keys(queue.items).length, 50000, 'scheduler queue rebuilt from the new shards');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(mdir, 'fiyat-durum.json'), 'utf8')).problems, []);

  // ikinci içe aktarma: son 100 ürünün kaynakları çıkarıldı -> 1499 parçası kalmaz, ara klasör kalmaz
  const fewer = path.join(scratch, 'kaynaklar-49900.json');
  fs.writeFileSync(fewer, JSON.stringify(config(id => Number(id.slice(4)) >= 149900)));
  t0 = Date.now();
  r = admin(['import', fewer], { ...env, VG_DATA_DIR: data });
  t.diagnostic(`re-import: ${Date.now() - t0} ms`);
  assert.equal(r.status, 0, r.err + r.out);
  assert.equal(fs.existsSync(path.join(mdir, 'kaynak', '1499.json')), false, 'stale shard removed');
  assert.equal(fs.readdirSync(path.join(mdir, 'kaynak')).length, 499);
  assert.deepEqual(fs.readdirSync(mdir).filter(f => /^kaynak\.(yeni|eski)-/.test(f)), [], 'no staging directories left behind');
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(mdir, 'fiyat-sira.json'), 'utf8')).items).length, 49900);
  assert.match(r.out, /100 üründe kaynak yok/);

  // export-config tek dosya biçimini geri verir; yeniden içe aktarmak değişiklik yapmaz
  const exported = admin(['export-config'], { ...env, VG_DATA_DIR: data });
  assert.equal(exported.status, 0, exported.err);
  const back = JSON.parse(exported.out);
  assert.equal(Object.keys(back.sources).length, 49900);
  assert.deepEqual(back.sources['vgm-100000'], config().sources['vgm-100000']);

  // doğrulama hatası (engelli tedarikçi) varsa mevcut parçalar olduğu gibi kalır
  const bad = config();
  bad.sources['vgm-100001'][0] = { url: 'https://kotu.example.test/x', supplier: 'kotu.example.test', vatIncluded: true, currency: 'TRY' };
  const badFile = path.join(scratch, 'kaynaklar-kotu.json');
  fs.writeFileSync(badFile, JSON.stringify(bad));
  const before = fs.readFileSync(path.join(mdir, 'kaynak', '1000.json'), 'utf8');
  r = admin(['import', badFile], { ...env, VG_DATA_DIR: data });
  assert.equal(r.status, 1);
  assert.match(r.err, /kotu\.example\.test engelli tedarikçi listesinde/);
  assert.equal(fs.readFileSync(path.join(mdir, 'kaynak', '1000.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(mdir, 'kaynak', '1499.json')), false);
});

/* ------------------------------------------------------------------------ medya deposu yükleme */

const webp = (tag = 'a') => Buffer.concat([Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32, tag)]);

test('gorsel-yukle: yalnızca <2 hane>/<ad>.<özet>(-t).webp ve RIFF/WEBP başlıklı dosyalar; üzerine yazmaz; sayıları bildirir', () => {
  const src = tmp('paket');
  const put = (rel, buf) => { const f = path.join(src, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); };
  put('ab/urun-bir.0123abcd.webp', webp('1'));
  put('ab/urun-bir.0123abcd-t.webp', webp('2'));
  put('magaza-gorsel/cd/urun-iki.89abcdef.webp', webp('3'));            // paket kökünde magaza-gorsel/ öneki atılır
  put('ab/Urun-Buyuk.0123abcd.webp', webp('4'));                         // büyük harf
  put('ab/urun.png', webp('5'));                                         // uzantı
  put('ab/urun-uc.0123abc.webp', webp('6'));                             // özet 7 hane
  put('ab/alt/urun-dort.0123abcd.webp', webp('7'));                      // fazladan klasör
  put('zz/urun-bes.0123abcd.webp', webp('8'));                           // klasör onaltılık değil
  put('ab/urun-alti.0123abcd.webp.php', webp('9'));
  put('ab/sahte.0123abcd.webp', Buffer.from('<?php echo 1; ?>'.padEnd(40, ' ')));   // ad doğru, içerik WebP değil
  const site = tmp('docroot');
  const target = path.join(site, 'magaza-gorsel');
  const env = { VG_DATA_DIR: '' };

  let r = admin(['gorsel-yukle', src], env);
  assert.equal(r.status, 2, 'missing --hedef');
  r = admin(['gorsel-yukle', src, '--hedef', path.join(site, 'baska-klasor')], env);
  assert.equal(r.status, 2); assert.match(r.err, /magaza-gorsel olmalı/);
  r = admin(['gorsel-yukle', path.join(src, 'ab', 'urun.png'), '--hedef', target], env);
  assert.equal(r.status, 2, 'a single non-zip file is refused');

  r = admin(['gorsel-yukle', src, '--hedef', target, '--deneme'], env);
  assert.equal(r.status, 1, 'non-WebP content is reported as a failure');
  assert.match(r.out, /Deneme \(hiçbir şey yazılmadı\): kopyalanacak 3, zaten var 0, çakışan 0 \(üzerine yazılmadı\), geçersiz ad 6, WebP değil 1/);
  assert.equal(fs.existsSync(target), false, '--deneme writes nothing');

  r = admin(['gorsel-yukle', src, '--hedef', target], env);
  assert.match(r.out, /kopyalanan 3, zaten var 0, çakışan 0 \(üzerine yazılmadı\), geçersiz ad 6, WebP değil 1/);
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.relative(target, path.join(d, e.name)).split(path.sep).join('/')); };
  walk(target);
  assert.deepEqual(files.sort(), ['ab/urun-bir.0123abcd-t.webp', 'ab/urun-bir.0123abcd.webp', 'cd/urun-iki.89abcdef.webp']);
  assert.deepEqual(fs.readFileSync(path.join(target, 'cd', 'urun-iki.89abcdef.webp')), webp('3'));

  // yalnızca WebP içerik sorunu giderildi, geçersiz adlar duruyor: paket temiz sayılmaz (Dosya Yöneticisi ile açılmamalı)
  fs.rmSync(path.join(src, 'ab', 'sahte.0123abcd.webp'));
  r = admin(['gorsel-yukle', src, '--hedef', target, '--deneme'], env);
  assert.equal(r.status, 1, 'invalid names fail the check');
  assert.match(r.err, /6 geçersiz adlı dosya var/); assert.match(r.err, /Dosya Yöneticisi ile açmayın/);
  // yalnızca geçerli dosyalarla yeniden: hepsi "zaten var", çıkış 0
  for (const bad of ['ab/Urun-Buyuk.0123abcd.webp', 'ab/urun.png', 'ab/urun-uc.0123abc.webp', 'ab/alt', 'zz', 'ab/urun-alti.0123abcd.webp.php']) fs.rmSync(path.join(src, ...bad.split('/')), { recursive: true });
  r = admin(['gorsel-yukle', src, '--hedef', target], env);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /geçersiz ad 0, WebP değil 0/);
  assert.match(r.out, /kopyalanan 0, zaten var 3, çakışan 0/);
  // aynı adla farklı içerik: üzerine yazılmaz, çakışma bildirilir
  put('ab/urun-bir.0123abcd.webp', webp('X'));
  r = admin(['gorsel-yukle', src, '--hedef', target], env);
  assert.equal(r.status, 1);
  assert.match(r.out, /çakışan 1/); assert.match(r.err, /Çakışma \(üzerine yazılmadı\): ab\/urun-bir\.0123abcd\.webp/);
  assert.deepEqual(fs.readFileSync(path.join(target, 'ab', 'urun-bir.0123abcd.webp')), webp('1'));
  assert.deepEqual(fs.readdirSync(path.join(target, 'ab')).filter(f => f.endsWith('.tmp')), [], 'no temporary files left');
});
