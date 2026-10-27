'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { packageExport, ASSET_BASE } = require('../build-saha.cjs');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-saha-package-'));
  const dist = path.join(directory, 'tools', 'saha-app', 'dist');
  function write(relative, text) {
    const file = path.join(dist, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  }
  write('index.html', '<!doctype html><html><head><title>Employee modules</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="' + ASSET_BASE + 'application.css"><style>html,body,#root{height:100%}</style></head><body><div id="root"></div><script>window.__SYNTHETIC_BOOT=true;</script><script defer src="' + ASSET_BASE + '_expo/static/js/web/index-test.js"></script></body></html>');
  write('_expo/static/js/web/index-test.js', 'document.getElementById("root").textContent="Synthetic employee application";');
  write('assets/node_modules/@expo/vector-icons/font-test.ttf', 'synthetic-font');
  write('favicon.ico', 'synthetic-icon');
  write('application.css', 'div{box-sizing:border-box}');
  write('metadata.json', '{}');
  write('_expo/static/js/web/index-test.js.map', '{}');
  return { directory, dist, write };
}
function removeFixture(directory) {
  const expected = fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(fs.realpathSync(directory)), expected);
  assert.match(path.basename(directory), /^vg-saha-package-/);
  fs.rmSync(directory, { recursive: true });
}

test('Employee module export publishes a private runtime manifest and excludes raw HTML/source metadata', () => {
  const f = fixture();
  try {
    const output = packageExport(f.directory, f.dist);
    assert.equal(output.files, 5);
    const html = fs.readFileSync(output.entry, 'utf8');
    assert.match(html, /<base href="\/calisan\/uygulama\/assets\/saha\/">/);
    assert.match(html, /noindex,nofollow,noarchive/);
    assert.doesNotMatch(html, /<script[^>]*>\s*window\./);
    assert.match(html, /bootstrap-[a-f0-9]{16}\.js/);
    const manifest = JSON.parse(fs.readFileSync(output.manifestFile, 'utf8'));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.scripts.length, 2);
    assert.deepEqual(manifest.styles, [ASSET_BASE + 'application.css']);
    for (const url of [...manifest.scripts, ...manifest.styles]) {
      assert.ok(url.startsWith(ASSET_BASE));
      assert.equal(fs.statSync(path.join(output.target, url.slice(ASSET_BASE.length))).isFile(), true);
    }
    assert.equal(fs.existsSync(path.join(output.target, 'index.html')), false);
    assert.equal(fs.existsSync(path.join(output.target, 'metadata.json')), false);
    assert.equal(fs.existsSync(path.join(output.target, '_expo/static/js/web/index-test.js.map')), false);
    assert.equal(fs.existsSync(path.join(output.target, 'assets/node_modules/@expo/vector-icons/font-test.ttf')), true);
    f.write('_expo/static/js/web/second.js', 'window.second=true;');
    packageExport(f.directory, f.dist);
    assert.equal(fs.existsSync(path.join(output.target, '_expo/static/js/web/second.js')), true);
  } finally { removeFixture(f.directory); }
});

test('A rejected Saha export preserves the last valid release', () => {
  const f = fixture();
  try {
    const output = packageExport(f.directory, f.dist);
    const before = fs.readFileSync(output.entry);
    const beforeManifest = fs.readFileSync(output.manifestFile);
    f.write('private.env', 'SYNTHETIC_SECRET=must-not-publish');
    assert.throws(() => packageExport(f.directory, f.dist), /Unexpected Saha export asset/);
    assert.equal(fs.readFileSync(output.entry).equals(before), true);
    assert.equal(fs.readFileSync(output.manifestFile).equals(beforeManifest), true);
    assert.equal(fs.existsSync(path.join(output.target, 'private.env')), false);
    fs.unlinkSync(path.join(f.dist, 'private.env'));
    f.write('_expo/static/js/web/index-test.js', 'fetch("http://192.0.2.44:8000/rest/v1/private_table");');
    assert.throws(() => packageExport(f.directory, f.dist), /old cloud endpoint/);
    assert.equal(fs.readFileSync(output.entry).equals(before), true);
    assert.equal(fs.readFileSync(output.manifestFile).equals(beforeManifest), true);
    f.write('_expo/static/js/web/index-test.js', 'window.__SYNTHETIC_PRIVATE_SAHA=true;');
    f.write('index.html', '<!doctype html><html><head></head><body><script src="https://external.invalid/app.js"></script></body></html>');
    assert.throws(() => packageExport(f.directory, f.dist), /external asset/);
    assert.equal(fs.readFileSync(output.entry).equals(before), true);
    assert.equal(fs.readFileSync(output.manifestFile).equals(beforeManifest), true);
  } finally { removeFixture(f.directory); }
});

test('Retired project entry redirects to the authenticated employee portal; runtime discovery remains gated', () => {
  const page = read('calisan/uygulama/saha.php');
  assert.match(page, /vg_staff_require_user\(\)/);
  assert.match(page, /vg_check_fetch_site\(\)/);
  assert.match(page, /Cache-Control: no-store, private, max-age=0/);
  assert.match(page, /Location: \/calisan\/uygulama\//);
  assert.doesNotMatch(page, /readfile\(|saha-entry\.html|<iframe\b/);
  assert.match(page, /session_write_close\(\)/);
  const apache = read('.htaccess');
  assert.match(apache, /saha-entry\\\.html/);
  assert.match(apache, /RewriteRule \^calisan\/uygulama\/\(assets\|fonts\|licenses\)\/\(\.\*\)\$ \/api\/company-asset\.php\?file=\$1\/\$2 \[L\]/);
  assert.match(read('api/company-asset.php'), /vg_staff_require_user\(\)/);
  const api = read('api/lib/company.php');
  assert.ok(api.indexOf('vg_staff_require_user(); $action') < api.indexOf("$action === 'module_assets'"));
  assert.match(api, /employee-modules-manifest\.json/);
  assert.match(api, /is_link\(\$file\)/);
  assert.match(apache, /employee-modules-manifest/);
  assert.match(read('tools/preview-router.php'), /'\/calisan\/uygulama\/saha\.php' => '\/calisan\/uygulama\/saha\.php'/);
  assert.match(read('tools/preview.cjs'), /'\/calisan\/uygulama\/saha\.php'/);
});

test('Original Saha source is denied on Apache, preview and the static host', () => {
  assert.match(read('.htaccess'), /RewriteRule \^\([^\n]*SahaTakip-main[^\n]*\[F,L,NC\]/);
  assert.match(read('.htaccess'), /RedirectMatch 403[^\n]*SahaTakip-main/);
  assert.match(read('tools/preview.cjs'), /\(tools\|[^\n]*SahaTakip-main/);
  assert.match(read('tools/build-netlify.cjs'), /'SahaTakip-main'/);
  assert.match(read('tools/shell.py'), /'SahaTakip-main'/);
  assert.match(read('tools/shell.py'), /== 'calisan\/uygulama'/);
  assert.match(read('tools/sync-versions.py'), /'SahaTakip-main'/);
  assert.match(read('netlify.toml'), /from = "\/SahaTakip-main\/\*"\s+to = "\/404\.html"\s+status = 404\s+force = true/);
  assert.equal(read('.cpanel.yml').split(/\r?\n/).some(line => /^\s*- \/bin\/cp/.test(line) && /SahaTakip-main|tools\/saha-app/.test(line)), false);
  const build = read('tools/build-company.cjs');
  assert.equal(build.lastIndexOf("require('./build-saha.cjs').build(root)") > build.lastIndexOf('pruneGenerated(path.join(target,folder))'), true);
  assert.match(build, /if\(relative==='assets'&&item\.name==='saha'\)continue/);
});
