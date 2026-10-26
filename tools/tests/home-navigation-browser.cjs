'use strict';
// Actual public pages on an isolated localhost static server. No PHP executes,
// accounts remain anonymous, external requests are blocked, and no form is sent.
// Run after the shared shell/content build is ready:
//   node tools/tests/home-navigation-browser.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.qa/home-cleanup');
const modules = process.env.VG_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium} = require(path.join(modules, 'playwright'));
const chrome = [process.env.VG_CHROME, process.env.VOLTGUARD_CHROME,
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe')]
  .filter(Boolean).find(fs.existsSync);
const routes = ['/', '/hakkimizda.html', '/projeler.html', '/haberler.html', '/iletisim.html', '/teknik-kaynaklar.html'];
const report = {isolated: true, checks: 0, baselines: [], layouts: [], workflows: [], findings: [],
  pageErrors: [], consoleErrors: [], missingResources: [], externalBlocked: [], rejectedWrites: [], metricsStubbed: 0};
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.pdf': 'application/pdf'};
const existingNote = 'QA: Kullanıcının daha önce yazdığı pano arızası açıklaması korunmalı.';
const genericPrompt = 'Tesisimiz için teklif ön değerlendirme talep ediyoruz; açıklamamızı ekleyeceğiz.';
const publicNews = JSON.parse(fs.readFileSync(path.join(root, 'tools/data/home-directory-volthaber.json'), 'utf8')).entries;
const publicNewsPaths = new Set(publicNews.map(entry => entry.u));
const checked = (condition, message) => {report.checks++; assert.ok(condition, message);};
const json = (res, value) => {res.writeHead(200, {'Content-Type': mime['.json'], 'Cache-Control': 'no-store'}); res.end(JSON.stringify(value));};

function fileFor(urlPath) {
  // Public PHP article routes use their static shell in this frontend fixture.
  // Publication coverage is checked independently against the saved public list.
  if (publicNewsPaths.has(urlPath)) return path.join(root, 'volthaber/index.html');
  let rel;
  try {rel = decodeURIComponent(urlPath).replace(/^\//, '');} catch (_) {return null;}
  if (rel.split('/').some(part => part.startsWith('.') || part === 'tools' || part === 'api') || rel.includes('\\')) return null;
  if (rel === 'hesaplama-araclari/') rel = 'teklif-araclari.html';
  const candidates = !rel ? ['index.html'] : rel.endsWith('/')
    ? [rel.slice(0, -1) + '.html', rel + 'index.html', rel + 'index.php'] : [rel];
  return candidates.map(name => path.resolve(root, name)).find(file => file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) || null;
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/api/metrics.php') {report.metricsStubbed++; return json(res, {ok: true});}
    if (url.pathname === '/api/volthaber.php' && req.method === 'GET' && url.searchParams.get('action') === 'list') {
      const page=Number(url.searchParams.get('page')||1), pages=Math.max(1,Math.ceil(publicNews.length/12));
      return json(res,{ok:true,service:'vg-volthaber/1',page,pages,total:publicNews.length,
        items:publicNews.slice((page-1)*12,page*12).map(entry=>({url:entry.u,title:entry.t,summary:''}))});
    }
    if (url.pathname === '/api/auth.php' && req.method === 'GET' && url.searchParams.get('action') === 'me') {
      return json(res, {api: 'vg-auth/1', ok: true, user: null, csrf: 'a'.repeat(64)});
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      report.rejectedWrites.push({method: req.method, path: url.pathname}); res.writeHead(405); return res.end('Fixture refuses writes.');
    }
    if (url.pathname === '/__qa-home-before.html') {
      const html = fs.readFileSync(path.join(output, 'index-before.html'), 'utf8')
        .replace(/(?:\/?css\/home\.css)(?:\?v=[^"']*)?/, '/__qa-home-before.css');
      res.writeHead(200, {'Content-Type': mime['.html'], 'Cache-Control': 'no-store'}); return res.end(html);
    }
    if (url.pathname === '/__qa-home-before.css') {
      res.writeHead(200, {'Content-Type': mime['.css'], 'Cache-Control': 'no-store'});
      return res.end(fs.readFileSync(path.join(output, 'home-before.css')));
    }
    const file = fileFor(url.pathname), type = file && mime[path.extname(file).toLowerCase()];
    if (!file || !type || /\.php$/i.test(file)) {res.writeHead(404); return res.end('Not found');}
    if (url.pathname === '/iletisim.html' && url.searchParams.has('__qa_existing')) {
      // Model a browser-restored user draft before deferred main.js initializes.
      // Production source is served unchanged for every normal visit.
      const seed = '<script>document.getElementById("message").value=' + JSON.stringify(existingNote) + ';document.getElementById("subject").value="mekanik";</script>';
      res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'});
      return res.end(fs.readFileSync(file, 'utf8').replace('</main>', seed + '</main>'));
    }
    const size = fs.statSync(file).size;
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]), end = Math.min(size - 1, range[2] ? Number(range[2]) : start + 2 * 1024 * 1024 - 1);
      if (start >= size || end < start) {res.writeHead(416, {'Content-Range': 'bytes */' + size}); return res.end();}
      res.writeHead(206, {'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1});
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(file, {start, end}).pipe(res);
    }
    res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': size});
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  } catch (_) {if (!res.headersSent) res.writeHead(500); res.end('Static fixture error.');}
});

function watch(page, label, baseline = false) {
  page.on('pageerror', error => {if (!baseline) report.pageErrors.push({label, error: error.message});});
  page.on('console', message => {
    if (!baseline && message.type() === 'error' && !/net::ERR_(?:FAILED|ABORTED|BLOCKED_BY_CLIENT)/.test(message.text())) {
      report.consoleErrors.push({label, error: message.text()});
    }
  });
  page.on('response', response => {
    if (!baseline && response.url().startsWith(base + '/') && response.status() >= 400) {
      report.missingResources.push({label, path: new URL(response.url()).pathname, status: response.status()});
    }
  });
  page.on('dialog', dialog => {report.findings.push({label, error: 'Unexpected dialog: ' + dialog.message()}); dialog.dismiss().catch(() => {});});
}

let base;
async function contextFor(browser, width, theme) {
  const context = await browser.newContext({viewport: {width, height: 900}, locale: 'tr-TR', timezoneId: 'Europe/Istanbul',
    colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await context.addInitScript(theme => {try {localStorage.setItem('vg-theme', theme);} catch (_) {}}, theme);
  await context.route('**/*', route => {
    const request = route.request(), url = request.url();
    if (/^https?:/.test(url) && !url.startsWith(base + '/')) {
      report.externalBlocked.push(new URL(url).origin); return route.abort();
    }
    if (url.startsWith(base + '/') && !['GET', 'HEAD'].includes(request.method()) && new URL(url).pathname !== '/api/metrics.php') {
      report.rejectedWrites.push({method: request.method(), path: new URL(url).pathname}); return route.abort();
    }
    return route.continue();
  });
  return context;
}

async function loaded(page, url) {
  const response = await page.goto(base + url, {waitUntil: 'load', timeout: 20000});
  checked(response && response.status() === 200, 'Local page loads: ' + url);
  await page.evaluate(() => document.fonts.ready);
}

async function revealAll(page) {
  // Traverse the real document so intersection-based reveals and lazy images get
  // their normal browser events. Count all laid-out text, including below fold.
  await page.evaluate(async () => {
    const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(400, innerHeight * 0.85)) {scrollTo(0, y); await tick();}
    scrollTo(0, 0); await tick();
  });
  await page.waitForTimeout(120);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return {missingMain: true};
    const visible = element => {
      if (!element || !element.getClientRects().length || element.closest('[hidden],[aria-hidden="true"],script,style,noscript')) return false;
      for (let parent = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        // Native closed <details> content can retain layout rectangles in Chromium
        // even though it is not painted. Only its direct summary is visible.
        if (parent.tagName === 'DETAILS' && !parent.open) {
          const summary=parent.querySelector(':scope > summary');
          if (!summary || !summary.contains(element)) return false;
        }
      }
      return true;
    };
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let node, text = '';
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim() || !visible(node.parentElement)) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      if ([...range.getClientRects()].some(rect => rect.width && rect.height)) text += ' ' + node.textContent;
    }
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    return {words: text.trim().split(/\s+/).filter(Boolean).length, height: Math.ceil(main.getBoundingClientRect().height),
      sections: main.querySelectorAll(':scope > section').length, forbidden: [...document.querySelectorAll('#contactForm,video,#emiScope,#newsGrid')].map(element => element.id || element.tagName),
      h1: [...document.querySelectorAll('h1')].filter(visible).map(element => element.textContent.trim()),
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), theme: document.documentElement.getAttribute('data-theme'),
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
      links: [...new Set([...document.querySelectorAll('a[href]')].map(element => element.href))],
      wide: [...main.querySelectorAll('*')].filter(element => {
        const rect = element.getBoundingClientRect(); return visible(element) && (rect.right > innerWidth + 1 || rect.left < -1);
      }).slice(0, 6).map(element => ({tag: element.tagName, id: element.id, className: String(element.className).slice(0, 120)}))};
  });
}

const fragmentCache = new Map();
function missingTargets(links) {
  const missing = [];
  for (const href of links) {
    let url;
    try {url = new URL(href);} catch (_) {continue;}
    if (url.origin !== base) continue;
    const file = fileFor(url.pathname);
    if (!file) {missing.push(href.replace(base, '')); continue;}
    if (!url.hash || !file.endsWith('.html')) continue;
    if (!fragmentCache.has(file)) {
      const html = fs.readFileSync(file, 'utf8');
      fragmentCache.set(file, new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(match => match[1])));
    }
    let fragment;
    try {fragment = decodeURIComponent(url.hash.slice(1));} catch (_) {fragment = url.hash.slice(1);}
    if (!fragmentCache.get(file).has(fragment)) missing.push(href.replace(base, ''));
  }
  return missing;
}

async function scenario(name, run) {
  const item = {name, ok: false}; report.workflows.push(item);
  try {await run(item); item.ok = true;} catch (error) {item.error = error.stack; report.findings.push({name, error: error.message});}
  console.log(JSON.stringify({workflow: name, ok: item.ok, error: item.error && item.error.split('\n')[0]}));
}

async function withPage(browser, width, run) {
  const context = await contextFor(browser, width, 'light');
  const page = await context.newPage(); watch(page, 'workflow-' + width);
  try {await run(page);} finally {await context.close();}
}

async function workflows(browser) {
  for (const width of [390, 1440]) await scenario('real-menu-' + width, async () => withPage(browser, width, async page => {
    await loaded(page, '/');
    if (width < 1280) {await page.locator('#vgBurger').click(); checked(await page.locator('#vgBurger').getAttribute('aria-expanded') === 'true', 'Mobile navigation opens');}
    const corporate = page.locator('#vgHeader button[aria-controls="vgDdKurumsal"]');
    await corporate.click(); checked(await corporate.getAttribute('aria-expanded') === 'true', 'Corporate submenu opens');
    await Promise.all([page.waitForURL(base + '/projeler.html'), page.locator('#vgDdKurumsal a[href="/projeler.html"]').click()]);
    checked(/projeler/i.test(await page.locator('h1').innerText()), 'Actual project menu link opens project content');
    if (width < 1280) await page.locator('#vgBurger').click();
    const resources = page.locator('#vgHeader .vg-nav__list > li > a[href="/teknik-kaynaklar.html"]');
    checked(await resources.count() === 1, 'Technical resources has one direct main-menu link');
    await Promise.all([page.waitForURL(base + '/teknik-kaynaklar.html'), resources.click()]);
    checked(await page.locator('#emiScope').count() === 1, 'Resource link reaches the moved technical content');
  }));

  await scenario('legacy-service-and-section-links', async () => withPage(browser, 390, async page => {
    await loaded(page, '/?hizmet=trafo-bakimi#iletisim');
    await page.waitForURL(base + '/iletisim.html?hizmet=trafo-bakimi#iletisim');
    checked(await page.inputValue('#service') === 'trafo-bakimi', 'Legacy query preserves the actual service selection');
    checked(await page.inputValue('#subject') === 'elektrik', 'Legacy service fills the related subject');
    await loaded(page, '/#haberler'); await page.waitForURL(url => url.pathname === '/haberler.html');
    checked(await page.locator('#newsGrid').count() === 1, 'Old news link reaches real moved news');
    await loaded(page, '/#emi-demo'); await page.waitForURL(base + '/teknik-kaynaklar.html#emi-demo');
    checked(await page.locator('#emiScope').count() === 1, 'Old EMI link reaches the actual demo');
  }));

  await scenario('downtime-result-cross-page-draft', async () => withPage(browser, 390, async page => {
    await loaded(page, '/teknik-kaynaklar.html#durus-maliyeti');
    await page.locator('#downtimeCalc').waitFor();
    await page.evaluate(() => {
      for (const [id, value] of [['dtHours', '120'], ['dtRate', '75000']]) {
        const field = document.getElementById(id); field.value = value; field.dispatchEvent(new Event('input', {bubbles: true}));
      }
    });
    await page.waitForFunction(() => /9\.000\.000/.test(document.getElementById('dtTotal').textContent));
    const expected = await page.locator('#dtQuote').getAttribute('data-prefill');
    checked(expected.includes('120 saat') && expected.includes('75.000 TL') && expected.includes('9.000.000 TL'), 'Quote summary uses the changed calculator result');
    await Promise.all([page.waitForURL(base + '/iletisim.html#iletisim'), page.locator('#dtQuote').click()]);
    checked(await page.inputValue('#message') === expected, 'Complete calculation summary survives real cross-page navigation');
    checked(await page.inputValue('#subject') === 'elektrik', 'Cross-page calculation preserves the electrical subject');
    checked(await page.locator('#message').getAttribute('data-prefill-complete') === '1', 'Complete summary retains its completion status');
    checked(await page.evaluate(() => sessionStorage.getItem('vgContactDraft')) === null, 'Contact draft is consumed once');
    await loaded(page, '/iletisim.html?__qa_once=2');
    checked(await page.inputValue('#message') === '', 'Consumed summary is not inserted on a later visit');
  }));

  await scenario('incomplete-draft-still-requires-user-input', async () => withPage(browser, 1440, async page => {
    await loaded(page, '/');
    await page.evaluate(text => sessionStorage.setItem('vgContactDraft', JSON.stringify({text, subject: 'elektrik', complete: false})), genericPrompt);
    await loaded(page, '/iletisim.html#iletisim');
    checked(await page.inputValue('#message') === genericPrompt, 'Incomplete prompt is restored');
    checked(await page.locator('#message').getAttribute('data-prefill-complete') === null, 'Incomplete prompt is not marked as complete');
    await page.fill('#name', 'QA Sentetik'); await page.fill('#phone', '05321234567'); await page.fill('#email', 'qa@example.invalid');
    // An invalid submit exercises client validation only. Any attempted network
    // POST is blocked by this fixture and fails the final no-writes assertion.
    await page.locator('#contactForm').evaluate(form => form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
    checked(await page.locator('#message').getAttribute('aria-invalid') === 'true', 'Unedited incomplete prompt is rejected before networking');
    checked(/ihtiyacınızı kısaca yazın/.test(await page.locator('#message').evaluate(field => document.getElementById(field.getAttribute('aria-describedby'))?.textContent || field.parentElement.textContent)), 'Rejection explains that the visitor must write their need');
    checked(await page.evaluate(() => sessionStorage.getItem('vgContactDraft')) === null, 'Incomplete draft is also consumed once');
  }));

  await scenario('restored-user-text-is-preserved', async () => withPage(browser, 1440, async page => {
    await loaded(page, '/');
    await page.evaluate(() => sessionStorage.setItem('vgContactDraft', JSON.stringify({text: 'QA replacement must never replace an existing user note.', subject: 'elektrik', complete: true})));
    await loaded(page, '/iletisim.html?__qa_existing=1#iletisim');
    checked(await page.inputValue('#message') === existingNote, 'A browser-restored user message wins over the transferred template');
    checked(await page.inputValue('#subject') === 'mekanik', 'An existing user subject is preserved');
    checked(await page.evaluate(() => sessionStorage.getItem('vgContactDraft')) === null, 'Ignored transfer is still consumed once');
    await page.evaluate(() => {
      const link = document.createElement('a'); link.href = '#iletisim'; link.dataset.prefill = 'QA local template must not replace the user note.';
      link.dataset.subject = 'elektrik'; document.querySelector('main').append(link); link.click(); link.remove();
    });
    checked(await page.inputValue('#message') === existingNote, 'Same-page quote template also preserves the user message');
    checked(await page.inputValue('#subject') === 'mekanik', 'Same-page quote template preserves the user subject');
  }));
}

async function main() {
  checked(fs.existsSync(path.join(output, 'index-before.html')) && fs.existsSync(path.join(output, 'home-before.css')), 'Original baseline snapshots exist');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({headless: true, executablePath: chrome, args: ['--disable-features=Prerender2,SpeculationRulesPrefetch,SpeculationRulesPrerender']});
    for (const width of [1440, 390]) {
      const context = await contextFor(browser, width, 'light'), page = await context.newPage(); watch(page, 'baseline-' + width, true);
      try {await loaded(page, '/__qa-home-before.html'); await revealAll(page); report.baselines.push({width, ...(await snapshot(page))});}
      finally {await context.close();}
    }
    for (const theme of ['light', 'dark']) for (const width of [320, 390, 1440]) {
      const context = await contextFor(browser, width, theme);
      try {
        for (const route of routes) {
          const name = route === '/' ? 'home' : path.basename(route, '.html'), label = `${name}-${width}-${theme}`;
          const page = await context.newPage(); watch(page, label);
          const item = {route, width, theme, ok: false}; report.layouts.push(item);
          try {
            await loaded(page, route); await revealAll(page); item.snapshot = await snapshot(page);
            const data = item.snapshot;
            item.missingTargets = missingTargets(data.links); delete data.links;
            checked(!data.missingMain && data.h1.length === 1, label + ': exactly one visible H1 and a main landmark');
            checked(data.overflow <= 1, label + ': no horizontal overflow (' + data.overflow + 'px)');
            checked(data.duplicateIds.length === 0, label + ': no duplicate IDs');
            checked(data.theme === theme, label + ': actual page applies the requested theme');
            checked(item.missingTargets.length === 0, label + ': local links and fragments resolve: ' + item.missingTargets.join(', '));
            if (route === '/') {
              checked(data.sections <= 7, label + ': at most seven main sections');
              checked(data.forbidden.length === 0, label + ': detailed form, videos, news grid and EMI demo leave the home page');
              const baseline = report.baselines.find(before => before.width === width);
              if (baseline) {
                item.wordReduction = 1 - data.words / baseline.words; item.heightReduction = 1 - data.height / baseline.height;
                checked(item.wordReduction >= 0.60, label + ': at least 60% less visible main text (' + Math.round(item.wordReduction * 100) + '%)');
                checked(item.heightReduction >= 0.50, label + ': at least 50% shorter main (' + Math.round(item.heightReduction * 100) + '%)');
              }
            }
            item.ok = true;
          } catch (error) {item.error = error.stack; report.findings.push({label, error: error.message});}
          finally {
            // Exactly 36 main-content captures; preserve diagnostics on failure too.
            try {item.screenshot = path.join(output, label + '.png'); await page.locator('main').screenshot({path: item.screenshot, timeout: 15000});}
            catch (error) {item.ok = false; report.findings.push({label, error: 'Screenshot failed: ' + error.message});}
            await page.close();
          }
          console.log(JSON.stringify({layout: label, ok: item.ok, words: item.snapshot?.words, height: item.snapshot?.height, overflow: item.snapshot?.overflow}));
        }
      } finally {await context.close();}
    }
    await workflows(browser);
    checked(report.rejectedWrites.length === 0, 'No form or backend write was attempted');
  } catch (error) {report.findings.push({name: 'fixture', error: error.stack});}
  finally {if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));}
  report.externalBlocked = [...new Set(report.externalBlocked)];
  fs.writeFileSync(path.join(output, 'navigation-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({layouts: report.layouts.length, layoutsPassed: report.layouts.filter(item => item.ok).length,
    workflows: report.workflows.length, workflowsPassed: report.workflows.filter(item => item.ok).length,
    checks: report.checks, findings: report.findings, pageErrors: report.pageErrors, consoleErrors: report.consoleErrors,
    missingResources: report.missingResources, rejectedWrites: report.rejectedWrites, report: path.join(output, 'navigation-report.json')}, null, 2));
  if (report.findings.length || report.pageErrors.length || report.consoleErrors.length || report.missingResources.length || report.rejectedWrites.length) process.exitCode = 1;
}
main().catch(error => {console.error(error.stack); server.close(); process.exitCode = 1;});
