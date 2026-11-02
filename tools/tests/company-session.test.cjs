'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('Real PHP remote snapshots release only the original staff session and preserve account mutations', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-company-session-'));
  const publicRoot = path.join(directory, 'public');
  const data = path.join(directory, 'private');
  fs.mkdirSync(publicRoot); fs.mkdirSync(data);
  fs.copyFileSync(path.join(__dirname, 'company-session-fixture.php'), path.join(publicRoot, 'fixture.php'));
  const servers = [], bases = [];
  let logs = '';
  const marker = (tag, phase) => path.join(data, `marker-${tag}-${phase}.json`);
  const readMarker = (tag, phase) => JSON.parse(fs.readFileSync(marker(tag, phase), 'utf8'));
  const client = () => ({cookie: '', csrf: ''});
  async function request(base, query, actor, body) {
    const response = await fetch(`${base}/fixture.php?${query}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {Cookie: actor.cookie, ...(body === undefined ? {} : {Origin: base, 'Content-Type': 'application/json', 'X-VG-STAFF-CSRF': actor.csrf})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      signal: AbortSignal.timeout(10000),
    });
    return {status: response.status, cookies: response.headers.getSetCookie(), data: await response.json()};
  }
  function apply(actor, response) {
    for (const cookie of response.cookies) if (cookie.startsWith('VGSTAFF=')) actor.cookie = cookie.split(';')[0];
    if (response.data.csrf) actor.csrf = response.data.csrf;
  }
  async function seed(actor, code = 'a') {
    const response = await request(bases[1], `op=seed&actor=${code}`, actor);
    assert.equal(response.status, 200); apply(actor, response);
  }
  async function started(tag) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (fs.existsSync(marker(tag, 'snapshot'))) return;
      await pause(10);
    }
    throw Error('Isolated snapshot did not start.');
  }
  try {
    // Windows php -S is single-threaded. Separate processes are necessary to
    // distinguish PHP's shared session-file lock from the HTTP server itself.
    for (let index = 0; index < 2; index++) {
      const base = `http://127.0.0.1:${await freePort()}`;
      const child = spawn(php, ['-n', '-d', 'disable_functions=mail', '-S', base.slice(7), '-t', publicRoot], {
        env: {...process.env, VG_DATA_DIR: data, VG_MAIL_OUTBOX: '1', VG_SESSION_TEST_ROOT: root,
          VG_ISOLATED_SESSION_FIXTURE: 'company-session-regression'},
        stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
      });
      child.stderr.on('data', chunk => { logs += String(chunk); });
      servers.push(child); bases.push(base);
      for (let attempt = 0; attempt < 100; attempt++) {
        try { await request(base, 'op=ping', client()); break; }
        catch { if (attempt === 99) throw Error('Isolated PHP server did not start.'); await pause(25); }
      }
    }

    await t.test('Same-cookie remote snapshots overlap while handlers retain a verified session lock', async () => {
      const actor = client(); await seed(actor);
      await Promise.all(bases.map((base, index) => request(base, `op=held&tag=held-${index}`, actor)));
      const heldSpread = Math.abs(readMarker('held-0', 'snapshot').timeMs - readMarker('held-1', 'snapshot').timeMs);
      assert.ok(heldSpread >= 650, 'A retained session lock serializes the two 800 ms controls.');
      const result = await Promise.all(bases.map((base, index) => request(base, `op=remote&tag=parallel-${index}`, actor)));
      const releasedSpread = Math.abs(readMarker('parallel-0', 'snapshot').timeMs - readMarker('parallel-1', 'snapshot').timeMs);
      assert.ok(releasedSpread < 600, 'Real adapter snapshots start concurrently, before either slow request finishes.');
      for (let index = 0; index < 2; index++) {
        assert.equal(result[index].status, 200);
        assert.equal(result[index].cookies.length, 0, 'Continuation emits no fresh authentication cookie.');
        assert.equal(readMarker(`parallel-${index}`, 'snapshot').unlocked, true);
        assert.equal(readMarker(`parallel-${index}`, 'handler').locked, true);
        assert.equal(fs.existsSync(marker(`parallel-${index}`, 'commit')), false);
      }
    });

    await t.test('Concurrent logout and new login discard the old snapshot without overwriting the new cookie', async () => {
      const actor = client(); await seed(actor);
      const pending = request(bases[0], 'op=remote&tag=logout-race&mutate=1', actor);
      await started('logout-race');
      apply(actor, await request(bases[1], 'op=logout', actor));
      await seed(actor, 'b');
      const old = await pending;
      assert.equal(old.status, 401); assert.equal(old.data.code, 'staff_identity');
      assert.equal(old.cookies.length, 0, 'Strict-mode replacement cannot overwrite the newer authenticated cookie.');
      assert.equal(fs.existsSync(marker('logout-race', 'handler')), false);
      assert.equal(fs.existsSync(marker('logout-race', 'commit')), false);
      assert.equal((await request(bases[1], 'op=me', actor)).data.actor, 'b');
    });

    for (const change of ['epoch', 'role', 'disable', 'expire', 'csrf', 'principal']) {
      await t.test(`A ${change} change during the snapshot cannot reach a handler or commit`, async () => {
        const actor = client(); await seed(actor);
        const tag = `guard-${change}`;
        const pending = request(bases[0], `op=remote&tag=${tag}&mutate=1`, actor);
        await started(tag);
        assert.equal((await request(bases[1], `op=${change}`, actor)).status, 200);
        const response = await pending;
        assert.equal(response.status, 401);
        assert.equal(response.cookies.length, 0);
        assert.equal(fs.existsSync(marker(tag, 'handler')), false);
        assert.equal(fs.existsSync(marker(tag, 'commit')), false);
      });
    }

    await t.test('A validated business commit still holds the session lock and honors a late epoch rejection', async () => {
      const actor = client(); await seed(actor);
      const valid = await request(bases[0], 'op=remote&tag=valid-commit&mutate=1', actor);
      assert.equal(valid.status, 200); assert.equal(readMarker('valid-commit', 'commit').locked, true);
      assert.equal(valid.cookies.length, 0);
      const revoked = await request(bases[0], 'op=remote&tag=late-epoch&mutate=1&revoke=1', actor);
      assert.equal(revoked.status, 401);
      assert.equal(fs.existsSync(marker('late-epoch', 'handler')), true);
      assert.equal(fs.existsSync(marker('late-epoch', 'commit')), false);
      assert.equal(revoked.cookies.length, 0);
    });

    await t.test('The response can persist a legitimately missing CSRF token after continuation', async () => {
      const actor = client(); await seed(actor);
      assert.equal((await request(bases[1], 'op=clear_csrf', actor)).status, 200);
      const response = await request(bases[0], 'op=remote&tag=mint-csrf&mint_csrf=1', actor);
      assert.equal(response.status, 200); assert.equal(response.cookies.length, 0);
      assert.match(response.data.csrf, /^[a-f0-9]{64}$/);
      assert.equal((await request(bases[1], 'op=read_csrf', actor)).data.csrf, response.data.csrf,
        'The adapter keeps its resumed lock until the caller creates and persists the response token.');
    });

    await t.test('Native administrator and password RPCs bypass remote continuation and preserve normal rotation', async () => {
      const actor = client(); await seed(actor);
      let response = await request(bases[1], 'op=native&action=rpc', actor, {name: 'app_portal_account_audit', args: {}});
      assert.equal(response.status, 200); assert.equal(response.data.ok, true);
      assert.equal(Array.isArray(response.data.data), true);
      response = await request(bases[1], 'op=native&action=rpc', actor,
        {name: 'app_change_own_password', args: {p_old: 'SyntheticExisting123!', p_new: 'SyntheticChanged123!'}});
      assert.equal(response.status, 200); assert.equal(response.data.ok, true);
      assert.ok(response.cookies.some(cookie => cookie.startsWith('VGSTAFF=')), 'Password change still rotates the actual staff session cookie.');
      apply(actor, response);
      assert.equal((await request(bases[1], 'op=me', actor)).status, 401);
    });
    assert.doesNotMatch(logs, /Fatal error|Warning:/);
  } finally {
    for (const child of servers) child.kill();
    await Promise.all(servers.map(child => new Promise(resolve => {
      if (child.exitCode !== null) resolve();
      else { child.once('exit', resolve); setTimeout(resolve, 2000); }
    })));
    const target = fs.realpathSync(directory), temporary = fs.realpathSync(os.tmpdir());
    assert.ok(path.relative(temporary, target).startsWith('voltguard-company-session-'));
    fs.rmSync(target, {recursive: true, force: true});
  }
});
