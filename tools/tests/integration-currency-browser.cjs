'use strict';
// Actual employee React source with isolated synthetic accounts, offers and rates.
// Every request is confined to this loopback fixture; no live accounts or writes.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), output = path.join(root, '.qa/integration-currency-browser');
const { chromium } = require(path.join(process.env.VG_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const esbuild = require(path.join(root, 'tools/staff-app/node_modules/esbuild'));
const bundle = esbuild.buildSync({ entryPoints: [path.join(root, 'tools/staff-app/src/portal-main.jsx')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', loader: { '.css': 'empty' }, external: ['buffer'], define: { 'import.meta.env': '{"BASE_URL":"/calisan/uygulama/"}' }, logLevel: 'silent' }).outputFiles[0].text;
const user = { id: 's' + 'c'.repeat(24), name: 'Sentetik Kur Testi', email: 'currency@example.invalid', role: 'admin', approved: true, can_access_bordro: true };
const catalog = { historicalInvoice1: [], historicalInvoice2: [], cablePrices: { kategoriler: [] }, packages: { paketler: [] } };
const inserts = [], proposals = [], errors = [], checks = []; let rateCalls = 0, failRate = false, delayRate = 0, browser;
const json = (res, data, api = 'vg-company/1', status = 200) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ api, ok: status === 200, csrf: 'a'.repeat(64), ...data })); };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture.invalid'), action = url.searchParams.get('action');
    if (url.pathname === '/__qa/source.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bundle); }
    if (url.pathname === '/api/integrations.php') {
      rateCalls++; const capturedFail = failRate, provider = action, base = url.searchParams.get('base'), quoteType = provider === 'tcmb' ? url.searchParams.get('rateType') : provider === 'frankfurter' ? 'reference_mid' : 'indicative';
      const wanted = (url.searchParams.get('quotes') || '').split(','), prices = { USD: provider === 'tcmb' ? 46.5 : 50, EUR: 55 };
      const rates = Object.fromEntries(wanted.map(quote => [quote, base === 'TRY' ? 1 / prices[quote] : prices[base]]));
      const data = { provider, providerName: provider, base, date: '2026-10-30', retrievedAt: '2026-11-01T00:00:00Z', quoteType, rates, indicative: true, observations: wanted.map(quote => ({ date: '2026-10-30', base, quote, rate: rates[quote], providers: [provider === 'frankfurter' ? 'ECB' : provider] })) };
      setTimeout(() => capturedFail ? json(res, { error: { code: 'currency_unavailable', message: 'Sentetik kaynak şu anda kullanılamıyor.' } }, 'vg-integrations/1', 503) : json(res, { data }, 'vg-integrations/1'), delayRate); return;
    }
    if (url.pathname.startsWith('/api/')) {
      let raw = ''; for await (const chunk of req) raw += chunk; const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/api/staff.php') return json(res, { user, mfa: null }, 'vg-staff/1');
      if (action === 'bootstrap') return json(res, { data: { user, capabilities: { dataSource: 'local' }, storage: {}, catalog } });
      if (action === 'health' || action === 'storage') return json(res, { data: { online: true, dataSource: 'local' } });
      if (action === 'query') {
        let rows = body.table === 'proposals' ? proposals : [];
        if (body.operation === 'insert' && body.table === 'proposals') { inserts.push(body); rows = body.rows.map(row => ({ ...row, id: 'currency-offer-' + inserts.length, reference_no: 'VG-KUR-' + inserts.length, created_at: '2026-11-01T00:00:00Z' })); proposals.push(...rows); }
        return json(res, { data: body.single ? rows[0] || null : rows, count: rows.length });
      }
      return json(res, { data: [] });
    }
    if (url.pathname === '/calisan/uygulama/') {
      const html = fs.readFileSync(path.join(root, 'tools/staff-app/dist/index.html'), 'utf8').replace(/<script\b[^>]*type="module"[^>]*><\/script>/, '<script type="module" src="/__qa/source.js"></script>'); res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html);
    }
    const file = url.pathname.startsWith('/calisan/uygulama/') ? path.resolve(root, 'tools/staff-app/dist', '.' + url.pathname.slice('/calisan/uygulama'.length)) : path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
(async () => {
  fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + server.address().port;
  const executablePath = [process.env.VG_CHROME, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe')].filter(Boolean).find(fs.existsSync);
  browser = await chromium.launch({ executablePath, headless: true }); const context = await browser.newContext({ viewport: { width: 390, height: 900 }, timezoneId: 'Europe/Istanbul', serviceWorkers: 'block' }); const page = await context.newPage();
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort()); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('Sentetik kur teklifi') : dialog.dismiss());
  const open = async module => { await page.goto(base + '/calisan/uygulama/?module=' + module); await page.locator('.portal-app').waitFor(); };
  const panel = () => page.getByRole('region', { name: 'Teklif için kur kaynağı' });
  await check('GES opens without fetching rates or changing its manual draft', async () => {
    await open('ges'); assert.equal(await page.getByLabel('Dolar kuru (TL)', { exact: true }).inputValue(), '34.5'); assert.equal(rateCalls, 0); assert.match(await panel().innerText(), /elle girilmiş/);
  });
  await check('Preview is explicit and changing provider clears a pending or completed preview', async () => {
    await panel().getByRole('button', { name: 'Kuru önizle', exact: true }).click(); await panel().getByRole('button', { name: 'Kuru taslağa uygula', exact: true }).waitFor(); assert.equal(await page.getByLabel('Dolar kuru (TL)', { exact: true }).inputValue(), '34.5'); assert.match(await panel().innerText(), /46,5 TL/);
    await panel().getByLabel('Kur servisi', { exact: true }).selectOption('frankfurter'); assert.equal(await panel().getByRole('button', { name: 'Kuru taslağa uygula', exact: true }).count(), 0);
    delayRate = 200; await panel().getByRole('button', { name: 'Kuru önizle', exact: true }).click(); await panel().getByLabel('Kur servisi', { exact: true }).selectOption('tcmb'); await page.waitForTimeout(300); delayRate = 0; assert.equal(await panel().getByRole('button', { name: 'Kuru taslağa uygula', exact: true }).count(), 0); assert.equal(await page.getByLabel('Dolar kuru (TL)', { exact: true }).inputValue(), '34.5');
  });
  await check('Apply changes only the draft and saving records rate source, date and quote type', async () => {
    await panel().getByLabel('Kur servisi', { exact: true }).selectOption('frankfurter'); await panel().getByRole('button', { name: 'Kuru önizle', exact: true }).click(); await panel().getByRole('button', { name: 'Kuru taslağa uygula', exact: true }).click(); assert.equal(await page.getByLabel('Dolar kuru (TL)', { exact: true }).inputValue(), '50'); assert.equal(inserts.length, 0);
    await page.getByPlaceholder('Müşteri adı', { exact: true }).fill('Sentetik kur müşterisi'); const saved = page.waitForResponse(response => response.url().includes('action=query') && response.request().postDataJSON()?.operation === 'insert'); await page.getByRole('button', { name: 'Teklifi Kaydet', exact: true }).click(); await saved;
    assert.equal(inserts.length, 1); const snapshot = inserts[0].rows[0].data.metadata.exchangeRateSnapshot; assert.equal(snapshot.provider, 'frankfurter'); assert.equal(snapshot.date, '2026-10-30'); assert.equal(snapshot.quoteType, 'reference_mid'); assert.equal(snapshot.rates.USD, 50); assert.deepEqual(snapshot.sourceProviders, ['ECB']);
    await panel().scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'ges-rate-applied-mobile.png') });
  });
  await check('Manual edits clear source provenance and a failed provider never replaces the draft rate', async () => {
    await page.getByLabel('Dolar kuru (TL)', { exact: true }).fill('51'); assert.match(await panel().innerText(), /elle girilmiş/); failRate = true; await panel().getByRole('button', { name: 'Kuru önizle', exact: true }).click(); await panel().getByRole('alert').waitFor(); assert.equal(await page.getByLabel('Dolar kuru (TL)', { exact: true }).inputValue(), '51'); assert.equal(await panel().getByRole('button', { name: 'Kuru taslağa uygula', exact: true }).count(), 0); failRate = false;
    const saved = page.waitForResponse(response => response.url().includes('action=query') && response.request().postDataJSON()?.operation === 'insert'); await page.getByRole('button', { name: 'Teklifi Kaydet', exact: true }).click(); await saved; assert.equal(inserts[1].rows[0].data.metadata.exchangeRateSnapshot, null); assert.equal(inserts[0].rows[0].data.form.usdRate, 50);
  });
  await check('Loading the original offer restores its exact saved rate and provenance without fetching', async () => {
    const before = rateCalls; await open('saved'); await page.getByRole('button', { name: 'Yükle', exact: true }).first().click(); await page.getByLabel('Dolar kuru (TL)', { exact: true }).waitFor(); assert.equal(await page.getByLabel('Dolar kuru (TL)', { exact: true }).inputValue(), '50'); assert.match(await panel().innerText(), /Frankfurter \(ECB\) · 2026-10-30/); assert.equal(rateCalls, before); assert.equal(inserts.length, 2);
  });
  await check('YG previews both conversion inputs together and preserves manual zero for explicit validation', async () => {
    await open('manual'); await page.getByRole('button', { name: /Ayarlar/ }).click(); const ratePanel = panel(); await ratePanel.getByLabel('Kur servisi', { exact: true }).selectOption('exchange_rate');
    await ratePanel.getByRole('button', { name: 'Kuru önizle', exact: true }).click(); await ratePanel.getByRole('button', { name: 'Kuru taslağa uygula', exact: true }).waitFor(); assert.equal(await page.getByLabel('YG dolar kuru (TL)', { exact: true }).inputValue(), '40'); assert.equal(await page.getByLabel('YG euro kuru (TL)', { exact: true }).inputValue(), '49');
    await ratePanel.getByRole('button', { name: 'Kuru taslağa uygula', exact: true }).click(); assert.equal(await page.getByLabel('YG dolar kuru (TL)', { exact: true }).inputValue(), '50'); assert.equal(await page.getByLabel('YG euro kuru (TL)', { exact: true }).inputValue(), '55'); assert(await ratePanel.getByRole('link', { name: 'Rates By Exchange Rate API', exact: true }).isVisible());
    await page.getByLabel('YG dolar kuru (TL)', { exact: true }).fill('0'); assert.equal(await page.getByLabel('YG dolar kuru (TL)', { exact: true }).inputValue(), '0'); assert.match(await ratePanel.innerText(), /elle girilmiş/); assert.equal(inserts.length, 2);
  });
  assert.equal(errors.length, 0, errors.join('\n')); await context.close();
})().catch(error => { errors.push(error.stack); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks, errors, rateCalls, insertedSyntheticOffers: inserts.length }, null, 2)); console.log(JSON.stringify({ passed: checks.length, errors: errors.length, report: path.join(output, 'report.json') })); });
