'use strict';

// Actual WebGL regression checks: repeat rebuilds, selection disposal, offscreen
// scheduling, context restoration, framebuffer limits and WebGL-free fallback.
// node tools/tests/3d-lifecycle-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const root = path.resolve(__dirname, '../..');
const gameOnly = process.argv.includes('--game-only');
const voltsimOnly = process.argv.includes('--voltsim-only');
const skipVoltsim = gameOnly || process.argv.includes('--skip-voltsim');
const output = path.join(root, '.qa/3d-lifecycle');
fs.mkdirSync(output, { recursive: true });
function packagePath(name) {
  try { return require.resolve(name); } catch (_) {}
  for (const dir of [process.env.VG_NODE_MODULES, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean)) {
    if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  throw new Error(name + ' bulunamadı. VG_NODE_MODULES ayarlayın.');
}
const chrome = [process.env.VG_CHROME,
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe')]
  .filter(Boolean).find(f => fs.existsSync(f));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const csp = fs.readFileSync(path.join(root, '.htaccess'), 'utf8').match(/Header always set Content-Security-Policy\s+"([^"]+)"/)[1].replace(/\s*upgrade-insecure-requests/, '');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/api/auth.php') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ api: 'vg-auth/1', ok: true, user: null })); return; }
  let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': csp });
    res.end(fs.readFileSync(file));
  } catch (_) { res.writeHead(404).end(); }
});
let previous = {};
if (skipVoltsim && fs.existsSync(path.join(output, 'report.json'))) previous = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
const report = { voltsim: [], voltgame: {}, fallback: {}, ...previous, errors: [] };

(async () => {
  const { chromium } = require(packagePath('playwright'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 3, locale: 'tr-TR', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', e => report.errors.push(e.message));
    for (const slug of skipVoltsim ? [] : ['pano', 'ges', 'trafo']) {
      console.log('VoltSim lifecycle: ' + slug);
      await page.goto(base + '/voltsim/' + slug + '/');
      await page.waitForSelector('[data-vs-module][data-ready="true"]');
      await page.locator('[data-vs-stage]').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => __vsApp._visible && __vsApp.viewer.visible);
      const leak = await page.evaluate(() => {
        const a = __vsApp, v = a.viewer;
        a.paused = true;
        const rebuild = () => { a.rebuildScene(); a.recompute(); v.frame(0); };
        rebuild(); rebuild();
        const before = { ...v.renderer.info.memory };
        for (let i = 0; i < 6; i++) rebuild();
        const after = { ...v.renderer.info.memory };
        const selectionBefore = v.renderer.info.memory.geometries;
        for (let i = 0; i < 30; i++) { v.select(v.pickables[0]); v.frame(0); v.select(null); }
        v.frame(0);
        const selectionAfter = v.renderer.info.memory.geometries;
        return { before, after, selectionBefore, selectionAfter, pixels: v.canvas.width * v.canvas.height };
      });
      assert.ok(leak.after.geometries <= leak.before.geometries + 1, slug + ': geometry growth ' + JSON.stringify(leak));
      assert.ok(leak.after.textures <= leak.before.textures + 1, slug + ': texture growth ' + JSON.stringify(leak));
      assert.equal(leak.selectionAfter, leak.selectionBefore, slug + ': selection helper resources return to baseline');
      assert.ok(leak.pixels <= 2405000, 'Framebuffer respects pixel budget at DPR 3');
      const snapshot = await page.evaluate(async () => {
        const data = __vsApp.viewer.snapshot(800), image = new Image(); image.src = data; await image.decode();
        const cv = document.createElement('canvas'); cv.width = image.width; cv.height = image.height;
        const g = cv.getContext('2d'); g.drawImage(image, 0, 0); const p = g.getImageData(0, 0, cv.width, cv.height).data;
        let lit = 0; for (let i = 0; i < p.length; i += 400) if (p[i] + p[i + 1] + p[i + 2] > 90) lit++;
        return { bytes: data.length, lit };
      });
      assert.ok(snapshot.bytes > 10000 && snapshot.lit > 10, 'Snapshot remains populated without preserveDrawingBuffer');
      await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); });
      await page.waitForFunction(() => !__vsApp._visible);
      assert.equal(await page.evaluate(() => __vsApp._raf), 0, 'Offscreen app owns no pending animation frame');
      await page.locator('[data-vs-stage]').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => __vsApp._visible && __vsApp._raf > 0);
      if (slug === 'pano') {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForFunction(() => VoltSim.reduceMotion && __vsApp.kit.reducedMotion);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForFunction(() => !VoltSim.reduceMotion && !__vsApp.kit.reducedMotion);
        const supported = await page.evaluate(() => { window.__lose = __vsApp.viewer.renderer.getContext().getExtension('WEBGL_lose_context'); if (__lose) __lose.loseContext(); return !!__lose; });
        assert.ok(supported, 'Context loss extension available in QA renderer');
        await page.waitForFunction(() => __vsApp.mode === '2d' && __vsApp.viewer.contextLost);
        assert.ok(await page.evaluate(() => __vsApp.validResult.ok && !document.querySelector('[data-vs-fallback]').hidden));
        await page.waitForTimeout(150);
        await page.evaluate(() => __lose.restoreContext());
        await page.waitForFunction(() => !__vsApp.viewer.contextLost && !document.querySelector('[data-vs-act="mode"]').disabled);
        await page.click('[data-vs-act="mode"]');
        await page.waitForFunction(() => __vsApp.mode === '3d');
      }
      report.voltsim.push({ slug, ...leak, snapshot, offscreen: true, resume: true });
    }
    if (!voltsimOnly) {
      console.log('VoltGame lifecycle');
      await page.goto(base + '/voltgame.html?lvl=P1&nostorage&debug=1');
      await page.locator('#voltgameFrame').scrollIntoViewIfNeeded();
      const frame = await (await page.locator('#voltgameFrame').elementHandle()).contentFrame();
      await frame.waitForFunction(() => window.Game && Game.ready);
      await frame.waitForFunction(() => PX.main.frameStats().frames > 5);
      await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); });
      await frame.waitForFunction(() => PX.main.frameStats().suspended);
      const stopped = await frame.evaluate(() => PX.main.frameStats().frames);
      await page.waitForTimeout(350);
      assert.equal(await frame.evaluate(() => PX.main.frameStats().frames), stopped, 'Offscreen embedded game does no frame work');
      await page.locator('#voltgameFrame').scrollIntoViewIfNeeded();
      await frame.waitForFunction(n => !PX.main.frameStats().suspended && PX.main.frameStats().frames > n + 2, stopped);
      await frame.evaluate(() => { window.__lose = PX.scene.renderer.getContext().getExtension('WEBGL_lose_context'); __lose.loseContext(); });
      await frame.waitForSelector('[data-testid="startup-error"]');
      assert.ok(await frame.evaluate(() => PX.main.frameStats().suspended));
      await page.waitForTimeout(150);
      await frame.evaluate(() => __lose.restoreContext());
      await frame.waitForFunction(() => !document.querySelector('[data-testid="startup-error"]') && !PX.main.frameStats().suspended);
      report.voltgame = { offscreen: true, resume: true, contextRestoration: true, stats: await frame.evaluate(() => PX.main.frameStats()) };
    }
    await context.close();
    if (!gameOnly) {
      console.log('VoltSim WebGL-free fallback');
      const fallback = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      await fallback.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/i.test(type) ? null : get.call(this, type, ...args); }; });
      const plain = await fallback.newPage();
      await plain.goto(base + '/voltsim/pano/');
      await plain.waitForSelector('[data-vs-module][data-ready="true"]');
      report.fallback = await plain.evaluate(() => ({ mode: __vsApp.mode, ok: __vsApp.validResult.ok, visible: !document.querySelector('[data-vs-fallback]').hidden, overflow: document.documentElement.scrollWidth - innerWidth }));
      assert.deepEqual(report.fallback, { mode: '2d', ok: true, visible: true, overflow: 0 });
      const fallbackLayout = await plain.evaluate(() => {
        const notice = document.querySelector('[data-vs-fallback]').getBoundingClientRect(), diagram = document.querySelector('.vs-2dwrap').getBoundingClientRect();
        return { overlap: notice.bottom - diagram.top, diagramHeight: diagram.height, tab: document.querySelector('[data-vs-pane="stage"]').textContent };
      });
      assert.ok(fallbackLayout.overlap <= 1 && fallbackLayout.diagramHeight > 100, 'Fallback notice leaves diagram unobstructed');
      assert.equal(fallbackLayout.tab, '2D Şema');
      report.fallback.layout = fallbackLayout;
      await plain.locator('[data-vs-stage]').scrollIntoViewIfNeeded();
      await plain.screenshot({ path: path.join(output, 'fallback-mobile.png') });
      await fallback.close();
    }
    assert.deepEqual(report.errors, [], 'No unhandled browser errors');
    console.log('3D lifecycle checks passed.');
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close(); server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
