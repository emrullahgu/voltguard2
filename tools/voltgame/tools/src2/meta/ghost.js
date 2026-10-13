// ============================================================================
// meta/ghost.js — PX.ghost : hayalet oynatma, meydan okuma kodu, Manevra Defteri (§2.14, §5.3, §24.4)
//                                                                               sahip: Kurallar
// Kod: PX2-<seviye>-<base64url(dizgi)>-<h.m.k.o>-r<RULES_VERSION>   (son ek kural sürümü; §24.4)
//      Sürüm eki olmayan (yalnız §5.3 biçimi) kodlar da kabul edilir ve şimdiki kurallarla doğrulanır.
//   PX.ghost.code(id, str, tot) -> string         PX.ghost.parse(metin|URL) -> {id, str, tot, rv} | null
//   PX.ghost.verify(kod) -> {ok, won, tot, id, str, rv, log, msg, reason, eski?}   asla istisna atmaz
//        Alıcı sim2.replay ile doğrular; geçersizse STR.dogrulanamadi; başka kural sürümü eski:true ile reddedilir.
//   PX.ghost.url(kod) -> http(s) altında '…#PX2-…' | null (file://'da URL parçası paylaşılmaz)
//   PX.ghost.incoming() -> location.hash içindeki kod | null
//   PX.ghost.defter(seviye|id, str) -> {ok, lines:[…], text}   numaralı Türkçe manevra günlüğü (describe)
//   PX.ghost.steps(L, str, from?) -> {ok, steps:[{tok,a,kind,before,after,c,path,walk,log}], tot, won, at?, err?}
//        path = karo hücreleri (fiziksel komşu), walk = sim2.walkPath adımları (merdiven/iskele dahil)
//   Kural sürümü 4 (fiziksel dünya): 'd+', 'd-', 'p' simgeleri yoktur; eski kodlar "eski kural sürümü" olarak işaretlenir.
//   PX.ghost.play(str, {from?, speed:1|2|4, id?, L?, demo?}) -> Promise<{done}|{cancelled}|{ok:false}>
//   PX.ghost.stop()   PX.ghost.playing
// Oynatma: PX.volti.ghost(true) bir hayalet rig tutamacı döndürürse ({place(c,v,s), followPath(cells,{view,rate,steps}),
// play(klip,{el,step}), cancel}) onu sürer;
// döndürmezse yalnız olay yayar: 'ghost:start' {n, speed, demo, id}, 'ghost:step' {i, n, kind, tok, path, log, before, after},
// 'ghost:end' {cancelled}. Oyunun mantıksal/sunum durumuna asla dokunmaz. Kare başına ayırma yok (zamanlayıcıyla ilerler).
// ============================================================================
const SIM = PX.SIM;
const RV = SIM.RULES_VERSION;
const CODE_RE = /PX2-([A-Za-z0-9_]{1,12})-([A-Za-z0-9_-]{0,27000})-(\d{1,6})\.(\d{1,6})\.(\d{1,7})\.(\d{1,4})(?:-r(\d{1,3}))?(?![A-Za-z0-9_-]|\.\d)/;
const KIND = { git: 'walk', op: 'op', kilit: 'lock', kilitac: 'unlock', degistir: 'fuse', bas: 'press', set: 'earth', calis: 'work', bekle: 'wait' };
const CLIP = { op: 'operate', earth: 'earth', lock: 'lock', unlock: 'unlock', fuse: 'fuse', press: 'press', work: 'work', wait: 'wait' };
const DUR = { op: 520, earth: 900, lock: 600, unlock: 600, fuse: 700, press: 300, work: 700, wait: 450 };
const P = { gen: 0, playing: false, timer: 0, wake: null, rig: null };

function dogrulanamadi() { return (PX.STR && PX.STR.dogrulanamadi) || SIM.ERR.dogrulanamadi; }
function b64u(s) {
  const b = new TextEncoder().encode(String(s)); let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/'); const pad = t.length % 4 ? '='.repeat(4 - t.length % 4) : '';
  const bin = atob(t + pad); const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(b);
}
function code(id, str, tot) {
  tot = tot || {};
  return 'PX2-' + id + '-' + b64u(String(str || '').trim()) + '-' + (tot.h | 0) + '.' + (tot.m | 0) + '.' + (tot.k | 0) + '.' + (tot.o | 0) + '-r' + RV;
}
function parse(c) {
  try {
    let txt = String(c == null ? '' : c);
    if (txt.length > 40000) return null;
    if (/%2D|%23/i.test(txt)) { try { txt = decodeURIComponent(txt); } catch (e) { /* olduğu gibi */ } }
    const m = CODE_RE.exec(txt); if (!m || (m.index > 0 && /[A-Za-z0-9_-]/.test(txt[m.index - 1]))) return null;
    const str = unb64u(m[2]);
    if (str.length > 20000 || /[^\x20-\x7e]/.test(str)) return null;
    return { id: m[1], str, tot: { h: +m[3], m: +m[4], k: +m[5], o: +m[6] }, rv: m[7] === undefined ? null : +m[7], code: m[0] };
  } catch (e) { return null; }
}
function findLevel(id) {
  const a = PX.LEVELS || [], b = PX.DAILY || [];
  for (let i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
  for (let i = 0; i < b.length; i++) if (b[i].id === id) return b[i];
  return null;
}
function bad(reason, extra) { return Object.assign({ ok: false, won: false, msg: dogrulanamadi(), reason }, extra || {}); }
function verify(c) {
  try {
    const p = parse(c); if (!p) return bad('bicim');
    if (p.rv !== null && p.rv !== RV) return bad('surum', { eski: true, rv: p.rv, id: p.id, msg: 'Bu kod başka bir kural sürümüne (sürüm ' + p.rv + ') ait; şimdiki kurallar sürüm ' + RV + '. ' + dogrulanamadi() });
    const lv = findLevel(p.id); if (!lv) return bad('seviye_yok', { id: p.id });
    let L; try { L = SIM.compile(lv.def); } catch (e) { return bad('derleme', { id: p.id }); }
    const r = SIM.replay(L, p.str);
    if (!r.ok) return bad('ret', { id: p.id, at: r.at, err: r.err });
    if (!r.won) return bad('kazanmiyor', { id: p.id });
    const t = r.tot;
    if (t.h !== p.tot.h || t.m !== p.tot.m || t.k !== p.tot.k || t.o !== p.tot.o) return bad('toplam', { id: p.id, tot: { h: t.h, m: t.m, k: t.k, o: t.o } });
    return { ok: true, won: true, id: p.id, str: p.str, rv: p.rv === null ? RV : p.rv, tot: { h: t.h, m: t.m, k: t.k, o: t.o }, log: r.log, level: lv, msg: '' };
  } catch (e) { return bad('hata'); }
}
function url(c) {
    try { if (!/^https?:$/.test(location.protocol)) return null; return location.origin + (PX.HOST && PX.HOST.sharePath ? PX.HOST.sharePath : location.pathname + location.search) + '#' + c; } catch (e) { return null; }
}
function incoming() { try { const p = parse(location.hash || ''); return p ? p.code : null; } catch (e) { return null; } }

// ---------------------------------------------------------------- zaman çizelgesi / defter
// fiziksel yol (sim2.walkPath): karo hücreleri + tam adım listesi (merdiven/iskele)
function walkPath(L, s, to) {
  const w = SIM.walkPath(L, s, to);
  if (!w) return { path: [s.p, to], walk: null };
  return { path: w.filter(x => x.k === 'karo').map(x => x.c), walk: w };
}
function steps(L, str, from) {
  const out = []; const tot = { h: 0, m: 0, k: 0, o: 0 };
  let s; try { s = from || SIM.initState(L); } catch (e) { return { ok: false, err: 'dogrulanamadi', steps: out, tot }; }
  const toks = typeof str === 'string' && str.trim() ? str.trim().split(/\s+/) : [];
  if (toks.length > 4000) return { ok: false, err: 'dogrulanamadi', steps: out, tot };
  for (const tok of toks) {
    let a, r;
    try { a = SIM.decodeAct(L, s, tok); if (!a) return { ok: false, at: tok, err: 'dogrulanamadi', steps: out, tot }; r = SIM.apply(L, s, a); }
    catch (e) { return { ok: false, at: tok, err: 'dogrulanamadi', steps: out, tot }; }
    if (r.err) return { ok: false, at: tok, err: r.err, msg: r.msg, steps: out, tot };
    const kind = a.t === 'op' && L.els[a.e].t === 'toprak' ? 'earth' : KIND[a.t];
    const wp = kind === 'walk' ? walkPath(L, s, a.to) : null;
    out.push({ tok, a, kind, before: s, after: r.s, c: r.c, path: wp ? wp.path : null, walk: wp ? wp.walk : null, log: SIM.describe(L, s, a, r) });
    tot.h += r.c.h; tot.m += r.c.m; tot.k += r.c.k; tot.o += r.c.o; s = r.s;
  }
  return { ok: true, steps: out, tot, won: SIM.won(L, s), s };
}
function defter(lv, str) {
  try {
    const level = typeof lv === 'string' ? findLevel(lv) : lv; if (!level || !level.def) return { ok: false, lines: [], text: '' };
    const L = SIM.compile(level.def); const tl = steps(L, str);
    const lines = []; for (const st of tl.steps) if (st.log) lines.push((lines.length + 1) + '. ' + st.log);
    const head = (level.id || '') + (level.ad ? ' — ' + level.ad : '') + ((PX.STR && PX.STR.defter) ? ' · ' + PX.STR.defter : '');
    const foot = 'Hamle ' + tl.tot.h + ' · Manevra ' + tl.tot.m + ' · Kesinti ' + tl.tot.k + ' · Olay ' + tl.tot.o;
    return { ok: tl.ok, won: !!tl.won, lines, tot: tl.tot, text: [head].concat(lines, [foot]).join('\n') };
  } catch (e) { return { ok: false, lines: [], text: '' }; }
}

// ---------------------------------------------------------------- oynatma
function wait(ms, gen) {
  return new Promise(res => {
    if (gen !== P.gen) return res();
    P.wake = res; P.timer = setTimeout(() => { P.timer = 0; P.wake = null; res(); }, ms);
  });
}
function clearWait() {
  if (P.timer) { clearTimeout(P.timer); P.timer = 0; }
  const w = P.wake; P.wake = null; if (w) w();
}
function rigOn() {
  try { const r = PX.volti && typeof PX.volti.ghost === 'function' ? PX.volti.ghost(true) : null; return r && typeof r === 'object' ? r : null; } catch (e) { return null; }
}
function rigOff() { try { if (P.rig && P.rig.cancel) P.rig.cancel(); if (PX.volti && typeof PX.volti.ghost === 'function') PX.volti.ghost(false); } catch (e) { /* yoksay */ } P.rig = null; }
function emit(t, p) { if (PX.bus) PX.bus.emit(t, p); }
function stop() {
  if (!P.playing) { P.gen++; return; }
  P.gen++; P.playing = false;
  clearWait();
  rigOff();
  emit('ghost:end', { cancelled: true });
}
async function play(str, opts) {
  opts = opts || {};
  stop();
  const gen = ++P.gen;
  let L = opts.L || null;
  if (!L && opts.id && (!PX.game || !PX.game.level || PX.game.level.id !== opts.id)) {
    const lv = findLevel(opts.id); if (!lv) return { ok: false, err: 'seviye_yok' };
    try { L = SIM.compile(lv.def); } catch (e) { return { ok: false, err: 'derleme' }; }
  }
  if (!L) L = PX.game && PX.game.L;
  if (!L) return { ok: false, err: 'seviye_yok' };
  const tl = steps(L, str, opts.from);
  if (!tl.ok) return { ok: false, err: tl.err, at: tl.at };
  const speed = opts.speed === 2 || opts.speed === 4 ? opts.speed : 1;
  P.playing = true; P.rig = rigOn();
  const n = tl.steps.length; const from = opts.from || (n ? tl.steps[0].before : tl.s);
  emit('ghost:start', { n, speed, demo: !!opts.demo, id: opts.id || (PX.game && PX.game.level ? PX.game.level.id : null) });
  const view = PX.game && typeof PX.game.camView === 'number' ? PX.game.camView : 0;     // yalnız görsel (kamera)
  try { if (P.rig && P.rig.place && from) P.rig.place(from.p, view, Object.assign({}, from, { v: view })); } catch (e) { /* yoksay */ }
  let failed = false;
  try {
  for (let i = 0; i < n && gen === P.gen; i++) {
    const st = tl.steps[i];
    emit('ghost:step', { i, n, kind: st.kind, tok: st.tok, path: st.path, walk: st.walk, log: st.log, before: st.before, after: st.after });
    let pr = null;
    try {
      // volti.js: followPath(cells, {view, rate, steps}), play(clip, {el, step:{a,before,after,c}})
      if (P.rig && st.kind === 'walk' && P.rig.followPath) pr = P.rig.followPath(st.path, { view: PX.game && typeof PX.game.camView === 'number' ? PX.game.camView : 0, rate: speed, speed, steps: st.walk });
      else if (P.rig && CLIP[st.kind] && P.rig.play) pr = P.rig.play(CLIP[st.kind], { el: st.a.e, step: { a: st.a, before: st.before, after: st.after, c: st.c }, rate: speed, speed });
    } catch (e) { pr = null; }
    if (pr && typeof pr.then === 'function') {
      try { await Promise.race([pr, wait(6000, gen)]); }
      finally { if (gen === P.gen) clearWait(); }
    }
    else await wait((st.kind === 'walk' ? Math.max(220, ((st.walk ? st.walk.length : st.path.length) - 1) * 200) : (DUR[st.kind] || 400)) / speed, gen);
  }
  if (gen !== P.gen) return { cancelled: true };
  if (opts.hold) await wait(500 / speed, gen);
  return gen === P.gen ? { done: true, n } : { cancelled: true };
  } catch (e) {
    failed = true;
    return gen === P.gen ? { ok: false, err: 'oynatma' } : { cancelled: true };
  } finally {
    if (gen === P.gen) {
      clearWait(); P.playing = false; rigOff();
      emit('ghost:end', { cancelled: failed });
    }
  }
}
PX.ghost = { code, parse, verify, url, incoming, defter, steps, play, stop, RULES_VERSION: RV, get playing() { return P.playing; } };
