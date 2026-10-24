'use strict';
/* Static guards for the account / employee hardening: strict CSP needs script files, not inline code. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hesapPages = fs.readdirSync(path.join(root, 'hesap')).filter(name => name.endsWith('.html'));
const privatePages = hesapPages.map(name => 'hesap/' + name).concat(['calisan/giris.html', 'calisan/etkinlestir.html', 'calisan/index.php']);

test('Account and employee pages run no inline script (strict CSP compatible)', () => {
  for (const file of privatePages) {
    const html = read(file);
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = match[1];
      if (/\bsrc\s*=/.test(attrs)) continue;
      assert.match(attrs, /type\s*=\s*"(speculationrules|application\/ld\+json)"/, `${file} contains an executable inline <script>`);
    }
    assert.doesNotMatch(html, /<[^>]+\son[a-z]+\s*=/i, `${file} uses an inline event handler attribute`);
    assert.doesNotMatch(html, /href\s*=\s*"javascript:/i, `${file} uses a javascript: URL`);
  }
  for (const name of hesapPages) {
    const script = 'js/hesap-' + name.replace(/\.html$/, '') + '.js';
    assert.ok(fs.existsSync(path.join(root, script)), `${script} exists`);
    assert.match(read('hesap/' + name), new RegExp('src="\\.\\./' + script.replace(/[.-]/g, '\\$&') + '\\?v='), `hesap/${name} loads ${script}`);
  }
});

test('Credential forms never fall back to GET', () => {
  for (const file of privatePages.filter(file => file.endsWith('.html'))) {
    for (const form of read(file).matchAll(/<form\b[^>]*>/gi)) {
      assert.match(form[0], /method="post"/i, `${file}: ${form[0]}`);
    }
  }
  assert.match(read('topluluk.html'), /<form id="community-form" method="post"/);
});

test('.htaccess applies path-specific CSP; private areas allow no inline script or eval', () => {
  const htaccess = read('.htaccess');
  const policies = Object.fromEntries([...htaccess.matchAll(/Header always set Content-Security-Policy "([^"]+)" env=VG_CSP_([A-Z]+)/g)].map(m => [m[2], m[1]]));
  assert.deepEqual(Object.keys(policies).sort(), ['API', 'APP', 'PRIVATE', 'SITE']);
  // Tools that read "the" site policy take the first occurrence: it must stay the general one.
  assert.equal(htaccess.match(/Header always set Content-Security-Policy\s+"([^"]+)"/)[1], policies.SITE);
  assert.doesNotMatch(policies.PRIVATE, /unsafe-inline'[^;]*;?\s*style|script-src[^;]*unsafe/);
  assert.match(policies.PRIVATE, /script-src 'self' 'inline-speculation-rules';/);
  assert.match(policies.PRIVATE, /frame-ancestors 'none'/);
  assert.doesNotMatch(policies.APP, /script-src[^;]*unsafe-inline/);
  assert.match(policies.API, /^default-src 'none'/);
  assert.match(htaccess, /SetEnvIfNoCase Request_URI "\^\/\(hesap\|calisan\)\(\/\|\$\)" VG_CSP_PRIVATE=1 !VG_CSP_SITE/);
  assert.match(htaccess, /<IfModule !mod_setenvif\.c>[\s\S]*Content-Security-Policy/, 'Without mod_setenvif the general policy still applies');
});

test('Static Netlify hosting sends account, employee and community pages to the PHP site', () => {
  const toml = read('netlify.toml');
  const rules = toml.split('[[redirects]]').slice(1).map(block => ({
    from: block.match(/^\s*from\s*=\s*"([^"]+)"/m)?.[1], to: block.match(/^\s*to\s*=\s*"([^"]+)"/m)?.[1],
    status: Number(block.match(/^\s*status\s*=\s*(\d+)/m)?.[1]), force: /^\s*force\s*=\s*true\s*$/m.test(block)
  }));
  const first = url => rules.find(rule => rule.from && new RegExp('^' + rule.from.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(url));
  for (const url of ['/hesap', '/hesap/giris.html', '/hesap/panel.html', '/calisan', '/calisan/giris.html', '/calisan/etkinlestir.html', '/topluluk.html']) {
    const rule = first(url);
    assert.equal(rule?.status, 301, url);
    assert.ok(rule.force && rule.to.startsWith('https://voltguard.com.tr/'), url);
  }
  assert.equal(first('/calisan/shared-header.html')?.status, 404);
  const build = read('tools/build-netlify.cjs');
  assert.doesNotMatch(build.match(/publicDirectories = \[[^\]]+\]/)[0], /'hesap'/);
  assert.match(build, /'calisan', 'hesap', 'contact\.php'\]/);
});

test('CSV export neutralises spreadsheet formulas but keeps numbers', () => {
  const source = read('js/voltguard-forms.js');
  const body = source.match(/function csvEscape\(s\) \{[\s\S]*?\n  \}/)[0];
  const csvEscape = vm.runInNewContext('(' + body + ')');
  assert.equal(csvEscape('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  assert.equal(csvEscape('+1+1'), "'+1+1");
  assert.equal(csvEscape('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvEscape('-12,5'), '"-12,5"');
  assert.equal(csvEscape('-3'), '-3');
  assert.equal(csvEscape('Kablo 3x2,5'), '"Kablo 3x2,5"');
});

test('Static-host API detection explains where accounts work', () => {
  const auth = read('js/voltguard-auth.js');
  assert.match(auth, /staticHost: 'Bu adreste hesap sunucusu çalışmıyor/);
  assert.match(auth, /res\.status === 404 \|\| res\.status === 405/);
  assert.match(read('js/vg-account.js'), /e\.staticHost && e\.message/);
});
