/* Integration checks for the Node/PHP bridge, private data location and unavailable-PHP fallback. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

function fixtureWorkspace() {
  const parent = path.join(root, '.qa');
  fs.mkdirSync(parent, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(parent, 'preview-gate-'));
  function copy(relative) {
    const source = path.join(root, relative), target = path.join(fixture, relative);
    if (!fs.existsSync(source)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const relative of ['.htaccess', 'tools/preview.cjs', 'tools/preview-router.php', 'api/auth.php', 'api/community.php',
    'api/staff.php', 'api/company.php', 'api/company-asset.php', 'api/company-connectors.php', 'tools/staff-admin.php', 'calisan/index.php', 'calisan/uygulama/index.php', 'contact.php']) copy(relative);
  for (const name of fs.readdirSync(path.join(root, 'api/lib')).filter(name => name.endsWith('.php'))) copy('api/lib/' + name);
  function write(relative, content) {
    const target = path.join(fixture, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
  }
  for (const relative of ['index.html', 'araclar/index.html', 'topluluk.html', 'calisan/giris.html', 'calisan/etkinlestir.html']) write(relative, '<!doctype html><title>Static QA fixture</title><p>Read-only fixture</p>');
  write('calisan/uygulama/assets/protected-test.js', 'window.__PRIVATE_GATE_FIXTURE="must-not-be-public";');
  write('calisan/uygulama/fonts/protected-test.ttf', 'PRIVATE_GATE_FONT_FIXTURE');
  write('calisan/uygulama/licenses/index.html', '<p>PRIVATE_GATE_LICENSE_FIXTURE</p>');
  write('calisan/uygulama/fatura_logo.png', 'PRIVATE_GATE_LOGO_FIXTURE');
  write('calisan/uygulama/entry-tags.html', '<script src="assets/protected-test.js"></script>');
  write('calisan/uygulama/index.html', '<p>PRIVATE_GATE_ENTRY_FIXTURE</p>');
  write('calisan/uygulama/source.json', '{"private":"PRIVATE_GATE_SOURCE_FIXTURE"}');
  write('public/video/range-fixture.mp4', '0123456789');
  write('public/video/captions-fixture.vtt', 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nTürkçe altyazı\n');
  return fixture;
}

async function start(localData, phpAvailable, fixture) {
  const port = await freePort();
  const env = { ...process.env, LOCALAPPDATA: localData, VG_PREVIEW_PORT: String(port),
    VG_PHP: process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe') };
  if (!phpAvailable) env.VG_PHP = path.join(localData, 'unavailable-php.exe');
  const child = spawn(process.execPath, [path.join(fixture, 'tools/preview.cjs')], { cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  child.stdout.resume(); child.stderr.resume();
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 140; attempt++) {
    try { await fetch(base); return { child, base }; } catch (_) { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  child.kill(); throw new Error('Preview did not start.');
}

async function stop(child) {
  if (child.connected) child.send('vg-preview-shutdown'); else child.kill();
  await new Promise(resolve => {
    if (child.exitCode !== null) resolve();
    else { child.once('exit', resolve); setTimeout(() => { if (child.exitCode === null) child.kill(); resolve(); }, 3000); }
  });
}

async function run() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-preview-bridge-'));
  const fixture = fixtureWorkspace();
  let active;
  const cookies = new Map();
  let protectedStaffCookie = false;
  try {
    active = await start(sandbox, true, fixture);
    async function request(url, options = {}) {
      const headers = { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers };
      const response = await fetch(active.base + url, { redirect: 'manual', ...options, headers });
      for (const cookie of response.headers.getSetCookie()) {
        if (/^VGSTAFF=/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie)) protectedStaffCookie = true;
        const first = cookie.split(';')[0], index = first.indexOf('=');
        cookies.set(first.slice(0, index), first.slice(index + 1));
      }
      return response;
    }
    for (const url of ['/araclar/', '/topluluk.html', '/calisan/giris.html', '/calisan/etkinlestir.html']) {
      const response = await request(url);
      check(response.status, 200, `${url} remains available`);
      check(response.headers.get('content-security-policy').length > 40, true, 'Site CSP preserved');
    }
    // Browser playback and seeking must not fetch the entire movie each time.
    for (const [range, body, contentRange] of [['bytes=0-3', '0123', 'bytes 0-3/10'], ['bytes=7-', '789', 'bytes 7-9/10'], ['bytes=-2', '89', 'bytes 8-9/10'], ['bytes=8-999', '89', 'bytes 8-9/10']]) {
      const response = await request('/public/video/range-fixture.mp4', { headers: { Range: range } });
      check(response.status, 206, 'Video byte range accepted');
      check(response.headers.get('content-range'), contentRange, 'Exact video range header');
      check(response.headers.get('content-length'), String(body.length), 'Only requested byte count sent');
      check(await response.text(), body, 'Only requested video bytes sent');
    }
    for (const range of ['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=0-1,4-5', 'items=0-1']) {
      const response = await request('/public/video/range-fixture.mp4', { headers: { Range: range } });
      check(response.status, 416, 'Unsatisfiable range rejected');
      check(response.headers.get('content-range'), 'bytes */10', 'Total size returned for unsatisfiable range');
      check(await response.text(), '', 'No video data sent for rejected range');
    }
    const headVideo = await request('/public/video/range-fixture.mp4', { method: 'HEAD', headers: { Range: 'bytes=0-3' } });
    check(headVideo.status, 200, 'HEAD reports complete file metadata');
    check(headVideo.headers.get('content-length'), '10', 'HEAD returns full video length');
    check(await headVideo.text(), '', 'HEAD has no video body');
    const captions = await request('/public/video/captions-fixture.vtt');
    check(captions.headers.get('content-type'), 'text/vtt; charset=utf-8', 'Native Turkish captions have supported UTF-8 type');
    check((await captions.text()).includes('Türkçe altyazı'), true, 'Turkish caption bytes preserved');
    for (const url of ['/api/lib/staff.php', '/api/lib/community.php', '/api/COMMUNITY.md', '/tools/staff-admin.php', '/tools/preview-router.php', '/voltguardekleyelim/', '/.qa/php/runtime/php.exe', '/_vgdata/users.json', '/calisan/shared-header.html', '/calisan/shared-footer.html', '/api/auth.php/extra',
      '/calisan/uygulama/entry-tags.html', '/calisan/uygulama/index.html', '/calisan/uygulama/index.php', '/calisan/uygulama/source.json', '/calisan/uygulama/src/main.jsx']) {
      const response = await request(url);
      check(response.status, 404, `${url} never exposes source or private files`);
      check((await response.text()).includes('<?php'), false, 'No PHP source response');
    }
    // The preview executes the real contact endpoint (outbox mode): it accepts only POST and never shows source.
    const contactGet = await request('/contact.php');
    check(contactGet.status, 405, 'Preview contact endpoint runs PHP and rejects GET');
    const contactBody = await contactGet.text();
    check(contactBody.includes('<?php'), false, 'Contact endpoint never returns PHP source');
    check(JSON.parse(contactBody).success, false, 'Contact GET returns a JSON refusal');
    for(const url of ['/api.new','/api.new/company.php','/calisan.new','/calisan.new/uygulama/assets/private.js'])check((await request(url)).status,404,'Deployment staging path is never served');
    const privateFiles = ['/api/company.php?action=bootstrap', '/api/company-asset.php?file=assets/protected-test.js',
      '/calisan/uygulama/assets/protected-test.js', '/calisan/uygulama/fonts/protected-test.ttf',
      '/calisan/uygulama/licenses/index.html', '/calisan/uygulama/fatura_logo.png',
      '/calisan/uygulama/assets/protected-test.js?file=entry-tags.html'];
    const connectorExpected = fs.existsSync(path.join(fixture, 'api/company-connectors.php')) ? 401 : 503;
    for (const url of [...privateFiles, '/api/company-connectors.php?action=status']) {
      const denied = await request(url);
      check(denied.status, url.includes('company-connectors') ? connectorExpected : 401, 'Anonymous caller cannot read company assets or APIs');
      const text = await denied.text();
      check(text.includes('PRIVATE_GATE_') || text.includes('must-not-be-public') || text.includes('<?php'), false, 'Actual source fixture bytes never leave the gate');
      check(JSON.parse(text).api, 'vg-company/1', 'Private API uses company error envelope');
    }
    for (const url of ['/calisan/uygulama', '/calisan/uygulama/']) {
      const denied = await request(url);
      check(denied.status, 303, 'Private workspace runs PHP auth without slash redirect');
      check(denied.headers.get('location'), '/calisan/giris.html', 'Private workspace redirects directly to employee login');
    }
    let response = await request('/api/auth.php?action=me');
    check(response.status, 200, 'Account API executes PHP through proxy');
    let result = await response.json();
    check(result.api, 'vg-auth/1', 'Real account API envelope');
    check(/^[a-f0-9]{64}$/.test(result.csrf), true, 'Real account CSRF');
    const csrf = result.csrf;
    check(response.headers.getSetCookie().some(cookie => /^VGSESS=/.test(cookie) && /HttpOnly/i.test(cookie)), true, 'Account Set-Cookie survives proxy');
    const unique = `${Date.now()}-${process.pid}`;
    response = await request('/api/auth.php?action=register', { method: 'POST', headers: { Origin: active.base, 'Content-Type': 'application/json', 'X-VG-CSRF': csrf }, body: JSON.stringify({ name: 'Önizleme Testi', email: `preview-${unique}@example.test`, password: 'Deneme12345', consent: true }) });
    check(response.status, 201, 'Public membership writes use frontend origin');
    result = await response.json();
    check(result.user.name, 'Önizleme Testi', 'Public membership genuinely created in isolated store');
    for (const url of privateFiles) {
      response = await request(url);
      check(response.status, 401, 'Public membership never authorizes private assets or API');
      check((await response.text()).includes('PRIVATE_GATE_'), false, 'Public member receives no private fixture bytes');
    }
    response = await request('/api/staff.php?action=me');
    check(response.status, 200, 'Employee API executes through proxy');
    result = await response.json();
    check(result.api, 'vg-staff/1', 'Independent employee envelope');
    check(result.user, null, 'Public membership does not establish employee identity');
    check(protectedStaffCookie, true, 'Independent employee cookie survives proxy');
    const staffCsrf = result.csrf;
    const syntheticHash = fs.readdirSync(path.join(sandbox, 'VoltGuard/preview-data'))[0];
    const syntheticData = path.join(sandbox, 'VoltGuard/preview-data', syntheticHash);
    const invitation = spawnSync(process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe'), ['-n', path.join(fixture, 'tools/staff-admin.php'),
      'bootstrap-invite', '--email=preview-mfa@example.invalid', '--name=Preview MFA Test'], {env:{...process.env, VG_DATA_DIR:syntheticData, VG_STAFF_SITE_URL:active.base}, encoding:'utf8', windowsHide:true});
    check(invitation.status, 0, 'Synthetic employee invitation uses only isolated fixture data');
    const invite = JSON.parse(invitation.stdout);
    response = await request('/api/staff.php?action=activate', {method:'POST', headers:{Origin:active.base,'Content-Type':'application/json','X-VG-STAFF-CSRF':staffCsrf},
      body:JSON.stringify({token:new URL(invite.activationUrl).hash.slice(3),password:'PreviewSyntheticMfa123!'})});
    check(response.status, 200, 'Synthetic employee reaches MFA enrollment');
    result = await response.json();
    check(result.mode, 'enroll', 'MFA remains incomplete in this fixture');
    for (const url of privateFiles) {
      response = await request(url);
      check(response.status, 401, 'Password activation without MFA cannot read private assets or company API');
      const text = await response.text();
      check(text.includes('PRIVATE_GATE_') || text.includes('must-not-be-public'), false, 'Pending MFA never receives private fixture bytes');
      check(JSON.parse(text).api, 'vg-company/1', 'Pending MFA receives company error envelope');
    }
    response = await request('/api/staff.php?action=payroll_list');
    check(response.status, 401, 'Public member cannot read payroll');
    for (const url of ['/calisan/', '/calisan/index.php']) {
      response = await request(url);
      check(response.status, 303, 'Protected panel executes authorization before HTML');
      check(response.headers.get('location'), '/calisan/giris.html', 'Unauthenticated panel redirects to employee login');
    }
    response = await request('/api/community.php?action=list');
    check(response.status, 200, 'Community API executes PHP');
    result = await response.json();
    check(result.items, [], 'Preview server does not seed fake comments');
    response = await request('/api/community.php?action=publish', { method: 'POST', headers: { Origin: 'https://outside.example', 'Content-Type': 'application/json', 'X-VG-CSRF': result.csrf }, body: JSON.stringify({ message: 'Origin testi.' }) });
    check(response.status, 403, 'Proxy preserves rejected cross-origin request');
    response = await request('/api/staff.php?action=me', { headers: { 'X-Forwarded-Proto': 'https' } });
    check(response.status, 200, 'Spoofed forwarding header cannot change local scheme');
    const foreignStatus = await new Promise((resolve, reject) => {
      http.get(active.base + '/api/auth.php?action=me', { headers: { Host: 'outside.example' } }, reply => { reply.resume(); resolve(reply.statusCode); }).on('error', reject);
    });
    check(foreignStatus, 403, 'Loopback server rejects foreign Host');
    const hashes = fs.readdirSync(path.join(sandbox, 'VoltGuard/preview-data'));
    check(hashes.length, 1, 'Workspace has one stable private preview directory');
    const data = path.join(sandbox, 'VoltGuard/preview-data', hashes[0]);
    check(fs.existsSync(path.join(data, 'store.kind')), true, 'API data lives outside document root');
    check(fs.existsSync(path.join(data, 'staff/sessions')), true, 'Employee sessions live outside document root');
    await stop(active.child); active = null;

    active = await start(sandbox, false, fixture);
    for (const url of ['/araclar/', '/topluluk.html', '/calisan/giris.html']) {
      response = await fetch(active.base + url);
      check(response.status, 200, 'Static site works without PHP');
    }
    for (const url of ['/api/auth.php?action=me', '/api/community.php?action=list', '/api/staff.php?action=me', '/calisan/', '/calisan/index.php',
      '/api/company.php?action=bootstrap', '/api/company-asset.php?file=assets/protected-test.js', '/api/company-connectors.php?action=status',
      '/calisan/uygulama', '/calisan/uygulama/', '/calisan/uygulama/assets/protected-test.js', '/calisan/uygulama/fonts/protected-test.ttf',
      '/calisan/uygulama/licenses/index.html', '/calisan/uygulama/fatura_logo.png']) {
      response = await fetch(active.base + url, { redirect: 'manual' });
      check(response.status, 503, 'Missing PHP keeps API and private panel closed');
      const text = await response.text();
      check(text.includes('<?php') || text.includes('PRIVATE_GATE_') || text.includes('must-not-be-public'), false, 'Missing PHP cannot expose source');
      if (/company(?:-asset|-connectors)?\.php/.test(url) || /uygulama\/(?:assets|fonts|licenses|fatura_logo)/.test(url)) {
        check(JSON.parse(text).api, 'vg-company/1', 'Unavailable private proxy keeps company envelope');
      }
    }
    for (const url of ['/calisan/uygulama/entry-tags.html', '/calisan/uygulama/index.html', '/calisan/uygulama/source.json']) {
      response = await fetch(active.base + url);
      check(response.status, 404, 'Missing PHP never falls through to private static files');
    }
    for(const url of ['/api.new','/api.new/company.php','/calisan.new','/calisan.new/uygulama/assets/private.js'])check((await fetch(active.base+url)).status,404,'Missing PHP never exposes deployment staging paths');
    console.log(`Preview bridge: ${checks} checks passed; all test data isolated outside workspace.`);
  } finally {
    if (active) await stop(active.child);
    const resolved = fs.realpathSync(sandbox);
    const relative = path.relative(fs.realpathSync(os.tmpdir()), resolved);
    assert.ok(relative.startsWith('voltguard-preview-bridge-') && !relative.includes(path.sep), 'Cleanup restricted to named temporary test directory');
    fs.rmSync(resolved, { recursive: true, force: true });
    const fixtureResolved = fs.realpathSync(fixture);
    const fixtureRelative = path.relative(fs.realpathSync(path.join(root, '.qa')), fixtureResolved);
    assert.ok(fixtureRelative.startsWith('preview-gate-') && !fixtureRelative.includes(path.sep), 'Fixture cleanup stays inside the named hidden test directory');
    fs.rmSync(fixtureResolved, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
