'use strict';
// Eski günlük kimliklerini v4 fiziksel saha varyantlarına taşır ve her adayı yeniden kanıtlar.
// node tools/reference2/migrate_daily4.js [çıktı.json] — varsayılan daily2.js (başarılı denetimden sonra).
const fs = require('fs');
const path = require('path');
const S = require('./sim2.js');
const TL = require('./talep2.js');
const VF = require('./verify2.js');
const LN = require('./lint2.js');

function campaign() {
  const byId = new Map();
  for (const f of [path.join(__dirname, 'levels2.js'), ...fs.readdirSync(path.join(__dirname, 'levels')).filter(f => /\.js$/.test(f)).sort().map(f => path.join(__dirname, 'levels', f))]) {
    for (const lv of VF.loadLevelFile(f)) byId.set(lv.id, lv);
  }
  return byId;
}

function transformMap(def, turns, mirror) {
  let layers = def.map.split('|').map(l => l.split('/').map(r => [...r]));
  if (mirror) layers = layers.map(rows => rows.map(row => row.slice().reverse().map(ch => ch === '>' ? '<' : ch === '<' ? '>' : ch)));
  for (let n = 0; n < turns; n++) layers = layers.map(rows => {
    const D = rows.length, W = rows[0].length, out = Array.from({ length: W }, () => Array(D));
    const turn = { '>': 'v', v: '<', '<': '^', '^': '>' };
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) out[x][D - 1 - z] = turn[rows[z][x]] || rows[z][x];
    return out;
  });
  return layers.map(rows => rows.map(row => row.join('')).join('/')).join('|');
}

function variant(old, source, index) {
  const lv = JSON.parse(JSON.stringify(source));
  const turns = (index % 3) + 1, mirror = index >= 3;
  const before = S.compile(source.def);
  lv.id = old.id; lv.def.id = old.id; lv.def.map = transformMap(source.def, turns, mirror);
  lv.kuralSurumu = S.RULES_VERSION; lv.gunluk = true; lv.sinif = 'gunluk'; lv.ogretici = false;
  lv.kaynakSeviye = source.id; lv.kaynak = `${source.id}: fiziksel saha, ${turns * 90}° dönüş${mirror ? ', ayna' : ''} (kural sürümü ${S.RULES_VERSION})`;
  lv.ogretir = `Günün Manevrası: ${source.ad}. Aynı devrenin fiziksel saha varyantında güvenli manevra programını kur.`;
  if (old.tarih !== undefined) lv.tarih = old.tarih;
  if (lv.isEmri) lv.isEmri.no = 'GM-' + old.id.slice(1);
  delete lv.no;
  const after = S.compile(lv.def);
  const mapCell = c => {
    let [x, y, z] = before.G.xyz(c), W = before.G.W, D = before.G.D;
    if (mirror) x = W - 1 - x;
    for (let n = 0; n < turns; n++) { [x, z] = [D - 1 - z, x]; [W, D] = [D, W]; }
    return after.G.idx(x, y, z);
  };
  const mapTokens = str => String(str).split(/\s+/).map(tok => /^g\d+$/.test(tok) ? 'g' + after.tileIdx[mapCell(before.tiles[+tok.slice(1)])] : tok).join(' ');
  for (const t of lv.talep || []) { t.id = t.id.replace(source.id, old.id); if (t.cozum !== undefined) t.cozum = mapTokens(t.cozum); }
  delete lv.kanit;
  return lv;
}

function main() {
  const byId = campaign(), seen = new Map(), out = [];
  const oldPool = require('./daily2.js');
  for (const old of oldPool) {
    // T6'nın 106255 durumu günlük sınırı 60000'i aşar; aynı trafo bakım ailesindeki T2 kullanılır.
    const source = byId.get(old.kaynakSeviye === 'T6' ? 'T2' : old.kaynakSeviye);
    if (!source || source.kuralSurumu !== S.RULES_VERSION) throw new Error(`${old.id}: güncel kaynak seviye yok`);
    const index = seen.get(source.id) || 0; seen.set(source.id, index + 1);
    const lv = variant(old, source, index), r = VF.compute(lv);
    lv.kanit = r.kanit;
    lv.talep = (lv.talep || []).map(t => TL.stampOne(r.a.L, r.a.Gr, t));
    if (lv.talep.some(t => !t)) throw new Error(`${lv.id}: optimizasyon talebi çözümsüz`);
    const bad = [...r.band, ...r.phys.bad, ...VF.checkClaims(lv, r.a, r.a.L), ...TL.check(lv, r.a.Gr), ...TL.sldLint(lv), ...LN.purpose(lv, r.a.L)];
    for (const field of ['cozum', 'cozumManevra', 'cozumKesinti']) bad.push(...VF.safetyAudit(r.a.L, lv.kanit[field]));
    if (bad.length) throw new Error(`${lv.id}: ${bad.join('; ')}`);
    out.push(lv); console.log(`${lv.id}: ${source.id}, ${lv.kanit.states} durum, optimum ${lv.kanit.opt.hamle} — doğrulandı`);
  }
  const destination = path.resolve(process.argv[2] || path.join(__dirname, 'daily2.js'));
  if (/\.json$/i.test(destination)) fs.writeFileSync(destination, JSON.stringify(out, null, 1) + '\n');
  else VF.writeLevelFile(destination, out);
  console.log(`${out.length} günlük fiziksel saha yazıldı: ${destination}`);
}

if (require.main === module) main();
module.exports = { transformMap, variant };
