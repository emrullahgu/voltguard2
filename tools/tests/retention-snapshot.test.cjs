'use strict';

// Linux cron wrapper; isolated fixtures only. Never pass the production data directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn, spawnSync} = require('node:child_process');
const source = path.resolve(__dirname, '..');
const linux = process.platform === 'linux';
const prefix = 'voltguard-retention-snapshot-';
const sentinel = 'SYNTHETIC_PRIVATE_DO_NOT_EMIT_fixture@example.test';
const php = process.env.VG_PHP || 'php';
const resolvedPhp = linux ? spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'resolve', php], {encoding:'utf8'}).stdout.trim() : '';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function fixture(auditBody) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const data = path.join(home, 'data'), web = path.join(home, 'web'), output = path.join(home, 'output'), bin = path.join(home, 'bin');
  for (const directory of [data, web, output, bin]) fs.mkdirSync(directory, {mode:0o700});
  const script = path.join(bin, 'run-retention-snapshot.sh');
  fs.copyFileSync(path.join(source, 'run-retention-snapshot.sh'), script);
  if (auditBody === undefined) fs.copyFileSync(path.join(source, 'retention-audit.php'), path.join(bin, 'retention-audit.php'));
  else fs.writeFileSync(path.join(bin, 'retention-audit.php'), auditBody);
  return {home, data, web, output, bin, script};
}
function clean(f) {
  assert.equal(path.dirname(f.home), path.resolve(os.tmpdir()));
  assert(path.basename(f.home).startsWith(prefix));
  fs.rmSync(f.home, {recursive:true, force:true});
}
function args(f, extra = []) {
  return [f.script, '--php', resolvedPhp, '--data-dir', f.data, '--docroot', f.web, '--output-dir', f.output, ...extra];
}
function run(f, extra = []) {
  const result = spawnSync('/bin/sh', args(f, extra), {encoding:'utf8', timeout:15000});
  assert.ifError(result.error);
  assert.equal(result.stdout, '', 'The cron wrapper must not emit reports to stdout/email.');
  assert(!result.stderr.includes(f.home)); assert(!result.stderr.includes(sentinel));
  return result;
}
function report(f, name = 'latest.json') { return JSON.parse(fs.readFileSync(path.join(f.output, name), 'utf8')); }
function contents(directory) {
  const result = {};
  for (const name of fs.readdirSync(directory).sort()) {
    const full = path.join(directory, name), stat = fs.lstatSync(full);
    result[name] = stat.isDirectory() ? contents(full) : {hash:hash(fs.readFileSync(full)), mtime:stat.mtimeMs, mode:stat.mode};
  }
  return result;
}
function expectedFiles(f, previous = false) {
  assert.deepEqual(fs.readdirSync(f.output).sort(), previous ? ['inventory.lock', 'latest.json', 'previous.json'] : ['inventory.lock', 'latest.json']);
  for (const name of fs.readdirSync(f.output)) assert.equal(fs.statSync(path.join(f.output, name)).mode & 0o777, 0o600);
}
function sourceData(f) {
  fs.mkdirSync(path.join(f.data, 'requests'));
  fs.writeFileSync(path.join(f.data, 'requests', 'a'.repeat(64) + '.json'), JSON.stringify({reference:sentinel, fp:sentinel, at:1}));
  fs.writeFileSync(path.join(f.data, 'secret.key'), sentinel);
}

test('retention snapshot publishes complete private aggregates atomically and preserves previous', {skip:!linux}, () => {
  assert(resolvedPhp, 'PHP CLI must be available.');
  const f = fixture();
  try {
    sourceData(f); const before = contents(f.data);
    assert.equal(run(f).status, 0);
    const first = fs.readFileSync(path.join(f.output, 'latest.json'));
    assert.equal(report(f).ok, true); assert.equal(report(f).audit.complete, true);
    assert.equal(report(f).audit.groups.contact_request_metadata.files, 1);
    assert(!first.toString().includes(sentinel)); assert(!first.toString().includes(f.home));
    expectedFiles(f);
    assert.equal(run(f).status, 0);
    assert.deepEqual(fs.readFileSync(path.join(f.output, 'previous.json')), first);
    expectedFiles(f, true); assert.deepEqual(contents(f.data), before);
  } finally { clean(f); }
});

test('partial and rejected audit results replace latest instead of disguising stale success', {skip:!linux}, () => {
  const f = fixture();
  try {
    assert.equal(run(f).status, 0); const successful = fs.readFileSync(path.join(f.output, 'latest.json'));
    fs.writeFileSync(path.join(f.bin, 'retention-audit.php'), '<?php echo json_encode(["tool"=>"voltguard-retention-audit/1","ok"=>true,"complete"=>false,"groups"=>[],"incompleteReasons"=>["locked_content"]]); exit(1);');
    assert.equal(run(f).status, 1); assert.equal(report(f).ok, false); assert.equal(report(f).audit.complete, false);
    assert.deepEqual(fs.readFileSync(path.join(f.output, 'previous.json')), successful);
    fs.writeFileSync(path.join(f.bin, 'retention-audit.php'), '<?php echo json_encode(["tool"=>"voltguard-retention-audit/1","ok"=>false,"error"=>"scan_failed"]); exit(1);');
    assert.equal(run(f).status, 1); assert.equal(report(f).ok, false); assert.equal(report(f).audit.error, 'scan_failed');
    expectedFiles(f, true);
  } finally { clean(f); }
});

test('a crashed audit emits only a fixed failure envelope and leaves no growing logs', {skip:!linux}, () => {
  const f = fixture(`<?php fwrite(STDERR, ${JSON.stringify(sentinel)}); echo ${JSON.stringify(sentinel)}; exit(7);`);
  try {
    assert.equal(run(f).status, 7);
    assert.equal(report(f).ok, false); assert.equal(report(f).auditExitCode, 7);
    assert.equal(report(f).error, 'audit_output_invalid_or_process_failed');
    assert(!fs.readFileSync(path.join(f.output, 'latest.json'), 'utf8').includes(sentinel));
    for (let i = 0; i < 4; i++) assert.equal(run(f).status, 7);
    expectedFiles(f, true);
  } finally { clean(f); }
});

test('invalid audit JSON with exit zero publishes fresh failure and returns failure', {skip:!linux}, () => {
  const f = fixture();
  try {
    assert.equal(run(f).status, 0); const successful = fs.readFileSync(path.join(f.output, 'latest.json'));
    fs.writeFileSync(path.join(f.bin, 'retention-audit.php'), `<?php echo ${JSON.stringify(sentinel)};`);
    assert.equal(run(f).status, 1);
    assert.equal(report(f).ok, false); assert.equal(report(f).auditExitCode, 0);
    assert.equal(report(f).error, 'audit_output_invalid_or_process_failed');
    assert.deepEqual(fs.readFileSync(path.join(f.output, 'previous.json')), successful);
    assert(!fs.readFileSync(path.join(f.output, 'latest.json'), 'utf8').includes(sentinel));
    expectedFiles(f, true);
  } finally { clean(f); }
});

test('overlapping runs retain the permanent coordination inode and only one audit runs', {skip:!linux}, async () => {
  const f = fixture('<?php file_put_contents(__DIR__."/started", "yes"); usleep(900000); echo json_encode(["tool"=>"voltguard-retention-audit/1","ok"=>true,"complete"=>true,"groups"=>[]]);');
  try {
    const child = spawn('/bin/sh', args(f), {stdio:['ignore', 'pipe', 'pipe']});
    const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)); });
    const deadline = Date.now() + 4000;
    while (!fs.existsSync(path.join(f.bin, 'started')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 15));
    assert(fs.existsSync(path.join(f.bin, 'started')), 'First audit must enter before testing lock contention.');
    const inode = fs.statSync(path.join(f.output, 'inventory.lock')).ino;
    assert.equal(run(f).status, 0);
    assert(!fs.existsSync(path.join(f.output, 'latest.json')), 'A skipped competing invocation must not publish a report.');
    assert.equal(await done, 0); expectedFiles(f);
    assert.equal(fs.statSync(path.join(f.output, 'inventory.lock')).ino, inode);
    assert.equal(run(f).status, 0); expectedFiles(f, true);
    assert.equal(fs.statSync(path.join(f.output, 'inventory.lock')).ino, inode);
  } finally { clean(f); }
});

test('snapshot refuses unsafe directory aliases, public output and permissive output modes', {skip:!linux}, () => {
  const f = fixture();
  try {
    const alias = path.join(f.home, 'alias'); fs.symlinkSync(f.output, alias);
    for (const output of [alias, f.web, path.join(f.web, 'nested'), f.data]) {
      if (!fs.existsSync(output)) fs.mkdirSync(output, {mode:0o700});
      const copy = {...f, output}; assert.notEqual(run(copy).status, 0);
      assert(!fs.existsSync(path.join(output, 'latest.json')));
    }
    fs.chmodSync(f.output, 0o755); assert.notEqual(run(f).status, 0); fs.chmodSync(f.output, 0o700);
    fs.symlinkSync(f.data, path.join(f.home, 'data-alias'));
    assert.notEqual(run({...f, data:path.join(f.home, 'data-alias')}).status, 0);
    assert.deepEqual(fs.readdirSync(f.output), []);
  } finally { clean(f); }
});

test('snapshot rejects symlink and hard-link output targets without altering their source', {skip:!linux}, () => {
  for (const name of ['inventory.lock', 'latest.json', 'previous.json']) {
    for (const kind of ['symlink', 'hardlink']) {
      const f = fixture();
      try {
        const outside = path.join(f.home, 'must-remain'); fs.writeFileSync(outside, sentinel, {mode:0o600});
        if (kind === 'symlink') fs.symlinkSync(outside, path.join(f.output, name));
        else fs.linkSync(outside, path.join(f.output, name));
        const before = contents(f.data);
        assert.notEqual(run(f).status, 0);
        assert.equal(fs.readFileSync(outside, 'utf8'), sentinel);
        assert.deepEqual(contents(f.data), before);
        assert.deepEqual(fs.readdirSync(f.output), [name]);
      } finally { clean(f); }
    }
  }
});
