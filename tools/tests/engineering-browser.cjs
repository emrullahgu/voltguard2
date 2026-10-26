'use strict';

// Headless integration QA: run after node tools/build-engineering.cjs.
// Set VG_NODE_MODULES and VOLTGUARD_CHROME when using a different local runtime.
// --all-pdf-only downloads every tool's PDF; --pdf-tool=<slug> narrows a rerun.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.qa', 'engineering');
const catalog = require('../engineering/src/catalog.cjs');
const exportsOnly = process.argv.includes('--exports-only');
const allPdfOnly = process.argv.includes('--all-pdf-only');
const theme = (process.argv.find(a => a.startsWith('--theme=')) || '').slice(8) || null;
const reportFile = path.join(output, allPdfOnly ? 'all-pdf-report.json' : exportsOnly ? 'export-report.json' : 'browser-report.json');
const report = { reference: {}, landing: {}, documents: [], tools: [], mobile: [], exports: {}, findings: [] };
const designReferences = {};
fs.mkdirSync(output, { recursive: true });

function packagePath(name) {
  const dirs = [process.env.VG_NODE_MODULES, process.env.VOLTGUARD_NODE_MODULES,
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean);
  try { return require.resolve(name); } catch (_) {}
  for (const directory of dirs) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Package ' + name + ' is unavailable. Set VG_NODE_MODULES to the bundled Node packages directory.');
}

function chromePath() {
  const candidates = [process.env.VOLTGUARD_CHROME, process.env.VG_CHROME,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8' };
const htaccess = fs.readFileSync(path.join(root, '.htaccess'), 'utf8');
const csp = htaccess.match(/Header always set Content-Security-Policy\s+"([^"]+)"/)[1];
const server = http.createServer((request, response) => {
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname); }
  catch (_) { response.writeHead(400).end(); return; }
  // This static test server does not execute PHP. Mirror an anonymous session
  // for the shared account header only; all other missing requests still fail.
  if (pathname === '/api/auth.php' && new URL(request.url, 'http://local').searchParams.get('action') === 'me') {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ api: 'vg-auth/1', ok: true, user: null }));
    return;
  }
  if (/^\/(?:tools|voltguardekleyelim)(?:\/|$)/i.test(pathname) || /(?:^|\/)\.(?!well-known(?:\/|$))/.test(pathname)) {
    response.writeHead(403).end(); return;
  }
  // The existing practical-calculator entry is implemented as an Apache rewrite.
  if (pathname === '/hesaplama-araclari/' || pathname === '/hesaplama-araclari') pathname = '/teklif-araclari.html';
  let file = path.resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    response.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  } catch (_) { response.writeHead(404).end(); }
});

function capture(page, base) {
  const state = { errors: [], localFailures: [], csp: [], external: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /Content Security Policy|violates.*directive/i.test(message.text())) state.csp.push(message.text());
  });
  page.on('response', response => {
    if (response.url().startsWith(base + '/') && response.status() >= 400) state.localFailures.push({ url: response.url(), status: response.status() });
  });
  page.on('requestfailed', request => {
    if (request.url().startsWith(base + '/')) state.localFailures.push({ url: request.url(), failure: request.failure()?.errorText });
  });
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(base + '/')) state.external.push(request.url());
  });
  page.on('dialog', dialog => { state.errors.push('Unexpected dialog: ' + dialog.message()); dialog.dismiss(); });
  return state;
}

function existingLocalTarget(href) {
  let pathname = decodeURIComponent(new URL(href).pathname);
  if (pathname === '/hesaplama-araclari/' || pathname === '/hesaplama-araclari') pathname = '/teklif-araclari.html';
  let target = path.resolve(root, '.' + pathname);
  if (target !== root && !target.startsWith(root + path.sep)) return false;
  if (!fs.existsSync(target) && !path.extname(target)) target = target.replace(/[\\/]$/, '') + '.html';
  if (!fs.existsSync(target)) return false;
  if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  return fs.existsSync(target) && fs.statSync(target).size > 0;
}

async function download(page, action, name) {
  const pending = page.waitForEvent('download', { timeout: 90000 });
  await action();
  const result = await pending;
  const file = path.join(output, name || result.suggestedFilename());
  await result.saveAs(file);
  assert.ok(fs.statSync(file).size > 0, 'Downloaded file has content');
  return file;
}

// Compare the rendered shared site shell with a real host page. This also catches
// imported calculator rules leaking into navigation, logo or footer elements.
async function designSnapshot(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const firstFamily = value => value.split(',')[0].replace(/["']/g, '').trim();
    const style = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const computed = getComputedStyle(element);
      return { color: computed.color, background: computed.backgroundColor,
        font: firstFamily(computed.fontFamily), size: computed.fontSize,
        weight: computed.fontWeight, radius: computed.borderRadius,
        height: selector === '.vg-header__bar' ? element.getBoundingClientRect().height : undefined };
    };
    const signature = selector => {
      const original = document.querySelector(selector);
      if (!original) return null;
      const clone = original.cloneNode(true);
      for (const element of [clone, ...clone.querySelectorAll('*')]) {
        element.removeAttribute('aria-current');
        element.removeAttribute('data-vg-no-print');
        element.removeAttribute('data-vg-state');
        element.classList.remove('is-open', 'is-scrolled', 'is-inview', 'is-active');
        if (!element.className && element.hasAttribute('class')) element.removeAttribute('class');
      }
      return clone.outerHTML.replace(/\s+/g, ' ').trim();
    };
    const clippedControls = [];
    const main = document.querySelector('#vg-engineering-main,#main,main,[role=main]');
    for (const element of main?.querySelectorAll('input:not([type=hidden]),select,textarea,button') || []) {
      const box = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      if (!box.width || !box.height || computed.visibility === 'hidden') continue;
      if (box.left >= -1 && box.right <= innerWidth + 1) continue;
      let scrollable = false;
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const overflow = getComputedStyle(ancestor).overflowX;
        if (/^(?:auto|scroll)$/.test(overflow) && ancestor.scrollWidth > ancestor.clientWidth + 1) { scrollable = true; break; }
      }
      if (!scrollable) clippedControls.push({ tag: element.tagName, id: element.id,
        left: Math.round(box.left), right: Math.round(box.right) });
    }
    const title = document.querySelector('h1');
    const header = document.querySelector('.vg-header');
    const exportPanel = document.querySelector('#vg-export');
    const exportBox = exportPanel?.getBoundingClientRect();
    // Katalog/bilgi sayfaları tema yüzeyini, teknik araçlar açık kâğıt yüzeyini kullanır. Renkleri sayfanın
    // amaçlanan host tokenlarından çöz; ana sitedeki farklı bir yüzey rolünün RGB değerine zorlamayalım.
    let expectedBody = null;
    if (document.body.classList.contains('vg-engineering')) {
      const tokens = getComputedStyle(document.body), probe = document.createElement('span');
      probe.hidden = true;
      probe.style.setProperty('color', 'var(--vg-host-text)', 'important');
      probe.style.setProperty('background-color', 'var(--vg-host-bg)', 'important');
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe);
      expectedBody = { color: resolved.color, background: resolved.backgroundColor,
        textToken: tokens.getPropertyValue('--vg-host-text').trim(), bgToken: tokens.getPropertyValue('--vg-host-bg').trim() };
      probe.remove();
    }
    return { headerMarkup: signature('.vg-header'), footerMarkup: signature('.vg-footer'),
      logoMarkup: signature('.vg-header .logo-mark'),
      shell: Object.fromEntries(['.vg-header', '.vg-header__bar', '.vg-header .vg-brand',
        '.vg-header .vg-nav__link', '.vg-header .vg-cta', '.vg-footer', '.vg-footer__h',
        '.vg-footer .vg-cta', '.logo-mark__bolt'].map(selector => [selector, style(selector)])),
      body: style('body'), expectedBody, heading: style('h1'), primaryAction: style('.hero .primary,#vg-export .vg-primary'),
      fontsLoaded: ['Inter', 'Outfit'].every(family => Array.from(document.fonts).some(face => face.family.replace(/["']/g, '') === family && face.status === 'loaded')),
      viewport: innerWidth, width: document.documentElement.scrollWidth,
      h1: document.querySelectorAll('h1').length,
      titleBelowHeader: !!title && !!header && title.getBoundingClientRect().top >= header.getBoundingClientRect().bottom - 1,
      mainPresent: !!main, clippedControls,
      exportWithinViewport: !exportBox || exportBox.left >= -1 && exportBox.right <= innerWidth + 1,
      canonical: document.querySelector('link[rel=canonical]')?.href };
  });
}

async function checkReference(context, base) {
  const page = await context.newPage();
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
    await page.setViewportSize(viewport);
    await page.goto(base + '/bilgi-bankasi.html', { waitUntil: 'networkidle' });
    designReferences[name] = await designSnapshot(page);
    assert.ok(designReferences[name].fontsLoaded, 'Host reference loads both brand fonts');
    await page.screenshot({ path: path.join(output, 'reference-' + name + '.png') });
    report.reference[name] = { shell: designReferences[name].shell, body: designReferences[name].body,
      heading: designReferences[name].heading, fontsLoaded: true };
  }
  await page.close();
}

function checkDesign(state, route, mode = 'desktop') {
  const reference = designReferences[mode];
  if (state.headerMarkup !== reference.headerMarkup) {
    fs.writeFileSync(path.join(output, 'header-reference.html'), reference.headerMarkup || 'missing');
    fs.writeFileSync(path.join(output, 'header-current.html'), state.headerMarkup || 'missing');
  }
  if (state.footerMarkup !== reference.footerMarkup) {
    fs.writeFileSync(path.join(output, 'footer-reference.html'), reference.footerMarkup || 'missing');
    fs.writeFileSync(path.join(output, 'footer-current.html'), state.footerMarkup || 'missing');
  }
  assert.ok(state.headerMarkup === reference.headerMarkup, route + ' shared header markup');
  assert.ok(state.footerMarkup === reference.footerMarkup, route + ' shared footer markup');
  assert.ok(state.logoMarkup === reference.logoMarkup, route + ' shared logo markup');
  assert.deepEqual(state.shell, reference.shell, route + ' shell styles match the main site');
  assert.equal(state.body.font, reference.body.font, route + ' body font');
  assert.ok(state.expectedBody?.textToken && state.expectedBody?.bgToken, route + ' host color tokens are defined');
  for (const property of ['color', 'background']) assert.equal(state.body[property], state.expectedBody[property], route + ' body ' + property);
  assert.equal(state.heading?.font, reference.heading.font, route + ' heading font');
  assert.ok(state.fontsLoaded, route + ' brand fonts loaded');
  assert.ok(state.mainPresent && state.titleBelowHeader, route + ' main title visible below sticky header');
  assert.ok(state.width <= state.viewport + 1, route + ' horizontal page overflow: ' + state.width + ' / ' + state.viewport);
  assert.deepEqual(state.clippedControls, [], route + ' unclipped calculator controls');
  assert.ok(state.exportWithinViewport, route + ' export menu within viewport');
  if (state.primaryAction) {
    const brandAction = reference.shell['.vg-header .vg-cta'];
    assert.equal(state.primaryAction.background, brandAction.background, route + ' primary action brand color');
    assert.equal(state.primaryAction.color, brandAction.color, route + ' primary action text color');
    assert.equal(state.primaryAction.font, brandAction.font, route + ' primary action font');
  }
}

function compactDesign(state) {
  const { headerMarkup, footerMarkup, logoMarkup, ...layout } = state;
  return layout;
}

async function checkLanding(context, base) {
  const page = await context.newPage();
  const state = capture(page, base);
  const response = await page.goto(base + '/araclar/', { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  const design = await designSnapshot(page);
  await page.screenshot({ path: path.join(output, 'library-desktop.png') });
  await page.screenshot({ path: path.join(output, 'library-desktop-full.png'), fullPage: true });
  checkDesign(design, '/araclar/');
  assert.equal(await page.locator('[data-tool-card]').count(), catalog.length);
  await page.locator('#tool-search').fill('kısa devre');
  const searched = await page.locator('[data-tool-card]:visible').count();
  assert.ok(searched > 0 && searched < catalog.length, 'Search narrows the tool catalog');
  await page.locator('#tool-search').fill('');
  await page.locator('[data-filter="ges"]').click();
  assert.equal(await page.locator('[data-tool-card]:visible').count(), catalog.filter(tool => tool.category === 'ges').length);
  await page.locator('[data-filter="all"]').click();
  await page.locator('[data-favorite]').first().click();
  await page.locator('#favorite-filter').click();
  assert.equal(await page.locator('[data-tool-card]:visible').count(), 1);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('[data-favorite][aria-pressed="true"]').count(), 1, 'Favorite persists');
  report.landing = { toolCount: catalog.length, searchResults: searched, category: true, favorites: true, design: compactDesign(design), ...state };
  assert.deepEqual(state.errors, []); assert.deepEqual(state.localFailures, []); assert.deepEqual(state.csp, []);
  await page.close();
}

async function checkTool(context, base, tool) {
  const page = await context.newPage();
  const observed = capture(page, base);
  let design;
  try {
    const response = await page.goto(base + '/araclar/' + tool.slug + '/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.VoltGuardExports);
    design = await designSnapshot(page);
    await page.screenshot({ path: path.join(output, tool.slug + '-desktop.png') });
    checkDesign(design, '/araclar/' + tool.slug + '/');
    const state = await page.evaluate(() => ({ api: !!window.VoltGuardExports,
      tool: document.body.dataset.vgTool, title: document.title,
      exportButtons: document.querySelectorAll('#vg-export button[data-action]').length,
      vendorBase: document.body.dataset.vgVendorBase,
      companyPortal: /Şirket Portalı|sunucu\.tail|\/sirket\//i.test(document.body.innerText),
      localLinks: Array.from(document.querySelectorAll('a[href]')).map(anchor => new URL(anchor.getAttribute('href'), location.href).href).filter(href => href.startsWith(location.origin + '/')),
      missingLinks: Array.from(document.querySelectorAll('a[href]')).map(anchor => anchor.getAttribute('href')).filter(href => /^(?:\.\.\/)*sirket\//.test(href || '')) }));
    const missingLocalTargets = state.localLinks.filter(href => !existingLocalTarget(href));
    state.localLinkCount = state.localLinks.length;
    delete state.localLinks;
    const result = { slug: tool.slug, http: response.status(), design: compactDesign(design), ...state, ...observed };
    report.tools.push(result);
    assert.equal(result.http, 200); assert.equal(state.tool, tool.slug); assert.ok(state.exportButtons >= 6);
    assert.equal(state.companyPortal, false); assert.deepEqual(state.missingLinks, []);
    assert.deepEqual(missingLocalTargets, [], tool.slug + ' local navigation targets');
    assert.deepEqual(observed.errors, [], tool.slug + ' page errors');
    assert.deepEqual(observed.localFailures, [], tool.slug + ' local asset errors');
    assert.deepEqual(observed.csp, [], tool.slug + ' CSP errors');
  } catch (error) {
    report.findings.push({ stage: 'tool', slug: tool.slug, message: error.message });
    if (!report.tools.some(result => result.slug === tool.slug)) report.tools.push({ slug: tool.slug, design: design && compactDesign(design), ...observed, failure: error.message });
  } finally { await page.close(); }
}

async function checkDocuments(context, base) {
  for (const slug of ['yontem', 'gizlilik', 'acik-kaynak']) {
    const page = await context.newPage();
    const observed = capture(page, base);
    const route = '/araclar/' + slug + '/';
    try {
      const response = await page.goto(base + route, { waitUntil: 'networkidle' });
      const design = await designSnapshot(page);
      await page.screenshot({ path: path.join(output, slug + '-desktop.png') });
      checkDesign(design, route);
      assert.equal(response.status(), 200);
      assert.deepEqual(observed.errors, [], route + ' page errors');
      assert.deepEqual(observed.localFailures, [], route + ' local asset errors');
      assert.deepEqual(observed.csp, [], route + ' CSP errors');
      report.documents.push({ route, design: compactDesign(design), ...observed });
    } catch (error) { report.findings.push({ stage: 'document', route, message: error.message }); }
    finally { await page.close(); }
  }
}

async function checkMobile(context, base) {
  const routes = ['/araclar/', '/araclar/yontem/', '/araclar/gizlilik/', '/araclar/acik-kaynak/',
    ...catalog.map(tool => '/araclar/' + tool.slug + '/')];
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of routes) {
    await page.goto(base + route, { waitUntil: 'networkidle' });
    const state = await designSnapshot(page);
    report.mobile.push({ route, ...compactDesign(state) });
    try {
      checkDesign(state, route, 'mobile');
      assert.equal(state.h1, 1, route + ' single page heading');
      assert.equal(state.canonical, 'https://voltguard.com.tr' + route);
      if (route === '/araclar/kablo-kanal-plani/') {
        for (const tab of ['#tabAyar', '#tabCiz']) {
          await page.locator(tab).click();
          assert.ok(await page.evaluate(() => document.body.classList.contains('vg-engineering')), route + ' tab preserves site theme');
          assert.ok(await page.evaluate(() => getComputedStyle(document.body).fontFamily.startsWith('Inter')), route + ' tab preserves site font');
        }
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      }
      await checkMobileMenu(page, route);
    } catch (error) { report.findings.push({ stage: 'mobile', route, message: error.message }); }
    await page.screenshot({ path: path.join(output, (route === '/araclar/' ? 'library' : route.split('/').filter(Boolean).pop()) + '-mobile.png') });
  }
  await page.close();
}

async function checkMobileMenu(page, route) {
  const burger = page.locator('#vgBurger');
  const dropdown = page.locator('#vgHeader .vg-dd__btn[aria-controls="vgDdKaynaklar"]');
  try {
    await burger.click();
    assert.equal(await burger.getAttribute('aria-expanded'), 'true', route + ' mobile menu opens');
    await dropdown.click();
    assert.equal(await dropdown.getAttribute('aria-expanded'), 'true', route + ' resources dropdown opens');
    assert.ok(await page.locator('#vgDdKaynaklar a[href="/araclar/"]').isVisible(), route + ' engineering navigation visible');
    const menu = await page.evaluate(() => {
      const bounds = Array.from(document.querySelectorAll('#vgNav a,#vgNav button')).map(element => ({
        text: element.textContent.trim(), rect: element.getBoundingClientRect(), style: getComputedStyle(element) }));
      return { locked: document.documentElement.classList.contains('vg-lock'),
        clipped: bounds.filter(({ rect, style }) => rect.width && rect.height && style.visibility !== 'hidden' && (rect.left < -1 || rect.right > innerWidth + 1)).map(({ text }) => text) };
    });
    assert.ok(menu.locked, route + ' menu locks background scrolling');
    assert.deepEqual(menu.clipped, [], route + ' mobile navigation fits viewport');
    await page.keyboard.press('Escape');
    assert.equal(await dropdown.getAttribute('aria-expanded'), 'false', route + ' Escape closes dropdown');
    await page.keyboard.press('Escape');
    assert.equal(await burger.getAttribute('aria-expanded'), 'false', route + ' Escape closes mobile menu');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('vg-lock')), false, route + ' background scroll unlocked');
  } finally {
    await page.evaluate(() => window.VGShell?.close());
  }
}

async function checkExports(context, base) {
  const tool = catalog.find(item => /rlc/.test(item.slug)) || catalog.find(item => item.slug === 'adim-gerilimi');
  assert.ok(tool, 'Representative scalar calculator is available');
  const page = await context.newPage();
  const state = capture(page, base);
  await page.goto(base + '/araclar/' + tool.slug + '/', { waitUntil: 'networkidle' });
  await page.locator('#vg-export details').evaluate(details => { details.open = true; });
  const jsonFile = await download(page, () => page.locator('#vg-export [data-action="json"]').click(), 'project.json');
  const project = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  assert.equal(project.format, 'voltguard-project'); assert.equal(project.tool, tool.slug); assert.ok(project.fields.length);
  const validated = await page.evaluate(project => {
    const api = window.VoltGuardExports;
    api.validateProject(project);
    let rejectsWrongTool = false; try { api.validateProject({ ...project, tool: 'other' }); } catch (_) { rejectsWrongTool = true; }
    return { rejectsWrongTool };
  }, project);
  assert.equal(validated.rejectsWrongTool, true);
  // Import through the same file-input path exposed to users.
  await page.locator('#vg-export input[type=file]').setInputFiles(jsonFile);
  await page.waitForFunction(() => /Proje açıldı|Kaydedilmiş proje açıldı/.test(document.querySelector('#vg-export-status')?.textContent || ''));
  await page.locator('#vg-export details').evaluate(details => { details.open = true; });
  const pdfFile = await download(page, () => page.locator('#vg-export [data-action="pdf"]').click(), 'report.pdf');
  assert.equal(fs.readFileSync(pdfFile).subarray(0, 5).toString(), '%PDF-');
  let pdfPages;
  try { pdfPages = (await require(packagePath('pdf-lib')).PDFDocument.load(fs.readFileSync(pdfFile))).getPageCount(); assert.ok(pdfPages > 0); }
  catch (error) { if (!/Package pdf-lib is unavailable/.test(error.message)) throw error; }
  const htmlFile = await download(page, () => page.locator('#vg-export [data-action="html"]').click(), 'offline.html');
  const html = fs.readFileSync(htmlFile, 'utf8');
  assert.ok(html.includes('vg-project-data'));
  report.exports = { tool: tool.slug, json: true, import: true, pdfBytes: fs.statSync(pdfFile).size, pdfPages,
    offlineBytes: Buffer.byteLength(html), ...state };
  const offline = await context.newPage();
  const offlineErrors = [], requests = [];
  offline.on('pageerror', error => offlineErrors.push(error.message));
  await offline.route(/^https?:/, route => { requests.push(route.request().url()); route.abort(); });
  await offline.goto(require('node:url').pathToFileURL(htmlFile).href, { waitUntil: 'load' });
  await offline.waitForFunction(() => !!window.VoltGuardExports);
  assert.equal(await offline.locator('script[src]').count(), 0, 'Offline scripts are embedded');
  const restored = await offline.evaluate(() => window.VoltGuardExports.projectSnapshot());
  assert.equal(restored.tool, project.tool); assert.deepEqual(restored.fields.map(field => field.value), project.fields.map(field => field.value));
  assert.deepEqual(offlineErrors, []); assert.deepEqual(requests, []);
  report.exports.offlineRestored = true;
  await offline.close(); await page.close();

  if (catalog.some(item => item.slug === 'kabul-tutanagi')) {
    const excel = await context.newPage(); capture(excel, base);
    await excel.goto(base + '/araclar/kabul-tutanagi/', { waitUntil: 'networkidle' });
    const xlsxFile = await download(excel, () => excel.getByRole('button', { name: /Excel Olarak Kaydet/i }).click(), 'kabul.xlsx');
    assert.equal(fs.readFileSync(xlsxFile).subarray(0, 2).toString(), 'PK');
    report.exports.excelBytes = fs.statSync(xlsxFile).size;
    await excel.close();
  }
  if (catalog.some(item => item.slug === 'ag-tek-hat-semasi')) {
    const drawing = await context.newPage(); capture(drawing, base);
    await drawing.goto(base + '/araclar/ag-tek-hat-semasi/', { waitUntil: 'networkidle' });
    const dxfFile = await download(drawing, () => drawing.locator('#dlDxf').click(), 'single-line.dxf');
    const dxf = fs.readFileSync(dxfFile, 'utf8'); assert.ok(/SECTION/.test(dxf) && /EOF/.test(dxf));
    report.exports.dxfBytes = fs.statSync(dxfFile).size;
    await drawing.close();
  }
}

async function checkAllPdf(context, base) {
  const { PDFDocument } = require(packagePath('pdf-lib'));
  report.pdfs = [];
  const only = process.argv.find(a => a.startsWith('--pdf-tool='))?.slice(11);
  for (const tool of catalog.filter(tool => !only || tool.slug === only)) {
    const page = await context.newPage();
    const state = capture(page, base);
    try {
      await page.goto(base + '/araclar/' + tool.slug + '/', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !!window.VoltGuardExports);
      if (tool.slug === 'enh-sehim-hesabi') {
        // This route deliberately starts with an empty pole list. Supply a
        // synthetic, positive span through its public controls before exporting.
        await page.locator('#btnAdd').click(); await page.locator('#btnAdd').click();
        await page.locator('#tbD input[data-k="a"]').first().fill('150');
        await page.locator('#tbD input[data-k="a"]').first().dispatchEvent('change');
        await page.locator('#tbD select[data-k="tip"]').last().selectOption('TRF-D');
      }
      if (tool.slug === 'ag-aw-baginti-hesabi') await page.locator('#btnAdd').click();
      if (tool.slug === 'mesken-ges-depolama') await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script'); script.src = '/araclar/vendor/html2canvas.min.js';
          script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
        });
        const capture = window.html2canvas; window.__pdfSchematics = [];
        window.html2canvas = function (node, options) {
          const svg = node.querySelector('svg#th');
          if (svg) {
            const box = svg.getBoundingClientRect(), viewport = svg.closest('.scroll').getBoundingClientRect();
            window.__pdfSchematics.push({ width: box.width, left: box.left - viewport.left, right: box.right - viewport.right });
          }
          return capture.call(this, node, options);
        };
      });
      await page.locator('#vg-export details').evaluate(details => { details.open = true; });
      const buttons = page.locator('#vg-export [data-action="pdf"],#vg-export [data-action="pdf-active"]');
      for (let index = 0; index < await buttons.count(); index++) {
        const action = await buttons.nth(index).getAttribute('data-action');
        const pending = page.waitForEvent('download', { timeout: 90000 }).catch(() => null);
        await buttons.nth(index).click();
        await page.waitForFunction(() => {
          const box = document.querySelector('#vg-export-status');
          return box?.dataset.error === 'true' || box?.textContent.startsWith('PDF indirildi.');
        }, null, { timeout: 90000 });
        const error = await page.locator('#vg-export-status').getAttribute('data-error');
        assert.notEqual(error, 'true', tool.slug + ': ' + await page.locator('#vg-export-status').textContent());
        const result = await pending;
        assert.ok(result, tool.slug + ' actual PDF download completed');
        const file = path.join(output, tool.slug + '-' + action + '.pdf');
        await result.saveAs(file);
        const bytes = fs.readFileSync(file);
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', tool.slug + ' valid PDF');
        const pdf = await PDFDocument.load(bytes);
        assert.ok(pdf.getPageCount() > 0, tool.slug + ' PDF has pages');
        report.pdfs.push({ tool: tool.slug, action, file, bytes: bytes.length, pages: pdf.getPageCount() });
        if (tool.slug === 'mesken-ges-depolama') {
          const schematics = await page.evaluate(() => window.__pdfSchematics);
          assert.ok(schematics.length, 'Home GES PDF captures its single-line schematic');
          assert.ok(schematics.every(s => s.width > 100 && s.left >= -1 && s.right <= 1), 'Complete home GES schematic fits its report viewport');
          report.schematics = schematics;
        }
      }
      assert.deepEqual(state.errors, [], tool.slug + ' PDF page errors');
      assert.deepEqual(state.localFailures, [], tool.slug + ' PDF resource errors');
      assert.deepEqual(state.csp, [], tool.slug + ' PDF CSP errors');
      console.log('PDF checked: ' + tool.slug);
    } catch (error) {
      const status = await page.locator('#vg-export-status').textContent().catch(() => '');
      report.findings.push({ stage: 'pdf', slug: tool.slug, message: error.message, status, ...state });
      console.log('PDF failed: ' + tool.slug + ' ' + error.message + ' ' + status);
    } finally { await page.close(); }
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  }
}

(async () => {
  assert.ok(fs.existsSync(path.join(root, 'araclar/index.html')), 'Build /araclar before running browser QA');
  const { chromium } = require(packagePath('playwright'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: chromePath() });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul', acceptDownloads: true, serviceWorkers: 'block', ...(theme ? { colorScheme: theme } : {}) });
    // --theme=dark|light: site renk temasını zorlar; dışa aktarılan rapor/PDF yine açık kalmalı
    if (theme) await context.addInitScript(th => { try { localStorage.setItem('vg-theme', th); } catch (_) {} }, theme);
    if (!exportsOnly && !allPdfOnly) {
      await checkReference(context, base);
      await checkLanding(context, base);
      await checkDocuments(context, base);
      // Limit concurrency for large embedded drawing and conversion libraries.
      for (let index = 0; index < catalog.length; index += 3) {
        await Promise.all(catalog.slice(index, index + 3).map(tool => checkTool(context, base, tool)));
        console.log('Checked ' + Math.min(index + 3, catalog.length) + '/' + catalog.length + ' tool routes.');
      }
      await checkMobile(context, base);
    }
    try { if (allPdfOnly) await checkAllPdf(context, base); else await checkExports(context, base); }
    catch (error) { report.findings.push({ stage: 'exports', message: error.message }); }
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    assert.equal(report.findings.length, 0, JSON.stringify(report.findings, null, 2));
    console.log(allPdfOnly ? 'Passed: actual PDF downloads from ' + new Set(report.pdfs.map(pdf => pdf.tool)).size + ' engineering tools (' + report.pdfs.length + ' exports).' : exportsOnly ? 'Passed: JSON import/export, PDF, offline HTML, Excel and DXF exports.' : 'Passed: catalog interactions, ' + catalog.length + ' tool routes under root CSP, ' + report.mobile.length + ' mobile routes, JSON/PDF/offline HTML/Excel/DXF exports.');
  } finally {
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
