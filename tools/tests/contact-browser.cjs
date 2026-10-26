'use strict';
// Real page scripts in a fresh browser. Every contact POST is stubbed before networking.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.qa/contact');
const report = {checks: [], browserErrors: [], unstubbedPosts: 0, otherPosts: {}};
fs.mkdirSync(output, {recursive: true});

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
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon'};
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (request.method !== 'GET') {
    // Yalnızca form uç noktası sayılır; anonim ölçüm (sendBeacon → /api/metrics.php) fetch taklidinden geçmez.
    if (url.pathname === '/contact.php') report.unstubbedPosts++; else report.otherPosts[url.pathname] = (report.otherPosts[url.pathname] || 0) + 1;
    response.writeHead(405).end(); return;
  }
  if (url.pathname === '/api/auth.php') {
    response.writeHead(200, {'Content-Type': mime['.json']});
    response.end(JSON.stringify({api: 'vg-auth/1', ok: true, user: null, csrf: 'fixture'})); return;
  }
  let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || /(?:^|[\\/])\./.test(path.relative(root, file))) {response.writeHead(404).end(); return;}
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !mime[path.extname(file)]) {response.writeHead(404).end(); return;}
  response.writeHead(200, {'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store'});
  fs.createReadStream(file).pipe(response);
});
const pages = [
  {name: 'contact', url: '/iletisim.html#iletisim', form: '#contactForm', text: '#message', trap: '#website', button: '#contactForm button[type=submit]', status: '.vg-notification'},
  {name: 'question', url: '/sor.html', form: '#qaForm', text: '#qa-message', trap: '#qa-website', button: '#qaSubmit', status: '#qaStatus'},
  {name: 'factory', url: '/fabrika-cozumleri.html', form: '#fxWizForm', text: '#wzNote', trap: '#wzWebsite', button: '[data-fx-w=submit]', status: '#fxWizErr'},
];
const text = 'Sentetik test: pano bakım planı için saha incelemesi talebi.';
async function fill(page, item) {
  await page.evaluate(({name, text}) => {
    const values = name === 'contact' ? {name: 'Tarayıcı Testi', phone: '05321234567', email: 'fixture@example.invalid', subject: 'elektrik', message: text}
      : name === 'question' ? {'qa-name': 'Tarayıcı Testi', 'qa-phone': '05321234567', 'qa-email': 'fixture@example.invalid', 'qa-subject': 'elektrik', 'qa-message': text}
      : {wzName: 'Tarayıcı Testi', wzPhone: '05321234567', wzEmail: 'fixture@example.invalid', wzCity: 'İzmir', wzNote: text};
    for (const [id, value] of Object.entries(values)) {
      const field = document.getElementById(id); field.value = value;
      field.dispatchEvent(new Event('input', {bubbles: true})); field.dispatchEvent(new Event('change', {bubbles: true}));
    }
    if (name === 'factory') {
      for (const field of ['wzSector', 'wzUrgency', 'wzServices']) {
        const input = document.querySelector(`[name="${field}"]`); input.checked = true; input.dispatchEvent(new Event('change', {bubbles: true}));
      }
      const trafo = document.getElementById('wzTrafo'); trafo.value = [...trafo.options].find(option => option.value).value;
      trafo.dispatchEvent(new Event('change', {bubbles: true}));
    }
  }, {name: item.name, text});
  if (item.name === 'factory') await page.waitForTimeout(400);
}
async function submit(page, item, times = 1) {
  await page.evaluate(({form, times}) => {for (let i = 0; i < times; i++) document.querySelector(form).dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));}, {form: item.form, times});
}
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await require(packagePath('playwright')).chromium.launch({executablePath: chromePath(), headless: true, args: ['--disable-extensions']});
  for (const noAbort of [false, true]) for (const item of pages) {
    const context = await browser.newContext({viewport: {width: 390, height: 844}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    try {
      await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
      await context.addInitScript(({noAbort}) => {
        if (noAbort) window.AbortController = undefined;
        const nativeFetch = window.fetch.bind(window), nativeTimeout = window.setTimeout.bind(window);
        const fixture = window.__contactFixture = {mode: 'hold', count: 0, pending: [], deadlines: [], ids: []};
        window.setTimeout = function (callback, delay, ...args) {
          if (delay === 25000) {fixture.deadlines.push(delay); delay = 250;}
          return nativeTimeout(callback, delay, ...args);
        };
        window.fetch = function (input, options = {}) {
          if (new URL(typeof input === 'string' ? input : input.url, location.href).pathname !== '/contact.php') return nativeFetch(input, options);
          if (options.method !== 'POST') throw Error('Contact fixture expects POST');
          fixture.count++;
          fixture.ids.push(options.body.get('requestId'));
          const response = (success, message, status, extra = {}) => new Response(JSON.stringify({success, message, ...extra}), {status, headers: {'Content-Type': 'application/json'}});
          const accepted = message => response(true, message, 200, {reference: 'VG-261024-ABC23', preview: true, duplicate: false});
          if (fixture.mode === 'hold') return new Promise(resolve => fixture.pending.push(() => resolve(accepted('LATE RESPONSE MUST NOT CLEAR INPUT'))));
          if (fixture.mode === 'bodyhold') return Promise.resolve({ok: true, status: 200, json: () => new Promise(() => {})});
          if (fixture.mode === 'failure') return Promise.resolve(response(false, 'Sentetik taşıyıcı hatası. Yazdıklarınız korundu.', 503));
          if (fixture.mode === 'invalid') return Promise.resolve(new Response('not JSON', {status: 200}));
          // PHP çalışmayan statik önizleme: 405 HTML sayfası
          if (fixture.mode === 'static') return Promise.resolve(new Response('<!doctype html><title>405</title>', {status: 405, headers: {'Content-Type': 'text/html'}}));
          // success:true ama talep numarası yok: kabul doğrulanamaz, başarı gösterilmemeli
          if (fixture.mode === 'noref') return Promise.resolve(response(true, 'NO REFERENCE MUST NOT LOOK LIKE SUCCESS', 200));
          if (fixture.mode === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
          return Promise.resolve(accepted('ÖNİZLEME: Bu testte gerçek e-posta gönderilmez.'));
        };
      }, {noAbort});
      const page = await context.newPage();
      page.on('pageerror', error => report.browserErrors.push({page: item.name, noAbort, error: error.message}));
      await page.goto(base + item.url, {waitUntil: 'domcontentloaded'});
      await fill(page, item);
      await page.locator(item.trap).evaluate(field => {field.value = 'autofill.invalid';});
      await submit(page, item);
      assert.equal(await page.evaluate(() => __contactFixture.count), 0, `${item.name}: honeypot never submits`);
      assert.match(await page.locator(item.status).textContent(), /doğrulanamadı/);
      assert.equal(await page.locator(item.text).inputValue(), text, `${item.name}: honeypot preserves input`);
      if (item.name === 'factory') assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vg_fx_wizard_v1')).ids.wzNote), text, 'Honeypot preserves saved factory draft');

      await submit(page, item, 2);
      await page.waitForFunction(() => __contactFixture.count === 1);
      assert.equal(await page.locator(item.form).getAttribute('aria-busy'), 'true');
      await page.waitForFunction(form => !document.querySelector(form).hasAttribute('aria-busy'), item.form);
      assert.equal(await page.evaluate(() => __contactFixture.count), 1, `${item.name}: duplicate blocked`);
      assert.equal(await page.locator(item.text).inputValue(), text, `${item.name}: timeout preserves input`);
      assert.equal(await page.locator(item.button).isDisabled(), false);
      assert.match(await page.locator(item.status).textContent(), /yanıt alınamadı/);
      await page.evaluate(() => __contactFixture.pending.forEach(resolve => resolve()));
      await page.waitForTimeout(50);
      assert.equal(await page.locator(item.text).inputValue(), text, `${item.name}: late success ignored`);

      for (const mode of ['bodyhold', 'failure', 'invalid', 'static', 'noref', 'offline']) {
        await page.evaluate(mode => {__contactFixture.mode = mode;}, mode);
        const before = await page.evaluate(() => __contactFixture.count);
        await submit(page, item);
        await page.waitForFunction(expected => __contactFixture.count === expected, before + 1);
        await page.waitForFunction(form => !document.querySelector(form).hasAttribute('aria-busy'), item.form);
        assert.equal(await page.locator(item.text).inputValue(), text, `${item.name}: ${mode} preserves input`);
        assert.equal(await page.locator(item.button).isDisabled(), false, `${item.name}: ${mode} UI resets`);
        if (item.name !== 'question') {
          const shown = await page.evaluate(() => document.body.innerText);
          assert.doesNotMatch(shown, /NO REFERENCE MUST NOT LOOK LIKE SUCCESS|Talebiniz alındı|Talep numaranız/, `${item.name}: ${mode} never looks like success`);
          if (mode === 'static' || mode === 'noref') assert.match(await page.locator(item.status).textContent(), /iletilmedi|doğrulayamıyoruz/);
          if (mode === 'offline') assert.match(await page.locator(item.status).textContent(), /Bağlantı kurulamadı/);
        }
      }
      if (item.name === 'factory') assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vg_fx_wizard_v1')).ids.wzNote), text, 'Failed requests preserve saved factory draft');
      await page.evaluate(() => {__contactFixture.mode = 'success';});
      const before = await page.evaluate(() => __contactFixture.count);
      await submit(page, item);
      await page.waitForFunction(expected => __contactFixture.count === expected, before + 1);
      await page.waitForFunction(form => !document.querySelector(form).hasAttribute('aria-busy'), item.form);
      const success = item.name === 'factory' ? '#fxWizDoneMsg' : item.status;
      assert.match(await page.locator(success).textContent(), /ÖNİZLEME: Bu testte gerçek e-posta gönderilmez/);
      if (item.name !== 'question') {
        // Talep numarası kalıcı gösterilir; tüm yeniden denemeler aynı kimliği taşır (sunucu tekrar kaydı açmaz)
        assert.match(await page.locator(item.name === 'factory' ? '#fxWizRefNo' : '#contactReceipt').textContent(), /VG-261024-ABC23/);
        const ids = await page.evaluate(() => __contactFixture.ids);
        assert.ok(ids.every(id => id && id === ids[0]), `${item.name}: one request id across retries`);
      }
      assert.equal(await page.locator(item.text).inputValue(), '', 'Only successful submission resets form');
      assert.equal(await page.locator(item.button).isDisabled(), false);
      // Her gönderim (ağ hatası anında dönen hariç) 25 sn yanıt sınırı kurar
      assert.ok((await page.evaluate(() => __contactFixture.deadlines)).every(delay => delay === 25000));
      report.checks.push({page: item.name, abortController: !noAbort, pass: true, cases: ['honeypot', 'duplicate', 'timeout', 'late-response', 'body-timeout', '503', 'invalid-json', 'static-405', 'no-reference', 'offline', 'backend-message', 'reference', 'same-request-id', 'retry']});
    } finally {await context.close();}
  }
  assert.equal(report.unstubbedPosts, 0, 'No contact POST reached any server');
  assert.deepEqual(report.browserErrors, []);
})().catch(error => {report.failure = error.stack; process.exitCode = 1;}).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
