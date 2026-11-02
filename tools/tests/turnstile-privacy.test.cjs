'use strict';

// Execute both production verifiers with an isolated, in-process cURL transport.
// No provider request, private configuration, mail delivery or application store is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const localPhp = path.join(root, '.qa/php/runtime/php.exe');
const php = process.env.VG_PHP || (fs.existsSync(localPhp) ? localPhp : 'php');
const phpPath = file => JSON.stringify(path.join(root, file).replace(/\\/g, '/'));
const secret = 'isolated-turnstile-privacy-fixture-secret';
const token = 'synthetic-token+privacy/with=value&proof';
const addresses = ['198.51.100.79', '2001:db8:ad00::44'];
let checkedRuntime = false;

function runtime() {
  if (checkedRuntime) return;
  const probe = spawnSync(php, ['-n', '-r', 'echo json_encode(["curl"=>function_exists("curl_init")]);'],
    {encoding: 'utf8', windowsHide: true, timeout: 5000});
  assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
  assert.equal(JSON.parse(probe.stdout).curl, false, 'The isolated -n PHP runtime must allow the network-free cURL stubs.');
  checkedRuntime = true;
}

function verify(verifier, ip, options = {}) {
  runtime();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-turnstile-privacy-'));
  try {
    const file = path.join(directory, 'verify.php');
    const response = options.response || {success: true, hostname: 'voltguard.com.tr'};
    fs.writeFileSync(file, `<?php
define('VG_API',1);
$_SERVER['DOCUMENT_ROOT']=${JSON.stringify(path.join(directory, 'public').replace(/\\/g, '/'))};
$_SERVER['REMOTE_ADDR']=${JSON.stringify(ip)};
require ${phpPath('api/lib/bootstrap.php')};
require ${phpPath('api/lib/turnstile.php')};
require ${phpPath('api/lib/magaza-api.php')};
foreach (['CURLOPT_POST','CURLOPT_POSTFIELDS','CURLOPT_RETURNTRANSFER','CURLOPT_FOLLOWLOCATION',
    'CURLOPT_CONNECTTIMEOUT','CURLOPT_TIMEOUT','CURLOPT_SSL_VERIFYPEER','CURLOPT_SSL_VERIFYHOST',
    'CURLOPT_HTTPHEADER','CURLOPT_HEADERFUNCTION','CURLOPT_WRITEFUNCTION','CURLINFO_HTTP_CODE'] as $i=>$name) {
    if (!defined($name)) define($name,$i+1);
}
$requests=[];
$providerBody=${JSON.stringify(JSON.stringify(response))};
$providerStatus=${options.status ?? 200};
function curl_init($url) {
    if ($url!=='https://challenges.cloudflare.com/turnstile/v0/siteverify') throw new RuntimeException('Unexpected provider URL');
    return (object)['url'=>$url,'options'=>[]];
}
function curl_setopt_array($handle,$options) { $handle->options=$options; return true; }
function curl_exec($handle) {
    $GLOBALS['requests'][]=['url'=>$handle->url,'payload'=>$handle->options[CURLOPT_POSTFIELDS]??null];
    $body=$GLOBALS['providerBody'];
    if (isset($handle->options[CURLOPT_WRITEFUNCTION])) {
        return ($handle->options[CURLOPT_WRITEFUNCTION])($handle,$body)===strlen($body);
    }
    return $body;
}
function curl_getinfo($handle,$option) { return $GLOBALS['providerStatus']; }
function curl_close($handle) {}
try {
    $token=${JSON.stringify(options.token === undefined ? token : options.token)};
    if (${JSON.stringify(verifier)}==='contact') {
        vg_turnstile_verify(['secretKey'=>${JSON.stringify(secret)},'expectedHostname'=>'voltguard.com.tr'],$token);
    } else {
        vgm_verify_captcha($token);
    }
    $outcome=['ok'=>true];
} catch (VgHttpError $error) {
    $outcome=['ok'=>false,'status'=>$error->status,'code'=>$error->errCode];
}
echo json_encode(['outcome'=>$outcome,'requests'=>$requests]);
`);
    const env = {...process.env, VG_DATA_DIR: path.join(directory, 'private'), VG_MAIL_OUTBOX: '1',
      TURNSTILE_SECRET_KEY: secret, TURNSTILE_EXPECTED_HOSTNAME: 'voltguard.com.tr'};
    const run = spawnSync(php, ['-n', '-d', 'disable_functions=mail', file],
      {env, encoding: 'utf8', windowsHide: true, timeout: 10000});
    assert.equal(run.status, 0, run.stderr || run.error?.message);
    assert.doesNotMatch(run.stderr, /Warning:|Notice:|Fatal error/);
    assert.equal(fs.existsSync(path.join(directory, 'private')), false, 'Verification does not create application storage.');
    return JSON.parse(run.stdout);
  } finally {
    const target = fs.realpathSync(directory);
    assert.equal(path.dirname(target), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(target), /^voltguard-turnstile-privacy-/);
    fs.rmSync(target, {recursive: true, force: true});
  }
}

for (const verifier of ['contact', 'checkout']) {
  for (const ip of addresses) test(`${verifier} verifies its token without forwarding the ${ip.includes(':') ? 'IPv6' : 'IPv4'} client address`, () => {
    const result = verify(verifier, ip);
    assert.deepEqual(result.outcome, {ok: true});
    assert.equal(result.requests.length, 1);
    const payload = result.requests[0].payload;
    assert.equal(typeof payload, 'string');
    const fields = new URLSearchParams(payload);
    assert.deepEqual([...fields.keys()].sort(), ['response', 'secret']);
    assert.equal(fields.get('secret'), secret);
    assert.equal(fields.get('response'), token);
    assert.equal(fields.has('remoteip'), false);
    for (const address of addresses) {
      assert.equal(payload.includes(address), false);
      assert.equal(decodeURIComponent(payload).includes(address), false);
    }
  });

  test(`${verifier} still rejects a missing token before calling the provider`, () => {
    const result = verify(verifier, addresses[0], {token: ''});
    assert.deepEqual(result.outcome, {ok: false, status: 422, code: 'captcha_required'});
    assert.deepEqual(result.requests, []);
  });

  for (const [name, response] of [
    ['unapproved hostname', {success: true, hostname: 'outside.example.test'}],
    ['provider rejection', {success: false, hostname: 'voltguard.com.tr', 'error-codes': ['timeout-or-duplicate']}],
  ]) test(`${verifier} still refuses ${name} after verification`, () => {
    const result = verify(verifier, addresses[0], {response});
    assert.deepEqual(result.outcome, {ok: false, status: 422, code: 'captcha_invalid'});
    assert.equal(result.requests.length, 1);
  });
}
