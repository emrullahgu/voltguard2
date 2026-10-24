/* First-party metrics: real PHP/HTTP checks (anonymity, event dictionary v2, live/test separation, server-side quote
 * acceptance in contact.php, admin-only dashboard, verified outcomes ledger) plus client-side checks of js/vg-metrics.js
 * (Do Not Track, test mode, deduplication, form tracker). All data lives in a temporary private directory. */
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 VgMetricsProbe/7319';
/* Kişisel veri örnekleri: hiçbir ölçüm dosyasında görünmemeli. */
const PII = { name: 'Zeynep Örnekoğlu', phone: '0532 555 12 34', email: 'zeynep.ornek@example.test',
  message: 'Fabrikamızdaki 1600 kVA trafo için gizli-proje-7781 kapsamında teklif istiyoruz.' };
let checks = 0;
const check = (actual, expected, why) => { assert.deepEqual(actual, expected, why); checks++; };
const ok = (value, why) => { assert.ok(value, why); checks++; };
const plain = v => JSON.parse(JSON.stringify(v)); // vm bağlamındaki nesneler başka prototipe sahip

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/* ---------- client: js/vg-metrics.js in a minimal DOM ---------- */
function runClient({ dnt, gpc, webdriver, referrer = '', pathname = '/', ua = UA, search = '', hostname = 'voltguard.com.tr' }) {
  const beacons = [];
  const listeners = {};
  const winListeners = {};
  const store = {};
  const document = { referrer, prerendering: false, visibilityState: 'visible',
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); }, removeEventListener() {}, querySelector() { return null; } };
  const window = {
    location: { protocol: 'https:', hostname, pathname, search, href: `https://${hostname}${pathname}${search}` },
    navigator: { userAgent: ua, doNotTrack: dnt, globalPrivacyControl: gpc, webdriver,
      sendBeacon(url, blob) { beacons.push({ url, blob }); return true; } },
    sessionStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    addEventListener(name, fn) { (winListeners[name] ||= []).push(fn); },
    fetch() { throw new Error('fetch must not be used when sendBeacon succeeds'); }
  };
  class Blob { constructor(parts, options) { this.text = parts.join(''); this.type = options.type; } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/vg-metrics.js'), 'utf8'),
    { window, document, Blob, URL, setTimeout, clearTimeout, JSON });
  const sent = () => beacons.map(b => JSON.parse(b.blob.text));
  const fire = (name, event) => (winListeners[name] || []).forEach(fn => fn(event || {}));
  return { window, beacons, listeners, sent, fire };
}

function fakeForm() {
  const handlers = {};
  return { handlers, addEventListener(name, fn) { (handlers[name] ||= []).push(fn); },
    emit(name, target) { (handlers[name] || []).forEach(fn => fn({ isTrusted: true, target })); } };
}

function clientChecks() {
  let c = runClient({ dnt: '1' });
  check(c.beacons.length, 0, 'navigator.doNotTrack=1 sends nothing');
  check(c.window.vgTrack.enabled, false, 'DNT disables the tracker');
  check(c.window.vgTrack('contact_click', { ch: 'tel' }), false, 'vgTrack is a no-op under DNT');
  check(plain(c.window.vgTrack.quoteFields()), {}, 'No quote context fields under DNT');
  c = runClient({ gpc: true });
  check(c.beacons.length, 0, 'Global Privacy Control sends nothing');
  c = runClient({ webdriver: true });
  check(c.beacons.length, 0, 'Automation (navigator.webdriver) is not counted outside test mode');

  c = runClient({ webdriver: true, search: '?vg_test=1' });
  check([c.window.vgTrack.enabled, c.window.vgTrack.test, c.sent()[0].t], [true, true, 1], '?vg_test=1 enables controlled automation and flags the batch as test');
  c = runClient({ hostname: 'localhost' });
  check(c.sent()[0].t, 1, 'Local hosts always send test data');

  c = runClient({ referrer: 'https://www.google.com.tr/search?q=voltguard+trafo', pathname: '/hesaplama/kablo-kesiti-hesaplama.html',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  check(c.beacons.length, 1, 'One pageview beacon without opt-out');
  check(c.beacons[0].url, '/api/metrics.php?action=collect', 'Beacon goes to first-party endpoint');
  check(c.beacons[0].blob.type, 'text/plain;charset=UTF-8', 'Beacon uses a CORS-safelisted content type');
  check(c.sent()[0], { v: 2, ev: [{ e: 'pageview', p: '/hesaplama/kablo-kesiti-hesaplama/', r: 'arama', d: 'mobil', se: 'google' }] },
    'Pageview carries only normalized path, referrer category, engine name and device class; live data has no test flag');
  ok(!c.beacons[0].blob.text.includes('voltguard+trafo') && !c.beacons[0].blob.text.includes('iPhone'), 'Search terms and UA never leave the browser');
  c.window.vgTrack('simulation_run', { sim: 'trafo', extra: PII.email });
  c.window.vgTrack('sim_start', { sim: 'trafo' });
  c.window.vgTrack('tel_click');
  check(c.sent()[1].ev, [{ e: 'simulation_run', p: '/hesaplama/kablo-kesiti-hesaplama/', sim: 'trafo' },
    { e: 'contact_click', p: '/hesaplama/kablo-kesiti-hesaplama/', ch: 'tel' }],
  'Unknown props dropped, legacy sim_start deduplicated into simulation_run, legacy tel_click mapped and flushed immediately');
  check(c.window.vgTrack('evil_event'), false, 'Unknown event names are refused client-side');
  check(c.window.vgTrack('quote_submit_success', { form: 'iletisim' }), false, 'quote_submit_success can never be sent by the browser');
  check(c.window.vgTrack('quote_submit', { svc: 'x' }), false, 'Legacy client quote_submit is ignored (server counts acceptance)');
  check(c.window.vgTrack('quote_validation_error', { form: 'iletisim', field: PII.email }), true, 'Event itself is allowed…');
  ok(!JSON.stringify(c.sent()).includes(PII.email), '…but a field value that is not an allowed slug is never sent');

  // Form tracker: start on first trusted input, errors by field id, abandon on pagehide, no values.
  c = runClient({ referrer: 'https://voltguard.com.tr/hizmetler/trafo-bakimi.html', pathname: '/' });
  const form = fakeForm();
  const qm = c.window.vgTrack.form(form, 'iletisim', { fields: { name: 'ad', phone: 'telefon', email: 'eposta' } });
  form.emit('focusin', { id: 'phone', value: PII.phone });
  form.emit('input', { id: 'phone', value: PII.phone });
  form.emit('input', { id: 'name', value: PII.name });
  qm.errors(['phone', 'email']);
  qm.errors(['phone']);
  check(plain(qm.fields()), { vg_ctx_src: '/hizmetler/trafo-bakimi.html', vg_ctx_dev: 'masaustu' }, 'Quote context: previous internal page path and device class only');
  c.fire('pagehide');
  const formEvents = c.sent().slice(1).flatMap(b => b.ev);
  check(formEvents.map(e => e.e), ['quote_start', 'quote_validation_error', 'quote_validation_error', 'quote_abandon'],
    'One start, one error per field per page view, one abandon');
  check(formEvents[0], { e: 'quote_start', p: '/', form: 'iletisim', d: 'masaustu', src: '/hizmetler/trafo-bakimi.html', tas: 'yok' }, 'quote_start payload');
  check(formEvents[3].last, 'ad', 'Abandon reports the last field id the visitor worked on');
  ok(!JSON.stringify(c.sent()).match(/Zeynep|0532|example\.test/), 'Form values never appear in any beacon');

  c = runClient({ pathname: '/fabrika-cozumleri.html' });
  const wiz = c.window.vgTrack.form(fakeForm(), 'teklif', {});
  wiz.step(2); wiz.step(3); wiz.done(); c.fire('pagehide');
  check(c.sent().slice(1).flatMap(b => b.ev).map(e => e.e + (e.step ? ':' + e.step : '')), ['quote_start', 'quote_step:2', 'quote_step:3'],
    'Wizard steps tracked; an accepted request is never reported as abandoned');
}

async function run() {
  clientChecks();
  const probe = spawnSync(php, ['-n', '-v'], { encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) throw new Error('Set VG_PHP to a PHP 7.4+ executable to run these checks.');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-metrics-api-'));
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  // Bu test sunucusu "canlı" alan adı sayılır (VG_METRICS_LIVE_HOSTS); test kovası ayrıca sınanır.
  const environment = { ...process.env, VG_DATA_DIR: sandbox, VG_STORE: 'json', VG_MAIL_OUTBOX: '1', VG_RATE_SCALE: '0.5',
    VG_METRICS_LIVE_HOSTS: `127.0.0.1:${port}`, VG_CONTACT_ALLOWED_ORIGINS: base };
  const child = spawn(php, ['-n', '-S', `127.0.0.1:${port}`, '-t', root], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.resume(); child.stderr.resume();

  async function collect(events, headers = {}, raw, extra = {}) {
    const response = await fetch(`${base}/api/metrics.php?action=collect`, { method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: base, 'User-Agent': UA, ...headers },
      body: raw !== undefined ? raw : JSON.stringify({ v: 2, ev: events, ...extra }) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function contact(fields) {
    const body = new URLSearchParams({ name: PII.name, phone: PII.phone, email: PII.email, subject: 'elektrik', message: PII.message,
      website: '', formTimestamp: String(Date.now()), ...fields });
    const response = await fetch(`${base}/contact.php`, { method: 'POST', headers: { Origin: base, 'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
    return { status: response.status, body: await response.json() };
  }
  const client = () => ({ cookies: new Map(), csrf: '' });
  async function auth(actor, action, options = {}) {
    const endpoint = options.endpoint || 'auth';
    const query = new URLSearchParams({ action, ...(options.query || {}) });
    const headers = { Cookie: [...actor.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'User-Agent': UA, ...(options.headers || {}) };
    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'; headers.Origin ||= base; headers['X-VG-CSRF'] = actor.csrf;
      body = JSON.stringify(options.body);
    } else if (options.csrf !== false && endpoint === 'metrics') headers['X-VG-CSRF'] = options.csrf || actor.csrf;
    const response = await fetch(`${base}/api/${endpoint}.php?${query}`, { method: options.body !== undefined ? 'POST' : 'GET', headers, body });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';')[0]; const eq = first.indexOf('=');
      actor.cookies.set(first.slice(0, eq), first.slice(eq + 1));
    }
    const json = await response.json();
    if (json.csrf) actor.csrf = json.csrf;
    return { status: response.status, body: json };
  }
  const dayFile = (bucket = 'days') => {
    const dir = path.join(sandbox, 'metrics', bucket);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [];
    return files.length ? JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8')) : null;
  };
  /* contact.php sayımı yanıttan SONRA çalışır (vg_after_response); kısa süre beklenir. */
  async function waitFor(fn, why) {
    for (let i = 0; i < 60; i++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 50)); }
    throw new Error('Timed out: ' + why);
  }
  const cli = (...args) => spawnSync(php, ['-n', path.join(root, 'tools/metrics-admin.php'), ...args], { env: environment, encoding: 'utf8', windowsHide: true });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { await fetch(`${base}/api/metrics.php?action=popular`); ready = true; break; } catch (_) { await new Promise(r => setTimeout(r, 50)); }
    }
    assert.ok(ready, 'PHP test server starts');

    let r = await collect([{ e: 'pageview', p: '/', r: 'arama', se: 'google', d: 'mobil' }]);
    check([r.status, r.body.accepted, r.body.bucket], [200, 1, 'live'], 'Pageview accepted into the live bucket');
    check(r.headers.getSetCookie().length, 0, 'Collect never sets a cookie');
    check(fs.existsSync(path.join(sandbox, 'sessions')) && fs.readdirSync(path.join(sandbox, 'sessions')).some(f => f.startsWith('sess_')), false, 'Collect never opens a server session');

    // Event dictionary v2 + legacy v1 names
    r = await collect([
      { e: 'pageview', p: '/hesaplama/kablo-kesiti-hesaplama/', r: 'ic', d: 'masaustu' },
      { e: 'pageview', p: '/hizmetler/trafo-bakimi.html', r: 'sosyal', d: 'tablet' },
      { e: 'pageview', p: '/bu-sayfa-yok-12345/', r: 'dogrudan', d: 'masaustu' },
      { e: 'pageview', p: '/calisan/panel.html', r: 'dogrudan', d: 'masaustu' },
      { e: 'simulation_open', p: '/voltsim/trafo/', sim: 'trafo' }, { e: 'simulation_run', p: '/voltsim/trafo/', sim: 'trafo' },
      { e: 'simulation_result', p: '/voltsim/trafo/', sim: 'trafo' }, { e: 'simulation_error', p: '/voltsim/trafo/', sim: 'trafo', kind: 'webgl' },
      { e: 'report_download', p: '/voltsim/trafo/', sim: 'trafo', fmt: 'pdf' }, { e: 'scenario_save', p: '/voltsim/trafo/', sim: 'trafo', kind: 'dosya' },
      { e: 'tool_use', p: '/hesaplama/kablo-kesiti-hesaplama/', tool: 'kablo-kesiti-hesaplama' },
      { e: 'tool_result', p: '/hesaplama/kablo-kesiti-hesaplama/', tool: 'kablo-kesiti-hesaplama' },
      { e: 'service_cta_click', p: '/hizmetler/trafo-bakimi.html', to: 'iletisim' },
      { e: 'quote_start', p: '/', form: 'iletisim', d: 'mobil', src: '/hizmetler/trafo-bakimi.html', tas: 'yok' },
      { e: 'quote_validation_error', p: '/', form: 'iletisim', field: 'telefon', d: 'mobil' },
      { e: 'quote_abandon', p: '/fabrika-cozumleri.html', form: 'teklif', last: 'adim-3', d: 'mobil' },
      { e: 'quote_step', p: '/fabrika-cozumleri.html', form: 'teklif', step: 3 },
      { e: 'quote_submit_fail', p: '/', form: 'iletisim', reason: 'zaman-asimi' },
      { e: 'contact_click', p: '/', ch: 'whatsapp' }, { e: 'newsletter_subscribe', p: '/' }
    ]);
    check([r.status, r.body.accepted], [200, 19], 'All v2 events accepted (the /calisan/ pageview is dropped)');
    r = await collect([
      { e: 'sim_start', p: '/voltsim/trafo/', sim: 'trafo' }, { e: 'tool_quote', p: '/hesaplama/kablo-kesiti-hesaplama/', tool: 'kablo-kesiti-hesaplama' },
      { e: 'tel_click', p: '/' }, { e: 'quote_submit', p: '/', svc: 'trafo', via: 'arac' },
      { e: 'quote_submit_success', p: '/', form: 'iletisim' }, { e: 'quote_server_reject', p: '/', form: 'iletisim' },
      { e: 'quote_validation_error', p: '/', form: 'iletisim', field: PII.email },
      { e: 'pageview', p: '/', r: 'arama', se: 'not-an-engine', d: 'phone', ip: '10.1.2.3', ua: 'secret-agent' },
      { e: 'drop_table', p: '/' }, { e: 'simulation_run', p: '/', sim: '../../etc' }
    ], {}, undefined, { v: 1 });
    check([r.status, r.body.accepted], [200, 5], 'Legacy v1 names mapped; client-side success/reject, PII field values and invalid slugs are refused');
    let day = dayFile();
    check(day.v, 2, 'Day file uses schema v2');
    check(day.pv, 5, 'Five pageviews counted');
    check(day.entries, 4, 'Internal navigation is not an entry (visit)');
    check(day.pages['(bilinmeyen sayfa)'], 1, 'Non-existent paths cannot create new keys');
    check(day.se, { google: 1, diger: 1 }, 'Unknown search engine folded into "diger"');
    check([day.sim_open.trafo, day.sim_run.trafo, day.sim_result.trafo], [1, 2, 1], 'Simulation open/run (incl. legacy sim_start)/result');
    check(day.sim_err, { 'trafo|webgl': 1 }, 'Simulation errors by module and kind');
    check([day.report['sim-trafo|pdf'], day.save['sim-trafo|dosya']], [1, 1], 'Report download and scenario save');
    check([day.tool['kablo-kesiti-hesaplama'], day.tool_result['kablo-kesiti-hesaplama']], [1, 1], 'Tool use and tool result');
    check(day.cta, { '/hizmetler/trafo-bakimi.html|iletisim': 1, '/hesaplama/kablo-kesiti-hesaplama/|iletisim': 1 }, 'CTA clicks by page (legacy tool_quote included)');
    check([day.q_start['iletisim|mobil|yok'], day.q_src['iletisim|/hizmetler/trafo-bakimi.html']], [1, 1], 'Quote start by device/draft and by source page');
    check([day.q_err['iletisim|telefon|mobil'], day.q_ab['teklif|adim-3|mobil'], day.q_step['teklif|3'], day.q_fail['iletisim|zaman-asimi']],
      [1, 1, 1, 1], 'Form errors, abandonment, wizard step and network failure');
    check(day.contact, { 'whatsapp|ana-sayfa': 1, 'tel|ana-sayfa': 1 }, 'Contact clicks by channel and section');
    check([day.ev.quote_submit_success, day.q_ok], [undefined, []], 'No accepted request can be created through collect');
    check(day.legacy, { sim_start: 1, tool_quote: 1, tel_click: 1, quote_submit: 1 }, 'Legacy names are tallied for coverage reporting');

    // Live/test separation
    r = await collect([{ e: 'pageview', p: '/', r: 'dogrudan', d: 'mobil' }], {}, undefined, { t: 1 });
    check([r.body.bucket, dayFile('test-days').pv, dayFile().pv], ['test', 1, 5], 'Client test flag writes only to the test bucket');
    // fetch() Host başlığını değiştiremez: hazırlık sunucusu alan adı node:http ile gönderilir.
    r = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ v: 2, ev: [{ e: 'pageview', p: '/', r: 'dogrudan', d: 'mobil' }] });
      const req = require('node:http').request({ host: '127.0.0.1', port, method: 'POST', path: '/api/metrics.php?action=collect',
        headers: { Host: `staging.voltguard.test:${port}`, Origin: `http://staging.voltguard.test:${port}`, 'User-Agent': UA,
          'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': Buffer.byteLength(body) } }, res => {
        let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject); req.end(body);
    });
    check([r.status, r.body.bucket, dayFile().pv], [200, 'test', 5], 'A non-live host never writes live data');

    // Opt-out header, bots, malformed and cross-site requests
    r = await collect([{ e: 'pageview', p: '/', r: 'dogrudan', d: 'mobil' }], { DNT: '1' });
    check([r.status, r.body.accepted, r.body.reason], [200, 0, 'opt_out'], 'DNT request header is respected server-side');
    r = await collect([{ e: 'pageview', p: '/', r: 'dogrudan', d: 'mobil' }], { 'Sec-GPC': '1' });
    check(r.body.reason, 'opt_out', 'Sec-GPC is respected server-side');
    for (const bot of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0 Safari/537.36', 'curl/8.4.0', '']) {
      r = await collect([{ e: 'pageview', p: '/', r: 'dogrudan', d: 'mobil' }], { 'User-Agent': bot });
      check([r.status, r.body.reason], [200, 'filtered'], 'Bot filtered: ' + (bot || 'empty UA'));
    }
    day = dayFile();
    check([day.pv, day.bots], [5, 4], 'Bots and opted-out requests never reach the aggregates');
    check((await collect(null, { 'Content-Type': 'application/x-www-form-urlencoded' }, 'a=1')).status, 415, 'Form posts refused');
    check((await collect(null, {}, 'x'.repeat(5000))).status, 413, 'Payload limit');
    check((await collect(null, {}, '{"v":2,"ev":"x"}')).status, 400, 'Malformed body');
    check((await collect(null, {}, '{"v":3,"ev":[{"e":"newsletter_subscribe","p":"/"}]}')).status, 400, 'Unknown schema version');
    check((await collect(null, {}, JSON.stringify({ v: 2, ev: Array(21).fill({ e: 'contact_click', p: '/', ch: 'tel' }) }))).status, 400, 'At most 20 events per request');
    check((await collect([{ e: 'contact_click', p: '/', ch: 'tel' }], { Origin: 'https://evil.example' })).status, 403, 'Cross-origin beacons refused');
    check((await collect([{ e: 'contact_click', p: '/', ch: 'tel' }], { 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'Cross-site fetch metadata refused');
    check((await fetch(`${base}/api/metrics.php?action=collect`)).status, 405, 'Collect is POST only');

    // Server-side acceptance: quote_submit_success only when contact.php accepts (preview → test bucket)
    const requestId = 'metricsTestRequest0001';
    r = await contact({ phone: '123', kind: 'contact', requestId: 'metricsTestRejected01', vg_ctx_src: '/hizmetler/trafo-bakimi.html', vg_ctx_dev: 'mobil' });
    check([r.status, r.body.code], [422, 'invalid_phone'], 'Invalid request rejected by contact.php');
    await waitFor(() => (dayFile('test-days') || {}).q_rej?.['iletisim|invalid_phone'], 'server reject recorded');
    r = await contact({ kind: 'contact', requestId, vg_ctx_src: '/hizmetler/trafo-bakimi.html', vg_ctx_dev: 'mobil', vg_ctx_tas: 'sonuc' });
    check([r.status, r.body.success, r.body.preview], [200, true, true], 'Valid request accepted by contact.php (preview outbox)');
    let test = await waitFor(() => { const d = dayFile('test-days'); return d && d.ev.quote_submit_success ? d : null; }, 'acceptance recorded');
    check([test.ev.quote_submit_success, test.q_ok['iletisim|mobil|sonuc|elektrik'], test.q_ok_src['iletisim|/hizmetler/trafo-bakimi.html']], [1, 1, 1],
      'Accepted request counted server-side with form, device, draft flag, subject category and source page');
    r = await contact({ kind: 'contact', requestId, vg_ctx_src: '/hizmetler/trafo-bakimi.html', vg_ctx_dev: 'mobil', vg_ctx_tas: 'sonuc' });
    check([r.status, r.body.duplicate], [200, true], 'Same request retried (same requestId and content) is a duplicate');
    await new Promise(res => setTimeout(res, 400));
    check(dayFile('test-days').ev.quote_submit_success, 1, 'A duplicate retry is not counted as a second accepted request');
    check(dayFile().ev.quote_submit_success, undefined, 'Preview submissions never reach the live bucket');
    r = await contact({ kind: 'contact', requestId: 'metricsTestRequest0002', vg_ctx_src: 'https://evil.example/x', vg_ctx_dev: 'phone-x' });
    await waitFor(() => dayFile('test-days').ev.quote_server_reject >= 2 || dayFile('test-days').ev.quote_submit_success >= 2, 'third submission recorded');

    // Anonymity: nothing stored contains the IP, the User-Agent, raw referrers or form contents
    const stored = walk(path.join(sandbox, 'metrics')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
    ok(!stored.includes('127.0.0.1') && !stored.includes('::1'), 'No IP address stored');
    ok(!/Mozilla|VgMetricsProbe|Googlebot|HeadlessChrome|curl/.test(stored), 'No User-Agent stored');
    ok(!stored.includes('secret-agent') && !stored.includes('10.1.2.3') && !stored.includes('evil.example'), 'Unexpected client fields are never stored');
    for (const [k, v] of Object.entries(PII)) ok(!stored.includes(v) && !stored.includes(v.replace(/ /g, '')), `No ${k} in any metrics file`);
    ok(!stored.includes('gizli-proje-7781') && !stored.includes(requestId), 'No message text or request id in metrics');
    const rlFiles = walk(path.join(sandbox, 'metrics/rl'));
    check(rlFiles.length, 1, 'Exactly one (today\'s) rate counter file');
    ok(Object.keys(JSON.parse(fs.readFileSync(rlFiles[0], 'utf8'))).every(k => /^[a-f0-9]{24}$/.test(k)), 'Rate keys are salted hashes');
    ok(!walk(sandbox).some(f => /salt/i.test(path.basename(f))), 'The daily salt is never written to disk');

    // Admin-only dashboard
    const anon = client();
    r = await auth(anon, 'dashboard', { endpoint: 'metrics', query: { days: '30' } });
    check([r.status, r.body.error], [401, 'unauthorized'], 'Anonymous dashboard request refused');
    const member = client();
    await auth(member, 'me');
    r = await auth(member, 'register', { body: { name: 'Panel Yönetici', email: `metrics-${Date.now()}@example.test`, password: 'Deneme12345' } });
    check(r.status, 201, 'Member registered');
    const memberId = r.body.user.id;
    r = await auth(member, 'dashboard', { endpoint: 'metrics' });
    check([r.status, r.body.error], [403, 'forbidden'], 'Logged-in member without grant is refused');
    check(cli('grant', memberId).status, 0, 'Admin granted through private CLI only');
    r = await auth(member, 'dashboard', { endpoint: 'metrics', csrf: '0'.repeat(64) });
    check([r.status, r.body.error], [403, 'csrf'], 'Dashboard requires the session CSRF token');
    r = await auth(member, 'dashboard', { endpoint: 'metrics', headers: { Origin: 'https://evil.example' } });
    check(r.status, 403, 'Dashboard refuses foreign origins');
    r = await auth(member, 'dashboard', { endpoint: 'metrics', query: { days: '9999' } });
    check([r.status, r.body.error], [422, 'invalid_range'], 'Range is whitelisted');
    r = await auth(member, 'dashboard', { endpoint: 'metrics', query: { mode: 'all' } });
    check([r.status, r.body.error], [422, 'invalid_mode'], 'Data set is whitelisted (live | test)');

    r = await auth(member, 'dashboard', { endpoint: 'metrics', query: { days: '30' } });
    check([r.status, r.body.mode], [200, 'live'], 'Granted admin reads the live dashboard');
    let dash = r.body;
    check(dash.totals.pv, 5, 'Dashboard totals match stored aggregates');
    check(dash.series.length, 30, 'Daily series covers the selected range');
    check([dash.coverage.daysInRange, dash.coverage.daysWithData, dash.coverage.missingDays], [30, 1, 29], 'Coverage reports days with and without data');
    check(dash.coverage.legacy.quote_submit, 1, 'Coverage reports ignored legacy client quote events');
    check(dash.funnel.map(s => [s.id, s.n]), [['content', 5], ['use', 3], ['result', 2], ['quote_start', 1], ['accepted', 0]],
      'Live funnel: preview acceptances are not live accepted requests');
    check(dash.forms.iletisim.accepted, 0, 'No fabricated live acceptances');
    check(dash.items.find(i => i.id === 'sim-trafo'), { id: 'sim-trafo', type: 'voltsim', open: 1, use: 2, result: 1, tasks: 0, reports: 1, saves: 1, errors: 1 }, 'Most used items merge simulation dimensions');
    check(dash.entryPages[0], { page: '/hizmetler/trafo-bakimi.html', cta: 1, starts: 1, accepted: 0 }, 'Entry pages into the quote flow');
    check(dash.simErrors, [{ sim: 'trafo', kind: 'webgl', n: 1 }], 'Simulation run errors');
    check(dash.contacts, { tel: 1, whatsapp: 1, eposta: 0 }, 'Contact intent clicks reported separately');
    check([dash.outcomes, dash.searchConsole, dash.plan.baseline], [null, null, null], 'No verified outcomes, Search Console data or baseline is invented');
    check(dash.experiments.map(e => [e.id, e.change, e.before]), [['H1', null, null], ['H2', null, null], ['H3', null, null]], 'Experiments wait for a logged change');

    r = await auth(member, 'dashboard', { endpoint: 'metrics', query: { days: '7', mode: 'test' } });
    dash = r.body;
    check([dash.mode, dash.totals.pv, dash.totals.quoteAccepted], ['test', 2, dayFile('test-days').ev.quote_submit_success],
      'Test dashboard shows only test data');
    check(dash.forms.iletisim.rejects.invalid_phone, 1, 'Server rejections by code');
    check(dash.forms.iletisim.devices.mobil, { start: 0, accepted: 1 }, 'Accepted requests by device');
    ok(dash.entryPages.some(p => p.page === '/hizmetler/trafo-bakimi.html' && p.accepted === 1), 'Accepted requests by source page');
    ok(dash.entryPages.some(p => p.page === '(bilinmiyor)'), 'An invalid source path is stored as unknown, not as the given URL');

    // Verified outcomes ledger and change log (CLI only)
    check(cli('outcome', 'set', '2026-10', '--source', 'tahmin', '--by', 'x', '--won', '1').status, 2, 'Unknown outcome source refused');
    check(cli('outcome', 'set', '2026-10', '--source', 'yetkili', '--by', 'Satış sorumlusu').status, 2, 'An outcome needs at least one verified number');
    check(cli('outcome', 'set', '2026-10', '--source', 'is-takip', '--by', 'Satış sorumlusu', '--qualified', '3', '--won', '1').status, 0, 'Verified outcome stored');
    check(cli('change', 'add', '2026-10-01', 'H2:', 'Hizmet sayfası teklif çağrısı').status, 0, 'Change logged');
    ok(/2026-10\s+nitelikli=3\s+kazanılan=1\s+kaynak=is-takip/.test(cli('outcome', 'list').stdout), 'Outcome listed');
    r = await auth(member, 'dashboard', { endpoint: 'metrics' });
    check(r.body.outcomes['2026-10'].qualified, 3, 'Dashboard shows the verified outcome');
    check(r.body.outcomes['2026-10'].source, 'is-takip', 'Outcome source kept');
    const h2 = r.body.experiments.find(e => e.id === 'H2');
    check([h2.change.date, h2.before.days >= 0, h2.after !== null], ['2026-10-01', true, true], 'H2 compares the windows before and after its logged change');
    check(cli('outcome', 'remove', '2026-10').status, 0, 'Outcome removable');

    check(cli('list').stdout.trim(), memberId, 'CLI lists the admin');
    check(cli('revoke', memberId).status, 0, 'Revoke via CLI');
    r = await auth(member, 'dashboard', { endpoint: 'metrics' });
    check(r.status, 403, 'Revoked admin refused');
    check((await fetch(`${base}/tools/metrics-admin.php`)).status, 404, 'CLI refuses HTTP');

    r = await fetch(`${base}/api/metrics.php?action=popular`);
    const popular = await r.json();
    check([r.status, Array.isArray(popular.items), popular.items.length], [200, true, 0], 'Popular list stays empty below the data threshold');
    ok(/max-age=3600/.test(r.headers.get('cache-control')), 'Popular list is cacheable aggregate data');

    // Rate limit per hashed client (VG_RATE_SCALE=0.5 → 60 events per 10 minutes)
    let limited = null;
    for (let i = 0; i < 8 && !limited; i++) {
      r = await collect(Array(10).fill({ e: 'contact_click', p: '/', ch: 'tel' }));
      if (r.status === 429) limited = r;
    }
    ok(limited && limited.body.error === 'rate_limited', 'Rate limit engages');
    ok(dayFile().limited > 0, 'Limited events are counted, not stored as data');
    console.log(`Metrics API: ${checks} checks passed.`);
  } finally {
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 3000); } });
    const resolved = fs.realpathSync(sandbox);
    assert.ok(path.relative(fs.realpathSync(os.tmpdir()), resolved).startsWith('voltguard-metrics-api-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
