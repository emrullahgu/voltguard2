'use strict';
// Mağaza kataloğu doğrulayıcı: api/lib/magaza/katalog.json yapısı, benzersiz kimlik/adres, görsellerin varlığı ve
// boyutu, bağlantılar. Kullanım: node tools/magaza/katalog-dogrula.cjs [katalog.json]  (hata varsa çıkış kodu 1)
// Test dosyası tools/tests/magaza-catalog.test.cjs aynı fonksiyonu kullanır.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const UNITS = new Set(['adet', 'metre', 'paket', 'takım', 'kutu', 'rulo', 'kg', 'set']);

function gtinOk(g) {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(g)) return false;
  const d = g.split('').map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((s, v, i) => s + v * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function webpSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)]; }
  return null;
}

function validate(catalog, base = root) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const str = (v, min, max) => typeof v === 'string' && v.trim() === v && v.length >= min && v.length <= max;
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.categories) || !Array.isArray(catalog.products)) {
    return ['katalog: version 1, categories ve products dizileri gerekli'];
  }
  const cats = new Map();
  for (const [i, c] of catalog.categories.entries()) {
    const w = `categories[${i}]`;
    if (!c || !/^[a-z0-9-]{2,60}$/.test(c.id || '')) { err(w, 'geçersiz id'); continue; }
    if (cats.has(c.id)) err(w, 'tekrarlanan id ' + c.id);
    if (!str(c.name, 2, 60)) err(w, 'name 2–60 karakter');
    if (!str(c.title, 5, 90)) err(w, 'title 5–90 karakter');
    if (typeof c.intro !== 'string' || c.intro.length > 600) err(w, 'intro en fazla 600 karakter');
    if (!Number.isInteger(c.order)) err(w, 'order tam sayı');
    cats.set(c.id, c);
  }
  const ids = new Set(), slugs = new Set(), used = new Set();
  for (const [i, p] of catalog.products.entries()) {
    const w = `products[${i}]${p && p.id ? ' ' + p.id : ''}`;
    if (!p || !/^vgm-\d{4,6}$/.test(p.id || '')) { err(w, 'geçersiz id'); continue; }
    if (ids.has(p.id)) err(w, 'tekrarlanan id');
    ids.add(p.id);
    if (!/^[a-z0-9-]{3,90}$/.test(p.slug || '') || /--|^-|-$/.test(p.slug)) err(w, 'geçersiz slug');
    else if (slugs.has(p.slug)) err(w, 'tekrarlanan slug');
    slugs.add(p.slug);
    if (!str(p.name, 8, 140)) err(w, 'name 8–140 karakter');
    if (!str(p.brand, 2, 60)) err(w, 'brand 2–60 karakter');
    if (!str(p.mpn, 2, 60)) err(w, 'mpn (üretici model kodu) 2–60 karakter');
    if (p.gtin !== null && !(typeof p.gtin === 'string' && gtinOk(p.gtin))) err(w, 'gtin null ya da geçerli GTIN-8/12/13/14');
    if (!cats.has(p.category)) err(w, 'bilinmeyen kategori ' + p.category);
    else used.add(p.category);
    if (!str(p.summary, 40, 160)) err(w, 'summary 40–160 karakter');
    if (!Array.isArray(p.description) || p.description.length < 1 || p.description.length > 5
      || p.description.some(t => !str(t, 60, 900))) err(w, 'description 1–5 paragraf, her biri 60–900 karakter');
    if (!Array.isArray(p.specs) || p.specs.length < 3 || p.specs.length > 30
      || p.specs.some(s => !Array.isArray(s) || s.length !== 2 || !str(s[0], 1, 60) || !str(s[1], 1, 160))) err(w, 'specs 3–30 [etiket, değer] çifti');
    if (!Array.isArray(p.images) || p.images.length < 1 || p.images.length > 6) err(w, 'images 1–6 görsel');
    else for (const [j, im] of p.images.entries()) {
      const iw = `${w} images[${j}]`;
      if (!str(im.alt, 8, 160)) err(iw, 'alt 8–160 karakter');
      for (const [key, size] of [['src', 800], ['thumb', 400]]) {
        const rel = im[key];
        if (!/^\/public\/magaza\/[a-z0-9-]{3,90}\.[0-9a-f]{8}(-400)?\.webp$/.test(rel || '')) { err(iw, key + ' /public/magaza/<slug>.<özet>.webp olmalı'); continue; }
        const file = path.join(base, rel.slice(1));
        if (!fs.existsSync(file)) { err(iw, key + ' dosyası yok: ' + rel); continue; }
        const dim = webpSize(file);
        if (!dim || dim[0] !== size || dim[1] !== size) err(iw, `${key} ${size}x${size} WebP olmalı (${dim ? dim.join('x') : 'okunamadı'})`);
      }
      if (im.w !== 800 || im.h !== 800) err(iw, 'w/h 800 olmalı');
    }
    if (!Array.isArray(p.documents) || p.documents.some(d => !d || !str(d.title, 3, 90) || !/^https:\/\/[^\s"<>]+$/.test(d.url || ''))) err(w, 'documents [{title, https url}]');
    if (!UNITS.has(p.unit)) err(w, 'unit: ' + [...UNITS].join(', '));
    if (![1, 10, 20].includes(p.vat)) err(w, 'vat 1, 10 veya 20');
    if (!['kargo', 'nakliye'].includes(p.shipping)) err(w, 'shipping kargo/nakliye');
    if (!Number.isInteger(p.maxQty) || p.maxQty < 1 || p.maxQty > 999) err(w, 'maxQty 1–999');
    if (typeof p.listUsd !== 'number' || !(p.listUsd > 0) || Math.round(p.listUsd * 100) / 100 !== p.listUsd) err(w, 'listUsd pozitif, en fazla 2 ondalık');
    if (typeof p.listCheckedAt !== 'string' || Number.isNaN(Date.parse(p.listCheckedAt)) || !/Z$/.test(p.listCheckedAt)) err(w, 'listCheckedAt ISO UTC');
    if (!Array.isArray(p.related)) err(w, 'related dizi');
  }
  for (const [i, p] of catalog.products.entries()) {
    for (const r of (p && Array.isArray(p.related) ? p.related : [])) {
      if (r === p.id || !ids.has(r)) errors.push(`products[${i}] ${p.id}: related bilinmeyen/kendisi ${r}`);
    }
  }
  for (const [id, c] of cats) if (used.has(id) && c.intro.trim().length < 80) err('categories ' + id, 'ürünü olan kategoride intro en az 80 karakter');
  return errors;
}

module.exports = { validate, gtinOk, webpSize };

if (require.main === module) {
  const file = process.argv[2] || path.join(root, 'api/lib/magaza/katalog.json');
  const errors = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const e of errors) console.log('HATA', e);
  console.log(`katalog: ${errors.length} sorun`);
  process.exitCode = errors.length ? 1 : 0;
}
