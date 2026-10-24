/* Employee isolation checks against a real PHP/HTTP server. Uses only temporary synthetic data. */
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const extensions = path.join(path.dirname(php), 'ext');
const phpArgs = ['-n', ...(fs.existsSync(path.join(extensions, 'php_fileinfo.dll')) ? ['-d', `extension_dir=${extensions}`, '-d', 'extension=fileinfo'] : [])];
let checks = 0;
function check(actual, expected, reason) { assert.deepEqual(actual, expected, reason); checks++; }

function totp(secret, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map(char => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const hash = crypto.createHmac('sha1', key).update(counter).digest();
  const position = hash[19] & 15;
  return String((hash.readUInt32BE(position) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function port() {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const value = listener.address().port; await new Promise(resolve => listener.close(resolve)); return value;
}

async function run() {
  const probe = spawnSync(php, [...phpArgs, '-v'], { encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) throw Error('Set VG_PHP to a PHP executable with fileinfo to run employee API checks.');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-staff-api-'));
  const publicFixture = path.join(root, '.qa', `staff-storage-privacy-${crypto.randomBytes(10).toString('hex')}`);
  fs.mkdirSync(publicFixture, { recursive: true });
  const base = `http://127.0.0.1:${await port()}`;
  const environment = { ...process.env, VG_DATA_DIR: sandbox, VG_STAFF_SITE_URL: base, VG_STORE: 'json', VG_MAIL_OUTBOX: '1', VG_RATE_SCALE: '1' };
  const child = spawn(php, [...phpArgs, '-S', base.slice(7), '-t', root], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stderr.resume(); child.stdout.resume();
  const client = () => ({ cookies: new Map(), csrf: '' });
  const admin = client(), employee = client(), second = client(), outsider = client(), payroll = client();

  async function request(actor, action, options = {}) {
    const endpoint = options.endpoint || 'staff';
    const query = new URLSearchParams({ action, ...options.query });
    const method = options.method || (options.body !== undefined || options.form ? 'POST' : 'GET');
    const headers = { Cookie: [...actor.cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers };
    let body;
    if (method === 'POST') {
      if (options.origin !== false) headers.Origin ||= base;
      if (options.csrf !== false) headers[endpoint === 'auth' ? 'X-VG-CSRF' : 'X-VG-STAFF-CSRF'] = options.csrf || actor.csrf;
      if (options.form) body = options.form;
      else { headers['Content-Type'] ||= 'application/json'; body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body || {}); }
    }
    const response = await fetch(`${base}/api/${endpoint}.php?${query}`, { method, headers, body });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';')[0], at = first.indexOf('='); actor.cookies.set(first.slice(0, at), first.slice(at + 1));
    }
    const data = options.raw ? await response.text() : await response.json();
    if (data.csrf) actor.csrf = data.csrf;
    return { status: response.status, data, headers: response.headers };
  }

  async function expect(actor, action, options, status, error) {
    const result = await request(actor, action, options); check(result.status, status, `${action} HTTP status`);
    if (error) check(result.data.error, error, `${action} error`); return result;
  }

  const token = invite => new URL(invite.activationUrl).hash.slice(3);
  const password = 'TemporarySecure123!';
  const stateFile = path.join(sandbox, 'staff/state.json');
  const mutate = callback => { const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); callback(state); fs.writeFileSync(stateFile, JSON.stringify(state)); };
  async function activate(actor, invite) {
    await expect(actor, 'me', {}, 200);
    const result = await expect(actor, 'activate', { body: { token: token(invite), password } }, 200);
    check(result.data.mode, 'enroll', 'Invitation requires mandatory TOTP enrollment');
    check(result.data.otpauth.startsWith('otpauth://totp/'), true, 'Authenticator uses local otpauth URI');
    check(/^[A-Z2-7]{32}$/.test(result.data.secret), true, 'Authenticator has 160-bit random secret');
    actor.secret = result.data.secret;
    return result;
  }
  async function enroll(actor) {
    actor.enrollCode = totp(actor.secret);
    const result = await expect(actor, 'mfa_enroll', { body: { code: actor.enrollCode } }, 200);
    actor.user = result.data.user; return result;
  }
  function upload(statementId, contents, type = 'application/pdf', filename = 'bordro.pdf') {
    const form = new FormData(); form.set('statementId', statementId); form.set('pdf', new Blob([contents], { type }), filename); return form;
  }
  async function panel(actor, expected) {
    const response = await fetch(`${base}/calisan/index.php`, { redirect: 'manual', headers: { Cookie: [...actor.cookies].map(([key, value]) => `${key}=${value}`).join('; ') } });
    check(response.status, expected, 'Server renders panel only after mandatory MFA');
    check(response.headers.get('cache-control').includes('no-store'), true, 'Every panel response/redirect excludes private cache');
    const body = await response.text();
    check(body.includes('<?php'), false, 'Panel never returns PHP source');
    if (expected === 303) { check(response.headers.get('location'), '/calisan/giris.html', 'Unauthenticated/pending panel redirects to employee login'); check(body, '', 'Unauthenticated panel has no private HTML'); }
    else check(body.includes('Bordrolarım'), true, 'Authenticated panel renders its guarded shell');
  }

  try {
    // Public fixture stays EMPTY. All account and payroll test data remains outside the web root.
    const privacyProbe = 'define("VG_API",1); $_SERVER["DOCUMENT_ROOT"]=$argv[1]; require $argv[1]."/api/lib/bootstrap.php"; require $argv[1]."/api/lib/security.php"; require $argv[1]."/api/lib/staff.php"; try {$dir=vg_staff_dir(); if($argv[2]==="sessions") vg_staff_session_start(); elseif($argv[2]==="documents") vg_staff_private_directory($dir."/documents",$dir); echo "unexpected";} catch(VgHttpError $e) {echo json_encode(["status"=>$e->status,"error"=>$e->errCode]); exit(3);}';
    for (const kind of ['staff', 'sessions', 'documents']) {
      const guardedData = path.join(sandbox, `privacy-${kind}`); fs.mkdirSync(guardedData);
      if (kind !== 'staff') fs.mkdirSync(path.join(guardedData, 'staff'));
      const link = kind === 'staff' ? path.join(guardedData, 'staff') : path.join(guardedData, 'staff', kind);
      fs.symlinkSync(publicFixture, link, process.platform === 'win32' ? 'junction' : 'dir');
      const guard = spawnSync(php, [...phpArgs, '-r', privacyProbe, root, kind], { env: { ...environment, VG_DATA_DIR: guardedData }, encoding: 'utf8', windowsHide: true });
      check(guard.status, 3, `${kind} physical public junction fails closed`);
      check(JSON.parse(guard.stdout), { status: 503, error: 'staff_private_storage' }, `${kind} public target rejected before private storage writes`);
      check(fs.readdirSync(publicFixture), [], 'No session, database, document or secret written into public fixture');
      fs.unlinkSync(link);
    }
    for (let i = 0; i < 100; i++) {
      try { await fetch(`${base}/api/staff.php?action=me`); break; } catch { if (i === 99) throw Error('PHP employee test server did not start'); await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    let result = await expect(outsider, 'me', {}, 200);
    check(result.data.user, null, 'No default employee or admin');
    check(result.data.api, 'vg-staff/1', 'Separate employee API version');
    check(result.headers.getSetCookie().some(value => /^VGSTAFF=/.test(value) && /HttpOnly/.test(value) && /SameSite=Strict/.test(value)), true, 'Separate HttpOnly Strict employee cookie');
    check(result.headers.get('cache-control').includes('no-store'), true, 'Private responses cannot be cached');
    await panel(outsider, 303);
    await expect(outsider, 'register', { body: {} }, 404, 'staff_action_not_found');
    await expect(outsider, 'payroll_list', {}, 401, 'staff_unauthorized');
    await expect(outsider, 'users', {}, 401, 'staff_unauthorized');
    await expect(outsider, 'create_invite', { body: { email: 'outside@example.test', name: 'Outside', role: 'admin' } }, 401, 'staff_unauthorized');
    await expect(outsider, 'mfa_verify', { body: { code: '000000' } }, 401, 'staff_challenge_expired');
    await expect(outsider, 'login', { body: { email: 'outside@example.test', password }, csrf: false }, 403, 'staff_csrf');
    await expect(outsider, 'login', { body: { email: 'outside@example.test', password }, headers: { Origin: 'https://outside.example' } }, 403, 'staff_origin');
    await expect(outsider, 'login', { body: { email: 'outside@example.test', password }, origin: false }, 403, 'staff_origin');
    await expect(outsider, 'login', { body: { email: 'outside@example.test', password }, headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403, 'forbidden_origin');
    await expect(outsider, 'login', { body: { email: 'outside@example.test', password }, headers: { 'Content-Type': 'text/plain' } }, 415, 'unsupported_media_type');
    await expect(outsider, 'login', { method: 'GET' }, 405, 'staff_method');

    const publicUser = client(); await expect(publicUser, 'me', { endpoint: 'auth' }, 200);
    await expect(publicUser, 'register', { endpoint: 'auth', body: { name: 'Public VoltGuard User', email: 'info@voltguard.com.tr', password: 'PublicPassword123', company: 'VoltGuard', consent: true } }, 201);
    const publicCookie = publicUser.cookies.get('VGSESS'); check(typeof publicCookie, 'string', 'Public account really logged in');
    await expect(publicUser, 'me', {}, 200);
    check((await request(publicUser, 'me')).data.user, null, 'Company email and public login grant no employee role');
    await expect(publicUser, 'payroll_list', {}, 401, 'staff_unauthorized');
    await expect(publicUser, 'create_invite', { body: { email: 'public@example.test', name: 'Public', role: 'admin' } }, 401, 'staff_unauthorized');

    const initial = spawnSync(php, [...phpArgs, path.join(root, 'tools/staff-admin.php'), 'bootstrap-invite', '--email', 'admin@example.test', '--name', 'Test Administrator'], { env: environment, encoding: 'utf8', windowsHide: true });
    check(initial.status, 0, 'First administrator provisioned only through private CLI');
    const firstInvite = JSON.parse(initial.stdout);
    check(firstInvite.activationUrl.startsWith(`${base}/calisan/etkinlestir.html#t=`), true, 'Davet origin uses trusted configuration');
    const repeated = spawnSync(php, [...phpArgs, path.join(root, 'tools/staff-admin.php'), 'bootstrap-invite', '--email', 'second-admin@example.test', '--name', 'Second Administrator'], { env: environment, encoding: 'utf8', windowsHide: true });
    check(repeated.status, 1, 'No repeated administrator bootstrap');
    check(JSON.parse(repeated.stderr).error, 'staff_bootstrapped', 'Bootstrap conflict fails explicitly');
    check((await fetch(`${base}/tools/staff-admin.php`)).status, 404, 'Private CLI refuses direct HTTP');
    await expect(outsider, 'activate', { body: { token: '0'.repeat(64), password } }, 400, 'staff_invite_invalid');
    await expect(outsider, 'activate', { body: { token: token(firstInvite), password: 'short' } }, 422, 'staff_password');
    await expect(outsider, 'activate', { body: { token: token(firstInvite), password: 'ş'.repeat(40) } }, 422, 'staff_password');
    await activate(admin, firstInvite);
    await panel(admin, 303);
    await expect(admin, 'payroll_list', {}, 401, 'staff_unauthorized');
    await expect(admin, 'users', {}, 401, 'staff_unauthorized');
    await expect(admin, 'create_invite', { body: { email: 'bypass@example.test', name: 'Bypass', role: 'admin' } }, 401, 'staff_unauthorized');
    const pending = await request(admin, 'me'); check(pending.data.mfa.secret, admin.secret, 'Reload recovers same private enrollment challenge');
    await expect(outsider, 'activate', { body: { token: token(firstInvite), password } }, 400, 'staff_invite_invalid');
    await expect(admin, 'mfa_verify', { body: { code: totp(admin.secret) } }, 401, 'staff_challenge_expired');
    await enroll(admin); check(admin.user.role, 'admin', 'CLI invited administrator becomes admin only after MFA');
    await panel(admin, 200);
    await expect(admin, 'disable_user', { body: { userId: admin.user.id } }, 409, 'staff_self_disable');

    result = await expect(admin, 'create_invite', { body: { email: 'employee@example.test', name: 'First Employee', role: 'employee' } }, 200);
    const firstEmployee = result.data; await activate(employee, firstEmployee); await enroll(employee);
    result = await expect(admin, 'create_invite', { body: { email: 'second@example.test', name: 'Second Employee', role: 'employee' } }, 200);
    await activate(second, result.data); await enroll(second);
    result = await expect(admin, 'create_invite', { body: { email: 'payroll@example.test', name: 'Payroll Manager', role: 'payroll' } }, 200);
    await activate(payroll, result.data); await enroll(payroll);
    await expect(employee, 'users', {}, 403, 'staff_forbidden');
    await expect(employee, 'create_invite', { body: { email: 'escalate@example.test', name: 'Escalation', role: 'admin' } }, 403, 'staff_forbidden');
    await expect(payroll, 'create_invite', { body: { email: 'escalate2@example.test', name: 'Escalation', role: 'admin' } }, 403, 'staff_forbidden');
    await expect(payroll, 'disable_user', { body: { userId: employee.user.id } }, 403, 'staff_forbidden');
    result = await expect(payroll, 'users', {}, 200); check(result.data.canInvite, false, 'Payroll manager cannot invite staff');
    check(result.data.items.some(item => 'password' in item || 'mfaSecret' in item), false, 'Password hashes and TOTP secrets never appear in staff list');

    result = await expect(payroll, 'payroll_create', { body: { userId: employee.user.id, period: '2026-10', gross: '50000.00', net: '42000', deductions: '8000.00', note: 'Synthetic accounting statement' } }, 200);
    const own = result.data.item;
    check(own.net, '42000.00', 'Entered amounts retained as decimal text');
    result = await expect(admin, 'payroll_create', { body: { userId: second.user.id, period: '2026-10', gross: 45000, net: 39000, deductions: 6000, note: '' } }, 200);
    const other = result.data.item;
    await expect(employee, 'payroll_create', { body: { userId: employee.user.id, period: '2026-10', gross: 1, net: 1, deductions: 0 } }, 403, 'staff_forbidden');
    await expect(admin, 'payroll_create', { body: { userId: employee.user.id, period: '2026-13', gross: 1, net: 1, deductions: 0 } }, 422, 'staff_payroll_invalid');
    await expect(admin, 'payroll_create', { body: { userId: employee.user.id, period: '2026-10', gross: '-1', net: 1, deductions: 0 } }, 422, 'staff_payroll_invalid');
    await expect(admin, 'payroll_create', { body: { userId: employee.user.id, period: '2026-10', gross: 1, net: '1.001', deductions: 0 } }, 422, 'staff_payroll_invalid');
    result = await expect(employee, 'payroll_list', {}, 200); check(result.data.items.map(item => item.id), [own.id], 'Employee sees only own statement');
    check(result.data.canManage, false, 'Employee cannot manage statement');
    result = await expect(second, 'payroll_list', {}, 200); check(result.data.items.map(item => item.id), [other.id], 'Second employee sees only own statement');
    check((await request(payroll, 'payroll_list')).data.items.length, 2, 'Payroll manager sees authorized company statements');
    await expect(employee, 'payroll_delete', { body: { statementId: other.id } }, 403, 'staff_forbidden');
    await expect(employee, 'payroll_download', { query: { id: other.id } }, 404, 'staff_not_found');

    const pdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';
    await expect(employee, 'payroll_upload', { form: upload(own.id, pdf) }, 403, 'staff_forbidden');
    await expect(payroll, 'payroll_upload', { form: upload(own.id, '<?php echo "bad"; ?>', 'application/pdf') }, 422, 'staff_pdf_invalid');
    await expect(payroll, 'payroll_upload', { form: upload(own.id, '%PDF-1.4\nwithout EOF') }, 422, 'staff_pdf_invalid');
    await expect(payroll, 'payroll_upload', { form: upload(own.id, pdf) }, 200);
    await expect(admin, 'payroll_upload', { form: upload(other.id, pdf) }, 200);
    await expect(payroll, 'payroll_upload', { form: upload(own.id, pdf) }, 200);
    check(fs.readdirSync(path.join(sandbox, 'staff/documents')).length, 2, 'Replacing a PDF removes the detached personal document after state commit');
    result = await expect(employee, 'payroll_download', { query: { id: own.id }, raw: true }, 200);
    check(result.data, pdf, 'Owner downloads only real stored PDF bytes');
    check(result.headers.get('content-disposition').startsWith('attachment;'), true, 'PDF always downloads as attachment');
    check(result.headers.get('cache-control').includes('no-store'), true, 'Private PDF never cached');
    await expect(employee, 'payroll_download', { query: { id: other.id } }, 404, 'staff_not_found');
    await expect(outsider, 'payroll_download', { query: { id: own.id } }, 401, 'staff_unauthorized');
    check(fs.readdirSync(path.join(sandbox, 'staff/documents')).every(name => /^[a-f0-9]{48}\.pdf$/.test(name)), true, 'Original PDF names never used as storage paths');

    // Challenge/replay safeguards use normal HTTP login, not a forged authenticated state.
    const relogin = client(); await expect(relogin, 'me', {}, 200);
    result = await expect(relogin, 'login', { body: { email: 'employee@example.test', password } }, 200);
    check(result.data.mode, 'verify', 'Password only creates MFA challenge');
    await expect(relogin, 'payroll_list', {}, 401, 'staff_unauthorized');
    await expect(relogin, 'mfa_enroll', { body: { code: totp(employee.secret) } }, 401, 'staff_challenge_expired');
    await expect(relogin, 'mfa_verify', { body: { code: employee.enrollCode } }, 401, 'staff_mfa_failed');
    await expect(relogin, 'mfa_verify', { body: { code: totp(employee.secret, 1) } }, 200);
    await expect(relogin, 'payroll_list', {}, 200);
    await expect(admin, 'disable_user', { body: { userId: employee.user.id } }, 200);
    await panel(employee, 303);
    await expect(employee, 'payroll_list', {}, 401, 'staff_unauthorized');
    await expect(relogin, 'payroll_list', {}, 401, 'staff_unauthorized');
    await expect(employee, 'login', { body: { email: 'employee@example.test', password } }, 401, 'staff_login_failed');

    result = await expect(admin, 'create_invite', { body: { email: 'second@example.test', name: 'Second Employee', role: 'employee' } }, 200);
    const renewal = result.data;
    await expect(second, 'payroll_list', {}, 401, 'staff_unauthorized');
    result = await expect(admin, 'create_invite', { body: { email: 'second@example.test', name: 'Second Employee', role: 'employee' } }, 200);
    const renewedAgain = result.data;
    await expect(second, 'activate', { body: { token: token(renewal), password } }, 400, 'staff_invite_invalid');
    mutate(state => { state.invites[crypto.createHash('sha256').update(token(renewedAgain)).digest('hex')].expires = Math.floor(Date.now() / 1000) - 1; });
    await expect(second, 'activate', { body: { token: token(renewedAgain), password } }, 400, 'staff_invite_invalid');
    await expect(payroll, 'payroll_delete', { body: { statementId: other.id } }, 200);
    check(fs.readdirSync(path.join(sandbox, 'staff/documents')).length, 1, 'Deleting a statement also removes its personal PDF');
    await expect(admin, 'payroll_download', { query: { id: other.id } }, 404, 'staff_not_found');

    // Successful session expires even when an attacker retains the legitimate cookie.
    const sessionId = payroll.cookies.get('VGSTAFF'); const sessionFile = path.join(sandbox, 'staff/sessions', `sess_${sessionId}`);
    const originalSession = fs.readFileSync(sessionFile, 'utf8');
    fs.writeFileSync(sessionFile, originalSession.replace(/s:4:"last";i:[0-9]+;/, `s:4:"last";i:${Math.floor(Date.now() / 1000) - 1801};`));
    await expect(payroll, 'payroll_list', {}, 401, 'staff_unauthorized');
    const adminSessionFile = path.join(sandbox, 'staff/sessions', `sess_${admin.cookies.get('VGSTAFF')}`);
    const originalAdminSession = fs.readFileSync(adminSessionFile, 'utf8');
    fs.writeFileSync(adminSessionFile, originalAdminSession.replace(/s:7:"created";i:[0-9]+;/, `s:7:"created";i:${Math.floor(Date.now() / 1000) - 28801};`));
    await expect(admin, 'payroll_list', {}, 401, 'staff_unauthorized');

    const brute = client(); await expect(brute, 'me', {}, 200);
    for (let i = 0; i < 10; i++) await expect(brute, 'login', { body: { email: 'brute@example.test', password: 'InvalidPassword123' } }, 401, 'staff_login_failed');
    result = await expect(brute, 'login', { body: { email: 'brute@example.test', password: 'InvalidPassword123' } }, 429, 'staff_rate_limited');
    check(Number(result.headers.get('retry-after')) > 0, true, 'Login rate limit includes retry time');
    const stored = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    check(JSON.stringify(stored).includes(password), false, 'No plaintext password stored');
    check(Object.keys(stored.invites).every(hash => /^[a-f0-9]{64}$/.test(hash)), true, 'Only invite hashes stored');
    check(stored.rates, [], 'Login counters never rewrite the employee/payroll state file');
    const counters = JSON.parse(fs.readFileSync(path.join(sandbox, 'staff/rates.json'), 'utf8'));
    check(Object.keys(counters).length > 0 && Object.keys(counters).every(hash => /^[a-f0-9]{64}$/.test(hash)), true, 'Rate counters use private HMAC keys in their own file');
    check(JSON.stringify(counters).includes('brute@example.test'), false, 'Rate counters never store e-mail addresses');
    // Only failures are counted: a correct password from the same client is not locked by earlier successes.
    const steady = client(); await expect(steady, 'me', {}, 200);
    for (let i = 0; i < 11; i++) { await expect(steady, 'login', { body: { email: 'payroll@example.test', password } }, 200); await expect(steady, 'me', {}, 200); }
    await expect(outsider, 'activate', { body: { token: '0'.repeat(64), password: 'onlyletterspassword' } }, 422, 'staff_password');
    check(JSON.stringify(stored.audit).includes(employee.secret), false, 'Audit does not store authenticator secrets');
    check(JSON.stringify(stored.audit).includes('42000'), false, 'Audit does not store payroll amounts');
    fs.writeFileSync(stateFile, '{broken'); await expect(outsider, 'me', {}, 503, 'staff_unavailable');
    console.log(`Employee API: ${checks} checks passed; accounts/payroll isolated in a temporary private directory.`);
  } finally {
    child.kill(); await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 3000); } });
    const target = fs.realpathSync(sandbox), temporary = fs.realpathSync(os.tmpdir());
    assert.ok(path.relative(temporary, target).startsWith('voltguard-staff-api-'), 'Cleanup stays inside this named temporary test directory');
    fs.rmSync(target, { recursive: true, force: true });
    const publicTarget = fs.realpathSync(publicFixture), qa = fs.realpathSync(path.join(root, '.qa'));
    assert.ok(path.relative(qa, publicTarget).startsWith('staff-storage-privacy-'), 'Public empty fixture cleanup stays inside this named ignored directory');
    check(fs.readdirSync(publicTarget), [], 'Public privacy test fixture never contains private data');
    fs.rmdirSync(publicTarget);
  }
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; });
