'use strict';
// Mağaza API'si gerçek PHP sunucusunda (sentetik katalog/satıcı, geçici veri klasörü, e-posta outbox/):
// TL fiyat (USD tabanlı), 48 saat kuralı, onay bekleyen fiyat, nakliye ürünü, imzalı sepet jetonu, sipariş + e-postalar,
// tekrar koruması, durum sorgusu, personel paneli, CSV güvenliği ve herkese açık yanıtlarda tedarikçi/USD sızıntısı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const ozel = require('./fixtures/magaza/ozel.cjs');

const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || [path.join(root, '.qa/php/runtime/php.exe'), path.resolve(root, '../../../.qa/php/runtime/php.exe')].find(f => fs.existsSync(f)) || path.join(root, '.qa/php/runtime/php.exe');   // git worktree: ana kopyanın .qa/php'si
const fixtures = path.join(root, 'tools/tests/fixtures/magaza');
const REF = /^VGS-\d{6}-[A-HJ-NP-Z2-9]{5}$/;
const IBAN = JSON.parse(fs.readFileSync(path.join(fixtures, 'firma-tam.json'), 'utf8')).banka.iban;
const SUPPLIER = 'tedarikci-bir.example.test';
const IDS = { ids: 'vgm-9001,vgm-9002,vgm-9003,vgm-9004,vgm-9005' };
const now = Math.floor(Date.now() / 1000);

function writeState(data, { open = true } = {}) {
  const dir = path.join(data, 'magaza');
  fs.mkdirSync(dir, { recursive: true });
  const src = id => [{ url: `https://${SUPPLIER}/urun/${id}`, supplier: SUPPLIER, vatIncluded: true, currency: 'TRY', priority: 1, discount: 0 }];
  ozel.writeConfig(data, { version: 1, open, margin: { default: 0.15, byCategory: {}, byProduct: {} },
    shipping: { feeTry: 0, freeOverTry: 0 }, paymentHours: 24, fxBuffer: 0, blockedSuppliers: [],
    sources: { 'vgm-9001': src('9001'), 'vgm-9002': src('9002'), 'vgm-9003': src('9003'), 'vgm-9004': src('9004'), 'vgm-9005': src('9005') } });
  const item = (costUsd, extra = {}) => ({ status: 'ok', costTry: Math.round(costUsd * 40 * 1.2 * 100) / 100, costUsd, rateAtCheck: 40,
    checkedAt: now - 3600, lastAttemptAt: now - 3600, source: 0, method: 'jsonld', available: true, note: '', held: null, history: [], ...extra });
  ozel.writePrices(data, { lastRunAt: now - 600, lastRunSummary: null, items: {
    'vgm-9001': item(100), 'vgm-9002': item(500, { checkedAt: now - 49 * 3600, lastAttemptAt: now - 49 * 3600 }),
    'vgm-9003': item(2.5, { status: 'held', held: { costTry: 200, costUsd: 4.1667, rateAtCheck: 40, at: now - 60, source: 0, method: 'jsonld', prevCostTry: 120, available: true } }),
    'vgm-9004': item(1500), 'vgm-9005': item(30) } });
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  fs.writeFileSync(path.join(dir, 'kur.json'), JSON.stringify({ version: 1, usdTry: 40, eurTry: 45, date: today, fetchedAt: now - 600, source: 'test' }));
}

async function server(data, extraEnv = {}) {
  const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const base = `http://127.0.0.1:${port}`;
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-magaza-fixture-'));
  const child = spawn(php, ['-n', '-S', `127.0.0.1:${port}`, '-t', root], {
    env: { ...process.env, VG_DATA_DIR: data, VG_STORE: 'json', VG_MAIL_OUTBOX: '1', VG_RATE_SCALE: '10', TURNSTILE_SECRET_KEY: '',
      VG_MAGAZA_CATALOG: path.join(fixtures, 'katalog'), VG_MAGAZA_FIRMA: path.join(fixtures, 'firma-tam.json'),
      VG_MAGAZA_FIXTURE_DIR: empty, ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const logs = []; child.stderr.on('data', c => logs.push(String(c)));
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${base}/api/magaza.php?action=fiyatlar`); break; } catch { if (i === 99) throw Error('PHP did not start'); await new Promise(r => setTimeout(r, 50)); }
  }
  return { base, logs, stop: () => new Promise(resolve => { child.kill(); if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 3000); } }) };
}

function client(base) {
  const actor = { cookies: new Map(), csrf: '' };
  actor.call = async (endpoint, action, { body, query = {}, csrf, headers = {} } = {}) => {
    const h = { Cookie: [...actor.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers };
    let payload;
    if (body !== undefined) {
      h['Content-Type'] = 'application/json'; h.Origin = h.Origin || base;
      if (csrf !== false) h['X-VG-CSRF'] = csrf || actor.csrf;
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}/api/${endpoint}.php?${new URLSearchParams({ action, ...query })}`, { method: body === undefined ? 'GET' : 'POST', headers: h, body: payload });
    for (const cookie of res.headers.getSetCookie()) { const first = cookie.split(';')[0]; const eq = first.indexOf('='); actor.cookies.set(first.slice(0, eq), first.slice(eq + 1)); }
    const text = Buffer.from(await res.arrayBuffer()).toString('utf8'); // BOM korunur (CSV denetimi)
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (json.csrf) actor.csrf = json.csrf;
    return { status: res.status, body: json, text, headers: res.headers };
  };
  return actor;
}

const outbox = data => { const d = path.join(data, 'outbox'); return fs.existsSync(d) ? fs.readdirSync(d).sort().map(f => fs.readFileSync(path.join(d, f), 'utf8')) : []; };
const subject = eml => Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(eml)[1], 'base64').toString('utf8');
const recipient = eml => /^To: (.*)$/m.exec(eml)[1].trim();
const customer = (over = {}) => ({
  customer: { name: 'Sentetik Müşteri', email: 'musteri@example.test', phone: '0532 000 00 00' },
  billing: { type: 'kurumsal', company: 'Sentetik Sanayi Ltd. Şti.', taxOffice: 'Bornova', vkn: '1234567890', address: 'Sentetik Mah. Deneme Cad. No:5', city: 'İzmir', district: 'Bornova' },
  shippingAddress: { sameAsBilling: true }, notes: 'Mesai saatlerinde teslim edilsin.', consents: { preInfo: true, contract: true },
  website: '', formTimestamp: String(Date.now()), ...over });

test('Mağaza API: fiyat, sepet, sipariş, durum, panel ve sızıntı denetimi', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-magaza-api-'));
  const data = path.join(sandbox, 'data'); fs.mkdirSync(data);
  writeState(data);
  const srv = await server(data);
  const anon = client(srv.base);
  const publicTexts = [];
  try {
    // ---------------------------------------------------------------- fiyatlar
    let r = await anon.call('magaza', 'fiyatlar');
    assert.equal(r.status, 422, 'fiyatlar needs ?ids= (no public action iterates the whole catalog)'); assert.equal(r.body.error, 'invalid_ids');
    r = await anon.call('magaza', 'fiyatlar', { query: { ids: Array.from({ length: 101 }, (_, i) => `vgm-${1000 + i}`).join(',') } });
    assert.equal(r.status, 422, 'at most 100 ids');
    r = await anon.call('magaza', 'fiyatlar', { query: { ids: 'vgm-9001,vgm-9999,../x' } });
    assert.deepEqual(Object.keys(r.body.items), ['vgm-9001'], 'unknown and malformed ids are skipped');
    r = await anon.call('magaza', 'fiyatlar', { query: IDS });
    assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.open, true); publicTexts.push(r.text);
    const items = r.body.items;
    assert.deepEqual(Object.keys(items).sort(), ['vgm-9001', 'vgm-9002', 'vgm-9003', 'vgm-9004', 'vgm-9005']);
    // costUsd 100 × 1,15 marj = 115 USD → 115 × 40 = 4600 TL → %20 KDV ile 5520 TL
    assert.equal(items['vgm-9001'].tryGross, 5520); assert.equal(items['vgm-9001'].tryNet, 4600); assert.equal(items['vgm-9001'].orderable, true);
    assert.equal(items['vgm-9005'].tryGross, 1656);
    assert.equal(items['vgm-9002'].reason, 'stale'); assert.equal(items['vgm-9002'].orderable, false);
    assert.equal(items['vgm-9003'].reason, 'held'); assert.equal(items['vgm-9004'].reason, 'freight');
    assert.ok(items['vgm-9002'].reasonText.length > 10);

    // ---------------------------------------------------------------- sepet doğrulama
    for (const [body, status, code] of [[{ items: 'x' }, 400, 'invalid_cart'], [{ items: [] }, 422, 'empty_cart'],
      [{ items: [{ id: 'vgm-0000', qty: 1 }] }, 422, 'unknown_product'], [{ items: [{ id: 'vgm-9001', qty: 0 }] }, 422, 'invalid_qty'],
      [{ items: [{ id: 'vgm-9001', qty: 51 }] }, 422, 'qty_limit']]) {
      r = await anon.call('magaza', 'sepet', { body, csrf: false });
      assert.equal(r.status, status, JSON.stringify(body)); assert.equal(r.body.error, code);
    }
    r = await anon.call('magaza', 'sepet', { body: { items: [{ id: 'vgm-9001', qty: 1 }] }, csrf: false, headers: { Origin: 'https://kotu.example' } });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'forbidden_origin');

    // ---------------------------------------------------------------- sepet fiyatı
    r = await anon.call('magaza', 'sepet', { body: { items: [{ id: 'vgm-9001', qty: 2 }, { id: 'vgm-9005', qty: 1 }, { id: 'vgm-9002', qty: 1 }] }, csrf: false });
    assert.equal(r.status, 200); publicTexts.push(r.text);
    const cart = r.body;
    assert.equal(cart.lines.length, 3);
    assert.equal(cart.lines.find(l => l.id === 'vgm-9002').orderable, false);
    assert.equal(cart.totals.tryGross, 2 * 5520 + 1656); assert.equal(cart.totals.tryNet, 2 * 4600 + 1380); assert.equal(cart.totals.tryVat, 2116);
    assert.ok(cart.quote && cart.quote.token); assert.ok(cart.warnings.some(w => w.includes('Deneme Marka DM-INV-5K')));
    const items2 = [{ id: 'vgm-9001', qty: 2 }, { id: 'vgm-9005', qty: 1 }];

    // ---------------------------------------------------------------- ön bilgilendirme
    r = await anon.call('magaza', 'onbilgi', { body: { quote: cart.quote.token, items: items2, ...customer() }, csrf: false });
    assert.equal(r.status, 200); publicTexts.push(r.text);
    for (const t of ['Sentetik Test Elektrik Ltd. Şti.', IBAN, '12.696,00 ₺', 'Sentetik Sanayi Ltd. Şti.', 'CAYMA']) assert.ok((r.body.preInfo + r.body.contract).includes(t), t);
    r = await anon.call('magaza', 'onbilgi', { body: { quote: cart.quote.token.slice(0, -2) + 'AA', items: items2, ...customer() }, csrf: false });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'quote_expired');

    // ---------------------------------------------------------------- sipariş doğrulama
    const order = (id, over = {}) => ({ requestId: id, quote: cart.quote.token, items: items2, ...customer(over) });
    r = await anon.call('magaza', 'siparis', { body: order('req-consent-000001', { consents: {} }), csrf: false });
    assert.equal(r.status, 422); assert.equal(r.body.error, 'invalid_order');
    assert.ok(r.body.fields['consents.preInfo'] && r.body.fields['consents.contract']);
    r = await anon.call('magaza', 'siparis', { body: order('req-vkn-0000000001', { billing: { ...customer().billing, vkn: '1234567891' } }), csrf: false });
    assert.equal(r.status, 422); assert.ok(r.body.fields['billing.vkn']);
    r = await anon.call('magaza', 'siparis', { body: { ...order('req-mismatch-00001'), items: [{ id: 'vgm-9001', qty: 3 }, { id: 'vgm-9005', qty: 1 }] }, csrf: false });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'quote_expired');
    r = await anon.call('magaza', 'siparis', { body: order('req-honeypot-00001', { website: 'http://spam' }), csrf: false });
    assert.equal(r.status, 422); assert.equal(r.body.error, 'rejected');
    assert.equal(outbox(data).length, 0, 'Reddedilen siparişler e-posta üretmez');

    // ---------------------------------------------------------------- başarılı sipariş
    r = await anon.call('magaza', 'siparis', { body: order('req-success-000001'), csrf: false });
    assert.equal(r.status, 200, JSON.stringify(r.body)); publicTexts.push(r.text);
    const placed = r.body;
    assert.match(placed.reference, REF); assert.equal(placed.amountTry, 12696); assert.equal(placed.bank.iban, IBAN);
    assert.equal(placed.duplicate, false); assert.equal(placed.mailSent, true);
    assert.ok(Math.abs(Date.parse(placed.payBy) / 1000 - (now + 24 * 3600)) < 120);
    let mails = outbox(data);
    assert.equal(mails.length, 2);
    const toCustomer = mails.find(m => recipient(m) === 'musteri@example.test');
    const toStaff = mails.find(m => recipient(m) === 'info@voltguard.com.tr');
    assert.ok(toCustomer && toStaff);
    for (const t of [placed.reference, IBAN, '12.696,00 ₺', 'Hesap sahibi']) assert.ok(toCustomer.includes(t), 'müşteri e-postası: ' + t);
    assert.doesNotMatch(toCustomer, /example\.test\/urun|USD/);
    assert.ok(toStaff.includes(`https://${SUPPLIER}/urun/9001`), 'personel e-postası tedarik kaynağını içerir');
    assert.ok(subject(toCustomer).includes(placed.reference));

    // Tekrar koruması: aynı kimlik + içerik → aynı numara, yeni e-posta yok; değişmiş içerik → 409
    r = await anon.call('magaza', 'siparis', { body: order('req-success-000001'), csrf: false });
    assert.equal(r.status, 200); assert.equal(r.body.reference, placed.reference); assert.equal(r.body.duplicate, true);
    assert.equal(outbox(data).length, 2);
    r = await anon.call('magaza', 'siparis', { body: order('req-success-000001', { notes: 'Başka not' }), csrf: false });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'already_received'); assert.equal(r.body.reference, placed.reference);

    // ---------------------------------------------------------------- durum sorgusu
    r = await anon.call('magaza', 'durum', { body: { reference: placed.reference, email: 'MUSTERI@example.test' }, csrf: false });
    assert.equal(r.status, 200); publicTexts.push(r.text);
    assert.equal(r.body.order.status, 'odeme_bekleniyor'); assert.equal(r.body.order.items.length, 2);
    assert.equal(r.body.order.private, undefined); assert.equal(r.body.order.totals.usdNet, undefined);
    for (const [ref, email] of [[placed.reference, 'baska@example.test'], ['VGS-000000-AAAAA', 'musteri@example.test'], ['../x', 'x']]) {
      r = await anon.call('magaza', 'durum', { body: { reference: ref, email }, csrf: false });
      assert.equal(r.status, 404); assert.equal(r.body.error, 'not_found');
    }

    // ---------------------------------------------------------------- formül enjeksiyonu için ikinci sipariş
    r = await anon.call('magaza', 'sepet', { body: { items: [{ id: 'vgm-9005', qty: 1 }] }, csrf: false });
    const q2 = r.body.quote.token;
    r = await anon.call('magaza', 'siparis', { body: { requestId: 'req-formula-000001', quote: q2, items: [{ id: 'vgm-9005', qty: 1 }],
      ...customer({ customer: { name: '=Sentetik Formül', email: 'formul@example.test', phone: '0232 000 00 00' }, billing: { type: 'bireysel', tckn: '', address: 'Sentetik Mah. Deneme Sok. No:1', city: 'İzmir', district: 'Konak' } }) }, csrf: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const second = r.body.reference;

    // ---------------------------------------------------------------- herkese açık yanıtlarda sızıntı yok
    const all = publicTexts.join('\n');
    assert.doesNotMatch(all, /example\.test\/urun|tedarikci-bir|costTry|costUsd|usdNet|unitUsdNet|"margin"/);

    // ---------------------------------------------------------------- kapalı mağaza
    writeState(data, { open: false });
    r = await anon.call('magaza', 'sepet', { body: { items: [{ id: 'vgm-9001', qty: 1 }] }, csrf: false });
    assert.equal(r.body.open, false); assert.equal(r.body.quote, null); assert.equal(r.body.lines[0].reason, 'closed');
    r = await anon.call('magaza', 'siparis', { body: order('req-closed-0000001'), csrf: false });
    assert.equal(r.status, 503); assert.equal(r.body.error, 'shop_closed');
    // durum dosyaları yeniden yazıldı; siparişler korunur
    writeState(data);

    // ---------------------------------------------------------------- panel yetkisi
    r = await anon.call('magaza', 'panel_me');
    assert.equal(r.body.user, null); assert.equal(r.body.panel, false);
    r = await anon.call('magaza', 'panel_orders');
    assert.equal(r.status, 401);
    const staff = client(srv.base);
    await staff.call('auth', 'me');
    r = await staff.call('auth', 'register', { body: { name: 'Mağaza Personeli', email: `magaza-${process.pid}@example.test`, password: 'Deneme12345', consent: true } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const staffId = r.body.user.id;
    r = await staff.call('magaza', 'panel_me');
    assert.equal(r.body.panel, false);
    r = await staff.call('magaza', 'panel_orders');
    assert.equal(r.status, 403); assert.equal(r.body.error, 'forbidden');
    fs.writeFileSync(path.join(data, 'magaza', 'panel.json'), JSON.stringify({ version: 1, users: { [staffId]: { email: 'x', grantedAt: now } } }));
    r = await staff.call('magaza', 'panel_me');
    assert.equal(r.body.panel, true);

    r = await staff.call('magaza', 'panel_orders');
    assert.equal(r.status, 200); assert.equal(r.body.total, 2); assert.equal(r.body.counts.odeme_bekleniyor, 2);
    r = await staff.call('magaza', 'panel_orders', { query: { q: 'formül' } });
    assert.equal(r.body.total, 1);
    r = await staff.call('magaza', 'panel_order', { query: { ref: placed.reference } });
    assert.equal(r.status, 200); assert.deepEqual(r.body.allowed, ['odeme_alindi', 'iptal']);
    assert.equal(r.body.order.private.sources['vgm-9001'][0].supplier, SUPPLIER);
    assert.equal(r.body.order.items[0].unitUsdNet, 115);

    // durum geçişleri
    const upd = (body, csrf) => staff.call('magaza', 'panel_order_update', { body: { ref: placed.reference, ...body }, csrf });
    r = await upd({ status: 'kargoda' }); assert.equal(r.status, 409); assert.equal(r.body.error, 'invalid_transition');
    r = await upd({ status: 'odeme_alindi' }, false); assert.equal(r.status, 403); assert.equal(r.body.error, 'csrf');
    r = await upd({ status: 'odeme_alindi', note: 'Enpara hesabına geçti' }); assert.equal(r.status, 200); assert.equal(r.body.order.status, 'odeme_alindi');
    r = await upd({ status: 'tedarikte' }); assert.equal(r.status, 200);
    r = await upd({ status: 'kargoda' }); assert.equal(r.status, 422); assert.equal(r.body.error, 'tracking_required');
    const before = outbox(data).length;
    r = await upd({ status: 'kargoda', tracking: { company: 'Sentetik Kargo', code: 'TK123' }, publicNote: 'Siparişiniz yola çıktı.', notify: true });
    assert.equal(r.status, 200); assert.equal(r.body.order.tracking.code, 'TK123');
    mails = outbox(data); assert.equal(mails.length, before + 1);
    assert.ok(mails.some(m => recipient(m) === 'musteri@example.test' && m.includes('TK123') && subject(m).includes('Kargoya verildi')));
    r = await upd({ status: 'iptal' }); assert.equal(r.status, 422); assert.equal(r.body.error, 'note_required');
    r = await anon.call('magaza', 'durum', { body: { reference: placed.reference, email: 'musteri@example.test' }, csrf: false });
    assert.equal(r.body.order.status, 'kargoda'); assert.equal(r.body.order.tracking.company, 'Sentetik Kargo');
    assert.ok(r.body.order.history.some(h => h.note === 'Siparişiniz yola çıktı.'));
    assert.doesNotMatch(r.text, /Enpara hesabına geçti/, 'iç not müşteriye görünmez');

    // fiyat paneli
    r = await staff.call('magaza', 'panel_prices');
    assert.equal(r.status, 200);
    const held = r.body.items.find(i => i.id === 'vgm-9003');
    assert.equal(held.status, 'held'); assert.equal(held.sources[0].supplier, SUPPLIER);
    assert.deepEqual(r.body.items.map(i => i.id), ['vgm-9003'], 'without ?q= only problem products (fiyat-durum.json) are listed');
    assert.equal(r.body.problems, 1); assert.equal(r.body.products, 5);
    assert.equal(r.body.counts.held, 1); assert.equal(r.body.counts.stale, 1); assert.equal(r.body.counts.noSource, 0);
    r = await staff.call('magaza', 'panel_prices', { query: { q: 'vgm-9001' } });
    assert.deepEqual(r.body.items.map(i => [i.id, i.match]), [['vgm-9001', true], ['vgm-9003', false]], 'an id query adds that product');
    r = await staff.call('magaza', 'panel_price_decide', { body: { id: 'vgm-9003', decision: 'approve', note: 'Tedarikçi zam yaptı' } });
    assert.equal(r.status, 200); assert.equal(r.body.item.status, 'ok'); assert.equal(r.body.item.costTry, 200);
    r = await staff.call('magaza', 'panel_price_decide', { body: { id: 'vgm-9002', decision: 'manual', costTry: 24000 } });
    assert.equal(r.status, 422); assert.equal(r.body.error, 'note_required');
    r = await staff.call('magaza', 'panel_price_decide', { body: { id: 'vgm-9002', decision: 'manual', costTry: 24000, note: 'Telefonla teyit' } });
    assert.equal(r.status, 200); assert.equal(r.body.item.status, 'ok'); assert.match(r.body.item.method, /^manual:/);
    r = await anon.call('magaza', 'fiyatlar', { query: IDS });
    assert.equal(r.body.items['vgm-9002'].orderable, true); assert.equal(r.body.items['vgm-9003'].orderable, true);

    r = await staff.call('magaza', 'panel_status');
    assert.equal(r.body.open, true); assert.deepEqual(r.body.firmaMissing, []); assert.equal(r.body.orders.awaitingPayment, 1);

    // CSV
    r = await staff.call('magaza', 'panel_export', { body: {} });
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.ok(r.text.startsWith('﻿"Sipariş No";"Tarih"'), 'UTF-8 BOM + noktalı virgüllü başlık');
    assert.ok(r.text.includes(placed.reference) && r.text.includes(second));
    assert.ok(r.text.includes(`"'=Sentetik Formül"`), 'formül hücresi etkisizleştirilir');
    r = await staff.call('magaza', 'panel_export', { body: { from: '27.10.2026' } });
    assert.equal(r.status, 422); assert.equal(r.body.error, 'invalid_date');

    assert.doesNotMatch(srv.logs.join(''), /Fatal error|Warning:|Notice:|musteri@example\.test/);
  } finally {
    await srv.stop();
    assert.ok(path.relative(os.tmpdir(), sandbox).startsWith('voltguard-magaza-api-'));
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('Mağaza API: satıcı kimliği eksikken (firma-bos.json) sipariş alınmaz', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-magaza-closed-'));
  const data = path.join(sandbox, 'data'); fs.mkdirSync(data);
  writeState(data);
  const srv = await server(data, { VG_MAGAZA_FIRMA: path.join(fixtures, 'firma-bos.json') });
  try {
    const anon = client(srv.base);
    const r = await anon.call('magaza', 'fiyatlar', { query: IDS });
    assert.equal(r.status, 200); assert.equal(r.body.open, false);
    assert.equal(r.body.items['vgm-9001'].reason, 'closed'); assert.equal(r.body.items['vgm-9001'].tryGross, 5520);
  } finally {
    await srv.stop();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('Mağaza API: sipariş anında fiyat yeniden denetlenir; jeton opak; durumda ödeme bilgisi', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-magaza-recheck-'));
  const data = path.join(sandbox, 'data'); fs.mkdirSync(data);
  writeState(data);
  const srv = await server(data);
  try {
    const anon = client(srv.base);
    const items = [{ id: 'vgm-9001', qty: 1 }];
    const quote = async () => (await anon.call('magaza', 'sepet', { body: { items }, csrf: false })).body.quote.token;
    const place = (token, id) => anon.call('magaza', 'siparis', { body: { requestId: id, quote: token, items, ...customer() }, csrf: false });
    const edit = fn => ozel.editPrice(data, 'vgm-9001', fn);

    // SEC-2: jeton çözülünce USD fiyat/kur görünmemeli
    const token = await quote();
    const decoded = Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    assert.doesNotMatch(decoded, /usdTry|usdNet|"lines"|vgm-9001/);
    assert.doesNotMatch(token, /\./, 'Jeton imzalı JSON biçiminde olmamalı');

    // SEC-1: 48 saati geçen / stokta olmayan ürün eski jetonla sipariş edilemez
    edit(i => { i.checkedAt = now - 50 * 3600; });
    let r = await place(token, 'req-stale-0000000001');
    assert.equal(r.status, 409); assert.equal(r.body.error, 'quote_expired');
    edit(i => { i.checkedAt = now - 3600; i.status = 'unavailable'; i.available = false; });
    r = await place(token, 'req-unavail-000000001');
    assert.equal(r.status, 409); assert.equal(r.body.error, 'quote_expired');
    edit(i => { i.status = 'held'; i.available = true; });
    r = await place(token, 'req-held-00000000001');
    assert.equal(r.status, 409); assert.equal(r.body.error, 'quote_expired');
    assert.equal(outbox(data).length, 0);
    edit(i => { i.status = 'ok'; });
    const t2 = await quote();

    // F7: önbilgilendirme metni sipariş kaydı/e-postası ile aynı (sipariş numarası hariç)
    const pre = await anon.call('magaza', 'onbilgi', { body: { quote: t2, items, ...customer() }, csrf: false });
    r = await place(t2, 'req-ok-0000000000001');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ref = r.body.reference;
    const mail = outbox(data).find(m => recipient(m) === 'musteri@example.test');
    assert.ok(mail && !/son ödeme: /.test(pre.body.contract + pre.body.preInfo));
    assert.match(pre.body.preInfo + pre.body.contract, /\d{2}\.\d{2}\.\d{4} tarihli TCMB/);

    // UX-2: durum sayfası ödeme bilgilerini verir; USD kuru yok
    r = await anon.call('magaza', 'durum', { body: { reference: ref, email: 'musteri@example.test' }, csrf: false });
    assert.equal(r.status, 200);
    const o = r.body.order;
    assert.equal(o.payment.iban, IBAN); assert.equal(o.payment.description, ref); assert.equal(o.payment.amountTry, 5520);
    assert.equal(o.payOverdue, false); assert.deepEqual(Object.keys(o.rate), ['date']);
    assert.doesNotMatch(r.text, /usdTry/);

    // UX-4: süresi geçen ödeme bekleyen sipariş için ödeme bilgisi verilmez, uyarı gösterilir
    const ordersFile = path.join(data, 'magaza', 'siparisler.json');
    const all = JSON.parse(fs.readFileSync(ordersFile, 'utf8')); all.orders[ref].payBy = now - 7200; fs.writeFileSync(ordersFile, JSON.stringify(all));
    r = await anon.call('magaza', 'durum', { body: { reference: ref, email: 'musteri@example.test' }, csrf: false });
    assert.equal(r.body.order.payOverdue, true); assert.equal(r.body.order.payment, null); assert.ok(r.body.order.paymentNote.includes('iletişime'));
    assert.doesNotMatch(srv.logs.join(''), /Fatal error|Warning:|Notice:/);
  } finally {
    await srv.stop();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------------------------------------ P1-09/10/03/01 */

/** Test kataloğunun kopyası: vgm-9001 metre ile (en az 100 m, 50 m katları, 100 m rulo, 3 gün); olcu-ve-test kategorisi 5 gün. */
function rulesCatalog(dir) {
  const K = require('../magaza/katalog-ortak.cjs');
  const model = K.loadDir(path.join(fixtures, 'katalog'));
  Object.assign(model.products.find(p => p.id === 'vgm-9001'), { unit: 'metre', maxQty: 900, minQty: 100, step: 50, packQty: 100 });
  K.writeDir(dir, K.buildFiles(K.normalize(model)));
  // deliveryDays katalog yazıcısının şemasında henüz yok (ux-backlog P1-10): okuyucuyu sınamak için dosyaya doğrudan yazılır
  const shard = path.join(dir, 'urun', K.shardOf('vgm-9001') + '.json');
  const urun = JSON.parse(fs.readFileSync(shard, 'utf8')); urun.products['vgm-9001'].deliveryDays = 3; fs.writeFileSync(shard, JSON.stringify(urun));
  const katFile = path.join(dir, 'kategoriler.json');
  const kat = JSON.parse(fs.readFileSync(katFile, 'utf8')); kat.categories.find(c => c.id === 'olcu-ve-test').deliveryDays = 5; fs.writeFileSync(katFile, JSON.stringify(kat));
  return dir;
}

test('P1-09/10/01: adet kuralları sunucuda (qty_step), sepet satırı minQty/step/packQty/unit/deliveryDays, belgede termin', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-magaza-rules-'));
  const data = path.join(sandbox, 'data'); fs.mkdirSync(data);
  const catalog = rulesCatalog(path.join(sandbox, 'katalog'));
  writeState(data);
  const srv = await server(data, { VG_MAGAZA_CATALOG: catalog });
  const anon = client(srv.base);
  try {
    for (const [items, code] of [[[{ id: 'vgm-9001', qty: 50 }], 'qty_step'], [[{ id: 'vgm-9001', qty: 120 }], 'qty_step'],
      [[{ id: 'vgm-9001', qty: 100 }, { id: 'vgm-9001', qty: 25 }], 'qty_step'], [[{ id: 'vgm-9001', qty: 950 }], 'qty_limit']]) {
      const r = await anon.call('magaza', 'sepet', { body: { items }, csrf: false });
      assert.equal(r.status, 422, JSON.stringify(items)); assert.equal(r.body.error, code, JSON.stringify(items));
      if (code === 'qty_step') assert.match(r.body.message, /en az 100 metre ve 50 metre katları ile sipariş edilebilir/);
    }
    let r = await anon.call('magaza', 'sepet', { body: { items: [{ id: 'vgm-9001', qty: 100 }, { id: 'vgm-9001', qty: 50 }, { id: 'vgm-9005', qty: 3 }] }, csrf: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const line = r.body.lines.find(l => l.id === 'vgm-9001'), mm = r.body.lines.find(l => l.id === 'vgm-9005');
    assert.equal(line.qty, 150);
    assert.deepEqual([line.unit, line.minQty, line.step, line.packQty, line.maxQty, line.deliveryDays], ['metre', 100, 50, 100, 900, 3]);
    assert.deepEqual([mm.unit, mm.minQty, mm.step, mm.packQty, mm.deliveryDays], ['adet', 1, 1, null, 5], 'kategori varsayılan termini');
    const items = [{ id: 'vgm-9001', qty: 150 }, { id: 'vgm-9005', qty: 3 }];
    const pre = await anon.call('magaza', 'onbilgi', { body: { quote: r.body.quote.token, items, ...customer() }, csrf: false });
    assert.equal(pre.status, 200, JSON.stringify(pre.body));
    assert.match(pre.body.preInfo, /150 metre ×/); assert.match(pre.body.preInfo, /Tahmini teslim süresi: 3 gün/); assert.match(pre.body.preInfo, /Tahmini teslim süresi: 5 gün/);
    // P1-01 (c): sipariş belgeleri ve müşteri e-postasında yer tutucu, boş alan ya da "yayından önce" notu yok
    for (const doc of [pre.body.preInfo, pre.body.contract]) assert.doesNotMatch(doc, /\[|yayından önce|\bnull\b|undefined/);
    r = await anon.call('magaza', 'siparis', { body: { requestId: 'req-rules-00000001', quote: r.body.quote.token, items, ...customer() }, csrf: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const mail = outbox(data).find(m => recipient(m) === 'musteri@example.test');
    const text = mail.split(/\r?\n\r?\n/).slice(1).join('\n');   // 8bit gövde
    assert.match(text, /Tahmini teslim süresi: 3 gün/);
    assert.doesNotMatch(text, /\[|yayından önce|\bnull\b|undefined/);
    assert.doesNotMatch(srv.logs.join(''), /Fatal error|Warning:|Notice:/);
  } finally {
    await srv.stop();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('P1-03: üretimde Turnstile anahtarı (site ya da gizli) yoksa sipariş 503 captcha_unconfigured; önizlemede anahtarsız çalışır', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-magaza-captcha-'));
  const data = path.join(sandbox, 'data'); fs.mkdirSync(data);
  writeState(data);
  const noSite = path.join(sandbox, 'firma.json');
  fs.writeFileSync(noSite, JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(fixtures, 'firma-tam.json'), 'utf8')), turnstileSiteKey: null }));
  for (const env of [{ VG_MAIL_OUTBOX: '', TURNSTILE_SECRET_KEY: '' }, { VG_MAIL_OUTBOX: '', TURNSTILE_SECRET_KEY: 'REPLACE_WITH_TURNSTILE_SECRET_KEY' },
    { VG_MAIL_OUTBOX: '', TURNSTILE_SECRET_KEY: 'gizli-test-anahtari', VG_MAGAZA_FIRMA: noSite }]) {
    const srv = await server(data, env);
    try {
      const anon = client(srv.base);
      const cart = await anon.call('magaza', 'sepet', { body: { items: [{ id: 'vgm-9001', qty: 1 }] }, csrf: false });
      assert.equal(cart.status, 200, 'sepet ve fiyat anahtarsız da çalışır');
      const r = await anon.call('magaza', 'siparis', { body: { requestId: 'req-captcha-000001', quote: cart.body.quote.token, items: [{ id: 'vgm-9001', qty: 1 }], ...customer() }, csrf: false });
      assert.equal(r.status, 503, JSON.stringify(env)); assert.equal(r.body.error, 'captcha_unconfigured');
      assert.match(r.body.message, /güvenlik doğrulaması henüz yapılandırılmadı.*0545 434 67 35/);
      assert.equal(outbox(data).length, 0);
    } finally { await srv.stop(); }
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('sepet önce: sipariş edilemeyen satırlar sepette (teklif için) gösterim kuralıyla döner; sipariş ucu yalnızca imzalı, siparişe hazır satırları kabul eder', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-magaza-sepet-once-'));
  const data = path.join(sandbox, 'data'); fs.mkdirSync(data);
  writeState(data);
  const srv = await server(data);
  const anon = client(srv.base);
  try {
    const mixed = [{ id: 'vgm-9001', qty: 1 }, { id: 'vgm-9002', qty: 2 }, { id: 'vgm-9003', qty: 1 }, { id: 'vgm-9004', qty: 1 }];
    let r = await anon.call('magaza', 'sepet', { body: { items: mixed }, csrf: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const cart = r.body, line = id => cart.lines.find(l => l.id === id);
    assert.equal(cart.open, true); assert.equal(cart.orderable, false, 'sepetin tamamı siparişe hazır değil');
    assert.equal(cart.lines.length, 4, 'sipariş edilemeyen satırlar da sepette kalır');
    assert.equal(line('vgm-9001').orderable, true); assert.equal(line('vgm-9001').display, 'verified'); assert.equal(line('vgm-9001').lineTryGross, 5520);
    assert.equal(line('vgm-9004').orderable, false); assert.equal(line('vgm-9004').reason, 'freight'); assert.equal(line('vgm-9004').display, 'verified');
    assert.equal(line('vgm-9004').unitTryGross, 82800); assert.equal(line('vgm-9004').lineEstimate, 82800); assert.equal(line('vgm-9004').lineTryGross, null);
    assert.equal(line('vgm-9003').reason, 'held'); assert.equal(line('vgm-9003').display, null, 'bekletilen fiyat gösterilmez');
    assert.equal(line('vgm-9003').unitTryGross, null); assert.equal(line('vgm-9003').unitTryNet, null); assert.equal(line('vgm-9003').lineEstimate, undefined);
    const l2 = line('vgm-9002');
    assert.equal(l2.orderable, false);
    if (l2.display === null) assert.equal(l2.unitTryGross, null);
    else { assert.equal(l2.display, 'last'); assert.equal(l2.lineEstimate, Math.round(l2.unitTryGross * 2 * 100) / 100); }
    assert.equal(cart.totals.tryGross, 5520, 'sipariş toplamına yalnızca siparişe hazır satır girer');
    assert.equal(cart.estimate.tryGross, Math.round((5520 + 82800 + (l2.lineEstimate || 0)) * 100) / 100, 'bilgi amaçlı tahmin gösterilen fiyatlarla');
    assert.equal(cart.estimate.unpriced, l2.display === null ? 2 : 1);
    assert.ok(cart.quote && cart.quote.token, 'imzalı jeton yalnızca siparişe hazır satırları taşır');

    // Sipariş ucu: jetonda olmayan (sipariş edilemeyen) satır eklenirse reddedilir; e-posta yok
    const before = outbox(data).length;
    r = await anon.call('magaza', 'siparis', { body: { requestId: 'req-sepet-once-0001', quote: cart.quote.token, items: mixed, ...customer() }, csrf: false });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'quote_expired');
    r = await anon.call('magaza', 'siparis', { body: { requestId: 'req-sepet-once-0002', quote: cart.quote.token, items: [{ id: 'vgm-9001', qty: 1 }, { id: 'vgm-9004', qty: 1 }], ...customer() }, csrf: false });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'quote_expired', 'nakliye satırı siparişe sokulamaz');
    assert.equal(outbox(data).length, before);

    // Sepetin tamamı siparişe hazırsa "orderable": true
    r = await anon.call('magaza', 'sepet', { body: { items: [{ id: 'vgm-9001', qty: 1 }, { id: 'vgm-9005', qty: 2 }] }, csrf: false });
    assert.equal(r.body.orderable, true); assert.equal(r.body.estimate.unpriced, 0);

    // Kapalı mağaza: sepet yine fiyatlanır (teklif için), sipariş edilemez; sipariş ucu 503 shop_closed
    const okToken = r.body.quote.token;
    writeState(data, { open: false });
    r = await anon.call('magaza', 'sepet', { body: { items: [{ id: 'vgm-9001', qty: 3 }, { id: 'vgm-9003', qty: 1 }] }, csrf: false });
    assert.equal(r.status, 200); assert.equal(r.body.open, false); assert.equal(r.body.orderable, false); assert.equal(r.body.quote, null);
    assert.equal(r.body.lines[0].reason, 'closed'); assert.equal(r.body.lines[0].display, 'verified'); assert.equal(r.body.lines[0].lineEstimate, 16560);
    assert.equal(r.body.estimate.tryGross, 16560); assert.equal(r.body.estimate.unpriced, 1);
    r = await anon.call('magaza', 'siparis', { body: { requestId: 'req-sepet-once-0003', quote: okToken, items: [{ id: 'vgm-9001', qty: 1 }, { id: 'vgm-9005', qty: 2 }], ...customer() }, csrf: false });
    assert.equal(r.status, 503); assert.equal(r.body.error, 'shop_closed');
    assert.equal(outbox(data).length, before);
    assert.doesNotMatch(JSON.stringify(cart), /costUsd|usdNet|tedarikci-bir/);
  } finally {
    await srv.stop();
    assert.doesNotMatch(srv.logs.join(''), /Fatal error|Warning:|Notice:|Deprecated:/);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('üye hesabı: sipariş oturumdan bağlanır, üye yalnızca kendi siparişini görür, eski siparişler yalnızca doğrulanmış e-postayla eklenir', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-magaza-uye-'));
  const data = path.join(sandbox, 'data'); fs.mkdirSync(data);
  writeState(data);
  const srv = await server(data);
  const anon = client(srv.base);
  const orders = () => JSON.parse(fs.readFileSync(path.join(data, 'magaza', 'siparisler.json'), 'utf8')).orders;
  const FORGED = 'u' + '0'.repeat(24);
  const place = async (actor, requestId, email, { csrf = false, extra = {} } = {}) => {
    const items = [{ id: 'vgm-9005', qty: 1 }];
    const q = await actor.call('magaza', 'sepet', { body: { items }, csrf: false });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    return actor.call('magaza', 'siparis', { csrf, body: { requestId, quote: q.body.quote.token, items,
      ...customer({ customer: { name: 'Sentetik Üye', email, phone: '0532 000 00 00' } }), ...extra } });
  };
  const register = async (name, email) => {
    const c = client(srv.base);
    await c.call('auth', 'me');
    const r = await c.call('auth', 'register', { body: { name, email, password: 'Deneme12345', consent: true } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    c.id = r.body.user.id;
    return c;
  };
  try {
    // Misafir siparişleri (üye girişi yok); istemcinin gönderdiği üye kimliği yok sayılır
    let r = await place(anon, 'req-uye-guest-00001', 'alice@example.test', { extra: { member: { id: FORGED }, memberId: FORGED } });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.account, null);
    const guestA = r.body.reference;
    r = await place(anon, 'req-uye-guest-00002', 'kurban@example.test');
    const guestVictim = r.body.reference;
    assert.equal(orders()[guestA].member, undefined, 'misafir siparişine istemci girdisinden üye bağlanmaz');

    // Oturumsuz üye uçları
    r = await anon.call('magaza', 'hesap_profil');
    assert.equal(r.status, 200); assert.equal(r.body.user, null);
    assert.ok(!anon.cookies.has('VGSESS'), 'çerezsiz profil sorgusu oturum açmaz');
    r = await anon.call('magaza', 'hesap_siparisler'); assert.equal(r.status, 401);
    r = await anon.call('magaza', 'hesap_siparis', { query: { ref: guestA } }); assert.equal(r.status, 401);
    r = await anon.call('magaza', 'hesap_sahiplen', { body: {}, csrf: false }); assert.equal(r.status, 403);

    // Üye: profil, oturumdan bağlanan sipariş ve kayıtlı bilgi
    const alice = await register('Alice Sentetik', 'alice@example.test');
    r = await alice.call('magaza', 'hesap_profil');
    assert.equal(r.status, 200); assert.equal(r.body.user.email, 'alice@example.test'); assert.equal(r.body.saved, null); assert.equal(r.body.verified, false);
    assert.ok(r.body.csrf);
    r = await place(alice, 'req-uye-alice-00001', 'alice-fatura@example.test', { csrf: alice.csrf, extra: { saveDetails: true, member: { id: FORGED } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.account, { linked: true, saved: true });
    const linked = r.body.reference;
    assert.equal(orders()[linked].member.id, alice.id, 'üye kimliği oturumdan (sahte kimlik yok sayılır)');
    assert.equal(orders()[linked].member.via, 'checkout');
    // CSRF jetonu olmadan (çerez olsa bile) bağlanmaz
    r = await place(alice, 'req-uye-alice-00002', 'alice@example.test');
    assert.equal(r.status, 200); assert.equal(r.body.account, null);
    const unlinkedOwn = r.body.reference;
    assert.equal(orders()[unlinkedOwn].member, undefined);
    // Yanlış CSRF jetonu (oturum başka sekmede değişti): sipariş alınır, bağlanmadığı açıkça bildirilir (sahte başarı yok)
    r = await place(alice, 'req-uye-alice-00003', 'alice@example.test', { csrf: 'yanlis-jeton' });
    assert.equal(r.status, 200); assert.deepEqual(r.body.account, { linked: false, saved: false }); assert.equal(orders()[r.body.reference].member, undefined);
    const unlinkedOwn2 = r.body.reference;

    r = await alice.call('magaza', 'hesap_profil');
    assert.equal(r.body.saved.billing.company, 'Sentetik Sanayi Ltd. Şti.'); assert.equal(r.body.saved.customer.phone, '0532 000 00 00');

    // Liste: doğrulanmamış e-postada misafir siparişleri EKLENMEZ
    r = await alice.call('magaza', 'hesap_siparisler');
    assert.equal(r.status, 200); assert.equal(r.body.verified, false); assert.equal(r.body.claimed, 0);
    assert.deepEqual(r.body.orders.map(o => o.reference), [linked]);
    assert.equal(r.body.orders[0].payment.iban, IBAN); assert.equal(r.body.hasSaved, true);
    r = await alice.call('magaza', 'hesap_sahiplen', { body: {} });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'email_unverified');
    assert.equal(orders()[guestA].member, undefined);

    // Ayrıntı: belgeler var, tedarikçi/USD/özel alan yok
    r = await alice.call('magaza', 'hesap_siparis', { query: { ref: linked } });
    assert.equal(r.status, 200);
    assert.match(r.body.order.docs.preInfo, /^ÖN BİLGİLENDİRME FORMU/); assert.match(r.body.order.docs.contract, /MESAFELİ SATIŞ SÖZLEŞMESİ/);
    assert.equal(r.body.order.payment.iban, IBAN); assert.equal(r.body.order.history[0].status, 'odeme_bekleniyor');
    assert.doesNotMatch(r.text, /tedarikci-bir|costTry|usdNet|unitUsdNet|"private"|ipHash|"member"/);
    r = await alice.call('magaza', 'hesap_siparis', { query: { ref: guestA } });
    assert.equal(r.status, 404, 'bağlı olmayan sipariş açılmaz');

    // Başka üye: Alice'in siparişini göremez; misafir sipariş e-postasıyla kayıt olsa da doğrulamadan ekleyemez
    const mallory = await register('Mallory Sentetik', 'kurban@example.test');
    r = await mallory.call('magaza', 'hesap_siparis', { query: { ref: linked } });
    assert.equal(r.status, 404); assert.doesNotMatch(r.text, /alice/i);
    r = await mallory.call('magaza', 'hesap_siparisler');
    assert.equal(r.body.orders.length, 0); assert.equal(r.body.verified, false);
    r = await mallory.call('magaza', 'hesap_sahiplen', { body: {} });
    assert.equal(r.status, 403);
    assert.equal(orders()[guestVictim].member, undefined, 'doğrulanmamış e-posta misafir siparişini sahiplenemez');
    // Üye uçlarında CSRF zorunlu
    r = await mallory.call('magaza', 'hesap_dogrula_gonder', { body: {}, csrf: 'yanlis' });
    assert.equal(r.status, 403);

    // E-posta doğrulama: kod hesabın e-postasına gider; yanlış kod reddedilir; doğru kod eski siparişleri ekler
    const before = new Set(outbox(data));   // dosya adları sıralı değil: önceki postalar küme farkıyla ayrılır
    r = await alice.call('magaza', 'hesap_dogrula_gonder', { body: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.sent, true);
    const mail = outbox(data).filter(m => !before.has(m)).find(m => recipient(m) === 'alice@example.test' && /^\s{4}\d{6}\s*$/m.test(m));
    assert.ok(mail, 'kod hesabın e-postasına gönderilir');
    const code = /^\s{4}(\d{6})\s*$/m.exec(mail)[1];
    r = await alice.call('magaza', 'hesap_dogrula', { body: { code: code === '000000' ? '111111' : '000000' } });
    assert.equal(r.status, 422); assert.equal(r.body.error, 'wrong_code');
    assert.equal(orders()[guestA].member, undefined);
    r = await mallory.call('magaza', 'hesap_dogrula', { body: { code } });
    assert.notEqual(r.status, 200, 'başka üyenin kodu işe yaramaz');
    r = await alice.call('magaza', 'hesap_dogrula', { body: { code } });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.verified, true); assert.equal(r.body.claimed, 3);
    for (const ref of [guestA, unlinkedOwn, unlinkedOwn2]) { assert.equal(orders()[ref].member.id, alice.id); assert.equal(orders()[ref].member.via, 'claim'); }
    assert.equal(orders()[guestVictim].member, undefined, 'başka e-postanın siparişi eklenmez');
    r = await alice.call('magaza', 'hesap_siparisler');
    assert.equal(r.body.verified, true); assert.equal(r.body.orders.length, 4);
    // Doğrulanmış üye: sonradan misafir olarak verilen sipariş listede kendiliğinden eklenir
    r = await place(anon, 'req-uye-guest-00003', 'ALICE@example.test');
    const later = r.body.reference;
    r = await alice.call('magaza', 'hesap_siparisler');
    assert.equal(r.body.claimed, 1); assert.ok(r.body.orders.some(o => o.reference === later));
    r = await mallory.call('magaza', 'hesap_siparis', { query: { ref: later } });
    assert.equal(r.status, 404);

    // Personel paneli üye bağlantısını görür
    const staff = await register('Mağaza Personeli', 'personel-uye@example.test');
    fs.writeFileSync(path.join(data, 'magaza', 'panel.json'), JSON.stringify({ version: 1, users: { [staff.id]: { email: 'x', grantedAt: now } } }));
    r = await staff.call('magaza', 'panel_order', { query: { ref: linked } });
    assert.equal(r.status, 200); assert.equal(r.body.memberInfo.id, alice.id); assert.equal(r.body.memberInfo.email, 'alice@example.test');
    assert.equal(r.body.memberInfo.via, 'checkout');
    r = await staff.call('magaza', 'panel_orders');
    assert.equal(r.body.orders.find(o => o.ref === linked).member, 'checkout');
    assert.equal(r.body.orders.find(o => o.ref === guestVictim).member, null);

    // Kayıtlı bilgi silinir; dışa aktarma bağlı siparişleri içerir; hesap silinince bağlantı kalkar, sipariş kalır
    r = await alice.call('magaza', 'hesap_adres_sil', { body: {} });
    assert.equal(r.body.removed, true);
    r = await alice.call('magaza', 'hesap_profil'); assert.equal(r.body.saved, null);
    r = await alice.call('auth', 'export');
    assert.equal(r.status, 200);
    const exp = JSON.parse(r.text);
    assert.equal(exp.shop.orders.length, 5); assert.equal(exp.shop.verifiedEmail.email, 'alice@example.test');
    assert.doesNotMatch(r.text, /tedarikci-bir|usdNet/);
    r = await alice.call('auth', 'delete_account', { body: { confirm: true, password: 'Deneme12345' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = orders();
    assert.ok(after[linked], 'sipariş kaydı yasal süre boyunca kalır');
    for (const ref of [linked, guestA, later]) { assert.equal(after[ref].member, undefined); assert.ok(after[ref].memberUnlinkedAt); }
    const members = JSON.parse(fs.readFileSync(path.join(data, 'magaza', 'uyeler.json'), 'utf8')).members;
    assert.equal(members[alice.id], undefined);
  } finally {
    await srv.stop();
    assert.doesNotMatch(srv.logs.join(''), /Fatal error|Warning:|Notice:|Deprecated:/);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('üye hesabı: doğrulama kodu tahmini e-posta adresine göre sınırlanır (hesap silinip yeniden açılsa da), T.C. kimlik no kayıtlı bilgide tutulmaz', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-magaza-uye-sinir-'));
  const data = path.join(sandbox, 'data'); fs.mkdirSync(data);
  writeState(data);
  const srv = await server(data, { VG_RATE_SCALE: '1' });
  const register = async (email) => {
    const c = client(srv.base);
    await c.call('auth', 'me');
    const r = await c.call('auth', 'register', { body: { name: 'Sentetik Saldırgan', email, password: 'Deneme12345', consent: true } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    c.id = r.body.user.id;
    await c.call('magaza', 'hesap_profil');
    return c;
  };
  const codeFor = (before) => {
    const mail = outbox(data).filter(m => !before.has(m)).find(m => recipient(m) === 'hedef@example.test' && /^\s{4}\d{6}\s*$/m.test(m));
    assert.ok(mail); return /^\s{4}(\d{6})\s*$/m.exec(mail)[1];
  };
  const wrong = (code) => String((Number(code) + 1) % 1000000).padStart(6, '0');
  try {
    let atk = await register('hedef@example.test');
    // Kayıtlı bilgi: T.C. kimlik no saklanmaz ve hesap_profil ile okunamaz
    const items = [{ id: 'vgm-9005', qty: 1 }];
    let r = await atk.call('magaza', 'sepet', { body: { items }, csrf: false });
    r = await atk.call('magaza', 'siparis', { csrf: atk.csrf, body: { requestId: 'req-uye-tckn-000001', quote: r.body.quote.token, items, saveDetails: true,
      ...customer({ customer: { name: 'Sentetik Üye', email: 'hedef@example.test', phone: '0532 000 00 00' },
        billing: { type: 'bireysel', tckn: '10000000146', address: 'Sentetik Mah. Deneme Sok. No:1', city: 'İzmir', district: 'Konak' } }) } });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body.account, { linked: true, saved: true });
    r = await atk.call('magaza', 'hesap_profil');
    assert.equal(r.body.saved.billing.type, 'bireysel'); assert.equal(r.body.saved.billing.tckn, '');
    assert.doesNotMatch(r.text, /10000000146/);
    assert.doesNotMatch(fs.readFileSync(path.join(data, 'magaza', 'uyeler.json'), 'utf8'), /10000000146/);

    // İki kod × 5 hatalı deneme = adres başına günlük 10 hata; sonra kilit
    let before = new Set(outbox(data));
    r = await atk.call('magaza', 'hesap_dogrula_gonder', { body: {} }); assert.equal(r.status, 200, JSON.stringify(r.body));
    let code = codeFor(before);
    for (let i = 0; i < 5; i++) { r = await atk.call('magaza', 'hesap_dogrula', { body: { code: wrong(code) } }); assert.equal(r.status, 422); }
    r = await atk.call('magaza', 'hesap_dogrula', { body: { code } }); assert.equal(r.status, 410, 'kod başına 5 deneme');
    before = new Set(outbox(data));
    r = await atk.call('magaza', 'hesap_dogrula_gonder', { body: {} }); assert.equal(r.status, 200);
    code = codeFor(before);
    for (let i = 0; i < 5; i++) { r = await atk.call('magaza', 'hesap_dogrula', { body: { code: wrong(code) } }); assert.equal(r.status, 422); }
    r = await atk.call('magaza', 'hesap_dogrula_gonder', { body: {} });
    assert.equal(r.status, 429, 'günlük hata sınırı dolunca yeni kod da verilmez');

    // Hesabı silip aynı e-postayla yeniden kayıt (yeni uid): sınır e-postaya bağlı olduğu için sürer
    r = await atk.call('auth', 'delete_account', { body: { confirm: true, password: 'Deneme12345' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const again = await register('hedef@example.test');
    assert.notEqual(again.id, atk.id);
    r = await again.call('magaza', 'hesap_dogrula_gonder', { body: {} });
    assert.equal(r.status, 429, JSON.stringify(r.body));
    r = await again.call('magaza', 'hesap_dogrula', { body: { code: '123456' } });
    assert.equal(r.status, 429, JSON.stringify(r.body));
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'magaza', 'uyeler.json'), 'utf8')).members[again.id], undefined);
  } finally {
    await srv.stop();
    assert.doesNotMatch(srv.logs.join(''), /Fatal error|Warning:|Notice:|Deprecated:/);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
