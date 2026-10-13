/* Explicit operator test: writes synthetic records ONLY to the fixed Ubuntu QA database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.argv[2] !== '--run-isolated-ubuntu-qa') {
  throw new Error('Explicit --run-isolated-ubuntu-qa is required; this test is not part of the offline default suite.');
}
const root = path.resolve(__dirname, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-ubuntu-ssh-qa-'));
try {
  const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
  const result = spawnSync(php, ['-n', path.join(__dirname, 'company-ubuntu-ssh-fixture.php')], {
    env: { ...process.env, VG_DATA_DIR: temporary, VG_STORE: 'json', VG_STAFF_SITE_URL: 'http://127.0.0.1:4173', VG_RUN_ISOLATED_UBUNTU_QA: 'vg_bridge_qa_20261013_c6ea4f17' },
    encoding: 'utf8', windowsHide: true, timeout: 240000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr, '', 'Real SSH flow must not emit PHP warnings.');
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.database, 'vg_bridge_qa_20261013_c6ea4f17');
  assert.ok(report.checks >= 20, 'Real transport must exercise persistence, CAS, payroll and ownership.');
  assert.equal(fs.existsSync(path.join(temporary, 'company/state.json')), false, 'Real remote flow never creates local business state.');
  assert.deepEqual(fs.readdirSync(path.join(temporary, 'company')).filter(name => name.startsWith('ssh-')), [], 'Private SSH request/response files are cleaned.');
  console.log(`Ubuntu actual PHP/SSH transport: ${report.checks} checks passed against isolated synthetic QA database only.`);
} finally {
  const target = fs.realpathSync(temporary);
  assert.ok(path.relative(fs.realpathSync(os.tmpdir()), target).startsWith('voltguard-ubuntu-ssh-qa-'));
  fs.rmSync(target, { recursive: true, force: true });
}
