#!/usr/bin/env node
'use strict';
// Mağaza kataloğu v2 doğrulayıcı (api/lib/magaza/katalog/): ürün ve kategori kuralları (isteğe bağlı minQty/step/packQty
// ve kategori filters dahil), benzersiz kimlik/adres, görseller (/public/magaza/ dosyaları her zaman; /magaza-gorsel/
// dosyaları VG_MAGAZA_MEDIA klasörü varsa), bağlantılar ve dizin tutarlılığı (liste kartları attr/sortTry, slug, arama
// dizini satırları, sayılar, manifest; katalog-derle.cjs'in üreteceği dosyalarla birebir aynı).
//   node tools/magaza/katalog-dogrula.cjs [katalog-dizini]     (hata varsa çıkış kodu 1)
// Test dosyası tools/tests/magaza-catalog.test.cjs aynı fonksiyonları kullanır.
const fs = require('node:fs');
const path = require('node:path');
const K = require('./katalog-ortak.cjs');

/** Bellekteki model (v2 kuralları). opts: {base, media}. Döndürür hata listesi. */
function validate(model, opts = {}) {
  return K.validateModel(model, opts).errors;
}

/**
 * Parçalı dizini doğrular. Döndürür {errors, unchecked, products}.
 * Dizin dosyaları modelden yeniden üretilenlerle karşılaştırılır (generatedAt hariç).
 */
function validateDir(dir, opts = {}) {
  let model;
  try { model = K.loadDir(dir); } catch (e) { return { errors: ['dizin okunamadı: ' + e.message], unchecked: 0, products: 0 }; }
  if (!fs.existsSync(path.join(dir, 'kategoriler.json'))) return { errors: ['kategoriler.json yok: ' + dir], unchecked: 0, products: 0 };
  const res = K.validateModel(model, opts);
  const errors = [...res.errors];
  if (!errors.length) {
    const expected = K.buildFiles(model);
    const actual = new Set(K.listFiles(dir));
    for (const [rel, text] of expected) {
      if (!actual.has(rel)) { errors.push(`dizin: ${rel} eksik (katalog-derle.cjs ile yeniden yazın)`); continue; }
      if (K.withoutStamp(rel, fs.readFileSync(path.join(dir, rel), 'utf8')) !== K.withoutStamp(rel, text)) errors.push(`dizin: ${rel} güncel değil (katalog-derle.cjs ile yeniden yazın)`);
    }
    for (const rel of actual) if (!expected.has(rel)) errors.push(`dizin: ${rel} artık kullanılmıyor (katalog-derle.cjs siler)`);
    for (const meta of ['kategoriler.json', 'manifest.json']) {
      try {
        const stamp = JSON.parse(fs.readFileSync(path.join(dir, meta), 'utf8')).generatedAt;
        if (typeof stamp !== 'string' || !/Z$/.test(stamp) || Number.isNaN(Date.parse(stamp))) errors.push(`dizin: ${meta} generatedAt ISO UTC olmalı`);
      } catch (_) { /* yukarıda raporlandı */ }
    }
  }
  return { errors, unchecked: res.unchecked, products: model.products.length };
}

module.exports = { validate, validateDir, gtinOk: K.gtinOk, webpSize: K.webpSize, extractAttr: K.extractAttr };

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || process.env.VG_MAGAZA_CATALOG || K.DEFAULT_DIR);
  const r = validateDir(dir, { media: K.mediaDir() });
  for (const e of r.errors) console.log('HATA', e);
  if (r.unchecked) console.log(`not: medya klasörü (${K.mediaDir()}) bulunamadı; ${r.unchecked} görsel dosyası denetlenemedi, yalnızca adres kalıbı denetlendi`);
  console.log(`katalog: ${r.products} ürün, ${r.errors.length} sorun`);
  process.exitCode = r.errors.length ? 1 : 0;
}
