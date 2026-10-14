'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const phpPath = file => JSON.stringify(path.join(root, file).replace(/\\/g, '/'));

function fixture(source, flags = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-forgot-'));
  const file = path.join(directory, 'fixture.php');
  try {
    fs.writeFileSync(file, source, 'utf8');
    const result = spawnSync(php, ['-n', ...flags, file], {
      env: {...process.env, VG_MAIL_OUTBOX: '1', VG_DATA_DIR: directory},
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout || 'Isolated PHP fixture must succeed.');
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

test('Forgot responses preserve account privacy and never promise successful delivery', () => {
  const results = fixture(`<?php
define('VG_API', 1);
define('VG_RESET_TTL', 3600);
class FixtureError extends Exception { public $status; public $codeName; function __construct($s,$c,$m){parent::__construct($m);$this->status=$s;$this->codeName=$c;} }
class VgStore {
    public $exists=true; public $lookups=0; public $tokens=[];
    function findUserByEmail($email){$this->lookups++;return $this->exists?['id'=>'synthetic-user','email'=>$email,'name'=>'Synthetic Tester']:null;}
    function putResetToken($hash,$id,$expires){$this->tokens[]=['hash'=>$hash,'expires'=>$expires];}
}
function vg_normalize_email($email){return filter_var($email,FILTER_VALIDATE_EMAIL)?strtolower($email):'';}
function vg_fail($status,$code,$message){throw new FixtureError($status,$code,$message);}
function vg_mail_can_send(){return $GLOBALS['transportReady'];}
function vg_rl_hit($kind,$key,$limit,$window){return $kind==='forgot_email'&&!$GLOBALS['emailAllowed']?1:0;}
function vg_rl_ip_key(){return 'synthetic-ip';}
function vg_too_many($retry){throw new FixtureError(429,'rate_limited','Rate limit.');}
function vg_b64url($value){return rtrim(strtr(base64_encode($value),'+/','-_'),'=');}
function vg_now(){return 100000;}
function vg_can_finish_early(){return true;}
function vg_after_response($job){$GLOBALS['jobs'][]=$job;}
function vg_mail_reset_link($user,$token){$GLOBALS['mailCalls']++;return $GLOBALS['mailerSucceeds'];}
require ${phpPath('api/lib/handlers.php')};
$results=[];
foreach (['existing','absent','send_failed','email_limited','preview_existing','preview_absent','unavailable_existing','unavailable_absent'] as $name) {
    $store=new VgStore();$store->exists=strpos($name,'absent')===false;
    $GLOBALS['transportReady']=strpos($name,'unavailable')!==0;
    $GLOBALS['emailAllowed']=$name!=='email_limited';
    $GLOBALS['mailerSucceeds']=$name!=='send_failed';$GLOBALS['mailCalls']=0;$GLOBALS['jobs']=[];
    putenv('VG_MAIL_OUTBOX='.(strpos($name,'preview')===0?'1':'0'));
    try {$response=vg_h_forgot_password($store,['email'=>'synthetic@example.invalid']);}
    catch(FixtureError $error){$response=['status'=>$error->status,'error'=>$error->codeName,'message'=>$error->getMessage()];}
    foreach($GLOBALS['jobs'] as $job)$job();
    $results[$name]=['response'=>$response,'lookups'=>$store->lookups,'tokens'=>$store->tokens,'mailCalls'=>$GLOBALS['mailCalls']];
}
echo json_encode($results,JSON_UNESCAPED_UNICODE);
`);
  const baseline = results.existing.response;
  for (const name of ['absent', 'send_failed', 'email_limited']) {
    assert.deepEqual(results[name].response, baseline, `${name} must not reveal account or delivery state.`);
  }
  assert.equal(baseline.ok, true);
  assert.match(baseline.message, /Talebiniz alındı/);
  assert.doesNotMatch(baseline.message, /birkaç dakika içinde gönderilecek|gönderildi|teslim edildi/);
  assert.match(baseline.message, /teslim durumu/);
  assert.equal(results.existing.mailCalls, 1);
  assert.equal(results.absent.mailCalls, 0);
  assert.equal(results.send_failed.mailCalls, 1);
  assert.equal(results.email_limited.lookups, 0);
  assert.equal(results.existing.tokens[0].expires, 103600);
  assert.match(results.existing.tokens[0].hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(results.preview_existing.response, results.preview_absent.response);
  assert.match(results.preview_existing.response.message, /önizlemede e-postalar gerçek adreslere gönderilmez/);
  assert.deepEqual(results.unavailable_existing.response, results.unavailable_absent.response);
  assert.equal(results.unavailable_existing.response.status, 503);
  assert.equal(results.unavailable_existing.response.error, 'mail_unavailable');
  for (const name of ['unavailable_existing', 'unavailable_absent']) {
    assert.equal(results[name].lookups, 0, 'Global mail error must precede account lookup.');
    assert.equal(results[name].mailCalls, 0);
    assert.equal(results[name].tokens.length, 0);
  }
});

test('Unavailable PHP mail is safe; preview email stays in isolated outbox with current branding', () => {
  const result = fixture(`<?php
define('VG_API',1);
function vg_data_dir(){return getenv('VG_DATA_DIR');}
function vg_ensure_dir($directory){return is_dir($directory)||mkdir($directory,0700,true);}
function vg_site_url(){return 'https://example.invalid';}
require ${phpPath('api/lib/mailer.php')};
putenv('VG_MAIL_OUTBOX=0');
$unavailable=vg_mail_can_send();
$sent=vg_mail_send('synthetic@example.invalid','Synthetic subject','Synthetic body','reset');
putenv('VG_MAIL_OUTBOX=1');
$preview=vg_mail_can_send();
$saved=vg_mail_reset_link(['email'=>'synthetic@example.invalid','name'=>'Synthetic Tester'],str_repeat('a',43));
$files=glob(vg_data_dir().'/outbox/*.eml');
$content=file_get_contents($files[0]);
echo json_encode(['unavailableCapability'=>$unavailable,'unavailableSent'=>$sent,'previewCapability'=>$preview,'previewSaved'=>$saved,'files'=>count($files),'currentBrand'=>strpos($content,'VoltGuard hesabınız')!==false,'oldBrand'=>strpos($content,'VoltGuard Tools')!==false,'fragmentLink'=>strpos($content,'/hesap/sifre-sifirla.html#t=')!==false]);
`, ['-d', 'disable_functions=mail']);
  assert.deepEqual(result, {
    unavailableCapability: false, unavailableSent: false,
    previewCapability: true, previewSaved: true, files: 1,
    currentBrand: true, oldBrand: false, fragmentLink: true,
  });
});
