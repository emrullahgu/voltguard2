'use strict';
// Real public calculator PDF downloads, using synthetic values and a local static fixture.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), output = path.join(root, '.qa/public-calculator-pdf');
const modules = process.env.VG_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(modules, 'playwright'));
const chrome = [process.env.VG_CHROME, process.env.VOLTGUARD_CHROME, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe')].filter(Boolean).find(fs.existsSync);
const urls = fs.readdirSync(path.join(root, 'hesaplama')).filter(file => { const source = file.endsWith('.html') && fs.readFileSync(path.join(root, 'hesaplama', file), 'utf8'); return source && source.includes('voltguard-tools.js') && /class="mini-calc(?:\s|")/.test(source); }).map(file => '/hesaplama/' + file);
const report = { isolated: true, exports: [], findings: [], pageErrors: [], consoleErrors: [], externalRequests: [], requests: [] };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture'); report.requests.push({ method: req.method, path: url.pathname });
  if (url.pathname === '/api/auth.php' && url.searchParams.get('action') === 'me' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ api: 'vg-auth/1', ok: true, user: null, csrf: 'a'.repeat(64) })); }
  if (url.pathname === '/api/metrics.php') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (req.method !== 'GET' || /\.php(?:$|\/)/i.test(url.pathname) || !file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !mime[path.extname(file)]) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store' }); fs.createReadStream(file).pipe(res);
});
const norm = text => String(text || '').replace(/\s+/g, ' ').trim();
function inspectPdf(file, prefix) {
  const code = 'import json,sys,fitz;from pypdf import PdfReader\nf=sys.argv[1];r=PdfReader(f);d=fitz.open(f);out={"pages":len(r.pages),"pageDetails":[]}\nfor p in d:\n blocks=p.get_text("blocks",clip=fitz.INFINITE_RECT());out["pageDetails"].append({"page":p.number+1,"text":p.get_text(),"bodyBlocks":len([b for b in blocks if b[1]<p.rect.height*.92 and str(b[4]).strip()]),"clipped":[{"bbox":list(b[:4]),"text":b[4]} for b in blocks if b[0]<-1 or b[2]>p.rect.width+1 or b[1]<-1 or b[3]>p.rect.height+1]})\nprint(json.dumps(out,ensure_ascii=True))';
  const result = spawnSync(process.env.VG_PYTHON || 'python', ['-c', code, file], { encoding: 'utf8', windowsHide: true, timeout: 30000 }); assert.equal(result.status, 0, result.stderr);
  const pdf = JSON.parse(result.stdout);
  assert.equal(path.dirname(path.resolve(prefix)), output, 'Rendered-page cleanup must stay in this fixture output directory');
  const pageName = new RegExp('^' + path.basename(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d+\\.png$');
  for (const old of fs.readdirSync(output).filter(name => pageName.test(name))) fs.unlinkSync(path.join(output, old));
  const render = spawnSync(process.env.VG_PDFTOPPM || 'pdftoppm', ['-scale-to', '1400', '-png', file, prefix], { encoding: 'utf8', windowsHide: true, timeout: 60000 }); assert.equal(render.status, 0, render.stderr);
  const rendered = fs.readdirSync(output).filter(name => pageName.test(name)).map(name => path.join(output, name)); assert.equal(rendered.length, pdf.pages, 'Every PDF page must have exactly one fresh render');
  const ink = spawnSync(process.env.VG_PYTHON || 'python', ['-c', 'import json,sys;from PIL import Image\nout=[]\nfor f in sys.argv[1:]:\n im=Image.open(f).convert("L");body=im.crop((0,0,im.width,int(im.height*.92)));h=body.histogram();out.append({"image":f,"bodyInk":sum(h[:235])/(body.width*body.height)})\nprint(json.dumps(out))', ...rendered], { encoding: 'utf8', windowsHide: true, timeout: 30000 }); assert.equal(ink.status, 0, ink.stderr); pdf.rendered = JSON.parse(ink.stdout);
  return pdf;
}
async function savePdf(page, id, expected, button) {
  const entry = { id, expected, findings: [], ok: false }; report.exports.push(entry);
  try {
    await button.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), button.click({ timeout: 25000 })]);
    const file = path.join(output, id + '.pdf'); await download.saveAs(file); entry.file = file; entry.bytes = fs.statSync(file).size;
    assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), '%PDF-');
    entry.pdf = inspectPdf(file, path.join(output, id)); const body = norm(entry.pdf.pageDetails.map(p => p.text).join('\n'));
    const missing = expected.filter(text => norm(text) && !body.includes(norm(text))); if (missing.length) entry.findings.push({ problem: 'Missing visible report content', values: missing });
    for (const p of entry.pdf.pageDetails) { if (!p.bodyBlocks) entry.findings.push({ problem: 'Footer-only or blank page', page: p.page }); if (p.clipped.length) entry.findings.push({ problem: 'Text outside page', page: p.page, blocks: p.clipped }); }
    for (const p of entry.pdf.rendered) if (p.bodyInk < 0.0007) entry.findings.push({ problem: 'Almost empty rendered page', image: p.image, ink: p.bodyInk });
    entry.ok = entry.findings.length === 0; console.log(JSON.stringify({ id, ok: entry.ok, pages: entry.pdf.pages, missing: missing.length }));
  } catch (error) { entry.findings.push({ problem: 'Export workflow failed', error: error.stack }); await page.screenshot({ path: path.join(output, id + '-failure-screen.png'), fullPage: true }).catch(() => {}); console.log(JSON.stringify({ id, ok: false, error: error.message })); }
}
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + server.address().port; let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--disable-features=Prerender2,SpeculationRulesPrefetch,SpeculationRulesPrerender'] });
    const context = await browser.newContext({ locale: 'tr-TR', timezoneId: 'Europe/Istanbul', viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true, reducedMotion: 'reduce' });
    await context.route('**/*', route => { const url = route.request().url(); if (/^https?:/.test(url) && !url.startsWith(base + '/')) { report.externalRequests.push(url); return route.abort(); } return route.continue(); });
    function events(page, id) { page.on('pageerror', error => report.pageErrors.push({ id, error: error.message })); page.on('console', message => { if (message.type() === 'error' && !/net::ERR_(?:FAILED|ABORTED|BLOCKED_BY_CLIENT)/.test(message.text())) report.consoleErrors.push({ id, message: message.text() }); }); }
    if (!process.argv.includes('--hub-only')) for (const url of urls.filter(url => !process.env.VG_CALC_FILTER || process.env.VG_CALC_FILTER.split('|').some(part => url.includes(part)))) {
      const id = path.basename(url, '.html'), page = await context.newPage(); events(page, id);
      try {
        await page.goto(base + url, { waitUntil: 'networkidle', timeout: 20000 }); await page.waitForFunction(() => !!window.VG?.Tools?.readResult);
        // Explicit synthetic prices enable optional economic outputs; no preset market prices are assumed.
        for (const [field, value] of [['ge-cost', '10000'], ['ge-price', '3,50'], ['ge-contract', '1000'], ['rc-price', '2'], ['rc-hours', '450'], ['rc-invest', '25000'], ['mk-in', '20'], ['sc-pk', '10000'], ['sc-skq', '250'], ['sc-length', '60'], ['fu-ik1', '1000']]) { const control = page.locator('#' + field); if (await control.count() && await control.isVisible()) await control.fill(value); }
        if (id === 'fabrika-elektrik-risk-testi') {
          const questions = page.locator('#fr-fields select');
          for (let i = 0; i < await questions.count(); i++) { const choices = await questions.nth(i).evaluate(element => [...element.options].filter(option => option.value !== '').map(option => option.value)); await questions.nth(i).selectOption(choices[i % choices.length]); }
          assert.notEqual(await page.locator('#fr-result').innerText(), '-', 'Risk export must contain a completed synthetic risk profile');
        }
        const expected = await page.evaluate(() => { const tools = window.VG.Tools, r = tools.readResult(), safe = text => tools.pdfText(text); return [safe(document.querySelector('main h1').textContent.trim()), ...tools.readInputs().map(f => safe(f.label + ': ' + f.value)), safe(r.value || '-'), safe(r.note), ...r.breakdown.map(line => safe('- ' + line)), safe(r.assumptions), safe('Bu çıktı ön değerlendirmedir; nihai proje için yetkili mühendislik doğrulaması gerekir.')]; });
        await savePdf(page, id, expected, page.locator('[data-vg-action="pdf"]'));
      } finally { await page.close(); }
    }
    if (!process.argv.includes('--calculators-only')) {
      const page = await context.newPage(); events(page, 'teklif-araclari'); await page.goto(base + '/teklif-araclari.html', { waitUntil: 'networkidle' }); await page.waitForFunction(() => !!window.VG?.Tools?.pdfText);
      const technical = await page.locator('#technical-tool option').evaluateAll(options => options.map(o => o.value));
      const scenarios = ['ges', 'trafo', 'kontrol', ...technical.map(tool => 'teknik:' + tool)];
      for (const scenario of scenarios.filter(scenario => !process.env.VG_HUB_FILTER || scenario === process.env.VG_HUB_FILTER)) {
        const [panelId, tool] = scenario.split(':'); await page.locator('#' + panelId + '-tab').click();
        if (tool) { await page.locator('#technical-tool').selectOption(tool); for (const [index, name] of ['a', 'b', 'c', 'd'].entries()) { const field = page.locator('#technical-' + name); if (await field.isVisible() && !await field.inputValue()) await field.fill(index === 3 ? '10000' : '3,50'); } }
        if (panelId === 'ges') { await page.locator('#ges-unit-price').fill('3,50'); await page.locator('#ges-cost').fill('10000'); }
        const panel = page.locator('#' + panelId + '-panel'), button = panel.locator('.tool-download');
        const expected = await panel.evaluate(panel => { const safe = text => window.VG.Tools.pdfText(String(text || '').replace(/\s+/g, ' ').trim()); return [safe(panel.querySelector('.tool-download').dataset.pdfTitle), safe(panel.querySelector('.tool-result__amount').textContent), safe(panel.querySelector('.tool-result__detail').textContent), ...[...panel.querySelectorAll('.tool-field')].filter(f => !f.hidden).map(f => { const c = f.querySelector('input,select'); return safe(f.querySelector('label').textContent + ': ' + (c.tagName === 'SELECT' ? c.selectedOptions[0].text : c.value)); }), safe(panel.querySelector('.tool-formula')?.innerText), safe('Bu belge bağlayıcı teklif değildir.')]; });
        if (await button.isDisabled()) { report.exports.push({ id: 'hub-' + scenario, ok: false, findings: [{ problem: 'Synthetic valid fixture remains blocked', detail: await panel.locator('.tool-result__detail').innerText() }] }); continue; }
        await savePdf(page, 'hub-' + scenario.replace(':', '-'), expected, button);
      }
      await page.close();
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
  report.findings = report.exports.flatMap(entry => entry.findings.map(finding => ({ id: entry.id, finding })));
  const reportFilter = process.env.VG_CALC_FILTER || process.env.VG_HUB_FILTER;
  const reportName = reportFilter ? 'report-' + reportFilter.replace(/[^a-z0-9-]/gi, '') + '.json' : 'report.json';
  fs.writeFileSync(path.join(output, reportName), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.exports.filter(e => e.ok).length, total: report.exports.length, pages: report.exports.reduce((n, e) => n + (e.pdf?.pages || 0), 0), findings: report.findings.length, pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length }));
  if (report.findings.length || report.pageErrors.length || report.consoleErrors.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); server.close(); process.exitCode = 1; });
