'use strict';
// Real PHP authorization and Node proxy; the workspace and staff records are synthetic.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { packageExport, ASSET_BASE } = require('../build-saha.cjs');
const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2))), counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = crypto.createHmac('sha1', key).update(counter).digest(), at = hash[19] & 15;
  return String((hash.readUInt32BE(at) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function freePort() {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); return port;
}
async function stop(child) {
  if (child.exitCode !== null) return;
  if (child.connected) child.send('vg-preview-shutdown'); else child.kill();
  await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { if (child.exitCode === null) child.kill(); resolve(); }, 3000).unref(); });
}

test('Native runtime manifest and assets enforce MFA; the retired project entry cannot serve a second application', { timeout: 30000 }, async t => {
  if (!fs.existsSync(php)) return t.skip('A PHP runtime is required for the real gate check.');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-saha-gate-'));
  const fixture = path.join(sandbox, 'site'), local = path.join(sandbox, 'private-data');
  function write(relative, bytes) { const file = path.join(fixture, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
  function copy(relative) { write(relative, fs.readFileSync(path.join(root, relative))); }
  for (const relative of ['.htaccess', 'tools/preview.cjs', 'tools/preview-router.php', 'tools/staff-admin.php',
    'api/staff.php', 'api/company.php', 'api/company-asset.php', 'api/saha-asset.php', 'calisan/uygulama/saha.php']) copy(relative);
  for (const name of fs.readdirSync(path.join(root, 'api/lib')).filter(name => name.endsWith('.php'))) copy('api/lib/' + name);
  write('index.html', '<!doctype html><title>Synthetic host</title>');
  write('SahaTakip-main/index.html', 'SYNTHETIC_SOURCE_MUST_STAY_PRIVATE');
  write('tools/saha-app/src/entry.js', 'SYNTHETIC_SOURCE_MUST_STAY_PRIVATE');
  write('tools/saha-app/dist/index.html', '<!doctype html><html><head></head><body><div id="root">SYNTHETIC_PRIVATE_SAHA</div><script defer src="' + ASSET_BASE + '_expo/static/js/web/index-test.js"></script></body></html>');
  write('tools/saha-app/dist/_expo/static/js/web/index-test.js', 'window.__SYNTHETIC_PRIVATE_SAHA=true;');
  write('tools/saha-app/dist/assets/node_modules/@expo/vector-icons/font-test.ttf', 'SYNTHETIC_PRIVATE_FONT');
  packageExport(fixture, path.join(fixture, 'tools/saha-app/dist'));
  let active;
  const cookies = new Map(); let csrf = '';
  async function start(available) {
    const base = 'http://127.0.0.1:' + await freePort();
    const child = spawn(process.execPath, [path.join(fixture, 'tools/preview.cjs')], { cwd: fixture, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, LOCALAPPDATA: local, VG_PREVIEW_PORT: base.split(':').at(-1), VG_PHP: available ? php : path.join(sandbox, 'missing-php.exe') } });
    child.stdout.resume(); child.stderr.resume();
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await fetch(base); return { base, child }; } catch (_) { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    child.kill(); throw new Error('Synthetic Saha server did not start.');
  }
  async function request(url, body, additional = {}) {
    const headers = { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...additional.headers };
    if (body) Object.assign(headers, { Origin: active.base, 'Content-Type': 'application/json', 'X-VG-STAFF-CSRF': csrf });
    const response = await fetch(active.base + url, { redirect: 'manual', method: body ? 'POST' : 'GET', ...additional, headers, body: body ? JSON.stringify(body) : undefined });
    for (const cookie of response.headers.getSetCookie()) { const first = cookie.split(';')[0], at = first.indexOf('='); cookies.set(first.slice(0, at), first.slice(at + 1)); }
    return response;
  }
  const asset = ASSET_BASE + '_expo/static/js/web/index-test.js';
  const font = ASSET_BASE + 'assets/node_modules/@expo/vector-icons/font-test.ttf';
  async function closed() {
    const page = await request('/calisan/uygulama/saha.php');
    assert.equal(page.status, 303); assert.equal(page.headers.get('location'), '/calisan/giris.html');
    assert.equal((await page.text()).includes('SYNTHETIC_PRIVATE'), false);
    for (const url of [asset, font]) { const result = await request(url); assert.equal(result.status, 401); assert.equal((await result.text()).includes('SYNTHETIC_PRIVATE'), false); }
    const attachment = await request('/api/saha-asset.php?bucket=synthetic&path=missing.png');
    assert.equal(attachment.status, 401); assert.equal((await attachment.json()).api, 'vg-company/1');
    const runtime = await request('/api/company.php?action=module_assets');
    assert.equal(runtime.status, 401); assert.equal((await runtime.json()).api, 'vg-company/1');
  }
  try {
    active = await start(true);
    await closed();
    for (const url of ['/calisan/uygulama/saha-entry.html', '/calisan/uygulama/employee-modules-manifest.json', '/calisan/uygulama/assets/saha/index.html',
      '/SahaTakip-main/index.html', '/SahaTakip-main/', '/tools/saha-app/src/entry.js']) {
      const result = await request(url); assert.ok([401, 404].includes(result.status)); assert.equal((await result.text()).includes('SYNTHETIC_'), false);
    }
    let result = await (await request('/api/staff.php?action=me')).json(); csrf = result.csrf;
    const hash = crypto.createHash('sha256').update(fs.realpathSync(fixture).toLowerCase()).digest('hex').slice(0, 20);
    const data = path.join(local, 'VoltGuard/preview-data', hash);
    const invitation = spawnSync(php, ['-n', path.join(fixture, 'tools/staff-admin.php'), 'bootstrap-invite', '--email=saha-synthetic@example.invalid', '--name=Synthetic Saha'], {
      encoding: 'utf8', windowsHide: true, env: { ...process.env, VG_DATA_DIR: data, VG_STAFF_SITE_URL: active.base }
    });
    assert.equal(invitation.status, 0, 'Synthetic invitation is created outside the real workspace.');
    const invite = JSON.parse(invitation.stdout);
    result = await (await request('/api/staff.php?action=activate', { token: new URL(invite.activationUrl).hash.slice(3), password: 'SyntheticSahaPass123!' })).json();
    assert.equal(result.mode, 'enroll'); csrf = result.csrf;
    await closed();
    result = await (await request('/api/staff.php?action=mfa_enroll', { code: totp(result.secret) })).json();
    assert.equal(result.ok, true); csrf = result.csrf;
    const page = await request('/calisan/uygulama/saha.php');
    assert.equal(page.status, 303); assert.equal(new URL(page.headers.get('location'),active.base).pathname,'/calisan/uygulama/');
    assert.doesNotMatch(await page.text(), /SYNTHETIC_PRIVATE_SAHA|<html|<iframe/i);
    assert.match(page.headers.get('cache-control'), /no-store/);
    const runtime = await request('/api/company.php?action=module_assets');
    assert.equal(runtime.status,200);assert.match(runtime.headers.get('cache-control'),/no-store/);
    const listed=await runtime.json();assert.equal(listed.api,'vg-company/1');assert.equal(listed.ok,true);
    assert.deepEqual(listed.data,{scripts:[asset],styles:[]});
    assert.equal((await request('/api/company.php?action=module_assets',{})).status,405);
    assert.equal((await request('/api/company.php?action=module_assets',undefined,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    for (const [url, type] of [[asset, 'text/javascript'], [font, 'font/ttf']]) {
      const response = await request(url + '?file=assets/other.js');
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), new RegExp(type));
      assert.match(response.headers.get('cache-control'), /private/); assert.match(await response.text(), /SYNTHETIC_PRIVATE/);
    }
    assert.equal((await request(asset, undefined, { method: 'HEAD' })).status, 200);
    assert.equal((await request('/calisan/uygulama/saha.php', undefined, { method: 'HEAD' })).status, 303);
    assert.equal((await request('/calisan/uygulama/employee-modules-manifest.json')).status,404);
    const manifest=path.join(fixture,'calisan/uygulama/employee-modules-manifest.json');
    const validManifest=fs.readFileSync(manifest);
    for(const invalid of [
      {version:1,scripts:['https://external.invalid/private.js'],styles:[]},
      {version:1,scripts:[ASSET_BASE+'../private.js'],styles:[]},
      {version:1,scripts:[ASSET_BASE+'missing.js'],styles:[]},
      {version:1,scripts:Array(9).fill(asset),styles:[]},
      {version:1,scripts:[],styles:[]},
      {version:2,scripts:[asset],styles:[]}
    ]){
      fs.writeFileSync(manifest,JSON.stringify(invalid));
      assert.equal((await request('/api/company.php?action=module_assets')).status,503,'untrusted runtime manifest fails closed');
    }
    fs.writeFileSync(manifest,validManifest);
    assert.equal((await request('/api/company.php?action=module_assets')).status,200);
    for (const file of ['employee-modules-manifest.json','assets/saha/../index.php', 'assets/saha/index.html', 'assets/saha/private.env', 'assets/saha/source.json', 'assets/saha/../../saha-entry.html']) {
      const response = await request('/api/company-asset.php?file=' + encodeURIComponent(file)); assert.equal(response.status, 404);
    }
    await stop(active.child); active = await start(false);
    for (const url of ['/calisan/uygulama/saha.php', asset, font, '/api/company.php?action=module_assets','/api/saha-asset.php?bucket=synthetic&path=missing.png']) {
      const response = await request(url); assert.equal(response.status, 503); assert.equal((await response.text()).includes('SYNTHETIC_PRIVATE'), false);
    }
  } finally {
    if (active) await stop(active.child);
    assert.equal(path.dirname(fs.realpathSync(sandbox)), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(sandbox), /^vg-saha-gate-/);
    fs.rmSync(sandbox, { recursive: true });
  }
});
