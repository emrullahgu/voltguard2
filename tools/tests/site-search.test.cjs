'use strict';

// Site içi arama: Türkçe karakter katlama, sıralama ve dizin kapsamı
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const S = require(path.join(root, 'js/site-search.js'));
global.window = {};
require(path.join(root, 'js/search-index.js'));
const INDEX = global.window.VG_SEARCH_INDEX;
const top = (q, n = 3) => S.search(INDEX, q, n).map(r => r.item.u);

test('Türkçe karakterler ve büyük harf katlanır', () => {
  assert.equal(S.fold('KAÇAK AKIM Rölesi İŞLETME Güç'), 'kacak akim rolesi isletme guc');
  assert.equal(S.fold('cosφ'), 'cosf');
});

test('dizin sitemap sayfalarını ve sözlük terimlerini içerir', () => {
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const html = [...sitemap.matchAll(/<loc>https:\/\/voltguard\.com\.tr(\/[^<]*)<\/loc>/g)].map(m => m[1]).filter(u => !/\.pdf$/.test(u));
  const urls = new Set(INDEX.map(i => i.u));
  assert.deepEqual(html.filter(u => !urls.has(u)), []);
  assert.ok(INDEX.filter(i => i.s === 'Sözlük').length >= 50);
  assert.ok(!urls.has('/arama.html'), 'arama sayfası kendini listelemez');
  INDEX.forEach(i => assert.ok(i.t && i.t.length > 1, i.u + ' başlık'));
});

test('aksansız ve ekli sorgular doğru sayfaları bulur', () => {
  assert.ok(top('kacak akim rolesi').some(u => u.startsWith('/bilgi/kacak-akim-rolesi')));
  assert.ok(top('topraklamanın direnci').includes('/bilgi/topraklama-degeri-kac-olmali.html'));
  assert.ok(top('gerilim dusumu').includes('/bilgi/gerilim-dusumu-nedir.html'));
  assert.ok(top('RCD', 1)[0].includes('elektrik-terimleri-sozlugu.html#kacak-akim-rolesi'));
  assert.ok(top('periyodik kontrol planlayıcı', 1)[0] === '/hesaplama/periyodik-kontrol-planlayici/');
});

test('tüm sözcükler eşleşmeli; anlamsız sorgu boş döner', () => {
  assert.deepEqual(S.search(INDEX, 'xyzqwv'), []);
  assert.deepEqual(S.search(INDEX, '   '), []);
  const both = S.search(INDEX, 'trafo bakım');
  both.forEach(r => {
    const t = S.fold(Object.values(r.item).join(' '));
    assert.ok(t.includes('trafo') && t.includes('bakim'), r.item.u);
  });
});
