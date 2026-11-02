'use strict';
// Mağaza tedarikçi fiyat okuma (api/lib/magaza-kaynak.php, magaza-cron.php): sayı ayrıştırma, ayrıştırıcı yolları
// (JSON-LD, microdata, OG, platform yedekleri), SSRF reddi, kimlik doğrulama, TCMB kuru, fiyat yenileme (cron ve
// canlı kontrol) ve cron komutu. Gerçek PHP; ağ yok (VG_MAGAZA_FIXTURE_DIR sentetik sayfalar), veri geçici klasörde.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const ozel = require('./fixtures/magaza/ozel.cjs');

const root = path.resolve(__dirname, '../..');
const phpBin = process.env.VG_PHP || [path.join(root, '.qa/php/runtime/php.exe'), path.resolve(root, '../../../.qa/php/runtime/php.exe')].find(f => fs.existsSync(f)) || path.join(root, '.qa/php/runtime/php.exe');   // git worktree: ana kopyanın .qa/php'si
const fx = path.join(root, 'tools/tests/fixtures/magaza');
const kdir = path.join(fx, 'kaynak');
const runner = path.join(kdir, 'run.php');
const cronFile = path.join(root, 'api/lib/magaza-cron.php');
const libFile = path.join(root, 'api/lib/magaza-kaynak.php');

const U = 'https://tedarikci-bir.example/urun/dm-450';
const MPN = { 'vgm-9001': 'DM-450', 'vgm-9002': 'DM-INV-5K', 'vgm-9003': 'DM-C16', 'vgm-9004': 'DM-BAT-10', 'vgm-9005': 'DM-MM1' };
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const pageUrl = id => `https://tedarikci-bir.example/urun/${id}`;

function baseEnv() {
  const env = { ...process.env, VG_MAGAZA_CATALOG: path.join(fx, 'katalog'), VG_MAGAZA_FIRMA: path.join(fx, 'firma-tam.json') };
  delete env.VG_MAGAZA_FIXTURE_DIR; delete env.VG_DATA_DIR; delete env.VG_RATE_SCALE;
  return env;
}
function php(args, { input, env = baseEnv(), timeout = 90000 } = {}) {
  return spawnSync(phpBin, ['-n', ...args], { input, env, encoding: 'utf8', timeout, windowsHide: true });
}
function run(payload, env) {
  const r = php([runner], { input: JSON.stringify(payload), env });
  assert.equal(r.status, 0, `${payload.op}: ${r.stdout}${r.stderr}`);
  return JSON.parse(r.stdout);
}
const cron = (args, env) => php([cronFile, ...args], { env });

/* sentetik sayfa ve kur üreticileri */
function ld(o = {}) {
  const p = { '@context': 'https://schema.org', '@type': 'Product', name: o.name || 'Deneme Marka Ürün', mpn: o.mpn === undefined ? 'DM-450' : o.mpn };
  if (!p.mpn) delete p.mpn;
  if (o.gtin) p.gtin13 = o.gtin;
  if (o.sku) p.sku = o.sku;
  if (o.price !== undefined) {
    p.offers = { '@type': 'Offer', price: String(o.price), priceCurrency: o.currency === undefined ? 'TRY' : o.currency, availability: 'https://schema.org/' + (o.availability || 'InStock') };
    if (!p.offers.priceCurrency) delete p.offers.priceCurrency;
    if (o.availability === null) delete p.offers.availability;
  }
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><script type="application/ld+json">${JSON.stringify(p)}</script></head><body><h1>Sentetik</h1></body></html>`;
}
function tcmb(usd, eur, date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const d = typeof date === 'string' ? date : `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
  const cur = (code, v) => v === null ? '' : `<Currency CrossOrder="0" Kod="${code}" CurrencyCode="${code}"><Unit>1</Unit><Isim>${code}</Isim><ForexBuying>${v}</ForexBuying><ForexSelling>${v}</ForexSelling><BanknoteBuying/><BanknoteSelling/></Currency>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Tarih_Date Tarih="${d}" Date="x" Bulten_No="2026/1">${cur('USD', usd)}${cur('EUR', eur)}</Tarih_Date>`;
}
const cfg = (sources, extra = {}) => ({ version: 1, open: false, margin: { default: 0.15, byCategory: {}, byProduct: {} },
  shipping: { feeTry: 0, freeOverTry: 0 }, paymentHours: 24, fxBuffer: 0, sources, blockedSuppliers: [], ...extra });
const src = (url, extra = {}) => ({ url, supplier: new URL(url).host.replace(/^www\./, ''), vatIncluded: true, currency: 'TRY', priority: 1, discount: 0, ...extra });
const now = () => Math.floor(Date.now() / 1000);
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
// standard() kurulumundaki sayfa fiyatlarıyla tutarlı, önceden kabul edilmiş maliyetler (TL, KDV dahil; USD, KDV hariç; kur 40)
const COST = { 'vgm-9001': [2450.9, 51.0604], 'vgm-9002': [19198.8, 399.975], 'vgm-9003': [90, 1.875], 'vgm-9004': [88800, 1850], 'vgm-9005': [1700, 35.4167] };
// ilk kabulde katalog listUsd/1,15 ile 0,5-1,5 kat aralığına girmesi gereken sayfa fiyatları (TL, KDV dahil)
const GOOD = { 'vgm-9001': '2450.9', 'vgm-9002': '19198.8', 'vgm-9003': '100', 'vgm-9004': '88800', 'vgm-9005': '1700' };
const okItem = (id, over = {}) => ({ status: 'ok', costTry: COST[id][0], costUsd: COST[id][1], rateAtCheck: 40, checkedAt: now() - 3600, available: true,
  source: 0, method: 'jsonld', note: '', held: null, history: [], ...over });

function sandbox(t) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-kaynak-data-'));
  const pages = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-kaynak-pages-'));
  t.after(() => { fs.rmSync(data, { recursive: true, force: true }); fs.rmSync(pages, { recursive: true, force: true }); });
  const file = (url, ext) => path.join(pages, sha1(url) + '.' + ext);
  const clear = url => { for (const ext of ['html', '403', '404', '410', '429', '500', '503', 'redirect']) fs.rmSync(file(url, ext), { force: true }); };
  const env = { ...baseEnv(), VG_DATA_DIR: data, VG_MAGAZA_FIXTURE_DIR: pages };
  const sb = {
    data, pages, env,
    page(url, html) { clear(url); fs.writeFileSync(file(url, 'html'), html); },
    status(url, code) { clear(url); fs.writeFileSync(file(url, String(code)), ''); },
    redirect(url, loc) { clear(url); fs.writeFileSync(file(url, 'redirect'), loc); },
    rates(usd = 40, eur = 46, date) { fs.writeFileSync(path.join(pages, 'tcmb-today.xml'), tcmb(usd, eur, date)); },
    // magaza/ klasörüne doğrudan parçalı yapılandırma yazar (kaynaklar.json ayarlar + kaynak/<parça>.json; CLI testleri için)
    config(sources, extra) { ozel.writeConfig(data, cfg(sources, extra)); },
    refresh(payload, overrideEnv) { return run({ op: 'refresh', ...payload }, overrideEnv || env); },
  };
  return sb;
}
/* 5 ürünün de aynı sunucuda geçerli sayfası olan standart kurulum */
function standard(sb, over = {}) {
  const prices = { 'vgm-9001': '2450.90', 'vgm-9002': '15999', 'vgm-9003': '100', 'vgm-9004': '1850' };
  const sources = {
    'vgm-9001': [src(pageUrl('vgm-9001'))],
    'vgm-9002': [src(pageUrl('vgm-9002'), { vatIncluded: false })],
    'vgm-9003': [src(pageUrl('vgm-9003'), { discount: 0.1 })],
    'vgm-9004': [src(pageUrl('vgm-9004'), { currency: 'USD', vatIncluded: false })],
    'vgm-9005': [src(pageUrl('vgm-9005'))],
  };
  for (const id of Object.keys(prices)) sb.page(pageUrl(id), ld({ mpn: MPN[id], price: prices[id], currency: id === 'vgm-9004' ? 'USD' : 'TRY' }));
  sb.status(pageUrl('vgm-9005'), 404);
  sb.rates(40, 46);
  return { sources, config: cfg(sources, over.config), ...over };
}

/* ------------------------------------------------------------------------------------------------ sayılar */

test('sayı ayrıştırma: Türkçe ekran metni, makine değeri, belirsiz ve geçersiz girdiler', () => {
  const rows = [
    // ekran metni (Türkçe kurallar)
    ['1.234,56 TL', false, 1234.56], ['₺1.234,56', false, 1234.56], ['12.345 TL', false, 12345], ['1,234.56 $', false, 1234.56],
    ['1 234,56 TL', false, 1234.56], ['1.250,00 TL +KDV', false, 1250], ['12 345,60', false, 12345.6], ['99.90 TL', false, 99.9],
    ['0,125', false, 0.125], ['1.234.567,89', false, 1234567.89], ['1.234', false, 1234], ['1,5', false, 1.5], ['TL 450', false, 450],
    ['€ 1.299,00', false, 1299], ['12.345,5', false, 12345.5], ['.99', false, 0.99], ['1.250 TL', false, 1250], ['1 234 567', false, 1234567],
    // makine değeri (nokta ondalık; "1.234,56" da tolere edilir)
    ['2450.90', true, 2450.9], ['12.345', true, 12.345], ['1.234,56', true, 1234.56], ['1234,56', true, 1234.56], ['1,234.56', true, 1234.56],
    ['1e3', true, 1000], ['  64.5  ', true, 64.5], ['8750', true, 8750], ['0.5', true, 0.5],
    // belirsiz / geçersiz
    ['1,234', false, null], ['1,234', true, null], ['-5', false, null], ['-5', true, null], ['0', true, null], ['0,00', false, null],
    ['abc', false, null], ['', false, null], ['   ', false, null], ['NaN', true, null], ['1e999', true, null], ['2.000.000.000', false, null],
    ['1.2.3', false, null], ['1.234,567,89', false, null], ['1.5.000', false, null],
  ];
  const got = run({ op: 'number', cases: rows.map(r => [r[0], r[1]]) });
  rows.forEach((r, i) => assert.equal(got[i], r[2], `${JSON.stringify(r[0])} (${r[1] ? 'makine' : 'ekran'})`));
});

test('para birimi, stok durumu ve IP engelleme tabloları', () => {
  const cur = run({ op: 'currency', values: ['TRY', 'TL', '₺', 'try', 'TRL', 'USD', '$', 'EUR', '€', null, '', 'GBP', 'XYZ'] });
  assert.deepEqual(cur, ['TRY', 'TRY', 'TRY', 'TRY', 'TRY', 'USD', 'USD', 'EUR', 'EUR', null, null, false, false]);
  const av = run({ op: 'availability', values: ['https://schema.org/InStock', 'http://schema.org/InStock', 'InStock', 'schema:InStock', 'LimitedAvailability',
    'OnlineOnly', 'OutOfStock', 'SoldOut', 'Discontinued', 'PreOrder', 'BackOrder', 'InStoreOnly', 'PreSale', '', 'Stokta var', 'foo', null] });
  assert.deepEqual(av, [true, true, true, true, true, true, false, false, false, false, false, false, false, null, null, null, null]);
  const blocked = ['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.10', '172.16.5.5', '172.31.255.255', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '240.0.0.1', '255.255.255.255', '192.0.2.5', '::1', '::', 'fe80::1', 'fd12:3456::1', '::ffff:127.0.0.1', '64:ff9b::1', '2001:db8::1', 'not-an-ip', '', '999.1.1.1'];
  const allowed = ['8.8.8.8', '93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '172.32.0.1', '100.128.0.1'];
  const res = run({ op: 'ip', ips: [...blocked, ...allowed] });
  blocked.forEach((ip, i) => assert.equal(res[i], true, `${ip} engellenmeli`));
  allowed.forEach((ip, i) => assert.equal(res[blocked.length + i], false, `${ip} serbest olmalı`));
});

/* ------------------------------------------------------------------------------------------------ ayrıştırıcı */

test('ayrıştırıcı: örnek sayfalar (JSON-LD, microdata, OG, platform) beklenen teklifi verir', () => {
  const F = (file, extra = {}) => ({ file: path.join(kdir, file), ...extra });
  const cases = [
    [F('jsonld-offer.html'), { ok: true, price: 2450.9, currency: 'TRY', available: true, method: 'jsonld', brand: 'Deneme Marka', mpn: 'DM-450',
      sku: 'TB-00450', gtin: '4006381333931', image: 'https://tedarikci-bir.example/img/dm-450.jpg', candidates: [2450.9] }],
    [F('jsonld-graph.html'), { ok: true, price: 15999, currency: 'TRY', available: true, method: 'jsonld', mpn: 'DM-INV-5K', brand: 'Deneme Marka' }],
    [F('jsonld-aggregate-equal.html'), { ok: true, price: 64.5, currency: 'TRY', available: null, method: 'jsonld' }],
    [F('jsonld-aggregate-single.html'), { ok: true, price: 350, currency: 'TRY', method: 'jsonld' }],
    [F('jsonld-aggregate-range.html'), { ok: false, price: null, error: 'ambiguous_price', candidates: [100, 250], method: 'jsonld' }],
    [F('jsonld-offers-conflict.html'), { ok: false, error: 'ambiguous_price', candidates: [120, 150], method: 'jsonld' }],
    [F('jsonld-oos.html'), { ok: true, price: 41, available: false, method: 'jsonld' }],
    [F('jsonld-broken.html'), { ok: true, price: 89.9, available: true, method: 'jsonld', mpn: 'DM-C16' }],
    [F('jsonld-entities.html'), { ok: true, price: 3.2, currency: 'TRY', name: 'Deneme & Marka Kablo 3x2,5' }],
    [F('jsonld-pricespec.html'), { ok: true, price: 1299, currency: 'TRY', method: 'jsonld' }],
    [F('jsonld-two-products.html'), { ok: true, price: 2450.9, mpn: 'DM-450', method: 'jsonld' }],
    [F('jsonld-two-products.html', { url: 'https://tedarikci-bir.example/baska-sayfa' }), { ok: false, error: 'ambiguous_price', candidates: [999, 2450.9] }],
    [F('jsonld-offer-ref.html'), { ok: true, price: 72.4, available: true, method: 'jsonld' }],
    [F('microdata.html'), { ok: true, price: 64.5, currency: 'TRY', available: true, method: 'microdata', mpn: 'DM-C16', gtin: '4006381333931' }],
    [F('microdata-text.html'), { ok: true, price: 1234.5, currency: 'TRY', available: false, method: 'microdata' }],
    [F('microdata-two-prices.html'), { ok: false, error: 'ambiguous_price', candidates: [64.5, 99], method: 'microdata' }],
    [F('microdata-strikethrough.html'), { ok: true, price: 418.17, currency: 'TRY', available: true, method: 'microdata', candidates: [418.17] }],
    [F('og-meta.html'), { ok: true, price: 410, currency: 'TRY', method: 'og', image: 'https://tedarikci-bir.example/img/dm-mm1.jpg' }],
    [F('woocommerce.html'), { ok: true, price: 1099, currency: 'TRY', method: 'platform:woocommerce' }],
    [F('woocommerce-range.html'), { ok: false, error: 'ambiguous_price', candidates: [100, 250], method: 'platform:woocommerce' }],
    [F('opencart.html'), { ok: true, price: 2350, currency: 'TRY', method: 'platform:opencart' }],
    [F('opencart-h2.html'), { ok: true, price: 122, currency: 'USD', method: 'platform:opencart' }],
    [F('ticimax.html'), { ok: true, price: 875.5, currency: 'TRY', method: 'platform:ticimax' }],
    [F('ideasoft.html'), { ok: true, price: 1020, currency: 'TRY', method: 'platform:ideasoft' }],
    [F('tsoft.html'), { ok: true, price: 4100, currency: null, method: 'platform:tsoft' }],
    [F('platform-ambiguous.html'), { ok: false, error: 'ambiguous_price', candidates: [875.5, 1250], method: 'platform:ticimax' }],
    [F('noise.html'), { ok: true, price: 77.7, method: 'microdata' }],
    [F('no-price.html'), { ok: false, price: null, error: 'no_price', method: null, candidates: [] }],
  ];
  const got = run({ op: 'parse_many', items: cases.map(c => c[0]) });
  cases.forEach((c, i) => {
    for (const [key, want] of Object.entries(c[1])) assert.deepEqual(got[i][key], want, `${path.basename(c[0].file)} -> ${key}`);
  });
});

test('ayrıştırıcı: öncelik sırası, bozuk veri, para birimi, kodlama ve boyut sınırı', t => {
  const wrap = (head, body = '<h1>x</h1>') => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
  const ldTag = o => `<script type="application/ld+json">${typeof o === 'string' ? o : JSON.stringify(o)}</script>`;
  const product = offers => ({ '@context': 'https://schema.org', '@type': 'Product', name: 'X', ...(offers ? { offers } : {}) });
  const micro = (price, cur = 'TRY') => `<div itemscope itemtype="https://schema.org/Product"><div itemprop="offers" itemscope><meta itemprop="priceCurrency" content="${cur}"><meta itemprop="price" content="${price}"></div></div>`;
  const og = price => `<meta property="product:price:amount" content="${price}"><meta property="product:price:currency" content="TRY">`;
  const items = [
    // 0: JSON-LD, microdata ve OG çelişse de JSON-LD kazanır
    { html: wrap(ldTag(product({ '@type': 'Offer', price: '10.00', priceCurrency: 'TRY' })) + og('20.00'), micro('30.00') + '<p class="price">999,00 TL</p>') },
    // 1: Product var ama fiyatı yok -> microdata'ya düşer
    { html: wrap(ldTag(product(null)), micro('30.00')) },
    // 2: ürünün kendi teklifi açıkça 0 -> no_price; OG/platform yedeğine (başka bir fiyata) DÜŞMEZ
    { html: wrap(ldTag(product({ '@type': 'Offer', price: '0', priceCurrency: 'TRY' })) + og('20.00')) },
    // 3: USD
    { html: wrap(ldTag(product({ '@type': 'Offer', price: '640.00', priceCurrency: 'USD' }))) },
    // 4: desteklenmeyen para birimi
    { html: wrap(ldTag(product({ '@type': 'Offer', price: '640.00', priceCurrency: 'GBP' }))) },
    // 5: sondaki virgül onarılır
    { html: wrap('<script type="application/ld+json">{"@type":"Product","offers":{"price":"5.50","priceCurrency":"TRY",},}</script>') },
    // 6: schema: ön eki, makine değerinde Türkçe biçim
    { html: wrap(ldTag({ '@type': 'schema:Product', offers: { '@type': 'schema:Offer', price: '1.234,56', priceCurrency: 'TL' } })) },
    // 7: PreOrder -> stok yok
    { html: wrap(ldTag(product({ '@type': 'Offer', price: '9.90', priceCurrency: 'TRY', availability: 'https://schema.org/PreOrder' }))) },
    // 8: AggregateOffer içinde çelişen iç teklifler
    { html: wrap(ldTag(product({ '@type': 'AggregateOffer', offers: [{ '@type': 'Offer', price: '10' }, { '@type': 'Offer', price: '12' }] }))) },
    // 9: AggregateOffer yalnızca lowPrice (aralık belirsiz)
    { html: wrap(ldTag(product({ '@type': 'AggregateOffer', lowPrice: '10', offerCount: 2 }))) },
    // 10: boş sayfa
    { html: '   \n ' },
    // 11: iç içe teklif listesi + farklı para birimi çelişkisi
    { html: wrap(ldTag(product([{ '@type': 'Offer', price: '10', priceCurrency: 'TRY' }, { '@type': 'Offer', price: '10', priceCurrency: 'USD' }]))) },
    // 12: ortak para birimi iç tekliflere kalıtılır
    { html: wrap(ldTag(product({ '@type': 'AggregateOffer', priceCurrency: 'EUR', offers: [{ '@type': 'Offer', price: '7.5' }] }))) },
    // 13: ürün olmayan JSON-LD (kurum) ve gövde fiyatı -> fiyat yok
    { html: wrap(ldTag({ '@context': 'https://schema.org', '@type': 'Organization', name: 'X', offers: { price: '5' } }), '<p class="price">12,00 TL</p>') },
    // 14: gizli HTML yorumundaki fiyat sayılmaz
    { html: wrap('<!-- ' + og('1.00') + ' -->' + og('2.00')) },
  ];
  const r = run({ op: 'parse_many', items });
  assert.equal(r[0].price, 10); assert.equal(r[0].method, 'jsonld');
  assert.equal(r[1].price, 30); assert.equal(r[1].method, 'microdata');
  assert.equal(r[2].ok, false); assert.equal(r[2].error, 'no_price'); assert.equal(r[2].price, null); assert.equal(r[2].method, 'jsonld');
  assert.equal(r[3].currency, 'USD'); assert.equal(r[3].price, 640);
  assert.equal(r[4].ok, false); assert.equal(r[4].error, 'unsupported_currency');
  assert.equal(r[5].ok, true); assert.equal(r[5].price, 5.5);
  assert.equal(r[6].price, 1234.56); assert.equal(r[6].currency, 'TRY');
  assert.equal(r[7].ok, true); assert.equal(r[7].available, false);
  assert.equal(r[8].error, 'ambiguous_price'); assert.deepEqual(r[8].candidates, [10, 12]);
  assert.equal(r[9].error, 'ambiguous_price');
  assert.equal(r[10].ok, false); assert.equal(r[10].error, 'empty_page');
  assert.equal(r[11].error, 'ambiguous_price');
  assert.equal(r[12].price, 7.5); assert.equal(r[12].currency, 'EUR');
  assert.equal(r[13].ok, false); assert.equal(r[13].error, 'no_price');
  assert.equal(r[14].price, 2);

  // Windows-1254 (eski Türkçe siteler): bayt dizisi UTF-8 değil, yine de fiyat ve ad doğru okunur
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-kaynak-enc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cp1254 = { 'ü': 0xFC, 'ş': 0xFE, 'ğ': 0xF0, 'ı': 0xFD, 'İ': 0xDD, 'ç': 0xE7, 'ö': 0xF6, 'Ş': 0xDE };
  const text = `<html><head>${ldTag({ '@type': 'Product', name: 'Güneş Paneli İnverter', offers: { '@type': 'Offer', price: '99.90', priceCurrency: 'TRY' } })}</head></html>`;
  const bytes = Buffer.from([...text].map(ch => ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : cp1254[ch]));
  const legacy = path.join(dir, 'eski.html');
  fs.writeFileSync(legacy, bytes);
  assert.equal(bytes.includes(0xFE), true);
  const enc = run({ op: 'parse', file: legacy });
  assert.equal(enc.ok, true); assert.equal(enc.price, 99.9); assert.equal(enc.name, 'Güneş Paneli İnverter');

  // 8 MiB sınırı: 2-3 MiB'lik (mega menülü) sayfanın SONUNDAKİ JSON-LD ve ana fiyat bloğu okunur; 8 MiB sonrası okunmaz
  const filler = '<div>dolgu dolgu dolgu</div>'.repeat(90000);                       // ~2,5 MiB
  const bigPage = path.join(dir, 'buyuk.html');
  fs.writeFileSync(bigPage, wrap('', filler + ldTag(product({ '@type': 'Offer', price: '15', priceCurrency: 'TRY' }))));
  assert.ok(fs.statSync(bigPage).size > 2.2 * 1024 * 1024);
  const late = run({ op: 'parse', file: bigPage });
  assert.equal(late.ok, true, late.error); assert.equal(late.price, 15); assert.equal(late.method, 'jsonld');
  const hugePage = path.join(dir, 'dev.html');
  fs.writeFileSync(hugePage, wrap('', filler.repeat(4) + ldTag(product({ '@type': 'Offer', price: '15', priceCurrency: 'TRY' }))));
  assert.ok(fs.statSync(hugePage).size > 8 * 1024 * 1024);
  const cut = run({ op: 'parse', file: hugePage });
  assert.equal(cut.ok, false); assert.equal(cut.error, 'no_price');
});

test('ayrıştırıcı: kalibrasyonda bulunan hata türleri yanlış fiyat yerine belirli hata kodu verir', t => {
  const F = (file, extra = {}) => ({ file: path.join(kdir, file), ...extra });
  const cases = [
    // 1) ürünün kendi fiyatı 0 (JSON-LD teklifi 0.00, gizli fiyat alanı 0,00, ana fiyat 0,00): ilgili ürün kartlarının fiyatına düşülmez
    [F('zero-price-cards.html'), { ok: false, price: null, error: 'no_price', method: 'jsonld', candidates: [], sku: 'VK 90442029' }],
    // 1b) yapısal veri yok, ana fiyat öğesi boş ve gizli alan 0: platform yedeği kart fiyatını (1.025,62 / 1.080,00) döndürmez
    [F('zero-price-platform.html'), { ok: false, price: null, error: 'no_price' }],
    // 2) "N adet ve katlarıyla" metni + adet girdisi data-minimum: birim fiyat okunur ama min_quantity (minQty=305)
    [F('min-qty-text.html'), { ok: false, price: 23.45, error: 'min_quantity', minQty: 305, method: 'jsonld' }],
    // 2b) adet girdisi paket katı (data-market-price="500" / value=500)
    [F('min-qty-input.html'), { ok: false, price: 0.38, error: 'min_quantity', minQty: 500, method: 'microdata', sku: '517008' }],
    // 2c) fiyatı değiştiren seçenek listesi (metre); sıralama listesi seçenek sayılmaz
    [F('options-select.html'), { ok: false, price: 1140, error: 'price_options', method: 'og', image: 'https://tedarikci-bir.example/Resimler/Urunler/u7872.jpg' }],
    // 2d) yalnız renk sıcaklığı seçimi fiyatı değiştirmez
    [F('options-colour.html'), { ok: true, price: 116.6, error: '', vatIncluded: true }],
    // 3) KDV dahil mağazada "TL + KDV" etiketli net fiyat: vatIncluded=false bayrağıyla döner (vgm_fetch_offer reddeder)
    [F('vat-net-label.html'), { ok: true, price: 1.64, vatIncluded: false, available: false, method: 'jsonld' }],
    // 3b) aynı ürünün "+ KDV" ve "(KDV Dahil)" iki fiyatı (oran 1,20): KDV dahil olan alınır
    [F('vat-two-prices.html'), { ok: true, price: 21686.4, vatIncluded: true, candidates: [21686.4], method: 'platform:ticimax' }],
    // 3c) görünür etiket yok, platform verisinde kdvDahil=false
    [F('vat-flag-json.html'), { ok: true, price: 6102, vatIncluded: false }],
    // 4) açıklamaya yapıştırılmış ikinci (eski) Product JSON-LD platformun teklifini ezemez: varyant verisiyle tutan 1254.83
    [F('jsonld-pasted-second.html'), { ok: true, price: 1254.83, method: 'jsonld', mpn: '8690000000017', sku: 'PD304017', candidates: [1254.83] }],
    // 4b) iki Product JSON-LD çelişir, hiçbiri açıkça sayfanın kendisi değil: ambiguous_price
    [F('jsonld-pasted-ambiguous.html'), { ok: false, error: 'ambiguous_price', candidates: [935.28, 1254.83] }],
    // 6) indirimli platform sayfası: üstü çizili liste fiyatı (product-price-old) hiç okunmaz, yalnız indirimli fiyat
    [F('ideasoft-discount.html'), { ok: true, price: 35552.29, currency: 'TRY', method: 'platform:ideasoft', candidates: [35552.29] }],
    // 6b) varyant verisinde fiyatlar sayfa fiyatından farklı: price_options
    [F('variants-mismatch.html'), { ok: false, price: 80850, error: 'price_options', method: 'jsonld' }],
    // 6c) tüm varyantlar sayfa fiyatında: seçenek fiyatı değiştirmiyor
    [F('variants-same.html'), { ok: true, price: 11500, available: false, error: '' }],
    // 7) marka "false" boş sayılır; yer tutucu görsel görsel değildir (JSON-LD image ve og:image)
    [F('brand-false-placeholder.html'), { ok: true, price: 10620.63, brand: null, image: null, sku: 'KKM', vatIncluded: true }],
  ];
  const got = run({ op: 'parse_many', items: cases.map(c => c[0]) });
  cases.forEach((c, i) => {
    for (const [key, want] of Object.entries(c[1])) assert.deepEqual(got[i][key], want, `${path.basename(c[0].file)} -> ${key}`);
  });
  // 1c) aynı platform sınıfı ilgili ürün kartında da var: kart (related / product-item) okunmaz, ana fiyat alınır;
  //     kart kapsayıcısı dışında ikinci bir fiyat varsa tahmin edilmez (ambiguous_price)
  const discount = fs.readFileSync(path.join(kdir, 'ideasoft-discount.html'), 'utf8');
  const cards = discount.replace('</body>', '<div class="related"><div class="product-item"><div class="product-price"><div class="product-price-old">9.000,00 TL</div><div class="product-price-new">7.500,00 TL</div></div></div></div></body>');
  const carded = run({ op: 'parse', html: cards });
  assert.equal(carded.ok, true, carded.error); assert.equal(carded.price, 35552.29); assert.deepEqual(carded.candidates, [35552.29]);
  const loose = run({ op: 'parse', html: discount.replace('</body>', '<div class="kampanya"><div class="product-price-new">7.500,00 TL</div></div></body>') });
  assert.equal(loose.ok, false); assert.equal(loose.error, 'ambiguous_price'); assert.deepEqual(loose.candidates, [7500, 35552.29]);
  // 1d) gizli fiyat alanı da yoksa: ana fiyat öğesi boş, fiyatlı olan yalnız ilgili ürün kartları -> no_price (kart fiyatı değil)
  const noHidden = fs.readFileSync(path.join(kdir, 'zero-price-platform.html'), 'utf8').replace(/<input type="hidden"[^>]*>/g, '');
  const nh = run({ op: 'parse', html: noHidden });
  assert.equal(nh.ok, false); assert.equal(nh.error, 'no_price'); assert.equal(nh.price, null);
  // 1e) mega menü / vitrin / kaydırıcı / mini sepet içindeki kart fiyatları (aynı platform sınıfı) okunmaz; ana fiyat okunur
  const menuCard = n => `<li class="dropdown"><div class="product-thumb"><p class="price"><span class="price-new">${n},00 TL</span></p></div></li>`;
  const megaMenu = `<header><nav class="mega-menu"><ul>${[101, 202, 303].map(menuCard).join('')}</ul></nav></header>`;
  const ocMain = '<div id="content"><h1>Deneme Ürün</h1><ul class="list-unstyled"><li><span class="price-new">2.350,00 TL</span></li></ul></div>';
  const ocCarousel = '<div class="owl-carousel"><div class="item"><span class="price-new">404,00 TL</span></div></div>';
  const oc = run({ op: 'parse', html: `<html><body>${megaMenu}${ocMain}${ocCarousel}</body></html>` });
  assert.equal(oc.ok, true, oc.error); assert.equal(oc.price, 2350); assert.equal(oc.method, 'platform:opencart');
  const ocNoMain = run({ op: 'parse', html: `<html><body>${megaMenu}<div id="content"><h1>Deneme Ürün</h1></div>${ocCarousel}</body></html>` });
  assert.equal(ocNoMain.ok, false); assert.equal(ocNoMain.error, 'no_price');
  // WooCommerce: "related products" bölümündeki p.price kartı okunmaz
  const wooRelated = '<section class="related products"><ul class="products"><li class="product"><p class="price"><span class="woocommerce-Price-amount amount">555,00&nbsp;₺</span></p></li></ul></section>';
  const woo = run({ op: 'parse', html: `<html><body><div class="summary"><h1>X</h1></div>${wooRelated}</body></html>` });
  assert.equal(woo.ok, false); assert.equal(woo.error, 'no_price');
  // microdata'da "KDV hariç" / JSON-LD'de 0 fiyatlı priceSpecification da no_price
  const zeroSpec = run({ op: 'parse', html: '<html><body><div itemscope itemtype="https://schema.org/Product"><div itemprop="offers" itemscope><meta itemprop="price" content="0.00"></div></div><div class="card"><span class="product-current-price">99,00 TL</span></div></body></html>' });
  assert.equal(zeroSpec.ok, false); assert.equal(zeroSpec.error, 'no_price');

  // vgm_fetch_offer: KDV bayrağı kaynak kaydıyla çelişirse vat_mismatch; min adet ve seçenek hataları aynen geçer
  const sb = sandbox(t);
  const product = { id: 'vgm-9001', vat: 20, mpn: null, gtin: null };
  const offer = (file, srcOver = {}) => {
    sb.page(U, fs.readFileSync(path.join(kdir, file), 'utf8'));
    return run({ op: 'offer', src: src(U, srcOver), product }, sb.env);
  };
  assert.deepEqual(offer('vat-net-label.html', { vatIncluded: true }), { error: 'vat_mismatch' });
  assert.deepEqual(offer('vat-net-label.html', { vatIncluded: false }), { price: 1.64, currency: 'TRY', vatIncluded: false, discount: 0, available: false, method: 'jsonld' });
  assert.deepEqual(offer('vat-flag-json.html', { vatIncluded: true }), { error: 'vat_mismatch' });
  assert.equal(offer('vat-two-prices.html', { vatIncluded: true }).price, 21686.4);
  assert.deepEqual(offer('vat-two-prices.html', { vatIncluded: false }), { error: 'vat_mismatch' });
  assert.equal(offer('brand-false-placeholder.html', { vatIncluded: true }).price, 10620.63);    // "KDV Dahildir" + kaynak KDV dahil
  assert.deepEqual(offer('min-qty-text.html'), { error: 'min_quantity' });
  assert.deepEqual(offer('min-qty-input.html'), { error: 'min_quantity' });
  assert.deepEqual(offer('options-select.html'), { error: 'price_options' });
  assert.deepEqual(offer('variants-mismatch.html'), { error: 'price_options' });
  assert.deepEqual(offer('zero-price-cards.html'), { error: 'no_price' });
  assert.deepEqual(offer('jsonld-pasted-ambiguous.html'), { error: 'ambiguous_price' });
  assert.equal(offer('jsonld-pasted-second.html').price, 1254.83);
});

/* ------------------------------------------------------------------------------------------------ SSRF */

test('SSRF: https dışı, IP adresi, izinsiz alan adı, kimlik bilgisi, port ve yerel adlar reddedilir', () => {
  const cases = [
    ['http://tedarikci-bir.example/x', ['tedarikci-bir.example'], 'scheme_not_allowed'],
    ['ftp://tedarikci-bir.example/x', ['tedarikci-bir.example'], 'scheme_not_allowed'],
    ['https://tedarikci-bir.example/a b', ['tedarikci-bir.example'], 'scheme_not_allowed'],
    ['https://127.0.0.1/x', ['127.0.0.1'], 'blocked_address'],
    ['https://10.1.2.3/', ['10.1.2.3'], 'blocked_address'],
    ['https://169.254.169.254/latest/meta-data', ['169.254.169.254'], 'blocked_address'],
    ['https://[::1]/x', ['::1'], 'blocked_address'],
    ['https://foo.localhost/x', ['foo.localhost'], 'blocked_address'],
    ['https://ic-ag.internal/x', ['ic-ag.internal'], 'blocked_address'],
    ['https://tedarikci-bir.example/x', ['baska.example'], 'host_not_allowed'],
    ['https://tedarikci-bir.example/x', [], 'host_not_allowed'],
    ['https://127.0.0.1/x', ['tedarikci-bir.example'], 'host_not_allowed'],
    ['https://user:pw@tedarikci-bir.example/x', ['tedarikci-bir.example'], 'url_not_allowed'],
    ['https://tedarikci-bir.example:8443/x', ['tedarikci-bir.example'], 'url_not_allowed'],
    ['https://tek-etiket/x', ['tek-etiket'], 'url_not_allowed'],
    ['https://tedarikci-bir.example/' + 'a'.repeat(1100), ['tedarikci-bir.example'], 'scheme_not_allowed'],
  ];
  const results = cases.map(c => run({ op: 'check_url', url: c[0], allow: c[1] }));
  cases.forEach((c, i) => { assert.equal(results[i].why, c[2], c[0].slice(0, 60)); assert.equal(results[i].host, null); });
  // localhost: ya url_not_allowed ya blocked_address; her durumda reddedilir
  const lh = run({ op: 'check_url', url: 'https://localhost/x', allow: ['localhost'] });
  assert.match(lh.why, /^(url_not_allowed|blocked_address)$/); assert.equal(lh.host, null);
  // alan adı karşılaştırması www. farkını yok sayar; Türkçe karakterli yol kodlanır (test modu: DNS yok)
  const ok1 = run({ op: 'check_url', url: 'https://www.tedarikci-bir.example/urun?a=1', allow: ['tedarikci-bir.example'], skipDns: true });
  assert.deepEqual([ok1.why, ok1.host, ok1.path], ['', 'www.tedarikci-bir.example', '/urun?a=1']);
  const ok2 = run({ op: 'check_url', url: 'https://tedarikci-bir.example/x', allow: ['WWW.Tedarikci-Bir.example'], skipDns: true });
  assert.equal(ok2.why, '');
  const ok3 = run({ op: 'check_url', url: 'https://tedarikci-bir.example/ürün', allow: ['tedarikci-bir.example'], skipDns: true });
  assert.equal(ok3.path, '/%C3%BCr%C3%BCn');
  // IP adresi test modunda bile engellenir
  const ip = run({ op: 'check_url', url: 'https://127.0.0.1/x', allow: ['127.0.0.1'], skipDns: true });
  assert.equal(ip.why, 'blocked_address');
});

test('getirme: durum kodları, yönlendirmeler (en fazla 3, her adımda yeniden denetim) ve test modu', t => {
  const sb = sandbox(t);
  const allow = ['tedarikci-bir.example'];
  const get = url => run({ op: 'fetch', url, allow }, sb.env);
  const A = 'https://tedarikci-bir.example/a';
  sb.page(A, '<html>merhaba</html>');
  const ok = get(A);
  assert.deepEqual([ok.status, ok.why, ok.length], [200, '', 20]);
  sb.status(A, 404); assert.deepEqual(pick(get(A), ['status', 'why', 'length']), { status: 404, why: 'http_404', length: 0 });
  sb.status(A, 410); assert.equal(get(A).why, 'http_410');
  sb.status(A, 503); assert.equal(get(A).why, 'http_503');
  sb.status(A, 403); assert.equal(get(A).why, 'http_403');
  const none = get('https://tedarikci-bir.example/yok');
  assert.deepEqual([none.status, none.why], [0, 'fixture_missing']);

  const w = n => `https://www.tedarikci-bir.example/h${n}`;
  const final = '<html>son</html>';
  sb.redirect('https://tedarikci-bir.example/h0', w(1));              // www. farkı izinli
  sb.redirect(w(1), '/h2');                                            // mutlak yol
  sb.redirect(w(2), 'h3');                                             // göreli adres
  sb.page(w(3), final);
  const chain = get('https://tedarikci-bir.example/h0');
  assert.deepEqual([chain.status, chain.why, chain.length], [200, '', final.length]);        // 3 yönlendirme serbest
  sb.redirect(w(3), w(4)); sb.page(w(4), '<html>fazla</html>');
  const long = get('https://tedarikci-bir.example/h0');                                       // 4. yönlendirme reddedilir
  assert.equal(long.why, 'too_many_redirects'); assert.equal(long.length, 0);
  const loop = 'https://tedarikci-bir.example/loop'; sb.redirect(loop, loop);
  assert.equal(get(loop).why, 'too_many_redirects');
  const toOther = 'https://tedarikci-bir.example/baska'; sb.redirect(toOther, 'https://baska.example/x');
  assert.equal(get(toOther).why, 'host_not_allowed');
  const toHttp = 'https://tedarikci-bir.example/duz'; sb.redirect(toHttp, 'http://tedarikci-bir.example/x');
  assert.equal(get(toHttp).why, 'scheme_not_allowed');
  const toIp = 'https://tedarikci-bir.example/ic'; sb.redirect(toIp, 'https://127.0.0.1/x');
  assert.equal(get(toIp).why, 'host_not_allowed');
  const rel = 'https://tedarikci-bir.example/dizin/a'; sb.redirect(rel, '../b'); sb.page('https://tedarikci-bir.example/b', '<html>b</html>');
  assert.equal(get(rel).length, '<html>b</html>'.length);
  // gerçek ağ yolunda da IP adresi (test modu kapalı) DNS'siz reddedilir
  const real = run({ op: 'fetch', url: 'https://127.0.0.1/x', allow: ['127.0.0.1'] });
  assert.deepEqual([real.why, real.status, real.length], ['blocked_address', 0, 0]);
});

test('canlı bütçe: süre dolmuşsa getirme başlamaz (why=budget); kalan süre varsa normal', t => {
  const sb = sandbox(t);
  const A = 'https://tedarikci-bir.example/b'; sb.page(A, '<html>x</html>');
  const get = deadlineIn => run({ op: 'fetch', url: A, allow: ['tedarikci-bir.example'], deadlineIn }, sb.env);
  assert.deepEqual(pick(get(0.4), ['why', 'status', 'length']), { why: 'budget', status: 0, length: 0 });
  assert.equal(get(-1).why, 'budget');
  assert.deepEqual(pick(get(5), ['why', 'status']), { why: '', status: 200 });
});

test('canlı kontrol: kaynaklı ürün yoksa herkese açık istek TCMB kurunu getirmez; kaynaklıysa getirir', t => {
  const sb = sandbox(t);
  const std = standard(sb);
  const opts = { live: true, budget: 8, max: 6, spacing: 0, rates: true };
  const none = sb.refresh({ config: cfg({}), opts: { ...opts, ids: ['vgm-9001'] } });
  assert.equal(none.summary.rateUpdated, false);
  assert.equal(none.rate, null);
  const some = sb.refresh({ config: std.config, opts: { ...opts, ids: ['vgm-9001'] } });
  assert.equal(some.summary.rateUpdated, true);
  // kur getirmesi için ayrı genel sınır: VG_RATE_SCALE ile sıkılaşınca ikinci istek TCMB'ye çıkmaz
  const sb2 = sandbox(t); const s2 = standard(sb2);
  const lim = { ...sb2.env, VG_RATE_SCALE: '0.01' };
  const a = sb2.refresh({ config: s2.config, opts: { ...opts, ids: ['vgm-9001'] } }, lim);
  const b = sb2.refresh({ config: s2.config, rate: null, opts: { ...opts, ids: ['vgm-9001'] } }, lim);
  assert.deepEqual([a.summary.rateUpdated, b.summary.rateUpdated], [true, false]);
});

/* ------------------------------------------------------------------------------------------------ teklif ve kimlik */

test('vgm_fetch_offer: kimlik (GTIN/MPN), para birimi, KDV, indirim, stok ve hata kodları', t => {
  const sb = sandbox(t);
  const product = (over = {}) => ({ id: 'vgm-9001', vat: 20, mpn: 'DM-450', gtin: null, ...over });
  const offer = (html, srcOver = {}, prod = product(), url = U) => {
    sb.page(url, html);
    return run({ op: 'offer', src: src(url, srcOver), product: prod }, sb.env);
  };
  // başarılı teklif: vgm_apply_check biçimi
  assert.deepEqual(offer(ld({ price: '2450.90' })), { price: 2450.9, currency: 'TRY', vatIncluded: true, discount: 0, available: true, method: 'jsonld' });
  // para birimi: sayfa belirtmezse kaynak, belirtirse sayfa kazanır
  const microNoCur = '<div itemscope itemtype="https://schema.org/Product"><span itemprop="price" content="64.50"></span></div>';
  assert.equal(offer(microNoCur, { currency: 'USD' }).currency, 'USD');
  assert.equal(offer(microNoCur, { currency: 'USD' }).method, 'microdata');
  assert.equal(offer(ld({ price: '10', currency: 'EUR' }), { currency: 'USD' }).currency, 'EUR');
  // KDV hariç kaynak, bayi indirimi (kaynaktan aynen), stok
  const o2 = offer(ld({ price: '100' }), { vatIncluded: false, discount: 0.1 });
  assert.equal(o2.vatIncluded, false); assert.equal(o2.discount, 0.1);
  assert.equal(offer(ld({ price: '100', availability: 'OutOfStock' })).available, false);
  assert.equal(offer(ld({ price: '100', availability: null })).available, true);     // bilinmiyorsa true
  // kimlik: GTIN ikisinde de varsa belirleyicidir
  const gt = '4006381333931';
  assert.equal(offer(ld({ price: '100', gtin: gt, mpn: 'BASKA-MPN' }), {}, product({ gtin: gt })).price, 100);
  assert.deepEqual(offer(ld({ price: '100', gtin: '4006381333948' }), {}, product({ gtin: gt })), { error: 'identity_mismatch' });
  assert.equal(offer(ld({ price: '100', gtin: '614141123452' }), {}, product({ gtin: '0614141123452' })).price, 100);   // GTIN-12 = GTIN-13 (baştaki sıfır)
  // MPN: normalleştirme (büyük harf, ayraçsız); SKU kurtarabilir; çelişirse hata
  assert.equal(offer(ld({ price: '100', mpn: 'dm 450' })).price, 100);
  assert.deepEqual(offer(ld({ price: '100', mpn: 'XY-999' })), { error: 'identity_mismatch' });
  assert.equal(offer(ld({ price: '100', mpn: 'XY-999', sku: 'DM/450' })).price, 100);
  assert.equal(offer(ld({ price: '100', mpn: null })).price, 100);                      // sayfada kimlik yok: kanıt yok
  assert.equal(offer(ld({ price: '100', mpn: 'XY-999' }), {}, product({ mpn: null })).price, 100);   // üründe kimlik yok
  // hata kodları: 404/410 "gone", diğerleri değil
  sb.status(U, 404); assert.deepEqual(run({ op: 'offer', src: src(U), product: product() }, sb.env), { error: 'http_404', gone: true });
  sb.status(U, 410); assert.deepEqual(run({ op: 'offer', src: src(U), product: product() }, sb.env), { error: 'http_410', gone: true });
  sb.status(U, 503); assert.deepEqual(run({ op: 'offer', src: src(U), product: product() }, sb.env), { error: 'http_503' });
  sb.status(U, 403); assert.deepEqual(run({ op: 'offer', src: src(U), product: product() }, sb.env), { error: 'http_403' });
  assert.deepEqual(offer('<html><body>Fiyat için arayın</body></html>'), { error: 'no_price' });
  assert.deepEqual(offer(fs.readFileSync(path.join(kdir, 'jsonld-offers-conflict.html'), 'utf8')), { error: 'ambiguous_price' });
  assert.deepEqual(run({ op: 'offer', src: src('https://tedarikci-bir.example/yok-sayfa'), product: product() }, sb.env), { error: 'fixture_missing' });
  // kaynak kaydındaki alan adının dışına çıkılamaz; https zorunlu
  assert.deepEqual(run({ op: 'offer', src: { ...src(U), supplier: 'baska.example' }, product: product() }, sb.env), { error: 'host_not_allowed' });
  assert.deepEqual(run({ op: 'offer', src: { ...src(U), url: 'http://tedarikci-bir.example/x' }, product: product() }, sb.env), { error: 'scheme_not_allowed' });
  assert.deepEqual(run({ op: 'offer', src: { url: '', supplier: '' }, product: product() }, sb.env), { error: 'bad_source' });
});

/* ------------------------------------------------------------------------------------------------ TCMB */

test('TCMB kuru: today.xml ayrıştırma, sağlık denetimleri ve test modu getirmesi', t => {
  const sample = fs.readFileSync(path.join(kdir, 'tcmb-sample.xml'), 'utf8');
  const parse = xml => run({ op: 'tcmb', xml });
  const good = parse(sample);
  assert.equal(good.why, '');
  assert.deepEqual(pick(good.rate, ['version', 'usdTry', 'eurTry', 'date', 'source']),
    { version: 1, usdTry: 40.175, eurTry: 46.69, date: '2026-10-27', source: 'TCMB today.xml ForexSelling' });
  assert.ok(Math.abs(good.rate.fetchedAt - now()) <= 10);
  const bad = [
    [sample.replace(/Tarih="[^"]*"/, ''), 'rate_date_missing'],
    [sample.replace('Tarih="27.10.2026"', 'Tarih="31.02.2026"'), 'rate_date_invalid'],
    [tcmb(40, 46, new Date(Date.now() + 6 * 86400000)), 'rate_date_invalid'],
    [tcmb(null, 46), 'rate_usd_invalid'],
    [tcmb(0, 46), 'rate_usd_invalid'],
    [tcmb(5000, 46), 'rate_usd_invalid'],
    [tcmb('abc', 46), 'rate_usd_invalid'],
    [tcmb(40, 5), 'rate_inconsistent'],
    [tcmb(40, 100), 'rate_inconsistent'],
    ['<html>bakım</html>', 'rate_date_missing'],
  ];
  for (const [xml, why] of bad) { const r = parse(xml); assert.equal(r.rate, null, why); assert.equal(r.why, why); }
  const noEur = parse(tcmb(40, null));                                  // EUR yoksa USD yine geçerli
  assert.equal(noEur.rate.usdTry, 40); assert.equal(noEur.rate.eurTry, null);
  const crazyEur = parse(tcmb(40, 5000));                               // EUR aralık dışıysa yok sayılır
  assert.equal(crazyEur.rate.eurTry, null);

  const sb = sandbox(t);
  sb.rates(41.25, 47.5);
  const fetched = run({ op: 'rates' }, sb.env);
  assert.equal(fetched.why, ''); assert.equal(fetched.rate.usdTry, 41.25); assert.equal(fetched.rate.eurTry, 47.5);
  assert.match(fetched.rate.date, /^\d{4}-\d{2}-\d{2}$/);
  fs.rmSync(path.join(sb.pages, 'tcmb-today.xml'));
  const missing = run({ op: 'rates' }, sb.env);
  assert.deepEqual([missing.rate, missing.why], [null, 'fixture_missing']);
  fs.writeFileSync(path.join(sb.pages, 'tcmb-today.404'), '');
  assert.equal(run({ op: 'rates' }, sb.env).why, 'http_404');
  // fixture klasörü verilmiş ama yoksa bile gerçek ağa çıkılmaz (kur okunamaz, ağ denenmez)
  const ghost = run({ op: 'rates' }, { ...sb.env, VG_MAGAZA_FIXTURE_DIR: path.join(sb.pages, 'yok-boyle-klasor') });
  assert.deepEqual([ghost.rate, ghost.why], [null, 'fixture_missing']);
});

/* ------------------------------------------------------------------------------------------------ yenileme */

test('vgm_refresh (cron): ok, KDV/indirim/USD dönüşümü, gone -> unavailable, >%25 sıçrama held, özet ve gizlilik', t => {
  const sb = sandbox(t);
  const std = standard(sb);
  const r1 = sb.refresh({ config: std.config, opts: { ids: null, live: false, spacing: 0, budget: 60 } });
  const s = r1.summary;
  assert.deepEqual(pick(s, ['checked', 'ok', 'held', 'error', 'unavailable', 'skipped', 'rateUpdated']),
    { checked: 5, ok: 4, held: 0, error: 0, unavailable: 1, skipped: 0, rateUpdated: true });
  assert.equal(typeof s.seconds, 'number');
  assert.equal(r1.rate.usdTry, 40); assert.equal(r1.rate.eurTry, 46);
  const items = r1.prices.items;
  // vgm-9001: KDV dahil 2450,90 TL
  assert.equal(items['vgm-9001'].status, 'ok'); assert.equal(items['vgm-9001'].costTry, 2450.9);
  assert.ok(Math.abs(items['vgm-9001'].costUsd - 51.0604) < 1e-4); assert.equal(items['vgm-9001'].rateAtCheck, 40);
  assert.equal(items['vgm-9001'].method, 'jsonld'); assert.equal(items['vgm-9001'].available, true); assert.equal(items['vgm-9001'].source, 0);
  assert.ok(Math.abs(items['vgm-9001'].checkedAt - now()) <= 15);
  // vgm-9002: KDV hariç 15.999 -> +%20
  assert.equal(items['vgm-9002'].costTry, 19198.8);
  // vgm-9003: %10 bayi indirimi (kaynaktan aynen geçer)
  assert.equal(items['vgm-9003'].costTry, 90);
  // vgm-9004: USD, KDV hariç: 1850 USD x 40 x 1,2
  assert.equal(items['vgm-9004'].costTry, 88800); assert.ok(Math.abs(items['vgm-9004'].costUsd - 1850) < 1e-3);
  // vgm-9005: 404 -> unavailable
  assert.equal(items['vgm-9005'].status, 'unavailable'); assert.equal(items['vgm-9005'].available, false); assert.equal(items['vgm-9005'].note, 'http_404');
  // sorunlu ürünler fiyat-durum.json'da (panel tüm parçaları taramaz)
  assert.deepEqual(r1.prices.problems, { 'vgm-9005': 'unavailable' });
  assert.deepEqual(r1.queue['vgm-9001'].slice(2), ['ok', 'tedarikci-bir.example', 0]); assert.ok(r1.queue['vgm-9001'][0] > 0);
  // tam çalışma kalp atışı yazar
  assert.ok(Math.abs(r1.prices.lastRunAt - now()) <= 15);
  assert.equal(r1.prices.lastRunSummary.checked, 5);
  // gizlilik: kayıt ve özet tedarikçi adresi/alan adı içermez
  const blob = JSON.stringify([r1.prices, r1.rate, s]);
  assert.doesNotMatch(blob, /tedarikci|example|https?:/i);

  // ikinci tur: 9001 %40 zam -> held; 9003 %10 zam -> ok; 9005 tekrar stokta -> ok
  sb.page(pageUrl('vgm-9001'), ld({ mpn: 'DM-450', price: '3431.26' }));
  sb.page(pageUrl('vgm-9003'), ld({ mpn: 'DM-C16', price: '110' }));
  sb.page(pageUrl('vgm-9005'), ld({ mpn: 'DM-MM1', price: '1700' }));
  // age: 0 -> zamanlayıcı yeni kontrol edilmiş ürünleri de yeniden alır (varsayılan: 20 saat sonra)
  const r2 = sb.refresh({ opts: { ids: null, live: false, spacing: 0, budget: 60, age: 0 } });
  assert.deepEqual(pick(r2.summary, ['checked', 'ok', 'held', 'unavailable', 'rateUpdated']), { checked: 5, ok: 4, held: 1, unavailable: 0, rateUpdated: false });
  const i2 = r2.prices.items;
  assert.equal(i2['vgm-9001'].status, 'held'); assert.equal(i2['vgm-9001'].costTry, 2450.9);        // kabul edilen fiyat korunur
  assert.equal(i2['vgm-9001'].held.costTry, 3431.26); assert.equal(i2['vgm-9001'].held.prevCostTry, 2450.9);
  assert.match(i2['vgm-9001'].note, /onay/);
  assert.equal(i2['vgm-9003'].costTry, 99); assert.equal(i2['vgm-9003'].status, 'ok');
  assert.equal(i2['vgm-9005'].status, 'ok'); assert.equal(i2['vgm-9005'].available, true); assert.equal(i2['vgm-9005'].costTry, 1700);
  assert.ok(i2['vgm-9001'].history.length >= 2);
  assert.deepEqual(r2.prices.problems, { 'vgm-9001': 'held' });
  // varsayılan yaş (20 saat): az önce kontrol edilen ürünler yeniden getirilmez
  const r3 = sb.refresh({ opts: { ids: null, live: false, spacing: 0, budget: 60 } });
  assert.deepEqual(pick(r3.summary, ['checked', 'due', 'left', 'skipped']), { checked: 0, due: 0, left: 0, skipped: 0 });
});

test('vgm_refresh: kaynak önceliği, gone zinciri sürdürür, tüm kaynaklar gone ise unavailable, hata ve kimlik uyuşmazlığı', t => {
  const sb = sandbox(t);
  sb.rates(40, 46);
  const UA = 'https://tedarikci-bir.example/a';
  const UB = 'https://tedarikci-iki.example/b';
  const two = [src(UA, { priority: 2 }), src(UB, { priority: 1 })];       // priority 1 (indeks 1) önce denenir
  const go = (sources, id = 'vgm-9001') => sb.refresh({ config: cfg({ [id]: sources }), opts: { ids: [id], spacing: 0, budget: 30 } });
  sb.page(UA, ld({ mpn: 'DM-450', price: '2400' })); sb.page(UB, '<html>fiyat yok</html>');
  let r = go(two);
  assert.equal(r.prices.items['vgm-9001'].status, 'ok'); assert.equal(r.prices.items['vgm-9001'].costTry, 2400);
  assert.equal(r.prices.items['vgm-9001'].source, 0);                     // kaynak sırası: kaynaklar.json'daki indeks
  assert.equal(r.summary.checked, 1); assert.equal(r.summary.ok, 1);
  // öncelikli kaynak çalışıyorsa ikincisi hiç getirilmez
  sb.page(UB, ld({ mpn: 'DM-450', price: '2300' })); sb.page(UA, '<html>bozuk</html>');
  r = go(two);
  assert.equal(r.prices.items['vgm-9001'].costTry, 2300); assert.equal(r.prices.items['vgm-9001'].source, 1);
  // öncelikli kaynak "gone" ise zincir DEVAM eder: sıradaki sağlam kaynak fiyatı verir
  sb.status(UB, 404); sb.page(UA, ld({ mpn: 'DM-450', price: '2400' }));
  r = go(two);
  assert.equal(r.prices.items['vgm-9001'].status, 'ok'); assert.equal(r.prices.items['vgm-9001'].costTry, 2400);
  assert.equal(r.prices.items['vgm-9001'].source, 0); assert.equal(r.summary.unavailable, 0);
  // 410 da aynı
  sb.status(UB, 410);
  r = go(two);
  assert.equal(r.prices.items['vgm-9001'].status, 'ok'); assert.equal(r.prices.items['vgm-9001'].source, 0);
  // her iki kaynak da gone -> unavailable
  sb.status(UA, 404); sb.status(UB, 410);
  r = go(two);
  assert.equal(r.prices.items['vgm-9001'].status, 'unavailable'); assert.equal(r.summary.unavailable, 1);
  assert.equal(r.prices.items['vgm-9001'].available, false);
  // biri gone, diğeri geçici hata: unavailable DEĞİL, error
  sb.status(UB, 404); sb.status(UA, 503);
  r = go(two);
  assert.equal(r.prices.items['vgm-9001'].status, 'error'); assert.match(r.prices.items['vgm-9001'].note, /http_503/);
  // tüm kaynaklar başarısız (gone olmayan hatalar): error + kodlar; önceki kabul edilmiş fiyat korunur
  sb.status(UB, 503); sb.page(UA, '<html>fiyat yok</html>');
  r = go(two);
  const it = r.prices.items['vgm-9001'];
  assert.equal(it.status, 'error'); assert.match(it.note, /http_503/); assert.match(it.note, /no_price/);
  assert.equal(r.summary.error, 1);
  // kimlik uyuşmazlığı -> error, sonraki kaynağa geçilir
  sb.page(UB, ld({ mpn: 'YANLIS-1', price: '10' })); sb.page(UA, ld({ mpn: 'DM-450', price: '2500' }));
  r = go(two);
  assert.equal(r.prices.items['vgm-9001'].status, 'ok'); assert.equal(r.prices.items['vgm-9001'].costTry, 2500);
  sb.page(UA, ld({ mpn: 'YANLIS-2', price: '2500' }));
  r = go(two);
  assert.equal(r.prices.items['vgm-9001'].status, 'error'); assert.match(r.prices.items['vgm-9001'].note, /identity_mismatch/);
  // engellenen tedarikçi kaynak sayılmaz: hiç getirme yok
  r = sb.refresh({ config: cfg({ 'vgm-9001': two }, { blockedSuppliers: ['tedarikci-bir.example', 'tedarikci-iki.example'] }), opts: { ids: ['vgm-9001'], spacing: 0 } });
  assert.deepEqual(pick(r.summary, ['checked', 'skipped']), { checked: 0, skipped: 0 });
});

test('ilk kabul: maliyet katalog listUsd/1,15 ile 0,5-1,5 kat aralığında değilse held (1000 kat yanlış okuma)', () => {
  const rates = { USD: 40, EUR: 46 };
  const offer = price => ({ price, currency: 'TRY', vatIncluded: true, discount: 0, available: true, method: 'jsonld' });
  const check = (price, product, item) => run({ op: 'check', product, offer: offer(price), rates, now: now(), ...(item ? { item } : {}) });
  const p = { id: 'vgm-9001', vat: 20, listUsd: 115 };                      // beklenen maliyet 100 USD = 4800 TL KDV dahil
  assert.equal(check(4800, p).status, 'ok');
  assert.equal(check(2600, p).status, 'ok');                                 // 0,54x
  assert.equal(check(7000, p).status, 'ok');                                 // 1,46x
  for (const tl of [4.8, 480, 2300, 7400, 4800000]) {
    const r = check(tl, p);
    assert.equal(r.status, 'held', `price ${tl}`); assert.equal(r.costTry, undefined, `price ${tl}`); assert.match(r.note, /onay/);
    assert.equal(r.held.costTry, tl);
  }
  // listUsd yoksa karşılaştırma yapılmaz
  assert.equal(check(4.8, { id: 'vgm-9001', vat: 20 }).status, 'ok');
  assert.equal(check(4.8, { id: 'vgm-9001', vat: 20, listUsd: null }).status, 'ok');
  // önceki kabul edilmiş maliyet varsa %25 sıçrama kuralı geçerli, listUsd'ye bakılmaz
  const prev = { status: 'ok', costTry: 480, costUsd: 10, history: [] };
  assert.equal(check(500, p, prev).status, 'ok');
  assert.equal(check(700, p, prev).status, 'held');
});

test('vgm_price: kimlik uyuşmazlığı/belirsiz fiyat hatası siparişi engeller, geçici hata 48 saat son fiyatı korur', () => {
  const now0 = now();
  const rate = { version: 1, usdTry: 40, eurTry: 46, date: new Date().toISOString().slice(0, 10), fetchedAt: now0 - 60, source: 'test' };
  const config = cfg({ 'vgm-9001': [src(pageUrl('vgm-9001'))] }, { open: true });
  const p = { id: 'vgm-9001', vat: 20, shipping: 'kargo', listUsd: 95.5 };
  const price = (item, at = now0) => run({ op: 'price', product: p, item: { costUsd: 51.06, checkedAt: now0 - 3600, available: true, source: 0, history: [], ...item }, rate, config, open: true, now: at });
  const ok = price({ status: 'ok' });
  assert.equal(ok.orderable, true); assert.equal(ok.reason, 'ok');
  // görünen fiyat ödenecek fiyat değil (başka ürün, çelişki, KDV hariç, en az adet, fiyatı değiştiren seçenek): satılmaz
  for (const note of ['identity_mismatch', 'http_503; identity_mismatch', 'ambiguous_price', 'vat_mismatch', 'min_quantity', 'price_options']) {
    const r = price({ status: 'error', note });
    assert.equal(r.orderable, false, note); assert.equal(r.reason, 'error', note);
  }
  // geçici hatalar: son fiyat 48 saat içinde geçerli
  for (const note of ['http_503', 'no_price', 'timeout']) {
    const r = price({ status: 'error', note });
    assert.equal(r.orderable, true, note); assert.equal(r.reason, 'ok', note);
  }
  // 48 saati aşınca geçici hata da engeller
  const old = price({ status: 'error', note: 'http_503', checkedAt: now0 - 49 * 3600 });
  assert.equal(old.orderable, false); assert.equal(old.reason, 'stale');
});

test('vgm_price: listUsd yalnızca gösterim içindir; ilk kontrol held/gone ya da kaynak yoksa sipariş açılmaz', () => {
  const now0 = now();
  const rate = { version: 1, usdTry: 40, eurTry: 46, date: new Date().toISOString().slice(0, 10), fetchedAt: now0 - 60, source: 'test' };
  const config = cfg({ 'vgm-9001': [src(pageUrl('vgm-9001'))] }, { open: true });
  const p = { id: 'vgm-9001', vat: 20, shipping: 'kargo', listUsd: 95.5, listCheckedAt: new Date((now0 - 3600) * 1000).toISOString() };
  const price = (item, cfgx = config) => run({ op: 'price', product: p, item, rate, config: cfgx, open: true, now: now0 });
  let r = price(null);
  assert.equal(r.basis, 'list'); assert.equal(r.orderable, false); assert.equal(r.reason, 'stale');
  r = price({ status: 'held', available: true, history: [] });
  assert.equal(r.orderable, false); assert.equal(r.reason, 'held');
  r = price({ status: 'unavailable', available: false, history: [] });
  assert.equal(r.orderable, false); assert.equal(r.reason, 'unavailable');
  r = price(null, cfg({}, { open: true }));
  assert.equal(r.orderable, false); assert.equal(r.reason, 'no_source');
});

test('vgm_refresh: kur yoksa/eskiyse, rates:false, max, bütçe ve aynı sunucuya bekleme', t => {
  // kur yok ve TCMB okunamıyor -> hiçbir ürün getirilmez
  let sb = sandbox(t);
  const sources = { 'vgm-9001': [src(pageUrl('vgm-9001'))], 'vgm-9002': [src(pageUrl('vgm-9002'))], 'vgm-9003': [src(pageUrl('vgm-9003'))] };
  for (const id of Object.keys(sources)) sb.page(pageUrl(id), ld({ mpn: MPN[id], price: GOOD[id] }));
  let r = sb.refresh({ config: cfg(sources), opts: { ids: null, spacing: 0 } });
  assert.deepEqual(pick(r.summary, ['checked', 'skipped', 'rateUpdated', 'rateError']), { checked: 0, skipped: 3, rateUpdated: false, rateError: 'fixture_missing' });
  assert.deepEqual(r.prices.items, []);
  // rates:false -> TCMB'ye hiç gidilmez
  sb.rates(40, 46);
  r = sb.refresh({ opts: { ids: null, spacing: 0, rates: false } });
  assert.deepEqual(pick(r.summary, ['checked', 'skipped', 'rateUpdated', 'rateError']), { checked: 0, skipped: 3, rateUpdated: false, rateError: 'no_rate' });
  // varsayılan: kur çekilir ve ürünler işlenir
  r = sb.refresh({ opts: { ids: null, spacing: 0 } });
  assert.deepEqual(pick(r.summary, ['checked', 'ok', 'rateUpdated']), { checked: 3, ok: 3, rateUpdated: true });
  // taze kur yeniden çekilmez; forceRates çeker
  sb.rates(41, 47);
  r = sb.refresh({ opts: { ids: [], spacing: 0 } });
  assert.equal(r.summary.rateUpdated, false); assert.equal(r.rate.usdTry, 40);
  r = sb.refresh({ opts: { ids: [], spacing: 0, forceRates: true } });
  assert.equal(r.summary.rateUpdated, true); assert.equal(r.rate.usdTry, 41);
  // 6 saatten eski kur cron'da yenilenir; canlı modda yenilenmez
  const old = { version: 1, usdTry: 39, eurTry: 45, date: new Date().toISOString().slice(0, 10), fetchedAt: now() - 7 * 3600, source: 'test' };
  r = sb.refresh({ rate: old, opts: { ids: [], live: true, spacing: 0 } });
  assert.equal(r.summary.rateUpdated, false); assert.equal(r.rate.usdTry, 39);
  r = sb.refresh({ opts: { ids: [], live: false, spacing: 0 } });
  assert.equal(r.summary.rateUpdated, true); assert.equal(r.rate.usdTry, 41);
  // 48 saatten eski okunmuş kur güvenilmez: ürünler getirilmez
  r = sb.refresh({ rate: { ...old, fetchedAt: now() - 3 * 86400 }, opts: { ids: null, spacing: 0, rates: false, age: 0 } });
  assert.deepEqual(pick(r.summary, ['checked', 'skipped', 'rateError']), { checked: 0, skipped: 3, rateError: 'no_rate' });

  // max: en çok 2 getirme
  sb = sandbox(t); sb.rates(40, 46);
  for (const id of Object.keys(sources)) sb.page(pageUrl(id), ld({ mpn: MPN[id], price: GOOD[id] }));
  r = sb.refresh({ config: cfg(sources), opts: { ids: null, spacing: 0, max: 2 } });
  assert.deepEqual(pick(r.summary, ['checked', 'skipped', 'left', 'due']), { checked: 2, skipped: 0, left: 1, due: 3 });
  // adil sıra: bir sonraki çalışma önceki çalışmada atlananı alır
  r = sb.refresh({ opts: { ids: null, spacing: 0, max: 1 } });
  const attempted = Object.entries(r.prices.items).filter(([, v]) => v.lastAttemptAt).length;
  assert.equal(attempted, 3);

  // aynı sunucuya en az `spacing` sn bekleme (2 ürün, aynı alan adı)
  sb = sandbox(t); sb.rates(40, 46);
  const two = { 'vgm-9001': [src(pageUrl('vgm-9001'))], 'vgm-9002': [src(pageUrl('vgm-9002'))] };
  for (const id of Object.keys(two)) sb.page(pageUrl(id), ld({ mpn: MPN[id], price: GOOD[id] }));
  const t0 = Date.now();
  r = sb.refresh({ config: cfg(two), opts: { ids: null, spacing: 1.2, budget: 60 } });
  assert.equal(r.summary.checked, 2);
  assert.ok(Date.now() - t0 >= 1200, 'ikinci istek en az 1,2 sn beklemeli');
  assert.ok(r.summary.seconds >= 1.2);
  // bütçe beklemeye yetmezse sıradaki ürün atlanır
  sb = sandbox(t); sb.rates(40, 46);
  for (const id of Object.keys(two)) sb.page(pageUrl(id), ld({ mpn: MPN[id], price: GOOD[id] }));
  r = sb.refresh({ config: cfg(two), opts: { ids: null, spacing: 30, budget: 3 } });
  assert.deepEqual(pick(r.summary, ['checked', 'skipped', 'left']), { checked: 1, skipped: 0, left: 1 });
});

test('vgm_refresh (canlı): yalnız bayat ve yakın zamanda denenmemiş ürünler; hız sınırı; kalp atışı yok', t => {
  const sb = sandbox(t);
  const std = standard(sb);
  const rate = { version: 1, usdTry: 40, eurTry: 46, date: new Date().toISOString().slice(0, 10), fetchedAt: now() - 7 * 3600, source: 'test' };
  const stale = (id, checked, attempt) => okItem(id, { checkedAt: now() - checked, ...(attempt === undefined ? {} : { lastAttemptAt: now() - attempt }) });
  const prices = { version: 1, lastRunAt: null, lastRunSummary: null, items: {
    'vgm-9001': stale('vgm-9001', 3 * 3600),                  // taze (6 saatten yeni): atlanır
    'vgm-9002': stale('vgm-9002', 7 * 3600, 2 * 3600),        // bayat, son deneme 2 saat önce: kontrol edilir
    'vgm-9003': stale('vgm-9003', 8 * 3600, 5 * 60),          // bayat ama 5 dk önce denendi: atlanır
  } };
  const opts = { ids: ['vgm-9001', 'vgm-9002', 'vgm-9003', 'vgm-9005'], live: true, budget: 8, max: 6, spacing: 0, rates: true };
  sb.page(pageUrl('vgm-9005'), ld({ mpn: 'DM-MM1', price: '1700' }));              // hiç kontrol edilmemiş: kontrol edilir
  const r = sb.refresh({ config: std.config, prices, rate, opts });
  assert.deepEqual(pick(r.summary, ['checked', 'ok', 'skipped', 'rateUpdated']), { checked: 2, ok: 2, skipped: 2, rateUpdated: false });
  assert.equal(r.rate.usdTry, 40);                                                 // canlıda eski kur yenilenmez
  assert.equal(r.prices.items['vgm-9002'].costTry, 19198.8);
  assert.equal(r.prices.items['vgm-9005'].costTry, 1700);
  assert.equal(r.prices.items['vgm-9001'].costTry, COST['vgm-9001'][0]);          // dokunulmadı
  assert.equal(r.prices.items['vgm-9003'].costTry, COST['vgm-9003'][0]);
  assert.equal(r.prices.lastRunAt, null);                                          // canlı kontrol kalp atışı yazmaz
  // hemen ardından tekrar: son deneme yeni, hiçbiri yeniden getirilmez
  const again = sb.refresh({ opts });
  assert.deepEqual(pick(again.summary, ['checked', 'skipped']), { checked: 0, skipped: 4 });

  // genel hız sınırı (vg_rl_hit): VG_RATE_SCALE=0.05 -> dakikada en çok 2 canlı ürün kontrolü
  const sb2 = sandbox(t); standard(sb2);
  const due = { version: 1, lastRunAt: null, lastRunSummary: null, items: {
    'vgm-9001': stale('vgm-9001', 9 * 3600), 'vgm-9002': stale('vgm-9002', 9 * 3600), 'vgm-9003': stale('vgm-9003', 9 * 3600), 'vgm-9004': stale('vgm-9004', 9 * 3600) } };
  const limited = sb2.refresh({ config: standard(sb2).config, prices: due, rate, opts: { ...opts, ids: ['vgm-9001', 'vgm-9002', 'vgm-9003', 'vgm-9004'] } }, { ...sb2.env, VG_RATE_SCALE: '0.05' });
  assert.deepEqual(pick(limited.summary, ['checked', 'skipped']), { checked: 2, skipped: 2 });
});

test('vgm_refresh: kalp atışı yalnızca tam çalışmada; ids ile sınırlı çalışma yazmaz', t => {
  const sb = sandbox(t);
  const std = standard(sb);
  let r = sb.refresh({ config: std.config, opts: { ids: ['vgm-9001'], live: false, spacing: 0 } });
  assert.equal(r.prices.lastRunAt, null);
  r = sb.refresh({ opts: { ids: ['vgm-9001'], live: false, spacing: 0, heartbeat: true } });
  assert.ok(r.prices.lastRunAt > 0);
  assert.equal(r.prices.lastRunSummary.checked, 1);
  const sb2 = sandbox(t); const std2 = standard(sb2);
  r = sb2.refresh({ config: std2.config, opts: { spacing: 0 } });                // ids verilmedi: tam çalışma
  assert.ok(r.prices.lastRunAt > 0); assert.equal(r.prices.lastRunSummary.ok, 4);
  // bilinmeyen ürün kimliği ve kaynağı olmayan ürün yok sayılır
  r = sb2.refresh({ opts: { ids: ['vgm-0000', 'kotu', 'vgm-9004'], spacing: 0, heartbeat: false } });
  assert.equal(r.summary.checked, 1);
});

/* ------------------------------------------------------------------------------------------------ cron komutu */

test('cron: --status, tam çalışma, --product, --rates, --parse, --check-url ve çıkış kodları', t => {
  const sb = sandbox(t);
  const std = standard(sb);
  sb.config(std.sources);
  // VG_DATA_DIR olmadan veri komutları reddedilir
  const noData = cron([], baseEnv());
  assert.equal(noData.status, 2); assert.match(noData.stderr, /VG_DATA_DIR/);
  // ilk durum: hiç çalışma yok
  let st = JSON.parse(cron(['--status'], sb.env).stdout);
  assert.deepEqual(pick(st, ['lastRunAt', 'healthy', 'products', 'stale', 'rate']), { lastRunAt: null, healthy: false, products: 5, stale: 5, rate: null });
  assert.deepEqual(st.counts, { ok: 0, held: 0, error: 0, unavailable: 0, unchecked: 5 });
  // tam çalışma
  const full = cron([], sb.env);
  assert.equal(full.status, 0, full.stdout + full.stderr);
  assert.match(full.stdout, /checked=5 ok=4 held=0 error=0 unavailable=1 skipped=0 left=0 due=5 rateUpdated=yes/);
  st = JSON.parse(cron(['--status'], sb.env).stdout);
  assert.equal(st.healthy, true); assert.equal(st.stale, 1);                      // unavailable ürünün checkedAt'i yok -> bayat sayılır
  assert.deepEqual(st.counts, { ok: 4, held: 0, error: 0, unavailable: 1, unchecked: 0 });
  assert.ok(Math.abs(st.lastRunAt - now()) <= 30); assert.match(st.lastRunAtIso, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(st.summary.checked, 5);
  for (const field of ['cpuUserSeconds', 'cpuSystemSeconds']) {
    assert.equal(typeof st.summary[field], 'number'); assert.ok(st.summary[field] >= 0, field);
    assert.equal(Number(full.stdout.match(new RegExp(`${field}=([0-9.]+)`))[1]), st.summary[field], `${field} persisted and printed`);
  }
  assert.ok(Number.isSafeInteger(st.summary.peakMemoryBytes) && st.summary.peakMemoryBytes > 0);
  assert.match(full.stdout, new RegExp(`peakMemoryBytes=${st.summary.peakMemoryBytes}(?: |$)`));
  assert.equal(st.rate.usdTry, 40); assert.equal(st.rate.ok, true);
  assert.doesNotMatch(JSON.stringify(st), /tedarikci|example|https?:/i);
  // cron her 10 dakikada bir: 30 dakikadan eski çalışma "sağlıksız"
  const statusLate = run({ op: 'status', now: now() + 31 * 60 }, sb.env);
  assert.equal(statusLate.healthy, false);
  assert.equal(run({ op: 'status', now: now() + 20 * 60 }, sb.env).healthy, true);
  assert.equal(st.freshShare, 0.8); assert.equal(st.fresh, 4);
  assert.deepEqual(st.capacity, { fetchesPerHour: null, cycleHours: null, ok: true }, 'az örnekli çalışmada tahmin yok');
  // kapasite: son çalışmanın hızıyla tüm ürünlerin bir turu 48 saati aşıyorsa sağlıklı sayılmaz
  const durumFile = path.join(sb.data, 'magaza', 'fiyat-durum.json');
  const durum = JSON.parse(fs.readFileSync(durumFile, 'utf8'));
  fs.writeFileSync(durumFile, JSON.stringify({ ...durum, lastRunAt: now(), lastRunSummary: { ...durum.lastRunSummary, fetches: 20, seconds: 100000, budget: 10 } }));
  const slow = run({ op: 'status', now: now() }, sb.env);
  assert.equal(slow.healthy, false); assert.equal(slow.capacity.ok, false); assert.ok(slow.capacity.cycleHours > 48);
  fs.writeFileSync(durumFile, JSON.stringify({ ...durum, lastRunAt: now(), lastRunSummary: { ...durum.lastRunSummary, fetches: 200, seconds: 200, budget: 540 } }));
  const fast = run({ op: 'status', now: now() }, sb.env);
  assert.equal(fast.healthy, true); assert.deepEqual(fast.capacity, { fetchesPerHour: 3240, cycleHours: 0, ok: true });

  // --product
  const one = JSON.parse(cron(['--product', 'vgm-9001'], sb.env).stdout);
  assert.equal(one.summary.checked, 1); assert.equal(one.item.status, 'ok'); assert.equal(one.item.costTry, 2450.9);
  assert.equal(cron(['--product', 'kotu'], sb.env).status, 2);
  assert.equal(cron(['--product', 'vgm-9999'], sb.env).status, 2);
  // --rates
  sb.rates(42, 48);
  const rates = cron(['--rates'], sb.env);
  assert.equal(rates.status, 0); assert.equal(JSON.parse(rates.stdout).rate.usdTry, 42);
  fs.rmSync(path.join(sb.pages, 'tcmb-today.xml'));
  const failRates = cron(['--rates'], sb.env);
  assert.equal(failRates.status, 1); assert.equal(JSON.parse(failRates.stdout).rateError, 'fixture_missing');
  // --parse: veri yazmaz, VG_DATA_DIR gerekmez
  const parsed = cron(['--parse', path.join(kdir, 'jsonld-offer.html'), '--url', U], baseEnv());
  assert.equal(parsed.status, 0); assert.equal(JSON.parse(parsed.stdout).price, 2450.9);
  assert.equal(cron(['--parse', path.join(kdir, 'no-price.html')], baseEnv()).status, 3);
  const missingFile = cron(['--parse', path.join(kdir, 'yok.html')], baseEnv());
  assert.equal(missingFile.status, 3); assert.equal(JSON.parse(missingFile.stdout).error, 'empty_page');
  // --check-url
  const blocked = cron(['--check-url', 'https://127.0.0.1/x', '--allow', '127.0.0.1'], baseEnv());
  assert.equal(blocked.status, 3); assert.equal(blocked.stdout.trim(), 'blocked blocked_address');
  assert.equal(cron(['--check-url', 'http://tedarikci-bir.example/x'], baseEnv()).stdout.trim(), 'blocked scheme_not_allowed');
  assert.equal(cron(['--check-url', 'https://tedarikci-bir.example/x', '--allow', 'baska.example'], baseEnv()).stdout.trim(), 'blocked host_not_allowed');
});

test('cron: aynı anda ikinci tam çalışma başlamaz (cron.lock)', async t => {
  const sb = sandbox(t);
  const std = standard(sb);
  sb.config(std.sources);
  const holder = spawn(phpBin, ['-n', '-r', '$f = fopen($argv[1] . "/magaza/cron.lock", "c+"); flock($f, LOCK_EX); echo "locked\\n"; sleep(20);', sb.data], { env: sb.env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  t.after(() => holder.kill());
  await new Promise((resolve, reject) => { holder.stdout.once('data', resolve); holder.once('error', reject); setTimeout(() => reject(new Error('kilit alınamadı')), 15000); });
  const res = cron([], sb.env);
  assert.equal(res.status, 0); assert.match(res.stdout, /atlandı/);
  const st = JSON.parse(cron(['--status'], sb.env).stdout);
  assert.equal(st.lastRunAt, null);                                                // çalışma yapılmadı
});

test('cron: cron.lock açılamıyorsa (izin/yol sorunu) "başka çalışma" sayılmaz; hata ve çıkış 1', t => {
  const sb = sandbox(t);
  const std = standard(sb);
  sb.config(std.sources);
  fs.mkdirSync(path.join(sb.data, 'magaza', 'cron.lock'));                         // dosya yerine klasör: fopen başarısız
  const res = cron([], sb.env);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /cron\.lock açılamadı/); assert.doesNotMatch(res.stdout, /atlandı/);
});

test('cron: unavailable CPU and peak-memory measurements persist and print null rather than zero', t => {
  const sb = sandbox(t); sb.config({}); sb.rates();
  const res = php(['-d', 'disable_functions=getrusage,memory_get_peak_usage', cronFile, '--sure', '10'], { env: sb.env });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(sb.data, 'magaza', 'fiyat-durum.json'), 'utf8')).lastRunSummary;
  for (const field of ['cpuUserSeconds', 'cpuSystemSeconds', 'peakMemoryBytes']) {
    assert.equal(summary[field], null, field); assert.match(res.stdout, new RegExp(`${field}=null(?: |$)`));
  }
  assert.equal(summary.checked, 0); assert.equal(summary.fetches, 0);
});

test('cron: CPU telemetry uses window deltas and rejects missing or regressing counters', t => {
  if (Number(php(['-r', 'echo PHP_MAJOR_VERSION;']).stdout) < 8) return t.skip('Fault injection requires PHP 8 disabled-builtin replacement.');
  const start = { 'ru_utime.tv_sec': 100, 'ru_utime.tv_usec': 900000, 'ru_stime.tv_sec': 40, 'ru_stime.tv_usec': 900000 };
  const finish = { 'ru_utime.tv_sec': 101, 'ru_utime.tv_usec': 100000, 'ru_stime.tv_sec': 41, 'ru_stime.tv_usec': 50000 };
  const incomplete = { 'ru_utime.tv_sec': 99, 'ru_utime.tv_usec': 900000, 'ru_stime.tv_sec': 41 };
  for (const [last, expected] of [[finish, [0.2, 0.15]], [incomplete, [null, null]]]) {
    const sb = sandbox(t); sb.config({}); sb.rates();
    const inject = path.join(sb.pages, 'cpu-samples.php');
    fs.writeFileSync(inject, '<?php function getrusage(int $mode = 0) { static $i = 0; $samples = json_decode(' + JSON.stringify(JSON.stringify([start, last])) + ', true); return $samples[min($i++, 1)]; }');
    const res = php(['-d', 'disable_functions=getrusage', '-d', `auto_prepend_file=${inject}`, cronFile], { env: sb.env });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const summary = JSON.parse(fs.readFileSync(path.join(sb.data, 'magaza', 'fiyat-durum.json'), 'utf8')).lastRunSummary;
    assert.deepEqual([summary.cpuUserSeconds, summary.cpuSystemSeconds], expected);
    assert.equal(summary.checked, 0); assert.equal(summary.fetches, 0);
  }
});

test('cron: a locking error is not successful contention and does not run a price refresh', t => {
  const sb = sandbox(t); sb.config({}); sb.rates();
  // PHP 8 permits a disabled builtin to be replaced in this isolated process. Other fixture locks have no contenders.
  const version = php(['-r', 'echo PHP_MAJOR_VERSION;']);
  if (Number(version.stdout) < 8) return t.skip('Fault injection requires PHP 8 disabled-builtin replacement.');
  const inject = path.join(sb.pages, 'flock-error.php');
  fs.writeFileSync(inject, '<?php function flock($stream, $operation, &$wouldBlock = null): bool { $wouldBlock = 0; return basename(stream_get_meta_data($stream)["uri"]) !== "cron.lock"; }');
  const res = php(['-d', 'disable_functions=flock', '-d', `auto_prepend_file=${inject}`, cronFile], { env: sb.env });
  assert.equal(res.status, 1); assert.equal(res.stdout, '');
  assert.match(res.stderr, /cron\.lock kilidi alınamadı/); assert(!res.stderr.includes(sb.data));
  assert.equal(JSON.parse(cron(['--status'], sb.env).stdout).lastRunAt, null);
});

/* ------------------------------------------------------------------------------------------------ modül kuralları */

test('modül kuralları: dürüst bot kimliği, PHP 7.4 uyumu, açık depoda tedarikçi alan adı yok', () => {
  const lib = fs.readFileSync(libFile, 'utf8');
  assert.ok(lib.includes("const VGM_FETCH_UA = 'Mozilla/5.0 (compatible; VoltGuardFiyat/1.0; +https://voltguard.com.tr/magaza/)';"));
  assert.doesNotMatch(lib, /Chrome\/|Firefox\/|Safari\/\d|AppleWebKit/);
  assert.match(lib, /CURLOPT_RESOLVE/); assert.match(lib, /CURLSSLOPT_NATIVE_CA/); assert.match(lib, /CURLOPT_ENCODING => ''/);
  const phpFiles = [libFile, cronFile, path.join(root, 'tools/magaza/kaynak-oku.php'), runner];
  for (const f of phpFiles) {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bmatch\s*\(/, f); assert.doesNotMatch(code, /\?->/, f);
    assert.doesNotMatch(code, /\bstr_(contains|starts_with|ends_with)\s*\(/, f); assert.doesNotMatch(code, /\breadonly\b|\benum\s+\w+/, f);
    assert.doesNotMatch(code, /\bfn\s*\(/, f); assert.doesNotMatch(code, /array_is_list|\bnever\b/, f);
    assert.match(code, /declare\(strict_types=1\);/, f);
  }
  assert.match(fs.readFileSync(libFile, 'utf8'), /if \(!defined\('VG_API'\)\) \{\s*http_response_code\(404\);\s*exit;\s*\}/);
  assert.match(fs.readFileSync(cronFile, 'utf8'), /PHP_SAPI !== 'cli'/);
  // açık depoya giren dosyalarda yalnızca örnek/test alan adları ve bilinen resmî adresler geçer
  const files = [...phpFiles, __filename, ...fs.readdirSync(kdir).map(f => path.join(kdir, f))];
  const hostRe = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com\.tr|net\.tr|org\.tr|gen\.tr|gov\.tr|com|net|org|tr|shop|store|io|dev)\b/gi;
  const allowed = new Set(['schema.org', 'voltguard.com.tr', 'tcmb.gov.tr']);
  const leaks = [];
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(hostRe)) {
      const host = m[0].toLowerCase().replace(/^www\./, '');
      if (!allowed.has(host) && !/^(?:node|process|assert|child_process)\./.test(host) && !/\.(?:cjs|php|json|html|xml)$/.test(host)) leaks.push(`${path.basename(f)}: ${host}`);
    }
  }
  assert.deepEqual([...new Set(leaks)], []);
});

/* ------------------------------------------------------------------------------------------------ zamanlayıcı (ölçek) */

test('zamanlayıcı sırası: önce hiç denenmemiş, sonra en eski doğrulama (48 saate en yakın), en sonda hiç doğrulanamamış; 20 saat / geri çekilen yeniden deneme', () => {
  const t = 1800000000;
  const H = 3600;
  const queue = {
    'vgm-0001': [t - 30 * H, t - 30 * H, 'ok'],         // 30 saat önce doğrulandı: zamanı geldi
    'vgm-0002': [t - 10 * H, t - 10 * H, 'ok'],         // 10 saat önce: henüz değil
    'vgm-0003': [0, 0, null],                            // hiç denenmedi: en başta
    'vgm-0004': [0, t - 3 * H, 'error'],                 // hiç doğrulanamadı, 3 saat önce denendi: yeniden (2 saat)
    'vgm-0005': [0, t - 1 * H, 'error'],                 // 1 saat önce denendi: bekler
    'vgm-0006': [t - 40 * H, t - 3 * H, 'error'],        // 40 saat önceki doğrulama, son deneme başarısız: yeniden
    'vgm-0007': [t - 45 * H, t - 30 * 60, 'held'],       // 30 dk önce onaya düştü: bekler
    'vgm-0008': [t - 21 * H, t - 21 * H, 'ok'],          // 21 saat: zamanı geldi
    'vgm-0009': [0, 0, null],
  };
  assert.deepEqual(run({ op: 'due', queue, now: t }), ['vgm-0003', 'vgm-0009', 'vgm-0006', 'vgm-0001', 'vgm-0008', 'vgm-0004']);
  // yaş ayarlanabilir (cron --yas): 35 saatte yalnız başarısız denemeler ve hiç denenmemişler
  assert.deepEqual(run({ op: 'due', queue, now: t, age: 35 * H }), ['vgm-0003', 'vgm-0009', 'vgm-0006', 'vgm-0004']);
  assert.deepEqual(run({ op: 'due', queue: {}, now: t }), []);
  // geri çekilme: ardışık n. hatadan sonra min(2 saat x 2^(n-1), 20 saat) beklenir
  const backoff = {
    'vgm-0010': [0, t - 3 * H, 'error', 'a.example', 2],      // 2 hata: 4 saat bekler
    'vgm-0011': [0, t - 5 * H, 'error', 'a.example', 2],      // 5 saat önce: yeniden
    'vgm-0012': [0, t - 10 * H, 'error', 'a.example', 6],     // 6 hata: 20 saat tavanı
    'vgm-0013': [0, t - 21 * H, 'error', 'a.example', 9],     // tavan geçti: yeniden
    'vgm-0014': [t - 46 * H, t - 3 * H, 'error', 'a.example', 1],
  };
  assert.deepEqual(run({ op: 'due', queue: backoff, now: t }), ['vgm-0014', 'vgm-0013', 'vgm-0011']);
});

test('zamanlayıcı: sunucular serpiştirilir, her sunucuya kendi aralığından (suppliers.spacing) sık istek gitmez', t => {
  const sb = sandbox(t);
  sb.rates(40, 46);
  const A = 'tedarikci-bir.example', B = 'tedarikci-iki.example';
  const url = (host, id) => `https://${host}/urun/${id}`;
  const sources = {
    'vgm-9001': [src(url(A, 'vgm-9001'))], 'vgm-9002': [src(url(A, 'vgm-9002'))], 'vgm-9003': [src(url(A, 'vgm-9003'))],
    'vgm-9004': [src(url(B, 'vgm-9004'))], 'vgm-9005': [src(url(B, 'vgm-9005'))],
  };
  for (const [id, list] of Object.entries(sources)) sb.page(list[0].url, ld({ mpn: MPN[id], price: GOOD[id] }));
  fs.writeFileSync(path.join(sb.pages, 'getirme.log'), '');
  const config = cfg(sources, { suppliers: { [A]: { spacing: 1 }, [B]: { spacing: 0.4 } } });
  const r = sb.refresh({ config, opts: { ids: null, budget: 30 } });
  assert.deepEqual(pick(r.summary, ['checked', 'ok', 'left', 'skipped', 'due']), { checked: 5, ok: 5, left: 0, skipped: 0, due: 5 });
  const log = fs.readFileSync(path.join(sb.pages, 'getirme.log'), 'utf8').trim().split('\n').map(l => { const [at, host] = l.split(' '); return { at: Number(at), host }; });
  assert.deepEqual(log.map(x => x.host), [A, B, B, A, A], 'A beklerken B işlenir (sıra: öncelik + hazır olan sunucu)');
  const gaps = host => log.filter(x => x.host === host).map((x, i, all) => (i ? x.at - all[i - 1].at : null)).filter(v => v !== null);
  for (const g of gaps(A)) assert.ok(g >= 0.99, `A aralığı ${g}`);
  for (const g of gaps(B)) assert.ok(g >= 0.39, `B aralığı ${g}`);
  assert.ok(log[1].at - log[0].at < 0.5, 'ikinci istek ilk sunucunun aralığını beklemez (başka sunucu)');
});

test('zamanlayıcı: pencere sunucu başına kuyruklanır; sıra başını tek tedarikçi doldursa da diğer sunucu aynı çalışmada işlenir', t => {
  const sb = sandbox(t);
  sb.rates(40, 46);
  const A = 'tedarikci-bir.example', B = 'tedarikci-iki.example';
  // A'da sıra başında 80 ürün (hiç denenmemiş; pencere en çok 50 = max(50, max x 2)); B'nin tek ürünü sıranın sonunda
  const sources = {};
  for (let i = 0; i < 80; i++) { const id = `vgm-${1000 + i}`; sources[id] = [src(`https://${A}/urun/${id}`)]; }
  sources['vgm-9005'] = [src(`https://${B}/urun/vgm-9005`)];
  sb.page(sources['vgm-9005'][0].url, ld({ mpn: MPN['vgm-9005'], price: GOOD['vgm-9005'] }));
  const r = sb.refresh({ config: cfg(sources, { suppliers: { [A]: { spacing: 1 } } }), opts: { ids: null, budget: 5, max: 2 } });
  assert.equal(r.prices.items['vgm-9005'] && r.prices.items['vgm-9005'].status, 'ok', 'B sunucusu aynı çalışmada getirildi');
  assert.equal(r.summary.due, 81);
  // A için en çok ceil(5 / 1) + 20 = 25 ürün pencereye alındı (geri kalanlar sonraki çalışmaya)
  assert.equal(r.summary.left, 81 - 26);
});

test('zamanlayıcı: kalıcı hatalı ürünler sunucunun kapasitesini tüketmez; 48 saate yaklaşan doğrulanmış ürün önce alınır', t => {
  const sb = sandbox(t);
  const std = standard(sb);
  const H = 3600;
  const failing = id => ({ status: 'error', note: 'identity_mismatch', lastAttemptAt: now() - 3 * H, history: [[now() - 3 * H, null, 'error']] });
  const prices = { version: 1, lastRunAt: null, lastRunSummary: null, items: {
    'vgm-9001': failing('vgm-9001'), 'vgm-9002': failing('vgm-9002'), 'vgm-9003': failing('vgm-9003'),
    'vgm-9004': okItem('vgm-9004', { checkedAt: now() - 46 * H, lastAttemptAt: now() - 46 * H }) } };
  sb.page(pageUrl('vgm-9004'), ld({ mpn: MPN['vgm-9004'], price: '1850', currency: 'USD' }));
  // bir çalışmada tek getirme: hiç doğrulanamamış 3 ürün (ve hiç denenmemiş vgm-9005 dışında) değil, 46 saatlik ürün
  sb.status(pageUrl('vgm-9005'), 404);
  const rate = { version: 1, usdTry: 40, eurTry: 46, date: new Date().toISOString().slice(0, 10), fetchedAt: now(), source: 'test' };
  let r = sb.refresh({ config: std.config, prices, rate, opts: { ids: null, max: 2, spacing: 0, rates: false } });
  const attempted = Object.keys(r.prices.items).filter(id => (r.prices.items[id].lastAttemptAt || 0) >= now() - 60).sort();
  assert.deepEqual(attempted, ['vgm-9004', 'vgm-9005'], 'önce hiç denenmemiş, sonra 48 saate yakın doğrulanmış ürün');
  assert.ok(r.prices.items['vgm-9004'].checkedAt >= now() - 60);
});

test('zamanlayıcı: son tarihte durur, işlenenler parça parça kaydedilir, kalanlar sonraki çalışmaya kalır', t => {
  const sb = sandbox(t);
  sb.rates(40, 46);
  const ids = ['vgm-9001', 'vgm-9002', 'vgm-9003', 'vgm-9004', 'vgm-9005'];
  const sources = Object.fromEntries(ids.map((id, i) => [id, [src(`https://tedarikci-${i + 1}.example/urun/${id}`)]]));
  for (const id of ids) sb.page(sources[id][0].url, ld({ mpn: MPN[id], price: GOOD[id] }));
  fs.writeFileSync(path.join(sb.pages, 'gecikme'), '0.6');
  // parallel: 1 -> sunucular sırayla (eş zamanlılık testi ayrı); kur hazır (gecikme kur getirmesine de uygulanır);
  // 1,5 sn bütçede 0,6 sn'lik 2-3 getirme
  const rate = { version: 1, usdTry: 40, eurTry: 46, date: new Date().toISOString().slice(0, 10), fetchedAt: now(), source: 'test' };
  const r = sb.refresh({ config: cfg(sources), rate, opts: { ids: null, budget: 1.5, parallel: 1, rates: false } });
  const s = r.summary;
  assert.ok(s.checked >= 2 && s.checked <= 3, `kontrol edilen ${s.checked}`);
  assert.equal(s.checked + s.left, 5); assert.equal(s.skipped, 0);
  assert.ok(s.seconds <= 3, `süre ${s.seconds}`);
  const done = Object.keys(r.prices.items).filter(id => r.prices.items[id].status === 'ok');
  assert.equal(done.length, s.checked, 'işlenen her ürün kaydedildi');
  assert.deepEqual(Object.keys(r.queue).sort(), ids);
  assert.equal(ids.filter(id => r.queue[id][0] > 0).length, s.checked);
  assert.ok(Math.abs(r.prices.lastRunAt - now()) <= 15, 'kalp atışı yazıldı');
  // sonraki çalışma kalanları (hiç denenmemiş) önce alır
  fs.rmSync(path.join(sb.pages, 'gecikme'));
  const r2 = sb.refresh({ opts: { ids: null, budget: 30, spacing: 0 } });
  assert.deepEqual(pick(r2.summary, ['checked', 'left', 'due']), { checked: 5 - s.checked, left: 0, due: 5 - s.checked });
});

test('zamanlayıcı: farklı sunucular eş zamanlı getirilir (curl_multi); aynı sunucuda tek istek ve aralık korunur', t => {
  const sb = sandbox(t);
  sb.rates(40, 46);
  const ids = ['vgm-9001', 'vgm-9002', 'vgm-9003', 'vgm-9004', 'vgm-9005'];
  // 4 farklı sunucu + vgm-9005 dördüncü sunucuda (aynı sunucuya ikinci istek, aralık 0,3 sn)
  const hostOf = i => `https://tedarikci-${Math.min(i + 1, 4)}.example/urun/`;
  const sources = Object.fromEntries(ids.map((id, i) => [id, [src(hostOf(i) + id)]]));
  for (const id of ids) sb.page(sources[id][0].url, ld({ mpn: MPN[id], price: GOOD[id] }));
  fs.writeFileSync(path.join(sb.pages, 'gecikme'), '0.5');
  fs.writeFileSync(path.join(sb.pages, 'getirme.log'), '');
  const rate = { version: 1, usdTry: 40, eurTry: 46, date: new Date().toISOString().slice(0, 10), fetchedAt: now(), source: 'test' };
  const r = sb.refresh({ config: cfg(sources), rate, opts: { ids: null, budget: 10, spacing: 0.3, rates: false } });
  assert.deepEqual(pick(r.summary, ['checked', 'ok', 'left', 'fetches']), { checked: 5, ok: 5, left: 0, fetches: 5 });
  assert.ok(r.summary.seconds < 1.6, `eş zamanlı: ${r.summary.seconds} sn (sırayla en az 2,5 sn olurdu)`);
  const log = fs.readFileSync(path.join(sb.pages, 'getirme.log'), 'utf8').trim().split('\n').map(l => { const [at, host] = l.split(' '); return { at: Number(at), host }; });
  const first = log.slice(0, 4);
  assert.deepEqual(new Set(first.map(x => x.host)).size, 4, 'ilk 4 istek 4 ayrı sunucuya');
  assert.ok(first[3].at - first[0].at < 0.3, 'dört istek birlikte başlar');
  const same = log.filter(x => x.host === 'tedarikci-4.example');
  assert.equal(same.length, 2);
  assert.ok(same[1].at - same[0].at >= 0.5 + 0.3 - 0.02, `aynı sunucuda ikinci istek ilkinin bitişi + aralık sonrası: ${same[1].at - same[0].at}`);
  // ayrıştırma hataları eş zamanlı akışta doğru ürüne yazılır
  for (const id of ids) assert.equal(r.prices.items[id].status, 'ok', id);
  assert.equal(r.prices.items['vgm-9004'].costTry, 88800);
});

test('zamanlayıcı: katalogdan kaldırılmış ürün getirilmez ve sıradan silinir', t => {
  const sb = sandbox(t);
  sb.rates(40, 46);
  sb.page(pageUrl('vgm-9001'), ld({ mpn: 'DM-450', price: GOOD['vgm-9001'] }));
  const r = sb.refresh({ config: cfg({ 'vgm-9001': [src(pageUrl('vgm-9001'))], 'vgm-9998': [src(pageUrl('vgm-9998'))] }), opts: { ids: null, spacing: 0 } });
  assert.deepEqual(pick(r.summary, ['checked', 'ok', 'skipped', 'due']), { checked: 1, ok: 1, skipped: 1, due: 2 });
  assert.deepEqual(Object.keys(r.queue), ['vgm-9001']);
});

test('eski tek dosyalı özel veri (kaynaklar.json içinde sources + fiyatlar.json) ilk kullanımda parçalara taşınır', t => {
  const sb = sandbox(t);
  const sources = { 'vgm-9001': [src(pageUrl('vgm-9001'))], 'vgm-9002': [src(pageUrl('vgm-9002'), { priority: 2 })] };
  const prices = { version: 1, lastRunAt: 1790000000, lastRunSummary: { checked: 2 }, items: {
    'vgm-9001': okItem('vgm-9001'), 'vgm-9002': okItem('vgm-9002', { status: 'held', held: { costTry: 1 } }) } };
  const r = run({ op: 'legacy', config: cfg(sources, { open: true, margin: { default: 0.2, byCategory: {}, byProduct: {} } }), prices }, sb.env);
  assert.ok(!r.files.includes('fiyatlar.json'), 'fiyatlar.json taşındıktan sonra silinir');
  for (const f of ['kaynaklar.json', 'kaynak/0090.json', 'fiyat/0090.json', 'fiyat-sira.json', 'fiyat-durum.json']) assert.ok(r.files.includes(f), f);
  assert.equal(r.config.open, true); assert.equal(r.config.margin.default, 0.2); assert.equal(r.config.sources, undefined);
  assert.deepEqual(Object.keys(r.sources), ['vgm-9001', 'vgm-9002']);
  assert.equal(r.sources['vgm-9002'][0].url, pageUrl('vgm-9002'));
  assert.equal(r.prices.items['vgm-9001'].costTry, COST['vgm-9001'][0]);
  assert.equal(r.prices.lastRunAt, 1790000000);
  assert.deepEqual(r.prices.problems, { 'vgm-9002': 'held' });
  assert.deepEqual(Object.keys(r.queue).sort(), ['vgm-9001', 'vgm-9002']);
  const raw = JSON.parse(fs.readFileSync(path.join(sb.data, 'magaza', 'kaynaklar.json'), 'utf8'));
  assert.equal(raw.sources, undefined, 'ayarlar dosyasında kaynak kalmaz');
});
