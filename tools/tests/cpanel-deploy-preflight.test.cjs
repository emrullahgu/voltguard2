'use strict';

// Only disposable source trees; never runs the deployment copy/remove tasks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const scriptSource = path.join(root, 'tools/cpanel-deploy-preflight.sh');
const linux = process.platform === 'linux';
const prefix = 'voltguard-cpanel-preflight-';
const php = process.env.VG_PHP || 'php';
const dirs = 'fonts css js assets public api bilgi hizmetler akademi sor mm hesap calisan hesaplama araclar voltsim volthaber magaza'.split(' ');
const rootFiles = '.htaccess contact.php index.html 404.html manifest.json robots.txt llms.txt sitemap.xml sw.js'.split(' ');
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const dir of dirs.concat('tools')) fs.mkdirSync(path.join(home, dir));
  for (const file of rootFiles) fs.writeFileSync(path.join(home, file), file.endsWith('.php') ? '<?php echo "not executed";' : 'synthetic');
  fs.copyFileSync(scriptSource, path.join(home, 'tools/cpanel-deploy-preflight.sh'));
  fs.mkdirSync(path.join(home, 'api/lib/magaza'), {recursive:true});
  fs.writeFileSync(path.join(home, 'api/lib/magaza/nested.php'), '<?php function synthetic_nested(): int { return 1; }');
  return home;
}
function clean(home) {
  assert.equal(path.dirname(home), path.resolve(os.tmpdir()));
  assert(path.basename(home).startsWith(prefix));
  fs.rmSync(home, {recursive:true, force:true});
}
function run(home, executable = php) {
  const result = spawnSync('/bin/sh', [path.join(home, 'tools/cpanel-deploy-preflight.sh'), '--php', executable], {cwd:home, encoding:'utf8', timeout:20000});
  assert.ifError(result.error);
  return result;
}
function contents(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map(name => {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    return [name, stat.isDirectory() ? contents(file) : {sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mode:stat.mode, mtime:stat.mtimeMs}];
  }));
}

test('cPanel preflight is the first deployment task, before any target mutation', () => {
  const source = fs.readFileSync(path.join(root, '.cpanel.yml'), 'utf8');
  const tasks = source.split(/\r?\n/).filter(line => /^\s*- /.test(line)).map(line => line.trim().slice(2));
  assert.equal(tasks[0], '/bin/sh tools/cpanel-deploy-preflight.sh --php /opt/alt/php83/usr/bin/php');
  assert(!tasks[0].includes(': '), 'The cPanel task must remain a YAML scalar.');
  assert(!source.includes('if command -v php'), 'PHP must not be optional.');
  assert(!fs.readFileSync(scriptSource).includes(13), 'The Linux shell source must retain LF endings.');
});

test('valid nested PHP passes without executing source or modifying the source tree', {skip:!linux}, () => {
  const home = fixture();
  try {
    const sentinel = path.join(home, 'must-not-exist');
    fs.writeFileSync(path.join(home, 'calisan/source.php'), `<?php file_put_contents(${JSON.stringify(sentinel)}, "executed");`);
    const before = contents(home);
    const result = run(home);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'cPanel preflight passed\n');
    assert.equal(result.stderr, '');
    assert(!fs.existsSync(sentinel));
    assert.deepEqual(contents(home), before);
  } finally { clean(home); }
});

test('missing PHP stops before a following target write', {skip:!linux}, () => {
  const home = fixture();
  try {
    const target = path.join(home, 'target-must-stay'); fs.writeFileSync(target, 'unchanged');
    const result = spawnSync('/bin/sh', ['-ec', 'sh tools/cpanel-deploy-preflight.sh --php /definitely/no/php; printf changed > "$1"', 'runner', target], {cwd:home, encoding:'utf8', timeout:20000});
    assert.ifError(result.error); assert.notEqual(result.status, 0);
    assert.match(result.stderr, /php_cli_unavailable/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
  } finally { clean(home); }
});

test('nested invalid PHP fails after a valid first file, so batched lint checks every file', {skip:!linux}, () => {
  const home = fixture();
  try {
    fs.writeFileSync(path.join(home, 'api/lib/magaza/nested.php'), '<?php function broken( {');
    const before = contents(home);
    const result = run(home);
    assert.equal(result.status, 1); assert.match(result.stderr, /php_syntax_check_failed/);
    assert(!result.stdout.includes('passed'));
    assert.deepEqual(contents(home), before);
  } finally { clean(home); }
});

test('a missing named publication source fails before any target mutation', {skip:!linux}, () => {
  const home = fixture();
  try {
    fs.rmSync(path.join(home, 'sitemap.xml'));
    let result = run(home); assert.equal(result.status, 1); assert.match(result.stderr, /required_file_missing/);
    fs.writeFileSync(path.join(home, 'sitemap.xml'), 'synthetic');
    fs.rmdirSync(path.join(home, 'araclar'));
    result = run(home); assert.equal(result.status, 1); assert.match(result.stderr, /required_directory_missing/);
  } finally { clean(home); }
});

test('source links cannot escape the checkout through either PHP or static assets', {skip:!linux}, () => {
  const home = fixture(), outside = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    fs.writeFileSync(path.join(outside, 'private.php'), '<?php echo "synthetic private";');
    fs.symlinkSync(path.join(outside, 'private.php'), path.join(home, 'public/leak.txt'));
    let result = run(home); assert.equal(result.status, 1); assert.match(result.stderr, /linked_source/);
    fs.unlinkSync(path.join(home, 'public/leak.txt'));
    fs.symlinkSync(outside, path.join(home, 'api/lib/escape'));
    result = run(home); assert.equal(result.status, 1); assert.match(result.stderr, /linked_source/);
    assert.equal(fs.readFileSync(path.join(outside, 'private.php'), 'utf8'), '<?php echo "synthetic private";');
  } finally { clean(home); clean(outside); }
});
