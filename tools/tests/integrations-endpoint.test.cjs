'use strict';
// Real PHP endpoint/auth with only disposable synthetic accounts outside web root.
// Provider HTTP is never invoked; network-facing adapter fixtures live in their own tests.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const token = 'synthetic-secret-never-return-this-123456789';
async function freePort() { const s = net.createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve)); const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p; }
function totp(secret) { const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join(''), key = Buffer.from(bits.match(/.{8}/g).map(x => parseInt(x, 2))), counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const hash = crypto.createHmac('sha1', key).update(counter).digest(), at = hash[19] & 15; return String((hash.readUInt32BE(at) & 0x7fffffff) % 1000000).padStart(6, '0'); }
function environment(sandbox, base) {
  const result = { ...process.env, VG_DATA_DIR: sandbox, VG_STAFF_SITE_URL: base, VG_STORE: 'json', VG_MAIL_OUTBOX: '1' };
  for (const key of ['VG_GEMINI_API_KEY', 'VG_GROQ_API_KEY', 'VG_OPENROUTER_API_KEY', 'VG_CLOUDFLARE_API_TOKEN', 'VG_CLOUDFLARE_ACCOUNT_ID', 'VG_OPENWEATHER_API_KEY', 'VG_IPINFO_TOKEN', 'VG_UNSPLASH_ACCESS_KEY', 'VG_TMDB_TOKEN', 'VG_NEWSAPI_KEY', 'VG_EPIAS_TGT', 'VG_EPIAS_USERNAME', 'VG_EPIAS_PASSWORD']) result[key] = '';
  result.VG_GROQ_API_KEY = token;
  result.VG_GROQ_MODEL = '';
  result.VG_INTEGRATIONS_LOCAL = '';
  return result;
}
function clean(sandbox) { const absolute = path.resolve(sandbox), tmp = path.resolve(os.tmpdir()); assert(absolute.startsWith(tmp + path.sep) && path.basename(absolute).startsWith('voltguard-integration-endpoint-')); fs.rmSync(absolute, { recursive: true, force: true }); }

test('Integration endpoint validates HTTP, authorization, CSRF, missing configuration and public status without provider calls', async t => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-integration-endpoint-')), base = 'http://127.0.0.1:' + await freePort(), env = environment(sandbox, base);
  const child = spawn(php, ['-n', '-S', base.slice(7), '-t', root], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.resume(); child.stderr.resume();
  const actor = () => ({ cookies: new Map(), csrf: '' }), outside = actor(), admin = actor(), employee = actor();
  async function request(a, endpoint, action, body, options = {}) {
    const method = options.method || (body === undefined ? 'GET' : 'POST'), headers = { Cookie: [...a.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...options.headers };
    if (method === 'POST') { headers.Origin ??= base; headers['Content-Type'] ??= 'application/json'; if (options.csrf !== false) headers['X-VG-STAFF-CSRF'] = a.csrf; }
    const response = await fetch(`${base}/api/${endpoint}.php?action=${action}${options.query || ''}`, { method, headers, body: method === 'POST' ? (options.raw !== undefined ? options.raw : JSON.stringify(body || {})) : undefined });
    for (const cookie of response.headers.getSetCookie()) { const first = cookie.split(';')[0], at = first.indexOf('='); a.cookies.set(first.slice(0, at), first.slice(at + 1)); }
    const raw = await response.text(); assert(!raw.includes(token), 'A server credential must never appear in any response.'); const data = raw ? JSON.parse(raw) : null; if (data?.csrf) a.csrf = data.csrf;
    return { status: response.status, data, headers: response.headers };
  }
  async function expect(a, action, body, status, code, options) { const r = await request(a, 'integrations', action, body, options); assert.equal(r.status, status, JSON.stringify(r.data)); assert.equal(r.data.api, 'vg-integrations/1'); if (code) assert.equal(r.data.error, code, JSON.stringify(r.data)); return r; }
  async function staff(a, action, body) { const r = await request(a, 'staff', action, body); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; }
  async function activate(a, invite) { await staff(a, 'me'); const start = await staff(a, 'activate', { token: new URL(invite.activationUrl).hash.slice(3), password: 'TemporaryIntegration123!' }); const done = await staff(a, 'mfa_enroll', { code: totp(start.secret) }); assert(done.user?.id); }
  try {
    let started = false; for (let i = 0; i < 100; i++) { try { await fetch(base + '/api/staff.php?action=me'); started = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } } assert(started, 'Isolated PHP process started.');
    await t.test('public status exposes availability, notices and no API secrets', async () => {
      const r = await expect(outside, 'status', undefined, 200); assert.equal(r.data.ok, true); assert.equal(r.data.data.services.tcmb.access, 'public'); assert.equal(r.data.data.services.openweather.configured, false); assert.equal(r.data.data.services.epias.access, 'staff'); assert.equal(r.data.data.services.github.access, 'admin'); assert.equal(r.data.data.ai.groq.configured, true); assert.equal(r.headers.get('cache-control').includes('no-store'), true);
      assert(!JSON.stringify(r.data).includes('VG_GROQ_API_KEY')); assert(!JSON.stringify(r.data).includes(sandbox));
    });
    await t.test('HTTP methods, unknown actions, scalar inputs and missing key fail before network access', async () => {
      await expect(outside, 'does_not_exist', undefined, 404, 'action_unknown'); await expect(outside, 'status', {}, 405, 'method'); await expect(outside, 'tcmb', {}, 405, 'method');
      await expect(outside, 'status', undefined, 405, 'method', { method: 'DELETE' });
      await expect(outside, 'tcmb', undefined, 422, 'input_invalid', { query: '&quotes%5B%5D=TRY' }); await expect(outside, 'tcmb', undefined, 422, 'currency_code', { query: '&base=../../private' });
      await expect(outside, 'openweather', undefined, 503, 'provider_not_configured');
    });
    await t.test('private and AI routes require an authenticated employee before input or provider handling', async () => {
      for (const action of ['epias', 'github', 'jsonplaceholder', 'dummyjson', 'unsplash', 'tmdb', 'newsapi']) await expect(outside, action, undefined, 401, 'staff_unauthorized');
      await expect(outside, 'ai_chat', {}, 401, 'staff_unauthorized', { raw: '{ invalid-json', csrf: false });
      await expect(outside, 'ai_chat', {}, 401, 'staff_unauthorized', { raw: 'x'.repeat(66000), csrf: false });
    });
    const bootstrap = spawnSync(php, ['-n', path.join(root, 'tools/staff-admin.php'), 'bootstrap-invite', '--email', 'integration-admin@example.test', '--name', 'Synthetic Integration Admin'], { env, encoding: 'utf8', windowsHide: true }); assert.equal(bootstrap.status, 0, bootstrap.stderr || bootstrap.stdout); await activate(admin, JSON.parse(bootstrap.stdout));
    const invited = await staff(admin, 'create_invite', { email: 'integration-employee@example.test', name: 'Synthetic Integration Employee', role: 'employee' }); await activate(employee, invited);
    await t.test('employee cannot access administrator-only third-party tools', async () => {
      for (const action of ['github', 'jsonplaceholder', 'dummyjson', 'ipinfo']) await expect(employee, action, undefined, 403, 'admin_required');
      await expect(employee, 'epias', undefined, 503, 'provider_not_configured');
    });
    await t.test('AI POST enforces same origin and CSRF with real native MFA sessions', async () => {
      const input = { provider: 'gemini', prompt: 'Sentetik test.' };
      await expect(admin, 'ai_chat', input, 403, 'staff_csrf', { csrf: false }); await expect(admin, 'ai_chat', input, 403, 'staff_origin', { headers: { Origin: 'https://other.example.invalid' } });
      await expect(admin, 'ai_chat', input, 403, 'staff_origin', { headers: { Origin: '' } });
      await expect(admin, 'ai_chat', input, 400, 'json_invalid', { raw: '{invalid' });
      await expect(admin, 'ai_chat', { provider: 'unsupported', prompt: 'Sentetik test.' }, 400, 'invalid_ai_provider');
      await expect(admin, 'ai_chat', input, 503, 'ai_not_configured');
      await expect(employee, 'ai_chat', input, 503, 'ai_not_configured');
    });
  } finally { child.kill(); await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); }); clean(sandbox); }
});

test('Integration transport and cache helpers enforce fixed sources, private-address rejection, bounded chunks and atomic successful reads', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-integration-endpoint-'));
  const code = `define('VG_API',true);require $argv[1].'/api/lib/bootstrap.php';require $argv[1].'/api/lib/security.php';require $argv[1].'/api/lib/integration-http.php';
  $out=[];$bad=['http://api.frankfurter.dev/v2/rates','https://evil.example/rates','https://127.0.0.1/','https://api.frankfurter.dev.evil.example/','https://api.frankfurter.dev@evil.example/','https://api.frankfurter.dev:444/','https://api.frankfurter.dev/#secret',"https://api.frankfurter.dev/\\r\\nInjected"];
  foreach($bad as $url){try{vg_int_target($url);$out['targets'][]='accepted';}catch(VgIntegrationError $e){$out['targets'][]=$e->errCode;}}
  foreach(['127.0.0.1','10.0.0.2','169.254.1.1','100.64.0.1','192.0.2.3','::1','fc00::1','::ffff:127.0.0.1','8.8.8.8','2606:4700:4700::1111']as$ip)$out['blocked'][$ip]=vh_ip_blocked($ip);
  $why='';$out['privateDns']=['ip'=>vh_resolve_public('127.0.0.1',$why),'why'=>$why];$out['hosts']=vg_int_allowed_hosts();
  $out['decoded']=vg_int_dechunk("4\\r\\nWiki\\r\\n5;ok=yes\\r\\npedia\\r\\n0\\r\\n\\r\\n",9);
  foreach(["a\\r\\n0123456789\\r\\n0\\r\\n\\r\\n","GG\\r\\nx\\r\\n0\\r\\n\\r\\n","4\\r\\nabc","0\\r\\nBAD","0\\r\\n"]as$body){try{vg_int_dechunk($body,9);$out['chunks'][]='accepted';}catch(VgIntegrationError $e){$out['chunks'][]=$e->errCode;}}
  $count=0;$first=vg_int_cache('fixture-cache',60,function()use(&$count){$count++;return ['value'=>42];});$second=vg_int_cache('fixture-cache',60,function()use(&$count){$count++;throw new RuntimeException('Must use successful cache.');});$out['cache']=['first'=>$first,'second'=>$second,'count'=>$count];
  $file=vg_int_dir().'/'.hash('sha256','fixture-cache').'.json';$old=json_decode(file_get_contents($file),true);$old['expires']=time()-1;file_put_contents($file,json_encode($old));$before=file_get_contents($file);
  try{vg_int_cache('fixture-cache',60,function(){throw new VgIntegrationError(502,'upstream_unavailable','Synthetic provider unavailable');});$out['failure']='accepted';}catch(VgIntegrationError $e){$out['failure']=$e->errCode;}$out['unchangedAfterFailure']=$before===file_get_contents($file);
  vg_int_spacing('fixture',1);try{vg_int_spacing('fixture',1);$out['spacing']='accepted';}catch(VgIntegrationError $e){$out['spacing']=$e->errCode;}
  try{vg_int_secret('VG_BAD_SECRET');$out['badSecret']='accepted';}catch(VgIntegrationError $e){$out['badSecret']=$e->errCode;}echo json_encode($out,JSON_THROW_ON_ERROR);`;
  try {
    const env = environment(sandbox, 'http://127.0.0.1'); env.VG_BAD_SECRET = 'invalid\nheader'; const result = spawnSync(php, ['-n', '-r', code, root], { env, encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr || result.stdout); const value = JSON.parse(result.stdout);
    assert(value.targets.every(code => code === 'upstream_not_allowed')); for (const [ip, blocked] of Object.entries(value.blocked)) assert.equal(blocked, !['8.8.8.8', '2606:4700:4700::1111'].includes(ip), ip); assert.deepEqual(value.privateDns, { ip: '', why: 'blocked_address' });
    assert(value.hosts.includes('api.frankfurter.dev')); assert(value.hosts.includes('open.er-api.com')); assert.equal(value.decoded, 'Wikipedia'); assert.equal(value.chunks.length, 5); assert(value.chunks.every(code => code.startsWith('upstream_')), JSON.stringify(value.chunks));
    assert.equal(value.cache.first.value, 42); assert.equal(value.cache.first.cache.hit, false); assert.equal(value.cache.second.cache.hit, true); assert.equal(value.cache.count, 1); assert.equal(value.failure, 'upstream_unavailable'); assert.equal(value.unchangedAfterFailure, true); assert.equal(value.spacing, 'provider_rate_limit'); assert.equal(value.badSecret, 'configuration_invalid');
  } finally { clean(sandbox); }
});

test('Commercial service flags fail closed individually; local exemptions require explicit flag plus loopback and local server name', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-integration-endpoint-'));
  const code = `define('VG_API',true);require $argv[1].'/api/lib/bootstrap.php';require $argv[1].'/api/lib/security.php';require $argv[1].'/api/lib/integrations.php';
  putenv('VG_TMDB_TOKEN=synthetic-test-token');putenv('VG_NEWSAPI_KEY=synthetic-test-key');putenv('VG_TMDB_COMMERCIAL_LICENSE=');putenv('VG_NEWSAPI_PRODUCTION_ALLOWED=');$out=[];
  foreach([['','127.0.0.1','localhost'],['1','203.0.113.2','localhost'],['1','127.0.0.1','voltguard.com.tr'],['1','127.0.0.1','localhost']]as$case){putenv('VG_INTEGRATIONS_LOCAL='.$case[0]);$_SERVER['REMOTE_ADDR']=$case[1];$_SERVER['SERVER_NAME']=$case[2];$s=vg_int_services();$out['local'][]=['development'=>vg_int_development(),'tmdb'=>$s['tmdb']['available'],'newsapi'=>$s['newsapi']['available']];}
  putenv('VG_INTEGRATIONS_LOCAL=');$_SERVER['REMOTE_ADDR']='127.0.0.1';$_SERVER['SERVER_NAME']='localhost';putenv("VG_TMDB_COMMERCIAL_LICENSE=invalid\\nflag");putenv("VG_NEWSAPI_PRODUCTION_ALLOWED=invalid\\nflag");$s=vg_int_services();$out['malformed']=['tmdb'=>$s['tmdb'],'newsapi'=>$s['newsapi'],'tcmb'=>$s['tcmb']];
  putenv('VG_TMDB_COMMERCIAL_LICENSE=1');putenv('VG_NEWSAPI_PRODUCTION_ALLOWED=1');$s=vg_int_services();$out['licensed']=['tmdb'=>$s['tmdb']['available'],'newsapi'=>$s['newsapi']['available']];echo json_encode($out,JSON_THROW_ON_ERROR);`;
  try {
    const result = spawnSync(php, ['-n', '-r', code, root], { env: environment(sandbox, 'http://127.0.0.1'), encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr || result.stdout); const value = JSON.parse(result.stdout);
    assert.deepEqual(value.local, [false, false, false, true].map(allowed => ({ development: allowed, tmdb: allowed, newsapi: allowed })));
    for (const provider of ['tmdb', 'newsapi']) { assert.equal(value.malformed[provider].configured, true); assert.equal(value.malformed[provider].available, false); }
    assert.equal(value.malformed.tcmb.available, true); assert.deepEqual(value.licensed, { tmdb: true, newsapi: true });
  } finally { clean(sandbox); }
});
