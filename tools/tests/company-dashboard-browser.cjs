'use strict';
// Standalone synthetic catalog/quote fixture; never sends requests to the live site.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os'), assert = require('node:assert/strict'), { spawnSync } = require('node:child_process');
const gesPdfOnly = process.env.VG_GES_PDF_FOCUS === '1', sourceMode = process.env.VG_COMPANY_SOURCE === '1', themeOnly=process.env.VG_COMPANY_THEME_FOCUS==='1';
const root = path.resolve(__dirname, '../..'), dist = path.join(root, 'tools/staff-app/dist'), output = path.join(root, themeOnly?'.qa/company-dashboard-theme':gesPdfOnly ? '.qa/company-ges-pdf' : '.qa/company-dashboard-ges');
const packages = process.env.VG_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(packages, 'playwright'));
const JSZip = require(path.join(packages, 'jszip'));
const esbuild = require(path.join(root, 'tools/staff-app/node_modules/esbuild'));
// Optional in-memory source entry allows focused QA before the coordinated build;
// the committed production stylesheet still exercises its real workspace scope.
const sourceBundle = sourceMode ? esbuild.buildSync({ entryPoints: [path.join(root, 'tools/staff-app/src/portal-main.jsx')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', loader: { '.css': 'empty' }, external: ['buffer'], define: { 'import.meta.env': '{"BASE_URL":"/calisan/uygulama/"}' }, logLevel: 'silent' }).outputFiles[0].text : null;
const sourceTheme=sourceMode?require('../staff-app/scope-company-css.cjs').scopeCompanyCss(fs.readFileSync(path.join(root,'tools/staff-app/src/site-theme.css'),'utf8')):'';
// The advanced PDF handler is currently a dormant fallback. Exercise its exact
// source with real PDF/font libraries in this fixture, without exposing a test hook in the app.
const appSource = fs.readFileSync(path.join(root, 'tools/staff-app/src/App.jsx'), 'utf8');
const fallbackStart = appSource.indexOf('  const handleAdvancedPDFExport = async () => {');
assert(fallbackStart >= 0);
const fallbackSource = appSource.slice(fallbackStart, appSource.indexOf('\n  // --- UI Components ---', fallbackStart));
const fallbackBundle = esbuild.buildSync({
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
    if (url.pathname === '/__qa/source.js' && sourceBundle) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(sourceBundle); }
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
    if (url.pathname === '/calisan/uygulama/') { let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replace('</head>', '<link rel="stylesheet" href="/css/fonts.css">'+(sourceTheme?'<style>'+sourceTheme+'</style>':'')+'</head>'); if (sourceBundle) html = html.replace(/<script\b[^>]*type="module"[^>]*><\/script>/, '<script type="module" src="/__qa/source.js"></script>'); res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html); }
    const file = url.pathname.startsWith('/calisan/uygulama/') ? path.resolve(dist, '.' + url.pathname.slice('/calisan/uygulama'.length)) : path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
async function check(name, action) { if (gesPdfOnly && !name.startsWith('GES PDF ') && !name.startsWith('Native print ')) return; try { await action(); report.checks.push({ name, pass: true }); } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error(name + ': ' + error.message); } }
(async () => {
  fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + server.address().port;
  const executablePath = [process.env.VG_CHROME, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe')].filter(Boolean).find(fs.existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  async function pageFor(variant, width = 1440) { const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Istanbul', serviceWorkers: 'block' }); await context.addCookies([{ name: 'fixture_catalog', value: variant, url: base }]); const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message)); page.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('Sentetik GES teklifi') : dialog.dismiss()); return { context, page }; }
  async function open(page, module) { await page.goto(base + '/calisan/uygulama/?module=' + module); await page.locator('.portal-app').waitFor(); await page.waitForTimeout(100); }
  if(themeOnly){await require('./company-dashboard-theme-scenarios.cjs')({pageFor,open,check,output,report});return;}
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
      await page.getByPlaceholder('Örn: Ahmet Yılmaz', { exact: true }).fill('Sentetik Yetkili');
      await page.getByPlaceholder('Örn: Tekstil, Gıda', { exact: true }).fill('Sentetik sektör');
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
  for (const scenario of [{ name: 'commercial-desktop', width: 1440, rows: 8 }, { name: 'commercial-mobile', width: 390, rows: 8 }, { name: 'home-desktop', width: 1440, rows: 10, home: true }, { name: 'home-edited-reopened', width: 1440, rows: 10, home: true, editSaved: true }, { name: 'edited-legacy-reference', width: 1440, rows: 8, edited: true }, { name: 'long-items', width: 1440, rows: 18 }]) await check('GES PDF ' + scenario.name + ' has readable pages, totals and no empty continuation', async () => {
    const { context, page } = await pageFor('empty', scenario.width); try {
      await open(page, 'ges'); await page.getByPlaceholder('Müşteri adı', { exact: true }).fill('Sentetik GES tesisi');
      if (scenario.home) { await page.getByLabel('Kurulu güç (kW)', { exact: true }).fill(scenario.editSaved ? '25' : '12'); await page.getByRole('button', { name: 'Ev Tipi', exact: true }).click(); }
      for (let index = await page.getByPlaceholder('ürün Açıklaması', { exact: true }).count(); index < scenario.rows; index++) { await page.getByRole('button', { name: 'Manuel Satır Ekle', exact: true }).click(); await page.getByPlaceholder('ürün Açıklaması', { exact: true }).nth(index).fill('Sentetik pano ve montaj ekipmanı - test satırı ' + (index + 1)); await page.getByLabel((index + 1) + '. satır birim fiyatı', { exact: true }).fill('25,50'); }
      if (scenario.edited) {
        await page.getByRole('button', { name: /Düzenleme Modu/ }).first().click();
        await page.locator('#ges-printable-area').evaluate(root => { const reference = root.querySelector('[data-vg-reference]').textContent; root.querySelectorAll('.ges-pdf-page [data-vg-reference]').forEach(node => node.parentElement.remove()); const line = document.createElement('div'); line.className = 'vg-reference-line'; line.textContent = 'Referans: '; const marker = document.createElement('span'); marker.setAttribute('data-vg-reference', ''); marker.textContent = reference; line.append(marker); root.prepend(line); const paragraph = document.createElement('p'); paragraph.textContent = 'Sentetik düzenleme notu korunmalıdır.'; root.querySelector('.ges-pdf-page').firstElementChild.append(paragraph); });
        await page.getByRole('button', { name: /Düzenleme Modu/ }).first().click();
        assert((await page.locator('#ges-printable-area').innerText()).includes('Sentetik düzenleme notu korunmalıdır.'));
      }
      if (scenario.editSaved) {
        await page.getByRole('button', { name: /Düzenleme Modu/ }).first().click(); await page.locator('#ges-printable-area').evaluate(root => { const paragraph = [...root.querySelectorAll('p')].find(node => !node.querySelector('[data-vg-reference]') && node.textContent.trim()); paragraph.append(' QA-GES-EDITOR'); const summary = root.querySelector('.ges-pdf-page .flex.justify-end.mt-auto > div'); summary.classList.add('w-1/2'); summary.style.width = '50%'; }); await page.getByRole('button', { name: /Düzenleme Modu/ }).first().click();
        const saved = page.waitForResponse(response => response.url().includes('action=query') && response.request().method() === 'POST' && response.request().postDataJSON()?.operation === 'insert'); await page.getByRole('button', { name: 'Teklifi Kaydet', exact: true }).click(); await saved; await open(page, 'saved'); await page.getByRole('button', { name: /^GES Teklifleri/ }).click(); await page.getByRole('button', { name: 'Yükle', exact: true }).last().click(); await page.locator('[data-portal-module="ges"]').waitFor(); assert((await page.locator('#ges-printable-area').innerText()).includes('QA-GES-EDITOR'));
      }
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.locator('.ges-pdf-page').first().evaluate(source => {
        const workspace = source.closest('#vg-company-workspace'), host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-100000px;top:0;width:210mm'; const clone = source.cloneNode(true); Object.assign(clone.style, { width: '210mm', maxWidth: 'none', height: 'auto', minHeight: '297mm', margin: '0', boxShadow: 'none', overflow: 'visible' }); clone.querySelectorAll('div').forEach(node => { if ((node.style.position === 'absolute' || node.className.includes('absolute')) && (node.style.bottom || /bottom-/.test(node.className)) && /Sayfa\s+\d/.test(node.textContent)) node.remove(); }); host.append(clone); workspace.append(host);
        try { const box = clone.getBoundingClientRect(), relative = node => { const r = node.getBoundingClientRect(); return { left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height }; }; const payable = [...clone.querySelectorAll('tr')].find(row => /ÖDENECEK TUTAR/.test(row.textContent)), tl = [...clone.querySelectorAll('p')].find(node => node.textContent.startsWith('₺')); return { width: clone.offsetWidth, height: clone.scrollHeight, font: getComputedStyle(clone).fontFamily, rowFont: getComputedStyle(clone.querySelector('tbody td')).fontSize, payable: payable && relative(payable), payableText: payable?.textContent, tl: tl && relative(tl), tlText: tl?.textContent, pageCount: source.parentElement.querySelectorAll('.ges-pdf-page').length }; } finally { host.remove(); }
      });
      assert.match(metrics.font, /Inter/); assert(parseFloat(metrics.rowFont) >= 12); assert(metrics.payable && metrics.tl); assert(metrics.tlText.startsWith('₺')); assert.equal(metrics.tlText.includes('?'), false);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF İndir', exact: true }).click()]); const destination = path.join(output, scenario.name + '.pdf'); await download.saveAs(destination);
      const inspection = spawnSync(process.env.VG_PYTHON || 'python', ['-c', 'import sys,json,fitz; d=fitz.open(sys.argv[1]); out=[]\nfor p in d:\n pix=p.get_pixmap(matrix=fitz.Matrix(1,1),clip=fitz.Rect(0,0,p.rect.width,p.rect.height-55),alpha=False); b=pix.samples; ink=sum(min(b[i:i+3])<235 for i in range(0,len(b),3)); out.append({"page":p.number+1,"ink":ink,"coverage":ink/(pix.width*pix.height),"footer":p.get_text()})\nprint(json.dumps({"pages":len(d),"body":out}))', destination], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      assert.equal(inspection.status, 0, inspection.stderr); const pdf = JSON.parse(inspection.stdout); if (scenario.rows <= 10) assert.equal(pdf.pages, 2, 'Default commercial/home quote must occupy its two intended A4 pages.'); for (const body of pdf.body) { assert(body.coverage > 0.003, 'Empty or almost empty continuation page ' + body.page); assert(body.footer.includes('Sayfa ' + body.page + ' / ' + pdf.pages)); }
      const prefix = path.join(output, scenario.name), render = spawnSync('pdftoppm', ['-scale-to', '1400', '-png', destination, prefix], { encoding: 'utf8' }); assert.equal(render.status, 0, render.stderr);
      report.pdfLayouts ||= []; report.pdfLayouts.push({ scenario, metrics, file: destination, bytes: fs.statSync(destination).size, ...pdf });
      if (scenario.rows <= 10) {
        await page.emulateMedia({ media: 'print' });
        try {
          assert.equal(await page.locator('#ges-printable-area').evaluate(node => getComputedStyle(node).visibility), 'visible');
          const nativePath = path.join(output, scenario.name + '-native-print.pdf'); await page.pdf({ path: nativePath, format: 'A4', printBackground: true, preferCSSPageSize: true });
          const native = spawnSync(process.env.VG_PYTHON || 'python', ['-c', 'import sys,json,fitz; d=fitz.open(sys.argv[1]); print(json.dumps({"pages":len(d),"text":"\\n".join(p.get_text() for p in d)},ensure_ascii=True))', nativePath], { encoding: 'utf8' }); assert.equal(native.status, 0, native.stderr); const printed = JSON.parse(native.stdout); assert.equal(printed.pages, 2, 'Native browser print keeps both report pages without a blank portal page.'); assert(printed.text.includes('ÖDENECEK TUTAR')); assert(printed.text.includes('₺')); assert.equal(printed.text.includes('Manuel Satır Ekle'), false); if (scenario.edited) assert(printed.text.includes('Sentetik düzenleme notu korunmalıdır.'));
          const nativeRender = spawnSync('pdftoppm', ['-scale-to', '1400', '-png', nativePath, path.join(output, scenario.name + '-native-print')], { encoding: 'utf8' }); assert.equal(nativeRender.status, 0, nativeRender.stderr);
          report.pdfLayouts.at(-1).nativePrint = { file: nativePath, pages: printed.pages, includesPayableTotal: true, excludesEditor: true };
        } finally { await page.emulateMedia({ media: null }); }
      }
      console.log('PDF ' + scenario.name + ': ' + pdf.pages + ' pages');
    } finally { await context.close(); }
  });
  await check('Native print periodic quote retains totals and both logical A4 pages', async () => {
    const { context, page } = await pageFor('empty'); try {
      await open(page, 'periodic'); await page.getByPlaceholder('Firma adı', { exact: true }).fill('Sentetik periyodik tesis'); await page.locator('.portal-app input[type=number]').nth(2).fill('10'); await page.getByRole('button', { name: 'Hesapla', exact: true }).click(); await page.emulateMedia({ media: 'print' });
      const file = path.join(output, 'periodic-native-print.pdf'); await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true }); const extracted = spawnSync(process.env.VG_PYTHON || 'python', ['-c', 'import sys,json,fitz;d=fitz.open(sys.argv[1]);print(json.dumps({"pages":len(d),"text":"\\n".join(p.get_text() for p in d)},ensure_ascii=True))', file], { encoding: 'utf8' }); assert.equal(extracted.status, 0, extracted.stderr); const pdf = JSON.parse(extracted.stdout); assert.equal(pdf.pages, 2); assert(pdf.text.includes('TEKLİF EDiLEN')); assert(pdf.text.includes('Sentetik periyodik tesis')); assert.equal(pdf.text.split('\n').some(line => line.trim() === 'Hesapla'), false); const rendered = spawnSync('pdftoppm', ['-scale-to', '1400', '-png', file, path.join(output, 'periodic-native-print')], { encoding: 'utf8' }); assert.equal(rendered.status, 0, rendered.stderr); report.periodicNativePrint = { file, pages: pdf.pages, includesTotal: true };
    } finally { await context.close(); }
  });
})().catch(error => { report.errors.push(error.stack); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.checks.filter(check => check.pass).length, total: report.checks.length, errors: report.errors.length, report: path.join(output, 'browser-report.json') })); if (report.errors.length || report.checks.some(check => !check.pass)) process.exitCode = 1; });
