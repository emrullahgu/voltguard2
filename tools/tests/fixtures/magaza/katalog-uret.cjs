'use strict';
// Mağaza testleri için sentetik katalog üretici (yalnızca testler): katalog-ortak.cjs'in yazıcısıyla (buildFiles +
// writeDir) gerçek v2 dizini üretir. Tüm adlar, markalar ve fiyatlar uydurmadır; görseller medya deposu adresleridir
// (dosyaları yoktur; doğrulayıcı medya klasörü verilmeden yalnızca adres kalıbını denetler).
const crypto = require('node:crypto');
const K = require('../../../magaza/katalog-ortak.cjs');

const BRANDS = ['Alfa Elektrik', 'Beta Enerji', 'Çağ Güç', 'Delta Volt', 'Ege Akım', 'Fırat Kablo', 'Gök Solar', 'Hisar Pano',
  'Işık Teknik', 'Jeneratör Plus', 'Kuvvet', 'Lider Şalt'];

function category(id, name, order, parent = null, intro) {
  return { id, name, title: name + ' Fiyatları', intro: intro || `${name} için sentetik test kategorisi. Yalnızca otomatik testlerde kullanılır; gerçek ürün, fiyat veya tedarikçi bilgisi içermez.`,
    order, parent };
}

/** Geçerli (katalog doğrulayıcısından geçen) sentetik ürün. n: sıra numarası (ad, model ve fiyatı belirler). */
function product(id, cat, n, over = {}) {
  const brand = over.brand || BRANDS[n % BRANDS.length];
  const model = `SN-${String(n).padStart(6, '0')}`;
  const slug = over.slug || `sentetik-${String(n).padStart(6, '0')}-${cat}`.slice(0, 90).replace(/-+$/, '');
  const digest = crypto.createHash('sha256').update(slug).digest('hex');
  const shard = crypto.createHash('md5').update(slug).digest('hex').slice(0, 2);
  return {
    id, slug, name: `${brand} ${model} Sentetik Test Ürünü`, brand, mpn: model, gtin: null, category: cat,
    summary: `Sentetik test ürünü ${model}; gerçek satışta kullanılmaz.`,
    description: [`Bu ürün yalnızca otomatik testler içindir (${model}); teknik değerler ve fiyatı örnektir, gerçek bir ürünü tanımlamaz.`],
    specs: [['Model', model], ['Sıra', String(n)]],
    images: [{ src: `/magaza-gorsel/${shard}/${slug}.${digest.slice(0, 8)}.webp`, thumb: `/magaza-gorsel/${shard}/${slug}.${digest.slice(0, 8)}-t.webp`,
      w: 640, h: 640, alt: `${brand} ${model} sentetik görsel` }],
    documents: [], unit: 'adet', vat: 20, shipping: 'kargo', maxQty: 50,
    listUsd: Math.round((10 + (n * 37) % 990) * 100) / 100, listCheckedAt: '2026-10-27T08:00:00Z', related: [],
    ...over,
  };
}

/** Modeli dizine yazar (katalog-derle.cjs ile aynı biçim). Döndürür writeDir istatistiği. */
function write(dir, model, now = new Date('2026-10-27T12:00:00Z')) {
  return K.writeDir(dir, K.buildFiles(K.normalize(model)), now);
}

/**
 * Büyük katalog (performans ve içe aktarma testleri): 12 üst kategori × 4 alt kategori; ilk alt kategori ağır
 * (heavy ürün), kalanlar eşit. Kimlikler vgm-100000'den başlar (6 haneli). Döndürür {model, ids, heavy, parent}.
 */
function bigModel(total = 50000, heavy = 6000) {
  const categories = [];
  const leaves = [];
  for (let t = 0; t < 12; t++) {
    const top = `ust-${String(t + 1).padStart(2, '0')}`;
    categories.push(category(top, `Üst Kategori ${t + 1}`, (t + 1) * 10));
    for (let s = 0; s < 4; s++) {
      const leaf = `${top}-alt-${s + 1}`;
      categories.push(category(leaf, `Alt Kategori ${t + 1}.${s + 1}`, (t + 1) * 10 + s + 1, top));
      leaves.push(leaf);
    }
  }
  const products = [];
  const rest = total - heavy;
  const per = Math.floor(rest / (leaves.length - 1));
  let n = 0;
  leaves.forEach((leaf, i) => {
    const count = i === 0 ? heavy : i === leaves.length - 1 ? rest - per * (leaves.length - 2) : per;
    for (let k = 0; k < count; k++, n++) products.push(product(`vgm-${100000 + n}`, leaf, n));
  });
  return { model: { categories, products }, heavyLeaf: leaves[0], parent: 'ust-01', leaves };
}

module.exports = { BRANDS, category, product, write, bigModel };
