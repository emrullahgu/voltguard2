'use strict';
// Standalone synthetic catalog/quote fixture; never sends requests to the live site.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os'), assert = require('node:assert/strict'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), dist = path.join(root, 'tools/staff-app/dist'), output = path.join(root, '.qa/company-dashboard-ges');
const packages = process.env.VG_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(packages, 'playwright'));
const JSZip = require(path.join(packages, 'jszip'));
// The advanced PDF handler is currently a dormant fallback. Exercise its exact
// source with real PDF/font libraries in this fixture, without exposing a test hook in the app.
const appSource = fs.readFileSync(path.join(root, 'tools/staff-app/src/App.jsx'), 'utf8');
const fallbackStart = appSource.indexOf('  const handleAdvancedPDFExport = async () => {');
assert(fallbackStart >= 0);
const fallbackSource = appSource.slice(fallbackStart, appSource.indexOf('\n  // --- UI Components ---', fallbackStart));
const fallbackBundle = require(path.join(root, 'tools/staff-app/node_modules/esbuild')).buildSync({
  stdin: { contents: `import { createReportPDF } from './pdfReport.js'; import { COMPANY_NAME, COMPANY_EMAIL_WEBSITE_LINE, COMPANY_PHONE, COMPANY_ADDRESS_LINE_1, COMPANY_ADDRESS_LINE_2 } from './companyInfo.js'; export async function downloadFallback({ selectedCompany, params }) { const formatCurrency = value => Number(value).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' }); ${fallbackSource} await handleAdvancedPDFExport(); }`, resolveDir: path.join(root, 'tools/staff-app/src'), sourcefile: 'qa-pdf-fallback.js' },
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', define: { 'import.meta.env': '{"BASE_URL":"/calisan/uygulama/"}' }, logLevel: 'silent'
}).outputFiles[0].text;
const user = { id: 's' + 'a'.repeat(24), name: 'Sentetik Yönetici', email: 'qa@example.invalid', role: 'admin', approved: true, can_access_bordro: true };
const empty = { historicalInvoice1: [], historicalInvoice2: [], cablePrices: { kategoriler: [] }, packages: { paketler: [] } };
const first = [{ 'ÜRÜN': 'Sentetik kablo', MARKA: 'Sentetik Marka', 'BİRİM FİYAT': '1.234,56' }, { 'ÜRÜN': 'Fiyatı olmayan ürün' }];
const second = [{ 'Ürün/hizmet': 'Sentetik hizmet', Marka: 'Sentetik Hizmet', 'Birim fiyatı': '25,50' }];
const cable = { kategoriler: [{ id: 'qa-kablo', ad: 'Sentetik kablo kategorisi', urunler: [] }] };
const catalogs = { empty, one: { ...empty, historicalInvoice1: first, cablePrices: cable }, full: { ...empty, historicalInvoice1: first, historicalInvoice2: second, cablePrices: { ...cable, firma: 'Sentetik Tedarikçi', kdvDahil: false, kdvOrani: 20 } }, unpriced: { ...empty, historicalInvoice1: [{ 'ÜRÜN': 'Fiyatsız ürün' }] } };
let proposals = [], inserts = [], browser;
const report = { checks: [], errors: [], screenshots: [] };
function json(res, data, api = 'vg-company/1') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ api, ok: true, csrf: 'a'.repeat(64), ...data })); }
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture.invalid');
    if (url.pathname === '/__qa/pdf-fallback.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fallbackBundle); }
    if (url.pathname.startsWith('/api/')) {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {}, action = url.searchParams.get('action');
      if (url.pathname === '/api/staff.php') return json(res, { user, mfa: null }, 'vg-staff/1');
      if (action === 'bootstrap') { const variant = (req.headers.cookie || '').match(/fixture_catalog=(\w+)/)?.[1] || 'empty'; return json(res, { data: { user, capabilities: { dataSource: 'local' }, storage: {}, catalog: catalogs[variant] || empty } }); }
      if (action === 'health' || action === 'storage') return json(res, { data: { online: true, dataSource: 'local' } });
      if (action === 'query') {
        let rows = body.table === 'proposals' ? proposals : [];
        if (body.operation === 'insert' && body.table === 'proposals') { inserts.push(body); rows = body.rows.map((row, index) => ({ ...row, id: 'qa-proposal-' + inserts.length + '-' + index, reference_no: 'VG-QA-' + inserts.length, created_at: '2026-10-26T00:00:00Z' })); proposals.push(...rows); }
        return json(res, { data: body.single ? rows[0] || null : rows, count: rows.length });
      }
      return json(res, { data: [] });
    }
    if (url.pathname === '/calisan/uygulama/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replace('</head>', '<link rel="stylesheet" href="/css/fonts.css"></head>')); }
    const file = url.pathname.startsWith('/calisan/uygulama/') ? path.resolve(dist, '.' + url.pathname.slice('/calisan/uygulama'.length)) : path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
async function check(name, action) { try { await action(); report.checks.push({ name, pass: true }); } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error(name + ': ' + error.message); } }
(async () => {
  fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + server.address().port;
  const executablePath = [process.env.VG_CHROME, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe')].filter(Boolean).find(fs.existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  async function pageFor(variant, width = 1440) { const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Istanbul', serviceWorkers: 'block' }); await context.addCookies([{ name: 'fixture_catalog', value: variant, url: base }]); const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message)); page.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('Sentetik GES teklifi') : dialog.dismiss()); return { context, page }; }
  async function open(page, module) { await page.goto(base + '/calisan/uygulama/?module=' + module); await page.locator('.portal-app').waitFor(); await page.waitForTimeout(100); }
  for (const width of [1440, 390]) await check('empty catalog gives truthful status and working quote action at ' + width, async () => {
    const { context, page } = await pageFor('empty', width); try {
      await open(page, 'dashboard'); const dashboard = page.locator('[data-company-dashboard]');
      await dashboard.getByRole('heading', { name: 'Henüz geçmiş fatura verisi yüklenmedi' }).waitFor();
      assert(await dashboard.getByText('0 Fatura', { exact: true }).isVisible()); assert.equal((await dashboard.innerText()).includes('undefined'), false);
      assert(await dashboard.getByText('Geçmiş fatura ort. birim fiyatı', { exact: true }).locator('..').getByText('—', { exact: true }).isVisible());
      assert(await dashboard.getByText(/Henüz kablo fiyat listesi yüklenmedi/).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No horizontal page overflow');
      const screenshot = path.join(output, 'dashboard-empty-' + width + '.png'); await page.screenshot({ path: screenshot, fullPage: true }); report.screenshots.push(screenshot);
      await dashboard.getByRole('button', { name: 'YG teklifi hazırla', exact: true }).click(); assert.equal(await page.locator('.portal-app').getAttribute('data-portal-module'), 'manual');
    } finally { await context.close(); }
  });
  for (const variant of ['one', 'full', 'unpriced']) await check('catalog ' + variant + ' renders actual normalized prices and metadata', async () => {
    const { context, page } = await pageFor(variant); try {
      await open(page, 'dashboard'); const dashboard = page.locator('[data-company-dashboard]');
      assert(await dashboard.getByText((variant === 'full' ? 2 : 1) + ' Fatura', { exact: true }).isVisible());
      assert.equal((await dashboard.innerText()).includes('undefined'), false);
      const ranked = dashboard.getByRole('heading', { name: 'En Pahalı 10 Ürün', exact: true }).locator('..');
      if (variant === 'unpriced') { assert(await ranked.getByText('Karşılaştırılabilecek geçerli birim fiyatı yok.', { exact: true }).isVisible()); assert(await dashboard.getByText('Geçmiş fatura ort. birim fiyatı', { exact: true }).locator('..').getByText('—', { exact: true }).isVisible()); }
      else { assert(await ranked.getByText('Sentetik kablo', { exact: true }).isVisible()); assert.match(await ranked.innerText(), /1\.234,56/); assert.equal((await ranked.innerText()).includes('Fiyatı olmayan ürün'), false); const cableCard = dashboard.getByRole('heading', { name: 'Kablo Fiyat Listesi Özeti', exact: true }).locator('..'); assert(await cableCard.getByText(variant === 'full' ? 'Hariç (%20)' : 'Belirtilmedi', { exact: true }).first().isVisible()); }
    } finally { await context.close(); }
  });
  await check('GES validates rate and row quantities, saves Turkish decimals and restores the exact snapshot', async () => {
    const { context, page } = await pageFor('empty'); try {
      await page.clock.install({ time: new Date('2026-10-25T21:15:00Z') }); await open(page, 'ges');
      assert.equal(await page.getByLabel('Teklif tarihi', { exact: true }).inputValue(), '2026-10-26');
      await page.getByPlaceholder('Müşteri adı', { exact: true }).fill('Sentetik GES müşteri');
      const rate = page.getByLabel('Dolar kuru (TL)', { exact: true }), save = page.getByRole('button', { name: 'Teklifi Kaydet', exact: true }), pdf = page.getByRole('button', { name: 'PDF İndir', exact: true });
      await rate.fill('0'); assert(await save.isDisabled()); assert(await pdf.isDisabled()); assert.equal(await page.locator('#ges-validation').innerText(), 'Dolar kuru sıfırdan büyük bir sayı olmalı.'); assert.equal(await page.locator('.ges-pdf-page').count(), 0); assert.equal(inserts.length, 0);
      await rate.fill('38,50'); const qty = page.getByLabel('1. satır miktarı', { exact: true }); await qty.fill('-2'); assert(await save.isDisabled()); assert.match(await page.locator('#ges-validation').innerText(), /1\. satır miktarı/);
      await qty.fill('2,5'); const price = page.getByLabel('1. satır birim fiyatı', { exact: true }); await price.fill(''); assert(await save.isDisabled()); await price.fill('0'); assert(await save.isEnabled()); await price.fill('1.234,56'); assert(await save.isEnabled()); assert.equal(await page.locator('.ges-pdf-page').count(), 2);
      const persisted = page.waitForResponse(response => response.url().includes('action=query') && response.request().method() === 'POST' && response.request().postDataJSON()?.operation === 'insert'); await save.click(); await persisted; await page.waitForFunction(() => document.querySelector('#ges-printable-area [data-vg-reference]')?.textContent === 'VG-QA-1');
      assert.equal(inserts.length, 1); const snapshot = inserts[0].rows[0].data; assert.equal(snapshot.form.usdRate, 38.5); assert.equal(snapshot.items[0].qty, 2.5); assert.equal(snapshot.items[0].price, 1234.56); assert(Number.isFinite(snapshot.totals.tlTotal));
      await open(page, 'saved'); await page.getByRole('button', { name: 'Yükle', exact: true }).first().click(); await page.getByLabel('Dolar kuru (TL)', { exact: true }).waitFor(); assert.equal(await page.getByLabel('Dolar kuru (TL)', { exact: true }).inputValue(), '38.5'); assert.equal(await page.getByLabel('1. satır miktarı', { exact: true }).inputValue(), '2.5'); assert.equal(await page.getByLabel('1. satır birim fiyatı', { exact: true }).inputValue(), '1234.56'); assert.equal(inserts.length, 1);
    } finally { await context.close(); }
  });
  await check('actual YG Word and dormant PDF downloads contain the reference as plain text', async () => {
    const { context, page } = await pageFor('empty'); try {
      await open(page, 'manual');
      await page.getByPlaceholder('Örn: ABC Endüstri San. ve Tic. A.Ş.', { exact: true }).fill('Sentetik YG Tesisi');
      await page.getByPlaceholder('Örn: Ahmet Yilmaz', { exact: true }).fill('Sentetik Yetkili');
      await page.getByPlaceholder('Örn: Tekstil, Güçda', { exact: true }).fill('Sentetik sektör');
      await page.getByPlaceholder('Örn: 1600 veya 1000+630', { exact: true }).fill('630');
      const persisted = page.waitForResponse(response => response.url().includes('action=query') && response.request().method() === 'POST' && response.request().postDataJSON()?.operation === 'insert');
      await page.getByRole('button', { name: 'Kaydet', exact: true }).click(); await persisted;
      const record = proposals.find(row => row.type === 'yg'); assert(record); const reference = record.reference_no;
      await open(page, 'saved'); await page.getByRole('button', { name: /^YG Teklifleri/ }).click(); await page.getByRole('button', { name: 'Yükle', exact: true }).click(); await page.locator('[data-portal-module="proposal"]').waitFor();
      const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Word.*İndir/ }).click()]);
      const wordPath = path.join(output, 'yg-reference.docx'); await word.saveAs(wordPath);
      const zip = await JSZip.loadAsync(fs.readFileSync(wordPath)), xml = await zip.file('word/document.xml').async('string');
      const text = xml.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      assert(text.includes('Ref: ' + reference)); assert.equal(/<span|data-vg-reference|\$<|\{selectedCompany\.refNo\}/.test(text), false);
      const pdfDownload = page.waitForEvent('download');
      await page.evaluate(async snapshot => { const module = await import('/__qa/pdf-fallback.js'); await module.downloadFallback(snapshot); }, { selectedCompany: { ...record.data.calculated, refNo: reference }, params: record.data.params });
      const pdf = await pdfDownload, pdfPath = path.join(output, 'yg-reference-fallback.pdf'); await pdf.saveAs(pdfPath);
      const result = spawnSync(process.env.VG_PYTHON || 'python', ['-c', 'import sys; from pypdf import PdfReader; print("\\n".join(page.extract_text() or "" for page in PdfReader(sys.argv[1]).pages))', pdfPath], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      assert.equal(result.status, 0, result.stderr); assert(result.stdout.includes('Ref: ' + reference)); assert.equal(/<span|data-vg-reference|\$<|\{selectedCompany\.refNo\}/.test(result.stdout), false);
      report.exports = { reference, word: { file: wordPath, bytes: fs.statSync(wordPath).size }, pdf: { file: pdfPath, bytes: fs.statSync(pdfPath).size, textIncludesReference: true } };
    } finally { await context.close(); }
  });
})().catch(error => { report.errors.push(error.stack); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.checks.filter(check => check.pass).length, total: report.checks.length, errors: report.errors.length, report: path.join(output, 'browser-report.json') })); if (report.errors.length || report.checks.some(check => !check.pass)) process.exitCode = 1; });
