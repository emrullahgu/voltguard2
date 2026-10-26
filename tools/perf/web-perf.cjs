'use strict';
// Laboratuvar performans ölçümü (saha verisi DEĞİLDİR): soğuk önbellekle her sayfa N kez yüklenir,
// LCP / CLS / FCP / TBT, gerçek tıklama-yazma etkileşimlerinden INP vekili (Event Timing),
// aktarılan bayt (sıkıştırılmış, türe göre), istek sayısı ve 3D kütüphanesinin yüklenip yüklenmediği kaydedilir.
//
//   node tools/perf/web-perf.cjs [--profile=mobile|desktop] [--runs=5] [--pages=home,hizmet,...]
//                                [--root=klasör] [--out=dosya.json]
// --root: başka bir kopyayı (ör. `git archive <commit>` ile çıkarılmış önceki sürüm) aynı yöntemle ölçmek için.
// --compare=<klasör>: önce/sonra karşılaştırması. --root (önce) ve --compare (sonra) her tekrarda dönüşümlü ölçülür
//   (ABBA sırası): makinedeki yük iki sürümü aynı anda etkiler. Çıktıda iki özet ve tekrar başına eşleşmiş farkın medyanı vardır.
// Sunucu üretimdeki .htaccess'i taklit eder: metin türlerinde Brotli, SITE CSP başlığı; /api/* uç noktaları sahte yanıt verir.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const zlib = require('node:zlib');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const root = path.resolve(args.root || path.join(__dirname, '../..'));
const runs = Number(args.runs || 5);
const profileName = args.profile || 'mobile';
const out = args.out ? path.resolve(args.out) : null;

// Lighthouse'un "mobile" sabitleriyle aynı: Slow 4G (562,5 ms RTT, 1,6 Mbit/s indirme), 4× CPU yavaşlatma, Moto G Power ekranı.
const PROFILES = {
  mobile: { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true, cpu: 4,
    net: { latency: 562.5, downloadThroughput: 1.6 * 1024 * 1024 / 8 * 0.9, uploadThroughput: 750 * 1024 / 8 * 0.9 }, label: 'Slow 4G (562,5 ms RTT, ~1,44 Mbit/s), CPU 4×, 412×823 @1,75x' },
  desktop: { viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpu: 1,
    net: { latency: 40, downloadThroughput: 10 * 1024 * 1024 / 8, uploadThroughput: 10 * 1024 * 1024 / 8 }, label: 'Kablolu (40 ms RTT, 10 Mbit/s), CPU 1×, 1350×940 @1x' }
};
const profile = PROFILES[profileName];
if (!profile) throw new Error('Bilinmeyen profil: ' + profileName);

// Her sayfa için gerçek kullanıcı etkileşimleri (INP vekili). Bulunamayan/gizli seçici atlanır.
const PAGES = {
  home: { url: '/', interactions: [['click', '#vgBurger'], ['click', '#vgBurger'], ['click', '#emiToggle'], ['fill', '#dtHours', '96'], ['select', '#service']] },
  hizmet: { url: '/hizmetler/elektrik-projesi.html', interactions: [['click', '#vgBurger'], ['click', '#vgBurger'], ['click', 'summary']] },
  araclar: { url: '/araclar/', interactions: [['click', 'button.filter[data-filter="ges"]'], ['type', '#tool-search', 'kablo'], ['click', 'button.filter[data-filter="all"]']] },
  // Tüm sayfalardaki "Teklif Al / İletişim" bağlantısı: ana sayfanın form bölümüne derin bağlantı
  iletisim: { url: '/iletisim.html#iletisim', interactions: [['type', '#name', 'Ayse Yilmaz'], ['select', '#service'], ['type', '#message', 'Pano revizyonu icin teklif']] },
  teklif: { url: '/teklif-araclari.html', interactions: [['type', '#ges-bill', '42500'], ['click', '#trafo-tab'], ['click', '#ges-tab']] },
  voltsim: { url: '/voltsim/', interactions: [['click', '#vgBurger'], ['click', '#vgBurger']] }
};
// VoltSim modül sayfaları: --pages=vs:yangin-algilama,vs:trafo ... (etkileşim: duraklat/oynat, senaryo değiştir, sekme)
function moduleSpec(slug) {
  return { url: '/voltsim/' + slug + '/', voltsim: true,
    interactions: [['click', '[data-vs-act="pause"]'], ['click', '[data-vs-act="pause"]'], ['select', '[data-vs-scenario]'], ['click', '[data-vs-act="labels"]']] };
}
const pageKeys = String(args.pages || Object.keys(PAGES).join(',')).split(',').filter(Boolean);

function packagePath(name) {
  try { return require.resolve(name); } catch (_) {}
  for (const dir of [process.env.VG_NODE_MODULES, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean)) {
    if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  throw new Error(name + ' bulunamadı. VG_NODE_MODULES ayarlayın.');
}
const chrome = [process.env.VG_CHROME,
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(f => fs.existsSync(f));

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const compressible = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg)/;
const htaccess = fs.readFileSync(path.join(root, '.htaccess'), 'utf8');
const cspMatch = htaccess.match(/Header always set Content-Security-Policy "([^"]+)" env=VG_CSP_SITE/) || htaccess.match(/Header always set Content-Security-Policy\s+"([^"]+)"/);
const csp = cspMatch ? cspMatch[1].replace(/\s*upgrade-insecure-requests;?/, '') : '';
const brCache = new Map();
const compareRoot = args.compare ? path.resolve(args.compare) : null;
function makeServer(root) {
  return http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ api: 'vg-auth/1', ok: true, user: null, items: [] }));
    return;
  }
  let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const type = mime[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
    if (type.startsWith('text/html') && csp) headers['Content-Security-Policy'] = csp;
    let body = fs.readFileSync(file);
    if (compressible.test(type) && /\bbr\b/.test(req.headers['accept-encoding'] || '')) {
      if (!brCache.has(file)) brCache.set(file, zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }));
      body = brCache.get(file); headers['Content-Encoding'] = 'br'; headers.Vary = 'Accept-Encoding';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers); res.end(body);
  } catch (_) { res.writeHead(404).end(); }
  });
}

// Sayfaya ilk betikten önce enjekte edilir: LCP, CLS (oturum pencereli, web-vitals tanımı), uzun görevler, Event Timing.
function observe() {
  const s = window.__perf = { lcp: 0, lcpEl: '', fcp: 0, cls: 0, shifts: [], long: [], events: [] };
  const po = (type, fn, extra) => { try { new PerformanceObserver(l => l.getEntries().forEach(fn)).observe(Object.assign({ type, buffered: true }, extra)); } catch (_) {} };
  po('largest-contentful-paint', e => { s.lcp = e.startTime; const el = e.element; s.lcpEl = el ? (el.tagName + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (e.url ? ' ' + e.url.split('/').pop() : '')) : ''; });
  po('paint', e => { if (e.name === 'first-contentful-paint') s.fcp = e.startTime; });
  let win = 0, first = 0, last = 0;
  po('layout-shift', e => {
    if (e.hadRecentInput) return;
    if (win && e.startTime - last < 1000 && e.startTime - first < 5000) win += e.value; else { win = e.value; first = e.startTime; }
    last = e.startTime; s.cls = Math.max(s.cls, win);
    s.shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), src: (e.sources || []).slice(0, 2).map(x => x.node ? (x.node.nodeName + (x.node.id ? '#' + x.node.id : '') + (x.node.className && typeof x.node.className === 'string' ? '.' + x.node.className.trim().split(/\s+/)[0] : '')) : '?').join(',') });
  });
  po('longtask', e => s.long.push([e.startTime, e.duration]));
  new MutationObserver((m, mo) => { if (document.querySelector('[data-vs-module][data-ready="true"]')) { s.ready = performance.now(); mo.disconnect(); } })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ['data-ready'] });
  po('event', e => { if (e.interactionId) s.events.push({ id: e.interactionId, name: e.name, d: e.duration, input: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart }); }, { durationThreshold: 16 });
}

// Makinenin toplam CPU kullanımı (ölçüm sırasında başka işler varsa zaman ölçümlerini etkiler; rapora yazılır)
function cpuSample() { return os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { idle: 0, total: 0 }); }
const cpuBusy = (a, b) => Math.round(100 * (1 - (b.idle - a.idle) / Math.max(1, b.total - a.total)));
const kindOf = r => r.type === 'Script' ? 'js' : r.type === 'Stylesheet' ? 'css' : r.type === 'Image' ? 'img' : r.type === 'Font' ? 'font' : r.type === 'Document' ? 'html' : r.type === 'Media' ? 'media' : 'other';
const median = a => { const b = a.filter(x => x != null).sort((x, y) => x - y); if (!b.length) return null; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const round = (x, d = 0) => x == null ? null : Math.round(x * 10 ** d) / 10 ** d;

async function measure(browser, base, key) {
  const spec = key.startsWith('vs:') ? moduleSpec(key.slice(3)) : PAGES[key];
  if (!spec) throw new Error('Bilinmeyen sayfa: ' + key);
  const ctx = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, isMobile: profile.isMobile, hasTouch: profile.hasTouch, locale: 'tr-TR' });
  await ctx.addInitScript(observe);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', Object.assign({ offline: false }, profile.net));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  const reqs = new Map();
  cdp.on('Network.responseReceived', e => { reqs.set(e.requestId, { url: e.response.url, type: e.type, mime: e.response.mimeType, bytes: 0, t: e.timestamp }); });
  cdp.on('Network.loadingFinished', e => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  const t0 = Date.now();
  // load olayı gecikirse (yoğun makine, uzun video) ölçüm sürer; zaman aşımı örneğin hata listesine yazılır
  await page.goto(base + spec.url, { waitUntil: 'load', timeout: 90000 }).catch(e => errors.push('load zaman aşımı: ' + e.message.split('\n')[0]));
  const loadMs = Date.now() - t0;
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  let readyMs = null;
  if (spec.voltsim) {
    await page.waitForSelector('[data-vs-module][data-ready="true"]', { timeout: 120000 }).catch(() => {});
    readyMs = await page.evaluate(() => window.__perf.ready || null);
  }
  await page.waitForTimeout(2500);
  const pre = await page.evaluate(() => {
    const s = window.__perf, nav = performance.getEntriesByType('navigation')[0];
    const tbt = s.long.filter(([st]) => st >= s.fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
    return { lcp: s.lcp, lcpEl: s.lcpEl, fcp: s.fcp, cls: s.cls, tbt, ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd,
      heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null };
  });
  // Ana iş parçacığı işi (DevTools sayaçları, ms): duvar saati TBT'den daha az yük gürültüsüne açık
  const pm = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  pre.work = { layout: pm.LayoutDuration * 1000, style: pm.RecalcStyleDuration * 1000, script: pm.ScriptDuration * 1000, task: pm.TaskDuration * 1000, layouts: pm.LayoutCount, nodes: pm.Nodes };
  // İlk yükleme baytları: etkileşimler (kaydırma) tembel görselleri/videoları da indirir; bunlar ayrı sayılır
  const initial = { total: 0, requests: reqs.size };
  for (const r of reqs.values()) { const k = kindOf(r); initial[k] = (initial[k] || 0) + r.bytes; initial.total += r.bytes; }
  // Etkileşimler: Playwright gerçek giriş olayları üretir (pointer/mouse/click/keyboard)
  const done = [];
  for (const [kind, sel, value] of spec.interactions) {
    const loc = page.locator(sel).first();
    if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) continue;
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(300);
      if (kind === 'click') await loc.click({ timeout: 5000 });
      else if (kind === 'type') { await loc.click({ timeout: 5000 }); await loc.pressSequentially(value, { delay: 120 }); }
      else if (kind === 'fill') { await loc.focus(); for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); }
      else if (kind === 'select') { await loc.focus(); await page.keyboard.press('ArrowDown'); }
      done.push(kind + ' ' + sel);
      await page.waitForTimeout(700);
    } catch (e) { errors.push('etkileşim ' + sel + ': ' + e.message.split('\n')[0]); }
  }
  await page.waitForTimeout(800);
  const post = await page.evaluate(() => {
    const s = window.__perf, by = new Map();
    s.events.forEach(e => { const p = by.get(e.id); if (!p || e.d > p.d) by.set(e.id, e); });
    const list = [...by.values()].sort((a, b) => b.d - a.d);
    return { inp: list.length ? list[0].d : 0, worst: list.slice(0, 3).map(e => e.name + ' ' + e.d + 'ms (gecikme ' + Math.round(e.input) + ', işlem ' + Math.round(e.proc) + ')'), interactions: by.size, clsAll: s.cls, shifts: s.shifts.slice(0, 8) };
  });
  const list = [...reqs.values()];
  const bytes = { total: 0 }; list.forEach(r => { const k = kindOf(r); bytes[k] = (bytes[k] || 0) + r.bytes; bytes.total += r.bytes; });
  const three = list.filter(r => /three[^/]*\.js/.test(r.url)).map(r => r.url.split('/').pop().split('?')[0]);
  await ctx.close();
  return Object.assign(pre, post, { loadMs, readyMs, requests: list.length, bytes, initial, three, largest: list.sort((a, b) => b.bytes - a.bytes).slice(0, 6).map(r => [r.url.replace(base, '').split('?')[0], r.bytes]), errors, done });
}

(async () => {
  const { chromium } = require(packagePath('playwright'));
  const pwVersion = require(path.join(packagePath('playwright').replace(/[\\/]index\.js$/, ''), 'package.json')).version;
  const server = makeServer(root), server2 = compareRoot ? makeServer(compareRoot) : null;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  if (server2) await new Promise(r => server2.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, base2 = server2 ? 'http://127.0.0.1:' + server2.address().port : null;
  // Varsayılan: makinenin gerçek GPU'su (D3D11). --gpu=swiftshader yazılım WebGL'i seçer (GPU işi CPU'ya biner, 3D süreleri şişer).
  const gpuArgs = args.gpu === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11'];
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: gpuArgs.concat(['--ignore-gpu-blocklist', '--enable-precise-memory-info']) });
  const probe = await browser.newPage();
  const gpu = await probe.evaluate(() => { const c = document.createElement('canvas').getContext('webgl'); if (!c) return 'WebGL yok'; const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER); });
  await probe.close();
  const env = { kind: 'laboratuvar (sentetik) — saha/RUM verisi değildir', date: new Date().toISOString(), root, compare: compareRoot, order: compareRoot ? 'ABBA dönüşümlü' : 'tek sürüm', profile: profileName, profileLabel: profile.label, runs,
    browser: 'Chrome ' + browser.version() + ' headless', gpu, playwright: pwVersion, node: process.version,
    machine: os.cpus()[0].model + ' × ' + os.cpus().length + ', ' + Math.round(os.totalmem() / 1073741824) + ' GB, ' + os.type() + ' ' + os.release(),
    server: 'yerel Node statik sunucu, Brotli q5, önbellek kapalı (soğuk yükleme)' };
  console.log(env.profileLabel + ' | ' + env.browser + ' | ' + gpu + ' | Playwright ' + pwVersion + ' | ' + runs + ' tekrar');
  const result = { env, pages: {} }, after = { env, pages: {} }, paired = {};
  const summarize = (key, samples) => {
    const med = f => median(samples.map(f));
    const summary = { url: (key.startsWith('vs:') ? moduleSpec(key.slice(3)) : PAGES[key]).url,
      lcp: round(med(s => s.lcp)), fcp: round(med(s => s.fcp)), cls: round(med(s => s.clsAll), 3), clsLoad: round(med(s => s.cls), 3), inp: round(med(s => s.inp)), tbt: round(med(s => s.tbt)),
      ttfb: round(med(s => s.ttfb)), load: round(med(s => s.load)), ready3d: round(med(s => s.readyMs)), heapMB: round(med(s => s.heapMB), 1),
      work: Object.fromEntries(['layout', 'style', 'script', 'task', 'layouts', 'nodes'].map(k => [k, round(med(s => s.work[k]))])),
      requests: med(s => s.requests), kb: Object.fromEntries(Object.keys(samples[0].bytes).map(k => [k, round(med(s => s.bytes[k] || 0) / 1024, 1)])),
      requestsInitial: med(s => s.initial.requests), kbInitial: Object.fromEntries(Object.keys(samples[0].initial).filter(k => k !== 'requests').map(k => [k, round(med(s => s.initial[k] || 0) / 1024, 1)])),
      lcpRange: [round(Math.min(...samples.map(s => s.lcp))), round(Math.max(...samples.map(s => s.lcp)))],
      lcpEl: samples[0].lcpEl, three: samples[0].three, worstInp: samples.map(s => s.worst[0]).filter(Boolean), shifts: samples[0].shifts,
      largest: samples[0].largest, interactions: samples[0].done, errors: [...new Set(samples.flatMap(s => s.errors))] };
    return summary;
  };
  const line = (label, summary) => {
    console.log(label.padEnd(22), 'LCP', summary.lcp, 'ms', summary.lcpRange.join('–'), '| FCP', summary.fcp, '| CLS', summary.cls, '(yüklemede ' + summary.clsLoad + ')', '| INP~', summary.inp, 'ms | TBT', summary.tbt,
      '| 3D', summary.ready3d ?? '-', '| ilk yükleme', summary.requestsInitial, 'istek', JSON.stringify(summary.kbInitial), 'KB | etkileşim sonrası toplam', summary.kb.total, 'KB', summary.three.length ? '| three: ' + summary.three.join(',') : '', summary.errors.length ? '| HATA ' + summary.errors.join(' / ') : '');
  };
  for (const key of pageKeys) {
    const A = [], B = [], cpu = [];
    for (let i = 0; i < runs; i++) {
      const c0 = cpuSample();
      if (!base2) A.push(await measure(browser, base, key));
      else if (i % 2 === 0) { A.push(await measure(browser, base, key)); B.push(await measure(browser, base2, key)); }
      else { B.push(await measure(browser, base2, key)); A.push(await measure(browser, base, key)); }
      cpu.push(cpuBusy(c0, cpuSample()));
    }
    result.pages[key] = summarize(key, A); result.pages[key].machineCpuBusyPct = median(cpu);
    line(key + (base2 ? ' önce' : ''), result.pages[key]);
    if (base2) {
      after.pages[key] = summarize(key, B); after.pages[key].machineCpuBusyPct = median(cpu);
      line(key + ' sonra', after.pages[key]);
      const d = f => round(median(A.map((a, i) => f(B[i]) - f(a))));
      paired[key] = { layoutMs: d(s => s.work.layout), styleMs: d(s => s.work.style), taskMs: d(s => s.work.task), lcp: d(s => s.lcp), fcp: d(s => s.fcp), inp: d(s => s.inp), tbt: d(s => s.tbt), ready3d: d(s => s.readyMs || 0), clsMilli: d(s => s.clsAll * 1000), kbInitial: round(median(A.map((a, i) => (B[i].initial.total - a.initial.total) / 1024)), 1) };
      console.log(''.padEnd(22), 'eşleşmiş fark (sonra − önce, medyan):', JSON.stringify(paired[key]), '| makine CPU %' + median(cpu));
    }
  }
  await browser.close(); server.close(); if (server2) server2.close();
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (base2) {
      const stem = out.replace(/\.json$/, '');
      fs.writeFileSync(stem + '-before.json', JSON.stringify(result, null, 2)); fs.writeFileSync(stem + '-after.json', JSON.stringify(after, null, 2));
      fs.writeFileSync(stem + '-paired.json', JSON.stringify({ env, paired }, null, 2)); console.log('→ ' + stem + '-{before,after,paired}.json');
    } else { fs.writeFileSync(out, JSON.stringify(result, null, 2)); console.log('→ ' + out); }
  }
})().catch(e => { console.error(e); process.exit(1); });
