'use strict';

// VoltSim modülleri: tanımlar tarayıcısız yüklenir; senaryo ve görev başlangıç durumları geçerli hesap üretmeli,
// hiçbir görev başlangıçta kendiliğinden çözülmüş olmamalı ve her görevin ipucu/hedef metni bulunmalı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const E = require(path.join(root, 'js/voltsim/engine.js'));

function loadModule(id) {
  let def = null;
  const fmt = (v, d, u) => (v === null || v === undefined || !isFinite(v) ? '—' : Number(v).toFixed(d === undefined ? 1 : d) + (u ? ' ' + u : ''));
  global.window = { VoltSimEngine: E, matchMedia: () => ({ matches: false }) };
  global.self = global.window;
  const calc = path.join(root, 'js/voltsim/calc', id + '.js');
  if (fs.existsSync(calc)) { E.ext = E.ext || {}; E.ext[id] = require(calc); }
  global.window.VoltSim = { E, fmt, fmtPower: v => fmt(v / 1000, 1, 'kW'), fmtEnergy: v => fmt(v, 1, 'kWh'), fmtDuration: v => fmt(v, 0, 'dk'), esc: String, el: () => ({}), toast: () => {}, PALETTE: {}, reduceMotion: false, register: d => { def = d; } };
  const file = path.join(root, 'js/voltsim/mod', id + '.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return def;
}

const ids = fs.readdirSync(path.join(root, 'js/voltsim/mod')).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3));

for (const id of ids) {
  test('VoltSim ' + id + ': varsayılan, senaryolar ve görevler', () => {
    const def = loadModule(id);
    assert.ok(def, 'modül kaydoldu');
    const fake = st => ({ state: st, live: def.initLive ? def.initLive(st) : {}, validResult: null, simTime: 0 });
    const run = st => { const app = fake(st); const r = def.compute(st, app); app.validResult = r; return { r, app }; };
    const base = run(JSON.parse(JSON.stringify(def.defaults())));
    assert.ok(base.r.ok, 'varsayılan geçerli: ' + (base.r.errors || []).join('; '));
    assert.ok((def.scenarios || []).length >= 4, 'en az 4 senaryo');
    for (const sc of def.scenarios) {
      const st = Object.assign(JSON.parse(JSON.stringify(def.defaults())), JSON.parse(JSON.stringify(sc.state || {})));
      if (sc.apply) sc.apply(st);
      const { r } = run(st);
      assert.ok(r.ok, 'senaryo ' + sc.id + ': ' + (r.errors || []).join('; '));
    }
    const tasks = def.tasks || [];
    assert.ok(tasks.length >= 4, 'en az 4 görev (' + tasks.length + ')');
    const seen = new Set();
    for (const tk of tasks) {
      assert.ok(tk.id && !seen.has(tk.id), 'görev kimliği benzersiz: ' + tk.id); seen.add(tk.id);
      assert.ok(tk.title && tk.goal && tk.hint, 'görev metni eksiksiz: ' + tk.id);
      const st = Object.assign(JSON.parse(JSON.stringify(def.defaults())), JSON.parse(JSON.stringify(tk.state || {})));
      const { r, app } = run(st);
      assert.ok(r.ok, 'görev ' + tk.id + ' başlangıç durumu geçerli: ' + (r.errors || []).join('; '));
      assert.equal(!!tk.check(r, st, app.live, app), false, 'görev ' + tk.id + ' başlangıçta çözülmüş olmamalı');
    }
  });
}
