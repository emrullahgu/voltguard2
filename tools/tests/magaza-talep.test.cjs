'use strict';
// Mağaza talebi (contact.php, subject=magaza, gizli "magazaTalep" alanı; P1-12) gerçek PHP sunucusunda: yapılandırılmış
// talep doğrulanır, e-posta konusuna niyet etiketi ve gövdeye satırlar + JSON eklenir, aylık JSONL kaydına yazılır.
// Ayrıca adet sınırlarının katalog şeması / PHP / JS arasında tutarlılığı ve deliveryDays kategori varsayılanları (P1-09/10).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn, spawnSync} = require('node:child_process');
const gen = require('./fixtures/magaza/katalog-uret.cjs');
const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || [path.join(root, '.qa/php/runtime/php.exe'), path.resolve(root, '../../../.qa/php/runtime/php.exe')].find(f => fs.existsSync(f)) || path.join(root, '.qa/php/runtime/php.exe');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vgm-talep-'));
test.after(() => fs.rmSync(scratch, {recursive: true, force: true}));

async function server(data) {
  const l = net.createServer(); await new Promise(r => l.listen(0, '127.0.0.1', r));
  const port = l.address().port; await new Promise(r => l.close(r));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(php, ['-n', '-S', `127.0.0.1:${port}`, '-t', root], {
    env: {...process.env, VG_DATA_DIR: data, VG_STORE: 'json', TURNSTILE_SECRET_KEY: '', VG_CONTACT_ALLOWED_ORIGINS: base, VG_MAIL_OUTBOX: '1'},
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true});
  const logs = []; child.stderr.on('data', c => logs.push(String(c)));
  for (let i = 0; i < 100; i++) { try { await fetch(`${base}/contact.php`); break; } catch { if (i === 99) throw Error('PHP did not start'); await new Promise(r => setTimeout(r, 50)); } }
  return {base, logs, stop: () => new Promise(r => { child.kill(); if (child.exitCode !== null) r(); else { child.once('exit', r); setTimeout(r, 3000); } })};
}
const post = async (base, fields) => {
  const r = await fetch(`${base}/contact.php`, {method: 'POST', headers: {Origin: base}, body: new URLSearchParams(fields)});
  return {status: r.status, body: await r.json()};
};
const outbox = data => { const d = path.join(data, 'outbox'); return fs.existsSync(d) ? fs.readdirSync(d).sort().map(f => fs.readFileSync(path.join(d, f), 'utf8')) : []; };
const subjectOf = eml => Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(eml)[1], 'base64').toString('utf8');
const bodyOf = eml => { const m = /Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/.exec(eml); return m ? Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8') : eml; };
const mailFor = (data, ref) => outbox(data).find(m => subjectOf(m).includes(ref));
const records = data => { const d = path.join(data, 'magaza-talep'); return fs.existsSync(d) ? fs.readdirSync(d).flatMap(f => fs.readFileSync(path.join(d, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))) : []; };
const form = (id, extra = {}) => ({kind: 'contact', requestId: id, name: 'Sentetik Alıcı', phone: '0232 123 45 67', email: 'talep-fixture@example.test',
  subject: 'magaza', message: 'Mağaza ürün teklifi: 1) vgm-9001 DM-450 x 12 adet; lütfen proforma gönderin.', formTimestamp: String(Date.now()), ...extra});

test('P1-12: contact.php magazaTalep yapılandırılmış talebi doğrular, e-postaya etiketle ekler ve aylık kayda yazar', async () => {
  const data = fs.mkdtempSync(path.join(scratch, 'veri-'));
  const srv = await server(data);
  try {
    const talep = {v: 1, intent: 'proforma', q: 'dm 450', items: [
      {id: 'vgm-9001', mpn: 'DM-450', qty: 12, url: '/magaza/urun/deneme-marka-dm-450-450w-gunes-paneli/'},
      {id: '../x', mpn: 'KÖTÜ', qty: 1, url: ''},                                  // geçersiz kimlik: atlanır
      {id: 'vgm-9002', mpn: 'DM-INV', qty: 0, url: ''},                              // adet 0: atlanır
      {id: '', mpn: 'SADECE-MODEL', qty: 3, url: ''},                                // kimliksiz ama modelli: tutulur
      {id: 'vgm-9003', mpn: '<b>', qty: 2, url: ''},                                  // denetim karakteri: atlanır
      {id: 'vgm-9004', mpn: 'DM-BAT', qty: 1, url: 'https://kotu.example.test/'}]};  // dış adres: atlanır
    const ok = await post(srv.base, form('mtalep-0000000001', {magazaTalep: JSON.stringify(talep)}));
    assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.success, true);
    const mails = outbox(data); assert.equal(mails.length, 1);
    assert.match(subjectOf(mails[0]), new RegExp(`^VoltGuard İletişim talebi ${ok.body.reference} - \\[Proforma\\] Mağaza / Ürün Teklifi$`));
    const body = bodyOf(mails[0]);
    assert.match(body, /Mağaza talebi \(Proforma\):\n1\. vgm-9001 · model DM-450 · adet 12 · https:\/\/voltguard\.com\.tr\/magaza\/urun\/deneme-marka-dm-450-450w-gunes-paneli\/\n2\. kimliksiz · model SADECE-MODEL · adet 3\nAranan: dm 450\nYapılandırılmış veri: \{/);
    const recs = records(data);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].ref, ok.body.reference); assert.equal(recs[0].intent, 'proforma'); assert.equal(recs[0].q, 'dm 450');
    assert.deepEqual(recs[0].items, [{id: 'vgm-9001', mpn: 'DM-450', qty: 12, url: '/magaza/urun/deneme-marka-dm-450-450w-gunes-paneli/'}, {id: '', mpn: 'SADECE-MODEL', qty: 3, url: ''}]);
    assert.doesNotMatch(JSON.stringify(recs[0]), /example\.test|Sentetik Alıcı|0232/, 'kayıtta kişisel veri yok');
    // başka konu: magazaTalep okunmaz
    const other = await post(srv.base, form('mtalep-konu-0000001', {subject: 'elektrik', magazaTalep: JSON.stringify(talep)}));
    assert.equal(other.status, 200); assert.doesNotMatch(bodyOf(mailFor(data, other.body.reference)), /Mağaza talebi/); assert.equal(records(data).length, 1);
    // en çok 40 satır
    const many = {v: 1, intent: 'teklif', q: '', items: Array.from({length: 45}, (_, i) => ({id: `vgm-${String(9100 + i)}`, mpn: 'M' + i, qty: 1, url: ''}))};
    const m = await post(srv.base, form('mtalep-cok-00000001', {magazaTalep: JSON.stringify(many)}));
    assert.equal(m.status, 200);
    assert.equal(records(data).at(-1).items.length, 40); assert.match(subjectOf(mailFor(data, m.body.reference)), /\[Teklif\]/);
  } finally {
    await srv.stop();
    assert.doesNotMatch(srv.logs.join(''), /Fatal error|Warning:|Notice:|Deprecated:/);
  }
  // bozuk/bilinmeyen niyet, yanlış sürüm ya da 16 KB üstü: talep yok sayılır, mesaj yine iletilir (etiketsiz, kayıt yok).
  // Ayrı veri klasörü: IP başına 10 dakikada 5 mesaj sınırı.
  const data2 = fs.mkdtempSync(path.join(scratch, 'veri-'));
  const srv2 = await server(data2);
  try {
    const good = {v: 1, intent: 'teklif', q: '', items: [{id: 'vgm-9001', mpn: 'DM-450', qty: 1, url: ''}]};
    for (const [i, raw] of [JSON.stringify({...good, intent: 'satin-al'}), '{bozuk', JSON.stringify({...good, v: 2}), JSON.stringify({...good, q: 'x'.repeat(17000)})].entries()) {
      const r = await post(srv2.base, form('mtalep-bozuk-00000' + i, {magazaTalep: raw}));
      assert.equal(r.status, 200, raw.slice(0, 40));
      const mail = mailFor(data2, r.body.reference);
      assert.doesNotMatch(subjectOf(mail), /\[/); assert.doesNotMatch(bodyOf(mail), /Mağaza talebi/);
    }
    assert.equal(records(data2).length, 0);
  } finally {
    await srv2.stop();
  }
});

const phpEval = (code, env = {}) => {
  const r = spawnSync(php, ['-n', '-r', "define('VG_API', 1); require 'api/lib/bootstrap.php'; require 'api/lib/store.php'; require 'api/lib/security.php'; require 'api/lib/magaza.php'; " + code],
    {cwd: root, encoding: 'utf8', env: {...process.env, ...env}});
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(r.stdout);
};

test('P1-09: adet sınırları katalog şeması, PHP ve JS arasında aynı (maxQty 999, packQty 9999); aşan değer varsayılana düşer', () => {
  const ortak = fs.readFileSync(path.join(root, 'tools/magaza/katalog-ortak.cjs'), 'utf8');
  const schemaMax = Number(/p\.maxQty > (\d+)\)+ err\(w, 'maxQty 1–\d+'\)/.exec(ortak)[1]);
  const schemaPack = Number(/p\.packQty > (\d+)\)+ err\(w, 'packQty/.exec(ortak)[1]);
  const js = fs.readFileSync(path.join(root, 'js/magaza.js'), 'utf8');
  const [phpMax, phpPack, d1, d2, d3] = phpEval(`echo json_encode([VGM_MAX_QTY, VGM_MAX_PACK,
    vgm_product_defaults(['maxQty' => 999, 'packQty' => 9999, 'minQty' => 100, 'step' => 50]),
    vgm_product_defaults(['maxQty' => 1000, 'packQty' => 10000]),
    vgm_product_defaults(['maxQty' => 900, 'minQty' => 120, 'step' => 50])]);`);
  assert.equal(phpMax, schemaMax); assert.equal(phpPack, schemaPack);
  assert.equal(Number(/var MAX_QTY = (\d+);/.exec(js)[1]), schemaMax); assert.equal(Number(/var MAX_PACK = (\d+);/.exec(js)[1]), schemaPack);
  assert.deepEqual([d1.maxQty, d1.packQty, d1.minQty, d1.step], [999, 9999, 100, 50]);
  assert.deepEqual([d2.maxQty, d2.packQty], [50, null], 'şema dışı değer kabul edilmez');
  assert.deepEqual([d3.minQty, d3.step], [150, 50], 'en az adet adımın katına yukarı yuvarlanır');
});

test('P1-10: deliveryDays ürün > yaprak kategori > üst kategori > yok (en geç 30 gün); geçersiz değer atlanır', () => {
  const dir = fs.mkdtempSync(path.join(scratch, 'katalog-'));
  gen.write(dir, {categories: [gen.category('ust', 'Üst', 10), gen.category('alt', 'Alt', 11, 'ust'), gen.category('alt2', 'Alt 2', 12, 'ust'), gen.category('tek', 'Tek', 20)],
    products: [gen.product('vgm-100001', 'alt', 1), gen.product('vgm-100002', 'alt2', 2), gen.product('vgm-100003', 'tek', 3)]});
  // yazıcı şeması deliveryDays taşımadığından (tools/magaza/katalog-ortak.cjs) kategori varsayılanı dosyaya elle eklenir
  const f = path.join(dir, 'kategoriler.json'), k = JSON.parse(fs.readFileSync(f, 'utf8'));
  Object.assign(k.categories.find(c => c.id === 'ust'), {deliveryDays: 5});
  Object.assign(k.categories.find(c => c.id === 'alt2'), {deliveryDays: 2});
  Object.assign(k.categories.find(c => c.id === 'tek'), {deliveryDays: 45});
  fs.writeFileSync(f, JSON.stringify(k));
  const out = phpEval(`echo json_encode([vgm_delivery_days(['category' => 'alt']), vgm_delivery_days(['category' => 'alt2']), vgm_delivery_days(['category' => 'alt', 'deliveryDays' => 1]),
    vgm_delivery_days(['category' => 'alt', 'deliveryDays' => 0]), vgm_delivery_days(['category' => 'tek']), vgm_delivery_days(['category' => 'yok']),
    array_key_exists('deliveryDays', vgm_product_defaults(['deliveryDays' => 31]))]);`, {VG_MAGAZA_CATALOG: dir});
  assert.deepEqual(out, [5, 2, 1, 5, null, null, false]);
});

test('sepet önce: sepetin tamamı tek teklif talebi (intent "sepet"; ad, adet, gösterilen fiyat ve dayanağı); tekrar koruması', async () => {
  const data = fs.mkdtempSync(path.join(scratch, 'veri-'));
  const srv = await server(data);
  try {
    const talep = {v: 1, intent: 'sepet', q: '', items: [
      {id: 'vgm-9001', mpn: 'DM-450', name: 'Deneme Marka DM-450 450 W Güneş Paneli', qty: 4, url: '/magaza/urun/deneme-marka-dm-450-450w-gunes-paneli/', price: 5760, basis: 'verified'},
      {id: 'vgm-9006', mpn: 'LM-10', name: 'Liste Marka LM-10 C10 Otomatik Sigorta', qty: 12, url: '', price: 480.5, basis: 'list'},
      {id: 'vgm-9003', mpn: 'DM-C16', name: 'Sigorta <script>', qty: 2, url: '', price: null, basis: 'verified'},   // ad temizlenir; fiyatsız -> none
      {id: 'vgm-9004', mpn: 'DM-BAT', name: 'Akü', qty: 1, url: '', price: -5, basis: 'uydurma'},                   // geçersiz fiyat/dayanak -> null/none
      {id: 'vgm-9005', mpn: 'DM-TR', name: 'Trafo', qty: 1, url: '', price: 96000, basis: 'verified', freight: true},  // nakliyeli: fiyata nakliye dahil değil
      {id: 'vgm-9007', mpn: 'DM-KB', name: 'Kablo', qty: 3, url: '', price: 150, basis: 'last', freight: 'evet'}]};      // boolean olmayan işaret yok sayılır
    const fields = form('msepet-0000000001', {message: '[Mağaza] Sepet teklif talebi – 4 kalem.\nFirma: Sentetik Ltd.\n\nÜrünler:\n1) DM-450 — 4 adet', magazaTalep: JSON.stringify(talep)});
    const ok = await post(srv.base, fields);
    assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.match(ok.body.reference, /^VG-\d{6}-[A-HJ-NP-Z2-9]{5}$/);
    const mail = mailFor(data, ok.body.reference);
    assert.match(subjectOf(mail), /\[Sepet teklifi\] Mağaza \/ Ürün Teklifi$/);
    const body = bodyOf(mail);
    assert.match(body, /1\. vgm-9001 · model DM-450 · Deneme Marka DM-450 450 W Güneş Paneli · adet 4 · 5\.760,00 TL \(KDV dahil, doğrulanmış fiyat\)/);
    assert.match(body, /2\. vgm-9006 · model LM-10 · Liste Marka LM-10 C10 Otomatik Sigorta · adet 12 · 480,50 TL \(KDV dahil, liste fiyatı, siparişte teyit edilir\)/);
    assert.match(body, /3\. vgm-9003 · model DM-C16 · adet 2 · fiyat teklifle bildirilir/);
    assert.match(body, /4\. vgm-9004 · model DM-BAT · Akü · adet 1 · fiyat teklifle bildirilir/);
    assert.match(body, /5\. vgm-9005 · model DM-TR · Trafo · adet 1 · 96\.000,00 TL \(KDV dahil, doğrulanmış fiyat, nakliye hariç\)/);
    assert.match(body, /6\. vgm-9007 · model DM-KB · Kablo · adet 3 · 150,00 TL \(KDV dahil, son doğrulanan fiyat, siparişte teyit edilir\)/);
    const rec = records(data).at(-1);
    assert.equal(rec.intent, 'sepet'); assert.equal(rec.items.length, 6);
    assert.deepEqual(rec.items.map(i => [i.name, i.price, i.basis]), [['Deneme Marka DM-450 450 W Güneş Paneli', 5760, 'verified'], ['Liste Marka LM-10 C10 Otomatik Sigorta', 480.5, 'list'], ['', null, 'none'], ['Akü', null, 'none'], ['Trafo', 96000, 'verified'], ['Kablo', 150, 'last']]);
    assert.deepEqual(rec.items.map(i => i.freight === true), [false, false, false, false, true, false]);
    assert.doesNotMatch(JSON.stringify(rec), /Sentetik Alıcı|0232|example\.test/, 'kayıtta kişisel veri yok');
    // aynı talep kimliği + içerik: ikinci e-posta yok, aynı numara
    const n = outbox(data).length;
    const again = await post(srv.base, fields);
    assert.equal(again.status, 200); assert.equal(again.body.reference, ok.body.reference); assert.equal(again.body.duplicate, true);
    assert.equal(outbox(data).length, n);
    // eski niyetlerde (teklif/proforma) ad ve fiyat alanları taşınmaz
    const old = await post(srv.base, form('msepet-0000000002', {magazaTalep: JSON.stringify({...talep, intent: 'proforma'})}));
    assert.equal(old.status, 200); assert.equal(records(data).at(-1).items[0].price, undefined);
    // 40 kalemlik sepet (100 karakterlik adlarla) 16 KB sınırına sığar
    const big = {v: 1, intent: 'sepet', q: '', items: Array.from({length: 40}, (_, i) => ({id: `vgm-${9100 + i}`, mpn: 'MODEL-' + i, name: 'Schneider Electric Kompakt Şalter NSX ' + 'X'.repeat(60) + i, qty: 999, url: '/magaza/urun/uzun-bir-urun-adresi-' + i + '/', price: 123456.78, basis: 'last'}))};
    assert.ok(Buffer.byteLength(JSON.stringify(big)) < 16384);
    const b = await post(srv.base, form('msepet-0000000003', {magazaTalep: JSON.stringify(big)}));
    assert.equal(b.status, 200); assert.equal(records(data).at(-1).items.length, 40);
  } finally {
    await srv.stop();
    assert.doesNotMatch(srv.logs.join(''), /Fatal error|Warning:|Notice:|Deprecated:/);
  }
});
