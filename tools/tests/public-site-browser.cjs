'use strict';
// Full public-page smoke audit. It never signs in, submits a form or touches production data.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {spawn, spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const modules = process.env.VG_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium} = require(path.join(modules, 'playwright'));
const chrome = [process.env.VG_CHROME,
  path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(file => fs.existsSync(file));
const output = path.join(root, '.qa/site-audit');
const a11yMode = process.argv.includes('--a11y');
const axePath = process.env.VG_AXE || path.join(root, '.qa/a11y/node_modules/axe-core/axe.min.js');
const templates = new Set(['/', '/gizlilik.html', '/fabrika-cozumleri.html', '/ekibimiz.html',
  '/hesaplama-araclari/', '/hesap/giris.html', '/hesap/kayit.html', '/calisan/giris.html',
  '/topluluk.html', '/sor.html', '/bilgi-bankasi.html', '/akademi.html',
  '/hizmetler/trafo-bakimi.html', '/bilgi/gerilim-dusumu-nedir.html',
  '/araclar/', '/araclar/fazor-simetrik-bilesenler/', '/voltsim/', '/voltsim/pano/', '/voltgame.html']);
fs.mkdirSync(output, {recursive:true});

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-public-audit-'));
  const server = spawn(process.execPath, ['tools/preview.cjs'], {cwd:root, windowsHide:true, stdio:'ignore',
    env:{...process.env, LOCALAPPDATA:sandbox, VG_PREVIEW_PORT:String(port)}});
  let browser;
  const results = [];
  try {
    for (let i=0;i<100;i++) {
      try { if ((await fetch(base + '/manifest.json')).ok) break; } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const source = JSON.parse(fs.readFileSync(path.join(output, 'source.json')));
    const routes = [...new Set(source.routes.map(route => new URL(route).pathname))].filter(route => !a11yMode || templates.has(route));
    if (a11yMode && !fs.existsSync(axePath)) throw new Error('Set VG_AXE to axe.min.js for accessibility audits.');
    browser = await chromium.launch({executablePath:chrome, headless:true, args:['--disable-features=Prerender2,SpeculationRulesPrefetch,SpeculationRulesPrerender']});
    for (const width of [390, 1440]) {
      const context = await browser.newContext({viewport:{width,height:900}, reducedMotion:'reduce', serviceWorkers:'block'});
      await context.route('**/*', route => {
        const url = route.request().url();
        return /^https?:/.test(url) && !url.startsWith(base + '/') ? route.abort() : route.continue();
      });
      const queue = routes.slice();
      await Promise.all(Array.from({length:3}, async () => {
        while (queue.length) {
          const page = await context.newPage();
          const route = queue.shift();
          const item = {route,width,errors:[],csp:[],failures:[]};
          const onError = error => item.errors.push(error.message);
          const onConsole = message => {if(message.type()==='error' && /Content Security Policy|violates.*directive/i.test(message.text())) item.csp.push(message.text());};
          const onResponse = response => {if(response.url().startsWith(base+'/') && response.status()>=400) item.failures.push({url:new URL(response.url()).pathname,status:response.status()});};
          page.on('pageerror',onError); page.on('console',onConsole); page.on('response',onResponse);
          try {
            const response = await page.goto(base+route, {waitUntil:'load',timeout:30000});
            item.status = response.status();
            if (/^\/hesap\/(?:panel|projeler|dokumanlar|favoriler|gecmis)\.html$/.test(route)) {
              await page.waitForURL(url => url.pathname === '/hesap/giris.html', {timeout:15000});
            }
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(150);
            Object.assign(item, await page.evaluate(() => ({
              overflow:Math.max(0, document.documentElement.scrollWidth-innerWidth),
              h1:[...document.querySelectorAll('h1')].filter(el => el.getBoundingClientRect().height && getComputedStyle(el).display!=='none').map(el => el.textContent.trim()),
              brokenImages:[...document.images].filter(img => img.complete && !img.naturalWidth && img.getAttribute('src')).map(img => img.getAttribute('src')),
            })));
            if (a11yMode) {
              await page.addScriptTag({path:axePath});
              item.accessibility = await page.evaluate(async () => (await axe.run(document, {
                runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']},
              })).violations.map(issue => ({id:issue.id,impact:issue.impact,help:issue.help,
                nodes:issue.nodes.map(node => ({target:node.target,summary:node.failureSummary,html:node.html.slice(0,350)}))})));
            }
            if (['/','/gizlilik.html','/fabrika-cozumleri.html','/hesaplama-araclari/','/voltsim/','/topluluk.html'].includes(route)) {
              await page.screenshot({path:path.join(output,`${route.replace(/[^a-z0-9]+/gi,'-')||'home'}-${width}.png`),fullPage:route!=='/'});
            }
          } catch (error) { item.errors.push(error.message); }
          page.removeListener('pageerror',onError); page.removeListener('console',onConsole); page.removeListener('response',onResponse);
          results.push(item);
          await page.close();
          if(results.length%30===0) console.log(`Audited ${results.length}/${routes.length*2} page/viewports`);
        }
      }));
      await context.close();
    }
    const failures = results.filter(item => item.errors.length || item.csp.length || item.failures.length || item.overflow>1 || item.brokenImages?.length || item.accessibility?.length);
    fs.writeFileSync(path.join(output,a11yMode?'accessibility.json':'browser.json'),JSON.stringify({pages:routes.length,results,failures},null,2));
    console.log(JSON.stringify({pages:routes.length,viewports:results.length,failures},null,2));
    if(failures.length) process.exitCode=1;
  } finally {
    if(browser) await browser.close();
    if(server.pid) {
      if(process.platform==='win32') spawnSync('taskkill',['/pid',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
      else server.kill();
    }
    // Only remove this explicitly created, verified temporary test directory.
    if(path.dirname(sandbox)===fs.realpathSync(os.tmpdir()) && path.basename(sandbox).startsWith('vg-public-audit-')) fs.rmSync(sandbox,{recursive:true,force:true});
  }
}
main().catch(error => {console.error(error);process.exitCode=1;});
