'use strict';

// Real-game QA on a fresh browser context and an ephemeral HTTP server. This
// never uses the user's browser profile, preview authentication or game saves.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.qa/voltgame');
const mode = process.argv.includes('--narrow-only') ? 'narrow' : process.argv.includes('--touch-only') ? 'touch'
  : process.argv.includes('--skip-narrow') ? 'functional' : 'browser';
const reportFile = path.join(output, mode + '-report.json');
const report = { mode, release: {}, worker: {}, campaign: [], daily: [], gameplay: {}, sharing: {},
  fullscreen: {}, layouts: [], offline: {}, errors: [], csp: [], failedAssets: [], findings: [] };
fs.mkdirSync(output, { recursive: true });

function packagePath(name) {
  try { return require.resolve(name); } catch (_) {}
  for (const dir of [process.env.VG_NODE_MODULES, process.env.VOLTGUARD_NODE_MODULES,
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean)) {
    if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  throw new Error(name + ' unavailable; set VG_NODE_MODULES to the bundled packages directory.');
}
function chromePath() {
  return [process.env.VOLTGUARD_CHROME, process.env.VG_CHROME,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe')]
    .filter(Boolean).find(file => fs.existsSync(file));
}
const csp = fs.readFileSync(path.join(root, '.htaccess'), 'utf8')
  .match(/Header always set Content-Security-Policy\s+"([^"]+)"/)[1];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((request, response) => {
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname); }
  catch (_) { response.writeHead(400).end(); return; }
  if (pathname === '/api/auth.php' && new URL(request.url, 'http://local').searchParams.get('action') === 'me') {
    response.setHeader('Content-Type', mime['.json']);
    response.end(JSON.stringify({ api: 'vg-auth/1', ok: true, user: null })); return;
  }
  if (/^\/(?:tools|VoltGame|voltguardekleyelim|vesikalar|api|calisan)(?:\/|$)/i.test(pathname)
    || /(?:^|\/)\./.test(pathname)) { response.writeHead(404).end(); return; }
  let file = path.resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    response.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  } catch (_) { response.writeHead(404).end(); }
});

function observe(page, base) {
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (/violates.*directive|Content Security Policy/i.test(message.text())) report.csp.push(message.text());
  });
  page.on('response', response => {
    if (response.url().startsWith(base + '/') && response.status() >= 400) {
      report.failedAssets.push({ url: response.url(), status: response.status() });
    }
  });
  page.on('requestfailed', request => {
    if (request.url().startsWith(base + '/') && !/ERR_ABORTED/.test(request.failure()?.errorText || '')) {
      report.failedAssets.push({ url: request.url(), error: request.failure()?.errorText });
    }
  });
}
async function gameFrame(page) {
  const element = await page.locator('#voltgameFrame').elementHandle();
  assert.ok(element, 'Native game frame exists');
  const frame = await element.contentFrame();
  assert.ok(frame, 'Game frame loaded');
  await frame.waitForFunction(() => window.Game && Game.ready, { timeout: 60000 });
  return frame;
}
async function workerReady(frame) {
  await frame.waitForFunction(() => window.PX && PX.solver && PX.solver.ready, { timeout: 60000 });
  const info = await frame.evaluate(() => PX.solver.info());
  assert.equal(info.status, 'ready', JSON.stringify(info));
  assert.ok(info.states > 0 && info.goals > 0, 'Worker produced a real solution graph');
  return info;
}
async function firstTouchTarget(frame) {
  await frame.evaluate(() => document.fonts.ready);
  await frame.waitForFunction(() => {
    const canvas = document.querySelector('#game-canvas');
    return PX.scene.w === canvas.clientWidth && PX.scene.h === canvas.clientHeight;
  });
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  let target;
  for (let rotation = 0; rotation < 4; rotation++) {
    target = await frame.evaluate(() => {
      const cell = Game.tileCell(0), point = Game.screenOfTile(cell);
      const canvas = document.querySelector('#game-canvas').getBoundingClientRect();
      return { cell, owner: Game.ownerAt(point.x, point.y).cell,
        x: point.x - canvas.left, y: point.y - canvas.top, clientX: point.x, clientY: point.y,
        canvas: { left: canvas.left, top: canvas.top, width: canvas.width, height: canvas.height } };
    });
    if (target.cell === target.owner) return target;
    await frame.locator('#btn-rot-right').tap();
    await frame.evaluate(() => Game.idle());
  }
  assert.fail('Golden touch target remains occluded in all four camera views: ' + JSON.stringify(target));
}
async function layout(page, frame, name) {
  const outer = await page.evaluate(() => {
    const button = document.querySelector('#gameFullscreen');
    const frame = document.querySelector('#voltgameFrame');
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth,
      button: { width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height },
      frame: { width: frame.getBoundingClientRect().width, height: frame.getBoundingClientRect().height } };
  });
  const inner = await frame.evaluate(() => {
    const visible = node => {
      if (!node.getBoundingClientRect().width || !node.getBoundingClientRect().height) return false;
      for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
        const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false;
      }
      return true;
    };
    const buttons = [...document.querySelectorAll('#hud-controls button,#hud-top button')].filter(visible)
      .map(node => { const r = node.getBoundingClientRect(); return { id: node.id, left: r.left,
        right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });
    const canvas = document.querySelector('#game-canvas').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth,
      canvas: { width: canvas.width, height: canvas.height }, buttons };
  });
  report.layouts.push({ name, outer, inner });
  assert.ok(outer.overflow <= 1, name + ' site fits horizontally');
  assert.ok(inner.overflow <= 1, name + ' game fits horizontally');
  assert.ok(outer.button.width >= 44 && outer.button.height >= 44, name + ' expand control touch target');
  assert.ok(inner.canvas.width > 100 && inner.canvas.height > 50, name + ' usable 3D canvas');
  assert.ok(inner.buttons.length >= 5, name + ' game controls available');
  for (const button of inner.buttons) {
    assert.ok(button.left >= -1 && button.right <= inner.width + 1, name + ' horizontal control ' + button.id);
    assert.ok(button.top >= -1 && button.bottom <= inner.height + 1, name + ' vertical control ' + button.id);
  }
}

(async () => {
  const { chromium } = require(packagePath('playwright'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: chromePath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'tr-TR',
      hasTouch: process.argv.includes('--narrow-only') || process.argv.includes('--touch-only'),
      timezoneId: 'Europe/Istanbul', reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true });
    await context.addInitScript(() => {
      window.__voltgameQA = { copied: null, violations: [] };
      addEventListener('securitypolicyviolation', event => window.__voltgameQA.violations.push(event.violatedDirective));
      // Capture the game's actual copy action without touching the system clipboard.
      Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText: text => { window.__voltgameQA.copied = String(text); return Promise.resolve(); } } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);
    observe(page, base);
    if (process.argv.includes('--narrow-only') || process.argv.includes('--touch-only')) {
      const focusedWidth = process.argv.includes('--touch-only') ? 390 : 320;
      await page.setViewportSize({ width: focusedWidth, height: 800 });
      await page.goto(base + '/voltgame.html?debug=1&nostorage=1&lvl=P1');
      const frame = await gameFrame(page);
      await layout(page, frame, focusedWidth + 'x800 embedded');
      await page.locator('#gameFullscreen').tap();
      await page.waitForFunction(() => document.fullscreenElement || document.querySelector('#gameStage').classList.contains('is-expanded'));
      await layout(page, frame, focusedWidth + 'x800 expanded');
      const target = await firstTouchTarget(frame);
      assert.equal(target.owner, target.cell);
      await frame.evaluate(() => addEventListener('pointerup', event => {
        window.__qaLastTouch = { x: event.clientX, y: event.clientY,
          owner: Game.ownerAt(event.clientX, event.clientY), target: event.target.id };
      }, { once: true, capture: true }));
      const initialHistory = await frame.evaluate(() => Game.state().hist);
      await frame.locator('#game-canvas').tap({ position: { x: target.x, y: target.y } });
      await frame.waitForFunction(previous => Game.state().hist > previous, initialHistory);
      await frame.evaluate(() => Game.idle());
      report.touchProbe = { target, actual: await frame.evaluate(() => window.__qaLastTouch),
        final: await frame.evaluate(() => Game.state()) };
      assert.equal(await frame.evaluate(() => Game.state().s.p), target.cell);
      await frame.locator('#btn-undo').tap();
      await frame.waitForFunction(previous => Game.state().hist === previous, initialHistory);
      report.touch = { canvasMove: true, undoControl: true };
      await page.locator('#gameFullscreen').tap();
      await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('#gameStage').classList.contains('is-expanded'));
      await layout(page, frame, focusedWidth + 'x800 restored');
      for (const snapshot of report.layouts) for (const button of snapshot.inner.buttons) {
        assert.ok(button.width >= 44 && button.height >= 44, 'Narrow control retains its touch target: ' + button.id);
      }
      await page.screenshot({ path: path.join(output, 'voltgame-narrow.png'), fullPage: false });
      const portable = await context.newPage();
      observe(portable, base);
      await portable.setViewportSize({ width: 320, height: 800 });
      await portable.goto(pathToFileURL(path.join(root, 'public/voltgame/downloads/voltgame-cevrimdisi.html')).href
        + '?debug=1&nostorage=1&lvl=P1');
      await portable.waitForFunction(() => window.Game && Game.ready, { timeout: 60000 });
      const controls = await portable.evaluate(() => [...document.querySelectorAll('#hud-controls button')]
        .map(button => { const r = button.getBoundingClientRect(); return { id: button.id, left: r.left,
          right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height,
          viewportWidth: innerWidth, viewportHeight: innerHeight }; }));
      assert.equal(controls.length, 7);
      for (const control of controls) {
        assert.ok(control.width >= 44 && control.height >= 44, 'Portable touch target: ' + control.id);
        assert.ok(control.left >= -1 && control.right <= control.viewportWidth + 1
          && control.top >= -1 && control.bottom <= control.viewportHeight + 1, 'Portable control fits: ' + control.id);
      }
      report.offline.narrowControls = controls;
      await portable.close();
      assert.deepEqual(report.errors, []); assert.deepEqual(report.csp, []); assert.deepEqual(report.failedAssets, []);
      console.log('Passed: ' + focusedWidth + 'px embedded/fullscreen/restored controls, all seven 44px touch targets, real canvas touch/undo and 320px offline controls.');
      return;
    }
    await page.goto(base + '/voltgame.html?debug=1&lvl=P1', { waitUntil: 'load' });
    let frame = await gameFrame(page);
    report.startup = await frame.evaluate(() => ({ url: location.href, ready: Game.ready,
      level: Game.state().levelId, modules: PX.BUILD.loadErrors || [], state: Game.state(), solver: PX.solver.info() }));
    assert.equal(await frame.evaluate(() => Game.state().levelId), 'P1', 'Parent level query reaches the game');
    report.release = await frame.evaluate(() => PX.BUILD);
    report.worker = await workerReady(frame);
    assert.ok((await page.locator('.vg-header .vg-brand').getAttribute('href')) === '/');
    // VoltGame, Teknik Kaynaklar açılır menüsünde: bağlantı geçerli sayfa olarak işaretlenmeli
    assert.equal(await page.locator('.vg-header a[href="/voltgame.html"]').first().getAttribute('aria-current'), 'page');
    await layout(page, frame, 'desktop 1440x1000');

    const completeness = await frame.evaluate(() => {
      const replay = level => { const result = PX.SIM.replay(PX.SIM.compile(level.def), level.kanit.cozum);
        return { id: level.id, won: !!(result.ok && result.won) }; };
      return { campaign: PX.LEVELS.map(replay), daily: PX.DAILY.map(replay) };
    });
    assert.equal(completeness.campaign.length, 27);
    assert.equal(completeness.daily.length, 37);
    assert.ok([...completeness.campaign, ...completeness.daily].every(level => level.won),
      'Every included campaign and daily level retains its verified solution');
    report.campaign = completeness.campaign; report.daily = completeness.daily;

    // Exercise the emitted Worker through the real game's client under site CSP.
    const hint = await frame.evaluate(() => PX.solver.hint(PX.game.state().s, 1, 'hamle'));
    assert.ok(hint && !hint.dead && !hint.miss && hint.plan.length, 'Real worker hint responds');
    const result = await frame.evaluate(plan => Game.replay(plan, { instant: true }), hint.plan.join(' '));
    assert.equal(result.ok && result.won, true, 'Worker plan is playable to victory');
    await frame.waitForFunction(() => PX.screens.current === 'win', { timeout: 30000 });
    const wonState = await frame.evaluate(() => Game.state());
    assert.equal(wonState.presentation.won, true);
    assert.equal(await frame.evaluate(() => Game.save().seviye.P1.cozuldu), true);
    await frame.locator('#btn-next').press('Control+z');
    await frame.evaluate(() => Game.idle());
    assert.equal(await frame.evaluate(() => Game.state().won), false, 'Undo exits the winning state');
    await frame.locator('#btn-redo').click();
    await frame.evaluate(() => Game.idle());
    await frame.waitForFunction(() => PX.screens.current === 'win', { timeout: 30000 });
    assert.equal(await frame.evaluate(() => Game.state().won), true, 'Redo restores the victory');
    report.gameplay = { win: true, undo: true, redo: true, workerPlan: hint.plan, total: wonState.tot };

    const challenge = await frame.evaluate(() => {
      const state = PX.game.state();
      const level = PX.game.level;
      const code = PX.ghost.code(level.id, PX.game.tokens(), state.tot);
      return { code, url: code && PX.ghost.url(code) };
    });
    // The win screen itself generates and copies the share link.
    const shareButton = frame.locator('#win-body button').filter({ hasText: 'Meydan' }).first();
    await shareButton.click();
    const copied = await frame.evaluate(() => window.__voltgameQA.copied);
    assert.ok(copied && copied.startsWith(base + '/voltgame.html#PX2-'), 'Win-screen challenge links target the site entry');
    const code = copied.slice(copied.indexOf('#') + 1);
    assert.equal(await frame.evaluate(value => PX.ghost.verify(value).ok, code), true);
    if (challenge.url) assert.ok(challenge.url.startsWith(base + '/voltgame.html'));
    report.sharing = { copied, validated: true };
    await page.reload({ waitUntil: 'load' });
    frame = await gameFrame(page);
    assert.equal(await frame.evaluate(() => Game.save().seviye.P1.cozuldu), true, 'Win persists across site reload');
    report.gameplay.persisted = true;

    await page.locator('#gameFullscreen').click();
    await page.waitForFunction(() => !!document.fullscreenElement || document.querySelector('#gameStage').classList.contains('is-expanded'));
    report.fullscreen.native = await page.evaluate(() => !!document.fullscreenElement);
    await page.waitForFunction(() => document.querySelector('#gameFullscreen').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('#gameFullscreen').getAttribute('aria-pressed'), 'true');
    await layout(page, frame, 'desktop expanded');
    await page.locator('#gameFullscreen').click();
    await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('#gameStage').classList.contains('is-expanded'));
    await page.waitForFunction(() => document.querySelector('#gameFullscreen').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.locator('#gameFullscreen').getAttribute('aria-pressed'), 'false');

    // Simulate browsers without the Fullscreen API in this isolated page only.
    await page.evaluate(() => { const stage = document.querySelector('#gameStage');
      stage.requestFullscreen = undefined; stage.webkitRequestFullscreen = undefined;
      document.querySelector('.game-intro').setAttribute('inert', ''); });
    await page.locator('#gameFullscreen').click();
    await page.waitForFunction(() => document.querySelector('#gameStage').classList.contains('is-expanded'));
    const background = await page.evaluate(() => {
      const covered = selector => !!document.querySelector(selector).closest('[inert]');
      document.querySelector('.vg-header .vg-brand').focus();
      return { header: covered('.vg-header'), help: covered('.game-help'), footer: covered('.vg-footer'),
        focusInGame: document.querySelector('#gameStage').contains(document.activeElement) };
    });
    assert.deepEqual(background, { header: true, help: true, footer: true, focusInGame: true },
      'Expanded fallback makes covered content inert and keeps focus in the game');
    await layout(page, frame, 'desktop expansion fallback');
    await frame.locator('#btn-menu').press('Escape');
    await page.waitForFunction(() => !document.querySelector('#gameStage').classList.contains('is-expanded'));
    const restored = await page.evaluate(() => ({
      header: !!document.querySelector('.vg-header').closest('[inert]'),
      help: !!document.querySelector('.game-help').closest('[inert]'),
      footer: !!document.querySelector('.vg-footer').closest('[inert]'),
      originalInert: document.querySelector('.game-intro').hasAttribute('inert'),
      focusedControl: document.activeElement.id,
    }));
    assert.deepEqual(restored, { header: false, help: false, footer: false,
      originalInert: true, focusedControl: 'gameFullscreen' }, 'Fallback exit restores original focus and inert states');
    await page.evaluate(() => document.querySelector('.game-intro').removeAttribute('inert'));
    report.fullscreen.fallback = true;
    report.fullscreen.backgroundInert = true;

    await page.goto(base + '/voltgame.html?debug=1&nostorage=1&lvl=P1#' + code, { waitUntil: 'load' });
    frame = await gameFrame(page);
    assert.equal(await frame.evaluate(() => location.hash), '#' + code, 'Challenge hash forwarded');
    await frame.locator('textarea.code').waitFor({ state: 'visible' });
    assert.equal(await frame.locator('textarea.code').inputValue(), code, 'Incoming challenge opens verified code dialog');
    assert.equal(await frame.evaluate(() => Game.storeInfo().available), false, 'Storage opt-out query forwarded');
    await page.goto(base + '/voltgame.html?debug=1&nostorage=1&daily=2026-10-13', { waitUntil: 'load' });
    frame = await gameFrame(page);
    assert.ok(await frame.evaluate(() => /^G\d+$/.test(Game.state().levelId)), 'Daily route opens a real daily level');
    report.sharing.incoming = true; report.dailyRoute = true;
    await page.goto(base + '/voltgame.html?debug=1&nostorage=1&lvl=P1&kalite=dusuk', { waitUntil: 'load' });
    frame = await gameFrame(page);
    assert.equal(await frame.evaluate(() => new URLSearchParams(location.search).get('kalite')), 'dusuk',
      'Original rendering-quality query reaches the game');
    assert.equal(await frame.evaluate(() => PX.scene.info().tier), 'dusuk', 'Renderer honors forwarded quality override');
    report.qualityRoute = true;

    const viewports = [{ width: 320, height: 800 }, { width: 390, height: 844 }, { width: 667, height: 375 }]
      .filter(viewport => !process.argv.includes('--skip-narrow') || viewport.width !== 320);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(base + '/voltgame.html?debug=1&nostorage=1&lvl=P1', { waitUntil: 'load' });
      frame = await gameFrame(page);
      await layout(page, frame, viewport.width + 'x' + viewport.height);
      await page.locator('#gameFullscreen').click();
      await page.waitForFunction(() => document.fullscreenElement || document.querySelector('#gameStage').classList.contains('is-expanded'));
      await layout(page, frame, viewport.width + 'x' + viewport.height + ' expanded');
      await page.locator('#gameFullscreen').click();
      await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('#gameStage').classList.contains('is-expanded'));
    }

    // Touch events originate in the embedded canvas, with coordinates measured
    // in its own document; no controller commands are substituted for the tap.
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
      locale: 'tr-TR', timezoneId: 'Europe/Istanbul', reducedMotion: 'reduce', serviceWorkers: 'block' });
    try {
      const touchPage = await touchContext.newPage();
      touchPage.setDefaultTimeout(30000);
      observe(touchPage, base);
      await touchPage.goto(base + '/voltgame.html?debug=1&nostorage=1&lvl=P1');
      const touchFrame = await gameFrame(touchPage);
      await touchPage.locator('#gameFullscreen').tap();
      await touchPage.waitForFunction(() => document.fullscreenElement || document.querySelector('#gameStage').classList.contains('is-expanded'));
      const target = await firstTouchTarget(touchFrame);
      assert.equal(target.owner, target.cell, 'Golden first target can be selected on the touch canvas');
      const initialHistory = await touchFrame.evaluate(() => Game.state().hist);
      await touchFrame.locator('#game-canvas').tap({ position: { x: target.x, y: target.y } });
      await touchFrame.waitForFunction(previous => Game.state().hist > previous, initialHistory);
      await touchFrame.evaluate(() => Game.idle());
      assert.equal(await touchFrame.evaluate(() => Game.state().s.p), target.cell, 'Canvas touch moves Volti');
      await touchFrame.locator('#btn-undo').tap();
      await touchFrame.waitForFunction(previous => Game.state().hist === previous, initialHistory);
      report.touch = { canvasMove: true, undoControl: true };
    } finally { await touchContext.close(); }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + '/voltgame.html?debug=1&lvl=P1', { waitUntil: 'load' });
    frame = await gameFrame(page);
    await page.screenshot({ path: path.join(output, 'voltgame-desktop.png'), fullPage: false });
    const pendingDownload = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('a[href*="voltgame-cevrimdisi.html"]').click();
    const download = await pendingDownload;
    const portableFile = path.join(output, 'voltgame-cevrimdisi.html');
    await download.saveAs(portableFile);
    assert.ok(fs.statSync(portableFile).size > 1000000, 'Complete standalone game downloaded');
    const portablePage = await context.newPage();
    observe(portablePage, base);
    await portablePage.goto(pathToFileURL(portableFile).href + '?debug=1&nostorage=1&lvl=P1');
    await portablePage.waitForFunction(() => window.Game && Game.ready, { timeout: 60000 });
    await workerReady(portablePage);
    const portableResult = await portablePage.evaluate(() => Game.replay(Game.level('P1').kanit.cozum, { instant: true }));
    assert.equal(portableResult.ok && portableResult.won, true, 'Downloaded file plays and solves without hosting');
    assert.equal(await portablePage.evaluate(() => PX.LEVELS.length), 27);
    assert.equal(await portablePage.evaluate(() => PX.DAILY.length), 37);
    report.offline = { bytes: fs.statSync(portableFile).size, campaign: 27, daily: 37, worker: true, victory: true };
    await portablePage.close();
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.csp, []);
    assert.deepEqual(report.failedAssets, []);
    assert.deepEqual(await frame.evaluate(() => window.__voltgameQA.violations), []);
    console.log('Passed: complete 27-level/37-daily game, CSP Worker and hint, victory/undo/redo/save, canonical challenges, responsive/fullscreen fallback and offline download.');
  } finally {
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  report.findings.push(error.stack || error.message);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.error(error); process.exitCode = 1; server.close();
});
