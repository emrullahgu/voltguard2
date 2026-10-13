// ============================================================================
// core/solverClient.js — PX.solver : Worker yaşam döngüsü, istek/yanıt, eski sonuç koruması (§12.8)
//                                                                               sahip: Kurallar
// Ana iş parçacığında çözücü YOK: yalnız O(1) tablo okuması (açık adresli tipli hash -> Uint8/Uint16 tablolar).
// Worker satır içi Blob'dan (file:// çalışır), PX.WORKER_SRC = sim2 + solve2 + core/worker_src.js.
//   PX.solver.load(levelId, def) -> Promise<{states, ms, cached}|null>   (eski/iptal edilen yükleme null döner)
//   PX.solver.dist(s) -> number | -1 (çıkmaz) | null (hazır değil)      Hamle uzaklığı (lamba)
//   PX.solver.distM(s, metrik) -> {p, s} | -1 | null                    metrik: hamle|manevra|kesinti|olay
//                                        (birincil, ikincil): hamle=(Hamle,Manevra) manevra=(Manevra,Hamle)
//                                        kesinti=(Kesinti,Hamle) olay=(Olay,Hamle) — kalan en iyi değer
//   PX.solver.hint(s, tier, metrik?) -> Promise<{tier, metric, acts:[simge], plan:[simge], why, dead, stale?, busy?, el?}>
//                                        acts = sıradaki segment (gezinme + tek eylem), plan = hedefe kadar optimal plan
//   PX.solver.abstractHint(s) -> {el:id|null, tok, why, abstract:true, partial?, later?}  ana iş parçacığı, ≤ 12 ms/çağrı;
//                                        bitmezse partial:true + later:Promise<sonuç|null> (arka planda ≤ 6 ms dilimlerle sürer),
//                                        yalnız elektrik soyutlaması (konum yok sayılır); asla "Çıkmaz" demez
//   PX.solver.prefetch(levelId, def) -> Promise   sonraki seviyeyi boşta hesaplar (kazanınca otomatik)
//   PX.solver.ready  PX.solver.status ('idle'|'busy'|'ready'|'error')  PX.solver.info()  PX.solver.stats()  PX.solver.cancel()
//   PX.solver.flush()  önbellekleri boşaltır (bellek baskısı / test)
// Olaylar: 'solver:ready' {id, states, ms, wms, cached}   'solver:error' {id, code, msg}
// Eski sonuç koruması: her yükleme bir kuşak (gen) taşır; yanıtın kuşağı güncel değilse sonucu yalnız önbelleğe alınır,
// söz null ile çözülür. İpucu yanıtları istek anındaki seviye kuşağıyla eşleşmezse {stale:true}.
// İptal: Worker işi ≤ 12 ms'lik dilimlerle yürütür; yeni seviye yüklenince süren iş Worker içinde bırakılır (eski istek
// 'iptal' ile döner) — terminate() YOK, JIT sıcak kalır (soğuk Worker headless Chrome'da 3–10× yavaş; §12.8'den sapma,
// rapor edildi). Bekçi: etkin yükleme 30 s'de bitmezse Worker yoklanır (ping); 5 s'de yanıt yoksa sonlandırılıp yeniden
// kurulur (asılı kalma sigortası; yalnız yavaş olan Worker'a dokunulmaz).
// Ön ısıtma: Worker modül yüklenirken (ilk seviye yüklemesinden önce) oluşturulur; betik ayrıştırması açılışla örtüşür.
// ============================================================================
const SIM = PX.SIM;
const METRICS = ['hamle', 'manevra', 'kesinti', 'olay'];
const CACHE_MAX = 4, CACHE_BYTES = 16 * 1048576;
const C = {
  worker: null, url: null, req: 0, pending: new Map(), loadsInWorker: 0,
  id: null, def: null, gen: 0, L: null, tab: null, status: 'idle', err: null,
  cache: new Map(), log: [], inited: false,
};

// ---------------------------------------------------------------- hash (worker_src.js ile aynı)
function epoch() { return performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now(); }
function hslot(k, mask) {
  const lo = k % 4294967296, hi = (k - lo) / 4294967296;
  let h = Math.imul(lo | 0, 0x9E3779B1) ^ Math.imul((hi | 0) + 0x632BE5AB, 0x85EBCA77);
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12;
  return h & mask;
}
function indexOf(T, k) {
  const hk = T.hk, mask = T.mask; let h = hslot(k, mask);
  for (;;) { const x = hk[h]; if (x === -1) return -1; if (x === k) return T.hv[h]; h = (h + 1) & mask; }
}
function stateIndex(s) {
  if (!C.tab || !C.L || !s) return -1;
  let k; try { k = SIM.key(C.L, s); } catch (e) { return -1; }
  return (k >= 0 && k === k) ? indexOf(C.tab, k) : -1;
}

// ---------------------------------------------------------------- Worker
function init() {
  if (C.inited) return; C.inited = true;
  if (PX.bus) PX.bus.on('win', p => { try { prefetchNext(p && p.id); } catch (e) { /* yoksay */ } });
}
function ensureWorker() {
  if (C.worker) return C.worker;
  // The hosted site serves the complete solver from its own origin; the single-file
  // download keeps the original embedded worker and works without a server.
  if (!C.url) C.url = PX.HOST && PX.HOST.workerUrl
    ? new URL(PX.HOST.workerUrl, location.href).href
    : URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
  const w = new Worker(C.url);
  w.onmessage = e => onMsg(e.data);
  w.onerror = e => {
    if (C.worker !== w) return;
    console.error('[PX.solver] worker hatası', e.message || e);
    failAll('worker hatası: ' + (e.message || ''));
    w.terminate(); C.worker = null; C.loadsInWorker = 0;
  };
  C.worker = w; C.loadsInWorker = 0;
  return w;
}
// Worker kaynağı. Build sim2'yi worker.lib'den çıkarırsa (boyut: sim2 iki kez gömülmesin, _requests/rules.md),
// sim2 ana betiğin //#SIM2-BEGIN…END bölgesinden geri kurulur (PX.SIM = -> module.exports =).
function workerSource() {
  const src = PX.WORKER_SRC || '';
  if (src.indexOf('__defs["sim2.js"]') >= 0) return src;
  const NL = String.fromCharCode(10);
  const i = src.indexOf(NL + '// ---- '); const sim = i >= 0 ? sim2FromPage() : null;
  if (!sim) return src;
  return src.slice(0, i) + NL + '__defs["sim2.js"] = function (module, exports, require) {' + NL + sim + NL + '};' + src.slice(i);
}
function sim2FromPage() {
  try {
    const NL = String.fromCharCode(10), list = document.scripts;
    for (let k = 0; k < list.length; k++) {
      const t = list[k].textContent || ''; const a = t.indexOf('//#SIM2-BEGIN'); if (a < 0) continue;
      const b = t.indexOf('//#SIM2-END', a); if (b < 0) return null;
      const lines = t.slice(a, b).split(NL); const end = lines.lastIndexOf('})(window.PX);'); if (end < 2) return null;
      // build: safeScript '</script' -> '<\/script', '<!--' -> '<\!--' (geri çevrilir)
      return lines.slice(2, end).join(NL).replace(/^PX\.SIM = /m, 'module.exports = ').replace(/<\\\/(script)/gi, '</$1').replace(/<\\!--/g, '<!--');
    }
  } catch (e) { /* yoksay */ }
  return null;
}
function failAll(msg) {
  clearTimeout(C.dog);
  const list = [...C.pending.values()]; C.pending.clear();
  for (const p of list) p.resolve(null);
  if (C.status === 'busy') { C.status = 'error'; C.err = msg; if (PX.bus) PX.bus.emit('solver:error', { id: C.id, code: 'hata', msg }); }
}
function restartWorker() {
  clearTimeout(C.dog);
  if (C.worker) { C.worker.terminate(); C.worker = null; }
  const list = [...C.pending.values()]; C.pending.clear();
  for (const p of list) p.resolve(null);
}
function cancel() { restartWorker(); C.tab = null; C.status = 'idle'; }
function flush() { C.cache.clear(); if (C.worker) send({ t: 'drop' }, { kind: 'drop' }); }
function send(msg, meta, transfer) {
  const req = ++C.req; msg.req = req;
  return new Promise(resolve => {
    C.pending.set(req, Object.assign({ resolve, t0: performance.now(), e0: epoch() }, meta || {}));
    try { ensureWorker().postMessage(msg, transfer || []); }
    catch (e) { failAll('worker başlatılamadı: ' + (e.message || e)); restartWorker(); }
  });
}
function busyLoad() { for (const p of C.pending.values()) if (p.kind === 'load' || p.kind === 'prefetch' || p.kind === 'use') return p; return null; }

function onMsg(m) {
  const p = C.pending.get(m.req); if (!p) return;              // iptal edilmiş istek: atılır
  C.pending.delete(m.req);
  if (m.t === 'ready') {
    const T = adoptMsg(m, p);
    cachePut(T);
    if (p.kind === 'load' && p.gen === C.gen && m.id === C.id) { activate(T); p.resolve({ states: T.states, ms: T.wall, cached: false }); }
    else p.resolve(p.kind === 'prefetch' ? { states: T.states, ms: T.wall, prefetch: true } : null);
  } else if (m.t === 'error') {
    if (m.code !== 'iptal') console.warn('[PX.solver]', m.id, m.code, m.msg);
    if (p.kind === 'load' && p.gen === C.gen && m.id === C.id) { C.status = 'error'; C.err = m.msg; if (PX.bus) PX.bus.emit('solver:error', { id: m.id, code: m.code, msg: m.msg }); }
    p.resolve(null);
  } else p.resolve(m);
}
function adoptMsg(m, p) {
  const wall = performance.now() - p.t0;
  const T = { id: m.id, def: p.def, states: m.states, edges: m.edges, goals: m.goals, dead: m.dead, cap: m.cap, mask: m.cap - 1, hk: m.hk, hv: m.hv, dH: m.dH, tab: m.tab,
    wall, wms: m.ms.total, ms: m.ms, bytes: m.hk.byteLength + m.hv.byteLength + m.dH.byteLength + 4 * m.states * 4 };
  C.log.push({ id: m.id, kind: p.kind, states: m.states, edges: m.edges, wall: Math.round(wall), worker: Math.round(m.ms.total), explore: Math.round(m.ms.explore), tables: Math.round(m.ms.tables),
    cold: p.cold, workerCached: !!m.cached,
    queue: m.ms.start ? Math.round(m.ms.start - p.e0) : null,          // istekten Worker'da işin başlamasına (Worker açılışı + kuyruk)
    deliver: m.post ? Math.round(epoch() - m.post) : null,            // Worker'ın gönderiminden ana iş parçacığının almasına
    slices: m.ms.slices });
  if (C.log.length > 64) C.log.shift();
  return T;
}
function activate(T) {
  C.tab = T; C.status = 'ready'; C.err = null;
  if (PX.bus) PX.bus.emit('solver:ready', { id: T.id, states: T.states, ms: Math.round(T.wall), wms: Math.round(T.wms), cached: !!T.fromCache });
}
// ---------------------------------------------------------------- önbellek (LRU, bayt sınırlı)
function sameDef(a, b) { if (a === b) return true; try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } }
function cacheGet(id, def) { const T = C.cache.get(id); if (!T || !sameDef(T.def, def)) return null; C.cache.delete(id); C.cache.set(id, T); return T; }
function cachePut(T) {
  C.cache.delete(T.id); C.cache.set(T.id, T);
  let bytes = 0; for (const x of C.cache.values()) bytes += x.bytes;
  while (C.cache.size > CACHE_MAX || (bytes > CACHE_BYTES && C.cache.size > 1)) {
    const k = C.cache.keys().next().value; if (C.tab && C.tab.id === k && C.cache.size > 1) { const x = C.cache.get(k); C.cache.delete(k); C.cache.set(k, x); continue; }
    bytes -= C.cache.get(k).bytes; C.cache.delete(k);
  }
}

// ---------------------------------------------------------------- yükleme
function compileFor(def) {
  if (PX.game && PX.game.L && PX.game.L.def === def) return PX.game.L;           // kontrolcünün derlemesini yeniden kullan
  try { return SIM.compile(def); } catch (e) { return null; }
}
function load(levelId, def) {
  init();
  const gen = ++C.gen;
  C.id = levelId; C.def = def; C.tab = null; C.status = 'busy'; C.err = null;
  C.L = compileFor(def);
  abReset();
  if (!C.L) { C.status = 'error'; C.err = 'derleme'; return Promise.resolve(null); }
  const hit = cacheGet(levelId, def);
  if (hit) {
    hit.fromCache = true; hit.wall = 0;
    // Worker grafı (ipuçları için) sıcak tutulur; yoksa sessizce yeniden kurulur (sıra korunur: ipucu ondan sonra işlenir)
    if (!busyLoad()) send({ t: 'use', id: levelId, def }, { kind: 'use', def });
    return Promise.resolve().then(() => {
      if (gen !== C.gen) return null;
      activate(hit); C.log.push({ id: levelId, kind: 'cache', states: hit.states, wall: 0, worker: 0 });
      return { states: hit.states, ms: 0, cached: true };
    });
  }
  // aynı seviye zaten hesaplanıyorsa (ör. önceden hesaplama) ona bağlan
  for (const p of C.pending.values()) {
    if ((p.kind === 'load' || p.kind === 'prefetch') && p.id === levelId && sameDef(p.def, def)) {
      return new Promise(res => { const prev = p.resolve; p.kind = 'load'; p.gen = gen; p.resolve = v => { prev(null); res(v); }; });
    }
  }
  // başka bir seviye hesaplanıyorsa Worker onu kendi içinde bırakır (işbirlikli iptal); terminate yok
  const cold = !C.worker || C.loadsInWorker === 0;
  const pr = send({ t: 'load', id: levelId, gen, def }, { kind: 'load', gen, id: levelId, def, cold });
  C.loadsInWorker++;
  if (C.status === 'busy') watchdog(gen);
  return pr;
}
// Bekçi: 30 s'de bitmeyen yükleme için Worker'a 'ping' gönderilir (dilimler arasında yanıtlanır). Yanıt gelirse Worker
// yaşıyor ve çalışıyor demektir (ör. CPU yükü altında yavaş): beklemeye devam. 5 s'de yanıt yoksa Worker asılıdır:
// sonlandırılır, yükleme yeni Worker'da yeniden başlar ve ilk sözün çağıranı yeni sonucu alır (null değil).
function watchdog(gen) {
  clearTimeout(C.dog);
  C.dog = setTimeout(() => {
    if (gen !== C.gen || C.status !== 'busy' || !C.worker) return;
    let answered = false;
    send({ t: 'ping' }, { kind: 'ping' }).then(m => { answered = !!m; if (m && gen === C.gen && C.status === 'busy') watchdog(gen); });
    C.dog = setTimeout(() => {
      if (answered || gen !== C.gen || C.status !== 'busy') return;
      console.warn('[PX.solver] Worker yanıt vermiyor: yeniden başlatılıyor');
      let carry = null;
      for (const [r, p] of C.pending) if (p.kind === 'load' && p.gen === gen) { carry = p; C.pending.delete(r); break; }
      const id = C.id, def = C.def; restartWorker(); C.status = 'idle';
      const pr = load(id, def); if (carry) pr.then(v => carry.resolve(v));
    }, 5000);
  }, 30000);
}
function prefetch(levelId, def) {
  init();
  if (!levelId || !def || cacheGet(levelId, def)) return Promise.resolve(null);
  for (const p of C.pending.values()) if (p.kind === 'load' || p.kind === 'prefetch') return Promise.resolve(null);   // Worker meşgul: atla
  const cold = !C.worker || C.loadsInWorker === 0;
  const pr = send({ t: 'load', id: levelId, gen: 0, def }, { kind: 'prefetch', gen: 0, id: levelId, def, cold });
  C.loadsInWorker++;
  return pr;
}
function prefetchNext(id) {
  const lv = PX.LEVELS || []; const i = lv.findIndex(l => l.id === id);
  if (i >= 0 && lv[i + 1]) prefetch(lv[i + 1].id, lv[i + 1].def);
}

// ---------------------------------------------------------------- tablo okumaları (O(1), ayırmasız)
function dist(s) {
  if (!C.tab) return null;
  const i = stateIndex(s); if (i < 0) return null;
  const d = C.tab.dH[i]; return d === 255 ? -1 : d;
}
function distM(s, metric) {
  if (!C.tab) return null;
  const i = stateIndex(s); if (i < 0) return null;
  const t = C.tab.tab[METRICS.indexOf(metric) >= 0 ? metric : 'hamle'];
  const p = t[0][i]; if (p === 65535) return -1;
  return { p, s: t[1][i] };
}

// ---------------------------------------------------------------- ipucu (Worker)
function hint(s, tier, metric) {
  if (METRICS.indexOf(metric) < 0) metric = (PX.hint && PX.hint.metric) || 'hamle';
  const base = { tier, metric, acts: [], plan: [], why: '', dead: false };
  if (!C.tab || !C.L || !s) return Promise.resolve(Object.assign(base, { busy: true, why: (PX.STR && PX.STR.hesaplaniyor) || '' }));
  let key; try { key = SIM.key(C.L, s); } catch (e) { return Promise.resolve(Object.assign(base, { stale: true })); }
  const gen = C.gen, id = C.id, L = C.L;
  const ask = retry => send({ t: 'hint', id, key, metric, tier }, { kind: 'hint' }).then(m => {
    if (!m || gen !== C.gen) return Object.assign(base, { stale: true });
    if (m.miss && retry) return send({ t: 'use', id, def: C.def }, { kind: 'use', def: C.def }).then(() => gen === C.gen ? ask(false) : Object.assign(base, { stale: true }));
    if (m.miss) return Object.assign(base, { stale: true });
    const r = Object.assign(base, { acts: m.acts, plan: m.plan, dead: m.dead, val: m.val, key });
    try { if (PX.hint && PX.hint.explain) PX.hint.explain(L, s, r); } catch (e) { console.warn('[PX.solver] ipucu metni', e); }
    if (!r.why && r.acts.length) r.why = r.acts[r.acts.length - 1];
    return r;
  });
  return ask(true);
}

// ---------------------------------------------------------------- soyut ipucu (ana iş parçacığı, bütçeli)
// Durum uzayının elektrik izdüşümünde BFS (kural sürümü 4): her eylem, cihazın fiziksel yaklaşma karolarından
// (L.approach[e]) denenir; konum, kapı ve yol yok sayılır (gevşetme). Durum alanları {p, b, lk, sp, st, ch, w}.
const AB = { L: null, tiles: null, work: null, memo: new Map(), budgetMs: 12, maxNodes: 6000, job: null, timer: 0 };
function abReset() { AB.L = null; AB.memo.clear(); if (AB.job) { AB.job.res = null; abSettle(AB.job); } }
function abPrep(L) {
  if (AB.L === L) return; AB.L = L; AB.memo.clear();
  AB.tiles = L.els.map((el, e) => { const ap = (L.approach && L.approach[e]) || []; return el.cell >= 0 && ap.length ? ap.slice(0, 6) : null; });
  AB.work = L.work >= 0 ? [L.work] : [];
}
function abTry(L, x, a, tiles) {
  if (!tiles) return null;
  for (let i = 0; i < tiles.length && i < 6; i++) {
    const y = { p: tiles[i], b: x.b, lk: x.lk, sp: x.sp, st: x.st, ch: x.ch, w: x.w };
    const r = SIM.apply(L, y, a); if (!r.err) return r.s;
  }
  return null;
}
function abMoves(L, x) {
  const out = [];
  L.els.forEach((el, e) => {
    const pr = AB.tiles[e]; if (!pr) return;
    if (el.t === 'kesici' || el.t === 'ayirici' || el.t === 'yuk_ayirici' || el.t === 'toprak') out.push([{ t: 'op', e }, pr]);
    if (el.lk >= 0) out.push([{ t: ((x.lk >> el.lk) & 1) ? 'kilitac' : 'kilit', e }, pr]);
    if (el.t === 'sigorta' && !((x.b >> el.bit) & 1)) out.push([{ t: 'degistir', e }, pr]);
    if (el.t === 'buton') out.push([{ t: 'bas', e }, pr]);
    if (el.t === 'bara' && L.nSet) out.push([{ t: 'set', e }, pr]);
  });
  if (L.work >= 0 && !x.w) out.push([{ t: 'calis' }, AB.work]);
  out.push([{ t: 'bekle' }, [x.p]]);
  return out;
}
// Sürdürülebilir arama: bütçe (≤ 12 ms) dolarsa arama durumu saklanır; sonraki çağrı ve arka plan dilimleri
// (setTimeout 0, dilim başına ≤ 6 ms) kaldığı yerden sürer. Sonuç r.later (Promise) ile de teslim edilir:
// bulunduğunda tam sonuç, elektrik durumu değiştiyse ya da arama sınırına takıldıysa null.
function abFinish(L, s, found, t0) {
  const el = found.e !== undefined ? L.els[found.e] : null;
  const nm = el ? (el.ad ? el.id + ' (' + el.ad + ')' : el.id) : '';
  const tok = SIM.encodeAct(L, s, found);
  const why = found.t === 'calis' ? 'Sıradaki adım: iş noktasında işi yap' :
    found.t === 'bekle' ? 'Sıradaki adım: kondansatör deşarjını bekle' : 'Sıradaki cihaz: ' + nm;
  return { el: el ? el.id : null, tok, a: found, cell: el ? el.cell : (found.t === 'calis' ? L.work : -1), why, abstract: true, ms: performance.now() - t0 };
}
// J.i = sıradaki genişletilecek düğüm, J.j = o düğümün sıradaki hamlesi (bütçe hamle ortasında da kesilebilir)
function abRun(J, budget) {
  const L = J.L, t0 = performance.now();
  while (J.i < J.q.length) {
    if (J.seen.size > AB.maxNodes) { J.done = true; J.res = null; return true; }
    const x = J.q[J.i]; if (!J.moves) { J.moves = abMoves(L, x); J.j = 0; }
    while (J.j < J.moves.length) {
      if (performance.now() - t0 > budget) return false;
      const [a, pairs] = J.moves[J.j++];
      const y = abTry(L, x, a, pairs); if (!y) continue;
      const k = SIM.elecKey(L, y); if (J.seen.has(k)) continue;
      const f = J.first[J.i] || a; J.seen.set(k, f); J.q.push(y); J.first.push(f);
      if (SIM.won(L, y)) { J.done = true; J.res = abFinish(L, J.s, f, J.t0); AB.memo.set(J.k0, J.res); return true; }
    }
    J.moves = null; J.i++;
  }
  J.done = true; J.res = null; return true;
}
function abSettle(J) { const w = J.waiters; J.waiters = []; for (const f of w) f(J.res); if (AB.job === J) AB.job = null; }
function abPump() {
  const J = AB.job; AB.timer = 0; if (!J) return;
  if (J.L !== ((PX.game && PX.game.L) || C.L)) { J.res = null; abSettle(J); return; }   // seviye değişti
  if (abRun(J, 6)) abSettle(J); else AB.timer = setTimeout(abPump, 0);
}
function abstractHint(s) {
  const L = (PX.game && PX.game.L) || C.L; const none = { el: null, tok: null, why: (PX.STR && PX.STR.hesaplaniyor) || '', abstract: true };
  if (!L || !s) return none;
  try {
    abPrep(L);
    if (SIM.won(L, s)) return Object.assign(none, { why: '' });
    const k0 = SIM.elecKey(L, s); const memo = AB.memo.get(k0); if (memo) return memo;
    let J = AB.job;
    if (!J || J.L !== L || J.k0 !== k0) {
      if (J) { J.res = null; abSettle(J); }
      const seen = new Map(); seen.set(k0, null);
      J = AB.job = { L, s, k0, seen, q: [s], first: [null], i: 0, j: 0, moves: null, done: false, res: null, waiters: [], t0: performance.now() };
    }
    if (abRun(J, AB.budgetMs)) { const r = J.res; abSettle(J); return r || Object.assign(none, { partial: false }); }
    if (!AB.timer) AB.timer = setTimeout(abPump, 0);
    const later = new Promise(res => J.waiters.push(res));
    return Object.assign(none, { partial: true, later });
  } catch (e) { console.warn('[PX.solver] soyut ipucu', e); return none; }
}

function info() {
  return { id: C.id, status: C.status, err: C.err, states: C.tab ? C.tab.states : 0, edges: C.tab ? C.tab.edges : 0, goals: C.tab ? C.tab.goals : 0, dead: C.tab ? C.tab.dead : 0,
    wall: C.tab ? Math.round(C.tab.wall) : null, worker: C.tab ? Math.round(C.tab.wms) : null, cached: [...C.cache.keys()] };
}
PX.solver = {
  load, dist, distM, hint, abstractHint, prefetch, cancel, flush, info,
  stats() { return C.log.slice(); },
  get ready() { return !!C.tab; }, get status() { return C.status; }, get id() { return C.id; },
  METRICS,
};
// ön ısıtma (yalnız tarayıcıda, Worker kaynağı gömülüyse)
try { if (typeof document !== 'undefined' && PX.WORKER_SRC && typeof Worker !== 'undefined') ensureWorker(); } catch (e) { console.warn('[PX.solver] ön ısıtma', e); }
