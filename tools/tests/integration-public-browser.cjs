'use strict';
// Built public tool, real Chromium. All API replies are browser-route fixtures;
// static loopback hosting never executes PHP or reaches a provider account.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), output = path.join(root, '.qa/integration-public-browser');
const packages = process.env.VG_NODE_MODULES || process.env.VOLTGUARD_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(packages, 'playwright'));
const chrome = [process.env.VOLTGUARD_CHROME, process.env.VG_CHROME, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe')].filter(Boolean).find(file => fs.existsSync(file));
const report = { checks: [], errors: [], pageErrors: [], consoleErrors: [], expectedHttpErrors: [], externalRequests: [], requests: [], screenshots: [], layouts: [], contrast: [], printContrast: [] }; let browser;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture.invalid'); let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || url.pathname.startsWith('/api/') || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }; res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(file).pipe(res);
});
const source = { name: 'Sentetik test kaynağı', url: 'https://example.invalid/source' }, retrievedAt = '2026-11-01T10:00:00Z';
const labels = { pvgis: 'PVGIS', nasa_power: 'NASA POWER', tcmb: 'TCMB', frankfurter: 'Frankfurter', exchange_rate: 'ExchangeRate-API', epias: 'EPİAŞ PTF', openweather: 'OpenWeather', ipinfo: 'IPinfo Lite', nominatim: 'Nominatim / OpenStreetMap', coingecko: 'CoinGecko', github: 'GitHub', unsplash: 'Unsplash', tmdb: 'TMDB', newsapi: 'NewsAPI', jsonplaceholder: 'JSONPlaceholder', dummyjson: 'DummyJSON' };
function statusData() {
  const services = Object.fromEntries(Object.entries(labels).map(([id, label]) => [id, { label, configured: !['epias', 'openweather', 'ipinfo', 'unsplash'].includes(id), available: !['epias', 'openweather', 'ipinfo', 'unsplash', 'tmdb', 'newsapi'].includes(id), private: ['epias', 'ipinfo', 'github', 'unsplash', 'tmdb', 'newsapi', 'jsonplaceholder', 'dummyjson'].includes(id), access: id === 'epias' ? 'staff' : 'admin', notice: 'Sentetik yapılandırma durumu; başarılı veri bağlantısı değildir.' }]));
  const ai = Object.fromEntries(['gemini', 'groq', 'openrouter', 'cloudflare'].map(id => [id, { label: id, provider: id, configured: id === 'groq', notice: 'Sentetik AI durumu; anahtar değeri yok.' }])); return { services, ai };
}
async function check(width, name, run) { try { await run(); report.checks.push({ width, name, pass: true }); console.log('PASS ' + width + ' ' + name); } catch (error) { report.checks.push({ width, name, pass: false, error: error.stack }); console.error('FAIL ' + width + ' ' + name + ': ' + error.message); } }
(async () => {
  fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const baseUrl = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const width of [380, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Istanbul', colorScheme: 'light', serviceWorkers: 'block' }), page = await context.newPage(); page.setDefaultTimeout(8000); let mode = 'success', weatherGate = null; const calls = [];
    page.on('pageerror', error => report.pageErrors.push({ width, error: error.message })); page.on('console', message => { if (message.type() === 'error') { const item = { width, error: message.text(), url: message.location().url }; if (item.url.includes('/api/integrations.php') && item.error.includes('status of 503')) report.expectedHttpErrors.push(item); else report.consoleErrors.push(item); } });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()); if (url.origin !== baseUrl) { report.externalRequests.push(url.href); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname !== '/api/integrations.php') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ api: 'vg-api/1', ok: true, user: null, csrf: 'synthetic' }) });
      const action = url.searchParams.get('action'); calls.push(action); report.requests.push({ width, action, method: request.method(), query: url.search, body: request.postData() }); let data;
      if (mode === 'failure') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ api: 'vg-integrations/1', ok: false, error: 'provider_unavailable', message: 'Sentetik kaynak kullanılamıyor; mevcut sonucu koruyun.' }) });
      if (action === 'nominatim') data = url.searchParams.get('q') === 'İkinci tesis'
        ? { provider: 'Nominatim', source: { name: 'İkinci sorgunun kaynağı', url: 'https://example.invalid/second-address' }, retrievedAt: '2026-11-01T12:00:00Z', items: [{ label: 'İkinci sentetik tesis, Ankara', lat: 39.95, lon: 32.85 }] }
        : { provider: 'Nominatim', source, retrievedAt, items: [{ label: 'Sentetik tesis, Bornova, İzmir', lat: 38.47, lon: 27.21 }] };
      if (action === 'openweather') {
        data = { provider: 'OpenWeather', source, retrievedAt, observedAt: '2026-11-01T09:30:00Z', temperatureC: 22.5, description: 'Sentetik açık hava', location: 'Sentetik Bornova', humidityPercent: 55, windSpeedMps: null, stale: false };
        if (mode === 'reported-inputs') { data.inputs = { lat: 40.1, lon: 33.1 }; data.location = 'Sağlayıcı konumu'; }
        if (mode === 'delayed-weather') { data.description = 'Geciken sentetik hava'; await weatherGate; }
      }
      if (['tcmb', 'frankfurter', 'exchange_rate'].includes(action)) { const quote = url.searchParams.get('quotes'); data = { provider: action, providerName: labels[action], retrievedAt, base: url.searchParams.get('base'), date: '2026-10-30', rates: { [quote]: mode === 'malformed' ? 0 : action === 'tcmb' ? 40 : action === 'frankfurter' ? 41 : 42 }, quoteType: action === 'tcmb' ? 'forex_selling' : 'reference_mid', indicative: true, attribution: { label: action === 'exchange_rate' ? 'Rates By Exchange Rate API' : 'Kaynak: ' + labels[action], url: 'https://example.invalid/attribution' } }; }
      if (action === 'coingecko') data = { provider: 'CoinGecko', source: { name: 'CoinGecko', url: 'https://www.coingecko.com/' }, retrievedAt, items: [{ symbol: 'BTC', prices: { TRY: 1234567, USD: 50000 }, observedAt: '2026-10-31T23:00:00Z', stale: true }, { symbol: 'ETH', prices: { TRY: 50000, USD: 2000 }, observedAt: '2026-11-01T09:00:00Z', stale: false }] };
      if (action === 'status') data = statusData();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ api: 'vg-integrations/1', ok: true, data }) });
    });
    await page.goto(baseUrl + '/araclar/canli-veri-merkezi/'); await page.getByRole('heading', { name: 'Canlı Veri Merkezi', exact: true }).waitFor();
    await check(width, 'no integration calls on load or input edits; address application only fills coordinates', async () => {
      assert.equal(calls.length, 0); await page.getByLabel('Türkiye’de tesis adresi', { exact: true }).fill('Sentetik tesis Bornova'); await page.getByLabel('Enlem (°)', { exact: true }).fill('38'); await page.getByLabel('Tutar', { exact: true }).fill('2.5'); assert.equal(calls.length, 0);
      await page.getByRole('button', { name: 'Adresi ara', exact: true }).click(); const location = page.locator('#locations').getByRole('button'); await location.waitFor(); assert.deepEqual(calls, ['nominatim']); await location.click(); assert.equal(await page.getByLabel('Enlem (°)', { exact: true }).inputValue(), '38.47'); assert.equal(await page.getByLabel('Boylam (°)', { exact: true }).inputValue(), '27.21'); assert.deepEqual(calls, ['nominatim']);
    });
    await check(width, 'weather displays missing wind as unavailable and retains observation time and source', async () => {
      await page.getByRole('button', { name: 'Hava verisini getir', exact: true }).click(); await page.locator('#weatherResult .metric').waitFor(); const text = await page.locator('#weatherResult').innerText(); assert.match(text, /22,5 °C/); assert.match(text, /Rüzgâr: Veri yok m\/s/); assert(!text.includes('Rüzgâr: 0')); assert.match(text, /Gözlem: 01\.11\.2026/); assert.match(text, /Konum: Sentetik Bornova · 38,47°, 27,21°/); assert(await page.locator('#weatherResult').getByRole('link', { name: source.name, exact: true }).isVisible());
    });
    await check(width, 'selected site keeps its own lookup provenance when newer suggestions and another selected site arrive', async () => {
      await page.getByLabel('Türkiye’de tesis adresi', { exact: true }).fill('İkinci tesis');
      await page.getByRole('button', { name: 'Adresi ara', exact: true }).click();
      const suggestion = page.locator('#locations').getByRole('button', { name: /İkinci sentetik tesis/ }); await suggestion.waitFor();
      await page.evaluate(() => window.buildReport());
      const selected = page.locator('#printReport section').filter({ has: page.locator('h3').filter({ hasText: /^Tesis konumu$/ }) });
      const text = await selected.textContent(); assert(text.includes('Sentetik tesis, Bornova, İzmir')); assert(!text.includes('İkinci sentetik tesis'));
      assert.equal(await selected.locator('a').getAttribute('href'), source.url);
      assert(text.includes('Alınma: 01.11.2026 13:00:00')); assert(!text.includes('15:00:00')); assert(!text.includes('İkinci sorgunun kaynağı'));
      await suggestion.click(); assert.equal(await page.getByLabel('Enlem (°)', { exact: true }).inputValue(), '39.95');
      await page.evaluate(() => window.buildReport());
      assert((await selected.textContent()).includes('İkinci sentetik tesis, Ankara')); assert((await selected.textContent()).includes('Alınma: 01.11.2026 15:00:00'));
      const weather = page.locator('#printReport section').filter({ has: page.locator('h3').filter({ hasText: /^Hava gözlemi$/ }) });
      assert.match(await weather.textContent(), /Konum: Sentetik Bornova · 38,47°, 27,21°/, 'An older weather observation must identify its own location after another site is selected.');
    });
    await check(width, 'weather pins response coordinates or captured request coordinates across in-flight field edits', async () => {
      mode = 'reported-inputs'; await page.getByRole('button', { name: 'Hava verisini getir', exact: true }).click();
      await page.locator('#weatherResult').getByText('Konum: Sağlayıcı konumu · 40,1°, 33,1°', { exact: true }).waitFor();
      mode = 'delayed-weather'; await page.getByLabel('Enlem (°)', { exact: true }).fill('38.47'); await page.getByLabel('Boylam (°)', { exact: true }).fill('27.21');
      let releaseWeather; weatherGate = new Promise(resolve => { releaseWeather = resolve; });
      try {
        await Promise.all([page.waitForRequest(request => new URL(request.url()).searchParams.get('action') === 'openweather'), page.getByRole('button', { name: 'Hava verisini getir', exact: true }).click()]);
        await page.getByLabel('Enlem (°)', { exact: true }).fill('41'); await page.getByLabel('Boylam (°)', { exact: true }).fill('29');
        assert(await page.getByRole('button', { name: 'Hava verisini getir', exact: true }).isDisabled(), 'The reply is deliberately held until field edits finish.');
      } finally { releaseWeather(); weatherGate = null; }
      await page.locator('#weatherResult').getByText('Geciken sentetik hava', { exact: true }).waitFor();
      assert.match(await page.locator('#weatherResult').textContent(), /Konum: Sentetik Bornova · 38,47°, 27,21°/);
      assert(!(await page.locator('#weatherResult').textContent()).includes('41°, 29°'));
      mode = 'success'; await page.getByLabel('Türkiye’de tesis adresi', { exact: true }).fill('Sentetik tesis Bornova'); await page.getByRole('button', { name: 'Adresi ara', exact: true }).click();
      const original = page.locator('#locations').getByRole('button', { name: /Sentetik tesis, Bornova, İzmir/ }); await original.waitFor(); await original.click();
    });
    await check(width, 'all three currency sources convert the explicit amount with publication date and attribution', async () => {
      for (const [provider, total] of [['tcmb', 100], ['frankfurter', 102.5], ['exchange_rate', 105]]) {
        await page.locator('#rateSource').selectOption(provider); const before = calls.length; await page.getByRole('button', { name: 'Kuru getir ve dönüştür', exact: true }).click(); await page.waitForFunction(text => document.querySelector('#currencyResult .metric')?.textContent === text, total.toLocaleString('tr-TR') + ' TRY'); assert.equal(calls.length, before + 1);
        const text = await page.locator('#currencyResult').innerText(); assert.match(text, /Kur tarihi: 2026-10-30/); assert(text.includes(labels[provider])); assert(await page.locator('#currencyResult a').isVisible());
      }
    });
    await check(width, 'upstream HTTP failure preserves the last confirmed currency conversion and marks the error', async () => {
      const before = await page.locator('#currencyResult .metric').innerText(); mode = 'failure'; await page.getByRole('button', { name: 'Kuru getir ve dönüştür', exact: true }).click(); await page.locator('#currencyResult [role=alert]').waitFor(); assert.equal(await page.locator('#currencyResult .metric').innerText(), before); mode = 'success';
    });
    await check(width, 'malformed successful payload preserves the last confirmed conversion', async () => {
      const before = await page.locator('#currencyResult .metric').innerText(); mode = 'malformed'; await page.getByRole('button', { name: 'Kuru getir ve dönüştür', exact: true }).click(); await page.locator('#currencyResult [role=alert]').filter({ hasText: 'Seçilen para birimi için kur bulunamadı.' }).waitFor(); assert.equal(await page.locator('#currencyResult .metric').count(), 1, 'Rejected rate must not clear the confirmed result.'); assert.equal(await page.locator('#currencyResult .metric').innerText(), before); mode = 'success';
    });
    mode = 'success';
    await check(width, 'crypto shows per-asset freshness and twenty status cards distinguish keys, permissions and query availability', async () => {
      await page.getByRole('button', { name: 'Fiyatları getir', exact: true }).click(); await page.locator('#cryptoResult .reading').first().waitFor(); const crypto = await page.locator('#cryptoResult').innerText(); assert.match(crypto, /BTC/); assert.match(crypto, /ETH/); assert.match(crypto, /Güncelleme: 01\.11\.2026/); assert.match(crypto, /Eski veri/); assert(await page.locator('#cryptoResult').getByRole('link', { name: 'CoinGecko', exact: true }).isVisible());
      await page.getByRole('button', { name: 'Yapılandırma durumunu göster', exact: true }).click(); await page.locator('#statusResult .status-item').first().waitFor(); assert.equal(await page.locator('#statusResult .status-item').count(), 20);
      const card = label => page.locator('#statusResult .status-item').filter({ has: page.getByText(label, { exact: true }) }); assert.match(await card('OpenWeather').innerText(), /Sunucu anahtarı gerekli/); assert.match(await card('TMDB').innerText(), /Kullanım izni gerekli/); assert.match(await card('TCMB').innerText(), /Sorgulanabilir/); assert.match(await card('EPİAŞ PTF').innerText(), /Çalışan girişi/); assert.match(await card('GitHub').innerText(), /Yönetici deneme alanı/);
    });
    await check(width, 'built page has no horizontal overflow and requests contain no external keys or bodies', async () => {
      const layout = await page.evaluate(() => ({ viewport: innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, workspace: document.getElementById('vg-tool-workspace').getBoundingClientRect().width, overflow: [...document.querySelectorAll('#vg-tool-workspace input,#vg-tool-workspace select,#vg-tool-workspace button')].filter(node => { const b = node.getBoundingClientRect(); return b.left < -1 || b.right > innerWidth + 1; }).map(node => node.id || node.textContent) })); report.layouts.push({ width, ...layout }); assert(layout.doc <= width + 1, JSON.stringify(layout)); assert(layout.body <= width + 1, JSON.stringify(layout)); assert.deepEqual(layout.overflow, []);
      const requests = report.requests.filter(request => request.width === width); assert(requests.every(request => request.method === 'GET' && request.body === null)); assert(requests.every(request => !/api[_-]?key|token|password|secret/i.test(request.query)));
      await page.locator('#currencyForm').scrollIntoViewIfNeeded(); const file = path.join(output, 'public-tool-' + width + '.png'); await page.screenshot({ path: file }); report.screenshots.push(file);
    });
    await check(width, 'print report keeps confirmed amounts, source and dates while excluding failed-response messages', async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('beforeprint'))); const print = page.locator('#printReport'), text = await print.textContent();
      for (const expected of ['VoltGuard · Veri raporu', '105 TRY', '2,5 USD × 42 TRY/USD', 'Kur tarihi: 2026-10-30', 'ExchangeRate-API', 'Rates By Exchange Rate API', 'Gözlem: 01.11.2026', 'CoinGecko', 'Güncelleme:']) assert(text.includes(expected), expected);
      assert.equal(await print.locator('.error,[role=alert],button').count(), 0); assert(!text.includes('Sentetik kaynak kullanılamıyor')); assert(!text.includes('Seçilen para birimi için kur bulunamadı.'));
      await page.emulateMedia({ media: 'print' }); try {
        assert(await print.isVisible()); assert.equal(await page.locator('#vg-tool-workspace main').isVisible(), false); const file = path.join(output, 'public-report-' + width + '.png'); await print.screenshot({ path: file }); report.screenshots.push(file);
        const samples = await print.locator('p,dt,dd,.metric').evaluateAll(nodes => nodes.map(node => { const style = getComputedStyle(node), rgb = style.color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4), light = rgb.reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0), size = parseFloat(style.fontSize), large = size >= 24 || size >= 18.66 && Number(style.fontWeight) >= 700; return { text: node.textContent, color: style.color, ratio: 1.05 / (light + .05), minimum: large ? 3 : 4.5 }; })); report.printContrast.push({ width, samples });
        const failures = samples.filter(sample => sample.ratio + .01 < sample.minimum); assert.equal(failures.length, 0, 'Printed source and date must be readable: ' + JSON.stringify(failures.slice(0, 3)));
      } finally { await page.emulateMedia({ media: null }); }
      assert(text.includes('Sentetik tesis, Bornova, İzmir'), 'Report must preserve the selected site label.'); assert.match(text, /38[,.]47/, 'Selected latitude is printable.'); assert.match(text, /27[,.]21/, 'Selected longitude is printable.');
    });
    await check(width, 'result text meets readable contrast in light and dark themes', async () => {
      const read = () => page.evaluate(() => {
        const rgba = css => { const values = css.match(/[\d.]+/g)?.map(Number) || []; return [values[0] || 0, values[1] || 0, values[2] || 0, values[3] ?? 1]; };
        const blend = (front, back) => front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3]));
        const luminance = rgb => rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        return [...document.querySelectorAll('#weatherResult .metric,#weatherResult p,#currencyResult .metric,#currencyResult p:not([role=alert]),#cryptoResult .reading p')].map(node => {
          let background = [255, 255, 255]; const chain = []; for (let p = node; p; p = p.parentElement) chain.unshift(p); for (const parent of chain) background = blend(rgba(getComputedStyle(parent).backgroundColor), background);
          const style = getComputedStyle(node), foreground = blend(rgba(style.color), background), l1 = luminance(foreground), l2 = luminance(background), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), size = parseFloat(style.fontSize), large = size >= 24 || size >= 18.66 && Number(style.fontWeight) >= 700;
          return { text: node.textContent, color: style.color, background, ratio, minimum: large ? 3 : 4.5 };
        });
      });
      const light = await read(); report.contrast.push({ width, theme: 'light', samples: light });
      const menu = page.getByRole('button', { name: 'Menüyü aç', exact: true }); if (await menu.isVisible()) await menu.click(); await page.locator('[data-vg-theme-toggle]:visible').first().click(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark'); const close = page.getByRole('button', { name: 'Menüyü kapat', exact: true }); if (await close.isVisible()) await close.click(); const dark = await read(); report.contrast.push({ width, theme: 'dark', samples: dark });
      const file = path.join(output, 'public-tool-' + width + '-dark.png'); await page.screenshot({ path: file }); report.screenshots.push(file);
      const failures = [...light, ...dark].filter(sample => sample.ratio + 0.01 < sample.minimum); assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 4)));
    });
    await context.close();
  }
})().catch(error => { report.errors.push(error.stack); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); const failed = report.checks.filter(check => !check.pass).length; console.log(JSON.stringify({ passed: report.checks.length - failed, total: report.checks.length, errors: report.errors.length + report.pageErrors.length + report.consoleErrors.length, externalRequests: report.externalRequests.length, report: path.join(output, 'report.json') })); if (failed || report.errors.length || report.pageErrors.length || report.consoleErrors.length || report.externalRequests.length) process.exitCode = 1;
});
