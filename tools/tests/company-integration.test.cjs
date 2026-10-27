/* Closing checks for the published private application. No real staff or catalogue data is read. */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const published = path.join(root, 'calisan/uygulama');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const file = path.join(directory, item.name);
    assert.equal(item.isSymbolicLink(), false, 'Published application must not contain linked files.');
    return item.isDirectory() ? files(file) : [file];
  });
}
const assetFiles = () => files(path.join(published, 'assets'));
const staffAssetFiles = () => assetFiles().filter(file => !path.relative(path.join(published, 'assets'), file).startsWith('saha' + path.sep));

test('Published entry is PHP-only and refers to existing, current private build assets', () => {
  assert.equal(fs.existsSync(path.join(published, 'index.php')), true);
  for (const name of ['index.html', '.vite/manifest.json', 'catalog.json', 'state.json']) {
    assert.equal(fs.existsSync(path.join(published, name)), false, `${name} must not be published.`);
  }
  const tags = read('calisan/uygulama/entry-tags.html');
  const references = [...tags.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.equal(references.length, 2, 'Only the module entry and its stylesheet belong in entry tags.');
  assert.match(tags, /<script type="module"/);
  assert.match(tags, /<link rel="stylesheet"/);
  for (const reference of references) {
    assert.match(reference, /^\/calisan\/uygulama\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/);
    assert.equal(fs.existsSync(path.join(root, reference.slice(1))), true, 'Emitted asset reference resolves.');
  }
  const distAssets = path.join(root, 'tools/staff-app/dist/assets');
  if (fs.existsSync(distAssets)) {
    const names = directory => files(directory).map(file => path.relative(directory, file)).sort();
    assert.deepEqual(names(path.join(published, 'assets')).filter(name => !name.startsWith('saha' + path.sep)), names(distAssets), 'Stale generated staff bundles are pruned.');
    for (const asset of staffAssetFiles()) {
      const emitted = path.join(distAssets, path.relative(path.join(published, 'assets'), asset));
      assert.equal(fs.readFileSync(asset).equals(fs.readFileSync(emitted)), true, 'Published bytes match the final build.');
    }
  }
});

test('Compiled application carries no original cloud credentials, invoice files or source maps', () => {
  const forbidden = [
    ['old Supabase endpoint', /https?:\/\/[^\s"'<>]{4,}\.supabase\.co/i],
    ['old Firebase service', /https?:\/\/[^\s"'<>]*(?:firebaseio\.com|firebasedatabase\.app)/i],
    ['private key or privileged cloud key', /BEGIN PRIVATE KEY|SUPABASE_SERVICE_ROLE|SUPABASE_ANON_KEY|VITE_SUPABASE|sb_secret_|\bservice_role\b/],
    ['embedded signed token', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
    ['original price/invoice import', /Fatura2?\.json|serer-kablo-fiyat\.json|hazir-paketler\.json/],
    ['external AI endpoint', /api\.openai\.com|generativelanguage\.googleapis\.com/]
  ];
  for (const file of assetFiles()) {
    assert.equal(/\.(?:map|json|env|sql)$/.test(file), false, 'Only compiled code and styles are published in assets.');
    if (!/\.(?:js|css)$/.test(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const [label, pattern] of forbidden) assert.equal(pattern.test(content), false, `${path.basename(file)} contains ${label}.`);
    assert.equal(/sourceMappingURL=/.test(content), false, 'Application source maps are not linked.');
  }
  const all = files(published);
  for (const file of all.filter(file => /\.(?:json|map)$/.test(file))) {
    if(path.relative(published,file)==='employee-modules-manifest.json') {
      const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
      assert.deepEqual(Object.keys(manifest).sort(),['scripts','styles','version']);assert.equal(manifest.version,1);
      assert.ok(Array.isArray(manifest.scripts)&&manifest.scripts.length>0&&manifest.scripts.length<=8);assert.ok(Array.isArray(manifest.styles)&&manifest.styles.length<=8);
      for(const [kind,extension] of [['scripts','m?js'],['styles','css']])for(const url of manifest[kind]){
        assert.match(url,new RegExp('^/calisan/uygulama/assets/saha/[A-Za-z0-9/_., @()+-]+\\.'+extension+'$'));assert.equal(url.includes('..'),false);
        assert.equal(fs.statSync(path.join(root,url.slice(1))).isFile(),true,'Only existing compiled runtime assets belong to the private manifest');
      }
      assert.equal(privateRewrite('/calisan/uygulama/employee-modules-manifest.json')?.flags.split(',').includes('F'),true,'The runtime manifest has no raw public URL');
      continue;
    }
    assert.equal(path.relative(published, file).startsWith('licenses' + path.sep), true, 'Any package metadata belongs only to inert licence material.');
  }
});

test('PHP HTML gate and every asset response require a verified staff identity', () => {
  const page = read('calisan/uygulama/index.php');
  const firstMarkup = page.indexOf('<!doctype html>');
  assert.equal(firstMarkup > page.indexOf('vg_staff_require_user()'), true, 'Staff authorization precedes HTML output.');
  assert.match(page.slice(0, firstMarkup), /Cache-Control: no-store, private, max-age=0/);
  assert.match(page, /Location: \/calisan\/giris\.html/);
  const asset = read('api/company-asset.php');
  assert.equal(asset.indexOf('vg_staff_require_user()') < asset.indexOf('realpath('), true, 'Authorize before looking up an asset.');
  assert.match(asset, /vg_check_fetch_site\(\)/);
  assert.match(asset, /vg_common_headers\(200/);
  assert.match(asset, /session_write_close\(\)/);
  assert.match(read('api/lib/bootstrap.php'), /Cache-Control: no-store, no-cache, must-revalidate, max-age=0, private/);
  assert.match(read('api/lib/staff.php'), /function vg_staff_require_user\(/);
});

function privateRewrite(requestPath) {
  const pathname = new URL(requestPath, 'https://fixture.invalid').pathname.slice(1);
  const rules = [...read('.htaccess').matchAll(/^\s*RewriteRule\s+(\S+)\s+(\S+)(?:\s+\[([^\]]+)\])?\s*$/gm)];
  for (const [, pattern, target, flags = ''] of rules) {
    // Only unconditional deny rules and the dedicated private route block are evaluated here.
    if (!flags.split(',').includes('F') && !pattern.startsWith('^calisan')) continue;
    const expression = new RegExp(pattern, flags.split(',').includes('NC') ? 'i' : '');
    const match = pathname.match(expression);
    if (!match) continue;
    return { target: target.replace(/\$(\d+)/g, (_, number) => match[Number(number)] || ''), flags };
  }
  return null;
}

test('Apache routes assets through the gate and caller query cannot override the asset name', () => {
  for (const name of ['assets/test.js', 'fonts/NotoSans-Regular.ttf', 'licenses/index.html', 'fatura_logo.png']) {
    for (const suffix of ['', '?file=assets/other.js&v=unexpected']) {
      const result = privateRewrite('/calisan/uygulama/' + name + suffix);
      assert.equal(result?.target, '/api/company-asset.php?file=' + name);
      assert.equal(result.flags.split(',').includes('QSA'), false, 'Caller query must not be appended.');
    }
  }
  assert.equal(privateRewrite('/calisan/uygulama/')?.target, '/calisan/uygulama/index.php');
  const canonical = privateRewrite('/calisan/uygulama');
  assert.equal(canonical?.target, '/calisan/uygulama/');
  assert.match(canonical.flags, /R=301/);
  for (const pathname of ['/calisan/uygulama/index.html', '/calisan/uygulama/entry-tags.html', '/calisan/uygulama/.vite/manifest.json',
    '/tools/staff-app/src/portal-main.jsx', '/voltguardekleyelim/Teklif-Voltguard-main/src/main.jsx',
    '/calisan.new/uygulama/assets/test.js', '/CALISAN.NEW/uygulama/assets/test.js', '/api.new/lib/company.php']) {
    assert.equal(privateRewrite(pathname)?.flags.split(',').includes('F'), true, `${pathname} is denied.`);
  }
});

test('Private deployment stages outside docroot and installs denial rules first', () => {
  const tasks = read('.cpanel.yml').split(/\r?\n/).filter(line => /^\s*- /.test(line)).map(line => line.trim().slice(2));
  const deployment = tasks.find(line => line.startsWith('export DEPLOYPATH=')).split('=')[1];
  const staging = tasks.find(line => line.startsWith('export VG_STAGEPATH=')).split('=')[1];
  const relation = path.posix.relative(deployment, staging);
  assert.equal(relation.startsWith('../'), true, 'Private staging stays outside the public tree.');
  const protections = tasks.indexOf('/bin/cp .htaccess $DEPLOYPATH');
  assert.equal(protections >= 0, true);
  for (const directory of ['api', 'calisan']) {
    const copy = tasks.indexOf(`/bin/cp -R ${directory} $VG_STAGEPATH/${directory}.new`);
    assert.equal(copy > protections, true, 'Private URL protection is already active before staging is published.');
    assert.equal(tasks.includes(`/bin/mv $VG_STAGEPATH/${directory}.new $DEPLOYPATH/${directory}`), true);
    assert.equal(tasks.some(line => new RegExp(`\\$DEPLOYPATH/${directory}\\.new`).test(line)), false, 'Private staging is never a public URL.');
  }
  assert.equal(tasks.some(line => /^\/bin\/cp.*(?:tools\/staff-app|voltguardekleyelim|catalog\.json|state\.json)/.test(line)), false);
});

test('Apache missing-rewrite fallback closes the private directory and is preserved in deployment', () => {
  const guard = read('calisan/uygulama/.htaccess').replace(/^\s*#.*$/gm, '').trim();
  assert.match(guard, /^<IfModule !mod_rewrite\.c>\s+Require all denied\s+<\/IfModule>$/);
  // The only deny directive belongs to the negative module branch. With rewrite enabled,
  // the normal parent rewrite can still route assets to the authenticated PHP handler.
  const enabledBranch = guard.replace(/<IfModule !mod_rewrite\.c>[\s\S]*?<\/IfModule>/, '').trim();
  assert.equal(enabledBranch, '');
  const build = read('tools/build-company.cjs');
  assert.match(build, /item\.name\.startsWith\('\.'\)/, 'Generated output does not overwrite the hand-written guard.');
  assert.match(build, /for\(const folder of \['assets','fonts','licenses'\]\)pruneGenerated/, 'Pruning is limited to generated trees.');
  assert.match(read('.cpanel.yml'), /\/bin\/cp -R calisan \$VG_STAGEPATH\/calisan\.new/, 'Copying the directory includes its access-control dotfile.');
});

test('Static Netlify hosting denies the entire private application before any fallbacks', () => {
  const redirects = read('netlify.toml').split('[[redirects]]').slice(1).map(block => ({
    from: block.match(/^\s*from\s*=\s*"([^"]+)"/m)?.[1],
    to: block.match(/^\s*to\s*=\s*"([^"]+)"/m)?.[1],
    status: Number(block.match(/^\s*status\s*=\s*(\d+)/m)?.[1]),
    force: /^\s*force\s*=\s*true\s*$/m.test(block)
  }));
  function firstMatching(url) {
    return redirects.find(rule => rule.from && new RegExp('^' + rule.from.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(url));
  }
  for (const url of ['/calisan/uygulama', '/calisan/uygulama/', '/calisan/uygulama/index.php', '/calisan/uygulama/assets/test.js',
    '/calisan/uygulama/fonts/NotoSans-Regular.ttf', '/calisan/uygulama/licenses/index.html', '/api/company.php', '/tools/staff-app/src/main.jsx']) {
    const rule = firstMatching(url);
    assert.equal(rule?.status, 404, `${url} cannot be served by a static host.`);
    assert.equal(rule?.force, true);
  }
});

test('Actual service worker bypasses private assets and never restores private HTML from cache', () => {
  const handlers = {};
  const context = vm.createContext({ URL, Request, Response, Headers, setTimeout, clearTimeout,
    self: { location: { origin: 'https://fixture.invalid' }, addEventListener(name, handler) { handlers[name] = handler; } } });
  vm.runInContext(read('sw.js'), context, { timeout: 1000 });
  for (const pathname of ['/calisan/uygulama/', '/calisan/uygulama/assets/test.js', '/calisan/uygulama/fonts/NotoSans-Regular.ttf',
    '/calisan/uygulama/licenses/index.html', '/calisan/uygulama/fatura_logo.png', '/api/company.php?action=bootstrap']) {
    const request = new Request('https://fixture.invalid' + pathname);
    assert.equal(context.isNeverCached(new URL(request.url), request), true);
    let intercepted = false;
    handlers.fetch({ request, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, 'Private request is handled directly by the authenticated server.');
  }
  for (const pathname of ['/calisan/', '/calisan/uygulama', '/CALISAN/UYGULAMA/', '/hesap/giris.html']) {
    assert.equal(context.isPrivatePage(new URL('https://fixture.invalid' + pathname)), true);
  }
  const response = { status: 200, type: 'basic', redirected: false, headers: new Headers({ 'Cache-Control': 'private, no-store' }) };
  assert.equal(context.storableBasic(response), false, 'No-store company response cannot enter a SW cache.');
});

test('Private application uses the shared site shell and scoped styles', () => {
  for (const name of ['header', 'footer']) {
    assert.equal(read('calisan/shared-' + name + '.html'), read('tools/shell/' + name + '.html'));
  }
  const links = [...read('calisan/shared-header.html').matchAll(/<a\b[^>]*class="vg-nav__link"[^>]*href="([^"]+)"[^>]*>([^<]*)/g)];
  assert.equal(links[0]?.[1], '/');
  assert.equal(links[0]?.[2].trim(), 'Ana Sayfa');
  assert.match(read('calisan/uygulama/index.php'), /id="vg-company-workspace"/);
  const styles = staffAssetFiles().filter(file => file.endsWith('.css'));
  assert.equal(styles.length, 1);
  const css = fs.readFileSync(styles[0], 'utf8');
  assert.equal(css.includes('#vg-company-workspace'), true);
  assert.equal(css.includes('#vg-tool-workspace'), false);
  assert.doesNotMatch(css,/#vg-company-workspace[^,{]*\s+#vg-company-workspace/,'Scoped theme rules must not require a workspace nested inside itself');
  assert.equal(/@import\s/.test(css), false, 'Final application has no late or external stylesheet import.');
  const employeeLinks=[...read('calisan/index.php').matchAll(/href="([^"<>]+)"/g)].map(match=>new URL(match[1],'https://fixture.invalid'));
  assert.ok(employeeLinks.some(url=>url.pathname==='/calisan/uygulama/'&&url.searchParams.get('module')==='uygulamalar'),'Employee panel opens the unified application grid');
});
