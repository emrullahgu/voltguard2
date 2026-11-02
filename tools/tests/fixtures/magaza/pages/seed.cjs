'use strict';
// Sayfa testleri icin sentetik ozel veri (parcali bicim: kaynaklar.json ayarlar, kaynak/<parca>.json, fiyat/<parca>.json,
// fiyat-durum.json, kur.json). Tum adresler example.test, tum degerler uydurma.
// Fiyat ornekleri (marj %20, kur 40, KDV %20): maliyet 100 USD -> satis 120 USD -> 4.800,00 TL -> 5.760,00 TL KDV dahil.
const fs = require('node:fs');
const path = require('node:path');
const ozel = require('../ozel.cjs');

const day = seconds => new Date(seconds * 1000 - 86400000).toISOString().slice(0, 10);   // TCMB yayin tarihi: dun

function source(id) {
  return [{url: `https://tedarikci-a.example.test/urun/${id}`, supplier: 'tedarikci-a.example.test', vatIncluded: true, currency: 'TRY', priority: 1, discount: 0}];
}

function item(costUsd, checkedAt, extra = {}) {
  return {status: 'ok', costTry: Math.round(costUsd * 40 * 1.2 * 100) / 100, costUsd, rateAtCheck: 40, checkedAt, lastAttemptAt: checkedAt,
    source: 0, method: 'test', available: true, note: '', history: [], ...extra};
}

/**
 * @param dataDir  VG_DATA_DIR (gecici klasor)
 * @param opts     open: siparise acik mi; now: saniye; skip: ['kur'|'fiyatlar'|'kaynaklar']; ids: kaynak/fiyat yazilacak ek
 *                 urunler {id: costUsd} (buyuk sentetik kataloglar icin)
 * Urunler: 9001 siparis verilebilir (5.760,00 TL), 9002 siparis verilebilir (28.800,00 TL), 9003 fiyati 3 gunluk (144,00 TL, stale),
 *          9004 nakliye (88.800,00 TL liste fiyati, freight), 9005 tedarikte yok (1.728,00 TL, unavailable).
 */
function seed(dataDir, opts = {}) {
  const now = opts.now || Math.floor(Date.now() / 1000);
  const dir = path.join(dataDir, 'magaza');
  fs.mkdirSync(dir, {recursive: true});
  const extra = opts.ids || {};
  if (!(opts.skip || []).includes('kaynaklar')) {
    const sources = {'vgm-9001': source('9001'), 'vgm-9002': source('9002'), 'vgm-9003': source('9003'), 'vgm-9004': source('9004'), 'vgm-9005': source('9005')};
    for (const id of Object.keys(extra)) sources[id] = source(id.slice(4));
    ozel.writeConfig(dataDir, {version: 1, open: opts.open !== false,
      margin: {default: 0.2, byCategory: {}, byProduct: {}}, shipping: {feeTry: 0, freeOverTry: 0}, paymentHours: 24, fxBuffer: 0,
      sources, blockedSuppliers: [], suppliers: {}});
  }
  if (!(opts.skip || []).includes('fiyatlar')) {
    const items = {
      'vgm-9001': item(100, now - 3600),
      'vgm-9002': item(500, now - 7200),
      'vgm-9003': item(2.5, now - 3 * 86400),
      'vgm-9005': item(30, now - 3600, {available: false, status: 'unavailable'}),
    };
    for (const [id, cost] of Object.entries(extra)) items[id] = item(cost, now - 3600);
    ozel.writePrices(dataDir, {lastRunAt: now, lastRunSummary: null, items});
  }
  if (!(opts.skip || []).includes('kur')) {
    ozel.writeRate(dataDir, {version: 1, usdTry: 40, date: day(now), fetchedAt: now - 600, source: 'TCMB today.xml ForexSelling'});
  }
  return {now, dir};
}

module.exports = {seed, day, item, source};
