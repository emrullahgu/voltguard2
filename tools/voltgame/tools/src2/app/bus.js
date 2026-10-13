// ============================================================================
// app/bus.js — PX.bus : olay veriyolu (§18.3)                    sahip: Çekirdek
// Olay türleri ve yükleri README.md "Olaylar" tablosunda. Yükler yalnız komut/olay anında oluşur
// (kare başına emit YOK). Dinleyici istisnası diğer dinleyicileri durdurmaz (console.error).
//   PX.bus.on(type, fn) -> off()      PX.bus.once(type, fn) -> off()      PX.bus.off(type, fn)
//   PX.bus.emit(type, payload)        PX.bus.recent(n) -> [{t,type,cmd,err,kind}]  (test/hata ayıklama)
//   type '*' : her olayı (payload, type) ile alır
// ============================================================================
const subs = new Map();
const LOG_MAX = 256;
const log = new Array(LOG_MAX); let logN = 0;

function on(type, fn) {
  let a = subs.get(type); if (!a) { a = []; subs.set(type, a); }
  a.push(fn);
  return () => off(type, fn);
}
function off(type, fn) {
  const a = subs.get(type); if (!a) return;
  const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
}
function once(type, fn) {
  const h = (p, t) => { off(type, h); fn(p, t); };
  return on(type, h);
}
function call(a, payload, type) {
  if (!a || !a.length) return;
  const list = a.slice();                              // bu olayın dinleyicileri; eklemeler sonraki olaya aittir
  for (let i = 0; i < list.length; i++) {
    try { list[i](payload, type); } catch (e) { console.error('[PX.bus] ' + type + ' dinleyicisi hata verdi:', e); }
  }
}
function emit(type, payload) {
  log[logN % LOG_MAX] = { t: performance.now(), type, cmd: payload && payload.cmd ? payload.cmd.t : undefined,
    err: payload && payload.err, kind: payload && payload.kind };
  logN++;
  call(subs.get(type), payload, type);
  if (type !== '*') call(subs.get('*'), payload, type);
}
function recent(n) {
  n = n === undefined ? LOG_MAX : Math.max(0, Math.floor(Number(n) || 0));
  n = Math.min(n, LOG_MAX, logN); const out = [];
  for (let i = logN - n; i < logN; i++) out.push(log[i % LOG_MAX]);
  return out;
}
PX.bus = { on, off, once, emit, recent };
