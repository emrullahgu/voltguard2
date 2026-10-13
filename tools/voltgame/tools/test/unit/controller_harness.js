'use strict';
// ============================================================================
// tools/test/unit/controller_harness.js — controller ekibinin birim testleri için ortak düzenek (Node, tarayıcısız)
// Gerçek modüller: sim2.js (kurallar), app/bus.js, app/strings.js, game/controller.js, input/gesture.js,
// input/keyboard.js — build'deki gibi (function(PX){'use strict'; …})(PX) sarmalıyla vm içinde yüklenir.
// Sahte modüller: render (animate = elle çözülen Promise), camera, volti (legEnd/retarget isteğe bağlı), TW,
// solver, store, diorama, fx, hud, flow. Zamanlayıcılar sahte (advance(ms)).
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC2 = path.join(ROOT, 'tools', 'src2');
const REF2 = path.join(ROOT, 'tools', 'reference2');
const SIM = require(path.join(REF2, 'sim2.js'));

function loadLevels() {
  const byId = new Map();
  for (const l of require(path.join(REF2, 'levels2.js'))) byId.set(l.id, l);
  const dir = path.join(REF2, 'levels');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
    try { const a = require(path.join(dir, f)); if (Array.isArray(a)) for (const l of a) byId.set(l.id, l); } catch (e) { /* başka ekibin yarım dosyası */ }
  }
  return [...byId.values()].filter(l => l.bolum >= 0 && l.bolum <= 3);
}

function makeEnv(opts = {}) {
  opts = Object.assign({ volti: 'retarget', levels: null }, opts);
  // ---- sahte zaman
  let clock = 1000; const timers = [];
  let tid = 0;
  const setTimeout_ = (fn, ms) => { const id = ++tid; timers.push({ id, at: clock + (ms || 0), fn }); return id; };
  const clearTimeout_ = id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const advance = ms => { const end = clock + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); clock = t.at; t.fn(); } clock = end; };
  const perf = { now: () => clock };
  // ---- sahte pencere (klavye)
  const winL = {};
  const window_ = { addEventListener(t, fn) { (winL[t] = winL[t] || []).push(fn); }, innerWidth: 375, innerHeight: 667 };
  const PX = { SIM, LEVELS: opts.levels || loadLevels(), DAILY: [] };
  const ctx = vm.createContext({ PX, console, Promise, Math, JSON, Object, Array, Map, Set, Int16Array, Int32Array, Uint8Array, Float64Array, Float32Array,
    Error, String, Number, Boolean, isNaN, setTimeout: setTimeout_, clearTimeout: clearTimeout_, performance: perf, window: window_ });
  const load = rel => { const src = fs.readFileSync(path.join(SRC2, rel), 'utf8'); vm.runInContext(`(function (PX) { 'use strict';\n${src}\n})(PX);`, ctx, { filename: rel }); };
  load('app/bus.js'); load('app/strings.js');
  const ev = []; PX.bus.on('*', (p, t) => ev.push({ t, p }));
  // ---- sahte render/kamera/volti
  const anims = []; const syncs = []; const camCalls = []; const hl = [];
  const V = { leg: -1, retargets: [], cancels: 0, plays: [] };
  PX.render = {
    instant: false, L: null,
    setLevel(L, s) { this.L = L; syncs.push(s); },
    sync(s) { syncs.push(s); },
    animate(step) {
      if (this.instant) { this.sync(step.after); return Promise.resolve({ cancelled: false }); }
      return new Promise(res => anims.push({ step, res }));
    },
  };
  const H = Math.PI / 2;
  PX.camera = {
    az: Math.PI / 4, v: 0, azVel: 0, EL: Math.atan(1 / Math.SQRT2), w: 375, h: 667, _busy: false, dragging: false, az0: 0,
    azOf: v => Math.PI / 4 + H * v,
    nearAz(v, ref) { const a = Math.PI / 4 + H * v; return a + Math.round((ref - a) / (2 * Math.PI)) * 2 * Math.PI; },
    busy() { return this._busy || this.dragging; },
    snapTo(v, o) { camCalls.push(['snap', v, o && o.vel]); this.v = v & 3; return Promise.resolve({ cancelled: false }); },
    grab() { camCalls.push(['grab']); this.dragging = true; this.az0 = this.az; this._busy = false; },
    drag(dx) { camCalls.push(['drag', dx]); this.az = this.az0 - dx * H / Math.max(180, Math.min(0.45 * Math.min(this.w, this.h), 260)); },
    release(vx) { camCalls.push(['release', vx]); this.dragging = false; return 0; },
    pick(x, y) { return this._pick ? this._pick(x, y) : { kind: 'none', cell: -1, el: -1, U: 0, V: 0, tri: 0 }; },
    worldToClient(x, y, z, out) { out = out || {}; out.x = x; out.y = y; return out; },
  };
  PX.volti = { cancel() { V.cancels++; }, play(c) { V.plays.push(c); return Promise.resolve({ cancelled: false }); }, probe() { return { cell: V.cell === undefined ? -1 : V.cell }; },
    get moving() { return !!V.moving; } };
  if (opts.volti === 'retarget') { PX.volti.legEnd = () => V.leg; PX.volti.retarget = p => { V.retargets.push(p.slice()); return true; }; }
  PX.TW = { cancelAll() {}, cancel() { return 0; }, add() { return Promise.resolve({ cancelled: false }); } };
  PX.solver = { dist: () => null, load: () => Promise.resolve({ states: 0, ms: 0 }) };
  const wins = []; PX.store = { recordWin(id, tot, g) { wins.push({ id, tot, g }); } };
  PX.diorama = { highlight(c) { hl.push(c); } };
  PX.fx = { ripple() {} };
  PX.hud = { _chips: [], chips() { return this._chips; } };
  PX.flow = { previews: [], preview(p) { this.previews.push(p); } };
  const tick = () => new Promise(r => setImmediate(r));
  // sıradaki animasyonu bitir (FIFO sırasıyla); sonra mikro görevleri boşalt
  async function finishAnim(n = 1) { for (let i = 0; i < n; i++) { const a = anims.shift(); if (!a) break; a.res({ cancelled: false }); await tick(); await tick(); } }
  async function drain(max = 500) { for (let i = 0; i < max && anims.length; i++) await finishAnim(1); await tick(); }
  return { PX, ctx, load, ev, anims, syncs, camCalls, hl, V, wins, advance, clock: () => clock, winL, tick, finishAnim, drain,
    events: t => ev.filter(e => e.t === t).map(e => e.p), clearEv() { ev.length = 0; } };
}

// küçük test çatısı
function suite(name) {
  const res = { name, pass: 0, fail: 0, errs: [] };
  const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
  async function test(title, fn) {
    if (only && title.indexOf(only) < 0) return;
    try { await fn(); res.pass++; console.log('  ok   ' + title); }
    catch (e) { res.fail++; res.errs.push(title + ': ' + (e && e.message)); console.log('  FAIL ' + title + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
  }
  return { test, res };
}
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || 'eşit değil') + ': ' + A + ' != ' + B); }
function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }

module.exports = { makeEnv, suite, eq, ok, SIM, loadLevels, ROOT };
