'use strict';
// Exercise the real static publish copy. No provider or credential files are read.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), publish = path.join(root, '.netlify-publish');
const relative = 'araclar/canli-veri-merkezi/index.html';
let sourceBefore, sourceAfter, cloned;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
before(() => {
  sourceBefore = fs.readFileSync(path.join(root, relative));
  const result = spawnSync(process.execPath, [path.join(root, 'tools/build-netlify.cjs')], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  sourceAfter = fs.readFileSync(path.join(root, relative));
  cloned = fs.readFileSync(path.join(publish, relative), 'utf8');
});

test('Netlify publish copy clearly identifies unavailable PHP services without modifying the PHP source page', () => {
  assert.equal(digest(sourceBefore), digest(sourceAfter), 'Packaging must not change the live PHP-host source.');
  assert(!sourceAfter.toString('utf8').includes('id="vg-data-host-notice"'));
  const notices = [...cloned.matchAll(/<p\b[^>]*id="vg-data-host-notice"[^>]*>([\s\S]*?)<\/p>/g)];
  assert.equal(notices.length, 1);
  assert.match(notices[0][0], /role="status"/);
  assert.match(notices[0][1], /sürüm statiktir/);
  assert.match(notices[0][1], /PHP sunucusunda/);
  assert.match(notices[0][1], /cPanel yayını tamamlandığında/);
  assert.match(notices[0][1], /sorgu düğmeleri kapalıdır/);
  assert.match(notices[0][1], /href="https:\/\/voltguard\.com\.tr\/araclar\/canli-veri-merkezi\/"/);
});

test('All five data-query buttons in the static copy are valid disabled buttons and private links target the PHP host', () => {
  const buttons = [];
  for (const id of ['addressForm', 'weatherForm', 'currencyForm']) {
    const form = cloned.match(new RegExp('<form\\b[^>]*id="' + id + '"[^>]*>[\\s\\S]*?<\\/form>'))?.[0];
    assert(form, id + ' is retained.');
    const tags = [...form.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
    assert.equal(tags.length, 1, id + ' has one query button.'); buttons.push(...tags);
  }
  for (const id of ['cryptoButton', 'statusButton']) {
    const tag = cloned.match(new RegExp('<button\\b[^>]*id="' + id + '"[^>]*>'))?.[0];
    assert(tag, id + ' remains a real button.'); buttons.push(tag);
  }
  assert.equal(buttons.length, 5); for (const tag of buttons) assert.match(tag, /\sdisabled(?:\s|>|=)/);
  assert.doesNotMatch(cloned, /<buttonid\b/i);
  const privateLinks = [...cloned.matchAll(/\bhref="([^"]*\/calisan\/uygulama\/[^"]*)"/g)].map(match => match[1]);
  assert.equal(privateLinks.length, 2);
  for (const href of privateLinks) { const url = new URL(href); assert.equal(url.origin, 'https://voltguard.com.tr'); assert.equal(url.pathname, '/calisan/uygulama/'); assert.equal(url.searchParams.get('module'), 'api-servisleri'); }
  assert.doesNotMatch(cloned, /href="\/calisan\/uygulama\//);
  assert.match(sourceAfter.toString('utf8'), /href="\/calisan\/uygulama\//, 'Local/PHP-host navigation stays same-origin.');
});

test('The actual static package excludes server code, employee files, development sources and common credential formats', () => {
  for (const name of ['api', 'tools', 'calisan', 'hesap', '.qa', 'contact.php', 'SahaTakip-main', 'vesikalar', 'voltguardekleyelim']) assert(!fs.existsSync(path.join(publish, name)), name + ' must not be published.');
  let count = 0;
  const walk = directory => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name), label = path.relative(publish, file).replaceAll('\\', '/');
      assert(!item.isSymbolicLink(), 'No publish links: ' + label);
      assert(!/^(?:\.env(?:\.|$)|integrations-secrets\.json$)/i.test(item.name), 'No credential/configuration file: ' + label);
      if (item.isDirectory()) { assert(!/^\.(?:git|qa)$/.test(item.name), 'No development directory: ' + label); walk(file); continue; }
      count++;
      assert(!/\.(?:php\d?|ps1|py|pem|key|pfx|sqlite\d?|db)$/i.test(item.name), 'No server/credential file: ' + label);
      if (/\.(?:html?|js|mjs|css|json|xml|txt|svg|webmanifest)$/i.test(item.name)) {
        const text = fs.readFileSync(file, 'utf8');
        assert(!/\b(?:AIza[0-9A-Za-z_-]{30,}|gsk_[0-9A-Za-z]{20,}|sk-(?:or-v1-)?[0-9A-Za-z_-]{24,})\b/.test(text), 'Credential-shaped value found in publish file: ' + label);
      }
    }
  };
  walk(publish); assert(count > 500, 'The checks inspect the full real publish package.');
});
