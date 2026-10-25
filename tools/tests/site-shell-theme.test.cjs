'use strict';

// Ortak başlık + tema altyapısı: menü kimlikleri tekil ve bağlı referanslar çözülür; tema betiği yalnızca tema destekleyen
// (<html data-vg-themes>) sayfalara girer ve stil dosyalarından önce çalışır; tema değişkenlerinin koyu karşılığı tanımlıdır.
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
  for (const id of ['vgDdHizmetler', 'vgDdKurumsal', 'vgDdKaynaklar']) assert.match(header, new RegExp(`aria-controls="${id}"`));
});

test('tema betiği yalnızca data-vg-themes sayfalarında ve ilk stil dosyasından önce', () => {
  const themed = ['index.html', 'tools/templates/service-page.html',
    ...fs.readdirSync(path.join(root, 'hizmetler')).filter(f => f.endsWith('.html')).map(f => 'hizmetler/' + f)];
  for (const file of themed) {
    const html = read(file);
    assert.match(html, /<html[^>]*\sdata-vg-themes/, file);
    assert.doesNotMatch(html, /<meta name="color-scheme" content="light only">/, file);
    if (file.startsWith('tools/')) continue;                       // şablon: betiği shell.py ekler
    const boot = html.indexOf("localStorage.getItem('vg-theme')"), css = html.indexOf('rel="stylesheet"');
    assert.ok(boot > 0 && boot < css, file + ': tema seçimi ilk boyamadan önce yapılmalı');
  }
  assert.match(read('css/services.css'), /:root\[data-theme="dark"\] \.svc-page \{[^}]*--s-surface:/, 'services.css koyu değişkenleri');
  for (const file of ['gizlilik.html', 'hesap/giris.html', 'voltsim/index.html']) {
    const html = read(file);
    assert.doesNotMatch(html, /<html[^>]*data-vg-themes/, file);
    assert.doesNotMatch(html, /localStorage\.getItem\('vg-theme'\)/, file + ': tema desteklemeyen sayfa koyu temaya geçmemeli');
    assert.match(html, /data-vg-theme-toggle[^>]*\shidden/, file + ': düğme varsayılan olarak gizli');
  }
});

test('tema değişkenlerinin koyu karşılığı tanımlı; sabit marka renkleri koyu temada değişmez', () => {
  const css = read('css/style.css');
  const block = (selector) => (css.match(new RegExp(selector.replace(/[[\]()"]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
  const light = block(':root'), dark = block(':root[data-theme="dark"]');
  for (const token of ['--surface', '--surface-raised', '--ink', '--clr-text', '--clr-text-muted', '--clr-bg', '--clr-border', '--field-bg', '--field-border', '--danger-text', '--vg-link']) {
    assert.match(light, new RegExp(token + ':'), 'açık: ' + token);
    assert.match(dark, new RegExp(token + ':'), 'koyu: ' + token);
  }
  for (const constant of ['--clr-white', '--clr-dark', '--clr-accent']) assert.doesNotMatch(dark, new RegExp(constant + ':'), constant);
});
