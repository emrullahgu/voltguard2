'use strict';
// Mağaza yönetim CLI'si (tools/magaza-admin.php) gerçek PHP ile, geçici veri klasöründe ve sentetik katalog/satıcıyla;
// ayrıca personel panelinin (js/hesap-magaza-panel.js) saf yardımcıları ve sayfanın statik güvenlik/kablolama denetimleri.
// Çalıştırma: VG_PHP=<php.exe> node --test tools/tests/magaza-admin.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const ozel = require('./fixtures/magaza/ozel.cjs');

const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || [path.join(root, '.qa/php/runtime/php.exe'), path.resolve(root, '../../../.qa/php/runtime/php.exe')].find(f => fs.existsSync(f)) || path.join(root, '.qa/php/runtime/php.exe');   // git worktree: ana kopyanın .qa/php'si
const cli = path.join(root, 'tools/magaza-admin.php');
const lib = path.join(root, 'api/lib') + path.sep;
const fixtures = path.join(__dirname, 'fixtures/magaza');
const panelJs = path.join(root, 'js/hesap-magaza-panel.js');
const panelCss = path.join(root, 'css/magaza-panel.css');
const panelHtml = path.join(root, 'hesap/magaza-panel.html');
const hasOrderModule = fs.existsSync(path.join(root, 'api/lib/magaza-siparis.php'));
const hasApiModule = fs.existsSync(path.join(root, 'api/lib/magaza-api.php'));
const hasSourceModule = fs.existsSync(path.join(root, 'api/lib/magaza-kaynak.php'));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-magaza-admin-'));
const emptyFixtureDir = path.join(scratch, 'bos-fixture');   // VG_MAGAZA_FIXTURE_DIR: ağa hiç çıkılmaz
fs.mkdirSync(emptyFixtureDir);
let counter = 0;
const tmp = () => fs.mkdtempSync(path.join(scratch, 'veri-'));
const write = (name, value) => {
  const file = path.join(scratch, `${++counter}-${name}`);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return file;
};

function env(data, extra = {}) {
  return {
    ...process.env, VG_STORE: 'json', VG_DATA_DIR: data, VG_MAIL_OUTBOX: '', VG_SITE_URL: '',
    VG_MAGAZA_CATALOG: path.join(fixtures, 'katalog'), VG_MAGAZA_FIRMA: path.join(fixtures, 'firma-tam.json'),
    VG_MAGAZA_FIXTURE_DIR: emptyFixtureDir, ...extra,
  };
}
function run(data, args, options = {}) {
  const r = spawnSync(php, ['-n', options.cli || cli, ...args], {env: env(data, options.env), encoding: 'utf8', windowsHide: true, timeout: 60000});
  return {status: r.status, out: r.stdout || '', err: r.stderr || ''};
}
/** Çekirdek kitaplıkla küçük bir PHP parçası çalıştırır (hesap/sipariş/durum dosyası hazırlamak için). */
function runPhp(data, body, args = []) {
  const file = write('parca.php', `<?php
declare(strict_types=1);
define('VG_API', 1);
foreach (['bootstrap', 'store', 'security', 'validate', 'mailer', 'magaza'] as $f) { require_once $argv[1] . $f . '.php'; }
array_splice($argv, 1, 1);
${body}
`);
  const r = spawnSync(php, ['-n', file, lib, ...args], {env: env(data), encoding: 'utf8', windowsHide: true, timeout: 60000});
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  return r.stdout;
}
function seedMember(data, email, name = 'Panel Personeli') {
  const id = runPhp(data, `$id = 'u' . bin2hex(random_bytes(12));
echo vg_store()->insertUser(['id' => $id, 'email' => $argv[1], 'name' => $argv[2], 'pass' => 'x', 'epoch' => 1, 'created_at' => time(), 'updated_at' => time()]) ? $id : 'FAILED';`, [email, name]).trim();
  assert.match(id, /^u[a-f0-9]{24}$/);
  return id;
}
/** data/magaza/<name> dosyasını çekirdeğin kendi yazıcısıyla (kilit + atomik) yazar. */
function seedFile(data, name, state) {
  runPhp(data, `$name = $argv[1];
$state = json_decode((string)file_get_contents($argv[2]), true);
vgm_locked(true, function (string $dir) use ($name, $state): void { vgm_write($dir, $name, $state, 33554432); });`, [name, write(name, state)]);
}
test.after(() => { try { fs.rmSync(scratch, {recursive: true, force: true}); } catch { /* geçici klasör temizlenemezse sorun değil */ } });
const privateFile = (data, name) => path.join(data, 'magaza', name);
const readPrivate = (data, name) => JSON.parse(fs.readFileSync(privateFile(data, name), 'utf8'));
const panelUsers = data => readPrivate(data, 'panel.json').users;   // boşken PHP [] yazar: Object.keys ile say

const NOW = () => Math.floor(Date.now() / 1000);
const REF_A = 'VGS-261027-ABCDE';
const REF_B = 'VGS-261027-FGHJK';
const SUPPLIER_HOST = 'tedarikci-gizli.example';
function orderRecord(ref, status, extra = {}) {
  const now = NOW();
  return {
    ref, createdAt: now - 7200, payBy: now - 3600, status,
    customer: {name: 'Sentetik Müşteri', email: 'musteri@example.test', phone: '05320000000'},
    billing: {type: 'bireysel', name: 'Sentetik Müşteri', tckn: '11111111110', company: '', taxOffice: '', vkn: '', address: 'Test Mah. 1', city: 'İzmir', district: 'Bornova'},
    shippingAddress: {name: 'Sentetik Müşteri', phone: '05320000000', address: 'Test Mah. 1', city: 'İzmir', district: 'Bornova', postalCode: '35000'},
    notes: '',
    items: [{id: 'vgm-9001', name: 'Sentetik Güneş Paneli 500 W', brand: 'Sentetik', mpn: 'SP-500', qty: 2, unit: 'adet', vat: 20,
      unitUsdNet: 100, unitTryNet: 4100, unitTryGross: 4920, lineTryNet: 8200, lineTryGross: 9840}],
    totals: {tryNet: 8200, tryVat: 1640, shippingTry: 0, tryGross: 9840, usdNet: 200}, rate: {usdTry: 41, date: '2026-10-27'},
    consents: {preInfo: now - 7200, contract: now - 7200, docVersion: '2026-10-27', ipHash: 'x'},
    docs: {preInfo: 'Ön bilgilendirme (sentetik)', contract: 'Sözleşme (sentetik)'},
    history: [{at: now - 7200, status: 'odeme_bekleniyor', by: 'müşteri', note: '', publicNote: ''}], tracking: null,
    private: {sources: {'vgm-9001': [{supplier: SUPPLIER_HOST, url: `https://${SUPPLIER_HOST}/urun-9001`, costTry: 3000, checkedAt: now - 3600}]}},
    ...extra,
  };
}
const seedOrders = (data, ...records) => seedFile(data, 'siparisler.json', {version: 1, orders: Object.fromEntries(records.map(o => [o.ref, o]))});

/** magaza-siparis/kaynak/api modülleri olmayan bir kopya: yoklukta açık hata verdiğini ve çekirdek yedeğini denetlemek için. */
function bareCli() {
  const dir = fs.mkdtempSync(path.join(scratch, 'kopya-'));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.mkdirSync(path.join(dir, 'api/lib'), {recursive: true});
  fs.copyFileSync(cli, path.join(dir, 'tools/magaza-admin.php'));
  for (const f of ['bootstrap', 'store', 'security', 'validate', 'mailer', 'magaza']) fs.copyFileSync(path.join(lib, `${f}.php`), path.join(dir, 'api/lib', `${f}.php`));
  return path.join(dir, 'tools/magaza-admin.php');
}

/* ======================================================================== CLI */

test('PHP lint passes and unusual invocations exit 2 without touching data', () => {
  const lint = spawnSync(php, ['-n', '-l', cli], {encoding: 'utf8', windowsHide: true});
  assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  const data = tmp();
  const cases = [[], ['yok-komut'], ['grant'], ['grant', 'gecersiz-eposta'], ['revoke'], ['revoke', 'a@b'], ['list', 'fazla'], ['import'], ['import', 'a', 'b'],
    ['order'], ['order', 'kisa'], ['set-status', REF_A], ['set-status', REF_A, 'olmayan-durum'], ['set-status', 'kisa', 'kargoda'],
    ['set-status', REF_A, 'kargoda', '--tracking', 'SadeceFirma'], ['set-status', REF_A, 'kargoda', '--tracking', 'Firma|Kod|http://guvensiz.example'],
    ['set-status', REF_A, 'kargoda', '--bilinmeyen'], ['set-status', REF_A, 'kargoda', '--note'], ['orders', '--status', 'bogus'], ['orders', '--bilinmeyen'],
    ['orders', 'fazla'], ['check', '--product', 'vgm-0000'], ['check', '--product', 'abc'], ['status', 'fazla'], ['export-config', 'fazla']];
  for (const args of cases) {
    const r = run(data, args);
    assert.equal(r.status, 2, `${args.join(' ')} -> ${r.status}\n${r.err}`);
  }
  const help = run(data, ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.out, /php tools\/magaza-admin\.php grant/);
  const noDir = spawnSync(php, ['-n', cli, 'list'], {env: {...process.env, VG_DATA_DIR: ''}, encoding: 'utf8', windowsHide: true});
  assert.equal(noDir.status, 2);
  assert.match(noDir.stderr, /VG_DATA_DIR/);
  assert.equal(fs.existsSync(path.join(data, 'magaza')), false, 'usage errors must not create private data');
});

test('grant, list and revoke resolve members by e-mail and are idempotent', () => {
  const data = tmp();
  const email = 'personel@example.test';
  const id = seedMember(data, email);
  let r = run(data, ['list']);
  assert.equal(r.status, 0);
  assert.match(r.out, /yetkilisi yok/);

  r = run(data, ['grant', 'Personel@Example.Test']);   // büyük/küçük harf normalize edilir
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /yetkisi verildi/);
  assert.equal(readPrivate(data, 'panel.json').users[id].email, email);
  const grantedAt = readPrivate(data, 'panel.json').users[id].grantedAt;
  assert.ok(Number.isInteger(grantedAt) && grantedAt > 1700000000);

  r = run(data, ['grant', email]);
  assert.equal(r.status, 0);
  assert.match(r.out, /zaten/);
  assert.equal(readPrivate(data, 'panel.json').users[id].grantedAt, grantedAt, 'a repeated grant keeps the original grant time');

  r = run(data, ['list']);
  assert.match(r.out, new RegExp(`${id}\\s+${email}`));

  r = run(data, ['grant', 'yok@example.test']);
  assert.equal(r.status, 1);
  assert.match(r.err, /Hesap bulunamadı/);
  r = run(data, ['revoke', 'yok@example.test']);
  assert.equal(r.status, 1);

  r = run(data, ['revoke', email]);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /geri alındı/);
  assert.deepEqual(Object.keys(panelUsers(data)), []);
  r = run(data, ['revoke', email]);
  assert.equal(r.status, 0);
  assert.match(r.out, /zaten yoktu/);
  assert.match(run(data, ['list']).out, /yetkilisi yok/);

  // Hesap silinmiş olsa bile yetki kaydı e-postayla temizlenebilir.
  seedFile(data, 'panel.json', {version: 1, users: {u0123456789abcdef01234567: {email: 'silinmis@example.test', grantedAt: 1700000000}}});
  r = run(data, ['revoke', 'silinmis@example.test']);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(Object.keys(panelUsers(data)), []);
});

test('grant refuses beyond the panel member limit', () => {
  const data = tmp();
  const users = {};
  for (let i = 0; i < 25; i++) users[`u${String(i).padStart(24, '0')}`] = {email: `kayitli${i}@example.test`, grantedAt: 1700000000};
  seedFile(data, 'panel.json', {version: 1, users});
  seedMember(data, 'yirmialtinci@example.test');
  const r = run(data, ['grant', 'yirmialtinci@example.test']);
  assert.equal(r.status, 1);
  assert.match(r.err, /sınır/);
  assert.equal(Object.keys(readPrivate(data, 'panel.json').users).length, 25);
});

const goodConfig = () => ({
  version: 1, open: false, margin: {default: 0.2, byCategory: {inverterler: 0.1}, byProduct: {'vgm-9001': 0.25}},
  shipping: {feeTry: 120, freeOverTry: 5000}, paymentHours: 48, fxBuffer: 0.01, blockedSuppliers: ['kotu-tedarikci.example'],
  sources: {
    'vgm-9001': [
      {url: 'https://tedarikci-b.example/urun-1', supplier: 'www.tedarikci-b.example', vatIncluded: false, currency: 'USD', priority: 2},
      {url: 'https://tedarikci-a.example/urun-1', supplier: 'tedarikci-a.example', vatIncluded: true, currency: 'TRY', priority: 1, discount: 0.05},
    ],
    'vgm-9002': [{url: 'https://tedarikci-a.example/urun-2', supplier: 'tedarikci-a.example', vatIncluded: true, currency: 'TRY'}],
  },
});

test('import prints every validation error and writes nothing', () => {
  const data = tmp();
  const bad = {
    version: 2, open: false, margin: {default: 1.5, byCategory: {'yok-kategori': 0.1}, byProduct: {'vgm-0000': 0.1, 'vgm-9002': 'yuzde'}},
    paymentHours: 0, fxBuffer: 0.9, blockedSuppliers: ['kotu-tedarikci.example', 'gecersiz alan'],
    sources: {
      'vgm-0000': [{url: 'https://a.example/x', supplier: 'a.example', vatIncluded: true, currency: 'TRY'}],
      'vgm-9001': [{url: 'http://a.example/x', supplier: 'a.example', vatIncluded: true, currency: 'TRY'}],
      'vgm-9002': [{url: 'https://b.example/x', supplier: 'baska.example', vatIncluded: true, currency: 'TRY'}],
      'vgm-9003': [{url: 'https://www.kotu-tedarikci.example/x', supplier: 'kotu-tedarikci.example', vatIncluded: true, currency: 'TRY'}],
      'vgm-9004': [{url: 'https://c.example/x', supplier: 'c.example', vatIncluded: true, currency: 'GBP'}],
      'vgm-9005': [{url: 'https://c.example/y', supplier: 'c.example', vatIncluded: true, currency: 'TRY', discount: 0.9}],
    },
  };
  const r = run(data, ['import', write('kotu.json', bad)]);
  assert.equal(r.status, 1);
  for (const expected of [
    /version: 1 olmalı/, /margin\.default: 0 ile 1 arasında olmalı/, /margin\.byCategory: bilinmeyen kategori yok-kategori/, /margin\.byProduct: bilinmeyen ürün vgm-0000/,
    /margin\.byProduct\.vgm-9002: sayı olmalı/, /paymentHours: 1–168/, /fxBuffer: 0 ile 0\.1 arasında olmalı/, /blockedSuppliers: geçersiz alan adı/,
    /sources: bilinmeyen ürün vgm-0000/, /sources\.vgm-9001\[0\]: https adresi olmalı/, /sources\.vgm-9002\[0\]: supplier alan adı adresle aynı olmalı \(b\.example\)/,
    /sources\.vgm-9003\[0\]: kotu-tedarikci\.example engelli tedarikçi listesinde/, /sources\.vgm-9004\[0\]: currency TRY\/USD\/EUR olmalı/,
    /sources\.vgm-9005\[0\]\.discount: 0 ile 0\.5 arasında olmalı/,
  ]) assert.match(r.err, expected);
  assert.match(r.err, /\d+ hata var; hiçbir şey yazılmadı/);
  assert.equal(fs.existsSync(privateFile(data, 'kaynaklar.json')), false, 'a failed import must not write kaynaklar.json');

  for (const [name, content, pattern] of [['bozuk.json', '{"version": 1,', /Geçersiz JSON/], ['liste.json', '"düz metin"', /Geçersiz JSON/]]) {
    const failed = run(data, ['import', write(name, content)]);
    assert.equal(failed.status, 1);
    assert.match(failed.err, pattern);
  }
  const missing = run(data, ['import', path.join(scratch, 'yok-dosya.json')]);
  assert.equal(missing.status, 1);
  assert.match(missing.err, /okunamadı/);
  assert.equal(fs.existsSync(privateFile(data, 'kaynaklar.json')), false);
});

test('import writes a clean config; export-config round-trips it byte for byte', () => {
  const data = tmp();
  const file = write('iyi.json', goodConfig());
  const dry = run(data, ['import', file, '--dry-run']);
  assert.equal(dry.status, 0, dry.err);
  assert.match(dry.out, /yazılmadı/);
  assert.equal(fs.existsSync(privateFile(data, 'kaynaklar.json')), false, '--dry-run must not write');

  const imported = run(data, ['import', file]);
  assert.equal(imported.status, 0, imported.err);
  assert.match(imported.out, /içe aktarıldı: 2 üründe toplam 3 kaynak, mağaza kapalı/);
  assert.match(imported.out, /3 üründe kaynak yok/);
  const settings = readPrivate(data, 'kaynaklar.json');
  assert.equal('sources' in settings, false, 'sources live in kaynak/<shard>.json, not in kaynaklar.json');
  assert.deepEqual(fs.readdirSync(privateFile(data, 'kaynak')), ['0090.json']);
  const stored = ozel.readConfig(data);
  assert.equal(stored.version, 1);
  assert.equal(stored.margin.default, 0.2);
  assert.equal(stored.margin.byCategory.inverterler, 0.1);
  assert.equal(stored.paymentHours, 48);
  assert.deepEqual(stored.blockedSuppliers, ['kotu-tedarikci.example']);
  assert.deepEqual(stored.sources['vgm-9001'].map(s => [s.supplier, s.priority, s.currency, s.vatIncluded, s.discount]),
    [['tedarikci-a.example', 1, 'TRY', true, 0.05], ['tedarikci-b.example', 2, 'USD', false, 0]], 'sources are sorted by priority and www. is stripped');

  const exported = run(data, ['export-config']);
  assert.equal(exported.status, 0, exported.err);
  const config = JSON.parse(exported.out);
  assert.deepEqual(config, stored);
  const reimport = run(data, ['import', write('disa-aktarilan.json', exported.out)]);
  assert.equal(reimport.status, 0, reimport.err);
  assert.equal(run(data, ['export-config']).out, exported.out, 'import(export-config) must be a no-op');

  const fresh = run(tmp(), ['export-config']);   // dosya yokken varsayılanlar; boş haritalar {} olarak çıkar
  assert.equal(fresh.status, 0);
  const defaults = JSON.parse(fresh.out);
  assert.equal(defaults.open, false);
  assert.match(fresh.out, /"sources": \{\}/);
  assert.match(fresh.out, /"byCategory": \{\}/);
  assert.equal(run(tmp(), ['import', write('varsayilan.json', fresh.out)]).status, 0, 'the default export must itself be importable');
});

test('import warns when the shop is opened without a complete seller identity', () => {
  const data = tmp();
  const firma = JSON.parse(fs.readFileSync(path.join(fixtures, 'firma-tam.json'), 'utf8'));
  firma.mersis = null;
  const incomplete = write('firma-eksik.json', firma);
  const open = {...goodConfig(), open: true};
  const warned = run(data, ['import', write('acik.json', open)], {env: {VG_MAGAZA_FIRMA: incomplete}});
  assert.equal(warned.status, 0, warned.err);
  assert.match(warned.out, /UYARI/);
  assert.match(warned.out, /mersis/);
  const clean = run(tmp(), ['import', write('acik2.json', open)]);
  assert.equal(clean.status, 0);
  assert.doesNotMatch(clean.out, /UYARI/);
  assert.match(clean.out, /mağaza AÇIK/);
});

test('status mirrors panel_status (same function) and reports health, rate and orders', { skip: !hasApiModule }, () => {
  const data = tmp();
  let r = run(data, ['status', '--json']);
  assert.equal(r.status, 0, r.err);
  const s = JSON.parse(r.out);
  for (const key of ['open', 'firmaMissing', 'rate', 'cron', 'counts', 'orders']) assert.ok(key in s, key);
  assert.equal(s.open, false);
  assert.deepEqual(s.firmaMissing, []);
  assert.equal(s.rate, null);
  assert.equal(s.cron.healthy, false);
  assert.equal(s.counts.noSource, 5);
  assert.deepEqual(s.orders, {awaitingPayment: 0, overdue: 0});
  assert.match(run(data, ['status']).out, /KAPALI/);

  assert.equal(run(data, ['import', write('kaynak.json', goodConfig())]).status, 0);
  const now = NOW();
  const day = new Date(now * 1000 + 3 * 3600 * 1000).toISOString().slice(0, 10);
  seedFile(data, 'kur.json', {version: 1, usdTry: 41.1234, date: day, fetchedAt: now - 60, source: 'TCMB today.xml ForexSelling'});
  ozel.writePrices(data, {items: {}, lastRunAt: now - 600, lastRunSummary: {checked: 2, ok: 2, held: 0, error: 0, unavailable: 0, skipped: 0, rateUpdated: true, seconds: 3.2}});
  seedOrders(data, orderRecord(REF_A, 'odeme_bekleniyor'), orderRecord(REF_B, 'odeme_bekleniyor', {payBy: now + 3600}));
  r = run(data, ['status', '--json']);
  const t = JSON.parse(r.out);
  assert.equal(t.rate.ok, true);
  assert.equal(t.rate.usdTry, 41.1234);
  assert.equal(t.cron.healthy, true);
  assert.equal(t.counts.noSource, 3);
  assert.deepEqual(t.orders, {awaitingPayment: 2, overdue: 1});
  const text = run(data, ['status']).out;
  assert.match(text, /41,1234 ₺/);
  assert.match(text, /sağlıklı/);
  assert.match(text, /ödeme bekleyen 2, ödeme süresi geçen 1/);
  assert.doesNotMatch(text, /tedarikci-a\.example/, 'status output must not print supplier hosts');
});

test('check validates the product and reports a missing rate without touching the network', { skip: !hasSourceModule }, () => {
  const data = tmp();
  assert.equal(run(data, ['import', write('kaynak.json', goodConfig())]).status, 0);
  const r = run(data, ['check', '--product', 'vgm-9001']);   // fixture klasörü boş: TCMB kuru yok -> kontrol yapılamaz
  assert.equal(r.status, 1);
  assert.match(r.err, /kur alınamadı/i);
  assert.match(r.out, /Kontrol tamamlandı/);
  assert.match(r.out, /kontrol edilen 0/);
});

test('order commands list, show and update orders through the shared order functions', { skip: !hasOrderModule }, () => {
  const data = tmp();
  seedOrders(data, orderRecord(REF_A, 'odeme_bekleniyor'), orderRecord(REF_B, 'odeme_alindi', {createdAt: NOW() - 100}));
  let r = run(data, ['orders']);
  assert.equal(r.status, 0, r.err);
  assert.ok(r.out.indexOf(REF_B) < r.out.indexOf(REF_A), 'newest order first');
  assert.match(r.out, /9\.840,00 ₺/);
  assert.match(r.out, new RegExp(`${REF_A}.*ÖDEME SÜRESİ GEÇTİ`));
  assert.doesNotMatch(r.out.split('\n').find(line => line.includes(REF_B)), /GEÇTİ/);
  assert.match(r.out, /2 sipariş/);
  assert.match(run(data, ['orders', '--status', 'odeme_alindi']).out, new RegExp(REF_B));
  assert.doesNotMatch(run(data, ['orders', '--status', 'odeme_alindi']).out, new RegExp(REF_A));
  assert.match(run(data, ['orders', '--status=kargoda']).out, /Sipariş yok/);

  r = run(data, ['order', REF_A.toLowerCase()]);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Sentetik Müşteri/);
  assert.match(r.out, /Tedarik kaynakları \(gizli\)/);
  assert.match(r.out, new RegExp(SUPPLIER_HOST));
  assert.doesNotMatch(r.out, /11111111110/, 'the TCKN is masked in the text view');
  assert.match(r.out, /\*+10/);
  const json = JSON.parse(run(data, ['order', REF_A, '--json']).out);
  assert.equal(json.ref, REF_A);
  assert.equal(json.billing.tckn, '11111111110');
  assert.equal(run(data, ['order', 'VGS-261027-ZZZZZ']).status, 1);

  // Geçersiz geçiş, gerekçesiz iptal, takipsiz kargo reddedilir; geçerli akış ilerler.
  r = run(data, ['set-status', REF_A, 'teslim_edildi']);
  assert.equal(r.status, 1);
  assert.match(r.err, /invalid_transition/);
  r = run(data, ['set-status', REF_A, 'iptal']);
  assert.equal(r.status, 1);
  assert.match(r.err, /note_required/);
  r = run(data, ['set-status', REF_A, 'odeme_alindi', '--note', 'Havale geldi', '--public-note', 'Odemeniz alindi.']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Ödeme alındı/);
  r = run(data, ['set-status', REF_A, 'tedarikte']);
  assert.equal(r.status, 0, r.err);
  r = run(data, ['set-status', REF_A, 'kargoda']);
  assert.equal(r.status, 1);
  assert.match(r.err, /tracking_required/);
  r = run(data, ['set-status', REF_A, 'kargoda', '--tracking', 'Test Kargo|TK123456|https://takip.example/TK123456']);
  assert.equal(r.status, 0, r.err);
  const shipped = JSON.parse(run(data, ['order', REF_A, '--json']).out);
  assert.equal(shipped.status, 'kargoda');
  assert.deepEqual(shipped.tracking, {company: 'Test Kargo', code: 'TK123456', url: 'https://takip.example/TK123456'});
  const last = shipped.history[shipped.history.length - 1];
  assert.equal(last.by, 'Sunucu terminali');
  const paid = shipped.history.find(h => h.status === 'odeme_alindi');
  assert.equal(paid.note, 'Havale geldi');
  assert.equal(paid.publicNote, 'Odemeniz alindi.');
  assert.ok(Number.isInteger(shipped.paidAt));

  r = run(data, ['set-status', REF_B, 'iptal', '--note', 'Musteri vazgecti']);
  assert.equal(r.status, 0, r.err);
  r = run(data, ['set-status', REF_B, 'odeme_alindi']);
  assert.equal(r.status, 1, 'a cancelled order is final');
});

test('set-status --notify mails only the customer-visible note and never supplier data', { skip: !hasOrderModule }, () => {
  const data = tmp();
  seedOrders(data, orderRecord(REF_A, 'odeme_bekleniyor'));
  let r = run(data, ['set-status', REF_A, 'odeme_alindi', '--note', 'IC-NOT-GIZLI-123', '--public-note', 'Odemeniz hesabimiza ulasti.'], {env: {VG_MAIL_OUTBOX: '1'}});
  assert.equal(r.status, 0, r.err);
  assert.equal(fs.existsSync(path.join(data, 'outbox')), false, 'no e-mail without --notify');
  r = run(data, ['set-status', REF_A, 'tedarikte', '--note', 'IC-NOT-GIZLI-456', '--public-note', 'Siparisiniz hazirlaniyor.', '--notify'], {env: {VG_MAIL_OUTBOX: '1'}});
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /e-posta gönderildi/);
  const mails = fs.readdirSync(path.join(data, 'outbox')).map(f => fs.readFileSync(path.join(data, 'outbox', f), 'utf8'));
  assert.equal(mails.length, 1);
  assert.match(mails[0], /^To: musteri@example\.test/);
  assert.match(mails[0], /Siparisiniz hazirlaniyor\./);
  for (const secret of ['IC-NOT-GIZLI', SUPPLIER_HOST, 'urun-9001', '3.000,00', 'tedarikci']) assert.doesNotMatch(mails[0], new RegExp(secret.replace(/[.]/g, '\\.')), `customer e-mail leaked ${secret}`);
});

test('without the optional modules the CLI reports clearly and still lists orders from the core store', () => {
  const data = tmp();
  const bare = bareCli();
  seedOrders(data, orderRecord(REF_A, 'odeme_bekleniyor'));
  let r = run(data, ['set-status', REF_A, 'odeme_alindi'], {cli: bare});
  assert.equal(r.status, 1);
  assert.match(r.err, /magaza-siparis\.php/);
  r = run(data, ['check'], {cli: bare});
  assert.equal(r.status, 1);
  assert.match(r.err, /magaza-kaynak\.php/);
  r = run(data, ['status'], {cli: bare});
  assert.equal(r.status, 1);
  assert.match(r.err, /magaza-api\.php/);
  r = run(data, ['orders'], {cli: bare});
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, new RegExp(REF_A));
  assert.match(r.out, /ÖDEME SÜRESİ GEÇTİ/);
  r = run(data, ['order', REF_A], {cli: bare});
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Sentetik Müşteri/);
  assert.equal(readPrivate(data, 'siparisler.json').orders[REF_A].status, 'odeme_bekleniyor', 'a refused update must not change the order');
  // Üyelik ve içe aktarma yine çalışır.
  seedMember(data, 'kopya@example.test');
  assert.equal(run(data, ['grant', 'kopya@example.test'], {cli: bare}).status, 0);
  assert.equal(run(data, ['import', write('kopya.json', goodConfig())], {cli: bare}).status, 0);
});

/* ======================================================================== panel betiği: saf yardımcılar */

const panel = require(panelJs);

test('panel status labels and transitions stay identical to the server constants', () => {
  const server = JSON.parse(runPhp(tmp(), 'echo json_encode(["labels" => VGM_STATUS_LABELS, "transitions" => VGM_TRANSITIONS], JSON_UNESCAPED_UNICODE);'));
  assert.deepEqual(panel.STATUS_LABELS, server.labels);
  assert.deepEqual(panel.TRANSITIONS, server.transitions);
  assert.deepEqual(panel.STATUS_ORDER, Object.keys(server.labels));
  for (const to of Object.keys(panel.ACTIONS)) assert.ok(server.labels[to], `action ${to} is a real status`);
});

test('panel formats money (TL with KDV, staff-only USD) and dates the Turkish way', () => {
  assert.equal(panel.fmtTry(1234.5), '1.234,50 ₺');
  assert.equal(panel.fmtTry(0), '0,00 ₺');
  assert.equal(panel.fmtTry(999.999), '1.000,00 ₺');
  assert.equal(panel.fmtTry(1234567.891), '1.234.567,89 ₺');
  assert.equal(panel.fmtTry(-1234.5), '-1.234,50 ₺');
  assert.equal(panel.fmtTry(1.005), '1,01 ₺');
  assert.equal(panel.fmtTry('9840'), '9.840,00 ₺');
  for (const bad of [null, undefined, '', 'abc', NaN, Infinity]) assert.equal(panel.fmtTry(bad), '–');
  assert.equal(panel.fmtUsd(95.5), '95,50 USD');
  assert.equal(panel.fmtUsd(null), '–');
  assert.equal(panel.fmtNum(41.23456, 4), '41,2346');
  assert.equal(panel.fmtNum(7, 0), '7');
  assert.equal(panel.fmtPct(32.46), '+%32');
  assert.equal(panel.fmtPct(-7.54), '-%7,5');
  assert.equal(panel.fmtPct(null), '–');
  assert.equal(panel.pctChange(1000, 1250), 25);
  assert.equal(panel.pctChange(0, 5), null);
  assert.equal(panel.pctChange(null, 5), null);

  const utc = Date.UTC(2026, 9, 27, 11, 0, 0);
  assert.equal(panel.fmtDateTime('2026-10-27T11:00:00Z'), '27.10.2026 14:00', 'Istanbul time is UTC+3');
  assert.equal(panel.fmtDateTime(utc / 1000), '27.10.2026 14:00', 'epoch seconds (order records)');
  assert.equal(panel.fmtDateTime(utc), '27.10.2026 14:00', 'epoch milliseconds');
  assert.equal(panel.fmtDateTime(String(utc / 1000)), '27.10.2026 14:00');
  assert.equal(panel.fmtDate('2026-12-31T21:30:00Z'), '01.01.2027', 'the date rolls over at 00:00 Istanbul');
  for (const bad of [null, '', 'dün', undefined, true]) assert.equal(panel.fmtDateTime(bad), '–');
  const now = utc;
  assert.equal(panel.ageText(now - 30 * 1000, now), 'az önce');
  assert.equal(panel.ageText(now - 90 * 60 * 1000, now), '90 dakika önce');
  assert.equal(panel.ageText(now - 5 * 3600 * 1000, now), '5 saat önce');
  assert.equal(panel.ageText(now - 72 * 3600 * 1000, now), '3 gün önce');
});

test('panel offers only the allowed transitions, in a fixed order, with the right requirements', () => {
  const labels = list => panel.allowedActions(list).map(a => a.label);
  assert.deepEqual(labels(['odeme_alindi', 'iptal']), ['Ödeme alındı', 'İptal']);
  assert.deepEqual(labels(['iptal', 'iade', 'teslim_edildi']), ['Teslim edildi', 'İade', 'İptal'], 'cancel always comes last');
  assert.deepEqual(labels(['tedarikte', 'iptal']), ['Tedarikçiden sipariş verildi', 'İptal']);
  assert.deepEqual(labels(['teslim_edildi', 'odeme_bekleniyor', 'bilinmeyen', 'kargoda']), ['Kargoya verildi', 'Teslim edildi'], 'unknown/unlisted statuses never get a button');
  assert.deepEqual(labels([]), []);
  for (const bad of [null, undefined, 'iptal', {iptal: 1}]) assert.deepEqual(panel.allowedActions(bad), []);
  const byStatus = Object.fromEntries(panel.allowedActions(['kargoda', 'iade', 'iptal', 'tedarikte']).map(a => [a.status, a]));
  assert.equal(byStatus.kargoda.needsTracking, true);
  assert.equal(byStatus.tedarikte.needsTracking, false);
  assert.ok(byStatus.iptal.needsReason && byStatus.iptal.confirm && byStatus.iptal.tone === 'danger');
  assert.ok(byStatus.iade.needsReason && byStatus.iade.confirm);
  // Her sunucu durumu için düğme kümesi, sunucunun geçiş tablosuyla birebir.
  for (const status of panel.STATUS_ORDER) {
    assert.deepEqual(panel.allowedActions(panel.allowedFromStatus(status)).map(a => a.status).sort(), [...panel.TRANSITIONS[status]].sort());
  }
  assert.deepEqual(panel.allowedFromStatus('iptal'), []);
  assert.deepEqual(panel.allowedFromStatus('yok'), []);
});

test('panel validates status changes before sending them', () => {
  let c = panel.buildChange('kargoda', {company: '', code: '', url: ''}, false);
  assert.equal(c.ok, false);
  assert.ok(c.errors.company && c.errors.code);
  c = panel.buildChange('kargoda', {company: 'Yurtiçi Kargo', code: 'ABC123', url: 'http://guvensiz.example'}, false);
  assert.ok(c.errors.url && !c.ok, 'tracking links must be https');
  c = panel.buildChange('kargoda', {company: ' Yurtiçi Kargo ', code: ' ABC123 ', url: 'https://takip.example/ABC123', note: ' iç ', publicNote: 'Kargoda'}, true);
  assert.equal(c.ok, true);
  assert.deepEqual(c.body, {status: 'kargoda', notify: true, tracking: {company: 'Yurtiçi Kargo', code: 'ABC123', url: 'https://takip.example/ABC123'}, note: 'iç', publicNote: 'Kargoda'});

  c = panel.buildChange('iptal', {note: '', publicNote: ''}, false);
  assert.ok(!c.ok && /İptal için gerekçe/.test(c.errors.reason));
  c = panel.buildChange('iade', {note: ' ', publicNote: 'x'}, false);
  assert.ok(!c.ok && /İade için gerekçe/.test(c.errors.reason), 'a reason needs at least 3 characters');
  c = panel.buildChange('iptal', {note: '', publicNote: 'Müşteri vazgeçti'}, false);
  assert.equal(c.ok, true);
  assert.equal(c.body.note, 'Müşteri vazgeçti', 'a customer-visible reason is also recorded as the internal note');
  assert.equal(c.body.publicNote, 'Müşteri vazgeçti');
  c = panel.buildChange('iptal', {note: 'İç gerekçe', publicNote: 'Genel açıklama'}, false);
  assert.deepEqual([c.body.note, c.body.publicNote], ['İç gerekçe', 'Genel açıklama']);

  c = panel.buildChange('odeme_alindi', {}, false);
  assert.deepEqual(c, {ok: true, errors: {}, body: {status: 'odeme_alindi', notify: false}});
  assert.equal(panel.buildChange('odeme_alindi', {}, 'evet').body.notify, false, 'notify must be a real boolean true');
  c = panel.buildChange('', {note: '', publicNote: ''}, false);
  assert.ok(!c.ok && c.errors.note, 'a note-only update needs a note');
  c = panel.buildChange('', {note: 'Telefonda arandı'}, false);
  assert.deepEqual(c.body, {notify: false, note: 'Telefonda arandı'});
  assert.ok(!panel.buildChange('hack', {}, false).ok);
  assert.equal(panel.buildChange('odeme_alindi', {publicNote: 'a'.repeat(900)}, false).body.publicNote.length, 600, 'public note is capped like the server (600)');
  assert.equal(panel.buildChange('', {note: 'b'.repeat(1500)}, false).body.note.length, 1000);
});

test('panel overdue logic follows the server flag, else payBy while awaiting payment', () => {
  const now = Date.UTC(2026, 9, 27, 12, 0, 0);
  const past = new Date(now - 3600 * 1000).toISOString();
  const future = new Date(now + 3600 * 1000).toISOString();
  assert.equal(panel.isOverdue({status: 'odeme_bekleniyor', overdue: true}, now), true);
  assert.equal(panel.isOverdue({status: 'odeme_bekleniyor', overdue: false, payBy: past}, now), false, 'the server flag wins');
  assert.equal(panel.isOverdue({status: 'odeme_bekleniyor', payBy: past}, now), true);
  assert.equal(panel.isOverdue({status: 'odeme_bekleniyor', payBy: future}, now), false);
  assert.equal(panel.isOverdue({status: 'odeme_bekleniyor', payBy: Math.floor((now - 1000) / 1000)}, now), true, 'epoch seconds (order record)');
  assert.equal(panel.isOverdue({status: 'odeme_alindi', payBy: past}, now), false, 'paid orders are never overdue');
  assert.equal(panel.isOverdue({status: 'iptal', payBy: past}, now), false);
  assert.equal(panel.isOverdue({status: 'odeme_bekleniyor'}, now), false);
  assert.equal(panel.isOverdue({status: 'odeme_bekleniyor', payBy: 'yarın'}, now), false);
  assert.equal(panel.isOverdue(null, now), false);
});

test('panel validates the CSV date range', () => {
  const today = '2026-10-27';
  assert.deepEqual(panel.validateExportRange('', '', today), {ok: true, errors: {}, from: '', to: ''});
  assert.equal(panel.validateExportRange('2026-10-01', '2026-10-27', today).ok, true);
  assert.equal(panel.validateExportRange('2026-10-27', '2026-10-27', today).ok, true, 'a single day is a valid range');
  assert.equal(panel.validateExportRange('2026-01-01', '', today).ok, true, 'open-ended is fine');
  assert.equal(panel.validateExportRange('', '2026-03-31', today).ok, true);
  assert.equal(panel.validateExportRange(' 2026-10-01 ', ' 2026-10-02 ', today).from, '2026-10-01', 'whitespace is trimmed');
  assert.ok(panel.validateExportRange('27.10.2026', '', today).errors.from, 'only YYYY-MM-DD is accepted');
  assert.ok(panel.validateExportRange('2026-02-30', '', today).errors.from, 'impossible calendar day');
  assert.ok(panel.validateExportRange('2026-13-01', '', today).errors.from);
  assert.ok(panel.validateExportRange('2025-02-29', '', today).errors.from, 'not a leap year');
  assert.equal(panel.validateExportRange('2024-02-29', '', today).ok, true, 'leap day');
  assert.ok(panel.validateExportRange('', 'dün', today).errors.to);
  assert.ok(panel.validateExportRange('2026-10-10', '2026-10-09', today).errors.range, 'from after to');
  assert.ok(panel.validateExportRange('', '2026-10-28', today).errors.to, 'the end date cannot be in the future');
  assert.ok(panel.validateExportRange('2023-12-31', '', today).errors.from, 'implausibly old start');
  const both = panel.validateExportRange('x', 'y', today);
  assert.ok(!both.ok && both.errors.from && both.errors.to);
  assert.deepEqual(panel.quickRange('thisMonth', '2026-10-27'), {from: '2026-10-01', to: '2026-10-27'});
  assert.deepEqual(panel.quickRange('lastMonth', '2026-10-27'), {from: '2026-09-01', to: '2026-09-30'});
  assert.deepEqual(panel.quickRange('lastMonth', '2026-01-15'), {from: '2025-12-01', to: '2025-12-31'});
  assert.deepEqual(panel.quickRange('lastMonth', '2026-03-05'), {from: '2026-02-01', to: '2026-02-28'});
  assert.deepEqual(panel.quickRange('thisYear', '2026-10-27'), {from: '2026-01-01', to: '2026-10-27'});
  assert.deepEqual(panel.quickRange('bilinmeyen', '2026-10-27'), {from: '', to: ''});
  for (const kind of ['thisMonth', 'lastMonth', 'thisYear']) assert.ok(panel.validateExportRange(panel.quickRange(kind, today).from, panel.quickRange(kind, today).to, today).ok, kind);
  assert.match(panel.todayIso(Date.UTC(2026, 9, 27, 22, 30)), /^2026-10-28$/, 'after 21:00 UTC it is already tomorrow in Istanbul');
});

test('panel handles price entry, held changes, filters and cron health', () => {
  assert.equal(panel.parseTry('1.234,50'), 1234.5);
  assert.equal(panel.parseTry('1,234.50'), 1234.5);
  assert.equal(panel.parseTry('1234,5'), 1234.5);
  assert.equal(panel.parseTry('1234.50'), 1234.5);
  assert.equal(panel.parseTry('1.234'), 1234, 'a lone dot followed by three digits is a thousands separator');
  assert.equal(panel.parseTry('12.5'), 12.5);
  assert.equal(panel.parseTry('1.234.567,89 TL'), 1234567.89);
  assert.equal(panel.parseTry('₺ 99'), 99);
  for (const bad of ['', 'abc', '12,345', '1,2,3', '12.345.6', '-5', '1e3', null, undefined]) assert.ok(Number.isNaN(panel.parseTry(bad)), String(bad));

  let m = panel.buildManualPrice('vgm-9001', {costTry: '1.500,25', available: 'true', note: 'Telefonla teyit edildi'});
  assert.deepEqual(m, {ok: true, errors: {}, body: {id: 'vgm-9001', decision: 'manual', costTry: 1500.25, available: true, note: 'Telefonla teyit edildi'}});
  assert.equal(panel.buildManualPrice('vgm-9001', {costTry: '10', available: 'false', note: 'abc'}).body.available, false);
  m = panel.buildManualPrice('vgm-9001', {costTry: '0', note: 'abc'});
  assert.ok(!m.ok && m.errors.costTry);
  assert.ok(panel.buildManualPrice('vgm-9001', {costTry: '20000000', note: 'abc'}).errors.costTry, 'over the cap');
  assert.ok(panel.buildManualPrice('vgm-9001', {costTry: 'x', note: ''}).errors.note, 'a note is mandatory (server: note_required)');
  assert.deepEqual(panel.buildDecision('vgm-9001', 'approve', '  tamam  ').body, {id: 'vgm-9001', decision: 'approve', note: 'tamam'});
  assert.equal(panel.buildDecision('vgm-9001', 'manual', '').ok, false, 'manual goes through buildManualPrice');

  const held = panel.heldInfo({costTry: 1000, held: {costTry: 1320, prevCostTry: 1000, at: 1790000000}});
  assert.equal(held.prev, 1000);
  assert.equal(held.next, 1320);
  assert.equal(Math.round(held.pct), 32);
  assert.equal(panel.heldInfo({costTry: 1000, held: {costTry: 700, prevCostTry: null}}).prev, 1000, 'falls back to the accepted cost');
  assert.equal(panel.heldInfo({costTry: null, held: {costTry: 700, prevCostTry: null}}).pct, null);
  assert.equal(panel.heldInfo({held: null}), null);
  assert.equal(panel.heldInfo(null), null);

  const items = [
    {id: 'vgm-9001', name: 'Güneş Paneli', category: 'gunes-panelleri', status: 'ok', orderable: true, reason: 'ok'},
    {id: 'vgm-9002', name: 'İnverter Işık', category: 'inverterler', status: 'held', orderable: false, reason: 'held', held: {costTry: 2}},
    {id: 'vgm-9003', name: 'Şalter', category: 'koruma-cihazlari', status: 'error', orderable: false, reason: 'ok'},
    {id: 'vgm-9004', name: 'Akü', category: 'enerji-depolama', status: 'ok', orderable: false, reason: 'stale'},
    {id: 'vgm-9005', name: 'Çok eski', category: 'olcu-ve-test', status: 'unavailable', orderable: false, reason: 'unavailable'},
  ];
  assert.deepEqual(panel.priceCounts(items), {total: 5, orderable: 1, held: 1, error: 1, unavailable: 1, stale: 1});
  assert.deepEqual(panel.sortPrices(items).map(i => i.id), ['vgm-9002', 'vgm-9003', 'vgm-9004', 'vgm-9005', 'vgm-9001'], 'attention first');
  const ids = f => items.filter(i => panel.priceMatches(i, f)).map(i => i.id);
  assert.deepEqual(ids({status: 'held'}), ['vgm-9002']);
  assert.deepEqual(ids({status: 'stale'}), ['vgm-9004']);
  assert.deepEqual(ids({status: 'orderable'}), ['vgm-9001']);
  assert.deepEqual(ids({status: 'blocked'}), ['vgm-9002', 'vgm-9003', 'vgm-9004', 'vgm-9005']);
  assert.deepEqual(ids({q: 'inverter isik'}), ['vgm-9002'], 'Turkish letters fold (İ/ı/ş...)');
  assert.deepEqual(ids({q: 'SALTER'}), ['vgm-9003']);
  assert.deepEqual(ids({q: 'vgm-9005'}), ['vgm-9005']);
  assert.deepEqual(ids({q: 'enerji'}), ['vgm-9004'], 'category is searchable');
  assert.equal(ids({}).length, 5);

  const now = Date.UTC(2026, 9, 27, 12, 0, 0);
  const ago = hours => new Date(now - hours * 3600 * 1000).toISOString();
  assert.equal(panel.cronHealth(ago(0.1), now).level, 'ok', 'cron runs every 10 minutes');
  assert.equal(panel.cronHealth(ago(0.45), now).level, 'ok', 'server threshold: 30 minutes');
  assert.equal(panel.cronHealth(ago(1), now).level, 'late');
  assert.equal(panel.cronHealth(ago(5), now).level, 'late');
  assert.equal(panel.cronHealth(ago(7), now).level, 'down');
  assert.equal(panel.cronHealth(null, now).level, 'down');
  assert.equal(panel.cronState({healthy: true}, ago(40), now).level, 'ok', 'the server flag wins');
  assert.equal(panel.cronState({healthy: false, lastRunAt: ago(2)}, null, now).level, 'late');
  assert.equal(panel.cronState(null, ago(0.2), now).level, 'ok');
  assert.equal(panel.cronState(null, ago(2), now).level, 'late');
  assert.equal(panel.isStaleCheck(ago(47), now), false);
  assert.equal(panel.isStaleCheck(ago(49), now), true);
  assert.equal(panel.isStaleCheck(null, now), true);
  assert.match(panel.summaryText({checked: 5, ok: 4, held: 1, rateUpdated: true, rateError: '', seconds: 3.2}), /kontrol edilen: 5 · güncel: 4 · onay bekleyen: 1 · kur güncellendi: evet · süre \(sn\): 3\.2/);
  assert.equal(panel.summaryText(null), '');
});

test('panel explains 401/403/409/429 and network errors clearly', () => {
  const e401 = panel.explainError({status: 401, message: 'x'});
  assert.equal(e401.kind, 'auth');
  assert.equal(e401.login, true);
  assert.match(e401.text, /giriş/i);
  const e403 = panel.explainError({status: 403, message: 'Güvenlik doğrulaması başarısız oldu.'});
  assert.equal(e403.kind, 'forbidden');
  assert.equal(e403.login, false);
  assert.match(e403.text, /yetkiniz yok|güvenlik anahtarı/i);
  const e409 = panel.explainError({status: 409, message: '"Ödeme bekleniyor" durumundan "Teslim edildi" durumuna geçilemez.'});
  assert.equal(e409.kind, 'conflict');
  assert.equal(e409.refresh, true);
  assert.match(e409.text, /geçilemez/);
  assert.match(e409.text, /yeniden yüklendi/);
  assert.match(panel.explainError({status: 409}).text, /çakışıyor/);
  assert.match(panel.explainError({status: 429, retryAfter: 30}).text, /30 saniye sonra/);
  assert.match(panel.explainError({status: 429, retryAfter: 600}).text, /10 dakika sonra/);
  assert.match(panel.explainError({status: 429}).text, /Biraz sonra/);
  assert.equal(panel.explainError({status: 429}).kind, 'rate');
  assert.equal(panel.explainError({}).kind, 'network');
  assert.equal(panel.explainError({status: 503, message: 'Mağaza şu anda yanıt veremiyor.'}).text, 'Mağaza şu anda yanıt veremiyor.');
  assert.equal(panel.explainError({status: 422, message: 'İptal ve iade için gerekçe yazın.'}).text, 'İptal ve iade için gerekçe yazın.');
  assert.equal(panel.explainError(undefined).kind, 'network');
});

test('panel link and reference helpers refuse unsafe values', () => {
  assert.equal(panel.httpsUrl('https://tedarikci.example/urun?a=1'), 'https://tedarikci.example/urun?a=1');
  for (const bad of ['javascript:alert(1)', 'http://tedarikci.example', 'data:text/html,x', 'https://a.example/ x', 'https://', '//a.example', '', null, 'https://a.example/"><script>']) assert.equal(panel.httpsUrl(bad), '', String(bad));
  assert.equal(panel.mailHref('musteri@example.test'), 'mailto:musteri@example.test');
  assert.equal(panel.mailHref('a b@example.test'), '');
  assert.equal(panel.mailHref('<x>@example.test'), '');
  assert.equal(panel.telHref('0532 000 00 00'), 'tel:05320000000');
  assert.equal(panel.telHref('+90 (532) 000-00-00'), 'tel:+905320000000');
  assert.equal(panel.telHref('yok'), '');
  assert.equal(panel.orderRefFromHash('#VGS-261027-ABCDE'), 'VGS-261027-ABCDE', 'link format used in the staff e-mail');
  assert.equal(panel.orderRefFromHash('#siparis=VGS-261027-ABCDE'), 'VGS-261027-ABCDE');
  for (const bad of ['#VGS-261027-ABCDO', '#VGS-26-ABCDE', '#fiyatlar', '#main', '', '#siparis=<script>']) assert.equal(panel.orderRefFromHash(bad), '', bad);
  assert.equal(panel.clean('  a\u0000b\r\nc  ', 10), 'ab\nc');
  assert.equal(panel.fold('İSTANBUL Işık ŞÖĞÜÇ'), 'istanbul isik soguc');
});

/* ======================================================================== sayfa: güvenlik ve kablolama */

test('panel page and assets: strict CSP shape, no innerHTML, safe links, theme tokens only', () => {
  const js = fs.readFileSync(panelJs, 'utf8');
  const css = fs.readFileSync(panelCss, 'utf8');
  const html = fs.readFileSync(panelHtml, 'utf8');
  for (const banned of [/\.innerHTML/, /insertAdjacentHTML/, /\beval\s*\(/, /new Function/, /document\.write/, /outerHTML\s*=/, /setAttribute\(\s*['"]on/i, /localStorage|sessionStorage/])
    assert.doesNotMatch(js, banned, `panel script must not use ${banned}`);
  for (const line of js.split('\n').filter(l => l.includes('_blank'))) assert.match(line, /noopener noreferrer/, `target=_blank needs rel on: ${line.trim()}`);
  assert.match(js, /X-VG-CSRF/);
  assert.match(js, /\/hesap\/giris\.html\?next=\/hesap\/magaza-panel\.html/);
  assert.match(js, /action=/);
  assert.match(js, /panel_me/);

  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => !/\bsrc=/.test(m[1]) && !/speculationrules/.test(m[1]));
  assert.deepEqual(inlineScripts.map(m => m[0].slice(0, 60)), [], 'no inline scripts (CSP script-src self)');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'no inline event handlers');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'no inline style attributes');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<!--vg:header-->[\s\S]*<!--\/vg:header-->/);
  assert.match(html, /<!--vg:footer-->[\s\S]*<!--\/vg:footer-->/);
  assert.match(html, /<title>[^<]*Mağaza[^<]*<\/title>/);

  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'colors come from --th-* tokens only');
  assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/i);
  assert.doesNotMatch(css, /--clr-/, 'only --th-* tokens (dark/light aware)');
  assert.match(css, /var\(--th-/);

  // JS'in sorguladığı her kanca ve kimlik sayfada var (eksik biri başlangıçta betiği düşürür).
  const hooks = new Set([...js.matchAll(/\$\$?\('([^']+)'/g)].map(m => m[1]));
  assert.ok(hooks.size > 15, 'hook extraction works');
  for (const sel of hooks) {
    if (sel.startsWith('#')) assert.ok(html.includes(`id="${sel.slice(1)}"`), `missing ${sel}`);
    else if (sel.startsWith('[data-')) assert.ok(html.includes(sel.slice(1, -1).split('=')[0]), `missing ${sel}`);
    else assert.ok(sel === '[role="tab"]' || /^[a-z, ]+$/.test(sel), `unchecked selector ${sel}`);   // etiket listeleri (setBusy) sayfaya bağlı değil
  }
  for (const id of ['t-orders', 't-prices', 't-status', 't-export', 'p-orders', 'p-prices', 'p-status', 'p-export'])
    assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('role="tablist"'));
});

test('panel asset versions in the page match the file contents (tools/sync-versions.py rule)', () => {
  const html = fs.readFileSync(panelHtml, 'utf8');
  for (const rel of ['css/magaza-panel.css', 'js/hesap-magaza-panel.js']) {
    const bytes = fs.readFileSync(path.join(root, rel)).toString('latin1').replace(/\r\n/g, '\n');
    const rev = crypto.createHash('sha256').update(Buffer.from(bytes, 'latin1')).digest('hex').slice(0, 12);
    assert.ok(html.includes(`../${rel}?v=${rev}`), `${rel} reference must carry ?v=${rev}`);
  }
});
