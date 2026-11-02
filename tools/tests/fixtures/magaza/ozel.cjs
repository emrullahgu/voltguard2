'use strict';
// Mağaza testleri için parçalı özel veri yardımcıları (api/MAGAZA.md "Özel veri"): VG_DATA_DIR/magaza/ altına
// kaynaklar.json (ayarlar), kaynak/<parça>.json, fiyat/<parça>.json, fiyat-durum.json ve kur.json yazar/okur.
// Fiyat veya kaynak değişince fiyat-sira.json silinir; PHP sırayı ve sorun listesini parçalardan yeniden kurar.
const fs = require('node:fs');
const path = require('node:path');

const shardOf = id => String(Math.floor(parseInt(String(id).slice(4), 10) / 100)).padStart(4, '0');
const dirOf = dataDir => path.join(dataDir, 'magaza');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function invalidate(dataDir) { fs.rmSync(path.join(dirOf(dataDir), 'fiyat-sira.json'), { force: true }); }

/** Ayarlar + kaynaklar (eski tek dosya biçimindeki gibi "sources" içerebilir): parçalı yazar, eski parçaları siler. */
function writeConfig(dataDir, config) {
  const dir = dirOf(dataDir);
  const { sources = {}, ...settings } = config;
  writeJson(path.join(dir, 'kaynaklar.json'), settings);
  fs.rmSync(path.join(dir, 'kaynak'), { recursive: true, force: true });
  const shards = {};
  for (const id of Object.keys(sources).sort()) (shards[shardOf(id)] = shards[shardOf(id)] || {})[id] = sources[id];
  for (const [s, map] of Object.entries(shards)) writeJson(path.join(dir, 'kaynak', s + '.json'), map);
  invalidate(dataDir);
}

/** Ayarlar + tüm kaynaklar (tek nesne). */
function readConfig(dataDir) {
  const dir = dirOf(dataDir);
  const settings = readJson(path.join(dir, 'kaynaklar.json'), null);
  if (!settings) return null;
  const sources = {};
  const kdir = path.join(dir, 'kaynak');
  if (fs.existsSync(kdir)) for (const f of fs.readdirSync(kdir).filter(f => /^\d{4}\.json$/.test(f)).sort()) Object.assign(sources, readJson(path.join(kdir, f), {}));
  return { ...settings, sources };
}

/** Fiyat durumu {items, lastRunAt, lastRunSummary}: parçalar + fiyat-durum.json. Önceki fiyat parçaları silinir. */
function writePrices(dataDir, state) {
  const dir = dirOf(dataDir);
  fs.rmSync(path.join(dir, 'fiyat'), { recursive: true, force: true });
  const shards = {};
  for (const id of Object.keys(state.items || {}).sort()) (shards[shardOf(id)] = shards[shardOf(id)] || {})[id] = state.items[id];
  for (const [s, map] of Object.entries(shards)) writeJson(path.join(dir, 'fiyat', s + '.json'), map);
  const old = readJson(path.join(dir, 'fiyat-durum.json'), {});
  writeJson(path.join(dir, 'fiyat-durum.json'), { version: 1, lastRunAt: state.lastRunAt ?? null, lastRunSummary: state.lastRunSummary ?? null,
    rate: old.rate ?? null, problems: {} });
  invalidate(dataDir);
}

/** {items, lastRunAt, lastRunSummary, problems} */
function readPrices(dataDir) {
  const dir = dirOf(dataDir);
  const items = {};
  const fdir = path.join(dir, 'fiyat');
  if (fs.existsSync(fdir)) for (const f of fs.readdirSync(fdir).filter(f => /^\d{4}\.json$/.test(f)).sort()) Object.assign(items, readJson(path.join(fdir, f), {}));
  const status = readJson(path.join(dir, 'fiyat-durum.json'), {});
  return { items, lastRunAt: status.lastRunAt ?? null, lastRunSummary: status.lastRunSummary ?? null, problems: status.problems || {} };
}

/** Tek ürünün fiyat kaydını değiştirir (fn kaydı yerinde düzenler). */
function editPrice(dataDir, id, fn) {
  const file = path.join(dirOf(dataDir), 'fiyat', shardOf(id) + '.json');
  const map = readJson(file, {});
  fn(map[id]);
  writeJson(file, map);
  invalidate(dataDir);
}

function writeRate(dataDir, rate) { writeJson(path.join(dirOf(dataDir), 'kur.json'), rate); }

module.exports = { shardOf, writeConfig, readConfig, writePrices, readPrices, editPrice, writeRate };
