'use strict';

// Ortak başlık + tema altyapısı: menü kimlikleri tekil ve bağlı referanslar çözülür;
// tema seçimi ilk boyamadan önce çalışır, özel CSP sayfaları aynı başlatıcıyı dosyadan yükler.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const header = read('tools/shell/header.html');

test('başlıktaki kimlikler tekil; aria-controls ve aria-labelledby hedefleri başlığın içinde', () => {
  const ids = [...header.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'tekrarlanan kimlik: ' + ids.filter((id, i) => ids.indexOf(id) !== i));
  for (const [, attr, value] of header.matchAll(/\s(aria-controls|aria-labelledby)="([^"]+)"/g)) {
    for (const id of value.split(/\s+/)) assert.ok(ids.includes(id), `${attr} → #${id} başlıkta yok`);
  }
});

test('başlık menüsü sayfa başlık hiyerarşisine başlık eklemez; VoltSim üst menüde görünür kalır', () => {
  assert.doesNotMatch(header, /<h[1-6]\b/, 'menü grup etiketleri başlık değil, <span> olmalı');
  assert.match(header, /class="vg-nav__link vg-nav__link--sim" href="\/voltsim\/"/);
  for (const id of ['vgDdHizmetler', 'vgDdKurumsal']) assert.match(header, new RegExp(`aria-controls="${id}"`));
  assert.match(header, /href="\/teknik-kaynaklar\.html"/, 'technical content stays accessible from its dedicated hub');
});

test('tema seçimi ilk stil dosyasından önce; özel CSP sayfalarında harici başlatıcı', () => {
  for (const file of ['index.html', 'hizmetler/trafo-bakimi.html', 'gizlilik.html', 'hesap/giris.html', 'voltsim/index.html']) {
    const html = read(file);
    assert.doesNotMatch(html, /<meta name="color-scheme" content="light only">/, file);
    const privatePage = file.startsWith('hesap/');
    const boot = privatePage ? html.indexOf('<script src="/js/vg-theme-init.js') : html.indexOf('<script data-vg-theme-init>');
    assert.ok(boot > 0 && boot < html.indexOf('rel="stylesheet"'), file + ': tema seçimi ilk boyamadan önce yapılmalı');
    if (privatePage) assert.doesNotMatch(html, /localStorage\.getItem\('vg-theme'\)/, file + ': CSP satır içi başlatıcıyı yasaklar');
    assert.equal((html.match(/data-vg-theme-toggle/g) || []).length, 2, file + ': masaüstü ve mobil menü düğmesi');
  }
});

test('tema değişkenlerinin koyu karşılığı tanımlı; sabit marka renkleri koyu temada değişmez', () => {
  const css = read('css/style.css');
  const block = (selector) => (css.match(new RegExp(selector.replace(/[[\]()"]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
  const light = block(':root'), dark = block(':root[data-theme="dark"]');
  for (const token of ['--surface', '--surface-raised', '--ink', '--clr-text', '--clr-text-muted', '--clr-bg', '--clr-border', '--field-bg', '--field-border', '--danger-text', '--vg-link']) {
    assert.match(light, new RegExp(token + ':'), 'açık: ' + token);
    assert.ok(new RegExp(token + ':').test(dark) || new RegExp(token + ':\\s*var\\(--th-').test(light), 'koyu tema paletine bağlı: ' + token);
  }
  for (const constant of ['--clr-white', '--clr-dark', '--clr-accent']) assert.doesNotMatch(dark, new RegExp(constant + ':'), constant);
});
