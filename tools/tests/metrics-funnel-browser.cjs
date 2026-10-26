'use strict';
// Ölçüm akışının kontrollü tarayıcı testi (gerçek Chrome + PHP önizleme sunucusu, atılabilir veri dizini):
//   hizmet sayfası → teklif çağrısı → iletişim formu (istemci hatası → backend kabulü) · VoltSim (açılış, sonuç, CSV)
//   · hesap aracı (kullanım, sonuç) · mobil teklif sihirbazı (adım, terk) · telefon bağlantısı (niyet)
// Ardından ölçüm dosyaları okunur: olaylar YALNIZCA test kovasına yazılmış olmalı, kişisel veri hiçbir dosyada olmamalı.
// Son olarak yetkili hesapla büyüme paneli test modunda açılır (1280 ve 390 px), ekran görüntüsü alınır.
//   node tools/tests/metrics-funnel-browser.cjs [--shots <klasör>]   (Playwright: VG_NODE_MODULES, Chrome/Edge: VG_CHROME, PHP: VG_PHP)
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const modules = process.env.VG_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(modules, 'playwright'));
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const chrome = [process.env.VG_CHROME,
  path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(file => fs.existsSync(file));
const shotsArg = process.argv.indexOf('--shots');
const shots = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : '';
const PII = { name: 'Deniz Testoğlu', phone: '0532 444 55 66', email: 'deniz.test@example.test', message: 'Trafo bakımı için gizli-tesis-4417 adresimize teklif rica ederiz.' };

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

async function main() {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-metrics-funnel-'));
  const hash = crypto.createHash('sha256').update(fs.realpathSync(root).toLowerCase()).digest('hex').slice(0, 20);
  const dataDir = path.join(sandbox, 'VoltGuard', 'preview-data', hash);
  const server = spawn(process.execPath, ['tools/preview.cjs'], { cwd: root, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, LOCALAPPDATA: sandbox, VG_PREVIEW_PORT: String(port) } });
  let browser, failures = 0, checks = 0;
  const fail = msg => { failures++; console.error('FAIL ' + msg); };
  const expect = (cond, msg) => { if (cond) checks++; else fail(msg); };
  const errors = [];
  const watch = (page, label) => {
    page.on('pageerror', e => errors.push(label + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|net::ERR_FAILED/.test(m.text())) errors.push(label + ': ' + m.text()); });
  };
  try {
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(base + '/manifest.json')).ok) break; } catch (_) { /* henüz hazır değil */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // Sayfa kapanırken gönderilen beacon bağlamın değil tarayıcının varsayılan kimliğini taşır; headless kimliği sunucuda bot
    // sayıldığı için tarayıcı genel bir kimlikle başlatılır (gerçek tarayıcıda bu sorun yoktur).
    browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-features=Prerender2,SpeculationRulesPrefetch,SpeculationRulesPrerender',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'] });
    // Yalnızca dış adresler engellenir; site isteklerine (sayfadan ayrılırken gönderilen beacon dahil) dokunulmaz.
    const block = ctx => ctx.route(url => /^https?:/.test(url.href) && !url.href.startsWith(base + '/'), route => route.abort());

    /* --- masaüstü: hizmet → teklif çağrısı → form → kabul --- */
    // Headless Chrome kimliği ("HeadlessChrome") sunucuda bot sayılır ve doğru olarak elenir; gerçek tarayıcı kimliği kullanılır.
    const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
    await block(desk);
    let page = await desk.newPage(); watch(page, 'desktop');
    await page.goto(base + '/hizmetler/trafo-bakimi.html', { waitUntil: 'load' });
    expect(await page.evaluate(() => window.vgTrack && window.vgTrack.enabled && window.vgTrack.test), 'tracker enabled in test mode on 127.0.0.1 even under automation');
    await Promise.all([page.waitForURL(/\/iletisim\.html\?hizmet=trafo-bakimi#iletisim$/), page.locator('a[data-vg-teklif]').first().click()]);
    await page.waitForTimeout(600);
    expect(await page.inputValue('#service') === 'trafo-bakimi', 'contact page preselects the service from the quote link');
    expect(await page.inputValue('#subject') === 'elektrik', 'service preselection also fills the contact subject');
    await page.fill('#name', PII.name);
    await page.click('#contactForm button[type="submit"]');
    await page.waitForTimeout(300);
    expect(await page.locator('#phone[aria-invalid="true"]').count() === 1, 'client validation marks the phone field');
    await page.fill('#phone', PII.phone);
    await page.fill('#email', PII.email);
    if (!(await page.inputValue('#subject'))) await page.selectOption('#subject', 'elektrik');
    await page.fill('#message', PII.message);
    await page.click('#contactForm button[type="submit"]');
    await page.waitForSelector('#contactReceipt.form__receipt--ok', { timeout: 15000 }).catch(() => fail('contact form was not accepted'));
    await page.evaluate(() => { const a = document.querySelector('a[href^="tel:"]'); a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); });
    await page.waitForTimeout(400);

    /* --- VoltSim: açılış, kullanıcı girdisi → sonuç, CSV raporu --- */
    await page.goto(base + '/voltsim/trafo/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const range = page.locator('[data-vs-module] input[type="range"]').first();
    if (await range.count()) { await range.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); }
    else fail('VoltSim page has no range input to change');
    await page.waitForTimeout(800);
    const csv = page.locator('[data-vs-act="csv"]').first();
    if (await csv.count()) { await Promise.all([page.waitForEvent('download').catch(() => null), csv.click()]); } else fail('VoltSim CSV button missing');
    await page.waitForTimeout(500);

    /* --- hesap aracı: ilk girdi → sonuç --- */
    await page.goto(base + '/hesaplama/kablo-kesiti-hesaplama/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const field = page.locator('.mini-calc input[type="text"], .mini-calc input[type="number"]').first();
    await field.click(); await field.press('Control+A'); await page.keyboard.type('37');
    await page.waitForTimeout(800);
    await page.goto(base + '/', { waitUntil: 'load' }); // önceki sayfanın sıradaki olayları pagehide'da gönderilir
    await page.waitForTimeout(500);

    /* --- mobil: teklif sihirbazı 2. adıma geçip terk --- */
    const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    await block(mob);
    const mp = await mob.newPage(); watch(mp, 'mobile');
    await mp.goto(base + '/fabrika-cozumleri.html#teklif', { waitUntil: 'load' });
    await mp.waitForTimeout(700);
    await mp.locator('input[name="wzSector"]').first().check({ force: true });
    await mp.locator('[data-fx-w="next"]').first().click();
    await mp.waitForTimeout(400);
    await mp.goto(base + '/', { waitUntil: 'load' });
    await mp.waitForTimeout(800);

    /* --- ölçüm dosyaları --- */
    const metricsDir = path.join(dataDir, 'metrics');
    const liveFiles = walk(path.join(metricsDir, 'days'));
    expect(liveFiles.length === 0, 'no live metrics file was written from the preview (found ' + liveFiles.length + ')');
    const testFile = walk(path.join(metricsDir, 'test-days'))[0];
    const day = testFile ? JSON.parse(fs.readFileSync(testFile, 'utf8')) : null;
    if (!day) { fail('no test-day file'); throw new Error('stop'); }
    const has = (dim, key, why) => expect((day[dim] || {})[key] >= 1, `${why} (${dim}[${key}] = ${JSON.stringify(day[dim])})`);
    has('cta', '/hizmetler/trafo-bakimi.html|iletisim', 'service CTA click on the service page');
    has('q_start', 'iletisim|masaustu|yok', 'quote_start on the contact form');
    has('q_src', 'iletisim|/hizmetler/trafo-bakimi.html', 'quote_start attributed to the service page');
    has('q_err', 'iletisim|telefon|masaustu', 'client validation error on the phone field');
    has('q_ok', 'iletisim|masaustu|yok|elektrik', 'accepted request counted by the backend');
    has('q_ok_src', 'iletisim|/hizmetler/trafo-bakimi.html', 'accepted request attributed to the service page');
    // The phone link is now on the dedicated contact page, which uses the
    // existing "diger" section rather than the homepage section.
    has('contact', 'tel|diger', 'contact-page phone link click recorded as contact intent');
    has('sim_open', 'trafo', 'simulation_open');
    has('sim_result', 'trafo', 'simulation_result after a user change');
    has('report', 'sim-trafo|csv', 'report_download (CSV)');
    has('tool', 'kablo-kesiti-hesaplama', 'tool_use');
    has('tool_result', 'kablo-kesiti-hesaplama', 'tool_result');
    has('q_start', 'teklif|mobil|yok', 'mobile wizard start');
    has('q_step', 'teklif|2', 'wizard step 2 reached');
    has('q_ab', 'teklif|adim-2|mobil', 'mobile wizard abandoned at step 2');
    expect((day.ev.quote_submit_success || 0) === 1, 'exactly one accepted request (no client-side double count)');
    expect(!day.q_ab || !Object.keys(day.q_ab).some(k => k.startsWith('iletisim|')), 'accepted contact form is not reported as abandoned');
    const stored = walk(metricsDir).map(f => fs.readFileSync(f, 'utf8')).join('\n');
    for (const [k, v] of Object.entries(PII)) expect(!stored.includes(v) && !stored.includes(v.replace(/ /g, '')), 'no ' + k + ' in metrics files');
    expect(!stored.includes('gizli-tesis-4417'), 'no message text in metrics files');

    /* --- panel: yetkili hesap, test modu --- */
    const admin = await desk.newPage(); watch(admin, 'dashboard');
    await admin.goto(base + '/hesap/giris.html', { waitUntil: 'load' });
    const me = await admin.evaluate(() => fetch('/api/auth.php?action=me', { credentials: 'same-origin' }).then(r => r.json()));
    const reg = await admin.evaluate(csrf => fetch('/api/auth.php?action=register', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-VG-CSRF': csrf },
      body: JSON.stringify({ name: 'Panel Test', email: 'panel-' + Date.now() + '@example.test', password: 'Deneme12345' }) }).then(r => r.json()), me.csrf);
    // Önizleme sunucusuyla aynı eklentiler (tools/preview.cjs phpRuntime): hesap deposu pdo_sqlite kullanır.
    const extDir = path.join(path.dirname(php), 'ext');
    const phpFlags = ['-n', ...(fs.existsSync(extDir) ? ['-d', 'extension_dir=' + extDir] : []),
      ...['mbstring', 'fileinfo', 'openssl', 'pdo_sqlite'].flatMap(x => ['-d', 'extension=' + x])];
    const grant = spawnSync(php, [...phpFlags, path.join(root, 'tools/metrics-admin.php'), 'grant', reg.user && reg.user.id], { env: { ...process.env, VG_DATA_DIR: dataDir }, encoding: 'utf8', windowsHide: true });
    expect(grant.status === 0, 'admin granted: ' + grant.stderr);
    for (const width of [1280, 390]) {
      await admin.setViewportSize({ width, height: 900 });
      await admin.goto(base + '/hesap/buyume-paneli.html', { waitUntil: 'load' });
      await admin.waitForSelector('#gp-body:not([hidden])', { timeout: 15000 }).catch(() => fail('dashboard did not load @' + width));
      const liveText = await admin.locator('#gp-body').innerText();
      expect(/Veri henüz mevcut değil/.test(liveText) && /Doğrulanmış veri yok/.test(liveText), 'live view shows "no data" instead of numbers @' + width);
      await admin.click('button[data-mode="test"]');
      await admin.waitForFunction(() => !document.getElementById('gp-mode-banner').hidden, null, { timeout: 10000 }).catch(() => fail('test banner missing @' + width));
      await admin.waitForTimeout(300);
      const text = await admin.locator('#gp-body').innerText();
      for (const s of ['Test verisi gösteriliyor', 'Ölçüm dönemi', '/hizmetler/trafo-bakimi.html', 'Fabrika teklif sihirbazı', '2. adımda ayrıldı',
        'VoltSim · Trafo', 'Kablo kesiti hesaplama', 'görüşme / satış değildir', 'Doğrulanmış veri yok', 'Taban ölçülüyor', 'düşük örneklem']) {
        expect(text.includes(s), `dashboard (test) shows "${s}" @${width}`);
      }
      const overflow = await admin.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow <= 1, `dashboard horizontal overflow ${overflow}px @${width}`);
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await admin.screenshot({ path: path.join(shots, `buyume-paneli-test-${width}.png`), fullPage: true }); }
    }
    expect(errors.length === 0, 'console errors: ' + JSON.stringify(errors.slice(0, 5)));
    await mob.close(); await desk.close();
  } catch (e) {
    if (e.message !== 'stop') { failures++; console.error(e); }
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise(resolve => setTimeout(resolve, 400));
    if (process.env.VG_KEEP) console.log('Veri dizini korundu: ' + dataDir); else fs.rmSync(sandbox, { recursive: true, force: true });
  }
  console.log(`Metrics funnel browser check: ${checks} checks passed, ${failures} failed.`);
  if (failures) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
