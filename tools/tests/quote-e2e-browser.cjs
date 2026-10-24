'use strict';
// Uçtan uca teklif akışı: VoltSim trafo sonucu → onay penceresi → teklif sihirbazı → gerçek contact.php kabulü.
// PHP yerleşik sunucusu geçici veri klasörüyle çalışır (VG_MAIL_OUTBOX=1: e-posta gönderilmez, outbox/'a yazılır).
// Senaryolar: aktarımdan önce sunucuya hiçbir şey gitmemesi, bağlantı kopması, sunucu hatası, kabul edilip yanıtı
// kaybolan talebin yeniden denenmesi (tek kayıt), çift tıklama, eksik bilgi ve simülasyon eklemeden gönderim.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.qa/quote-e2e');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const REF = /VG-\d{6}-[A-HJ-NP-Z2-9]{5}/;
fs.mkdirSync(output, {recursive: true});
const report = {steps: [], browserErrors: []};
const step = (name, extra = {}) => { report.steps.push({name, ...extra}); console.log('✓', name); };

function packagePath(name) {
  try {return require.resolve(name);} catch (_) {}
  for (const dir of [process.env.VG_NODE_MODULES, process.env.VOLTGUARD_NODE_MODULES,
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean)) {
    if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  throw new Error(`Set VG_NODE_MODULES to the bundled packages directory (${name} required).`);
}
function chromePath() {
  return [process.env.VOLTGUARD_CHROME, process.env.VG_CHROME,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe')]
    .filter(Boolean).find(file => fs.existsSync(file));
}
const mails = data => {const dir = path.join(data, 'outbox'); return fs.existsSync(dir) ? fs.readdirSync(dir).sort().map(file => fs.readFileSync(path.join(dir, file), 'utf8')) : [];};
const subject = eml => Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(eml)[1], 'base64').toString('utf8');

let browser, child;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-quote-e2e-'));
(async () => {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(php, ['-n', '-S', `127.0.0.1:${port}`, '-t', root], {
    env: {...process.env, VG_DATA_DIR: data, VG_STORE: 'json', VG_MAIL_OUTBOX: '1', TURNSTILE_SECRET_KEY: '', VG_CONTACT_ALLOWED_ORIGINS: base},
    stdio: 'ignore', windowsHide: true,
  });
  for (let i = 0; i < 100; i++) {try {await fetch(`${base}/contact.php`); break;} catch {if (i === 99) throw Error('PHP did not start'); await new Promise(resolve => setTimeout(resolve, 50));}}

  browser = await require(packagePath('playwright')).chromium.launch({executablePath: chromePath(), headless: true, args: ['--disable-extensions']});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  // Ölçüm uç noktası bu testin konusu değil
  await context.route('**/api/metrics.php*', route => route.fulfill({status: 204, body: ''}));
  const contactPosts = [];
  context.on('request', request => { if (new URL(request.url()).pathname === '/contact.php' && request.method() === 'POST') contactPosts.push(request.postData() || ''); });
  const page = await context.newPage();
  page.on('pageerror', error => report.browserErrors.push(error.message));

  /* 1. VoltSim trafo: sonuç oluşur, bağlama özel eylem görünür; aktarım onaysız sunucuya hiçbir şey yollamaz */
  await page.goto(`${base}/voltsim/trafo/`, {waitUntil: 'domcontentloaded'});
  const action = page.locator('[data-vs-analysis] [data-vs-act="quote"]');
  assert.equal((await action.textContent()).trim(), 'Bu güç ihtiyacını tesisim için değerlendirin');
  await page.waitForFunction(() => document.querySelectorAll('[data-vs-ro] .vs-ro').length > 0, null, {timeout: 30000});
  await page.locator('[data-vs-pane="analysis"]').click().catch(() => {});
  await action.scrollIntoViewIfNeeded();
  await action.click();
  const dialog = page.locator('#vsQuoteDlg');
  await dialog.waitFor({state: 'visible'});
  const shown = await dialog.locator('[data-q-body]').textContent();
  for (const text of ['Simülasyon: Trafo', 'Hesaplama sürümü:', 'Seçilen girdiler:', 'Sonuç özeti:', 'Varsayımlar:']) assert.ok(shown.includes(text), text);
  assert.match(await dialog.textContent(), /formu siz göndermedikçe hiçbir değer VoltGuard’a iletilmez/);
  assert.match(await dialog.textContent(), /keşif ve ölçümden sonra/);
  await page.screenshot({path: path.join(output, '1-voltsim-onay.png')});
  assert.equal(contactPosts.length, 0, 'Opening the dialog sends nothing');
  step('VoltSim trafo: contextual action and full preview before transfer', {lines: shown.split('\n').length});

  await Promise.all([page.waitForURL(/fabrika-cozumleri\.html\?kaynak=voltsim#teklif$/), dialog.locator('[data-q="add"]').click()]);
  await page.waitForSelector('#fxWizSim:not([hidden])');
  assert.equal(await page.locator('#fxWizSimBody').textContent(), shown, 'Wizard shows exactly what was approved');
  assert.equal(await page.locator('#wzSimConsent').isChecked(), true);
  assert.equal(await page.locator('input[name="wzServices"][value="trafo-guc"]').isChecked(), true);
  assert.equal(contactPosts.length, 0, 'Transfer to the draft sends nothing');
  step('Wizard: simulation summary visible, consent explicit, nothing sent yet');

  /* 2. Eksik bilgi: tesis/güç/hizmet alanları boş geçilebilir; ad ve iletişim olmadan gönderilmez */
  for (let i = 0; i < 4; i++) await page.locator('[data-fx-w="next"]').click();
  await page.locator('[data-fx-w="submit"]').click();
  assert.equal(await page.locator('[data-req="name"]').getAttribute('class').then(c => /is-invalid/.test(c)), true);
  assert.match(await page.locator('#wzPhoneE').textContent(), /telefon veya e-posta/);
  assert.equal(contactPosts.length, 0, 'Missing information is not submitted');
  step('Missing information: only name + phone/e-mail required, nothing sent');

  await page.fill('#wzName', 'Uçtan Uca Test');
  await page.fill('#wzPhone', '0232 555 12 34');
  const preview = await page.locator('#wzPreview').textContent();
  assert.ok(preview.includes('— Ek: simülasyon özeti —') && preview.includes('Hesaplama sürümü:'));

  /* 3. Bağlantı kopması: talep iletilmedi, girdiler korunur */
  await page.route('**/contact.php', route => route.abort('internetdisconnected'), {times: 1});
  await page.locator('[data-fx-w="submit"]').click();
  await page.waitForFunction(() => !document.getElementById('fxWizForm').hasAttribute('aria-busy') && !document.getElementById('fxWizErr').hidden);
  assert.match(await page.locator('#fxWizErr').textContent(), /Bağlantı kurulamadı; talebiniz iletilmedi/);
  assert.equal(await page.inputValue('#wzName'), 'Uçtan Uca Test');
  assert.equal(mails(data).length, 0);
  step('Connection drop: error shown, input kept, nothing stored');

  /* 4. Sunucu hatası */
  await page.route('**/contact.php', route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({success: false, code: 'mail_unavailable', message: 'Sentetik sunucu hatası: talebiniz iletilemedi.'})}), {times: 1});
  await page.locator('[data-fx-w="submit"]').click();
  await page.waitForFunction(() => /Sentetik sunucu hatası/.test(document.getElementById('fxWizErr').textContent));
  assert.equal(await page.locator('#fxWizDone').isHidden(), true);
  assert.equal(await page.inputValue('#wzPhone'), '0232 555 12 34');
  step('Server error: no success screen, input kept');

  /* 5. Sunucu kabul etti ama yanıt yolda kayboldu; ardından çift tıklamayla yeniden deneme → tek kayıt, aynı numara */
  await page.route('**/contact.php', async route => { await route.fetch(); await route.abort('connectionreset'); }, {times: 1});
  await page.locator('[data-fx-w="submit"]').click();
  await page.waitForFunction(() => !document.getElementById('fxWizForm').hasAttribute('aria-busy') && /iletilmedi|yanıt/.test(document.getElementById('fxWizErr').textContent));
  assert.equal(mails(data).length, 1, 'The lost-response request was accepted once');
  const firstRef = REF.exec(subject(mails(data)[0]))[0];
  assert.equal(await page.inputValue('#wzName'), 'Uçtan Uca Test', 'Client still keeps input (it cannot know)');
  const postsBefore = contactPosts.length;
  await page.locator('[data-fx-w="submit"]').dblclick();
  await page.waitForSelector('#fxWizDone:not([hidden])');
  assert.equal(contactPosts.length - postsBefore, 1, 'Double click sends one request');
  const shownRef = await page.locator('#fxWizRefNo').textContent();
  assert.equal(shownRef, firstRef, 'Retry returns the original request number');
  assert.equal(mails(data).length, 1, 'Retry and double click create no duplicate');
  const ids = contactPosts.map(body => /name="requestId"\r\n\r\n([^\r]+)/.exec(body)?.[1]).filter(Boolean);
  assert.ok(ids.length >= 3 && ids.every(id => id === ids[0]), 'All attempts share one request id');
  assert.match(await page.locator('#fxWizDoneMsg').textContent(), /önizlemede e-posta gönderilmez/);
  assert.equal(await page.locator('#fxWizDoneTitle').textContent(), 'Önizleme sunucusu talebi kabul etti');
  const telLink = page.locator('#fxWizDone [data-vg-contact="tel"]');
  assert.equal(await telLink.getAttribute('href'), await page.locator('#vgFooter a[href^="tel:"]').first().getAttribute('href'), 'Phone comes from the shared footer');
  await page.screenshot({path: path.join(output, '2-sihirbaz-kabul.png')});
  const eml = mails(data)[0];
  for (const text of ['Teklif talebi', 'Telefon: 0232 555 12 34', 'Simülasyon özeti (ziyaretçi göndermeden önce gördü ve ekledi)', 'Simülasyon: Trafo', 'Hesaplama sürümü:', 'Varsayımlar:'])
    assert.ok(eml.includes(text), text);
  assert.equal(await page.evaluate(() => localStorage.getItem('vg_quote_handoff_v1')), null, 'Handoff cleared after acceptance');
  step('Accepted by real backend: one record, request number shown, simulation included', {reference: shownRef});

  /* 6. Kompanzasyon: bilgi eklemeden geçiş → simülasyon değeri gönderilmez */
  await page.goto(`${base}/voltsim/kompanzasyon/`, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => document.querySelectorAll('[data-vs-ro] .vs-ro').length > 0, null, {timeout: 30000});
  const kompAction = page.locator('[data-vs-quote-open]');
  assert.equal((await kompAction.textContent()).trim(), 'Ölçüm ve çözüm değerlendirmesi isteyin');
  await kompAction.click();
  await page.locator('#vsQuoteDlg').waitFor({state: 'visible'});
  await Promise.all([page.waitForURL(/fabrika-cozumleri/), page.locator('#vsQuoteDlg [data-q="skip"]').click()]);
  await page.waitForSelector('#fxWiz');
  assert.equal(await page.locator('#fxWizSim').isHidden(), true);
  if (await page.locator('#fxWizDone').isVisible()) await page.locator('#fxWizNew').click();
  for (let i = 0; i < 4; i++) await page.locator('[data-fx-w="next"]').click();
  await page.fill('#wzName', 'Bilgisiz Talep');
  await page.fill('#wzEmail', 'e2e-fixture@example.test');
  await page.locator('[data-fx-w="submit"]').click();
  // Başarılı gönderimden sonra 60 sn bekleme (js/factory.js SUBMIT_COOLDOWN) uygulanır
  await page.waitForFunction(() => /saniye bekleyin/.test(document.getElementById('fxWizErr').textContent));
  assert.equal(contactPosts.filter(body => body.includes('Bilgisiz Talep')).length, 0);
  await page.evaluate(() => localStorage.removeItem('vg_last_submit_at'));
  await page.locator('[data-fx-w="submit"]').click();
  await page.waitForSelector('#fxWizDone:not([hidden])');
  assert.match(await page.locator('#fxWizRefNo').textContent(), REF);
  const second = mails(data).find(mail => mail.includes('Bilgisiz Talep'));
  assert.ok(second && !second.includes('Simülasyon özeti') && second.includes('Telefon: -'), 'E-mail only, no simulation data');
  step('Skip path: e-mail only request accepted without any simulation values');

  assert.deepEqual(report.browserErrors, []);
})().catch(error => {report.failure = error.stack; process.exitCode = 1;}).finally(async () => {
  if (browser) await browser.close();
  if (child) { child.kill(); await new Promise(resolve => {if (child.exitCode !== null) resolve(); else {child.once('exit', resolve); setTimeout(resolve, 3000);}}); }
  if (path.relative(os.tmpdir(), data).startsWith('voltguard-quote-e2e-')) fs.rmSync(data, {recursive: true, force: true});
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (report.failure) console.error(report.failure);
});
