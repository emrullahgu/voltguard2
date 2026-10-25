'use strict';
/* Renk teması (açık / koyu) için statik korumalar. Görsel denetim: node tools/tests/theme-audit.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const head = read('tools/shell/head.html');
const initInline = (head.match(/<script data-vg-theme-init>([\s\S]*?)<\/script>/) || [])[1];

function runInit(stored, prefersDark, storageThrows) {
  const attrs = {};
  const sandbox = {
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
    localStorage: { getItem: () => { if (storageThrows) throw new Error('blocked'); return stored; } },
    matchMedia: () => ({ matches: prefersDark })
  };
  vm.runInNewContext(initInline, sandbox);
  return attrs['data-theme'];
}

test('Head initializer sets data-theme before paint from storage, else OS preference', () => {
  assert.ok(initInline, 'tools/shell/head.html has <script data-vg-theme-init>');
  assert.equal(runInit(null, true), 'dark');
  assert.equal(runInit(null, false), 'light');
  assert.equal(runInit('light', true), 'light');
  assert.equal(runInit('dark', false), 'dark');
  assert.equal(runInit('bogus', true), 'dark');
  assert.equal(runInit(null, true, true), 'dark', 'blocked storage falls back to the OS preference');
  assert.match(head, /:root\[data-theme=dark\]\{color-scheme:dark/);
  // Strict-CSP pages load the same code from a file
  assert.ok(read('js/vg-theme-init.js').includes(initInline.trim()), 'js/vg-theme-init.js matches the inline initializer');
});

test('Shell follows system preference after another tab removes or clears the theme override', () => {
  const attrs = new Map(), storage = new Map(), docListeners = {}, windowListeners = {}, events = [];
  const rootEl = { getAttribute: k => attrs.get(k) || null, setAttribute: (k, v) => attrs.set(k, v), hasAttribute: k => attrs.has(k),
    classList: { add() {}, remove() {} } };
  const mq = { matches: false, addEventListener: (type, fn) => { mq.onChange = fn; } };
  const doc = { documentElement: rootEl, readyState: 'complete', getElementById: () => null, querySelectorAll: () => [],
    addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); }, dispatchEvent: e => events.push(e) };
  const win = { matchMedia: () => mq, addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); } };
  const context = vm.createContext({ window: win, document: doc,
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    CustomEvent: function (type, opts) { this.type = type; this.detail = opts.detail; }, setTimeout: () => 1, clearTimeout() {} });
  const shell = read('js/vg-shell.js');
  vm.runInContext(shell, context);
  vm.runInContext(shell, context);
  assert.equal(docListeners.click.length, 1, 'loading the shared script twice adds one toggle handler');
  const notify = key => windowListeners.storage.forEach(fn => fn({ key }));

  win.VGTheme.set('dark');
  storage.delete('vg-theme'); notify('vg-theme');
  assert.equal(win.VGTheme.get(), 'light', 'removing the override discards this tab’s memo');
  mq.matches = true; mq.onChange();
  assert.equal(win.VGTheme.get(), 'dark', 'system changes are followed after removal');

  win.VGTheme.set('light');
  storage.clear(); notify(null);
  assert.equal(win.VGTheme.get(), 'dark', 'localStorage.clear has a null key and also clears the memo');
  mq.matches = false; mq.onChange();
  assert.equal(win.VGTheme.get(), 'light', 'system changes are followed after clear');

  storage.set('vg-theme', 'dark'); notify('vg-theme');
  assert.equal(win.VGTheme.get(), 'dark', 'another tab’s explicit preference is applied');
  mq.onChange();
  assert.equal(win.VGTheme.get(), 'dark', 'an explicit preference still overrides the system');
  assert.ok(events.some(e => e.type === 'vg:theme' && e.detail.theme === 'light'));
});

test('Every shell page initializes the theme and none is light-only', () => {
  const skip = new Set(['node_modules', 'tools', '.qa', '.git', '.claude', 'public',
    '.netlify-publish', 'voltguardekleyelim', 'vesikalar', 'VoltGame', 'voltgame']);
  const pages = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? dir + '/' + e.name : e.name;
      if (e.isDirectory()) { if (!skip.has(e.name) && rel !== 'calisan/uygulama' && !/^araclar\/(vendor|assets|shared|downloads)/.test(rel)) walk(rel); }
      else if (/\.html$/.test(e.name) && !/^calisan\/shared-/.test(rel)) pages.push(rel);
    }
  })('');
  assert.ok(pages.length > 150);
  for (const rel of pages) {
    const html = read(rel);
    assert.doesNotMatch(html, /name="color-scheme" content="light only"/, rel);
    const inline = html.includes('<script data-vg-theme-init>');
    const file = /<script src="\/js\/vg-theme-init\.js\?v=[0-9a-f]+"><\/script>/.test(html);
    assert.ok(inline || file, rel + ' initializes data-theme');
    if (/^(hesap|calisan)\//.test(rel)) assert.ok(file && !inline, rel + ' uses the CSP-safe initializer file');
  }
  assert.match(read('calisan/index.php'), /<script src="\/js\/vg-theme-init\.js\?v=[0-9a-f]+"><\/script>/);
});

test('Header toggle is accessible on desktop and in the mobile menu', () => {
  const header = read('tools/shell/header.html');
  const toggles = header.match(/<button class="vg-theme[^"]*"[^>]*>/g) || [];
  assert.equal(toggles.length, 2, 'one in .vg-actions, one in the mobile menu');
  for (const b of toggles) {
    assert.match(b, /type="button"/);
    assert.match(b, /data-vg-theme-toggle/);
    assert.match(b, /aria-pressed="false"/);
    assert.match(b, /aria-label="Koyu temaya geç"/);
  }
  assert.ok(header.indexOf('vg-theme--row') < header.indexOf('class="vg-actions"'), 'mobile toggle sits in the menu panel');
  const shell = read('js/vg-shell.js');
  assert.match(shell, /Açık temaya geç/);
  assert.match(shell, /try \{ if \(memo\) localStorage\.setItem/);
  const css = read('css/vg-shell.css');
  assert.match(css, /\.vg-theme \{[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(css, /prefers-reduced-motion: no-preference\) \{\s*html\.vg-theme-anim/);
});

test('Print, PDF and light islands always resolve light tokens', () => {
  const css = read('css/vg-shell.css');
  const print = (css.match(/@media print \{\s*:root\[data-theme="dark"\] \{[\s\S]*?\}\s*\}/) || [''])[0];
  assert.match(print, /--th-surface: #fff;/);
  assert.match(print, /color-scheme: light;/);
  assert.match(css, /:root\[data-theme="dark"\] :is\(\.th-light, body\.vg-engineering--tool, body\.company-page\)/);
  assert.match(read('js/voltsim/core.js'), /class: 'rp-host th-light'/);
  // Images are never filtered or inverted
  for (const file of ['css/vg-shell.css', 'css/style.css', 'css/home.css', 'css/services.css', 'css/voltsim.css']) {
    assert.doesNotMatch(read(file), /data-theme="dark"\][^{]*\{[^}]*filter:\s*invert/, file);
  }
});

test('Engineering pages get the same initializer at build time', () => {
  const html = read('araclar/ag-gerilim-dusumu/index.html');
  assert.ok(html.includes(initInline.trim()), 'araclar tool initializes the theme');
  assert.match(html, /name="color-scheme" content="light dark"/);
});
