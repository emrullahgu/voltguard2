const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('Ubuntu private repository: ownership, role, CAS token, site and data boundaries', () => {
  const result = spawnSync(process.env.PYTHON || 'python', [path.join(__dirname, 'ubuntu-company-bridge-unit.py')], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  assert.match(result.stderr, /Ran 16 tests/);
});
