'use strict';
// Mağaza kataloğu ve açık depo gizliliği: katalog yapısı/görselleri geçerli; tedarikçi alan adları (incelenen
// adayların SHA-256 özetleri) mağaza dosyalarının hiçbirinde geçmiyor; özel veri dosyaları depoda yok.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validate, gtinOk } = require('../magaza/katalog-dogrula.cjs');
const root = path.resolve(__dirname, '../..');

test('gerçek katalog ve sentetik test kataloğu doğrulamadan geçer', () => {
  const real = JSON.parse(fs.readFileSync(path.join(root, 'api/lib/magaza/katalog.json'), 'utf8'));
  assert.deepEqual(validate(real), []);
  const ids = real.products.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tools/tests/fixtures/magaza/katalog.json'), 'utf8'));
  assert.equal(fixture.products.length >= 5, true);
  assert.equal(gtinOk('4006381333931'), true);
  assert.equal(gtinOk('4006381333932'), false);
});

test('doğrulayıcı bozuk kayıtları yakalar', () => {
  const bad = { version: 1, categories: [{ id: 'k', name: 'K', title: 'Kategori', intro: '', order: 1 }],
    products: [{ id: 'vgm-0001', slug: 'Kotu Slug', name: 'x', brand: '', mpn: '', gtin: '123', category: 'yok', summary: '',
      description: [], specs: [], images: [{ src: '/public/baska/x.png', thumb: '', w: 1, h: 1, alt: '' }], documents: [{ title: 't', url: 'http://x' }],
      unit: 'koli', vat: 18, shipping: 'gemi', maxQty: 0, listUsd: 1.234, listCheckedAt: 'dün', related: ['vgm-0001'] }] };
  const errors = validate(bad).join('\n');
  for (const word of ['slug', 'name', 'brand', 'mpn', 'gtin', 'kategori', 'summary', 'description', 'specs', 'src', 'documents',
    'unit', 'vat', 'shipping', 'maxQty', 'listUsd', 'listCheckedAt', 'related']) assert.match(errors, new RegExp(word), word);
});

function trackedShopFiles() {
  let files;
  try { files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean); }
  catch (_) { return null; }
  return files.filter(f => /(^|\/)magaza|MAGAZA\.md$|^public\/magaza\//i.test(f) && !/\.(webp|png|jpe?g)$/i.test(f));
}

test('tedarikçi alan adları açık depodaki mağaza dosyalarında geçmez', t => {
  const files = trackedShopFiles();
  if (!files) { t.skip('git yok'); return; }
  // Özet listesi de açık depoya girmez (alan adları sözlükle geri çözülebilir): yalnızca yerel özel klasörde varsa denetlenir.
  const list = path.join(root, 'tools/magaza/ozel/tedarikci-ozet.json');
  if (!fs.existsSync(list)) { t.skip('özel tedarikçi listesi bu makinede yok'); return; }
  const known = new Set(JSON.parse(fs.readFileSync(list, 'utf8')).hashes);
  const hostRe = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com\.tr|net\.tr|org\.tr|gen\.tr|com|net|org|tr|shop|store)\b/gi;
  const leaks = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(hostRe)) {
      const host = m[0].toLowerCase().replace(/^www\./, '');
      const parts = host.split('.');
      for (let i = 0; i < parts.length - 1; i++) {
        const candidate = parts.slice(i).join('.');
        if (known.has(crypto.createHash('sha256').update(candidate).digest('hex'))) leaks.push(`${f}: ${candidate}`);
      }
    }
  }
  assert.deepEqual([...new Set(leaks)], [], 'tedarikçi bilgisi yalnızca sunucudaki özel veri klasöründe durmalı');
});

test('özel mağaza verisi depoya eklenmemiş', t => {
  let files;
  try { files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean); }
  catch (_) { t.skip('git yok'); return; }
  const forbidden = files.filter(f => /magaza/i.test(f) && !/fixtures\//.test(f)
    && /(^|\/)(kaynaklar|fiyatlar|siparisler|gorsel-kaynaklari|panel|kur)\.json$/.test(f));
  assert.deepEqual(forbidden, []);
});
