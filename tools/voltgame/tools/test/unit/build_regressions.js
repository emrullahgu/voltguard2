'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { minify } = require('../../minjs');
const ROOT = path.resolve(__dirname, '../../..');
const cases = [
  "if(true) PX.result=/a  b/.test('a  b');",
  "if(true) /a  b/.test('a  b') && (PX.result=true);",
  "PX.result = 12 / /b/.test('b');",
  "function f(){return\n{x:1}} PX.result=[f(),1];",
  "PX.result=`a  b ${`c  d ${2+3}`} e`;",
  "let x=5;function f(a=x){let x=8;return a} PX.result=f();",
  "const device={label:'Ana kesici',live:true}; const {label}=device; PX.result={label,live:device.live};",
  "let a=1,b=2;PX.result=a + ++b;",
  "let a=3,b=2;PX.result=a - --b;",
  "PX.result='https://example.com/a/*literal*/';",
  "let i=1; /* comment\n */ ++i; PX.result=i;",
  "PX.result=/[\\/ ]{2}/.test('//');",
];
const evaluate = src => vm.runInNewContext('const PX={};\n' + src + '\nJSON.stringify(PX.result)');
for (const src of cases) for (const local of [false, true]) {
  const result = minify(src, 'regression', { local });
  assert.equal(result.ok, true, result.why);
  assert.equal(evaluate(result.src), evaluate(src), src);
}
assert.equal(minify('const = !').ok, false, 'invalid source is never reported as successfully minified');
const marker = minify('//#KEEP\nPX.result=1;').src;
assert(marker.includes('//#KEEP'), 'worker/build markers survive');

// Force a failed budget read in a child process without modifying shared source.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-build-regression-'));
try {
  const out = path.join(dir, 'release.html'), sentinel = 'existing working release';
  fs.writeFileSync(out, sentinel);
  const child = `const fs=require('fs');const read=fs.readFileSync;fs.readFileSync=function(p,...args){const v=read.call(fs,p,...args);if(String(p).endsWith('manifest.json')){const m=JSON.parse(String(v));m.budget={jsKB:0,levelKB:0};return JSON.stringify(m)}return v};process.argv=['node','build','--no-verify','--out',${JSON.stringify(out)}];require(${JSON.stringify(path.join(ROOT,'tools/build.js'))});`;
  const result = spawnSync(process.execPath, ['-e', child], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert(result.stderr.includes('boyut bütçesi'), result.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), sentinel, 'failed builds preserve the existing release');
  assert.deepEqual(fs.readdirSync(dir), ['release.html'], 'failed builds leave no temporary output');
} finally {
  const target = path.resolve(dir);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert(path.basename(target).startsWith('px-build-regression-'));
  fs.rmSync(target, { recursive: true, force: true });
}
console.log('build regressions: 30 checks passed');
