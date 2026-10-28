'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

test('Authenticated loopback HTTP bridge handles synthetic helper processes and security boundaries', { timeout: 90000 }, () => {
  const bundled = path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const candidates = process.env.PYTHON ? [process.env.PYTHON] : [fs.existsSync(bundled) ? bundled : null, 'python3', 'python'].filter(Boolean);
  let result;
  for (const python of candidates) {
    result = spawnSync(python, [path.join(__dirname, 'ubuntu-company-http-test.py')], { encoding: 'utf8', timeout: 80000, windowsHide: true });
    if (!result.error || result.error.code !== 'ENOENT') break;
  }
  assert.equal(result.status, 0, String(result.stdout || '') + String(result.stderr || '') + String(result.error || ''));
  assert.match(result.stderr, /Ran 14 tests/);
  assert.match(result.stderr, /\bOK\b/);
});
