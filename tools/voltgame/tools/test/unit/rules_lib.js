'use strict';
// Kurallar ekibi birim testi yardımcıları: tarayıcı modüllerini (PX ile sarılı) ve Worker gövdesini Node'da yükler.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const REF2 = path.join(ROOT, 'tools', 'reference2');
const SRC2 = path.join(ROOT, 'tools', 'src2');
const S = require(path.join(REF2, 'sim2.js'));
const V = require(path.join(REF2, 'solve2.js'));

function allLevels() {
  const byId = new Map();
  const add = arr => { for (const lv of arr) { byId.delete(lv.id); byId.set(lv.id, lv); } };
  add(require(path.join(REF2, 'levels2.js')));
  const dir = path.join(REF2, 'levels');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => /\.js$/.test(f)).sort()) { try { const a = require(path.join(dir, f)); if (Array.isArray(a)) add(a); } catch (e) { console.warn('seviye dosyası yüklenemedi', f, e.message); } }
  // kural sürümü 4: henüz fiziksel dünyaya dönüştürülmemiş (kuralSurumu yok) seviyeler atlanır
  const all = [...byId.values()]; const v4 = all.filter(l => l.kuralSurumu === S.RULES_VERSION);
  if (v4.length < all.length && !allLevels.warned) { allLevels.warned = true; console.log(`  not: ${all.length - v4.length} seviye kural sürümü ${S.RULES_VERSION} değil (dönüştürülmeli), atlandı`); }
  return v4;
}
// Worker gövdesini Node'da yükle: require kabuğu + postMessage yakalayıcı
function loadWorker() {
  const src = fs.readFileSync(path.join(SRC2, 'core', 'worker_src.js'), 'utf8');
  const out = [];
  const req = n => { const k = String(n).replace(/^.*[\/]/, ''); if (k === 'sim2.js') return S; if (k === 'solve2.js') return V; throw new Error('modül yok ' + n); };
  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', 'postMessage', src + '\n;return typeof onmessage === "function" ? onmessage : null;');
  let deliver = null;
  const onmessage = fn(req, mod, mod.exports, msg => deliver ? deliver(msg) : out.push(msg));
  const waiting = new Map(); deliver = msg => { const w = waiting.get(msg.req); if (w) { waiting.delete(msg.req); w(msg); } else out.push(msg); };
  const sink = msg => { const w = waiting.get(msg.req); if (w) { waiting.delete(msg.req); w(msg); } else out.push(msg); };
  out.push = function (msg) { return Array.prototype.push.call(this, msg); };
  return { api: mod.exports, out, sinkRef: sink,
    send: m => { onmessage({ data: m }); return out.shift(); },                         // eşzamanlı yanıtlar (hint, drop, ping)
    request: m => new Promise(res => { const n0 = out.length; onmessage({ data: m }); if (out.length > n0) { const i = out.findIndex(x => x.req === m.req); if (i >= 0) return res(out.splice(i, 1)[0]); } waiting.set(m.req, res); }),
    _deliver: sink };
}
// tarayıcı modülünü sahte PX ile yükle (build sarmalayıcısıyla aynı: function(PX){'use strict'; …})
function loadModule(rel, PX) {
  const src = fs.readFileSync(path.join(SRC2, rel), 'utf8');
  new Function('PX', "'use strict';\n" + src)(PX);
  return PX;
}
function fakeBus() {
  const subs = new Map(); const log = [];
  return { log, on(t, f) { (subs.get(t) || subs.set(t, []).get(t)).push(f); return () => { const a = subs.get(t); a.splice(a.indexOf(f), 1); }; },
    once(t, f) { const off = this.on(t, p => { off(); f(p); }); return off; },
    emit(t, p) { log.push([t, p]); for (const f of (subs.get(t) || []).slice()) f(p, t); } };
}
let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; console.log('  FAIL ' + msg); } }
function done(name) { console.log(`${name}: ${passes} geçti, ${fails} başarısız`); if (fails) process.exitCode = 1; return fails; }
module.exports = { ROOT, REF2, SRC2, S, V, allLevels, loadWorker, loadModule, fakeBus, ok, done };
