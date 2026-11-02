'use strict';
// Mağaza kataloğu v2 (api/lib/magaza/katalog/): doğrulayıcı kuralları (medya deposu adresleri dahil), yazıcının
// (tools/magaza/katalog-derle.cjs) belirlenimli çıktısı, artık dosyaların silinmesi, sayılar ve related doldurma; v1'den
// kayıpsız taşıma; açık depo gizliliği (tedarikçi alan adları mağaza dosyalarında geçmez, özel veri depoda yok).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { validate, validateDir, gtinOk } = require('../magaza/katalog-dogrula.cjs');
const K = require('../magaza/katalog-ortak.cjs');
const gen = require('./fixtures/magaza/katalog-uret.cjs');

const root = path.resolve(__dirname, '../..');
const fixtureDir = path.join(root, 'tools/tests/fixtures/magaza/katalog');
const writer = path.join(root, 'tools/magaza/katalog-derle.cjs');
const checker = path.join(root, 'tools/magaza/katalog-dogrula.cjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vgm-katalog-'));
const NO_MEDIA = path.join(scratch, 'medya-yok');          // yerel medya klasörü testleri etkilemesin
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function snapshot(dir) {
  const out = {};
  for (const rel of K.listFiles(dir)) out[rel] = fs.readFileSync(path.join(dir, rel), 'utf8');
  return out;
}
function cli(file, args, env = {}) {
  const r = spawnSync(process.execPath, [file, ...args], { env: { ...process.env, VG_MAGAZA_MEDIA: NO_MEDIA, ...env }, encoding: 'utf8', windowsHide: true });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
const jsonl = (name, products) => { const f = path.join(scratch, name); fs.writeFileSync(f, products.map(p => JSON.stringify(p)).join('\n') + '\n'); return f; };
const read = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
/** Minimal WebP (VP8X başlığı): doğrulayıcı yalnızca ilk 30 baytı okur. */
function webp(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii'); b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}

/* ------------------------------------------------------------------------------------------------ doğrulayıcı */

test('gerçek katalog ve sentetik test kataloğu v2 doğrulamasından geçer (dizin dosyaları yazıcı çıktısıyla aynı)', () => {
  const real = validateDir(K.DEFAULT_DIR, { media: NO_MEDIA });
  assert.deepEqual(real.errors, []);
  assert.ok(real.products >= 55, 'ilk 55 ürün ve toplu içe aktarılanlar');
  const model = K.loadDir(K.DEFAULT_DIR);
  assert.equal(new Set(model.products.map(p => p.id)).size, model.products.length);
  assert.ok(model.products.every(p => p.images.every(im => /^\/(?:public\/magaza|magaza-gorsel)\//.test(im.src))), 'görseller depoda ya da medya deposunda');
  const fx = validateDir(fixtureDir, { media: NO_MEDIA });
  assert.deepEqual(fx.errors, []);
  assert.ok(fx.products >= 5);
  assert.equal(fx.unchecked, 2 * fx.products, 'medya klasörü yoksa /magaza-gorsel/ dosyaları sayılır ama denetlenemez');
  const cats = read(fixtureDir, 'kategoriler.json').categories;
  assert.deepEqual(cats.find(c => c.id === 'monokristal-paneller'), { ...cats.find(c => c.id === 'monokristal-paneller'), parent: 'gunes-panelleri', count: 1 });
  assert.equal(cats.find(c => c.id === 'gunes-panelleri').count, 1, 'üst kategori sayısı alt kategorileri kapsar');
  assert.equal(gtinOk('4006381333931'), true);
  assert.equal(gtinOk('4006381333932'), false);
  // komut satırı: hata yoksa çıkış 0 ve denetlenemeyen dosya sayısı yazılır
  const r = cli(checker, [fixtureDir]);
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out, /10 görsel dosyası denetlenemedi/);
  assert.match(r.out, /katalog: 5 ürün, 0 sorun/);
});

test('v1 katalog.json kayıpsız taşındı (son tek dosyalı sürümle alan alan aynı)', t => {
  let raw = null;
  for (const args of [['show', 'HEAD:api/lib/magaza/katalog.json'], null]) {
    try {
      if (args) { raw = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); break; }
      const del = execFileSync('git', ['rev-list', '-1', 'HEAD', '--', 'api/lib/magaza/katalog.json'], { cwd: root, encoding: 'utf8' }).trim();
      if (del) raw = execFileSync('git', ['show', `${del}^:api/lib/magaza/katalog.json`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) { /* sonraki yol */ }
  }
  if (!raw) { t.skip('git geçmişinde v1 katalog yok'); return; }
  // Gerçek katalog v1'den bu yana büyüdü ve kategori ağacı değişti (toplu içe aktarma); taşıma kaybı v1 dosyasının yazıcıdan
  // geçirilip geri okunmasıyla denetlenir.
  const v1 = K.fromV1(JSON.parse(raw));
  const dir = fs.mkdtempSync(path.join(scratch, 'v1-'));
  K.writeDir(dir, K.buildFiles(K.normalize(JSON.parse(JSON.stringify(v1)))));
  const v2 = K.loadDir(dir);
  const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v);
  const byId = list => Object.fromEntries(list.map(x => [x.id, sortKeys(x)]));
  assert.equal(v2.products.length, v1.products.length);
  assert.deepEqual(byId(v2.products), byId(v1.products));
  assert.deepEqual(byId(v2.categories.map(({ filters, ...rest }) => rest)), byId(v1.categories.map(({ filters, ...rest }) => rest)));
  // gerçek katalogda v1'in ilk ürün kimlikleri hâlâ var (kimlikler yeniden kullanılmaz)
  const real = new Set(K.loadDir(K.DEFAULT_DIR).products.map(p => p.id));
  assert.ok(v1.products.every(p => real.has(p.id)), 'v1 ürünleri gerçek katalogda');
});

test('P1-06: gerçek katalogda önerilen teknik süzgeç tanımları (katalog-derle --kategoriler ile yazıldı)', () => {
  const cats = Object.fromEntries(K.loadDir(K.DEFAULT_DIR).categories.map(c => [c.id, c]));
  const keys = id => (cats[id].filters || []).map(f => `${f.key}:${f.type}${f.unit ? ':' + f.unit : ''}`);
  assert.deepEqual(keys('koruma-cihazlari'), ['poles:enum', 'amps:number:A', 'curve:enum', 'ka:number:kA']);
  assert.deepEqual(keys('kablolar'), ['section:enum:mm²']);
  assert.deepEqual(keys('on-grid-inverterler'), ['phase:enum', 'kw:number:kW']);
  assert.deepEqual(keys('hibrit-inverterler'), ['phase:enum', 'kw:number:kW']);
  assert.deepEqual(keys('sarj-istasyonlari'), ['phase:enum', 'kw:number:kW']);
  assert.deepEqual(keys('pano-malzemeleri'), ['poles:enum', 'amps:number:A']);
  assert.deepEqual(Object.values(cats).filter(c => c.filters).map(c => c.id).sort(),
    ['hibrit-inverterler', 'kablolar', 'koruma-cihazlari', 'on-grid-inverterler', 'pano-malzemeleri', 'sarj-istasyonlari']);
  // alt kategoriler üst kategorinin süzgecini kullanır; süzgeç anahtarlarının kartlarda karşılığı var
  const kids = Object.values(cats).filter(c => c.parent === 'koruma-cihazlari');
  assert.ok(kids.length >= 5 && kids.every(c => !c.filters));
  const mcb = JSON.parse(fs.readFileSync(path.join(K.DEFAULT_DIR, 'liste', 'otomatik-sigortalar.json'), 'utf8')).items;
  assert.ok(mcb.filter(c => c.attr && c.attr.poles && c.attr.amps).length > mcb.length / 2, 'otomatik sigortaların çoğunda kutup ve akım');
  assert.equal(cats['koruma-cihazlari'].filters[0].label, 'Kutup');
});

test('doğrulayıcı bozuk kayıtları yakalar (v1 alan kuralları)', () => {
  const bad = { categories: [{ id: 'k', name: 'K', title: 'Kategori', intro: '', order: 1, parent: null }],
    products: [{ id: 'vgm-0001', slug: 'Kotu Slug', name: 'x', brand: '', mpn: '', gtin: '123', category: 'yok', summary: '',
      description: [], specs: [], images: [{ src: '/public/baska/x.png', thumb: '', w: 1, h: 1, alt: '' }], documents: [{ title: 't', url: 'http://x' }],
      unit: 'koli', vat: 18, shipping: 'gemi', maxQty: 0, listUsd: 1.234, listCheckedAt: 'dün', related: ['vgm-0001'] }] };
  const errors = validate(bad, { media: NO_MEDIA }).join('\n');
  for (const word of ['slug', 'name', 'brand', 'mpn', 'gtin', 'kategori', 'summary', 'description', 'specs', 'src', 'documents',
    'unit', 'vat', 'shipping', 'maxQty', 'listUsd', 'listCheckedAt', 'related']) assert.match(errors, new RegExp(word), word);
  assert.match(validate({ categories: 'x' }).join(), /categories ve products/);
});

test('doğrulayıcı v2 kuralları: iki düzey kategori, yaprak kategori, kimlik, özet/açıklama/özellik sınırları ve görsel adresleri', () => {
  const cats = [gen.category('ust', 'Üst', 10), gen.category('alt', 'Alt', 11, 'ust'), gen.category('torun', 'Torun', 12, 'alt'),
    gen.category('yetim', 'Yetim', 13, 'olmayan')];
  const ok = gen.product('vgm-100001', 'alt', 1);
  const m = (products, categories = cats) => validate({ categories, products }, { media: NO_MEDIA }).join('\n');
  let e = m([ok]);
  assert.match(e, /categories torun: en fazla iki düzey/);
  assert.match(e, /categories yetim: bilinmeyen üst kategori olmayan/);
  e = m([{ ...ok, category: 'ust' }], cats.slice(0, 2));
  assert.match(e, /alt kategorisi olan ust kategorisine değil/);
  assert.deepEqual(validate({ categories: cats.slice(0, 2), products: [ok] }, { media: NO_MEDIA }), []);
  const one = (over, re) => assert.match(m([{ ...ok, ...over }], cats.slice(0, 2)), re, JSON.stringify(over).slice(0, 80));
  one({ id: 'vgm-01234' }, /geçersiz id/);                              // 5 hane yok
  one({ id: 'vgm-012345' }, /geçersiz id/);                             // 6 hane 100000 altı yok
  one({ summary: 'Kısa özet.' }, /summary 30–160/);
  one({ summary: 'x'.repeat(161) }, /summary 30–160/);
  one({ description: Array(6).fill('a'.repeat(60)) }, /description 1–5 paragraf/);
  one({ description: ['a'.repeat(59)] }, /description 1–5 paragraf/);
  one({ description: ['a'.repeat(901)] }, /description 1–5 paragraf/);
  one({ specs: [['Model', 'X']] }, /specs 2–30/);
  one({ specs: Array(31).fill(['a', 'b']) }, /specs 2–30/);
  const im = ok.images[0];
  one({ images: [{ ...im, w: 239 }] }, /w\/h 240–1200/);
  one({ images: [{ ...im, h: 1201 }] }, /w\/h 240–1200/);
  one({ images: [{ ...im, thumb: im.src }] }, /thumb aynı adın -t\.webp/);
  one({ images: [{ ...im, thumb: im.thumb.replace(/\/[0-9a-f]{2}\//, '/ff/') }] }, /thumb aynı adın -t\.webp/);
  one({ images: [{ ...im, src: im.src.replace('.webp', '.png'), thumb: im.thumb.replace('.webp', '.png') }] }, /src \/public\/magaza/);
  one({ images: [{ ...im, src: im.src.replace(/^\/magaza-gorsel\/[0-9a-f]{2}/, '/magaza-gorsel/zz') }] }, /src \/public\/magaza/);
  one({ images: [{ ...im, src: im.src.replace(/\.[0-9a-f]{8}\.webp$/, '.1234.webp') }] }, /src \/public\/magaza/);
  one({ images: [{ ...im, src: '/magaza-gorsel/aa/../x.webp' }] }, /src \/public\/magaza/);
  // eni boyu farklı (kare olmayan) görsel serbest
  assert.deepEqual(validate({ categories: cats.slice(0, 2), products: [{ ...ok, images: [{ ...im, w: 1200, h: 300 }] }] }, { media: NO_MEDIA }), []);
});

test('doğrulayıcı medya deposunu VG_MAGAZA_MEDIA klasöründen denetler (varsa); yoksa yalnızca adres kalıbı', () => {
  const media = fs.mkdtempSync(path.join(scratch, 'medya-'));
  const cats = [gen.category('ust', 'Üst', 10), gen.category('alt', 'Alt', 11, 'ust')];
  const p = gen.product('vgm-100001', 'alt', 1);
  const rel = s => path.join(media, ...s.slice('/magaza-gorsel/'.length).split('/'));
  const put = (s, buf) => { fs.mkdirSync(path.dirname(rel(s)), { recursive: true }); fs.writeFileSync(rel(s), buf); };
  const check = () => K.validateModel({ categories: cats, products: [p] }, { media });
  let r = check();
  assert.equal(r.unchecked, 0);
  assert.match(r.errors.join('\n'), /src dosyası yok/);
  put(p.images[0].src, webp(640, 640));
  put(p.images[0].thumb, webp(320, 320));
  assert.deepEqual(check().errors, []);
  put(p.images[0].thumb, webp(800, 800));
  assert.match(check().errors.join('\n'), /thumb en çok 640x640/);
  put(p.images[0].src, webp(500, 640));
  assert.match(check().errors.join('\n'), /src 640x640 olmalı \(500x640\)/);
  put(p.images[0].src, Buffer.from('<?php echo 1; ?>'.padEnd(40, ' ')));
  assert.match(check().errors.join('\n'), /src WebP değil/);
  r = K.validateModel({ categories: cats, products: [p] }, { media: path.join(media, 'yok') });
  assert.deepEqual([r.errors, r.unchecked], [[], 2]);
});

/* ------------------------------------------------------------------------------------------------ yazıcı */

function seedDir() {
  const dir = fs.mkdtempSync(path.join(scratch, 'dizin-'));
  const cats = [gen.category('ust', 'Üst Kategori', 10), gen.category('alt-a', 'Alt A', 11, 'ust'), gen.category('alt-b', 'Alt B', 12, 'ust'),
    gen.category('tek', 'Tek Kategori', 20)];
  const catFile = path.join(scratch, `kategoriler-${path.basename(dir)}.json`);
  fs.writeFileSync(catFile, JSON.stringify({ categories: cats }));
  // 7 ürün: alt-a (3; farklı markalar), alt-b (2), tek (2); 100000-100099 bir parça, 100150 başka parça
  const products = [
    gen.product('vgm-100001', 'alt-a', 1, { brand: 'Zeta Marka' }), gen.product('vgm-100002', 'alt-a', 2, { brand: 'Alfa Marka' }),
    gen.product('vgm-100003', 'alt-a', 3, { brand: 'Alfa Marka' }), gen.product('vgm-100004', 'alt-b', 4), gen.product('vgm-100005', 'alt-b', 5),
    gen.product('vgm-100006', 'tek', 6), gen.product('vgm-100150', 'tek', 150),
  ];
  const r = cli(writer, ['--dizin', dir, '--kategoriler', catFile, '--ekle', jsonl(`ilk-${path.basename(dir)}.jsonl`, products)]);
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out, /7 ürün, 4 kategori \(eklenen 7, değişen 0, silinen 0\)/);
  return { dir, cats, catFile, products };
}

test('yazıcı: tüm dizin dosyaları, sayılar, sıralama, related doldurma ve belirlenimli (bayt bayt aynı) çıktı', () => {
  const { dir, products } = seedDir();
  const files = Object.keys(snapshot(dir)).sort();
  const slugFiles = [...new Set(products.map(p => `slug/${K.slugShard(p.slug)}.json`))];
  assert.deepEqual(files, ['arama.json', 'kategoriler.json', 'liste/alt-a.json', 'liste/alt-b.json', 'liste/tek.json', 'manifest.json',
    ...slugFiles, 'urun/1000.json', 'urun/1001.json'].sort());
  const cats = read(dir, 'kategoriler.json');
  assert.equal(cats.version, 2); assert.match(cats.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.deepEqual(cats.categories.map(c => [c.id, c.parent, c.count]), [['ust', null, 5], ['alt-a', 'ust', 3], ['alt-b', 'ust', 2], ['tek', null, 2]]);
  assert.deepEqual(Object.keys(cats.categories[0]), ['id', 'name', 'title', 'intro', 'order', 'parent', 'count']);
  const list = read(dir, 'liste/alt-a.json');
  assert.equal(list.version, 2); assert.equal(list.category, 'alt-a');
  assert.deepEqual(list.items.map(c => c.id), ['vgm-100002', 'vgm-100003', 'vgm-100001'], 'marka, sonra ad sırası');
  assert.deepEqual(Object.keys(list.items[0]), ['id', 'slug', 'name', 'brand', 'mpn', 'thumb', 'listUsd', 'listCheckedAt', 'shipping', 'unit', 'vat', 'maxQty', 'sortTry'],
    'isteğe bağlı minQty/step/packQty/attr yoksa yazılmaz; sortTry her kartta');
  assert.equal(list.items[0].sortTry, list.items[0].listUsd, 'sortTry yer tutucu: listUsd (sunucu kurla çarpar)');
  assert.match(list.items[0].thumb, /-t\.webp$/);
  const shard = read(dir, 'urun/1000.json');
  assert.deepEqual(Object.keys(shard.products), ['vgm-100001', 'vgm-100002', 'vgm-100003', 'vgm-100004', 'vgm-100005', 'vgm-100006']);
  assert.deepEqual(read(dir, 'urun/1001.json').products['vgm-100150'].related, ['vgm-100006'], 'boş related aynı kategoriden doldurulur');
  assert.deepEqual(shard.products['vgm-100002'].related, ['vgm-100003', 'vgm-100001'], 'yazıcı sırasındaki komşular (en çok 4)');
  const p = shard.products['vgm-100001'];
  assert.equal(read(dir, `slug/${K.slugShard(p.slug)}.json`)[p.slug], 'vgm-100001');
  const search = read(dir, 'arama.json');
  assert.equal(search.items.length, 7);
  assert.deepEqual([search.items[0][0], search.items[0][2]], ['vgm-100002', 'alt-a'], 'kategori sırası, sonra yazıcı sırası');
  assert.deepEqual(search.items[0], ['vgm-100002', 'alfa marka sn-000002 sentetik test urunu sn000002 sn 000002 ust kategori alt a', 'alt-a', 'sn-000002 sn000002 sn 000002', 40],
    'ad + marka + model biçimleri (+ GTIN) + kategori yolu, Türkçe harfler katlanır; anahtarlar ve ad uzunluğu');
  assert.deepEqual(read(dir, 'manifest.json'), { version: 2, products: 7, generatedAt: cats.generatedAt });
  for (const rel of Object.keys(snapshot(dir))) assert.ok(fs.readFileSync(path.join(dir, rel), 'utf8').endsWith('\n'), rel);
  // aynı girdi: hiçbir dosya değişmez (generatedAt dahil)
  const before = snapshot(dir);
  const again = cli(writer, ['--dizin', dir]);
  assert.equal(again.status, 0, again.err);
  assert.match(again.out, /0 dosya yazıldı, 0 dosya silindi/);
  assert.deepEqual(snapshot(dir), before);
  // aynı model başka bir klasörde başka bir anda: generatedAt dışında bayt bayt aynı
  const other = fs.mkdtempSync(path.join(scratch, 'ikinci-'));
  K.writeDir(other, K.buildFiles(K.loadDir(dir)), new Date('2030-01-01T00:00:00Z'));
  const a = snapshot(dir), b = snapshot(other);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  for (const rel of Object.keys(a)) assert.equal(K.withoutStamp(rel, a[rel]), K.withoutStamp(rel, b[rel]), rel);
  assert.equal(read(other, 'manifest.json').generatedAt, '2030-01-01T00:00:00Z');
  assert.deepEqual(validateDir(dir, { media: NO_MEDIA }).errors, []);
});

test('yazıcı: silme ve değiştirme artık parça/liste/slug dosyalarını kaldırır, sayıları ve related alanlarını günceller', () => {
  const { dir, products } = seedDir();
  const p150 = products.find(p => p.id === 'vgm-100150');
  // bilinmeyen artık dosyalar da silinir
  fs.writeFileSync(path.join(dir, 'urun', '0999.json'), '{"version":2,"products":{}}\n');
  fs.writeFileSync(path.join(dir, 'liste', 'eski-kategori.json'), '{}\n');
  const v = validateDir(dir, { media: NO_MEDIA });
  assert.match(v.errors.join('\n'), /dizin: urun\/0999\.json artık kullanılmıyor/);
  let r = cli(writer, ['--dizin', dir, '--sil', 'vgm-100150']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /6 ürün.*silinen 1/);
  const files = K.listFiles(dir);
  for (const gone of ['urun/1001.json', 'urun/0999.json', 'liste/eski-kategori.json']) assert.ok(!files.includes(gone), gone);
  const slugFile = `slug/${K.slugShard(p150.slug)}.json`;
  assert.ok(!files.includes(slugFile) || !(p150.slug in read(dir, slugFile)));
  assert.deepEqual(read(dir, 'kategoriler.json').categories.find(c => c.id === 'tek').count, 1);
  assert.equal(read(dir, 'manifest.json').products, 6);
  assert.ok(!read(dir, 'arama.json').items.some(row => row[0] === 'vgm-100150'));
  // vgm-100006'nın related'ı silinen ürünü gösteriyordu: temizlendi; kategoride başka ürün yok -> boş
  assert.deepEqual(read(dir, 'urun/1000.json').products['vgm-100006'].related, []);
  // kategori boşalırsa liste dosyası kalkar, sayı 0 olur
  r = cli(writer, ['--dizin', dir, '--sil', 'vgm-100004,vgm-100005']);
  assert.equal(r.status, 0, r.err);
  assert.ok(!K.listFiles(dir).includes('liste/alt-b.json'));
  assert.deepEqual(read(dir, 'kategoriler.json').categories.map(c => [c.id, c.count]), [['ust', 3], ['alt-a', 3], ['alt-b', 0], ['tek', 1]]);
  // değiştirme: aynı kimlik, yeni ad; kategori değişimi liste dosyalarını taşır
  r = cli(writer, ['--dizin', dir, '--ekle', jsonl('degis.jsonl', [{ ...products[0], name: 'Zeta Marka Yeni Adlı Sentetik Ürün', category: 'alt-b' }])]);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /değişen 1/);
  assert.deepEqual(read(dir, 'liste/alt-b.json').items.map(c => [c.id, c.name]), [['vgm-100001', 'Zeta Marka Yeni Adlı Sentetik Ürün']]);
  assert.ok(!read(dir, 'liste/alt-a.json').items.some(c => c.id === 'vgm-100001'));
  // silinecek ürün yoksa hata, hiçbir şey yazılmaz
  const before = snapshot(dir);
  r = cli(writer, ['--dizin', dir, '--sil', 'vgm-123456']);
  assert.equal(r.status, 1); assert.match(r.err, /katalogda olmayan ürün vgm-123456/);
  assert.deepEqual(snapshot(dir), before);
  assert.deepEqual(validateDir(dir, { media: NO_MEDIA }).errors, []);
});

test('yazıcı: yeni ürün kimliği 6 haneli (vgm-100000+); doğrulama hatası ya da --deneme hiçbir dosyayı değiştirmez', () => {
  const { dir, products } = seedDir();
  const before = snapshot(dir);
  let r = cli(writer, ['--dizin', dir, '--ekle', jsonl('dort-hane.jsonl', [gen.product('vgm-0500', 'tek', 500)])]);
  assert.equal(r.status, 1);
  assert.match(r.err, /--ekle vgm-0500: yeni ürün kimliği vgm-100000 ve üstü 6 haneli olmalı/);
  r = cli(writer, ['--dizin', dir, '--ekle', jsonl('kotu.jsonl', [{ ...gen.product('vgm-100200', 'ust', 200), summary: 'kısa' }])]);
  assert.equal(r.status, 1);
  assert.match(r.err, /alt kategorisi olan ust/); assert.match(r.err, /summary 30–160/); assert.match(r.err, /hiçbir dosya yazılmadı/);
  r = cli(writer, ['--dizin', dir, '--ekle', jsonl('ayni-slug.jsonl', [gen.product('vgm-100300', 'tek', 300, { slug: products[0].slug })])]);
  assert.equal(r.status, 1); assert.match(r.err, /tekrarlanan slug/);
  // izin listesi: tedarikçi adresi / maliyet gibi bilinmeyen alanlar (ürün, görsel, belge) reddedilir, hiçbir şey yazılmaz
  const leaky = gen.product('vgm-100400', 'tek', 400);
  r = cli(writer, ['--dizin', dir, '--ekle', jsonl('sizinti.jsonl', [{ ...leaky, supplierUrl: 'https://tedarikci.example/x', cost: 12.3,
    images: leaky.images.map(im => ({ ...im, origin: 'x' })), documents: [{ title: 'Veri sayfası', url: 'https://uretici.example/a.pdf', costNote: 'y' }] }])]);
  assert.equal(r.status, 1);
  assert.match(r.err, /bilinmeyen alan\(lar\): cost, supplierUrl/); assert.match(r.err, /images\[0\]: bilinmeyen alan\(lar\): origin/);
  assert.match(r.err, /documents\[0\]: bilinmeyen alan\(lar\): costNote/);
  assert.deepEqual(snapshot(dir), before);
  // savunma derinliği: kanonik biçim bilinmeyen alanları düşürür
  assert.deepEqual(Object.keys(K.canonicalProduct({ ...leaky, cost: 1 })).includes('cost'), false);
  r = cli(writer, ['--dizin', dir, '--deneme', '--sil', 'vgm-100001']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Deneme: 6 ürün.*hiçbir şey yazılmadı/);
  r = cli(writer, ['--dizin', dir, '--bilinmeyen']);
  assert.equal(r.status, 2);
  assert.deepEqual(snapshot(dir), before);
  // mevcut 4 haneli kimlikler korunur ve güncellenebilir (gerçek katalog)
  const real = fs.mkdtempSync(path.join(scratch, 'gercek-'));
  for (const rel of K.listFiles(K.DEFAULT_DIR)) { fs.mkdirSync(path.dirname(path.join(real, rel)), { recursive: true }); fs.copyFileSync(path.join(K.DEFAULT_DIR, rel), path.join(real, rel)); }
  const p = K.loadDir(real).products.find(x => x.id === 'vgm-0101');
  r = cli(writer, ['--dizin', real, '--ekle', jsonl('gercek.jsonl', [{ ...p, maxQty: 40 }])]);
  assert.equal(r.status, 0, r.err);
  assert.equal(read(real, 'urun/0001.json').products['vgm-0101'].maxQty, 40);
});

/* ------------------------------------------------------------------------------------------------ arama dizini, attr, adet kuralları */

test('arama dizini: model biçimleri, kategori yolu, seri/spec değerleri, sentetik tokenler ve eş anlamlılar (belirlenimli)', () => {
  const cats = [gen.category('koruma', 'Sigorta ve Koruma Cihazları', 10), gen.category('otomat', 'Otomatik Sigortalar', 11, 'koruma'),
    gen.category('kablolar', 'Kablolar', 20)];
  const mcb = gen.product('vgm-100001', 'otomat', 1, { name: 'Örnek Acti9 iC60N 1 Kutuplu 16A C Eğrisi Otomatik Sigorta', brand: 'Örnek Elektrik',
    mpn: '5SV5344-6', gtin: '3606480079474',
    specs: [['Seri', 'Acti9 iC60N'], ['Kutup sayısı', '1P'], ['Anma akımı', '16 A'], ['Açma eğrisi', 'C'], ['Kesme kapasitesi', '6 kA (IEC 60898-1)'], ['Montaj', 'DIN ray']] });
  const cable = gen.product('vgm-100002', 'kablolar', 2, { name: 'Örnek NYM 3x2,5 mm² Antigron Bina İçi Kablo', mpn: 'NYM 3x2,5', unit: 'metre',
    specs: [['Kablo tipi', 'NYM (NVV, Antigron)'], ['Damar sayısı ve kesit', '3 x 2,5 mm²'], ['Satış birimi', 'Metre']] });
  const inv = gen.product('vgm-100003', 'kablolar', 3, { name: 'Örnek X3 10 kW Hibrit İnverter', mpn: 'X3-10.0-H',
    specs: [['Faz', 'Trifaze, 400 V'], ['Nominal AC güç', '10 kW'], ['Inverter tipi', 'Hibrit']] });
  const files = K.buildFiles(K.normalize({ categories: cats, products: [mcb, cable, inv] }));
  const rows = JSON.parse(files.get('arama.json')).items;
  const row = id => rows.find(r => r[0] === id);
  const hit = q => rows.filter(r => q.split(' ').every(t => r[1].includes(t))).map(r => r[0]);
  // satır biçimi: [id, metin, kategori, anahtarlar, adUzunluğu]; metin ad ile başlar
  const r1 = row('vgm-100001');
  assert.equal(r1.length, 5);
  assert.equal(r1[2], 'otomat');
  assert.equal(r1[1].slice(0, r1[4]), K.fold(mcb.name));
  assert.equal(r1[3], '5sv5344-6 5sv53446 5sv5344 6 3606480079474', 'tam eşleşme anahtarları: model biçimleri + GTIN');
  // canlı bulgular (ux-backlog P1-04): 5SV53446, "1P 16A", "ic60n c16", "sigorta" artık eşleşir
  assert.deepEqual(hit('5sv53446'), ['vgm-100001']);
  assert.deepEqual(hit('1p 16a'), ['vgm-100001']);
  assert.deepEqual(hit('ic60n c16'), ['vgm-100001']);
  assert.deepEqual(hit('6ka'), ['vgm-100001']);
  assert.deepEqual(hit('otomat'), ['vgm-100001'], 'eş anlamlı: otomatik sigorta -> otomat/mcb');
  assert.deepEqual(hit('mcb'), ['vgm-100001']);
  assert.deepEqual(hit('koruma cihazlari'), ['vgm-100001'], 'üst kategori adı dizinde');
  assert.deepEqual(hit('3x2.5'), ['vgm-100002']); assert.deepEqual(hit('3x2,5'), ['vgm-100002']);
  assert.deepEqual(hit('nym 2.5'), ['vgm-100002']);
  assert.deepEqual(hit('trifaze 10kw'), ['vgm-100003']); assert.deepEqual(hit('3 faz evirici'), ['vgm-100003'], 'eş anlamlı: inverter -> evirici');
  assert.deepEqual(hit('x3100h'), ['vgm-100003'], 'nokta ve tire soyulmuş model');
  assert.deepEqual(hit('kutup'), ['vgm-100001'], 'spec etiketi değil değeri dizinlenir; "kutuplu" ad içinde');
  // tekrar yok, belirlenimli
  const toks = r1[1].split(' ');
  assert.equal(toks.filter(t => t === '16a').length, 1, 'aynı token iki kez yazılmaz');
  assert.equal(toks.filter(t => t === 'mcb').length, 1, 'eş anlamlılar bir kez yazılır');
  assert.ok(!/\botomatik sigorta\b.*\botomatik sigorta\b/.test(r1[1]), 'metinde geçen eş anlamlı yeniden yazılmaz');
  assert.deepEqual(JSON.parse(K.buildFiles(K.normalize({ categories: cats, products: [inv, cable, mcb] })).get('arama.json')).items, rows, 'girdi sırası sonucu değiştirmez');
  // yardımcılar
  assert.deepEqual(K.mpnVariants('A9F74116'), ['a9f74116']);
  assert.deepEqual(K.mpnVariants('P3-10.0-SH'), ['p3-10.0-sh', 'p3100sh', 'p3 10 0 sh']);
  assert.deepEqual(K.synonymsFor('acti9 kacak akim rolesi'), ['rccb', 'fi', 'kacak akim koruma']);
  assert.deepEqual(K.synonymsFor('fiyat'), [], 'yalnızca sözcük sınırında ("fi" içeren sözcük tetiklemez)');
});

test('attr çıkarımı: specs -> poles/amps/curve/ka/section/phase/kw (belirlenimli, çözülemeyen alan yazılmaz)', () => {
  const { extractAttr } = require('../magaza/katalog-dogrula.cjs');
  assert.deepEqual(extractAttr([['Kutup sayısı', '1P'], ['Anma akımı', '16 A'], ['Açma eğrisi', 'C'], ['Kesme kapasitesi', '6 kA (IEC 60898-1)']]),
    { poles: '1P', amps: 16, curve: 'C', ka: 6 });
  assert.deepEqual(extractAttr([['Kutup sayısı', '4P (3 faz + nötr)'], ['Anma akımı', '63 A'], ['Anma kaçak akım hassasiyeti', '30 mA']]), { poles: '4P', amps: 63 });
  assert.deepEqual(extractAttr([['Kutup yapısı', '3P+N (4 kutup)'], ['Yapı', '1P+N']]), { poles: '3P+N' }, 'ilk eşleşen spec kazanır');
  assert.deepEqual(extractAttr([['Kutup sayısı', '3 kutuplu'], ['Koruma karakteristiği', 'C tipi'], ['Kesme kapasitesi (415 V AC)', '36 kA']]), { poles: '3P', curve: 'C', ka: 36 });
  assert.deepEqual(extractAttr([['Damar sayısı ve kesit', '3 x 2,5 mm²']]), { section: '3x2.5' });
  assert.deepEqual(extractAttr([['Kesit', '1 x 4 mm²']]), { section: '1x4' });
  assert.deepEqual(extractAttr([['Kablo kesiti', '4-6 mm²']]), {}, 'aralık kesit değil');
  assert.deepEqual(extractAttr([['Faz', 'Trifaze, 400 V'], ['Nominal AC çıkış gücü', '10 kW']]), { phase: 3, kw: 10 });
  assert.deepEqual(extractAttr([['Faz sayısı', '3'], ['Anma gücü', '22 kW (üç faz)']]), { phase: 3, kw: 22 });
  assert.deepEqual(extractAttr([['Besleme', 'Üç faz, 400 V AC'], ['Anma gücü', '600 W']]), { phase: 3 }, 'W değeri kW süzgecine girmez');
  assert.deepEqual(extractAttr([['Kapasite', '105 Ah'], ['Anma akımı', '100 Ah']]), {}, 'Ah akım değil');
  assert.deepEqual(extractAttr([['Anma akımı', '12,5 A']]), { amps: 12.5 });
  assert.deepEqual(extractAttr(null), {});
  assert.deepEqual(K.attrTokens({ poles: '3P+N', amps: 16, curve: 'C', ka: 6, section: '3x2.5', phase: 3, kw: 10 }),
    ['3p+n', '3pn', '16a', 'c16', '6ka', '3x2.5', '3x2,5', 'trifaze', '3 faz', 'uc fazli', '10kw', '10 kw']);
  // gerçek katalog: sigorta kartları attr taşır, kablo kartları section taşır, attr'siz kart attr anahtarı yazmaz
  // (kartlar ürünün kendi yaprak kategorisinin liste dosyasında; toplu içe aktarmadan sonra ağaç değişebilir)
  const real = K.loadDir(K.DEFAULT_DIR);
  const catOf = Object.fromEntries(real.products.map(p => [p.id, p.category]));
  const cardOf = id => JSON.parse(fs.readFileSync(path.join(K.DEFAULT_DIR, 'liste', catOf[id] + '.json'), 'utf8')).items.find(c => c.id === id);
  assert.deepEqual(cardOf('vgm-0602').attr, { poles: '1P', amps: 16, curve: 'C', ka: 6 });
  assert.deepEqual(cardOf('vgm-0604').attr, { poles: '4P', amps: 40 });
  assert.deepEqual(cardOf('vgm-1003').attr, { section: '3x2.5' });
  const noAttr = real.products.find(p => p.category === 'gunes-panelleri' || p.category === 'monokristal-paneller');
  if (noAttr) assert.ok(!('attr' in cardOf(noAttr.id)));
  const withAttr = cardOf('vgm-0602');
  assert.deepEqual(Object.keys(withAttr).slice(-2), ['sortTry', 'attr'], 'anahtar sırası: ... maxQty, [minQty, step, packQty,] sortTry, attr');
  const files = K.buildFiles({ categories: real.categories, products: real.products.filter(p => p.category === catOf['vgm-0602']) });
  assert.deepEqual(JSON.parse(files.get('liste/' + catOf['vgm-0602'] + '.json')).items.find(c => c.id === 'vgm-0602'), withAttr, 'diskteki kart yazıcı çıktısıyla aynı');
});

test('kategori filters tanımı ve ürün minQty/step/packQty: doğrulama, kanonik biçim ve kartlara aktarım', () => {
  const filters = [{ key: 'poles', label: 'Kutup', type: 'enum' }, { key: 'amps', label: 'Anma akımı', type: 'number', unit: 'A' }];
  const cats = [gen.category('ust', 'Üst', 10), { ...gen.category('alt', 'Alt', 11, 'ust'), filters }];
  const ok = gen.product('vgm-100001', 'alt', 1, { minQty: 100, step: 50, packQty: 100, unit: 'metre', maxQty: 500 });
  const m = (products, categories = cats) => validate({ categories, products }, { media: NO_MEDIA }).join('\n');
  assert.equal(m([ok]), '');
  const bad = (over, re) => assert.match(m([{ ...ok, ...over }]), re, JSON.stringify(over));
  bad({ minQty: 0 }, /minQty 1–maxQty/); bad({ minQty: 501 }, /minQty 1–maxQty/); bad({ minQty: 1.5 }, /minQty 1–maxQty/);
  bad({ step: 0 }, /step 1–maxQty/); bad({ step: 501 }, /step 1–maxQty/);
  bad({ minQty: 100, step: 30 }, /minQty step katı olmalı/);
  bad({ packQty: 0 }, /packQty 1–9999/); bad({ packQty: '10' }, /packQty 1–9999/);
  assert.equal(m([{ ...ok, minQty: undefined, step: undefined, packQty: undefined }]), '', 'alanlar isteğe bağlı');
  const badCat = (f, re) => assert.match(m([ok], [cats[0], { ...cats[1], filters: f }]), re, JSON.stringify(f));
  badCat('x', /filters en çok/);
  badCat([{ key: 'renk', label: 'Renk', type: 'enum' }], /filters\[0\]: key: poles, amps, curve, ka, section, phase, kw/);
  badCat([{ key: 'poles', label: 'K', type: 'enum' }], /label 2–40/);
  badCat([{ key: 'poles', label: 'Kutup', type: 'liste' }], /type enum\/number/);
  badCat([{ key: 'poles', label: 'Kutup', type: 'enum' }, { key: 'poles', label: 'Kutup 2', type: 'enum' }], /tekrarlanan key poles/);
  badCat([{ key: 'poles', label: 'Kutup', type: 'enum', renk: 1 }], /bilinmeyen alan\(lar\): renk/);
  badCat([{ key: 'amps', label: 'Akım', type: 'number', unit: '' }], /unit 1–10/);
  // kanonik biçim: filters yalnızca varsa; anahtar sırası sabit, bilinmeyen alan düşer
  assert.deepEqual(Object.keys(K.canonicalCategory(cats[0])), ['id', 'name', 'title', 'intro', 'order', 'parent']);
  assert.deepEqual(K.canonicalCategory({ ...cats[1], filters: [{ unit: 'A', type: 'number', label: 'Akım', key: 'amps', x: 1 }] }).filters, [{ key: 'amps', label: 'Akım', type: 'number', unit: 'A' }]);
  // yazıcı: kategoriler.json filters'ı taşır, kart adet kurallarını taşır, dizin yeniden okununca aynı
  const dir = fs.mkdtempSync(path.join(scratch, 'filtre-'));
  K.writeDir(dir, K.buildFiles(K.normalize({ categories: cats, products: [ok] })));
  const written = read(dir, 'kategoriler.json').categories;
  assert.deepEqual(written.find(c => c.id === 'alt').filters, filters);
  assert.ok(!('filters' in written.find(c => c.id === 'ust')));
  assert.deepEqual(Object.keys(written.find(c => c.id === 'alt')), ['id', 'name', 'title', 'intro', 'order', 'parent', 'filters', 'count']);
  const c = read(dir, 'liste/alt.json').items[0];
  assert.deepEqual([c.minQty, c.step, c.packQty, c.sortTry, c.unit], [100, 50, 100, ok.listUsd, 'metre']);
  assert.deepEqual(Object.keys(c), ['id', 'slug', 'name', 'brand', 'mpn', 'thumb', 'listUsd', 'listCheckedAt', 'shipping', 'unit', 'vat', 'maxQty', 'minQty', 'step', 'packQty', 'sortTry']);
  const p = read(dir, 'urun/1000.json').products['vgm-100001'];
  assert.deepEqual([p.minQty, p.step, p.packQty], [100, 50, 100]);
  assert.ok(Object.keys(p).indexOf('minQty') > Object.keys(p).indexOf('maxQty') && Object.keys(p).indexOf('packQty') < Object.keys(p).indexOf('listUsd'));
  assert.deepEqual(validateDir(dir, { media: NO_MEDIA }).errors, []);
  assert.deepEqual(K.loadDir(dir).categories.find(x => x.id === 'alt').filters, filters, 'yeniden okuma filters\'ı korur');
  // komut satırı aynı girdiyle hiçbir dosyayı değiştirmez
  const before = snapshot(dir);
  const r = cli(writer, ['--dizin', dir]);
  assert.equal(r.status, 0, r.err); assert.match(r.out, /0 dosya yazıldı/);
  assert.deepEqual(snapshot(dir), before);
});

/* ------------------------------------------------------------------------------------------------ gizlilik */

function trackedShopFiles() {
  let files;
  try { files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0').filter(Boolean); }
  catch (_) { return null; }
  // silinmiş (henüz kaydedilmemiş) dosyalar atlanır; katalog dizininin tamamı (parçalar dahil) denetlenir
  return [...new Set(files)].filter(f => /(^|\/)magaza|MAGAZA\.md$|^public\/magaza\//i.test(f) && !/\.(webp|png|jpe?g)$/i.test(f)
    && fs.existsSync(path.join(root, f)));
}

test('tedarikçi alan adları açık depodaki mağaza dosyalarında geçmez (katalog parçaları dahil)', t => {
  const files = trackedShopFiles();
  if (!files) { t.skip('git yok'); return; }
  assert.ok(files.some(f => f.startsWith('api/lib/magaza/katalog/urun/')), 'katalog parçaları taranır');
  // Özet listesi de açık depoya girmez (alan adları sözlükle geri çözülebilir): yalnızca yerel özel klasörde varsa denetlenir.
  const list = path.join(root, 'tools/magaza/ozel/tedarikci-ozet.json');
  if (!fs.existsSync(list)) { t.skip('özel tedarikçi listesi bu makinede yok'); return; }
  const known = new Set(JSON.parse(fs.readFileSync(list, 'utf8')).hashes);
  const hostRe = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com\.tr|net\.tr|org\.tr|gen\.tr|com|net|org|tr|shop|store)\b/gi;
  const leaks = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(hostRe)) {
      const host = m[0].toLowerCase().replace(/^www\./, '');
      const parts = host.split('.');
      for (let i = 0; i < parts.length - 1; i++) {
        const candidate = parts.slice(i).join('.');
        if (known.has(crypto.createHash('sha256').update(candidate).digest('hex'))) leaks.push(`${f}: ${candidate}`);
      }
    }
  }
  assert.deepEqual([...new Set(leaks)], [], 'tedarikçi bilgisi yalnızca sunucudaki özel veri klasöründe durmalı');
});

test('özel mağaza verisi depoya eklenmemiş (ayarlar, kaynak/fiyat parçaları, sıra ve durum dosyaları)', t => {
  let files;
  try { files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0').filter(Boolean); }
  catch (_) { t.skip('git yok'); return; }
  const forbidden = files.filter(f => /magaza/i.test(f) && !/fixtures\//.test(f)
    && (/(^|\/)(kaynaklar|fiyatlar|siparisler|gorsel-kaynaklari|panel|kur|fiyat-durum|fiyat-sira)\.json$/.test(f) || /(^|\/)(kaynak|fiyat)\/\d{4}\.json$/.test(f)));
  assert.deepEqual(forbidden, []);
});
