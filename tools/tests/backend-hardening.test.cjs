'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn, spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const phpPath = file => JSON.stringify(path.join(root, file).replace(/\\/g, '/'));

function fixture(source, environment = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-hardening-fixture-'));
  try {
    const file = path.join(directory, 'check.php');
    fs.writeFileSync(file, `<?php\ndefine('VG_API',1); $_SERVER['DOCUMENT_ROOT']=${phpPath('')}; require ${phpPath('api/lib/bootstrap.php')}; require ${phpPath('api/lib/security.php')};\n${source}`);
    const run = spawnSync(php, ['-n', file], {env: {...process.env, VG_DATA_DIR: directory, ...environment}, encoding: 'utf8', windowsHide: true, timeout: 15000});
    assert.equal(run.status, 0, run.stderr || run.error?.message);
    return JSON.parse(run.stdout);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
}

test('Forwarded HTTPS requires a trusted proxy and same origin includes scheme and port', () => {
  assert.deepEqual(fixture(`
$_SERVER['REMOTE_ADDR']='192.0.2.1'; $_SERVER['HTTP_X_FORWARDED_PROTO']='https';
$out=['spoofed'=>vg_is_https()];
$_SERVER['REMOTE_ADDR']='173.245.48.10'; $out['cloudflare']=vg_is_https();
$_SERVER['HTTP_HOST']='voltguard.com.tr';
$out['same']=vg_url_is_same_origin('https://voltguard.com.tr:443');
$out['wrongPort']=vg_url_is_same_origin('https://voltguard.com.tr:80');
$out['wrongScheme']=vg_url_is_same_origin('http://voltguard.com.tr');
$out['credentials']=vg_url_is_same_origin('https://user@voltguard.com.tr');
$out['badCidr']=vg_ip_in_cidr('127.0.0.1','127.0.0.1/99');
$out['invalidCidr']=vg_ip_in_cidr('127.0.0.1','127.0.0.1/invalid');
$out['invalidOrigin']=vg_url_is_same_origin('https://voltguard.com.tr#invalid', true);
echo json_encode($out);`), {spoofed: false, cloudflare: true, same: true, wrongPort: false, wrongScheme: false, credentials: false, badCidr: false, invalidCidr: false, invalidOrigin: false});
  assert.deepEqual(fixture(`$_SERVER['REMOTE_ADDR']='127.0.0.1'; $_SERVER['HTTP_X_FORWARDED_PROTO']='https'; echo json_encode(vg_is_https());`, {VG_TRUSTED_PROXIES: '127.0.0.1'}), true);
});

test('Account storage refuses a public root and corrupt selection; rate storage fails closed', () => {
  assert.deepEqual(fixture(`require ${phpPath('api/lib/store.php')}; putenv('VG_DATA_DIR='.getenv('VG_PUBLIC_FIXTURE')); try {vg_store(); echo 'false';} catch(VgHttpError $e) {echo json_encode($e->status);}`, {VG_PUBLIC_FIXTURE: path.join(root, '.qa')}), 503);
  assert.deepEqual(fixture(`require ${phpPath('api/lib/store.php')}; file_put_contents(vg_data_dir().'/store.kind','broken'); try {vg_store(); echo 'false';} catch(VgHttpError $e) {echo json_encode($e->status);}`), 503);
  assert.deepEqual(fixture(`file_put_contents(vg_data_dir().'/rl','not a directory'); try {vg_rl_hit('x','y',5,60); echo 'false';} catch(VgHttpError $e) {echo json_encode($e->status);}`), 503);
});

test('Contact and account endpoints validate actual HTTP requests without a real mail transport', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-contact-http-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(php, ['-n', '-S', `127.0.0.1:${port}`, '-t', root], {env: {...process.env, VG_DATA_DIR: data, VG_STORE: 'json', VG_MAIL_OUTBOX: '1', TURNSTILE_SECRET_KEY: '', VG_CONTACT_ALLOWED_ORIGINS: base}, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true});
  const logs = []; child.stderr.on('data', chunk => logs.push(String(chunk)));
  const valid = {name: 'Şule İletişim', phone: '+90 532 123 45 67', email: 'contact-fixture@example.test', subject: 'elektrik', message: 'Panomuzun bakım planı için iletişim talebi.', formTimestamp: String(Date.now())};
  async function submit(fields = valid, headers = {}, method = 'POST') {
    const response = await fetch(`${base}/contact.php`, {method, headers: {Origin: base, ...headers}, ...(method === 'POST' ? {body: new URLSearchParams(fields)} : {})});
    return {response, body: await response.json()};
  }
  try {
    for (let i = 0; i < 80; i++) { try {await fetch(`${base}/contact.php`); break;} catch {if (i === 79) throw Error('PHP did not start'); await new Promise(resolve => setTimeout(resolve, 40));} }
    let result = await submit({}, {}, 'GET');
    assert.equal(result.response.status, 405); assert.equal(result.response.headers.get('allow'), 'POST');
    for (const Origin of ['https://outside.example', 'http://voltguard.com.tr', 'https://voltguard.com.tr:8443', `${base}/invalid`, `${base}#invalid`, 'null', '']) {
      result = await submit(valid, {Origin}); assert.equal(result.response.status, 403, Origin);
    }
    result = await submit(valid, {'Sec-Fetch-Site': 'cross-site'}); assert.equal(result.response.status, 403);
    result = await submit(valid, {'Content-Type': 'text/plain'}); assert.equal(result.response.status, 415);
    result = await submit({...valid, 'name[]': 'array', name: undefined}); assert.equal(result.response.status, 400);
    result = await submit({...valid, phone: 'abc05321234567'}); assert.equal(result.response.status, 422);
    result = await submit({...valid, website: 'bot.example'}); assert.equal(result.response.status, 422); assert.equal(result.body.success, false);
    result = await submit({...valid, message: 'a'.repeat(33000)}); assert.equal(result.response.status, 413);
    result = await submit(valid); assert.equal(result.response.status, 200); assert.equal(result.body.success, true);
    assert.match(result.body.message, /önizlemede e-posta gönderilmez/);
    assert.match(result.response.headers.get('cache-control'), /no-store/);
    const outbox = path.join(data, 'outbox'); const files = fs.readdirSync(outbox);
    assert.equal(files.length, 1, 'No consent checkbox needed and one genuine test mail is stored');
    const eml = fs.readFileSync(path.join(outbox, files[0]), 'utf8');
    assert.match(eml, /Şule İletişim/); assert.match(eml, /Reply-To: contact-fixture@example.test/);
    assert.doesNotMatch(eml, /IP:|X-Mailer: PHP/);
    const counters = fs.readdirSync(path.join(data, 'rl')).filter(name => name.endsWith('.json'));
    assert.equal(counters.length, 1); assert.match(counters[0], /^[a-f0-9]{64}\.json$/);
    for (let i = 0; i < 4; i++) assert.equal((await submit(valid)).response.status, 200);
    result = await submit(valid); assert.equal(result.response.status, 429); assert.ok(Number(result.response.headers.get('retry-after')) > 0);
    assert.equal(fs.readdirSync(outbox).length, 5, 'Rejected submissions do not send email');
    const me = await fetch(`${base}/api/auth.php?action=me`); const session = await me.json();
    const cookie = me.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    const authHeaders = {Origin: base, Cookie: cookie, 'X-VG-CSRF': session.csrf, 'Content-Type': 'application/json'};
    let response = await fetch(`${base}/api/auth.php?action=register`, {method: 'POST', headers: {...authHeaders, 'Content-Type': 'application/json-evil'}, body: '{}'});
    assert.equal(response.status, 415);
    response = await fetch(`${base}/api/auth.php?action=register`, {method: 'POST', headers: authHeaders, body: '[]'}); assert.equal(response.status, 400);
    response = await fetch(`${base}/api/auth.php?action=register`, {method: 'POST', headers: authHeaders, body: JSON.stringify({name: 'Hesap Talebi', email: 'account-fixture@example.test', password: 'PrivatePassword732'})});
    assert.equal(response.status, 201, 'An explicit account request does not require general data consent');
    assert.doesNotMatch(logs.join(''), /Şule|contact-fixture@example|123 45 67|Fatal error|Warning:/);
  } finally {
    child.kill(); await new Promise(resolve => {if (child.exitCode !== null) resolve(); else {child.once('exit', resolve); setTimeout(resolve, 3000);}});
    assert.ok(path.relative(os.tmpdir(), data).startsWith('voltguard-contact-http-'));
    fs.rmSync(data, {recursive: true, force: true});
  }
});

test('Contact never reports success when mail is unavailable or configured CAPTCHA is missing', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-contact-failures-'));
  try {
    for (const [name, status, configuration] of [
      ['mail', 503, {VG_MAIL_OUTBOX: '', TURNSTILE_SECRET_KEY: ''}],
      ['captcha', 422, {VG_MAIL_OUTBOX: '1', TURNSTILE_SECRET_KEY: 'isolated-test-secret'}],
    ]) {
      const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
      const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
      const base = `http://127.0.0.1:${port}`;
      const directory = path.join(data, name); fs.mkdirSync(directory);
      const child = spawn(php, ['-n', '-d', 'disable_functions=mail', '-S', `127.0.0.1:${port}`, '-t', root], {
        env: {...process.env, VG_DATA_DIR: directory, VG_CONTACT_ALLOWED_ORIGINS: base, ...configuration},
        stdio: 'ignore', windowsHide: true,
      });
      try {
        for (let i = 0; i < 100; i++) {try {await fetch(`${base}/contact.php`); break;} catch {if (i === 99) throw Error('PHP did not start'); await new Promise(resolve => setTimeout(resolve, 50));}}
        const response = await fetch(`${base}/contact.php`, {method: 'POST', headers: {Origin: base}, body: new URLSearchParams({
          name: 'Teknik Talep', phone: '05321234567', subject: 'elektrik',
          message: 'Saha incelemesi için teknik iletişim talebi.', formTimestamp: String(Date.now()),
        })});
        assert.equal(response.status, status, name);
        assert.equal((await response.json()).success, false, name);
        assert.equal(fs.existsSync(path.join(directory, 'outbox')), false, 'No message stored or sent on failure');
      } finally {
        child.kill(); await new Promise(resolve => {if (child.exitCode !== null) resolve(); else {child.once('exit', resolve); setTimeout(resolve, 3000);}});
      }
    }
  } finally {
    assert.ok(path.relative(os.tmpdir(), data).startsWith('voltguard-contact-failures-'));
    fs.rmSync(data, {recursive: true, force: true});
  }
});
