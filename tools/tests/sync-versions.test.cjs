'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const source = path.resolve(__dirname, '../sync-versions.py');
const python = ['python', 'python3', 'py'].find(command => spawnSync(command, ['--version']).status === 0);
const revision = value => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);

function fixture(t) {
  if (!python) { t.skip('python yok'); return null; }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-sync-versions-'));
  const root = path.join(temporary, 'site');
  const write = (relative, value) => {
    const destination = path.resolve(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, value);
  };
  write('tools/sync-versions.py', fs.readFileSync(source));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  return {
    write,
    read: relative => fs.readFileSync(path.join(root, relative), 'utf8'),
    run: (...args) => spawnSync(python, ['-B', path.join(root, 'tools/sync-versions.py'), ...args], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })
  };
}

test('version sync resolves parent paths from each page and check never writes', t => {
  const f = fixture(t);
  if (!f) return;
  const rootScript = 'window.scope = "root";\r\n';
  const nestedScript = 'window.scope = "hesap";\n';
  const style = 'body { color: red; }\r\n';
  f.write('js/app.js', rootScript);
  f.write('hesap/js/app.js', nestedScript);
  f.write('css/style.css', style);
  const original = [
    '<link href="../../css/style.css?v=old">',
    '<script src="../../js/app.js?v=old"></script>',
    '<script src="../js/app.js?v=old"></script>',
    '<script src="/js/app.js?v=old"></script>',
    '<script src="js/app.js?v=old"></script>',
    '<script src="https://example.test/js/app.js?v=external"></script>',
    '<script src="//example.test/js/app.js?v=external"></script>'
  ].join('\r\n');
  const skipped = '<script src="../js/app.js?v=private"></script>';
  f.write('hesap/inner/index.html', original);
  f.write('.qa/private.html', skipped);

  const check = f.run('--check');
  assert.equal(check.status, 1, check.stderr);
  assert.match(check.stdout, /5 eski surum referansi/);
  assert.equal(f.read('hesap/inner/index.html'), original);
  assert.equal(f.read('.qa/private.html'), skipped);

  const synced = f.run();
  assert.equal(synced.status, 0, synced.stderr);
  const expected = original
    .replace('../../css/style.css?v=old', '../../css/style.css?v=' + revision(style))
    .replace('../../js/app.js?v=old', '../../js/app.js?v=' + revision(rootScript))
    .replace('../js/app.js?v=old', '../js/app.js?v=' + revision(nestedScript))
    .replace('/js/app.js?v=old', '/js/app.js?v=' + revision(rootScript))
    .replace('"js/app.js?v=old', '"js/app.js?v=' + revision(rootScript));
  assert.equal(f.read('hesap/inner/index.html'), expected);
  assert.equal(f.read('.qa/private.html'), skipped);
  const clean = f.run('--check');
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /0 eski surum referansi/);
});

test('version sync leaves paths outside the repository and skipped roots unchanged', t => {
  const f = fixture(t);
  if (!f) return;
  f.write('../js/outside.js', 'outside fixture asset');
  f.write('.qa/private.js', 'private fixture asset');
  const original = '<script src="../js/outside.js?v=keep"></script>\n' +
    '<script src="js/../.qa/private.js?v=keep"></script>';
  f.write('index.html', original);
  const check = f.run('--check');
  assert.equal(check.status, 1, check.stderr);
  assert.match(check.stdout, /UYARI dosya yok: index\.html: \.\.\/js\/outside\.js/);
  assert.match(check.stdout, /UYARI dosya yok: index\.html: js\/\.\.\/\.qa\/private\.js/);
  assert.equal(f.read('index.html'), original);
  const synced = f.run();
  assert.equal(synced.status, 0, synced.stderr);
  assert.equal(f.read('index.html'), original);
});
