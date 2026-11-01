'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { testDependency } = require('./test-dependencies.cjs');
const helper = path.join(__dirname, 'test-dependencies.cjs');

function sandbox(action) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-test-dependency-'));
  try {
    const tests = path.join(directory, 'tools/tests');
    fs.mkdirSync(tests, { recursive: true });
    fs.copyFileSync(helper, path.join(tests, 'test-dependencies.cjs'));
    return action(directory);
  } finally {
    const resolved = path.resolve(directory);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert(path.basename(resolved).startsWith('voltguard-test-dependency-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
function writePackage(directory, relative, source) {
  const target = path.join(directory, relative, 'typescript');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'index.js'), source);
}
function execute(directory, source, nodePath) {
  const entry = path.join(directory, 'fixture.cjs');
  fs.writeFileSync(entry, source);
  return spawnSync(process.execPath, [entry], { cwd: directory, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, NODE_PATH: nodePath } });
}

test('Missing source-local compilers load from NODE_PATH and run real TSX and Babel transforms', () => sandbox(directory => {
  const expected = { typescript: testDependency('typescript').version, babel: testDependency('@babel/core').version };
  const localModules = path.resolve(__dirname, '../saha-app/node_modules');
  const nodePath = [localModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  const plugin = path.resolve(__dirname, '../saha-app/src/portal/scopedNetworkPlugin.cjs');
  const virtualScreen = path.resolve(__dirname, '../saha-app/src/screens/CompilerFixture.js');
  const source = `const {testDependency}=require('./tools/tests/test-dependencies.cjs');
    const fs=require('node:fs'),path=require('node:path');
    if(fs.existsSync(path.join(__dirname,'tools/saha-app/node_modules')))throw Error('Fixture must not have a source-local install');
    const ts=testDependency('typescript'),babel=testDependency('@babel/core');
    const output=ts.transpileModule('const value: number = 42; const label = <Text>{value}</Text>;',
      {fileName:'Fixture.tsx',compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
    const compiled=babel.transformSync('import { Text } from "react-native"; const label = Text;',
      {filename:${JSON.stringify(virtualScreen)},configFile:false,babelrc:false,plugins:[require(${JSON.stringify(plugin)})]}).code;
    console.log(JSON.stringify({typescript:ts.version,babel:babel.version,typedSyntaxRemoved:!output.includes(': number'),jsxCompiled:output.includes('createElement'),hostPluginApplied:compiled.includes('SiteText as Text')}));`;
  const result = execute(directory, source, nodePath);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.deepEqual(JSON.parse(result.stdout), { ...expected, typedSyntaxRemoved: true, jsxCompiled: true, hostPluginApplied: true });
}));

test('An installed workspace compiler takes precedence over a NODE_PATH package', () => sandbox(directory => {
  writePackage(directory, 'tools/saha-app/node_modules', 'module.exports={origin:"workspace"};');
  writePackage(directory, 'global_modules', 'module.exports={origin:"global"};');
  const result = execute(directory, 'console.log(require("./tools/tests/test-dependencies.cjs").testDependency("typescript").origin);', path.join(directory, 'global_modules'));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'workspace');
}));

test('An installed compiler with a missing internal dependency is not hidden by global fallback', () => sandbox(directory => {
  writePackage(directory, 'tools/saha-app/node_modules', 'module.exports=require("__voltguard_missing_compiler_internal__");');
  writePackage(directory, 'global_modules', 'module.exports={origin:"must-not-be-used"};');
  const result = execute(directory, 'require("./tools/tests/test-dependencies.cjs").testDependency("typescript");', path.join(directory, 'global_modules'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot find module '__voltguard_missing_compiler_internal__'/);
}));

test('Compiler initialization errors propagate instead of silently selecting another package', () => sandbox(directory => {
  writePackage(directory, 'tools/saha-app/node_modules', 'throw new Error("Synthetic compiler initialization failed");');
  writePackage(directory, 'global_modules', 'module.exports={origin:"must-not-be-used"};');
  const result = execute(directory, 'require("./tools/tests/test-dependencies.cjs").testDependency("typescript");', path.join(directory, 'global_modules'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Synthetic compiler initialization failed/);
}));

test('An existing but incomplete workspace package is a failure, not a missing-install fallback', () => sandbox(directory => {
  fs.mkdirSync(path.join(directory, 'tools/saha-app/node_modules/typescript'), { recursive: true });
  writePackage(directory, 'global_modules', 'module.exports={origin:"must-not-be-used"};');
  const result = execute(directory, 'require("./tools/tests/test-dependencies.cjs").testDependency("typescript");', path.join(directory, 'global_modules'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot find module/);
}));
