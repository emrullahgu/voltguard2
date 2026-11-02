/* Adapter contract checks use real private staff state in a temporary directory. */
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-ubuntu-adapter-'));
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function run() {
let child, productionChild;
try {
  const result = spawnSync(php, ['-n', path.join(__dirname, 'company-ubuntu-fixture.php')], {
    env: { ...process.env, VG_DATA_DIR: temporary, VG_STORE: 'json', VG_STAFF_SITE_URL: 'http://127.0.0.1:4173' },
    encoding: 'utf8', windowsHide: true, timeout: 45000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr, '', 'Authenticated adapter must not emit undefined fields or PHP warnings.');
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.ok(report.checks >= 30, 'Adapter contract coverage must include data and authorization failures.');
  const base = `http://127.0.0.1:${await freePort()}`;
  child = spawn(php, ['-n', '-S', base.slice(7), '-t', root], {
    env: { ...process.env, VG_DATA_DIR: temporary, VG_STORE: 'json', VG_STAFF_SITE_URL: base },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdout.resume(); child.stderr.resume();
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch(`${base}/api/staff.php?action=me`); break; }
    catch { if (attempt === 99) throw new Error('Synthetic PHP server could not start'); await new Promise(resolve => setTimeout(resolve, 30)); }
  }
  let httpChecks = 0;
  async function request(action, body, authenticated = true, extraHeaders = {}) {
    const headers = authenticated ? { Cookie: `VGSTAFF=${report.sessionId}` } : {};
    if (body !== undefined) Object.assign(headers, { Origin: base, 'Content-Type': 'application/json', 'X-VG-STAFF-CSRF': report.csrf });
    Object.assign(headers, extraHeaders);
    const response = await fetch(`${base}/api/company.php?action=${action}`, {
      method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); httpChecks++; }
  const configuration = path.join(temporary, 'company/ubuntu.json');
  fs.writeFileSync(configuration, JSON.stringify(report.config));
  let response = await request('bootstrap', undefined, false);
  equal(response.status, 401, 'Uninvited guest cannot access configured Ubuntu company data');
  equal(response.data.error, 'staff_unauthorized', 'Private staff authentication precedes remote transport');
  response = await request('query', { table: 'products', operation: 'select' }, true, { 'X-VG-STAFF-CSRF': '' });
  equal(response.status, 403, 'Remote mode retains staff CSRF guard');
  equal(response.data.error, 'staff_csrf', 'Missing private token rejected before transport');
  response = await request('storage', { key: 'oversized', value: 'x'.repeat(2 * 1024 * 1024) });
  equal(response.status, 413, 'Remote mode retains original encoded 2 MiB body limit');
  equal(response.data.error, 'too_large', 'Oversized preferences are rejected before transport');
  response = await request('bootstrap');
  equal(response.status, 503, 'Unavailable configured host never silently reads local state');
  equal(response.data.error, 'company_ubuntu_unavailable', 'Offline remote data source has explicit failure');
  equal(response.headers.get('cache-control').includes('no-store'), true, 'Remote data failures remain private and uncached');
  response = await request('health');
  equal(response.status, 503, 'Private health check tests configured data host rather than local preview availability');
  equal(response.data.error, 'company_ubuntu_unavailable', 'Health check reports actual remote transport failure');
  response = await request('health', undefined, false);
  equal(response.status, 401, 'Remote health information remains staff-only');
  response = await request('query', { table: 'users', operation: 'select', select: 'id,name,email,role' });
  equal(response.status, 200, 'Private account directory remains usable while business database is offline');
  equal(response.data.data.length, 1, 'Ordinary staff receives only their own local private identity');
  response = await request('rpc', { name: 'app_portal_identity', args: {} });
  equal(response.status, 200, 'Verified account identity RPC does not depend on Ubuntu business availability');
  equal(response.data.data.id, 'synthetic-employee', 'Identity still comes from independent private staff account');
  for (const invalid of ['{broken', JSON.stringify({ ...report.config, host: 'invalid host; command' })]) {
    fs.writeFileSync(configuration, invalid);
    response = await request('bootstrap');
    equal(response.status, 503, 'Malformed private Ubuntu configuration fails closed');
    equal(response.data.error, 'company_unavailable', 'Configuration errors do not disclose host paths or secrets');
  }
  fs.unlinkSync(configuration);
  fs.mkdirSync(configuration);
  response = await request('bootstrap');
  equal(response.status, 503, 'Configuration directory must fail closed through actual HTTP API');
  equal(response.data.error, 'company_unavailable', 'Nonregular configured source never activates local business state');
  fs.rmdirSync(configuration);
  assert.equal(fs.existsSync(path.join(temporary, 'company/state.json')), false, 'Remote adapter must never create a silent local company fallback.');
  // A private Temp-only router models TLS termination and a production peer.
  // It is never installed in the application or reachable outside loopback.
  const router = path.join(temporary, 'production-router.php');
  const phpLiteral = value => "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  fs.writeFileSync(router, "<?php\n$_SERVER['HTTPS']='on';\n$_SERVER['HTTP_HOST']='production.example.test';\n$_SERVER['REMOTE_ADDR']='203.0.113.24';\nrequire " + phpLiteral(path.join(root, 'api/company.php')) + ";\n");
  const productionBase = `http://127.0.0.1:${await freePort()}`;
  productionChild = spawn(php, ['-n', '-S', productionBase.slice(7), '-t', root, router], {
    env: { ...process.env, VG_DATA_DIR: temporary, VG_STORE: 'json', VG_STAFF_SITE_URL: 'https://production.example.test' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  productionChild.stdout.resume(); productionChild.stderr.resume();
  async function productionRequest(body, authenticated = true, csrf = true) {
    const headers = authenticated ? { Cookie: `VGSTAFF=${report.sessionId}` } : {};
    if (body !== undefined) Object.assign(headers, { Origin: 'https://production.example.test', 'Content-Type': 'application/json', ...(csrf ? { 'X-VG-STAFF-CSRF': report.csrf } : {}) });
    const response = await fetch(`${productionBase}/api/company.php?action=${body === undefined ? 'saha_bootstrap' : 'rpc'}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await productionRequest(undefined, false); break; }
    catch { if (attempt === 99) throw new Error('Production-context PHP fixture could not start'); await new Promise(resolve => setTimeout(resolve, 30)); }
  }
  response = await productionRequest(undefined, false);
  equal(response.status, 401, 'Production source readiness stays behind employee authentication');
  equal(response.data.error, 'staff_unauthorized', 'Missing source is not a guest authorization shortcut');
  response = await productionRequest({name:'app_saha_query',args:{table:'customers',operation:'select'}}, true, false);
  equal(response.status, 403, 'Production native source gate retains write-endpoint CSRF checks');
  equal(response.data.error, 'staff_csrf', 'CSRF is checked before source routing');
  response = await productionRequest();
  equal(response.status, 503, 'Real production GET cannot return a healthy empty native source');
  equal(response.data.error, 'company_saha_source_required', 'Missing production source has a specific nonsecret configuration error');
  equal(response.headers.get('cache-control').includes('no-store'), true, 'Source setup failures remain private and uncached');
  response = await productionRequest({name:'app_saha_query',args:{table:'customers',operation:'insert',rows:[{short_name:'Must not be stored',title:'Synthetic source gate'}]}});
  equal(response.status, 503, 'Missing production source rejects business inserts as well as bootstrap reads');
  equal(response.data.error, 'company_saha_source_required', 'A write cannot create a second source of business truth');
  equal(fs.existsSync(path.join(temporary,'company/state.json')), false, 'Rejected production insert leaves no local data file');
  fs.writeFileSync(configuration, JSON.stringify({...report.config,sahaHelper:'/home/fixture/saha_store.py'}));
  response = await productionRequest();
  equal(response.status, 503, 'Configured unavailable source remains an explicit transport failure');
  equal(response.data.error, 'company_ubuntu_unavailable', 'Configured native source retains its existing source-helper routing');
  equal(fs.existsSync(path.join(temporary,'company/state.json')), false, 'A failing configured helper never falls back to local business data');
  fs.unlinkSync(configuration);
  console.log(`Ubuntu company adapter: ${report.checks + httpChecks} checks passed; synthetic transport and private Temp staff data only.`);
} finally {
  for (const server of [child, productionChild]) if (server) {
    server.kill();
    await new Promise(resolve => { if (server.exitCode !== null) resolve(); else { server.once('exit', resolve); setTimeout(resolve, 3000); } });
  }
  const target = fs.realpathSync(temporary);
  const tempRoot = fs.realpathSync(os.tmpdir());
  assert.ok(path.relative(tempRoot, target).startsWith('voltguard-ubuntu-adapter-'));
  fs.rmSync(target, { recursive: true, force: true });
}
}
run().catch(error => { console.error(error.stack); process.exitCode = 1; });
