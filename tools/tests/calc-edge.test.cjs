'use strict';
// Uç ve hatalı girdi testleri: sıfır, negatif, eksik (undefined/boş/metin), aşırı ve birbiriyle çelişkili girdiler.
// Beklenti: hata listesiyle "Veri eksik" durumu ya da açıklamalı uyarı; sessiz NaN/Infinity/negatif sonuç yok.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../js/voltsim/engine.js');
const cfg = require('../../js/calculator-config.js');
const P = require('../../js/voltsim/calc/pompa.js');
const I = require('../../js/voltsim/identity.js');
const C = cfg.calc;

/** values içindeki tüm sayılar sonlu olmalı (iç içe nesne/dizi taranır; null/sonsuz bilinçli alanlar hariç tutulabilir). */
function allFinite(obj, skip, path) {
  skip = skip || []; path = path || 'values';
  if (typeof obj === 'number') { assert.ok(Number.isFinite(obj), path + ' sonlu değil: ' + obj); return; }
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) if (!skip.includes(k)) allFinite(obj[k], skip, path + '.' + k);
}
const status = r => I.classify({ errors: r.ok ? [] : r.errors, checks: r.ok ? r.checks : [] }).code;

const TRAFO = { Sr_kVA: 630, U1_kV: 34.5, U2_V: 400, P0: 540, Pk: 4600, uk: 4, P_kW: 450, cos: 0.95, ambient: 25, SkQ_MVA: 500 };
const SARJ = { profile: 'AC11', capacity: 60, soc0: 20, soc1: 80, obcPhases: 3, obcI: 16, dcMax: 100, nPoints: 1, siteKW: 100, curve: 'typical' };
const KOMP = { U_LL: 400, P_kW: 320, cos1: 0.72, cos2: 0.99, Sr_kVA: 1000, uk: 6, detune: 7, steps: [10, 20, 40, 60, 60, 80], harmonics: { 5: 30, 7: 12 } };
const GES = { lat: 38.42, lon: 27.14, tilt: 15, azimuth: 0, Pmod: 540, nMod: 360, perString: 18, stringsPerMppt: 2, Voc: 49.9, Vmp: 41.6, Isc: 13.9, betaVoc: -0.27, betaVmp: -0.35, gamma: -0.35, noct: 45,
  Pac: 160, vdcMax: 1100, mpptMin: 200, mpptMax: 1000, iscMppt: 40, invEff: 98, dcLoss: 14, cloud: 0.1, pitch: 3.6, roofArea: 2400, month: 6, hour: 12, Ta: 28, Tmin: -3, Tmax: 40,
  price: 5, exportPrice: 3, capex: 4800000, consumption: 450000 };
const TOPR = { rho: 150, electrode: 'rod', L: 3, d: 0.02, n: 3, s: 6, Lstrip: 40, h: 0.8, w: 0.03, meshA: 400, meshD: 5, system: 'TT', IdN_mA: 300, UL: 50, IF: 150, tf: 0.5, rhoS: 3000, hs: 0.1 };
const with_ = (base, o) => Object.assign({}, base, o);

test('geçerli taban girdilerde tüm modüller sonlu sonuç verir', () => {
  for (const [name, r] of [['trafo', E.trafo.compute(TRAFO)], ['sarj', E.sarj.compute(SARJ)], ['komp', E.komp.compute(KOMP)], ['ges', E.ges.compute(GES)], ['topraklama', E.topraklama.compute(TOPR)]]) {
    assert.ok(r.ok, name + ': ' + r.errors.join(' | '));
    allFinite(r.values, ['payback', 'Em', 'Es', 'hRes', 'hPar', 'Xc'], name);
  }
});

test('trafo: sıfır, negatif, eksik, metin ve aşırı girdiler hata verir (Veri eksik)', () => {
  for (const bad of [{ Sr_kVA: 0 }, { Sr_kVA: -630 }, { Sr_kVA: undefined }, { Sr_kVA: '' }, { Sr_kVA: 'abc' }, { Sr_kVA: 1e9 }, { uk: 0 }, { cos: 0 }, { cos: 1.2 }, { P_kW: -1 }, { U2_V: NaN }]) {
    const r = E.trafo.compute(with_(TRAFO, bad));
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.errors.length > 0);
    assert.equal(status(r), 'veri-eksik');
  }
});

test('trafo: çelişkili girdiler (AG ≥ OG, uR ≥ uk) hata verir', () => {
  assert.equal(E.trafo.compute(with_(TRAFO, { U1_kV: 0.4, U2_V: 400 })).ok, false);
  // Pk/Sr = 40 000/630 000 = %6,35 ≥ uk %4 → fiziksel değil
  assert.equal(E.trafo.compute(with_(TRAFO, { Pk: 40000 })).ok, false);
});

test('trafo: sıfır yük sonlu sonuç verir (bölme hatası yok), aşırı yük incelemeye düşer', () => {
  const z = E.trafo.compute(with_(TRAFO, { P_kW: 0 }));
  assert.ok(z.ok); assert.equal(z.values.k, 0); assert.equal(z.values.eff, 0); allFinite(z.values);
  const over = E.trafo.compute(with_(TRAFO, { P_kW: 900 }));
  assert.equal(over.checks.find(c => c.id === 'load').status, 'fail');
  assert.equal(status(over), 'inceleme');
});

test('şarj: hedef SOC ≤ başlangıç (çelişkili), sıfır/negatif/eksik kapasite hata verir', () => {
  for (const bad of [{ soc1: 20 }, { soc0: 90, soc1: 80 }, { capacity: 0 }, { capacity: -60 }, { capacity: undefined }, { soc0: -5 }, { soc1: 120 }, { obcPhases: 2 }]) {
    const r = E.sarj.compute(with_(SARJ, bad));
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

test('şarj: çok düşük tesis gücünde süre sonlu, hedefe ulaşamazsa açıkça bildirilir', () => {
  const r = E.sarj.compute(with_(SARJ, { siteKW: 1, nPoints: 50, capacity: 250, soc0: 0, soc1: 100 }));
  assert.ok(r.ok);
  assert.ok(Number.isFinite(r.values.minutes));
  if (!r.values.finished) assert.ok(r.checks.some(c => c.id === 'finish' && c.status === 'warn'));
  assert.ok(r.values.Egrid >= r.values.Ebatt, 'şebeke enerjisi ≥ batarya enerjisi (kayıp ≥ 0)');
});

test('kompanzasyon: hedef cosφ mevcut değerin altında → uyarı, negatif kademe/kVAr önerilmez', () => {
  const r = E.komp.compute(with_(KOMP, { cos1: 0.95, cos2: 0.9 }));
  assert.ok(r.ok);
  assert.equal(r.checks.find(c => c.id === 'target').status, 'warn');
  assert.ok(r.values.Qneed < 0);
  assert.ok(r.values.steps.every(on => on === false), 'hiç kademe devreye alınmamalı');
  assert.ok(r.values.QcNom >= 0);
  // calculator-config: çelişki bayrağı ve geçersiz girdide NaN (sessiz sayı yok)
  assert.equal(C.compensation(100, 0.95, 0.9).contradictory, true);
  for (const bad of [[-1, 0.8, 0.95], [100, 0, 0.95], [100, 0.8, 1.2], [NaN, 0.8, 0.95], [undefined, 0.8, 0.95]]) assert.ok(Number.isNaN(C.compensation.apply(null, bad).Qc), JSON.stringify(bad));
  // cosφ = 1 → 1'e kompanzasyon gerekmez
  assert.equal(C.compensation(100, 1, 1).Qc, 0);
});

test('kompanzasyon: aralık dışı cosφ, negatif güç, metin kademe hata verir', () => {
  for (const bad of [{ cos1: 0 }, { cos1: 1.1 }, { cos2: 0.5 }, { P_kW: -10 }, { steps: [10, 'x'] }, { uk: 0 }, { harmonics: { 5: -5 } }]) {
    assert.equal(E.komp.compute(with_(KOMP, bad)).ok, false, JSON.stringify(bad));
  }
});

test('GES: Vmp ≥ Voc, MPPT alt ≥ üst, pozitif sıcaklık katsayısı ve aralık dışı enlem hata verir', () => {
  for (const bad of [{ Vmp: 50 }, { mpptMin: 1000, mpptMax: 200 }, { betaVoc: 0.3 }, { gamma: 0.1 }, { lat: 60 }, { nMod: 0 }, { Pmod: undefined }, { dcLoss: -1 }, { dcLoss: 50 }, { Pac: 0 }]) {
    assert.equal(E.ges.compute(with_(GES, bad)).ok, false, JSON.stringify(bad));
  }
});

test('GES: %14 kayıp değiştirilebilir bir varsayımdır — sonuç kayıpla doğru oranda değişir ve varsayım metni görünür', () => {
  const a = E.ges.compute(with_(GES, { dcLoss: 14 })), b = E.ges.compute(with_(GES, { dcLoss: 7 }));
  assert.ok(b.values.annual > a.values.annual);
  // kırpma yoksa P_AC ∝ (1 − kayıp): 0,93 / 0,86 = 1,0814 (kırpma oranı düşürebilir, artıramaz)
  assert.ok(b.values.annual / a.values.annual <= 0.93 / 0.86 + 1e-9);
  assert.ok(a.assumptions.some(t => /%14/.test(t) && /PVGIS/.test(t) && /inverter/i.test(t)));
  // kimlik: varsayılanda kalırsa "Varsayımsal" gerekçesi
  const id = I.byModule('ges');
  const reasons = I.assumedInputs(id, { dcLoss: 14, pvgisMonthly: null, Tmin: -3, Tmax: 40 }, { dcLoss: 14, pvgisMonthly: null, Tmin: -3, Tmax: 40 });
  assert.ok(reasons.some(r => /%14/.test(r)));
  assert.equal(I.assumedInputs(id, { dcLoss: 9, pvgisMonthly: [1], Tmin: -8, Tmax: 42 }, { dcLoss: 14, pvgisMonthly: null, Tmin: -3, Tmax: 40 }).length, 0);
});

test('topraklama: sıfır/negatif özdirenç, eksik sistem tipi, aşırı UL hata verir', () => {
  for (const bad of [{ rho: 0 }, { rho: -100 }, { rho: undefined }, { system: 'XX' }, { UL: 120 }, { IdN_mA: 0 }, { n: 0 }]) {
    assert.equal(E.topraklama.compute(with_(TOPR, bad)).ok, false, JSON.stringify(bad));
  }
});

test('pompa: tam hızda sağlanamayan profil satırı tasarrufa katılmaz ve uyarılır', () => {
  const base = { H0: 40, Qr: 200, Hr: 30, etaMax: 0.8, Qbep: 190, Hst: 8, Qd: 200, Hd: 30, etaM: 0.94, etaVfd: 0.97, mode: 'vfd', flowPct: 70, tariff: 3.2, vfdCost: 180000 };
  const ok = P.compute(with_(base, { profile: [[100, 1500], [80, 2500]] }));
  const mixed = P.compute(with_(base, { profile: [[100, 1500], [80, 2500], [120, 1000]] }));
  assert.ok(mixed.ok, (mixed.errors || []).join());
  assert.deepEqual(mixed.values.year.infeasible, [2]);
  assert.equal(mixed.values.year.saving, ok.values.year.saving, 'imkânsız satır tasarrufu değiştirmemeli');
  assert.ok(mixed.checks.some(c => c.id === 'profile' && c.status === 'warn'));
});

test('calculator-config: Türkçe sayı ayrıştırıcı eksik/hatalı metni NaN yapar; akım fonksiyonları sıfırda sonlu', () => {
  for (const raw of ['', '  ', 'abc', '1,2,3', 'Infinity', '1e3', null, undefined]) assert.ok(Number.isNaN(C.parseTr(raw)), String(raw));
  assert.equal(C.parseTr('-5'), -5); // negatif ayrıştırılır; sayfalar positive/min ile reddeder
  assert.equal(C.transformerCurrent(0, 400, 3), 0);
  assert.equal(C.loadCurrent(0, 400, 3, 0.9, 0.9), 0);
  assert.equal(cfg.ui.statusOf({ rows: [['a', 'b', 'is-over']] }), 'inceleme');
  assert.equal(cfg.ui.statusOf({ rows: [['a', 'b', 'is-ok']] }), 'hesaplandi');
  assert.equal(cfg.ui.statusOf({ status: 'varsayimsal', rows: [] }), 'varsayimsal');
});

test('sonuç durumları ayrıdır ve öncelik sırasıyla belirlenir', () => {
  assert.equal(I.classify({ errors: ['x'], checks: [{ status: 'fail', label: 'a' }], assumed: ['y'] }).code, 'veri-eksik');
  const rv = I.classify({ errors: [], checks: [{ status: 'warn', label: 'a' }], assumed: ['y: örnek'] });
  assert.equal(rv.code, 'inceleme'); assert.deepEqual(rv.assumed, ['y: örnek'], 'varsayım bilgisi kaybolmaz');
  assert.equal(I.classify({ errors: [], checks: [{ status: 'ok', label: 'a' }, { status: 'info', label: 'b' }], assumed: ['y'] }).code, 'varsayimsal');
  assert.equal(I.classify({ errors: [], checks: [{ status: 'ok', label: 'a' }] }).code, 'hesaplandi');
  assert.equal(I.classify({}).code, 'hesaplandi');
  const labels = I.ORDER.map(c => I.STATUS[c].label);
  assert.deepEqual(labels, ['Veri eksik', 'Mühendis incelemesi gerekli', 'Varsayımsal', 'Hesaplandı']);
  assert.equal(new Set(labels).size, 4);
});
