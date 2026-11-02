'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {spawnSync} = require('node:child_process');
const {runSteps, preflight, BuildFailure, steps} = require('../build-all.cjs');
const project = path.resolve(__dirname, '../..');
function sandbox(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard build flow '));
  try {return run(dir);} finally {
    const actual = fs.realpathSync(dir), base = fs.realpathSync(os.tmpdir());
    assert(actual.startsWith(base + path.sep) && path.basename(actual).startsWith('voltguard build flow '));
    fs.rmSync(actual, {recursive: true, force: true});
  }
}
test('Sequential build uses real argument boundaries, project cwd and dependency order without a shell', () => sandbox(dir => {
  const trace = path.join(dir, 'trace.jsonl'), script = path.join(dir, 'child with spaces.cjs');
  fs.writeFileSync(script, 'require("node:fs").appendFileSync(' + JSON.stringify(trace) + ',JSON.stringify({cwd:process.cwd(),arg:process.argv[2]})+"\\n");');
  const logs = [], names = ['first value & literal', 'second value'];
  runSteps(names.map(name => ({name, runtime: 'node', script: path.basename(script), args: [name]})), {directory: dir, log: line => logs.push(line)});
  const rows = fs.readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => row.arg), names);
  assert(rows.every(row => row.cwd === dir));
  assert.match(logs.at(-1), /Derleme tamamlandı: 2 adım/);
}));
test('A real failing child preserves its exit status and prevents all later publication writers', () => sandbox(dir => {
  const trace = path.join(dir, 'trace');
  fs.writeFileSync(path.join(dir, 'fail.cjs'), 'require("node:fs").writeFileSync(' + JSON.stringify(trace) + ',"failed");process.exit(23);');
  fs.writeFileSync(path.join(dir, 'later.cjs'), 'require("node:fs").appendFileSync(' + JSON.stringify(trace) + ',"incorrectly continued");');
  const logs = [];
  assert.throws(() => runSteps([{name: 'Failed renderer', runtime: 'node', script: 'fail.cjs'}, {name: 'Publication', runtime: 'node', script: 'later.cjs'}], {directory: dir, log: line => logs.push(line)}), error => error instanceof BuildFailure && error.status === 23 && /Failed renderer/.test(error.message));
  assert.equal(fs.readFileSync(trace, 'utf8'), 'failed');
  assert(!logs.some(line => line.startsWith('Derleme tamamlandı')));
}));
test('Spawn errors and interrupted children never count as successful steps', () => {
  for (const result of [{error: Object.assign(new Error('Missing'), {code: 'ENOENT'}), status: null}, {status: null, signal: 'SIGTERM'}]) {
    let calls = 0; const logs = [];
    assert.throws(() => runSteps([{name: 'First', runtime: 'node', script: 'first'}, {name: 'Later', runtime: 'node', script: 'later'}], {runner: () => {calls++; return result;}, log: line => logs.push(line)}), BuildFailure);
    assert.equal(calls, 1); assert.equal(logs.filter(line => line.startsWith('Tamamlandı:')).length, 0);
  }
});
test('Python or dependency preflight fails before starting any builder', () => sandbox(dir => {
  let calls = 0;
  assert.throws(() => preflight({directory: dir, runner: () => {calls++; return {error: new Error('Missing'), status: null};}, log: () => {}}), /Python 3 çalıştırılamadı/);
  assert.equal(calls, 1);
  for (const step of steps) {const file = path.join(dir, step.script); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, '');}
  assert.throws(() => preflight({directory: dir, runner: () => ({status: 0, stdout: 'Python 3.11.9\n'}), log: () => {}}), /npm run setup:game/);
}));
test('Inspection flags do not depend on Python, install packages or run the production build', () => {
  const cli = path.join(project, 'tools/build-all.cjs');
  const env = {...process.env, VG_PYTHON: path.join(os.tmpdir(), 'unavailable-python')};
  const listed = spawnSync(process.execPath, [cli, '--list'], {cwd: os.tmpdir(), env, encoding: 'utf8', windowsHide: true, timeout: 5000});
  assert.equal(listed.status, 0); assert.match(listed.stdout, /10\. İçerik sürümleri/);
  const rejected = spawnSync(process.execPath, [cli, '--unknown'], {env, encoding: 'utf8', windowsHide: true, timeout: 5000});
  assert.equal(rejected.status, 2); assert.match(rejected.stderr, /Kullanım:/);
});
