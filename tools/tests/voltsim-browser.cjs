'use strict';

// VoltSim tarayıcı QA: her simülasyon sayfasını gerçek Chrome'da (SwiftShader WebGL) açar; konsol/CSP/eksik
// kaynak hatası, 3D başlatma, parametre → sonuç değişimi, senaryo, 2D mod, kaydet/yükle, CSV, PDF ve mobil
// taşmayı denetler. Ekran görüntüleri .qa/voltsim/ altına yazılır.
//   node tools/tests/voltsim-browser.cjs            tüm sayfalar
//   node tools/tests/voltsim-browser.cjs pano ges   yalnız verilen modüller
//   --no-pdf                                        PDF üretimini atla (hızlı)
//   --previews                                      tanıtım kartı görsellerini public/voltsim/*.webp olarak üret
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, '.qa/voltsim');
fs.mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
// --theme=dark|light: site renk temasını zorlar (PDF raporu iki temada da açık kalmalı)
const THEME = (args.find(a => a.startsWith('--theme=')) || '').slice(8) || null;
const only = args.filter(a => !a.startsWith('--'));
const withPdf = !args.includes('--no-pdf');
const previews = args.includes('--previews');

function packagePath(name) {
  try { return require.resolve(name); } catch (_) {}
  for (const dir of [process.env.VG_NODE_MODULES, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean)) {
    if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  throw new Error(name + ' bulunamadı; VG_NODE_MODULES ayarlayın.');
}
function chromePath() {
  return [process.env.VG_CHROME, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(f => fs.existsSync(f));
}
const csp = fs.readFileSync(path.join(root, '.htaccess'), 'utf8').match(/Header always set Content-Security-Policy\s+"([^"]+)"/)[1].replace(/\s*upgrade-insecure-requests/, '');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Security-Policy': csp });
  fs.createReadStream(file).pipe(res);
});

// Hesaplama kimlikleri gibi bilgi sayfaları simülasyon değildir; yalnız uygulama kökü bulunan sayfalar denetlenir.
const allSlugs = fs.readdirSync(path.join(root, 'voltsim'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  .filter(s => {
    const file = path.join(root, 'voltsim', s, 'index.html');
    return fs.existsSync(file) && /\bdata-vs-module\s*=/.test(fs.readFileSync(file, 'utf8'));
  });
const slugs = allSlugs.filter(s => !only.length || only.includes(s) || only.some(o => s.startsWith(o)));

(async () => {
  const { chromium } = require(packagePath('playwright'));
  // VG_BASE verilirse yayındaki (ör. Netlify önizleme) siteyi dener; yoksa yerel dosyaları sunar
  if (!process.env.VG_BASE) await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = process.env.VG_BASE || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const report = { pages: [], failures: [] };
  const fail = (slug, msg) => { report.failures.push(slug + ': ' + msg); console.log('  ✕ ' + msg); };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 920 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', serviceWorkers: 'block', acceptDownloads: true, deviceScaleFactor: 1, ...(THEME ? { colorScheme: THEME } : {}) });
    await ctx.addInitScript(() => { window.__qa = { csp: [] }; addEventListener('securitypolicyviolation', e => window.__qa.csp.push(e.violatedDirective + ' ' + e.blockedURI)); try { localStorage.clear(); } catch (_) {} });
    if (THEME) await ctx.addInitScript(th => { try { localStorage.setItem('vg-theme', th); } catch (_) {} }, THEME);
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const errors = [], missing = [];
    page.on('console', m => { if (m.type() === 'error' && !/app.netlify.com/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e && e.stack || e)));
    page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(base)) missing.push(r.status() + ' ' + r.url().slice(base.length)); });

    // tanıtım sayfası
    if (!only.length) {
      await page.goto(base + '/voltsim/', { waitUntil: 'load' });
      await page.screenshot({ path: path.join(out, 'landing-desktop.png'), fullPage: true });
      const cards = await page.locator('.vsl-card').count();
      const expected = allSlugs.length;
      if (cards !== expected) fail('landing', 'kart sayısı ' + cards + ' (beklenen ' + expected + ')');
      console.log('landing: ' + cards + ' kart');
    }

    for (const slug of slugs) {
      console.log(slug);
      errors.length = 0; missing.length = 0;
      const t0 = Date.now();
      await page.setViewportSize({ width: 1440, height: 920 });
      await page.goto(base + '/voltsim/' + slug + '/', { waitUntil: 'load' });
      try { await page.waitForSelector('[data-vs-module][data-ready="true"]', { timeout: 30000 }); }
      catch (_) { fail(slug, 'uygulama hazır olmadı'); await page.screenshot({ path: path.join(out, slug + '-error.png') }); continue; }
      await page.waitForTimeout(1500);
      const info = await page.evaluate(() => { const a = window.__vsApp; return { webgl: !!(a && a.viewer), ok: !!(a && a.validResult), checks: a && a.validResult ? a.validResult.checks.length : 0, ro: document.querySelectorAll('.vs-ro').length, controls: document.querySelectorAll('[data-vs-controls] [data-key]').length, scenarios: document.querySelectorAll('[data-vs-scenario] option').length - 1 }; });
      if (!info.webgl) fail(slug, '3D başlatılamadı');
      if (!info.ok) fail(slug, 'geçerli hesap sonucu yok');
      if (info.ro < 4) fail(slug, 'okuma sayısı az: ' + info.ro);
      if (info.scenarios < 2) fail(slug, 'senaryo sayısı az: ' + info.scenarios);
      await page.locator('.vs-app').scrollIntoViewIfNeeded();
      await page.evaluate(() => document.querySelector('.vs-app').scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, slug + '-desktop.png') });
      if (previews) {
        // kart görseli: etiketler, rozet ve araç düğmeleri olmadan yalnız sahne
        await page.evaluate(() => { document.querySelectorAll('.vs-vt[data-vs-act="labels"]').forEach(b => b.click()); document.querySelectorAll('.vs-vtools,.vs-hud,.vs-hint,.vs-fab-legend').forEach(e => { e.style.visibility = 'hidden'; }); });
        await page.waitForTimeout(400);
        const stage = page.locator('.vs-stage');
        await stage.screenshot({ path: path.join(out, slug + '-preview.png') });
        await page.evaluate(() => { document.querySelectorAll('.vs-vt[data-vs-act="labels"]').forEach(b => b.click()); document.querySelectorAll('.vs-vtools,.vs-hud,.vs-hint,.vs-fab-legend').forEach(e => { e.style.visibility = ''; }); });
      }
      // parametre değişimi sonucu değiştirmeli
      const before = await page.evaluate(() => JSON.stringify(window.__vsApp.validResult.values, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)).slice(0, 4000));
      const changed = await page.evaluate(() => {
        // In the panel model a protection setting need not change load results
        // while the load stays below its threshold. Change cable length there.
        const r = document.querySelector('[data-vs-controls] input[type=range][data-key="feedL"]') || Array.from(document.querySelectorAll('[data-vs-controls] input[type=range]')).find(x => !x.closest('[hidden]'));
        if (!r) return 'no-range';
        const min = Number(r.min), max = Number(r.max), cur = Number(r.value);
        r.value = String(cur < (min + max) / 2 ? max : min); r.dispatchEvent(new Event('input', { bubbles: true })); return r.dataset.key;
      });
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => JSON.stringify(window.__vsApp.validResult.values, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)).slice(0, 4000));
      if (before === after) fail(slug, 'parametre (' + changed + ') sonucu değiştirmedi');
      // görevler: ilk görevi başlat, etkin görev ve başlangıçta çözülmemiş olmalı
      const task = await page.evaluate(() => { const box = document.querySelector('[data-vs-tasks]'); if (!box) return 'yok'; box.open = true; const b = box.querySelector('.vs-tasklist .vs-btn'); if (!b) return 'düğme yok'; b.click(); return 'ok'; });
      await page.waitForTimeout(500);
      if (task !== 'ok') fail(slug, 'görevler: ' + task);
      else if (!(await page.evaluate(() => !!window.__vsApp.activeTask))) fail(slug, 'ilk görev etkinleşmedi (başlangıçta çözülmüş olabilir)');
      // 3D eylem: eylemi olan ilk ekipmanı seç ve kart düğmesini doğrula
      const act = await page.evaluate(() => { const v = window.__vsApp.viewer; if (!v) return 'no3d'; const p = v.pickables.find(x => x.actions); if (!p) return 'eylem yok'; v.select(p); const n = document.querySelectorAll('.vs-info__acts .vs-btn').length; v.select(null); return n ? 'ok' : 'kart düğmesi yok'; });
      if (act !== 'ok' && act !== 'no3d') fail(slug, '3D eylem: ' + act);
      // simülasyonu başlat / durdur / devam
      await page.click('[data-vs-act="start"]'); await page.waitForTimeout(1500);
      await page.click('[data-vs-act="pause"]'); const paused = await page.evaluate(() => window.__vsApp.paused);
      await page.click('[data-vs-act="pause"]'); const resumed = await page.evaluate(() => !window.__vsApp.paused && window.__vsApp.running);
      if (!paused || !resumed) fail(slug, 'durdur/devam çalışmadı');
      // senaryo yükle
      const sc = await page.evaluate(() => { const s = document.querySelector('[data-vs-scenario]'); const o = s.options[2] || s.options[1]; s.value = o.value; s.dispatchEvent(new Event('change')); return o.textContent; });
      await page.waitForTimeout(700);
      // 3D görünüm araçları
      for (const act of ['ghost', 'section', 'explode', 'labels']) { await page.click('.vs-vt[data-vs-act="' + act + '"]'); await page.waitForTimeout(150); }
      await page.screenshot({ path: path.join(out, slug + '-tools.png') });
      for (const act of ['ghost', 'section', 'explode', 'labels']) await page.click('.vs-vt[data-vs-act="' + act + '"]');
      // 2D mod
      await page.click('[data-vs-act="mode"]'); await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, slug + '-2d.png') });
      const drawn = await page.evaluate(() => { const c = document.querySelector('[data-vs-2d]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 400) if (d[i] > 60) n++; return n; });
      if (drawn < 20) fail(slug, '2D şema boş görünüyor');
      await page.click('[data-vs-act="mode"]');
      // kaydet → yükle
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-vs-act="save"]')]);
      const jsonFile = path.join(out, slug + '.voltsim.json'); await dl.saveAs(jsonFile);
      const proj = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      assert.equal(proj.format, 'voltsim-project');
      await page.click('[data-vs-act="reset"]'); await page.waitForTimeout(300);
      await page.setInputFiles('[data-vs-file]', jsonFile); await page.waitForTimeout(600);
      const restored = await page.evaluate(s => JSON.stringify(window.__vsApp.state) === JSON.stringify(s), proj.state);
      if (!restored) fail(slug, 'proje geri yüklenemedi');
      // CSV
      const [csv] = await Promise.all([page.waitForEvent('download'), page.click('[data-vs-act="csv"]')]);
      const csvFile = path.join(out, slug + '.csv'); await csv.saveAs(csvFile);
      if (fs.statSync(csvFile).size < 200) fail(slug, 'CSV çok kısa');
      // PDF
      if (withPdf) {
        // Inspect the exact page DOM captured by html2canvas as well as the
        // downloaded PDF: a valid PDF header alone misses clipped report blocks
        // and pages containing only source/privacy information.
        await page.evaluate(async () => {
          if (!window.html2canvas) await new Promise((resolve, reject) => {
            const s = document.createElement('script'); s.src = '/araclar/vendor/html2canvas.min.js';
            s.dataset.src = s.src.replace(location.origin, ''); s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
          });
          const capture = window.html2canvas;
          window.__pdfPages = [];
          window.html2canvas = function (node, options) {
            if (node.matches('.rp-page')) {
              const box = node.getBoundingClientRect(), foot = node.querySelector('.rp-foot');
              const limit = foot ? foot.getBoundingClientRect().top : box.bottom - 46;
              const blocks = [...node.querySelectorAll(':scope > .rp-block')];
              window.__pdfPages.push({ contentBlocks: blocks.length,
                clipped: blocks.filter(b => b.getBoundingClientRect().bottom > limit - 4 || b.getBoundingClientRect().right > box.right - 49).map(b => b.innerText.slice(0, 120)),
                footer: foot && foot.innerText });
            }
            return capture.call(this, node, options);
          };
        });
        const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 240000 }), page.click('[data-vs-act="report"]')]);
        const pdfFile = path.join(out, slug + '.pdf'); await pdf.saveAs(pdfFile);
        const head = fs.readFileSync(pdfFile).slice(0, 5).toString();
        if (head !== '%PDF-') fail(slug, 'PDF geçersiz');
        const pdfPages = await page.evaluate(() => window.__pdfPages);
        if (!pdfPages.length) fail(slug, 'PDF sayfa yakalaması yok');
        pdfPages.forEach((p, i) => {
          if (!p.contentBlocks) fail(slug, 'PDF yalnız alt bilgi içeriyor: sayfa ' + (i + 1));
          if (p.clipped.length) fail(slug, 'PDF içerik taşması: sayfa ' + (i + 1) + ' ' + p.clipped.join(' | '));
          if (!p.footer || !p.footer.includes('otomatik gönderilmez')) fail(slug, 'PDF kaynak/gizlilik bilgisi eksik: sayfa ' + (i + 1));
        });
        report.pdfPages = report.pdfPages || {};
        report.pdfPages[slug] = pdfPages;
      }
      // mobil
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 1) fail(slug, 'mobilde yatay taşma ' + overflow + ' px');
      await page.evaluate(() => document.querySelector('.vs-app').scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, slug + '-mobile.png') });
      await page.click('[data-vs-pane="params"]'); await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(out, slug + '-mobile-params.png') });
      await page.click('[data-vs-pane="analysis"]'); await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, slug + '-mobile-analysis.png') });
      await page.click('[data-vs-pane="stage"]');
      const csps = await page.evaluate(() => window.__qa.csp);
      csps.forEach(c => fail(slug, 'CSP ihlali ' + c));
      errors.forEach(e => fail(slug, 'konsol: ' + e.slice(0, 300)));
      missing.forEach(m => fail(slug, 'eksik kaynak ' + m));
      report.pages.push({ slug, ms: Date.now() - t0, info, scenario: sc });
      console.log('  ✓ ' + JSON.stringify(info) + ' ' + (Date.now() - t0) + ' ms');
    }
  } finally {
    await browser.close(); server.close();
  }
  if (previews) {
    const sharp = require(packagePath('sharp'));
    const dest = path.join(root, 'public/voltsim'); fs.mkdirSync(dest, { recursive: true });
    const ids = { pano: 'pano', ges: 'ges', trafo: 'trafo', 'sarj-istasyonu': 'sarj', res: 'res', kompanzasyon: 'komp', topraklama: 'topraklama', 'motor-otomasyon': 'motor', 'ups-jenerator': 'ups', 'yangin-algilama': 'yangin', selektivite: 'selektivite', 'enerji-kalitesi': 'kalite', yildirim: 'yildirim', 'pompa-vfd': 'pompa', 'depolama-hibrit': 'depolama', 'ariza-tespit': 'ariza', 'konveyor-scada': 'konveyor', 'fabrika-senaryosu': 'fabrika' };
    for (const slug of slugs) {
      const src = path.join(out, slug + '-preview.png'); if (!fs.existsSync(src)) continue;
      await sharp(src).resize(960, 600, { fit: 'cover', position: 'centre' }).webp({ quality: 80 }).toFile(path.join(dest, ids[slug] + '.webp'));
      if (slug === 'pano') await sharp(src).resize(1200, 750, { fit: 'cover' }).webp({ quality: 82 }).toFile(path.join(dest, 'hero.webp'));
    }
    console.log('Önizlemeler public/voltsim/ altına yazıldı.');
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (report.failures.length) { console.log('\n' + report.failures.length + ' sorun:\n' + report.failures.join('\n')); process.exitCode = 1; }
  else console.log('\nVoltSim tarayıcı testleri geçti (' + slugs.length + ' sayfa).');
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
