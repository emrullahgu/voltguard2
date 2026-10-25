'use strict';

// Fabrika Senaryosu ortak hesap durumu (js/voltsim/calc/fabrika.js): trafo, pano ve kompanzasyon motorları aynı girdiden
// tutarlı sonuç üretmeli; yük aç/kapat tüm zinciri güncellemeli; A/B, göç, içe aktarma ve paylaşım kuralları korunmalı.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const E = require(path.join(root, 'js/voltsim/engine.js'));
const F = require(path.join(root, 'js/voltsim/calc/fabrika.js'));

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ': ' + a + ' ≠ ' + b + ' (±' + tol + ')');
const clone = o => JSON.parse(JSON.stringify(o));
const V = fn => { const s = F.defaults(); fn(s); return s; };
const byId = (s, id) => s.loads.find(l => l.id === id);
const st = (r, id) => (r.checks.find(c => c.id === id) || {}).status;

function loadModule() {
  let def = null;
  const fmt = (v, d, u) => (v === null || v === undefined || !isFinite(v) ? '—' : Number(v).toFixed(d === undefined ? 1 : d) + (u ? ' ' + u : ''));
  global.window = { VoltSimEngine: E, matchMedia: () => ({ matches: false }) };
  global.self = global.window;
  E.ext.fabrika = F;
  global.window.VoltSim = { E, fmt, fmtEnergy: v => fmt(v, 1, 'kWh'), esc: String, el: () => ({}), toast: () => {}, PALETTE: {}, sanitize: (t, s) => Object.assign(clone(t), s), register: d => { def = d; } };
  const file = path.join(root, 'js/voltsim/mod/fabrika.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return def;
}

test('varsayılan senaryo geçerli ve tüm ön kontroller uygun', () => {
  const r = F.evaluate(F.defaults());
  assert.ok(r.ok, r.errors.join('; '));
  const bad = r.checks.filter(c => c.status === 'fail' || c.status === 'warn').map(c => c.id + ' ' + c.detail);
  assert.deepEqual(bad, []);
  // 1000 kVA, 400 V trafo anma AG akımı ≈ 1443 A (VoltSim tanıtımındaki örnekle aynı)
  near(r.values.trafo.I2n, 1443.4, 0.5, 'I2n');
});

test('hesap zinciri tutarlı: yükler → kompanzasyon → ADP bara → trafo aynı sayıları görür', () => {
  for (const s of [F.defaults(), V(x => { byId(x, 'firin').on = true; }), V(x => { x.comp.mode = 'off'; }), V(x => { x.comp.detune = 0; })]) {
    const r = F.evaluate(s), v = r.values;
    assert.ok(r.ok);
    // yük toplamı = devredeki yüklerin elektriksel gücü
    near(v.load.P, s.loads.filter(l => l.on).reduce((a, l) => a + F.elec(l), 0), 1e-9, 'ΣP yük');
    // ADP bara P = yükler + kondansatör kayıpları (kademe başına ≈ 6 W/kVAr ayarlı, 3 W/kVAr reaktörsüz)
    near(v.bus.P - v.load.P, v.comp.Qon * (s.comp.detune > 0 ? 0.006 : 0.003), 1e-6, 'kondansatör kaybı');
    // kompanzasyon motorunun Q_net'i ile pano motorunun bara Q'su aynı
    near(v.bus.Q, v.comp.Qnet, 1e-6, 'Q_bara = Q_net');
    // trafo, bara görünür gücünü taşır
    near(v.trafo.S, Math.hypot(v.bus.P, v.bus.Q), 1e-6, 'S_trafo');
    near(v.trafo.k, v.trafo.S / s.trafo.Sr_kVA, 1e-12, 'K');
    // trafo kaybı P0 + Pk·K²
    near(v.trafo.losses, s.trafo.P0 + s.trafo.Pk * v.trafo.k * v.trafo.k, 1e-6, 'kayıp');
    // zincir tablosu aynı değerleri gösterir
    near(v.chain[2].P, v.bus.P, 1e-9); near(v.chain[3].P, v.bus.P, 1e-6);
    // otomatik kademe: hedefi (Qneed − 0) %2 toleransla aşmaz
    if (s.comp.mode === 'auto') assert.ok(v.comp.Qon <= v.comp.Qneed * 1.02 + 1e-9);
  }
});

test('bir yükü kapatmak ortak durumu günceller: P, akım, kademe ve trafo yüklenmesi birlikte değişir', () => {
  const a = F.evaluate(F.defaults());
  const b = F.evaluate(V(s => { byId(s, 'komp').on = false; }));
  const kw = F.elec(byId(F.defaults(), 'komp'));
  near(a.values.load.P - b.values.load.P, kw, 1e-9, 'ΔP = kompresör gücü');
  assert.ok(b.values.bus.I < a.values.bus.I, 'bara akımı azalır');
  assert.ok(b.values.trafo.k < a.values.trafo.k, 'trafo yüklenmesi azalır');
  assert.ok(b.values.comp.Qon <= a.values.comp.Qon, 'röle daha az (ya da aynı) kademe seçer');
  assert.equal(b.values.loads.find(x => x.id === 'komp').I, 0, 'kapalı çıkışın akımı sıfır');
  // olay metni için fark özeti
  assert.match(F.deltaText(F.summary(a), F.summary(b)), /P 671,8 → 556,0 kW/);
});

test('A/B karşılaştırma: aynı motor, aynı birim; aynı senaryo farksızdır, farklar yönüyle verilir', () => {
  const s = F.scenarioOf(F.defaults());
  const same = F.compare(s, clone(s));
  assert.ok(same.ok);
  same.rows.forEach(r => assert.equal(r.better, null, r.key));
  assert.deepEqual(same.diff, []);
  const b = F.scenarioOf(V(x => { x.trafo.Sr_kVA = 630; Object.assign(x.trafo, { P0: 540, Pk: 4600, uk: 4 }); }));
  const c = F.compare(s, b);
  const K = c.rows.find(r => r.key === 'K');
  assert.ok(K.b > K.a && K.better === 'A', 'küçük trafoda yüklenme artar');
  assert.ok(c.diff.includes('trafo.Sr_kVA'));
  assert.equal(c.rows.find(r => r.key === 'Pload').delta, 0, 'yük aynı');
});

test('rezonans: reaktörsüz banka sürücülü yüklerle büyür, ayarlı reaktör giderir', () => {
  const s0 = V(s => { s.comp.detune = 0; s.loads.push(F.newLoad({ id: 'ekst2', name: 'Ekstrüzyon 2', type: 'vfd', P_kW: 160, cos: 0.95, eff: 0.93, L: 75, S: 95, par: 2, In: 320 })); });
  const r0 = F.evaluate(s0);
  assert.equal(st(r0, 'komp.res'), 'fail');
  const s1 = clone(s0); s1.comp.detune = 7;
  const r1 = F.evaluate(s1);
  assert.notEqual(st(r1, 'komp.res'), 'fail');
  assert.ok(r1.values.comp.THDv < r0.values.comp.THDv);
});

test('gece: elle sabit kademeler tesisi kapasitife çeker; otomatik röle düzeltir', () => {
  const night = s => { s.loads.forEach(l => { l.on = ['isik', 'chiller', 'pompa'].includes(l.id); }); };
  const m = F.evaluate(V(s => { night(s); s.comp.mode = 'manual'; s.comp.manual = s.comp.steps.map(() => true); }));
  assert.ok(m.values.bus.Q < 0, 'kapasitif');
  assert.equal(st(m, 'komp.day'), 'fail');
  const a = F.evaluate(V(s => { night(s); }));
  assert.ok(a.values.bus.Q >= 0 && a.values.bus.pf >= 0.95);
});

test('çıkış önerisi (autoSize) koordinasyon ve gerilim düşümü ön kontrollerini sağlar', () => {
  const s = F.defaults();
  s.loads.forEach(l => { const z = F.autoSize(l, 400); l.In = z.In; l.S = z.S; l.par = z.par; l.on = true; });
  const r = F.evaluate(s);
  s.loads.forEach(l => ['coord', 'vd', 'ad'].forEach(k => assert.equal(st(r, 'load:' + l.id + '.' + k), 'ok', l.id + '.' + k)));
});

test('paylaşım: tesis adı ve not varsayılan olarak çıkarılır; arayüz tercihi taşınmaz', () => {
  const s = F.defaults(); s.facility.name = 'Gizli A.Ş.'; s.facility.note = 'özel';
  const a = F.anonymize(s);
  assert.equal(a.facility.name, ''); assert.equal(a.facility.note, ''); assert.ok(!('ui' in a));
  assert.equal(F.anonymize(s, true).facility.name, 'Gizli A.Ş.');
  assert.equal(F.anonymize(s, true).facility.note, '', 'not hiçbir durumda bağlantıya girmez');
});

test('uyumluluk: daha yeni şema reddedilir; diğer modül dosyaları ortak alanlarıyla aktarılır', () => {
  assert.throws(() => F.migrate({}, F.SCHEMA + 1), /daha yeni/);
  assert.deepEqual(F.migrate(F.defaults(), F.SCHEMA).notes, []);
  const t = F.importForeign({ module: 'trafo', state: { Sr_kVA: 1600, P0: 1080, Pk: 12000, uk: 6, U1_kV: 15.8, SkQ_MVA: 300, lossPrice: 4 } });
  assert.equal(t.state.trafo.Sr_kVA, 1600); assert.equal(t.state.supply.U1_kV, 15.8); assert.equal(t.state.facility.price, 4);
  assert.ok(t.notes.some(n => /Alınmadı/.test(n)));
  assert.ok(F.evaluate(t.state).ok);
  const k = F.importForeign({ module: 'komp', state: { steps: [10, 20, 40], detune: 14, cos2: 0.97, Sr_kVA: 630, uk: 4, mode: 'manual', manualOn: [true, false, true] } });
  assert.deepEqual(k.state.comp.steps, [10, 20, 40]); assert.deepEqual(k.state.comp.manual, [true, false, true]); assert.equal(k.state.trafo.P0, E.trafo.PRESETS[630].P0);
  const p = F.importForeign({ module: 'pano', state: { mainIn: 1000, circuits: [{ name: 'Pompa', phase: '3F', P_kW: 11, cos: 0.85, eff: 0.91, motor: true, running: true, on: true, In: 25, S: 6, L: 45 }, { name: 'Priz', phase: 'L1', P_kW: 2, cos: 0.9, In: 16, S: 2.5, L: 20 }, { name: 'Kond.', cap: true, P_kW: 20 }] } });
  assert.equal(p.state.loads.length, 2, 'kondansatör çıkışı yük olarak alınmaz');
  assert.equal(p.state.board.mainIn, 1000);
  assert.ok(p.notes.some(n => /tek fazlı/.test(n)));
  assert.equal(F.importForeign({ module: 'ges', state: {} }), null);
});

test('girdi hataları: yinelenen yük kimliği ve sınır dışı trafo gücü reddedilir', () => {
  const a = F.evaluate(V(s => { s.loads[1].id = s.loads[0].id; }));
  assert.ok(!a.ok && a.errors.some(e => /benzersiz/.test(e)));
  const b = F.evaluate(V(s => { s.trafo.Sr_kVA = 8000; }));
  assert.ok(!b.ok);
});

test('görevler amaçlanan çözümle çözülür (başlangıçta çözülmemiş olmaları voltsim-tasks testinde)', () => {
  const def = loadModule();
  const t = id => def.tasks.find(x => x.id === id);
  const run = (tk, fix) => { const s = Object.assign(F.defaults(), clone(tk.state || {})); fix(s); const r = def.compute(s); return tk.check(r, s, {}, { fab: null }); };
  assert.ok(run(t('firin'), s => { byId(s, 'firin').on = true; byId(s, 'chiller').on = false; }), 'fırın + soğutma grubu kapalı');
  assert.ok(!run(t('firin'), s => { byId(s, 'firin').on = true; byId(s, 'pres').on = false; byId(s, 'chiller').on = true; byId(s, 'cnc').on = true; }), 'kritik yük kapatılamaz');
  assert.ok(run(t('reaktif'), s => { s.comp.mode = 'auto'; }));
  assert.ok(run(t('rezonans'), s => { s.comp.detune = 7; }));
  assert.ok(run(t('gece'), s => { s.comp.mode = 'auto'; }));
  assert.ok(run(t('kablo'), s => { const c = byId(s, 'cnc'), z = F.autoSize(c, 400); c.In = z.In; c.S = z.S; c.par = z.par; }));
  // A/B görevi yalnız görev başladıktan sonra saklanan iki farklı trafo senaryosuyla tamamlanır
  const ab = t('ab'), s = F.defaults(), r = def.compute(s);
  const slot = (sr, at) => ({ at: at, state: Object.assign(F.scenarioOf(s), { trafo: Object.assign({}, s.trafo, { Sr_kVA: sr }) }) });
  assert.ok(!ab.check(r, s, {}, { fab: { taskStart: 100, ab: { A: slot(1000, 50), B: slot(1600, 150) } } }), 'eski A sayılmaz');
  assert.ok(ab.check(r, s, {}, { fab: { taskStart: 100, ab: { A: slot(1000, 120), B: slot(1600, 150) } } }));
});
