#!/usr/bin/env node
'use strict';
// Mağaza kataloğu v2 yazıcısı (api/MAGAZA.md "Katalog yazıcısı"). Mevcut parçalı dizini okur, isteğe bağlı girdileri
// uygular, tüm modeli doğrular ve TÜM dizin dosyalarını belirlenimli olarak yeniden yazar (değişmeyen dosyaya dokunmaz,
// artık kullanılmayan parça/liste/slug dosyalarını siler, sayıları yeniden hesaplar, boş related[] alanlarını aynı
// kategoriden en çok 4 komşuyla doldurur). Liste kartlarına specs'ten türetilen normalize attr (poles/amps/curve/ka/
// section/phase/kw) ve sortTry, arama dizinine model biçimleri + kategori yolu + spec değerleri + sentetik tokenler + eş
// anlamlılar yazılır (katalog-ortak.cjs extractAttr/searchRow). Doğrulama hatası varsa hiçbir şey yazılmaz (çıkış kodu 1).
//
//   node tools/magaza/katalog-derle.cjs [--dizin <katalog-dizini>]
//        [--kategoriler <kategoriler.json>]    tam kategori listesi (dizi ya da {"categories": [...]}); eskisinin yerine geçer
//        [--ekle <urunler.jsonl>]              her satır bir ürün kaydı; aynı id varsa değiştirilir
//        [--sil vgm-100001,vgm-100002]         ürünleri kaldırır (kimlikler yeniden kullanılmaz)
//        [--v1 <katalog.json>]                 eski tek dosyalı kataloğu (version 1) kayıpsız taşır
//        [--deneme]                            doğrula ve ne değişeceğini yaz, dosyalara dokunma
// Görseller /magaza-gorsel/ altındaysa VG_MAGAZA_MEDIA klasörü (varsa) denetlenir; yoksa yalnızca adres kalıbı.
const fs = require('node:fs');
const path = require('node:path');
const K = require('./katalog-ortak.cjs');

function parseArgs(argv) {
  const opt = {};
  const valued = new Set(['dizin', 'kategoriler', 'ekle', 'sil', 'v1']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--([a-z0-9]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error('Bilinmeyen argüman: ' + a);
    if (m[1] === 'deneme') { opt.deneme = true; continue; }
    if (m[1] === 'yardim' || m[1] === 'help') { opt.help = true; continue; }
    if (!valued.has(m[1])) throw new Error('Bilinmeyen seçenek: --' + m[1]);
    const v = m[2] !== undefined ? m[2] : argv[++i];
    if (v === undefined || v === '') throw new Error('--' + m[1] + ' bir değer ister');
    opt[m[1]] = v;
  }
  return opt;
}

function readJsonl(file) {
  const out = [];
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try { out.push(JSON.parse(line)); } catch (e) { throw new Error(`${path.basename(file)} satır ${i + 1}: geçersiz JSON (${e.message})`); }
  });
  return out;
}

/**
 * Modeli girdilerle günceller ve doğrular. Döndürür {model, errors, unchecked, added, replaced, removed}.
 * (Testler ve CLI aynı fonksiyonu kullanır.)
 */
function compose(dir, opt, env = process.env) {
  let model = opt.v1 ? K.fromV1(K.readJson(opt.v1)) : K.loadDir(dir);
  if (opt.kategoriler) {
    const raw = K.readJson(opt.kategoriler);
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.categories) ? raw.categories : null;
    if (!list) throw new Error('--kategoriler: dizi ya da {"categories": [...]} bekleniyor');
    model.categories = list.map(c => { const { count, ...rest } = c || {}; return rest; });
  }
  const byId = new Map(model.products.map(p => [p.id, p]));
  let added = 0, replaced = 0, removed = 0;
  const newIds = [];
  if (opt.ekle) {
    for (const p of readJsonl(opt.ekle)) {
      if (!p || typeof p.id !== 'string') throw new Error('--ekle: her satırda id alanı olan bir ürün bekleniyor');
      if (byId.has(p.id)) replaced++;
      else { added++; newIds.push(p.id); }
      byId.set(p.id, p);
    }
  }
  // Yeni ürünler 6 haneli ve 100000 ve üstü kimlik alır (eski 4 haneli kimliklerle sayısal çakışma olmaz).
  const badNew = newIds.filter(id => !K.NEW_ID_RE.test(id));
  if (opt.sil) {
    for (const id of String(opt.sil).split(',').map(s => s.trim()).filter(Boolean)) {
      if (!byId.delete(id)) throw new Error('--sil: katalogda olmayan ürün ' + id);
      removed++;
    }
  }
  model = K.normalize({ categories: model.categories, products: [...byId.values()] });
  const { errors, unchecked } = K.validateModel(model, { media: K.mediaDir(env) });
  for (const id of badNew) errors.unshift(`--ekle ${id}: yeni ürün kimliği vgm-100000 ve üstü 6 haneli olmalı (mevcut 4 haneli kimlikler korunur)`);
  return { model, errors, unchecked, added, replaced, removed };
}

function main(argv) {
  let opt;
  try { opt = parseArgs(argv); } catch (e) { console.error(e.message); return 2; }
  if (opt.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 15).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
  const dir = path.resolve(opt.dizin || process.env.VG_MAGAZA_CATALOG || K.DEFAULT_DIR);
  let r;
  try { r = compose(dir, opt); } catch (e) { console.error('HATA ' + e.message); return 1; }
  for (const e of r.errors.slice(0, 200)) console.error('HATA ' + e);
  if (r.errors.length) {
    console.error(`${r.errors.length} hata; hiçbir dosya yazılmadı.`);
    return 1;
  }
  const files = K.buildFiles(r.model);
  const summary = `${r.model.products.length} ürün, ${r.model.categories.length} kategori (eklenen ${r.added}, değişen ${r.replaced}, silinen ${r.removed})`
    + (r.unchecked ? `; medya klasörü bulunamadığı için ${r.unchecked} görsel dosyası denetlenemedi (yalnızca adres kalıbı)` : '');
  if (opt.deneme) {
    const existing = new Set(K.listFiles(dir));
    let differ = 0;
    for (const [rel, text] of files) {
      if (!existing.has(rel) || K.withoutStamp(rel, fs.readFileSync(path.join(dir, rel), 'utf8')) !== K.withoutStamp(rel, text)) differ++;
    }
    const stale = [...existing].filter(rel => !files.has(rel)).length;
    console.log(`Deneme: ${summary}. Yazılacak ${differ} dosya, silinecek ${stale} dosya (hiçbir şey yazılmadı).`);
    return 0;
  }
  const stats = K.writeDir(dir, files);
  console.log(`Katalog yazıldı: ${summary}. ${stats.written} dosya yazıldı, ${stats.removed} dosya silindi, ${stats.unchanged} dosya aynı.`);
  return 0;
}

module.exports = { compose, parseArgs, main };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
