'use strict';
// Teklif talebi (contact.php kind=quote) gerçek PHP sunucusunda: talep numarası, tekrar gönderim koruması, eksik bilgi,
// simülasyon eki onayı ve teslim hatasından sonra yeniden deneme. E-posta yalnızca geçici klasördeki outbox/'a yazılır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const REF = /^VG-\d{6}-[A-HJ-NP-Z2-9]{5}$/;

async function server(data, environment, flags = []) {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(php, ['-n', ...flags, '-S', `127.0.0.1:${port}`, '-t', root], {
    env: {...process.env, VG_DATA_DIR: data, VG_STORE: 'json', TURNSTILE_SECRET_KEY: '', VG_CONTACT_ALLOWED_ORIGINS: base, ...environment},
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  const logs = []; child.stderr.on('data', chunk => logs.push(String(chunk)));
  for (let i = 0; i < 100; i++) {try {await fetch(`${base}/contact.php`); break;} catch {if (i === 99) throw Error('PHP did not start'); await new Promise(resolve => setTimeout(resolve, 50));}}
  return {base, logs, stop: () => new Promise(resolve => {child.kill(); if (child.exitCode !== null) resolve(); else {child.once('exit', resolve); setTimeout(resolve, 3000);}})};
}
async function post(base, fields) {
  const response = await fetch(`${base}/contact.php`, {method: 'POST', headers: {Origin: base}, body: new URLSearchParams(fields)});
  return {status: response.status, body: await response.json()};
}
const outbox = data => {const dir = path.join(data, 'outbox'); return fs.existsSync(dir) ? fs.readdirSync(dir).map(file => fs.readFileSync(path.join(dir, file), 'utf8')) : [];};
const decodeSubject = eml => Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(eml)[1], 'base64').toString('utf8');
const simulation = {v: 1, kind: 'trafo', title: '3D Trafo Merkezi Simülasyonu', page: '/voltsim/trafo/', version: '2026.10.23',
  inputs: [['Toplam kurulu yük', '850 kW'], ['Eş zamanlılık', '0,8']], results: [['Önerilen trafo', '1000 kVA'], ['Yüklenme', '%74']],
  assumptions: ['Güç faktörü 0,9 kabul edildi.']};
const base = id => ({kind: 'quote', requestId: id, name: 'Sentetik Teklif', phone: '', email: 'quote-fixture@example.test',
  subject: 'elektrik', message: '[Fabrika Teklif Sihirbazı] Ücretsiz ön değerlendirme talebi\nHizmetler: Belirtilmedi', formTimestamp: String(Date.now())});

test('Quote requests get a reference once; retries, double clicks and changed content are handled', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-quote-api-'));
  const srv = await server(data, {VG_MAIL_OUTBOX: '1'});
  try {
    // Eksik bilgi: ad yok / iletişim yok / geçersiz telefon. Hiçbiri e-posta üretmez.
    for (const [fields, code] of [[{...base('qmissing-name-0001'), name: ''}, 'invalid_name'],
      [{...base('qmissing-contact-01'), email: ''}, 'contact_required'],
      [{...base('qbad-phone-000001'), phone: '12345'}, 'invalid_phone'],
      [{...base('qbad-email-000001'), email: 'yok@'}, 'invalid_email']]) {
      const r = await post(srv.base, fields);
      assert.equal(r.status, 422, code); assert.equal(r.body.success, false); assert.equal(r.body.code, code); assert.equal(r.body.reference, undefined);
    }
    // İletişim formunda telefon hâlâ gerekli; sabit hat kabul edilir.
    assert.equal((await post(srv.base, {...base(''), kind: 'contact', phone: ''})).body.code, 'invalid_phone');
    assert.equal(outbox(data).length, 0, 'Rejected requests send nothing');

    // Başarılı gönderim: talep numarası, sabit hat telefonu, e-posta konusu numarayı içerir.
    const first = await post(srv.base, {...base('qsuccess-00000001'), phone: '0232 123 45 67'});
    assert.equal(first.status, 200); assert.equal(first.body.success, true); assert.match(first.body.reference, REF);
    assert.equal(first.body.duplicate, false); assert.equal(first.body.preview, true); assert.match(first.body.message, /önizlemede e-posta gönderilmez/);
    let mails = outbox(data); assert.equal(mails.length, 1);
    assert.ok(decodeSubject(mails[0]).includes(first.body.reference)); assert.match(mails[0], /Telefon: 0232 123 45 67/);

    // Bağlantı kopup yeniden denendi: aynı kimlik + aynı içerik → aynı numara, ikinci e-posta yok.
    const retry = await post(srv.base, {...base('qsuccess-00000001'), phone: '0232 123 45 67'});
    assert.equal(retry.status, 200); assert.equal(retry.body.reference, first.body.reference); assert.equal(retry.body.duplicate, true);
    assert.equal(outbox(data).length, 1, 'Retry does not create a duplicate');

    // Çift tıklama: aynı anda iki istek → tek kayıt, iki yanıt aynı numara.
    const both = await Promise.all([0, 1].map(() => post(srv.base, base('qdouble-click-0001'))));
    assert.deepEqual(both.map(r => r.status), [200, 200]);
    assert.equal(both[0].body.reference, both[1].body.reference);
    assert.deepEqual(both.map(r => r.body.duplicate).sort(), [false, true]);
    assert.equal(outbox(data).length, 2);

    // Aynı kimlik, değişmiş içerik: sessizce yutulmaz, 409 + önceki numara.
    const changed = await post(srv.base, {...base('qdouble-click-0001'), name: 'Başka Ad'});
    assert.equal(changed.status, 409); assert.equal(changed.body.code, 'already_received'); assert.equal(changed.body.reference, both[0].body.reference);
    assert.equal(outbox(data).length, 2);

    // Simülasyon eki: onaysız reddedilir; bozuk ek reddedilir; onaylı ek e-postada görünür.
    let r = await post(srv.base, {...base('qsim-noconsent-01'), simulation: JSON.stringify(simulation)});
    assert.equal(r.status, 422); assert.equal(r.body.code, 'simulation_consent');
    r = await post(srv.base, {...base('qsim-invalid-0001'), simulation: JSON.stringify({...simulation, kind: 'nukleer'}), simulationConsent: '1'});
    assert.equal(r.status, 422); assert.equal(r.body.code, 'invalid_simulation');
    r = await post(srv.base, {...base('qsim-invalid-0002'), simulation: JSON.stringify({...simulation, inputs: [['a\u0000', 'b']]}), simulationConsent: '1'});
    assert.equal(r.status, 422);
    assert.equal(outbox(data).length, 2, 'Invalid attachments send nothing');
    r = await post(srv.base, {...base('qsim-consent-0001'), simulation: JSON.stringify(simulation), simulationConsent: '1'});
    assert.equal(r.status, 200); assert.match(r.body.reference, REF);
    mails = outbox(data); assert.equal(mails.length, 3);
    const simMail = mails.find(mail => decodeSubject(mail).includes(r.body.reference));
    for (const text of ['Simülasyon: Trafo – 3D Trafo Merkezi Simülasyonu', 'Hesaplama sürümü: 2026.10.23', '- Toplam kurulu yük: 850 kW',
      '- Önerilen trafo: 1000 kVA', '- Güç faktörü 0,9 kabul edildi.', 'keşif ve ölçüm yapılmadan fiyat']) assert.ok(simMail.includes(text), text);

    // Tekrar kaydı kişisel veri içermez.
    const records = fs.readdirSync(path.join(data, 'requests'));
    assert.ok(records.length >= 3); for (const file of records) {
      assert.match(file, /^[a-f0-9]{64}\.json$/);
      const text = fs.readFileSync(path.join(data, 'requests', file), 'utf8');
      assert.doesNotMatch(text, /Sentetik|example\.test|0232|qsuccess/);
    }
    assert.doesNotMatch(srv.logs.join(''), /Fatal error|Warning:|Sentetik|example\.test/);
  } finally {
    await srv.stop();
    assert.ok(path.relative(os.tmpdir(), data).startsWith('voltguard-quote-api-'));
    fs.rmSync(data, {recursive: true, force: true});
  }
});

test('A request that failed on the server can be retried with the same id and is accepted exactly once', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-quote-retry-'));
  try {
    const down = await server(data, {VG_MAIL_OUTBOX: ''}, ['-d', 'disable_functions=mail']);
    let r;
    try {
      r = await post(down.base, base('qserver-down-0001'));
      assert.equal(r.status, 503); assert.equal(r.body.success, false); assert.equal(r.body.reference, undefined);
    } finally {await down.stop();}
    assert.equal(outbox(data).length, 0);
    const up = await server(data, {VG_MAIL_OUTBOX: '1'});
    try {
      r = await post(up.base, base('qserver-down-0001'));
      assert.equal(r.status, 200); assert.equal(r.body.duplicate, false); assert.match(r.body.reference, REF);
      assert.equal((await post(up.base, base('qserver-down-0001'))).body.reference, r.body.reference);
      assert.equal(outbox(data).length, 1);
    } finally {await up.stop();}
  } finally {
    assert.ok(path.relative(os.tmpdir(), data).startsWith('voltguard-quote-retry-'));
    fs.rmSync(data, {recursive: true, force: true});
  }
});
