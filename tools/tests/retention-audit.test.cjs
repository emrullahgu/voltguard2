'use strict';

// Isolated filesystem fixtures only. The audit never receives the real private data directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const {spawn, spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const localPhp = path.join(root, '.qa/php/runtime/php.exe');
const php = process.env.VG_PHP || (fs.existsSync(localPhp) ? localPhp : 'php');
const script = path.join(root, 'tools/retention-audit.php');
const prefix = 'voltguard-retention-audit-';
const sentinel = 'SYNTHETIC_PRIVATE_DO_NOT_EMIT_198.51.100.17_fixture@example.test';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const hashName = letter => letter.repeat(64) + '.json';

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const data = path.join(home, 'private'), web = path.join(home, 'public');
  fs.mkdirSync(data); fs.mkdirSync(web);
  return {home, data, web};
}
function clean(home) {
  const resolved = path.resolve(home);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert(path.basename(resolved).startsWith(prefix));
  fs.rmSync(resolved, {recursive:true, force:true});
}
function write(where, value, ageSeconds = 0) {
  fs.mkdirSync(path.dirname(where), {recursive:true});
  fs.writeFileSync(where, value);
  const when = new Date(Date.now() - ageSeconds * 1000);
  fs.utimesSync(where, when, when);
}
function run(args, environment = {}) {
  const result = spawnSync(php, ['-n', script, ...args], {encoding:'utf8', windowsHide:true, timeout:10000,
    env:{...process.env, ...environment}});
  assert(!result.error, result.error?.message);
  assert.equal(result.stderr, '', 'Audit must not expose warnings, paths or source content on stderr.');
  return {...result, report:JSON.parse(result.stdout)};
}
function snapshot(directory) {
  const result = {};
  function walk(current, relative) {
    const stat = fs.lstatSync(current);
    result[relative] = {mode:stat.mode, mtime:stat.mtimeMs, kind:stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : 'file'};
    if (stat.isSymbolicLink()) result[relative].target = fs.readlinkSync(current);
    else if (stat.isDirectory()) for (const name of fs.readdirSync(current).sort()) walk(path.join(current, name), relative + '/' + name);
    else result[relative].content = digest(fs.readFileSync(current));
  }
  walk(directory, '');
  return result;
}

test('retention audit requires an explicit absolute existing private directory and has no mutation mode', () => {
  const f = fixture();
  try {
    write(path.join(f.data, 'secret.key'), sentinel);
    const before = snapshot(f.home);
    let result = run([], {VG_DATA_DIR:f.data});
    assert.equal(result.status, 2); assert.equal(result.report.error, 'explicit_data_directory_required');
    for (const args of [['--data-dir',f.data,'--apply'],['--data-dir',f.data,'--delete','yes'],['--data-dir',f.data,'--data-dir',f.data],['--data-dir',f.data,'--max-entries','0'],['--data-dir',f.data,'--max-seconds','31']]) {
      result = run(args); assert.equal(result.status, 2); assert.equal(result.report.error, 'invalid_arguments');
    }
    for (const directory of ['.', path.join(f.home, 'not-created'), '\\\\network.invalid\\share']) {
      result = run(['--data-dir', directory]); assert.equal(result.status, 1); assert.equal(result.report.error, 'unsafe_or_missing_directory');
      assert(!result.stdout.includes(directory));
    }
    result = run(['--data-dir',f.data,'--docroot',f.home]);
    assert.equal(result.report.error, 'data_directory_overlaps_web_root');
    assert.deepEqual(snapshot(f.home), before, 'Failed/usage invocations must not create, chmod, modify or remove files.');
  } finally { clean(f.home); }
});

test('retention audit emits aggregates, never opens cache/business bodies, and leaves the fixture unchanged', () => {
  const f = fixture();
  try {
    const request = JSON.stringify({reference:sentinel, fp:sentinel, at:1});
    const malformed = '{ invalid ' + sentinel;
    const rate = JSON.stringify({hits:[1,2], extra:sentinel});
    write(path.join(f.data, 'requests', hashName('a')), request, 8 * 86400);
    write(path.join(f.data, 'requests', hashName('b')), malformed);
    write(path.join(f.data, 'requests', 'not-an-allowlisted-name.json'), sentinel);
    write(path.join(f.data, 'requests', '.gc.lock'), sentinel);
    write(path.join(f.data, 'rl', hashName('c')), rate, 2 * 86400);
    write(path.join(f.data, 'integrations', hashName('d')), '{malformed cache ' + sentinel, -86400);
    const oversized = path.join(f.data, 'integrations', hashName('e'));
    write(oversized, sentinel); fs.truncateSync(oversized, 4194305);
    write(path.join(f.data, 'magaza', 'siparisler.json'), '{business body ' + sentinel, 400 * 86400);
    write(path.join(f.data, 'magaza', 'istekler', hashName('f')), '{business metadata body ' + sentinel);
    write(path.join(f.data, 'magaza-talep', '2026-11.jsonl'), sentinel);
    write(path.join(f.data, 'integrations-secrets.json'), sentinel);
    write(path.join(f.data, 'staff', 'state.json'), sentinel);
    write(path.join(f.data, 'secret.key'), sentinel);
    const before = snapshot(f.home);
    const result = run(['--data-dir',f.data,'--docroot',f.web]);
    assert.equal(result.status, 0); assert.equal(result.report.ok, true); assert.equal(result.report.complete, true);
    assert.equal(result.report.mode, 'read_only');
    const groups = result.report.groups;
    assert.equal(groups.contact_request_metadata.files, 2);
    assert.equal(groups.contact_request_metadata.ignoredEntries, 2);
    assert.equal(groups.contact_request_metadata.malformedMetadata, 1);
    assert.equal(groups.contact_request_metadata.pastObservedMtimeThresholdFiles, 1);
    assert.equal(groups.rate_limit_metadata.pastObservedMtimeThresholdFiles, 1);
    assert.equal(groups.integration_cache.inspection, 'cache_metadata_only');
    assert.equal(groups.integration_cache.files, 2);
    assert.equal(groups.integration_cache.futureMtimeFiles, 1);
    assert.equal(groups.integration_cache.oversizeFiles, 1);
    assert.equal(groups.integration_cache.malformedMetadata, 0, 'Cache JSON bodies must not be validated or parsed.');
    assert.equal(groups.integration_cache.runtimeExpiryInspected, false);
    assert.equal(groups.integration_cache.contentInspectedFiles, 0);
    assert.equal(groups.shop_orders_file.files, 1);
    assert.equal(groups.shop_orders_file.ageBuckets.atLeast365Days, 1);
    assert.equal(groups.shop_orders_file.businessRetentionDecision, 'company_decision_required');
    assert.equal(groups.shop_request_metadata.contentInspectedFiles, 0);
    assert.equal(groups.shop_enquiry_files.contentInspectedFiles, 0);
    assert.equal(result.report.metadataBytesRead, Buffer.byteLength(request) + Buffer.byteLength(malformed) + Buffer.byteLength(rate));
    for (const forbidden of [sentinel, f.data, f.web, hashName('a'), 'VG_GEMINI_API_KEY', 'siparisler.json']) assert(!result.stdout.includes(forbidden));
    assert.deepEqual(snapshot(f.home), before, 'No content, modification time, permissions, directory entries or links may change.');
  } finally { clean(f.home); }
});

test('retention audit reports bounded incomplete work instead of claiming a complete scan', () => {
  const f = fixture();
  try {
    for (const name of ['a','b','c']) write(path.join(f.data, 'requests', hashName(name)), JSON.stringify({reference:'synthetic',fp:'synthetic',at:1}));
    const before = snapshot(f.home);
    const result = run(['--data-dir',f.data,'--docroot',f.web,'--max-entries','1']);
    assert.equal(result.status, 1); assert.equal(result.report.ok, true); assert.equal(result.report.complete, false);
    assert.equal(result.report.entriesExamined, 1); assert(result.report.incompleteReasons.includes('entry_limit'));
    assert.equal(result.report.groups.contact_request_metadata.files, 1);
    assert.deepEqual(snapshot(f.home), before);
  } finally { clean(f.home); }
});

test('retention audit excludes linked directories, files and hardlinks without reading their targets', () => {
  const f = fixture();
  try {
    const outside = path.join(f.home, 'outside'); fs.mkdirSync(outside);
    write(path.join(outside, hashName('a')), sentinel);
    fs.symlinkSync(outside, path.join(f.data,'integrations'), process.platform === 'win32' ? 'junction' : 'dir');
    const linkedRoot = path.join(f.home, 'linked-private');
    fs.symlinkSync(f.data, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    fs.mkdirSync(path.join(f.data,'requests'));
    fs.linkSync(path.join(outside, hashName('a')),path.join(f.data,'requests',hashName('b')));
    const before = snapshot(f.home);
    let result = run(['--data-dir',linkedRoot,'--docroot',f.web]);
    assert.equal(result.status,1); assert.equal(result.report.error,'unsafe_or_missing_directory');
    result = run(['--data-dir',f.data,'--docroot',f.web]);
    assert.equal(result.status,1); assert.equal(result.report.complete,false);
    assert.equal(result.report.groups.integration_cache.status,'excluded_link');
    assert.equal(result.report.groups.integration_cache.files,0);
    assert.equal(result.report.groups.contact_request_metadata.unsafeEntries,1);
    assert.equal(result.report.groups.contact_request_metadata.files,0);
    assert.equal(result.report.metadataBytesRead,0); assert(!result.stdout.includes(sentinel));
    assert.deepEqual(snapshot(f.home),before);
  } finally { clean(f.home); }
});

async function freePort() {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0,'127.0.0.1',resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
test('retention audit rejects HTTP before application configuration or storage can be loaded', async () => {
  const f = fixture(); const before = snapshot(f.home); const port = await freePort();
  const child = spawn(php,['-n','-S',`127.0.0.1:${port}`,'-t',root],{windowsHide:true,stdio:'ignore',env:{...process.env,VG_DATA_DIR:f.data}});
  try {
    let response;
    for (let i=0;i<100;i++) {
      try { response = await fetch(`http://127.0.0.1:${port}/tools/retention-audit.php`,{signal:AbortSignal.timeout(1000)}); break; }
      catch { await new Promise(resolve=>setTimeout(resolve,25)); }
    }
    assert(response,'Isolated PHP HTTP process must start.');
    assert.equal(response.status,404); assert.equal(await response.text(),'');
    assert.deepEqual(snapshot(f.home),before,'HTTP must not load bootstrap or write private-store protection/config files.');
  } finally {
    child.kill(); await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve)); clean(f.home);
  }
});
