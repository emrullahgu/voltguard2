'use strict';

// Opt in with VG_RUN_TURNSTILE_PROVIDER_TEST=1. Only official public dummy credentials are used.
// VG_PHP_CA_FILE may name the host's trusted PEM bundle when the PHP runtime needs an explicit CA path.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const phpPath = file => JSON.stringify(path.join(root, file).replace(/\\/g, '/'));

let runtime;
function phpRuntime() {
  if (runtime) return runtime;
  const probe = spawnSync(php, ['-n', '-r', 'echo json_encode(["modules"=>get_loaded_extensions(),"extensionDir"=>ini_get("extension_dir")]);'],
    {encoding: 'utf8', windowsHide: true, timeout: 5000});
  assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
  const configuration = JSON.parse(probe.stdout);
  const modules = new Set(configuration.modules.map(value => value.toLowerCase()));
  const adjacent = path.join(path.dirname(php), 'ext');
  const extensionDirectory = fs.existsSync(adjacent) ? adjacent : configuration.extensionDir;
  const flags = ['-n', '-d', `extension_dir=${extensionDirectory}`];
  for (const extension of ['openssl', 'curl']) {
    const filename = process.platform === 'win32' ? `php_${extension}.dll` : `${extension}.so`;
    if (!modules.has(extension) && fs.existsSync(path.join(extensionDirectory, filename))) flags.push('-d', `extension=${extension}`);
  }
  const verify = spawnSync(php, [...flags, '-r', 'echo json_encode(get_loaded_extensions());'],
    {encoding: 'utf8', windowsHide: true, timeout: 5000});
  assert.equal(verify.status, 0, verify.stderr || verify.error?.message);
  assert.doesNotMatch(verify.stderr, /Warning:|Unable to load/);
  const loaded = new Set(JSON.parse(verify.stdout).map(value => value.toLowerCase()));
  assert.equal(loaded.has('openssl'), true, 'PHP must have OpenSSL available for the HTTPS-stream probe');
  return runtime = {flags, curl: loaded.has('curl')};
}

for (const transport of ['curl', 'https-stream']) test(`Isolated PHP ${transport} validates the official Cloudflare dummy token without sending mail`, {
  skip: process.env.VG_RUN_TURNSTILE_PROVIDER_TEST !== '1',
}, t => {
  const configured = phpRuntime();
  if (transport === 'curl' && !configured.curl) { t.skip('This PHP installation has no cURL extension; HTTPS-stream is tested separately.'); return; }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-turnstile-provider-'));
  const publicRoot = path.join(directory, 'public');
  const data = path.join(directory, 'private');
  fs.mkdirSync(publicRoot); fs.mkdirSync(data);
  try {
    const file = path.join(directory, 'probe.php');
    fs.writeFileSync(file, `<?php
define('VG_API',1);
$_SERVER['DOCUMENT_ROOT']=${JSON.stringify(publicRoot.replace(/\\/g, '/'))};
$_SERVER['REMOTE_ADDR']='127.0.0.1';
require ${phpPath('api/lib/bootstrap.php')};
require ${phpPath('api/lib/turnstile.php')};
$transport=function_exists('curl_init')?'curl':'https-stream';
try {
    $config=vg_turnstile_config();
    $response=vg_turnstile_request(http_build_query(['secret'=>$config['secretKey'],'response'=>'XXXX.DUMMY.TOKEN.XXXX','remoteip'=>'127.0.0.1']));
    vg_turnstile_validate_response($response['body'],$response['status'],$config['expectedHostname']);
    $result=json_decode($response['body'],true);
    echo json_encode(['success'=>true,'transport'=>$transport,'status'=>$response['status'],'hostname'=>$result['hostname']??'']);
} catch (VgHttpError $error) {
    echo json_encode(['success'=>false,'transport'=>$transport,'status'=>$error->status,'code'=>$error->errCode,'openssl'=>extension_loaded('openssl')]);
}`);
    const args = [...configured.flags, '-d', `disable_functions=${transport === 'https-stream' ? 'mail,curl_init' : 'mail'}`];
    if (process.env.VG_PHP_CA_FILE) {
      const bundle = path.resolve(process.env.VG_PHP_CA_FILE);
      assert.equal(fs.statSync(bundle).isFile(), true, 'VG_PHP_CA_FILE must name an existing CA bundle');
      args.push('-d', `curl.cainfo=${bundle}`, '-d', `openssl.cafile=${bundle}`);
    }
    args.push(file);
    const run = spawnSync(php, args, {
      env: {...process.env, VG_DATA_DIR: data, VG_MAIL_OUTBOX: '1',
        TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA', TURNSTILE_EXPECTED_HOSTNAME: 'example.com'},
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
    const result = JSON.parse(run.stdout);
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.transport, transport);
    assert.equal(result.status, 200);
    assert.equal(result.hostname, 'example.com');
    assert.equal(fs.existsSync(path.join(data, 'outbox')), false, 'The probe never invokes the contact endpoint or mail delivery');
    assert.doesNotMatch(run.stderr, /Fatal error|Warning:/);
  } finally {
    assert.match(path.basename(directory), /^voltguard-turnstile-provider-/);
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
