'use strict';
// VoltGrowth browser check (desktop 1280 px + phone 390 px): the three pre-assessment tools, the growth dashboard gate,
// a VoltSim page with the favourite star, the return-visit widget and the metrics beacon. Fails on console errors,
// failed same-origin requests or horizontal overflow. Uses a throw-away preview data directory.
//   node tools/tests/growth-browser.cjs        (needs Playwright: VG_NODE_MODULES, Chrome/Edge: VG_CHROME)
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const modules = process.env.VG_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(modules, 'playwright'));
const chrome = [process.env.VG_CHROME,
  path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(file => fs.existsSync(file));

const PAGES = ['/hesaplama/trafo-kapasite-artirimi/', '/hesaplama/harmonik-filtre-ihtiyaci/', '/hesaplama/fabrika-elektrik-risk-testi/',
  '/hesap/buyume-paneli.html', '/voltsim/trafo/', '/hesaplama/reaktif-ceza-hesaplama/'];

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-growth-browser-'));
  const server = spawn(process.execPath, ['tools/preview.cjs'], { cwd: root, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, LOCALAPPDATA: sandbox, VG_PREVIEW_PORT: String(port) } });
  let browser, failures = 0, checks = 0;
  const fail = msg => { failures++; console.error('FAIL ' + msg); };
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/manifest.json')).ok) break; } catch (_) { /* henüz hazır değil */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-features=Prerender2,SpeculationRulesPrefetch,SpeculationRulesPrerender'] });
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      await context.route('**/*', route => /^https?:/.test(route.request().url()) && !route.request().url().startsWith(base + '/') ? route.abort() : route.continue());
      // Headless automation sets navigator.webdriver; hide it so the metrics client behaves like a real browser here.
      await context.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
      for (const route of PAGES) {
        const page = await context.newPage();
        const errors = [], failed = [], beacons = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('requestfailed', r => { if (r.url().startsWith(base)) failed.push(r.url()); });
        page.on('request', r => { if (r.url().includes('/api/metrics.php?action=collect')) beacons.push(r.postData() || ''); });
        await page.goto(base + route, { waitUntil: 'load' });
        await page.waitForTimeout(route.startsWith('/voltsim/') ? 2500 : 800);
        if (route.startsWith('/hesaplama/')) {
          // Return-visit widget + metrics client on a real page layout (they are integrated into shared files by the lead).
          await page.evaluate(() => { const s = document.createElement('section'); s.setAttribute('data-vg-engage', ''); document.querySelector('main').prepend(s); });
          await page.addScriptTag({ url: '/js/vg-engage-data.js' });
          await page.addScriptTag({ url: '/js/vg-engage.js' });
          await page.addScriptTag({ url: '/js/vg-metrics.js' });
          const field = page.locator('.mini-calc input, .mini-calc select').first();
          await field.focus();
          if (await field.evaluate(el => el.tagName === 'SELECT')) await page.keyboard.press('ArrowDown'); else await page.keyboard.type('1');
          await page.waitForTimeout(2200);
          const cards = await page.locator('.vg-eng__card').count();
          if (cards !== 4) fail(`${route} @${width}: engage cards ${cards}`); else checks++;
          if (!beacons.some(b => b.includes('"pageview"'))) fail(`${route} @${width}: no pageview beacon`); else checks++;
          if (!beacons.some(b => b.includes('"tool_use"'))) fail(`${route} @${width}: no tool_use beacon`); else checks++;
        }
        if (route.startsWith('/voltsim/')) {
          if (!(await page.locator('.vg-fav').count())) fail(`${route} @${width}: favourite star missing`); else checks++;
        }
        if (route === '/hesap/buyume-paneli.html' && !page.url().includes('/hesap/giris.html')) fail('dashboard must require login'); else checks++;
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) fail(`${route} @${width}: horizontal overflow ${overflow}px`); else checks++;
        if (errors.length) fail(`${route} @${width}: console errors ${JSON.stringify(errors.slice(0, 3))}`); else checks++;
        if (failed.length) fail(`${route} @${width}: failed requests ${JSON.stringify(failed.slice(0, 3))}`); else checks++;
        await page.close();
      }
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise(resolve => setTimeout(resolve, 300));
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
  console.log(`Growth browser check: ${checks} checks passed, ${failures} failed.`);
  if (failures) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
