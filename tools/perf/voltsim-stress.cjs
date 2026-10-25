'use strict';
// VoltSim bellek ve kararlılık testi (aynı tarayıcı oturumu, aynı sekme):
//  A) Tüm simülasyonlar art arda açılıp kapatılır (2 tur): her sayfadan sonra JS heap (GC sonrası), canlı belge sayısı,
//     olay dinleyicisi sayısı, GPU kaynakları ve hata kaydı. Belge/heap birikimi = sızıntı.
//  B) En ağır sahnede 30 döngü: senaryo değiştir, kaliteyi değiştir (görüntüleyici yeniden kurulur), 2D/3D, patlatma.
//     Her döngüde geometri/doku/program sayısı, window+document dinleyicileri ve bekleyen requestAnimationFrame sayısı.
//  C) Görünmezken iş: sahne ekran dışına kaydırılınca ve sekme gizlenince saniyedeki render ve rAF sayısı.
//  D) WebGL bağlam kaybı: 2D şemaya açıklamalı geçiş ve geri dönüş.
//   node tools/perf/voltsim-stress.cjs [--root=klasör] [--heavy=yangin-algilama] [--cycles=30] [--skip-cross] [--out=dosya.json]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const root = path.resolve(args.root || path.join(__dirname, '../..'));
const heavy = args.heavy || 'yangin-algilama';
const cycles = Number(args.cycles || 30);
function packagePath(name) {
  try { return require.resolve(name); } catch (_) {}
  for (const dir of [process.env.VG_NODE_MODULES, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean)) {
    if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  throw new Error(name + ' bulunamadı. VG_NODE_MODULES ayarlayın.');
}
const chrome = [process.env.VG_CHROME, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe')].filter(Boolean).find(f => fs.existsSync(f));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"user":null}'); return; }
  let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file)); }
  catch (_) { res.writeHead(404).end(); }
});
const slugs = fs.readdirSync(path.join(root, 'voltsim'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

// window/document dinleyicileri ve bekleyen rAF sayacı (sayfa betiklerinden önce)
function instrument() {
  const net = { win: 0, doc: 0 }, raf = new Set();
  let fired = 0;
  const wrap = (target, key) => {
    const add = target.addEventListener, rem = target.removeEventListener, seen = new WeakMap();
    target.addEventListener = function (t, fn, o) { if (fn) { const k = t + '|' + (typeof o === 'boolean' ? o : !!(o && o.capture)); let s = seen.get(fn); if (!s) seen.set(fn, s = new Set()); if (!s.has(k)) { s.add(k); net[key]++; } } return add.call(this, t, fn, o); };
    target.removeEventListener = function (t, fn, o) { if (fn) { const k = t + '|' + (typeof o === 'boolean' ? o : !!(o && o.capture)); const s = seen.get(fn); if (s && s.delete(k)) net[key]--; } return rem.call(this, t, fn, o); };
  };
  wrap(window, 'win'); wrap(document, 'doc');
  const rq = window.requestAnimationFrame.bind(window), cc = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = fn => { const id = rq(t => { raf.delete(id); fired++; fn(t); }); raf.add(id); return id; };
  window.cancelAnimationFrame = id => { raf.delete(id); cc(id); };
  window.__stress = { net, pending: () => raf.size, fired: () => fired };
}

(async () => {
  const { chromium } = require(packagePath('playwright'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(instrument);
  await ctx.addInitScript(() => { try { localStorage.clear(); } catch (_) {} });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const gc = async () => { await page.evaluate(() => { window.gc && window.gc(); }); await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); };
  const snap = async () => {
    await gc(); await page.waitForTimeout(150); await gc();
    const m = await metrics();
    const inPage = await page.evaluate(() => {
      const a = window.__vsApp, v = a && a.viewer, r = v && v.renderer;
      return { heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(2), geo: r ? r.info.memory.geometries : null, tex: r ? r.info.memory.textures : null,
        programs: r && r.info.programs ? r.info.programs.length : null, win: __stress.net.win, doc: __stress.net.doc, raf: __stress.pending(), quality: v ? v.quality : null, mode: a && a.mode };
    });
    return Object.assign(inPage, { documents: m.Documents, nodes: m.Nodes, listeners: m.JSEventListeners });
  };
  const report = { env: { date: new Date().toISOString(), browser: 'Chrome ' + browser.version() + ' headless (D3D11)', root, heavy, cycles }, crossPage: [], inPage: [], offscreen: {}, contextLoss: {}, errors };

  // A) sayfalar arası
  console.log('A) ' + slugs.length + ' simülasyon × 2 tur, aynı sekmede');
  for (let round = 1; round <= (args['skip-cross'] ? 0 : 2); round++) {
    for (const slug of slugs) {
      await page.goto(base + '/voltsim/' + slug + '/', { waitUntil: 'load' });
      await page.waitForSelector('[data-vs-module][data-ready="true"]', { timeout: 60000 });
      await page.click('[data-vs-act="start"]').catch(() => {});
      await page.evaluate(() => { const s = document.querySelector('[data-vs-scenario]'); if (s && s.options.length > 1) { s.value = s.options[1].value; s.dispatchEvent(new Event('change')); } });
      await page.waitForTimeout(900);
      const s = await snap();
      report.crossPage.push(Object.assign({ round, slug }, s));
      console.log(('  ' + round + ' ' + slug).padEnd(24), 'heap', s.heapMB, 'MB | belge', s.documents, '| dinleyici', s.listeners, '| geo', s.geo, 'tex', s.tex, 'prog', s.programs, '| bekleyen rAF', s.raf);
    }
  }
  // sayfadan çıkışta temizlik: about:blank'a geçip belge sayısı
  await page.goto('about:blank'); await gc(); report.afterLeave = await metrics().then(m => ({ documents: m.Documents, listeners: m.JSEventListeners, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2) }));
  console.log('  about:blank sonrası', JSON.stringify(report.afterLeave));

  // B) sayfa içi döngü
  console.log('B) ' + heavy + ': ' + cycles + ' döngü (senaryo, kalite, 2D/3D, patlatma)');
  await page.goto(base + '/voltsim/' + heavy + '/', { waitUntil: 'load' });
  await page.waitForSelector('[data-vs-module][data-ready="true"]', { timeout: 60000 });
  await page.waitForTimeout(1000);
  const hasQuality = await page.evaluate(() => !!document.querySelector('[data-vs-quality]'));
  const t0 = Date.now();
  for (let i = 0; i <= cycles; i++) {
    if (i > 0) {
      await page.evaluate(i => { const s = document.querySelector('[data-vs-scenario]'); const o = s.options[1 + (i % (s.options.length - 1))]; s.value = o.value; s.dispatchEvent(new Event('change')); }, i);
      await page.waitForTimeout(250);
      if (hasQuality) { await page.selectOption('[data-vs-quality]', ['high', 'low', 'auto'][i % 3]); await page.waitForSelector('[data-vs-module][data-ready="true"]'); await page.waitForTimeout(250); }
      await page.click('[data-vs-act="mode"]'); await page.waitForTimeout(150); await page.click('[data-vs-act="mode"]');
      await page.click('[data-vs-act="explode"]'); await page.waitForTimeout(600); await page.click('[data-vs-act="explode"]');
      await page.waitForTimeout(700);
    }
    if (i === 0 || i === 1 || i % 5 === 0) {
      const s = await snap(); report.inPage.push(Object.assign({ cycle: i }, s));
      console.log(('  döngü ' + i).padEnd(12), 'heap', s.heapMB, 'MB | geo', s.geo, 'tex', s.tex, 'prog', s.programs, '| win/doc dinleyici', s.win + '/' + s.doc, '| tüm dinleyici', s.listeners, '| DOM', s.nodes, '| bekleyen rAF', s.raf, '|', s.quality, s.mode);
    }
  }
  report.inPageSeconds = Math.round((Date.now() - t0) / 1000);

  // C) görünmezken: ekran dışı ve gizli sekme
  const rate = async ms => { const a = await page.evaluate(() => ({ f: __stress.fired(), r: __rend || 0 })); await page.waitForTimeout(ms); const b = await page.evaluate(() => ({ f: __stress.fired(), r: __rend || 0 })); return { rafPerSec: +((b.f - a.f) / (ms / 1000)).toFixed(1), rendersPerSec: +((b.r - a.r) / (ms / 1000)).toFixed(1) }; };
  await page.evaluate(() => { window.__rend = 0; const r = __vsApp.viewer.renderer, o = r.render.bind(r); r.render = (s, c) => { window.__rend++; return o(s, c); }; });
  await page.click('[data-vs-act="start"]'); await page.evaluate(() => document.querySelector('.vs-app').scrollIntoView()); await page.waitForTimeout(800);
  report.offscreen.visibleRunning = await rate(2000);
  await page.evaluate(() => document.querySelector('#mevzuat').scrollIntoView()); await page.waitForTimeout(800);
  report.offscreen.scrolledAway = await rate(2000);
  await page.evaluate(() => document.querySelector('.vs-app').scrollIntoView()); await page.waitForTimeout(500);
  // gizli sekme: başsız Chrome'da sekmeler hep "visible" kalır; belge gizli gösterilip visibilitychange gönderilir
  // (uygulamanın gerçek tarayıcıda aldığı olayla aynı yol)
  const setHidden = h => page.evaluate(h => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, h);
  await setHidden(true); await page.waitForTimeout(300);
  report.offscreen.hiddenTab = Object.assign({ visibilityState: await page.evaluate(() => document.visibilityState) }, await rate(2000));
  await setHidden(false); await page.waitForTimeout(500);
  report.offscreen.backVisible = await rate(1500);
  console.log('C) saniyede rAF/render:', JSON.stringify(report.offscreen));

  // D) bağlam kaybı
  const lost = await page.evaluate(async () => {
    const ext = __vsApp.viewer.renderer.getContext().getExtension('WEBGL_lose_context'); if (!ext) return { supported: false };
    ext.loseContext(); await new Promise(r => setTimeout(r, 400));
    const fb = document.querySelector('[data-vs-fallback]');
    const during = { mode: __vsApp.mode, fallbackShown: !fb.hidden, message: fb.textContent.trim(), analysisOk: !!__vsApp.validResult };
    ext.restoreContext(); await new Promise(r => setTimeout(r, 900));
    return { supported: true, during, after: { mode: __vsApp.mode, contextLost: __vsApp.viewer.contextLost, fallbackHidden: fb.hidden } };
  });
  report.contextLoss = lost;
  console.log('D) bağlam kaybı:', JSON.stringify(lost));
  const s = await snap(); report.final = s;

  await browser.close(); server.close();
  const first = report.crossPage.filter(r => r.round === 1), second = report.crossPage.filter(r => r.round === 2);
  const med = a => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  report.summary = {
    crossPageHeapRound1MB: med(first.map(r => r.heapMB)), crossPageHeapRound2MB: med(second.map(r => r.heapMB)),
    maxDocuments: report.crossPage.length ? Math.max(...report.crossPage.map(r => r.documents)) : null,
    inPageHeapMB: [report.inPage[1] && report.inPage[1].heapMB, report.inPage[report.inPage.length - 1].heapMB],
    inPageGeo: [report.inPage[1] && report.inPage[1].geo, report.inPage[report.inPage.length - 1].geo],
    inPageListeners: [report.inPage[1] && report.inPage[1].listeners, report.inPage[report.inPage.length - 1].listeners],
    errors: errors.length
  };
  console.log('ÖZET', JSON.stringify(report.summary));
  if (errors.length) console.log('HATALAR:\n  ' + [...new Set(errors)].slice(0, 20).join('\n  '));
  if (args.out) { fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true }); fs.writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 2)); console.log('→ ' + args.out); }
})().catch(e => { console.error(e); process.exit(1); });
