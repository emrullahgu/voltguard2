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
const secret = 'isolated-turnstile-fixture-secret';

function environment(data, extra = {}) {
  const env = {...process.env};
  delete env.TURNSTILE_SECRET_KEY;
  delete env.TURNSTILE_EXPECTED_HOSTNAME;
  return {...env, VG_DATA_DIR: data, VG_MAIL_OUTBOX: '1', ...extra};
}

function fixture(source, setup = () => {}, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-turnstile-'));
  const data = path.join(directory, 'private');
  const publicRoot = path.join(directory, 'public');
  fs.mkdirSync(data); fs.mkdirSync(publicRoot);
  try {
    setup({directory, data, publicRoot});
    const file = path.join(directory, 'fixture.php');
    fs.writeFileSync(file, `<?php\ndefine('VG_API',1); $_SERVER['DOCUMENT_ROOT']=${JSON.stringify(publicRoot.replace(/\\/g, '/'))}; require ${phpPath('api/lib/bootstrap.php')}; require ${phpPath('api/lib/turnstile.php')};
function outcome(callable $run) { try { $run(); return 'ok'; } catch (VgHttpError $error) { return [$error->status, $error->errCode]; } }
${source}`);
    const run = spawnSync(php, ['-n', '-d', 'disable_functions=mail', file], {
      env: environment(data, extra), encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
    assert.doesNotMatch(run.stderr, new RegExp(secret));
    return JSON.parse(run.stdout);
  } finally {
    assert.match(path.basename(directory), /^voltguard-turnstile-/);
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

test('Turnstile uses private configuration and explicit environment precedence', () => {
  assert.deepEqual(fixture(`$c=vg_turnstile_config(); echo json_encode([$c['secretKey']==='', $c['expectedHostname']]);`), [true, 'voltguard.com.tr']);
  const write = ({data}) => fs.writeFileSync(path.join(data, 'turnstile-config.json'), JSON.stringify({secretKey: secret, expectedHostname: 'VOLTGUARD.COM.TR'}));
  assert.deepEqual(fixture(`$c=vg_turnstile_config(); echo json_encode([$c['secretKey']===${JSON.stringify(secret)}, $c['expectedHostname']]);`, write), [true, 'voltguard.com.tr']);
  assert.deepEqual(fixture(`$c=vg_turnstile_config(); echo json_encode([$c['secretKey']==='environment-fixture-secret', $c['expectedHostname']]);`, write,
    {TURNSTILE_SECRET_KEY: 'environment-fixture-secret', TURNSTILE_EXPECTED_HOSTNAME: 'staging.example.test'}), [true, 'staging.example.test']);
  assert.deepEqual(fixture(`$c=vg_turnstile_config(); echo json_encode([$c['secretKey']===${JSON.stringify(secret)}, $c['expectedHostname']]);`, write,
    {TURNSTILE_SECRET_KEY: '', TURNSTILE_EXPECTED_HOSTNAME: ''}), [true, 'voltguard.com.tr']);
});

test('A configured but invalid private file cannot silently disable Turnstile', () => {
  for (const content of ['{', '[]', '{}', JSON.stringify({secretKey: ''}), JSON.stringify({secretKey: 123}),
    JSON.stringify({secretKey: secret, expectedHostname: 'https://voltguard.com.tr'}),
    JSON.stringify({secretKey: secret, expectedHostname: '*.voltguard.com.tr'}),
    JSON.stringify({secretKey: secret, typo: true}), ' '.repeat(8193)]) {
    assert.deepEqual(fixture(`echo json_encode(outcome(function(){vg_turnstile_config();}));`, ({data}) => {
      fs.writeFileSync(path.join(data, 'turnstile-config.json'), content);
    }, {TURNSTILE_SECRET_KEY: 'environment-fixture-secret'}), [503, 'configuration_invalid']);
  }
  assert.deepEqual(fixture(`echo json_encode(outcome(function(){vg_turnstile_config();}));`, ({data}) => {
    fs.mkdirSync(path.join(data, 'turnstile-config.json'));
  }), [503, 'configuration_invalid']);
  assert.deepEqual(fixture(`echo json_encode(outcome(function(){vg_turnstile_config();}));`, () => {},
    {TURNSTILE_EXPECTED_HOSTNAME: 'voltguard.com.tr:443'}), [503, 'configuration_invalid']);
});

test('Official dummy secrets are restricted to explicit mail-outbox previews', () => {
  for (const key of ['1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA']) {
    assert.deepEqual(fixture(`echo json_encode(outcome(function(){vg_turnstile_config();}));`, () => {},
      {TURNSTILE_SECRET_KEY: key, VG_MAIL_OUTBOX: '0'}), [503, 'configuration_invalid']);
    assert.equal(fixture(`echo json_encode(outcome(function(){vg_turnstile_config();}));`, () => {},
      {TURNSTILE_SECRET_KEY: key, VG_MAIL_OUTBOX: '1'}), 'ok');
  }
});

test('Turnstile refuses a configuration file symlink and a public storage junction', t => {
  let symlinkSupported = true;
  const result = fixture(`echo json_encode(outcome(function(){vg_turnstile_config();}));`, ({data, directory}) => {
    const target = path.join(directory, 'elsewhere.json');
    fs.writeFileSync(target, JSON.stringify({secretKey: secret}));
    try { fs.symlinkSync(target, path.join(data, 'turnstile-config.json'), 'file'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) symlinkSupported = false; else throw error; }
  });
  if (symlinkSupported) assert.deepEqual(result, [503, 'configuration_invalid']);
  else t.diagnostic('File symlink creation is unavailable in this Windows session; directory target rejection still runs.');
  assert.deepEqual(fixture(`echo json_encode(outcome(function(){putenv('VG_DATA_DIR='.$_SERVER['DOCUMENT_ROOT']); vg_turnstile_config();}));`), [503, 'unavailable']);
  assert.deepEqual(fixture(`echo json_encode(outcome(function(){putenv('VG_DATA_DIR='.dirname($_SERVER['DOCUMENT_ROOT']).'/public-alias'); vg_turnstile_config();}));`,
    ({directory, publicRoot}) => fs.symlinkSync(publicRoot, path.join(directory, 'public-alias'), process.platform === 'win32' ? 'junction' : 'dir'),
    {}), [503, 'unavailable']);
});

test('Provider success requires an allowed hostname; invalid, duplicate and transport responses fail', () => {
  assert.deepEqual(fixture(`
$cases=[
    ['{"success":true,"hostname":"voltguard.com.tr"}',200,'voltguard.com.tr'],
    ['{"success":true,"hostname":"WWW.VOLTGUARD.COM.TR"}',200,'voltguard.com.tr'],
    ['{"success":true,"hostname":"voltguard.com.tr"}',200,'www.voltguard.com.tr'],
    ['{"success":true,"hostname":"outside.example"}',200,'voltguard.com.tr'],
    ['{"success":true,"hostname":"voltguard.com.tr.outside.example"}',200,'voltguard.com.tr'],
    ['{"success":true}',200,'voltguard.com.tr'],
    ['{"success":false,"error-codes":["invalid-input-response"]}',200,'voltguard.com.tr'],
    ['{"success":false,"error-codes":["timeout-or-duplicate"]}',200,'voltguard.com.tr'],
    ['{',200,'voltguard.com.tr'], ['[]',200,'voltguard.com.tr'],
    ['{"success":"true","hostname":"voltguard.com.tr"}',200,'voltguard.com.tr'],
    [false,200,'voltguard.com.tr'], ['',0,'voltguard.com.tr'],
    ['{"success":true,"hostname":"voltguard.com.tr"}',503,'voltguard.com.tr'],
    [str_repeat('x',16385),200,'voltguard.com.tr']
];
$out=[]; foreach($cases as $c) $out[]=outcome(function()use($c){vg_turnstile_validate_response($c[0],$c[1],$c[2]);});
echo json_encode($out);`), [
    'ok', 'ok', 'ok',
    ...Array.from({length: 5}, () => [422, 'captcha_invalid']),
    ...Array.from({length: 7}, () => [502, 'captcha_unavailable']),
  ]);
});

test('cURL response accumulation stops before exceeding 16 KiB', () => {
  assert.deepEqual(fixture(`$body=''; $a=vg_turnstile_append_response($body,str_repeat('a',16380)); $b=vg_turnstile_append_response($body,'four'); $c=vg_turnstile_append_response($body,'x'); echo json_encode([$a,$b,$c,strlen($body),substr($body,-4)]);`), [16380, 4, 0, 16384, 'four']);
});

test('Private configured CAPTCHA rejects a missing token over HTTP before any mail delivery', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-turnstile-http-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(directory, 'turnstile-config.json'), JSON.stringify({secretKey: secret, expectedHostname: 'voltguard.com.tr'}));
  const child = spawn(php, ['-n', '-d', 'disable_functions=mail,curl_init', '-d', 'allow_url_fopen=0', '-S', `127.0.0.1:${port}`, '-t', root], {
    env: environment(directory, {VG_CONTACT_ALLOWED_ORIGINS: base}), stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  let logs = ''; child.stderr.on('data', chunk => { logs += String(chunk); });
  const fields = {name: 'İzole Güvenlik Testi', phone: '05321234567', subject: 'elektrik',
    message: 'Yalnızca izole güvenlik doğrulaması için oluşturulan sentetik talep.', formTimestamp: String(Date.now())};
  try {
    for (let i = 0; i < 80; i++) {
      try { await fetch(`${base}/contact.php`); break; }
      catch { if (i === 79) throw Error('PHP did not start'); await new Promise(resolve => setTimeout(resolve, 40)); }
    }
    let response = await fetch(`${base}/contact.php`, {method: 'POST', headers: {Origin: base}, body: new URLSearchParams(fields)});
    assert.equal(response.status, 422); assert.equal((await response.json()).code, 'captcha_required');
    fs.writeFileSync(path.join(directory, 'turnstile-config.json'), '{');
    response = await fetch(`${base}/contact.php`, {method: 'POST', headers: {Origin: base}, body: new URLSearchParams(fields)});
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'configuration_invalid');
    assert.equal(fs.existsSync(path.join(directory, 'outbox')), false);
    assert.doesNotMatch(logs, new RegExp(secret));
    assert.doesNotMatch(logs, /Fatal error|Warning:/);
  } finally {
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 3000); } });
    assert.match(path.basename(directory), /^voltguard-turnstile-http-/);
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
