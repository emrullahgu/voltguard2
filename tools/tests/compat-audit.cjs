'use strict';

// Tarayıcı ve cihaz uyumluluk denetimi: temsilî sayfaları Chrome (Chromium), Safari motoru (WebKit) ve Firefox ile
// 360/390/768 px, yatay telefon ve 1366 px dizüstü görünümlerinde açar. Hata, eksik kaynak, yatay taşma, mobil menü,
// çok küçük yazı ve 3D (WebGL) başlatma durumunu raporlar.
//   node tools/tests/compat-audit.cjs                (önizleme sunucusu 4173'te çalışıyor olmalı)
//   node tools/tests/compat-audit.cjs --engines=webkit,firefox
// Çıktı: .qa/audit/uyumluluk.md ve .qa/audit/uyumluluk.json, ekran görüntüleri .qa/compat/
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const BASE = process.env.VG_BASE || 'http://127.0.0.1:4173';
const outDir = path.join(root, '.qa/audit'), shotDir = path.join(root, '.qa/compat');
fs.mkdirSync(outDir, { recursive: true }); fs.mkdirSync(shotDir, { recursive: true });
const engArg = (process.argv.find(a => a.startsWith('--engines=')) || '').split('=')[1];

function packagePath(name) {
  try { return require.resolve(name); } catch (_) {}
  const dir = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  throw new Error(name + ' bulunamadı');
}
const chrome = [process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe')].filter(Boolean).find(f => fs.existsSync(f));

const PAGES = ['/', '/hizmetler/', '/hizmetler/trafo-isletme-sorumlulugu.html', '/hizmetler/fabrika-cati-ges.html', '/fabrika-cozumleri.html', '/ekibimiz.html',
  '/bilgi-bankasi.html', '/bilgi/gerilim-dusumu-nedir.html', '/bilgi/mevzuat-kutuphanesi.html', '/akademi.html', '/akademi/kompanzasyon-harmonik-orta.html',
  '/sor.html', '/sor/motor-termik-sik-atiyor.html', '/mm/pano-kontrol-formu.html', '/hesaplama-araclari/', '/hesaplama/kisa-devre-akimi-hesaplama/',
  '/hesaplama/kablo-kesiti-hesaplama/', '/hesaplama/ges-uretim-hesaplama/', '/araclar/', '/araclar/ag-gerilim-dusumu/', '/araclar/ges-tasarim/',
  '/araclar/topraklama-simulatoru/', '/voltsim/', '/voltsim/pano/', '/voltsim/ges/', '/voltsim/sarj-istasyonu/', '/voltgame.html', '/hesap/giris.html',
  '/gizlilik.html', '/topluluk.html', '/404.html'];
const VIEWS = [
  { id: 'android-360', width: 360, height: 760, mobile: true },
  { id: 'iphone-390', width: 390, height: 844, mobile: true },
  { id: 'ipad-768', width: 768, height: 1024, mobile: true },
  { id: 'yatay-844', width: 844, height: 390, mobile: true },
  { id: 'dizustu-1366', width: 1366, height: 768, mobile: false }
];

(async () => {
  const pw = require(packagePath('playwright'));
  const engines = [
    { id: 'chrome', type: pw.chromium, opts: { executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
    { id: 'webkit', type: pw.webkit, opts: {} },
    { id: 'firefox', type: pw.firefox, opts: { firefoxUserPrefs: { 'webgl.force-enabled': true } } }
  ].filter(e => !engArg || engArg.split(',').includes(e.id));
  const rows = [];
  for (const eng of engines) {
    let browser;
    try { browser = await eng.type.launch(Object.assign({ headless: true }, eng.opts)); }
    catch (e) { rows.push({ engine: eng.id, fatal: 'başlatılamadı: ' + e.message.split('\n')[0] }); continue; }
    for (const v of VIEWS) {
      // WebKit/Firefox'ta isMobile desteklenmez; yalnız boyut ve dokunma emülasyonu
      const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, hasTouch: v.mobile, isMobile: eng.id === 'chrome' && v.mobile && v.width < 800, locale: 'tr-TR', serviceWorkers: 'block' });
      // Yerel önizleme http üzerinden çalışır; CSP'deki upgrade-insecure-requests WebKit'te alt kaynakları https'e
      // yükseltip yüklemeyi bozar (canlı site zaten https). Yalnız bu yönergeyi test için kaldır.
      await ctx.route(BASE + '/**', async route => {
        const resp = await route.fetch();
        const headers = Object.assign({}, resp.headers());
        if (headers['content-security-policy']) headers['content-security-policy'] = headers['content-security-policy'].replace(/;?\s*upgrade-insecure-requests/g, '');
        await route.fulfill({ response: resp, headers });
      });
      const page = await ctx.newPage(); page.setDefaultTimeout(40000);
      for (const url of PAGES) {
        const errors = [], missing = [];
        const onC = m => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|swiftshader|inline-speculation-rules/i.test(m.text())) errors.push(m.text().slice(0, 200)); };
        const onE = e => errors.push(String(e).slice(0, 200));
        const onR = r => { if (r.status() >= 400 && r.url().startsWith(BASE)) missing.push(r.status() + ' ' + r.url().slice(BASE.length)); };
        page.on('console', onC); page.on('pageerror', onE); page.on('response', onR);
        let res = { engine: eng.id, view: v.id, url };
        try {
          await page.goto(BASE + url, { waitUntil: 'load' });
          await page.waitForTimeout(url.startsWith('/voltsim/') && url.length > 9 ? 2500 : 500);
          res = Object.assign(res, await page.evaluate(() => {
            const W = document.documentElement.clientWidth;
            const over = document.documentElement.scrollWidth - W;
            const wide = over > 1 ? Array.from(document.querySelectorAll('body *')).filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > W + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('[aria-hidden="true"]'); }).slice(0, 3).map(e => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : '')) : [];
            let tiny = 0;
            document.querySelectorAll('p, li, td, th, label, a, span, small, button').forEach(e => { if (!e.childNodes.length || !e.offsetParent) return; const t = Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 2); if (t && parseFloat(getComputedStyle(e).fontSize) < 11) tiny++; });
            const burger = document.querySelector('#vgBurger');
            const burgerVisible = !!(burger && burger.offsetParent);
            const app = window.__vsApp;
            return { overflow: over, wide, tiny, burgerVisible, webgl: app ? !!app.viewer : null, ready: app ? document.querySelector('[data-vs-module]').dataset.ready === 'true' : null };
          }));
          // mobil menü aç/kapa
          if (res.burgerVisible) {
            await page.click('#vgBurger');
            await page.waitForTimeout(350);
            res.menu = await page.evaluate(() => { const n = document.getElementById('vgNav'); const r = n.getBoundingClientRect(); return document.getElementById('vgBurger').getAttribute('aria-expanded') === 'true' && r.height > 100 && getComputedStyle(n).visibility !== 'hidden'; });
            await page.keyboard.press('Escape'); await page.waitForTimeout(200);
          }
          if (url === '/' || url === '/voltsim/pano/') await page.screenshot({ path: path.join(shotDir, eng.id + '-' + v.id + (url === '/' ? '-ana' : '-voltsim') + '.png') });
        } catch (e) { errors.push('yükleme: ' + e.message.split('\n')[0]); }
        page.off('console', onC); page.off('pageerror', onE); page.off('response', onR);
        res.errors = errors; res.missing = missing;
        rows.push(res);
        process.stdout.write(errors.length || missing.length || res.overflow > 1 || res.menu === false ? 'x' : '.');
      }
      await ctx.close();
    }
    await browser.close();
  }
  fs.writeFileSync(path.join(outDir, 'uyumluluk.json'), JSON.stringify(rows, null, 1));
  const issues = [];
  rows.forEach(r => {
    const k = r.engine + ' · ' + r.view + ' · ' + r.url;
    if (r.fatal) { issues.push('- [P0] ' + r.engine + ' — ' + r.fatal); return; }
    r.errors.forEach(e => issues.push('- [P0] ' + k + ' — hata: ' + e));
    r.missing.forEach(m => issues.push('- [P0] ' + k + ' — eksik kaynak: ' + m));
    if (r.overflow > 1) issues.push('- [P1] ' + k + ' — yatay taşma ' + r.overflow + ' px: ' + (r.wide || []).join(', '));
    if (r.menu === false) issues.push('- [P1] ' + k + ' — mobil menü açılmadı');
    if (r.webgl === false) issues.push('- [P1] ' + k + ' — 3D başlatılamadı (2D şemaya düştü)');
    if (r.tiny > 8) issues.push('- [P3] ' + k + ' — ' + r.tiny + ' öğede 11 px altı yazı');
  });
  const md = ['# Tarayıcı ve cihaz uyumluluğu', '', 'Motorlar: ' + engines.map(e => e.id).join(', ') + ' · görünümler: ' + VIEWS.map(v => v.id).join(', ') + ' · ' + PAGES.length + ' sayfa · ' + rows.length + ' çalıştırma', '', issues.length ? issues.join('\n') : 'Sorun bulunmadı.'];
  fs.writeFileSync(path.join(outDir, 'uyumluluk.md'), md.join('\n'));
  console.log('\n' + rows.length + ' çalıştırma, ' + issues.length + ' bulgu → .qa/audit/uyumluluk.md');
})().catch(e => { console.error(e); process.exitCode = 1; });
