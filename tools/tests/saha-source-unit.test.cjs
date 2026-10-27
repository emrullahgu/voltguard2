const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

test('Saha Ubuntu source connector: identities, reviewed fields, private files and permissions', () => {
  const result = spawnSync(process.env.PYTHON || 'python', [path.join(__dirname, 'saha-source-unit.py')], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  assert.match(result.stderr, /Ran \d+ tests/);
});

test('PHP and Ubuntu source use identical reviewed Saha column declarations', () => {
  const php = fs.readFileSync(path.join(root, 'api/lib/sahatakip-schema.php'), 'utf8');
  const declaration = php.match(/<<<'SCHEMA'\r?\n([\s\S]*?)\r?\nSCHEMA/);
  assert.ok(declaration, 'reviewed server-side schema must be declared');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'tools/saha-source-schema.json'), 'utf8')), JSON.parse(declaration[1]));
});
