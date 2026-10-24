/* First-party metrics: real PHP/HTTP checks (anonymity, aggregation, bot filter, rate limit, admin-only dashboard)
 * plus client-side Do Not Track handling of js/vg-metrics.js. All data lives in a temporary private directory. */
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
let checks = 0;
const check = (actual, expected, why) => { assert.deepEqual(actual, expected, why); checks++; };
const ok = (value, why) => { assert.ok(value, why); checks++; };

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

/* ---------- client: Do Not Track / GPC are honoured before any request ---------- */
function runClient({ dnt, gpc, webdriver, referrer = '', pathname = '/', ua = UA }) {
  const beacons = [];
  const listeners = {};
  const document = { referrer, prerendering: false, visibilityState: 'visible',
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); } };
  const window = {
    location: { protocol: 'https:', hostname: 'voltguard.com.tr', pathname },
    navigator: { userAgent: ua, doNotTrack: dnt, globalPrivacyControl: gpc, webdriver,
      sendBeacon(url, blob) { beacons.push({ url, blob }); return true; } },
    addEventListener() {}, fetch() { throw new Error('fetch must not be used when sendBeacon succeeds'); }
  };
  class Blob { constructor(parts, options) { this.text = parts.join(''); this.type = options.type; } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/vg-metrics.js'), 'utf8'),
    { window, document, Blob, URL, setTimeout, clearTimeout, JSON });
  return { window, beacons, listeners };
}

function clientChecks() {
  let c = runClient({ dnt: '1' });
  check(c.beacons.length, 0, 'navigator.doNotTrack=1 sends nothing');
  check(c.window.vgTrack.enabled, false, 'DNT disables the tracker');
  check(c.window.vgTrack('tel_click'), false, 'vgTrack is a no-op under DNT');
  check(c.beacons.length, 0, 'No beacon after explicit event under DNT');
  c = runClient({ gpc: true });
  check(c.beacons.length, 0, 'Global Privacy Control sends nothing');
  c = runClient({ webdriver: true });
  check(c.beacons.length, 0, 'Automation (navigator.webdriver) is not counted');
  c = runClient({ referrer: 'https://www.google.com.tr/search?q=voltguard+trafo', pathname: '/hesaplama/kablo-kesiti-hesaplama.html',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  check(c.beacons.length, 1, 'One pageview beacon without opt-out');
  check(c.beacons[0].url, '/api/metrics.php?action=collect', 'Beacon goes to first-party endpoint');
  check(c.beacons[0].blob.type, 'text/plain;charset=UTF-8', 'Beacon uses a CORS-safelisted content type');
  const sent = JSON.parse(c.beacons[0].blob.text);
  check(sent, { v: 1, ev: [{ e: 'pageview', p: '/hesaplama/kablo-kesiti-hesaplama/', r: 'arama', d: 'mobil', se: 'google' }] },
    'Pageview carries only normalized path, referrer category, engine name and device class');
  ok(!c.beacons[0].blob.text.includes('voltguard+trafo') && !c.beacons[0].blob.text.includes('iPhone'), 'Search terms and UA never leave the browser');
  c.window.vgTrack('sim_start', { sim: 'trafo', extra: 'x@example.com' });
  c.window.vgTrack('sim_start', { sim: 'trafo' });
  c.window.vgTrack('tel_click');
  const second = JSON.parse(c.beacons[1].blob.text).ev;
  check(second, [{ e: 'sim_start', p: '/hesaplama/kablo-kesiti-hesaplama/', sim: 'trafo' }, { e: 'tel_click', p: '/hesaplama/kablo-kesiti-hesaplama/' }],
    'Unknown props dropped, sim_start deduplicated per page view, tel click flushed immediately');
  check(c.window.vgTrack('evil_event'), false, 'Unknown event names are refused client-side');
  c = runClient({ referrer: 'https://voltguard.com.tr/bilgi-bankasi.html' });
  check(JSON.parse(c.beacons[0].blob.text).ev[0].r, 'ic', 'Same-site navigation is internal, not a new visit');
  c = runClient({ referrer: 'https://www.linkedin.com/feed/' });
  check(JSON.parse(c.beacons[0].blob.text).ev[0].r, 'sosyal', 'Social referrer category');
}

async function run() {
  clientChecks();
  const probe = spawnSync(php, ['-n', '-v'], { encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) throw new Error('Set VG_PHP to a PHP 7.4+ executable to run these checks.');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-metrics-api-'));
  const environment = { ...process.env, VG_DATA_DIR: sandbox, VG_STORE: 'json', VG_MAIL_OUTBOX: '1', VG_RATE_SCALE: '0.2' };
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(php, ['-n', '-S', `127.0.0.1:${port}`, '-t', root], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.resume(); child.stderr.resume();

  async function collect(events, headers = {}, raw) {
    const response = await fetch(`${base}/api/metrics.php?action=collect`, { method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: base, 'User-Agent': UA, ...headers },
      body: raw !== undefined ? raw : JSON.stringify({ v: 1, ev: events }) });
    return { status: response.status, body: await response.json(), headers: response.headers };
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
  const dayFile = () => {
    const dir = path.join(sandbox, 'metrics/days');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [];
    return files.length ? JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8')) : null;
  };

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { await fetch(`${base}/api/metrics.php?action=popular`); ready = true; break; } catch (_) { await new Promise(r => setTimeout(r, 50)); }
    }
    assert.ok(ready, 'PHP test server starts');

    let r = await collect([{ e: 'pageview', p: '/', r: 'arama', se: 'google', d: 'mobil' }]);
    check([r.status, r.body.accepted], [200, 1], 'Pageview accepted');
    check(r.headers.getSetCookie().length, 0, 'Collect never sets a cookie');
    check(fs.existsSync(path.join(sandbox, 'sessions')) && fs.readdirSync(path.join(sandbox, 'sessions')).some(f => f.startsWith('sess_')), false, 'Collect never opens a server session');

    // Aggregation across dimensions
    r = await collect([
      { e: 'pageview', p: '/hesaplama/kablo-kesiti-hesaplama/', r: 'ic', d: 'masaustu' },
      { e: 'pageview', p: '/hizmetler/trafo-bakimi.html', r: 'sosyal', d: 'tablet' },
      { e: 'pageview', p: '/bu-sayfa-yok-12345/', r: 'dogrudan', d: 'masaustu' },
      { e: 'pageview', p: '/calisan/panel.html', r: 'dogrudan', d: 'masaustu' },
      { e: 'sim_start', p: '/voltsim/trafo/', sim: 'trafo' }, { e: 'sim_start', p: '/voltsim/trafo/', sim: 'trafo' },
      { e: 'sim_complete', p: '/voltsim/trafo/', sim: 'trafo' },
      { e: 'tool_use', p: '/hesaplama/kablo-kesiti-hesaplama/', tool: 'kablo-kesiti-hesaplama' },
      { e: 'tool_quote', p: '/hesaplama/kablo-kesiti-hesaplama/', tool: 'kablo-kesiti-hesaplama' },
      { e: 'quote_submit', p: '/', svc: 'trafo-merkezi-kurulumu', via: 'arac' },
      { e: 'whatsapp_click', p: '/' }, { e: 'tel_click', p: '/' }, { e: 'newsletter_subscribe', p: '/' },
      { e: 'pageview', p: '/', r: 'arama', se: 'not-an-engine', d: 'phone', ip: '10.1.2.3', ua: 'secret-agent' },
      { e: 'drop_table', p: '/' }, { e: 'sim_start', p: '/', sim: '../../etc' }
    ]);
    check([r.status, r.body.accepted], [200, 13], 'Valid events accepted; invalid names, slugs and /calisan/ are dropped');
    let day = dayFile();
    check(day.pv, 5, 'Five pageviews counted');
    check(day.entries, 4, 'Internal navigation is not an entry (visit)');
    check(day.pages['/hesaplama/kablo-kesiti-hesaplama/'], 1, 'Clean URL path counted');
    check(day.pages['/hizmetler/trafo-bakimi.html'], 1, 'Existing .html page counted');
    check(day.pages['(bilinmeyen sayfa)'], 1, 'Non-existent paths cannot create new keys');
    check(day.ref, { arama: 2, sosyal: 1, dogrudan: 1 }, 'Referrer categories');
    check(day.se, { google: 1, diger: 1 }, 'Unknown search engine folded into "diger"');
    check(day.dev, { mobil: 1, masaustu: 3, tablet: 1 }, 'Device classes (invalid class defaults to masaustu)');
    check([day.sim_start.trafo, day.sim_complete.trafo], [2, 1], 'Simulation start/complete per module');
    check([day.tool['kablo-kesiti-hesaplama'], day.tool_quote['kablo-kesiti-hesaplama']], [1, 1], 'Tool use and tool quote click');
    check([day.quote['trafo-merkezi-kurulumu'], day.quote_via.arac], [1, 1], 'Quote conversion with source');
    check([day.ev.whatsapp_click, day.ev.tel_click, day.ev.newsletter_subscribe], [1, 1, 1], 'Contact and newsletter events');
    check(day.sec['hesap-araclari'], 1, 'Pages grouped into site sections');

    // VolTHaber category (pages built by another module): exercised directly against the aggregation function.
    const snippet = `define('VG_API',1);require 'api/lib/bootstrap.php';require 'api/lib/metrics.php';$d=vg_metrics_empty_day('2026-01-01');` +
      `vg_metrics_apply($d,['e'=>'pageview','p'=>'/volthaber/ornek-haber/','r'=>'arama','se'=>'google','d'=>'mobil']);` +
      `echo json_encode([$d['ev']['volthaber_view'],$d['vh']['/volthaber/ornek-haber/'],vg_metrics_section('/volthaber/ornek-haber/')]);`;
    const vh = spawnSync(php, ['-n', '-r', snippet], { cwd: root, env: environment, encoding: 'utf8', windowsHide: true });
    check(JSON.parse(vh.stdout), [1, 1, 'volthaber'], 'Pageviews under /volthaber/ count as VoltHaber views');

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
    check((await collect(null, {}, '{"v":1,"ev":"x"}')).status, 400, 'Malformed body');
    check((await collect(null, {}, JSON.stringify({ v: 1, ev: Array(21).fill({ e: 'tel_click', p: '/' }) }))).status, 400, 'At most 20 events per request');
    check((await collect([{ e: 'tel_click', p: '/' }], { Origin: 'https://evil.example' })).status, 403, 'Cross-origin beacons refused');
    check((await collect([{ e: 'tel_click', p: '/' }], { 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'Cross-site fetch metadata refused');
    check((await fetch(`${base}/api/metrics.php?action=collect`)).status, 405, 'Collect is POST only');

    // Anonymity: nothing stored contains the IP, the User-Agent or raw referrers
    const stored = walk(path.join(sandbox, 'metrics')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
    ok(!stored.includes('127.0.0.1') && !stored.includes('::1'), 'No IP address stored');
    ok(!/Mozilla|VgMetricsProbe|Googlebot|HeadlessChrome|curl/.test(stored), 'No User-Agent stored');
    ok(!stored.includes('secret-agent') && !stored.includes('10.1.2.3'), 'Unexpected client fields are never stored');
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
    const grant = spawnSync(php, ['-n', path.join(root, 'tools/metrics-admin.php'), 'grant', memberId], { env: environment, encoding: 'utf8', windowsHide: true });
    check(grant.status, 0, 'Admin granted through private CLI only');
    r = await auth(member, 'dashboard', { endpoint: 'metrics', csrf: '0'.repeat(64) });
    check([r.status, r.body.error], [403, 'csrf'], 'Dashboard requires the session CSRF token');
    r = await auth(member, 'dashboard', { endpoint: 'metrics', headers: { Origin: 'https://evil.example' } });
    check(r.status, 403, 'Dashboard refuses foreign origins');
    r = await auth(member, 'dashboard', { endpoint: 'metrics', query: { days: '9999' } });
    check([r.status, r.body.error], [422, 'invalid_range'], 'Range is whitelisted');
    r = await auth(member, 'dashboard', { endpoint: 'metrics', query: { days: '30' } });
    check(r.status, 200, 'Granted admin reads the dashboard');
    check(r.body.totals.pv, 5, 'Dashboard totals match stored aggregates');
    check(r.body.series.length, 30, 'Daily series covers the selected range');
    check(r.body.searchConsole, null, 'No fabricated Search Console data');
    check(r.body.plan.baseline, null, 'No baseline before 30 days of data');
    check(r.body.sims, [{ sim: 'trafo', start: 2, complete: 1 }], 'Simulation start→complete data');
    check(r.body.bots, 4, 'Bot count reported');
    const list = spawnSync(php, ['-n', path.join(root, 'tools/metrics-admin.php'), 'list'], { env: environment, encoding: 'utf8', windowsHide: true });
    check(list.stdout.trim(), memberId, 'CLI lists the admin');
    check(spawnSync(php, ['-n', path.join(root, 'tools/metrics-admin.php'), 'revoke', memberId], { env: environment, encoding: 'utf8', windowsHide: true }).status, 0, 'Revoke via CLI');
    r = await auth(member, 'dashboard', { endpoint: 'metrics' });
    check(r.status, 403, 'Revoked admin refused');
    check((await fetch(`${base}/tools/metrics-admin.php`)).status, 404, 'CLI refuses HTTP');

    r = await fetch(`${base}/api/metrics.php?action=popular`);
    const popular = await r.json();
    check([r.status, Array.isArray(popular.items), popular.items.length], [200, true, 0], 'Popular list stays empty below the data threshold');
    ok(/max-age=3600/.test(r.headers.get('cache-control')), 'Popular list is cacheable aggregate data');

    // Rate limit per hashed client (VG_RATE_SCALE=0.2 → 24 events per 10 minutes)
    let limited = null;
    for (let i = 0; i < 4 && !limited; i++) {
      r = await collect(Array(10).fill({ e: 'tel_click', p: '/' }));
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
