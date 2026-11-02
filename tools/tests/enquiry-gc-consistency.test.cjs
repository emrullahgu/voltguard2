'use strict';
// Actual PHP enquiry functions, isolated synthetic storage, no mail or provider/network calls.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), localPhp = path.join(root, '.qa/php/runtime/php.exe');
const php = process.env.VG_PHP || (fs.existsSync(localPhp) ? localPhp : 'php');
const source = process.env.VG_ENQUIRY_TEST_SOURCE || path.join(root, 'api/lib/enquiry.php');
const key = 'synthetic-enquiry-key-'.padEnd(64, '0'), fingerprint = crypto.createHash('sha256').update('synthetic-form').digest('hex');
const requestId = 'synthetic-gc-request-0001', old = new Date(Date.now() - 8 * 86400000);
const phpCode = String.raw`
define('VG_API', true);
$input = json_decode(fgets(STDIN), true, 16, JSON_THROW_ON_ERROR);
$_SERVER['DOCUMENT_ROOT'] = $input['root'];
putenv('VG_DATA_DIR=' . $input['data']);
require $input['root'] . '/api/lib/bootstrap.php';
require $input['root'] . '/api/lib/security.php';
function fixture_event(string $event, array $data = []): void { echo json_encode(['event' => $event] + $data, JSON_THROW_ON_ERROR) . "\n"; fflush(STDOUT); }
$code = file_get_contents($input['source']);
if (!empty($input['reportOpen'])) {
    // Test-only telemetry after the actual fopen and before actual flock: B's event proves its record handle is open.
    // No production hook or alternate implementation is installed; only this in-memory source copy emits a marker.
    $needle = '$fp = @fopen($file, \'c+\');';
    if (substr_count($code, $needle) !== 1) throw new RuntimeException('Expected one real enquiry record fopen');
    $code = str_replace($needle, $needle . ' fixture_event("record_opened");', $code);
}
eval(preg_replace('/^<\?php\s*/', '', $code, 1));
try {
    if ($input['action'] === 'gc') { vg_enquiry_gc(); fixture_event('gc_complete'); }
    else {
        $outcome = vg_enquiry_once($input['requestId'], $input['fingerprint'], function (string $reference) use ($input): void {
            file_put_contents($input['data'] . '/deliveries.jsonl', json_encode(['reference' => $reference, 'actor' => $input['actor']], JSON_THROW_ON_ERROR) . "\n", FILE_APPEND | LOCK_EX);
            fixture_event('delivery_entered', ['reference' => $reference]);
            if (!empty($input['hold'])) {
                if (trim((string)fgets(STDIN)) !== 'continue') throw new RuntimeException('Fixture release missing');
            }
            if (!empty($input['fail'])) throw new RuntimeException('Synthetic delivery failure');
        });
        fixture_event('result', $outcome);
    }
} catch (Throwable $error) { fixture_event('error', ['class' => get_class($error), 'code' => $error instanceof VgHttpError ? $error->errCode : null]); }
`;

function fixture() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-enquiry-gc-')), data = path.join(sandbox, 'data');
  fs.mkdirSync(path.join(data, 'requests'), { recursive: true }); fs.writeFileSync(path.join(data, 'secret.key'), key);
  const children = new Set();
  const record = id => path.join(data, 'requests', crypto.createHmac('sha256', key).update('enquiry\0' + id).digest('hex') + '.json');
  const input = options => ({ root, data, source, action: 'once', requestId, fingerprint, actor: 'single', ...options });
  const sync = options => {
    const result = spawnSync(php, ['-n', '-r', phpCode], { input: JSON.stringify(input(options)) + '\n', encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr, /Warning|Fatal error|Parse error/);
    return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  };
  function worker(options) {
    const child = spawn(php, ['-n', '-r', phpCode], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); children.add(child);
    const events = [], waiters = [], errors = []; let pending = '', completed = null;
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        children.delete(child); completed = { code, signal, stderr: errors.join('') }; resolve(completed);
        for (const waiter of waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(Error('PHP exited before ' + waiter.name + ': ' + JSON.stringify(completed))); }
      });
    });
    child.stderr.on('data', bytes => errors.push(String(bytes)));
    child.stdout.on('data', bytes => {
      pending += String(bytes); let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1); if (!line) continue;
        const event = JSON.parse(line); events.push(event);
        for (const waiter of [...waiters]) if (waiter.name === event.event) { waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(event); }
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify(input(options)) + '\n');
    return { child, done, events, waitFor(name) {
      const prior = events.find(event => event.event === name); if (prior) return Promise.resolve(prior);
      if (completed) return Promise.reject(Error('PHP exited before ' + name + ': ' + JSON.stringify(completed)));
      return new Promise((resolve, reject) => {
        const waiter = { name, resolve, reject, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(Error('Timed out waiting for ' + name + ': ' + JSON.stringify(events) + ' ' + errors.join(''))); }, 15000) };
        waiters.push(waiter);
      });
    } };
  }
  const deliveries = () => fs.existsSync(path.join(data, 'deliveries.jsonl')) ? fs.readFileSync(path.join(data, 'deliveries.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  async function clean() {
    for (const child of children) child.kill();
    await Promise.all([...children].map(child => new Promise(resolve => { child.once('exit', resolve); if (child.exitCode !== null) resolve(); })));
    const absolute = path.resolve(sandbox), temporary = path.resolve(os.tmpdir());
    assert(absolute.startsWith(temporary + path.sep) && path.basename(absolute).startsWith('voltguard-enquiry-gc-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  }
  return { sandbox, data, record, sync, worker, deliveries, clean };
}
function age(file) { fs.utimesSync(file, old, old); }
function fileSymlink(t, target, link) {
  try { fs.symlinkSync(target, link, 'file'); return true; }
  catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) { t.skip('Windows file symlinks require an enabled developer mode or privilege; junction boundary has separate coverage.'); return false; } throw error; }
}

test('Expired enquiry GC preserves an active writer and an already-open queued writer; one delivery/reference remains durable', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.record(requestId), ''); age(f.record(requestId));
    const a = f.worker({ actor: 'A', hold: true, reportOpen: true });
    const entered = await a.waitFor('delivery_entered');
    const b = f.worker({ actor: 'B', reportOpen: true });
    await b.waitFor('record_opened');
    assert.deepEqual(f.sync({ action: 'gc' }), [{ event: 'gc_complete' }]);
    assert(fs.existsSync(f.record(requestId)), 'GC must not unlink the old inode while A or queued B holds coordination SH.');
    assert.equal(f.deliveries().length, 1);
    a.child.stdin.end('continue\n');
    const [aResult, bResult] = await Promise.all([a.waitFor('result'), b.waitFor('result')]);
    const exits = await Promise.all([a.done, b.done]);
    for (const exit of exits) { assert.equal(exit.code, 0, exit.stderr); assert.doesNotMatch(exit.stderr, /Warning|Fatal error/); }
    assert.equal(aResult.duplicate, false); assert.equal(bResult.duplicate, true);
    assert.equal(aResult.reference, entered.reference); assert.equal(bResult.reference, entered.reference);
    assert.deepEqual(f.deliveries().map(x => x.reference), [entered.reference]);
    const durable = JSON.parse(fs.readFileSync(f.record(requestId), 'utf8'));
    assert.deepEqual(Object.keys(durable).sort(), ['at', 'fp', 'reference']);
    assert.equal(durable.reference, entered.reference); assert.equal(durable.fp, fingerprint);
    assert(Number.isInteger(durable.at) && Math.abs(durable.at - Math.floor(Date.now() / 1000)) < 30);
    const replay = f.sync({ actor: 'replay' }).find(x => x.event === 'result');
    assert.equal(replay.reference, entered.reference); assert.equal(replay.duplicate, true); assert.equal(f.deliveries().length, 1);
  } finally { await f.clean(); }
});

test('GC removes only expired idle hash JSON records, keeps recent/non-record paths and never replaces its empty coordination inode', async () => {
  const f = fixture();
  try {
    const expired = f.record('expired-empty-0001'), expiredV1 = f.record('expired-v1-00001'), recent = f.record('recent-record-0001');
    fs.writeFileSync(expired, ''); age(expired);
    fs.writeFileSync(expiredV1, JSON.stringify({ reference: 'VG-261001-ABCDE', fp: fingerprint, at: 1 })); age(expiredV1);
    fs.writeFileSync(recent, 'recent');
    const unrelated = path.join(f.data, 'requests', 'unrelated.json'); fs.writeFileSync(unrelated, 'do not remove'); age(unrelated);
    const directory = f.record('directory-entry-0001'); fs.mkdirSync(directory); age(directory);
    f.sync({ action: 'gc' });
    assert.equal(fs.existsSync(expired), false); assert.equal(fs.existsSync(expiredV1), false);
    assert.equal(fs.readFileSync(recent, 'utf8'), 'recent'); assert.equal(fs.readFileSync(unrelated, 'utf8'), 'do not remove'); assert(fs.statSync(directory).isDirectory());
    const lock = path.join(f.data, 'requests', '.records.lock'), first = fs.lstatSync(lock); age(lock);
    f.sync({ action: 'gc' }); const second = fs.lstatSync(lock);
    assert(first.isFile() && !first.isSymbolicLink()); assert.equal(fs.readFileSync(lock, 'utf8'), '');
    assert.equal(first.ino, second.ino); assert.equal(first.birthtimeMs, second.birthtimeMs);
  } finally { await f.clean(); }
});

test('A requests directory symlink/junction cannot make GC or delivery traverse outside its private directory', async () => {
  const f = fixture();
  try {
    const outside = path.join(f.sandbox, 'outside'); fs.mkdirSync(outside);
    const externalRecord = path.join(outside, path.basename(f.record(requestId))); fs.writeFileSync(externalRecord, 'outside sentinel'); age(externalRecord);
    fs.rmdirSync(path.join(f.data, 'requests')); fs.symlinkSync(outside, path.join(f.data, 'requests'), process.platform === 'win32' ? 'junction' : 'dir');
    f.sync({ action: 'gc' }); assert.equal(fs.readFileSync(externalRecord, 'utf8'), 'outside sentinel');
    assert(f.sync({}).some(x => x.event === 'error' && x.code === 'unavailable')); assert.equal(f.deliveries().length, 0);
  } finally { await f.clean(); }
});

test('A requests alias to another private child cannot turn GC into cleanup of a different record collection', async () => {
  const f = fixture();
  try {
    const otherCollection = path.join(f.data, 'magaza', 'istekler'); fs.mkdirSync(otherCollection, { recursive: true });
    const sentinel = path.join(otherCollection, path.basename(f.record(requestId))); fs.writeFileSync(sentinel, 'different collection sentinel'); age(sentinel);
    fs.rmdirSync(path.join(f.data, 'requests'));
    fs.symlinkSync(otherCollection, path.join(f.data, 'requests'), process.platform === 'win32' ? 'junction' : 'dir');
    f.sync({ action: 'gc' }); assert.equal(fs.readFileSync(sentinel, 'utf8'), 'different collection sentinel');
    assert(f.sync({}).some(x => x.event === 'error' && x.code === 'unavailable')); assert.equal(f.deliveries().length, 0);
    assert.equal(fs.existsSync(path.join(otherCollection, '.records.lock')), false, 'A rejected alias must not create a coordination file in the other collection.');
  } finally { await f.clean(); }
});

test('Record symlinks cannot delete or overwrite an outside target', async t => {
  const f = fixture();
  try {
    const external = path.join(f.sandbox, 'outside-record.json'); fs.writeFileSync(external, 'outside sentinel'); age(external);
    if (!fileSymlink(t, external, f.record(requestId))) return;
    f.sync({ action: 'gc' }); assert.equal(fs.readFileSync(external, 'utf8'), 'outside sentinel'); assert(fs.lstatSync(f.record(requestId)).isSymbolicLink());
    assert(f.sync({}).some(x => x.event === 'error' && x.code === 'unavailable')); assert.equal(f.deliveries().length, 0); assert.equal(fs.readFileSync(external, 'utf8'), 'outside sentinel');
  } finally { await f.clean(); }
});

test('A coordination symlink is rejected without touching its outside target or old records', async t => {
  const f = fixture();
  try {
    const external = path.join(f.sandbox, 'outside-lock'); fs.writeFileSync(external, 'outside sentinel');
    if (!fileSymlink(t, external, path.join(f.data, 'requests', '.records.lock'))) return;
    fs.writeFileSync(f.record(requestId), ''); age(f.record(requestId));
    f.sync({ action: 'gc' }); assert(fs.existsSync(f.record(requestId))); assert.equal(fs.readFileSync(external, 'utf8'), 'outside sentinel');
    assert(f.sync({}).some(x => x.event === 'error' && x.code === 'unavailable')); assert.equal(f.deliveries().length, 0);
  } finally { await f.clean(); }
});

test('A nonregular coordination path fails closed and a failed delivery releases both locks', async () => {
  const f = fixture();
  try {
    const lock = path.join(f.data, 'requests', '.records.lock'); fs.mkdirSync(lock);
    fs.writeFileSync(f.record(requestId), ''); age(f.record(requestId));
    f.sync({ action: 'gc' }); assert(fs.existsSync(f.record(requestId)));
    assert(f.sync({}).some(x => x.event === 'error' && x.code === 'unavailable')); assert.equal(f.deliveries().length, 0);
    fs.rmdirSync(lock);
    assert(f.sync({ fail: true }).some(x => x.event === 'error' && x.class === 'RuntimeException'));
    f.sync({ action: 'gc' }); assert.equal(fs.existsSync(f.record(requestId)), false, 'After delivery failure no SH/EX lock can remain held.');
    assert(f.sync({}).some(x => x.event === 'result' && x.duplicate === false));
  } finally { await f.clean(); }
});
