'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const assetRoot = 'calisan/uygulama/assets/saha/';
const fonts = assetRoot + 'assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/';

test('Published Expo icon-font references exist and Git includes only the generated TTF assets', () => {
  const scripts = path.join(root, assetRoot, '_expo/static/js/web');
  const references = new Set();
  for (const name of fs.readdirSync(scripts).filter(name => name.endsWith('.js'))) {
    const bundle = fs.readFileSync(path.join(scripts, name), 'utf8');
    for (const match of bundle.matchAll(/["'](\/calisan\/uygulama\/assets\/saha\/assets\/node_modules\/[^"'<>]+\.ttf)["']/g)) {
      references.add(match[1].slice(1));
    }
  }
  assert.ok(references.size > 0, 'The built employee application must declare its icon fonts.');
  for (const file of references) {
    assert.equal(path.posix.dirname(file) + '/', fonts, 'Generated icon fonts must stay inside the reviewed asset directory.');
    assert.equal(fs.statSync(path.join(root, file)).isFile(), true, 'Each icon font referenced by the built bundle must be packaged.');
  }

  const denied = [
    'node_modules/react/index.js',
    'tools/staff-app/node_modules/react/index.js',
    'tools/saha-app/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf',
    assetRoot + 'assets/node_modules/other-package/hidden.ttf',
    assetRoot + 'assets/node_modules/@expo/vector-icons/package.json',
    assetRoot + 'assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',
    fonts + 'source.js',
    fonts + 'source.woff2',
    fonts + 'nested/hidden.ttf',
  ];
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-saha-font-git-'));
  try {
    fs.copyFileSync(path.join(root, '.gitignore'), path.join(temporary, '.gitignore'));
    for (const file of [...references, ...denied]) {
      const target = path.join(temporary, file);
      fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, 'synthetic font-policy fixture');
    }
    const initialize = spawnSync('git', ['init', '--quiet', temporary], {encoding: 'utf8', windowsHide: true});
    assert.equal(initialize.status, 0, initialize.stderr || initialize.error?.message);
    const checked = spawnSync('git', ['-C', temporary, '-c', `core.excludesFile=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
      'check-ignore', '--no-index', '--stdin'], {input: [...references, ...denied].join('\n') + '\n', encoding: 'utf8', windowsHide: true});
    assert.equal(checked.status, 0, checked.stderr || checked.error?.message);
    const ignored = new Set(checked.stdout.trim().split(/\r?\n/));
    for (const file of references) assert.equal(ignored.has(file), false, 'A generated TTF must survive Git-based deployment.');
    for (const file of denied) assert.equal(ignored.has(file), true, 'Real dependencies and unreviewed generated files must stay ignored.');
  } finally {
    const target = fs.realpathSync(temporary), base = fs.realpathSync(os.tmpdir());
    assert.ok(path.relative(base, target).startsWith('voltguard-saha-font-git-'));
    fs.rmSync(target, {recursive: true, force: true});
  }
});
