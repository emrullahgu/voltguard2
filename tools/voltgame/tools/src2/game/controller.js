// ============================================================================
// game/controller.js — PX.game : komut hattı, FIFO, sunum durumu, geri al/yinele, kazanma (§12.2, §12.5, §25)
//                                                                               sahip: Oyun (controller)
// KURAL SÜRÜMÜ 4 — FİZİKSEL DÜNYA:
//   * Volti yalnız fiziksel komşu karolar arasında yürür; kat değişimi yalnız merdiven/iskele üzerinden (sim2.walkPath).
//   * Kamera YALNIZ GÖRSELDİR: döndürme sim komutu değildir, geçmişe girmez, hiçbir zaman reddedilmez, yürürken de
//     serbesttir (yol ve elektrik değişmez). Kameranın açısı burada tutulur: G.camV (sim durumunda görünüm yok).
//   * Erişilemeyen her hedef açıklanır (sim2.explain): 'cmd:rejected' yükü {err, msg, cells, blockers, fix, show, hedef,
//     reason:true}. fix = engeli kaldıracak cihaz (kapı kilitlemesi: toprak/kilit), show = Tek Hat'ta gösterilecek
//     tehlikeli iletken (yaklaşma bölgesi; yanına yürünmez). Volti asla sessizce takılmaz.
// İKİ DURUM:
//   G.s     mantıksal (öngörülen) durum: komut kabul edildiği anda ilerler; her yeni komut ona karşı sim2.apply
//           ile çözülür (FIFO'daki komutlar dahil). Biçim sim2 ile aynı: {p, b, lk, sp, st, ch, w}.
//   G.pres  sunum durumu: yalnız bir adımın animasyonu BİTİNCE ilerler ('anim:step'). HUD sayaçları, lamba,
//           tek hat ('elec:changed') ve kazanma ('win') yalnız buradan beslenir => sunum oyuncunun gördüğünün
//           önüne asla geçmez.
// KOMUTLAR:
//   Ayrık komutlar (ok tuşu, çip) sınırlı FIFO'ya (en çok 3 bekleyen) girer; geçersiz komut tampona girmez,
//   'cmd:rejected' anında (neden = sim2.ERR anahtarı). Dördüncü bekleyen girdi YENİSİNİ reddeder ('tampon').
//   Geri al / yinele / baştan her an anında çalışır.
//   Dokun-yürü: yeni dokunuş başlamamış dokunuşun yerini alır; YÜRÜYEN yol hedef değiştirir (aynı başlangıçtan tek
//   'g' komutu = yine 1 Hamle; görselde Volti sıradaki karo sınırından yeni yola geçer).
//   Dokunulan hücre türü (sim2.KIND): karo -> yürü; cihaz -> yaklaşma karosuna yürü + varışta çipler; merdiven/iskele
//   -> öbür uca yürü (çık/in); kapı -> kapının karosuna yürü; duvar -> neden (üstüne basılmaz); erişilemez -> neden.
// ARAYÜZ:
//   PX.game.init()   PX.game.load(levelId | {daily:date} | {def, id?}) -> Promise<{id}>
//   PX.game.command(cmd) -> bool (kabul)
//     cmd = {t:'tap', U,V,tri, cell?, volti?} | {t:'walk', dir:0..3 (EKRAN kafesi yönü: +U −U +V −V)}
//         | {t:'rot', d:±1, src?} (yalnız kamera) | {t:'act', a|tok} | {t:'undo'} | {t:'redo'} | {t:'reset'} | {t:'hint', tier}
//   PX.game.state() -> {id, s, view, tot, won, presentation:{tot, s, won}, queue, busy, hist, redo, camV, celebrating}
//   PX.game.preview(a) -> {ok, err?, msg?, olu:[düğüm], canli:[düğüm], kesintiDelta, yedekDelta, manevraDelta, c, trips}
//   PX.game.explain(e|{e}|{tile}) -> sim2.explain sonucu (o anki öngörülen durumdan)
//   PX.game.checklist(s?) -> sim2.checklist (varsayılan: sunum durumu)
//   PX.game.focusTargets() -> sim2.occluders hedefleri: Volti gövdesi [x,y+1,z], seçili cihaz, yol hücreleri, iş karosu
//   PX.game.selected -> seçili cihaz indeksi (-1)   PX.game.guide -> {cell, el, tok} | null (rehber seviyeler)
//   PX.game.setInstant(bool)  PX.game.tokens()  PX.game.L  PX.game.level  PX.game.busy  PX.game.camView
//   PX.game.skipCelebration()  PX.game.precompile(id)  PX.game.update(dt)
// Adım (render.animate'e giden): {kind, cmd, a, tok, before, after, c:{h,m,k,o}, trips:[id], log, path, steps, chipAfter}
//   kind: walk | op | earth | lock | unlock | fuse | press | work | wait
//   path  = yol üzerindeki KARO hücreleri (ardışık ikisi fiziksel komşu: düz, merdiven ya da iskele bağı)
//   steps = sim2.walkPath adımları [{c, k:'karo'|'merdiven'|'iskele', x, y, z, h, dir?}] (ayak yüksekliği h)
//   Yürüyüş adımları parça parça (segment) verilir: her parçanın after.p'si o parçanın sonudur.
//   render'a giden kopyaların before/after'ına kameranın görünümü eklenir (v = G.camV; yalnız sunum alanı).
// Olaylar (bu dosyanın yaydıkları): level:loaded, cmd:accepted, cmd:rejected, anim:step, anim:done, elec:changed,
//   lamp, ui:chip, ui:longpress, undo, redo, reset, win, view {v, d}, focus {el, path, cells}, guide {cell, el, tok, why}
// İsteğe bağlı Volti uzantısı: PX.volti.legEnd() -> hücre, PX.volti.retarget(cells) -> bool (bkz. _requests/controller.md).
// ============================================================================
const SIM = PX.SIM;
const QMAX = 3;
const LCACHE = 2;
const K = SIM.KIND || { bos: 0, blok: 1, eleman: 2, merdiven: 3, iskele: 4, duvar: 5, kapi: 6 };
const KIND = { git: 'walk', op: 'op', kilit: 'lock', kilitac: 'unlock', degistir: 'fuse', bas: 'press', set: 'earth', calis: 'work', bekle: 'wait' };
// yerel yedek metinler (PX.STR'de anahtar yoksa)
const FALLBACK = {
  yon_yok: 'Bu yönde yürünecek yer yok: boşluk ya da duvar. Kat değiştirmek için merdiven ya da iskele kullan.',
  duvar: 'Duvarın tepesi yürüme yüzeyi değil (korkuluk/parapet). Üst kata merdivenden ya da iskeleden çıkılır.',
  saglam: 'Sigorta sağlam: değiştirilecek eriyik bıçak yok.',
  bilgi: 'Bu cihazda Volti\'nin yapacağı bir işlem yok.',
};
const G = {
  L: null, id: null, lv: null, s0: null, s: null, tot: z(), hist: [], redo: [], q: [], cur: null,
  pres: { s: null, tot: z(), won: false }, won: false, gen: 0, camV: 0, chipPending: -1, hinted: false,
  celebrating: false, cellEl: null, seq: 0, lcache: [], hl: -1, inflight: null, chainFrom: false, chipsOn: false, lampS: '', lampD: null,
  sel: -1, guide: null, guideSeq: 0, guideKey: -1,
};
function z() { return { h: 0, m: 0, k: 0, o: 0 }; }
function addT(t, c, sg) { t.h += sg * c.h; t.m += sg * c.m; t.k += sg * c.k; t.o += sg * c.o; }
const cp = t => ({ h: t.h, m: t.m, k: t.k, o: t.o });
const str = (k, fb) => (PX.STR && PX.STR.ERR && PX.STR.ERR[k]) || (PX.STR && typeof PX.STR[k] === 'string' && PX.STR[k]) || FALLBACK[k] || fb || k;
const instant = () => !!(PX.render && PX.render.instant);
// render'a giden durum: sim durumu + kameranın görünümü (yalnız sunum; sim fonksiyonları v'yi okumaz)
const withV = s => (s ? Object.assign({}, s, { v: G.camV }) : s);
const withP = (s, p) => Object.assign({}, s, { p });

// ---------------------------------------------------------------- seviye
function findLevel(spec) {
  if (typeof spec === 'string') return (PX.LEVELS || []).find(l => l.id === spec) || null;
  if (spec && spec.def) return { id: spec.id || spec.def.id || 'ÖZEL', ad: spec.ad || spec.def.ad || '', def: spec.def, kanit: spec.kanit || null, biyom: spec.biyom, isEmri: spec.isEmri, rehber: spec.rehber };
  if (spec && spec.daily !== undefined && PX.daily) { const d = PX.daily.today(spec.daily || undefined); return d ? d.level : null; }
  return null;
}
function compileCached(lv) {
  for (const e of G.lcache) if (e.def === lv.def) return e.L;
  const L = SIM.compile(lv.def);
  G.lcache.push({ def: lv.def, L });
  while (G.lcache.length > LCACHE) G.lcache.shift();
  return L;
}
// "Sonraki" hazır olsun diye kazanma panelinde bir sonraki seviyeyi önceden derler (§12.3, §24.7)
function precompile(id) {
  const lv = findLevel(id); if (!lv) return false;
  try { compileCached(lv); return true; } catch (e) { return false; }
}
function load(spec) {
  const lv = findLevel(spec);
  if (!lv) return Promise.reject(new Error('seviye yok: ' + JSON.stringify(spec)));
  let L;
  try { L = compileCached(lv); } catch (e) { return Promise.reject(e); }
  cancelAnims();
  const s0 = SIM.initState(L);
  Object.assign(G, { L, id: lv.id, lv, s0, s: s0, tot: z(), hist: [], redo: [], q: [], cur: null, won: SIM.won(L, s0), chipPending: -1, hinted: false,
    celebrating: false, camV: (L.view0 | 0) & 3, hl: -1, sel: -1, guide: null, guideKey: -1 });
  G.guideSeq++;
  G.pres = { s: s0, tot: z(), won: false };
  const cellEl = new Int16Array(L.G.N).fill(-1); L.els.forEach((e, i) => { if (e.cell >= 0) cellEl[e.cell] = i; }); G.cellEl = cellEl;
  PX.render.setLevel(L, withV(s0));
  PX.bus.emit('level:loaded', { id: lv.id, L, s: s0, view: G.camV, level: lv });
  clearChips(true);
  emitElec(s0);
  lamp(true);
  if (PX.solver && PX.solver.load) {
    try { Promise.resolve(PX.solver.load(lv.id, lv.def)).then(() => { if (G.L === L) { lamp(); guideSoon(); } }, () => {}); } catch (e) { console.error('[PX.game] solver.load', e); }
  }
  guideSoon();
  return Promise.resolve({ id: lv.id });
}
function cancelAnims() {
  G.gen++; G.cur = null; G.inflight = null; G.celebrating = false;
  if (PX.volti && PX.volti.cancel) PX.volti.cancel();
  if (PX.TW) PX.TW.cancelAll();
}

// ---------------------------------------------------------------- yol yardımcıları
// karo hücreleri listesi (ardışık ikisi fiziksel komşu); yol yoksa null
function walkCells(L, s, to) {
  if (s.p === to) return [to];
  const w = SIM.walkPath(L, s, to); if (!w) return null;
  const out = []; for (const x of w) if (x.k === 'karo') out.push(x.c);
  return out;
}
function walkSteps(L, s, to) { try { return SIM.walkPath(L, s, to) || null; } catch (e) { return null; } }
function ownerCell(cmd) {
  if (typeof cmd.cell === 'number' && cmd.cell >= 0) return cmd.cell;
  if (typeof cmd.U !== 'number' || !SIM.ownerAt) return -1;
  let skip = null; try { skip = PX.diorama && typeof PX.diorama.fadedSet === 'function' ? PX.diorama.fadedSet() : null; } catch (e) { skip = null; }
  const o = SIM.ownerAt(G.L, G.camV, cmd.U, cmd.V, cmd.tri, skip); return o ? o.c : -1;
}
function reject(cmd, err, msg, extra) {
  PX.bus.emit('cmd:rejected', Object.assign({ cmd, err, msg: msg === undefined ? str(err) : msg }, extra || {}));
  return false;
}
// sim2.explain sonucu (ya da explain'li bir apply reddi) -> açıklamalı ret: engel hücreleri + engel cihazları + çözüm cihazları
function rejectWhy(cmd, x, extra) {
  const L = G.L; const cells = (x.cells || []).slice(); const fix = [], show = []; const blockers = x.blockers || [];
  const addC = c => { if (typeof c === 'number' && c >= 0 && cells.indexOf(c) < 0) cells.push(c); };
  const addF = e => { if (e >= 0 && L.els[e] && fix.indexOf(e) < 0) fix.push(e); };
  for (const b of blockers) {
    const el = L.els[b.el]; if (el) addC(el.cell);
    // kapı: kilitlemeyi açan cihaz(lar)a yürünür; bölge: tehlikeli iletken Tek Hat'ta gösterilir (yanına gidilmez)
    if (b.err === 'kapi_kilitli') { addF(b.earth); addF(b.lock); } else if (b.el >= 0 && L.els[b.el] && show.indexOf(b.el) < 0) show.push(b.el);
  }
  if (x.el !== undefined && L.els[x.el]) addC(L.els[x.el].cell);
  return reject(cmd, x.err, x.msg, Object.assign({ cells, blockers, fix, show, hedef: x.hedef || null, reason: true }, extra || {}));
}
// hedef halkası (render de yürüyüş başında koyar; hedef değişince/iptal edilince burada güncellenir)
function highlight(c) {
  G.hl = c;
  if (PX.diorama && PX.diorama.highlight) { try { PX.diorama.highlight(c, 'hedef'); } catch (e) { /* yoksay */ } }
  focusChanged();
}
function voltiLegEnd() { try { return PX.volti && typeof PX.volti.legEnd === 'function' ? PX.volti.legEnd() : -1; } catch (e) { return -1; } }
function canRetarget() { return !!(PX.volti && typeof PX.volti.retarget === 'function' && typeof PX.volti.legEnd === 'function'); }
// sağlam (erimemiş) sigortanın 'degistir' eylemi: sim2.candidates erişilen her sigorta için listeler, apply 'gecersiz' der
function fuseIntact(L, s, a) {
  const el = a && a.t === 'degistir' && a.e !== undefined ? L.els[a.e] : null;
  return !!(el && el.t === 'sigorta' && ((s.b >> el.bit) & 1));
}
function rejectApply(cmd, a, r) {
  const L = G.L;
  if (a.t === 'degistir' && fuseIntact(L, G.s, a)) return reject(cmd, 'saglam', str('saglam'), { a, cells: [L.els[a.e].cell] });
  if (r.blockers || r.cells) return rejectWhy(cmd, r, { a });
  const extra = { a };
  const e = r.el !== undefined ? r.el : a.e;
  if (e !== undefined && L.els[e] && L.els[e].cell >= 0) extra.cells = [L.els[e].cell];
  if (r.tile !== undefined && r.tile >= 0) extra.cells = (extra.cells || []).concat([r.tile]);
  return reject(cmd, r.err, r.msg, extra);
}
function hasActions(el) {
  // sigorta yalnız eriyikken eylem taşır (sağlam sigortaya dokunuş: cihaz kartı + yürüyüş değil)
  return el.t === 'kesici' || el.t === 'ayirici' || el.t === 'yuk_ayirici' || el.t === 'toprak' || el.t === 'buton'
    || (el.t === 'sigorta' && !((G.s.b >> el.bit) & 1))
    || (el.lk !== undefined && el.lk >= 0) || (el.t === 'bara' && G.L.nSet > 0);
}

// ---------------------------------------------------------------- çipler
function label(a, s, withId) {
  const L = G.L, E = (PX.STR && PX.STR.eylem) || {}; const el = a.e !== undefined ? L.els[a.e] : null;
  let t;
  switch (a.t) {
    case 'op': { const kap = !((s.b >> el.bit) & 1); t = el.t === 'toprak' ? (kap ? (E.toprakKapat || E.topraklaTak) : (E.toprakAc || E.topraklaSok)) : (kap ? E.kapat : E.ac); break; }
    case 'kilit': t = E.kilitle; break; case 'kilitac': t = E.kilidiAc; break; case 'degistir': t = E.sigortaDegistir; break; case 'bas': t = E.bas; break;
    case 'set': t = s.st ? E.topraklaSok : E.topraklaTak; break; case 'calis': t = E.calis; break; case 'bekle': t = E.bekle; break;
    default: t = a.t;
  }
  return withId && el ? el.id + ' · ' + t : t;
}
// e >= 0: o cihazın eylemleri; e === -2: kendi karosundaki tüm cihaz/iş eylemleri (gezinme hariç)
function emitChips(e) {
  const L = G.L, s = G.s; if (!L || G.won) return;
  const acts = SIM.candidates(L, s).filter(a => (e >= 0 ? a.e === e : a.t !== 'git') && !fuseIntact(L, s, a));
  G.chipsOn = acts.length > 0;
  if (e >= 0 && G.sel !== e) { G.sel = e; focusChanged(); }
  PX.bus.emit('ui:chip', { el: e >= 0 ? L.els[e].id : null, title: e >= 0 ? SIM.labelOf(L, e) : null, state: e >= 0 ? SIM.deviceState(L, s, e) : null,
    actions: acts.map(a => ({ a, tok: SIM.encodeAct(L, s, a), label: label(a, s, e < 0), preview: preview(a) })) });
}
// çip yokken boş 'ui:chip' yayılmaz (dokunuş anındaki işi en aza indirir: dokunuş -> ilk hareket, §12.3)
function clearChips(force) {
  if (G.sel >= 0) { G.sel = -1; focusChanged(); }
  if (!G.chipsOn && !force) return; G.chipsOn = false; PX.bus.emit('ui:chip', { el: null, actions: [] });
}
function chipsWhenIdle(e) { if (G.cur || G.q.length) G.chipPending = e; else emitChips(e); }

// ---------------------------------------------------------------- komut girişi
function command(cmd) {
  if (!G.L || !cmd) return false;
  switch (cmd.t) {
    case 'undo': return undo();
    case 'redo': return redo();
    case 'reset': return reset();
    case 'rot': return rotate(cmd);                                       // yalnız kamera: kazanınca da serbest
    case 'hint': {
      if (PX.hint && PX.hint.request) PX.hint.request(cmd.tier || 1, cmd.metric ? { metric: cmd.metric } : undefined); return true;
    }
  }
  if (G.won) return reject(cmd, 'kazanildi', G.pres.won ? str('kazandi') : '');   // sunum kazanmadan önce metin yok
  const L = G.L;
  switch (cmd.t) {
    case 'tap': return onTap(cmd);
    case 'walk': return keyWalk(cmd);
    case 'act': {
      const a = cmd.a || (cmd.tok ? SIM.decodeAct(L, G.s, cmd.tok) : null);
      if (!a) return reject(cmd, 'dogrulanamadi');
      // cihaz eylemi bitince aynı cihazın GÜNCEL çipleri yeniden gösterilir (Kapat -> Kilitle zinciri yeniden dokunmadan)
      return commit(cmd, a, a.e !== undefined && a.e >= 0 && a.t !== 'git' && !cmd.replay ? a.e : -1);
    }
  }
  return reject(cmd, 'bilinmeyen', 'Bilinmeyen komut.');
}
// kamera döndürme: sim'e gitmez, geçmişe girmez, asla reddedilmez (yürürken de; yol ve elektrik değişmez)
function rotate(cmd) {
  const d = cmd.d > 0 ? 1 : -1;
  G.camV = (G.camV + d + 4) & 3;
  if (G.inflight && G.inflight.after) G.inflight.after.v = G.camV;     // adım sonundaki saf kurulum kamerayı geri çekmesin
  if (G.cur && G.cur.sub && G.cur.sub.after) G.cur.sub.after.v = G.camV;
  if (instant()) { if (PX.render.sync) PX.render.sync(withV(G.pres.s)); }
  else if (PX.camera && PX.camera.snapTo) PX.camera.snapTo(G.camV);
  PX.bus.emit('cmd:accepted', { cmd, a: null, tok: null, view: G.camV });
  PX.bus.emit('view', { v: G.camV, d });
  focusChanged();
  return true;
}
// klavye: EKRAN yönü (kafes +U −U +V −V) -> fiziksel yön -> TEK fiziksel adım (merdiven/iskele dahil)
function keyWalk(cmd) {
  const L = G.L, s = G.s;
  const d = SIM.screenToDir(G.camV, cmd.dir & 3);
  const t = SIM.stepToward(L, s, d);
  if (t >= 0) return commit(cmd, { t: 'git', to: t }, -1);
  // o yönde fiziksel bir bağ var ama şu an geçilemiyor (kapı / yaklaşma bölgesi): nedeniyle
  const ti = L.tileIdx[s.p]; const edge = ti >= 0 ? (L.adj[ti] || []).find(e => e.d === d) : null;
  if (edge) { const x = SIM.explain(L, s, { tile: L.tiles[edge.to] }); if (!x.ok) return rejectWhy(cmd, x, { dir: cmd.dir }); }
  return reject(cmd, 'yon_yok', str('yon_yok'), { dir: cmd.dir });
}
// dokunulan hücreyi bir hedefe çevir: {tile} | {e} | {chips} | {card} | {err}
function resolveTap(c) {
  const L = G.L, s = G.s; const kd = L.G.kind[c];
  if (kd === K.eleman) {
    const e = G.cellEl[c]; if (e < 0) return { err: 'bos' };
    const el = L.els[e];
    if (!hasActions(el)) return { card: e };
    return { e };
  }
  if (kd === K.kapi) { const e = G.cellEl[c]; const el = e >= 0 ? L.els[e] : null; const d = el && el.di !== undefined ? L.doors[el.di] : null; return d ? { tile: d.tile, door: e } : { err: 'bos' }; }
  if (kd === K.merdiven) { const st = L.stairs.find(x => x.cell === c); return st ? { tile: farEnd(st.lo, st.hi), via: c } : { err: 'bos' }; }
  if (kd === K.iskele) { const ld = L.ladders.find(x => x.cells.indexOf(c) >= 0); return ld ? { tile: farEnd(ld.foot, ld.top), via: c } : { err: 'bos' }; }
  if (kd === K.duvar) return { err: 'duvar', cell: c };
  if (kd === K.blok) {
    if (L.walkable(c)) return { tile: c };
    // yan yüzü görünen, üstü dolu blok: aynı sütunda üstteki ilk basılabilir karo (ör. üstünde blok olan zemin)
    const [x, y, zz] = L.G.xyz(c);
    for (let yy = y + 1; yy < L.G.H; yy++) { const q = L.G.idx(x, yy, zz); if (q < 0) break; const k2 = L.G.kind[q]; if (k2 === K.blok && L.walkable(q)) return { tile: q }; if (k2 !== K.blok) break; }
    return { err: 'bos' };
  }
  return { err: 'bos' };
  // merdiven/iskele: Volti'nin bulunduğu taraftan öbür uca (çık ya da in); taraf statik fiziksel uzaklıkla seçilir
  function farEnd(a, b) {
    if (s.p === a) return b; if (s.p === b) return a;
    const pa = SIM.walkPath(L, s, a, { static: true }), pb = SIM.walkPath(L, s, b, { static: true });
    if (!pa) return b; if (!pb) return a;
    return pa.length <= pb.length ? b : a;
  }
}
function onTap(cmd) {
  // Volti'nin kendisine dokunuş: arkasındaki karo/cihaz hedeflenmez, Hamle harcanmaz; durunca kendi karosunun çipleri
  if (cmd.volti) { chipsWhenIdle(-2); return true; }
  const L = G.L; const c = ownerCell(cmd);
  if (c < 0) return reject(cmd, 'bos', '');
  const r = resolveTap(c);
  if (r.err === 'bos') return reject(cmd, 'bos', '');
  if (r.err) return reject(cmd, r.err, str(r.err), { cells: [r.cell] });
  if (r.card !== undefined) { PX.bus.emit('ui:longpress', { cell: c, el: L.els[r.card].id }); return true; }   // cihaz kartı (yük, kaynak…)
  if (r.e !== undefined) {
    const e = r.e; const el = L.els[e];
    const t = SIM.approachTile(L, G.s, e);
    if (t < 0) { const x = SIM.explain(L, G.s, { e }); return rejectWhy(cmd, x.ok ? { err: 'ulasilamaz', msg: str('ulasilamaz') } : x, { el: el.id, target: c }); }
    if (t === G.s.p && !replaceableTap()) { chipsWhenIdle(e); return true; }
    if (G.sel !== e) { G.sel = e; focusChanged(); }
    return tapWalk(cmd, t, e);
  }
  // karo hedefi (karo, kapı, merdiven/iskele ucu)
  const to = r.tile;
  if (to === G.s.p && !G.cur && !G.q.length) { chipsWhenIdle(-2); return true; }
  if (to !== G.s.p && SIM.walkTargets(L, G.s).indexOf(to) < 0) {
    // yürüyen dokun-yürünün hedefi değişecekse başlangıçtan değerlendirilir (retarget)
    const cur = G.cur;
    if (!(cur && cur.kind === 'walk' && cur.cmd && cur.cmd.t === 'tap' && !G.q.length)) {
      const x = SIM.explain(L, G.s, { tile: to }); if (!x.ok) return rejectWhy(cmd, x, { target: c });
    }
  }
  return tapWalk(cmd, to, -1);
}
function replaceableTap() {
  const last = G.q.length ? G.q[G.q.length - 1] : null;
  return !!(last && last.kind === 'walk' && last.cmd && last.cmd.t === 'tap' && G.hist[G.hist.length - 1] === last);
}
function tapWalk(cmd, target, chipAfter) {
  const L = G.L;
  // 1) yürüyen dokun-yürü (bekleyen yok): hedef değiştir
  const cur = G.cur;
  if (cur && cur.kind === 'walk' && cur.cmd && cur.cmd.t === 'tap' && !G.q.length) {
    if (target === G.s.p && !cur.void) { chipsWhenIdle(chipAfter >= 0 ? chipAfter : -2); return true; }   // zaten oraya gidiyor
    return retarget(cmd, target, chipAfter);
  }
  // 2) başlamamış son dokunuşun yerini al
  if (replaceableTap()) {
    const last = G.q.pop(); G.hist.pop(); G.s = last.before; addT(G.tot, last.c, -1); G.won = SIM.won(L, G.s);
    if (target === G.s.p) { highlight(-1); if (chipAfter >= 0) chipsWhenIdle(chipAfter); PX.bus.emit('cmd:accepted', { cmd, a: null, tok: null, replaced: true }); return true; }
  }
  // 3) zaten orada (ya da oraya varacak)
  if (target === G.s.p) { chipsWhenIdle(chipAfter >= 0 ? chipAfter : -2); return true; }
  if (chipAfter < 0) clearChips(); else if (G.chipsOn) { G.chipsOn = false; PX.bus.emit('ui:chip', { el: null, actions: [] }); }
  return commit(cmd, { t: 'git', to: target }, chipAfter);
}
// yürüyen dokun-yürü adımının hedefini değiştir (§12.2): mantık = aynı başlangıçtan tek 'g' (1 Hamle)
function retarget(cmd, C, chipAfter) {
  const L = G.L, st = G.cur, base = st.before;
  let r = null;
  if (C !== base.p) { r = SIM.apply(L, base, { t: 'git', to: C }); if (r.err) return rejectApply(cmd, { t: 'git', to: C }, r); }
  // görsel: tercihen sıradaki karo sınırında yeni yola geç; değilse sürmekte olan parça bitince devam et
  let done = false;
  const X = canRetarget() ? voltiLegEnd() : -1;
  if (X >= 0 && st.sub) {
    const path = X === C ? [X] : walkCells(L, withP(base, X), C);
    if (path) { let ok = false; try { ok = !!PX.volti.retarget(path); } catch (e) { ok = false; }
      if (ok) { st.segs.length = 0; st.sub.after.p = C; st.sub.path = path; st.sub.steps = walkSteps(L, withP(base, X), C); st.segEnd = C; done = true; } }
  }
  if (!done) {
    const from = st.segEnd;                                     // sürmekte olan parçanın sonu
    st.segs.length = 0;
    if (from !== C) { const path = walkCells(L, withP(base, from), C); if (path) st.segs.push(path); }
  }
  // mantık
  if (!r) {                                                     // başlangıca geri: adım boşa düşer (0 Hamle)
    if (!st.void) { const i = G.hist.lastIndexOf(st); if (i >= 0) G.hist.splice(i, 1); addT(G.tot, st.c, -1); st.void = true; }
    st.a = { t: 'git', to: C }; st.after = base; G.s = base;
  } else {
    if (st.void) { G.hist.push(st); st.void = false; } else addT(G.tot, st.c, -1);
    st.a = { t: 'git', to: C }; st.after = r.s; st.c = r.c; st.tok = SIM.encodeAct(L, base, st.a); st.log = SIM.describe(L, base, st.a, r);
    addT(G.tot, r.c, 1); G.s = r.s;
  }
  st.cmd = cmd; st.chipAfter = chipAfter; G.redo.length = 0; G.won = SIM.won(L, G.s); G.chipPending = -1;
  if (chipAfter < 0) clearChips(); highlight(C);
  PX.bus.emit('cmd:accepted', { cmd, a: st.a, tok: st.void ? null : st.tok, retarget: true });
  return true;
}
function queuedCount() { let n = 0; for (const st of G.q) if (!st.internal) n++; return n; }
function makeStep(cmd, a, before, r, chipAfter) {
  const L = G.L;
  const kind = a.t === 'op' && L.els[a.e].t === 'toprak' ? 'earth' : KIND[a.t];
  const walk = kind === 'walk';
  return { id: ++G.seq, kind, cmd, a, tok: SIM.encodeAct(L, before, a), before, after: r.s, c: r.c,
    trips: (r.trips || []).map(i => (L.els[i] ? L.els[i].id : i)), log: SIM.describe(L, before, a, r),
    path: walk ? walkCells(L, before, a.to) : null, steps: walk ? walkSteps(L, before, a.to) : null, chipAfter, started: false, internal: false, void: false,
    segs: null, sub: null, segEnd: -1, segN: 0, chain: false, wonAfter: false };
}
function commit(cmd, a, chipAfter, internal) {
  const L = G.L;
  const r = SIM.apply(L, G.s, a);
  if (r.err) return rejectApply(cmd, a, r);
  if (!internal && queuedCount() >= QMAX) return reject(cmd, 'tampon', str('tampon'), { a });
  const st = makeStep(cmd, a, G.s, r, chipAfter);
  st.internal = !!internal;
  G.s = r.s; addT(G.tot, r.c, 1); G.hist.push(st); G.redo.length = 0; G.q.push(st);
  G.won = st.wonAfter = SIM.won(L, G.s); G.chipPending = -1;              // yeni komut bekleyen çip isteğini geçersiz kılar
  if (!cmd || cmd.t !== 'tap') G.chipsOn = false;                          // hud, dokunuş dışı her kabulde çipleri kendisi temizler
  if (st.kind === 'walk') highlight(a.to);
  PX.bus.emit('cmd:accepted', { cmd, a, tok: st.tok });
  pump();
  return true;
}

// ---------------------------------------------------------------- sunum hattı
// render'a giden kopya: before/after'a kameranın görünümü eklenir. Kopya uçuşta tutulur (G.inflight); yürürken
// döndürme after.v'yi günceller => adım sonundaki saf kurulum kamerayı asla geri çekmez.
function presentCopy(st) {
  const c = Object.assign({}, st, { before: withV(st.before), after: withV(st.after) });
  G.inflight = c; return c;
}
function pump() {
  while (!G.cur && G.q.length) {
    const st = G.q.shift(); G.cur = st; st.started = true;
    st.chain = G.chainFrom && st.kind === 'walk';                     // bir önceki yürüyüş az önce burada bitti
    startAnim(st);
  }
  G.chainFrom = false;
}
function startAnim(st) {
  const gen = G.gen;
  if (st.kind === 'walk') { st.segs = []; runSeg(st, gen, st.path && st.path.length > 1 ? st.path : [st.before.p, st.after.p], st.steps); return; }
  let p;
  try { p = PX.render.animate(presentCopy(st)); } catch (e) { console.error('[PX.game] animate', e); p = null; }
  Promise.resolve(p).then(() => { if (gen === G.gen && G.cur === st) finishStep(st); },
    e => { console.error('[PX.game] animate', e); if (gen === G.gen && G.cur === st) { PX.render.sync(presentCopy(st).after); finishStep(st); } });
}
function runSeg(st, gen, path, steps) {
  const end = path[path.length - 1];
  st.segEnd = end;
  const first = !st.sub;
  const L = G.L; const from = withP(st.before, path[0]);
  const sub = st.sub = { kind: 'walk', cmd: st.cmd, a: st.a, tok: st.tok, before: withV(from), after: withV(Object.assign({}, st.after, { p: end })),
    c: st.c, trips: [], log: null, path, steps: steps || walkSteps(L, from, end), chipAfter: -1, chain: first && st.chain };
  G.inflight = sub;
  const n = ++st.segN;                                          // bu parçanın Promise'i yalnız hâlâ geçerliyse sayılır
  let p;
  try { p = PX.render.animate(sub); } catch (e) { console.error('[PX.game] animate', e); p = null; }
  const live = () => gen === G.gen && G.cur === st && st.segN === n;
  const next = () => {
    if (!live()) return;
    const nx = st.segs.shift();
    if (nx && nx.length > 1) runSeg(st, gen, nx); else finishStep(st);
  };
  Promise.resolve(p).then(next, e => { console.error('[PX.game] animate', e); if (live()) PX.render.sync(sub.after); next(); });
}
function elecChanged(a, b) { return !a || a.b !== b.b || a.st !== b.st || a.lk !== b.lk || a.ch !== b.ch || a.sp !== b.sp || a.w !== b.w; }
function emitElec(s) {
  const L = G.L; const E = SIM.stateE(L, s);
  const liveNodes = []; for (let i = 0; i < L.nN; i++) if (E.live[i]) liveNodes.push(L.nodeNames[i]);
  const fedLoads = []; L.loads.forEach((l, i) => { if ((E.loadMask >> i) & 1) fedLoads.push(L.els[l.el].id); });
  const doors = (L.doors || []).map((d, di) => ({ el: L.els[d.el].id, open: SIM.doorOpen(L, s.b, s.lk, di) }));
  PX.bus.emit('elec:changed', { E, liveNodes, fedLoads, doors, s });
}
function finishStep(st) {
  G.cur = null; G.inflight = null;
  G.chainFrom = st.kind === 'walk';
  if (st.void) {
    if (!G.q.length) { highlight(-1); if (G.chipPending !== -1) emitChips(G.chipPending); else if (st.chipAfter >= 0) emitChips(st.chipAfter); G.chipPending = -1; PX.bus.emit('anim:done', { queueLen: 0 }); guideSoon(); }
    pump();
    return;
  }
  const prev = G.pres.s; G.pres.s = st.after; addT(G.pres.tot, st.c, 1);
  PX.bus.emit('anim:step', { kind: st.kind, a: st.a, tok: st.tok, before: st.before, after: st.after, c: st.c, trips: st.trips, log: st.log, tot: cp(G.pres.tot) });
  if (elecChanged(prev, st.after)) emitElec(st.after);
  lamp();
  const won = st.wonAfter;
  if (st.kind === 'walk' && !G.q.some(x => x.kind === 'walk')) highlight(-1);
  if (!G.q.length && !won) {
    if (G.chipPending !== -1) emitChips(G.chipPending);            // en son çip isteği kazanır
    else if (st.chipAfter >= 0) emitChips(st.chipAfter);
    G.chipPending = -1;
  }
  if (won && !G.pres.won) presentWin();
  if (!G.q.length) { PX.bus.emit('anim:done', { queueLen: 0 }); guideSoon(); }
  pump();
}
// Mühendis Mührü (§5.4): üç optimum aynı planda mümkünse üçü birden; değilse "cephedeki bir nokta + diğer ikisinin
// optimumu". ui/screens.js seals() ile aynı kural (controller listesi yetkili; ekran onu gösterir).
function muhendisOk(tot, o, frontK) {
  if (!o || !o.hamle || !o.manevra || !o.kesinti) return false;
  const joint = o.hamle[1] === o.manevra[1] && o.hamle[2] === o.kesinti[2];
  if (joint) return tot.h === o.hamle[0] && tot.m === o.manevra[1] && tot.k === o.kesinti[2];
  const onF = (tot.h === o.hamle[0] && tot.k === o.hamle[2]) || (tot.h === o.kesinti[0] && tot.k === o.kesinti[2])
    || (Array.isArray(frontK) && frontK.some(p => p[0] === tot.h && p[1] === tot.k));
  return onF && tot.m <= Math.max(o.hamle[1], o.kesinti[1]) && tot.o === 0;
}
function seals(tot, k) {
  const out = []; const o = k && k.opt; if (!o) return out;
  const Kx = o.kesinti && o.kesinti[2];
  if (!G.hinted && muhendisOk(tot, o, k.frontK)) out.push('muhendis');
  if (tot.k === 0 && Kx === 0) out.push('sifirKesinti');
  if (tot.o === 0 && !G.hinted) out.push('temiz');
  const onFront = (f, a, b, ends) => Array.isArray(f) && f.some(p => p[0] === a && p[1] === b && !ends.some(e => e[0] === p[0] && e[1] === p[1]));
  if (onFront(k.frontK, tot.h, tot.k, [[o.hamle[0], o.hamle[2]], [o.kesinti[0], o.kesinti[2]]])
    || onFront(k.frontM, tot.h, tot.m, [[o.hamle[0], o.hamle[1]], [o.manevra[0], o.manevra[1]]])) out.push('pareto');
  return out;
}
function presentWin() {
  G.pres.won = true; setGuide(null);
  const ghost = tokens(); const tot = cp(G.pres.tot); const k = G.lv.kanit || {};
  try { if (PX.store && PX.store.recordWin) PX.store.recordWin(G.id, tot, ghost); } catch (e) { console.error('[PX.game] recordWin', e); }
  if (!instant() && PX.volti && PX.volti.play) {
    G.celebrating = true; const gen = G.gen;
    Promise.resolve(PX.volti.play('win', {})).then(() => { if (gen === G.gen) G.celebrating = false; }, () => { G.celebrating = false; });
  }
  PX.bus.emit('win', { id: G.id, tot, opt: k.opt || null, front: k.frontK || null, frontM: k.frontM || null, seals: seals(tot, k), ghost, hinted: G.hinted });
  // sonraki seviyeyi panel açıkken derle (§12.3 "Sonraki hazır")
  const i = (PX.LEVELS || []).findIndex(l => l.id === G.id);
  if (i >= 0 && i + 1 < PX.LEVELS.length) { const nid = PX.LEVELS[i + 1].id; setTimeout(() => precompile(nid), 0); }
}
function skipCelebration() {
  if (!G.celebrating) return false;
  G.celebrating = false;
  if (PX.volti && PX.volti.cancel) PX.volti.cancel();
  if (G.pres.s) PX.render.sync(withV(G.pres.s));
  return true;
}
function tokens() { return G.hist.map(h => h.tok).join(' '); }

// ---------------------------------------------------------------- geri al / yinele / baştan (anında, tampon dışı)
// Geri alma birimi bir komuttur (bir dokun-yürü koşusu ya da bir işlem). Döndürme geçmişe girmez.
function undo() {
  if (!G.L || !G.hist.length) return false;
  const st = G.hist.pop(); G.redo.push(st);
  addT(G.tot, st.c, -1); G.s = st.before; G.won = SIM.won(G.L, G.s);
  const qi = G.q.indexOf(st);
  if (qi >= 0) {
    G.q.splice(qi, 1);                                          // henüz oynamamış: yalnız kuyruktan çık
  } else {
    // st oynuyordu ya da sunulmuştu (kuyrukta ondan sonra bir şey yok): FX iptal + saf yeniden kurulum (§12.4)
    cancelAnims();
    const was = G.pres.s;
    G.pres.s = G.s; G.pres.tot = cp(G.tot); G.pres.won = false;
    // yürüyüşün geri alınması elektriği değiştirmez: tek hat olayı yalnız gerçekten değiştiyse
    PX.render.sync(withV(G.s)); if (elecChanged(was, G.s)) emitElec(G.s);
  }
  if (!G.q.some(x => x.kind === 'walk') && !(G.cur && G.cur.kind === 'walk')) highlight(-1);
  G.chipPending = -1; G.chipsOn = false; if (G.sel >= 0) { G.sel = -1; focusChanged(); }   // hud geri al/yinele/baştan'da çipleri temizler
  PX.bus.emit('undo', { s: G.s, tot: cp(G.pres.tot) });
  lamp(); pump(); if (!G.cur && !G.q.length) guideSoon();
  return true;
}
function redo() {
  if (!G.L || !G.redo.length || G.won) return false;
  const st = G.redo[G.redo.length - 1];
  const r = SIM.apply(G.L, G.s, st.a);
  if (r.err) { G.redo.length = 0; return reject({ t: 'redo' }, r.err, r.msg); }
  if (queuedCount() >= QMAX) return reject({ t: 'redo' }, 'tampon', str('tampon'));
  G.redo.pop();
  const ns = makeStep({ t: 'redo' }, st.a, G.s, r, -1);
  G.s = r.s; addT(G.tot, r.c, 1); G.hist.push(ns); G.q.push(ns); G.won = ns.wonAfter = SIM.won(G.L, G.s);
  if (ns.kind === 'walk') highlight(st.a.to);
  G.chipPending = -1; G.chipsOn = false;
  PX.bus.emit('redo', { s: G.s, tot: cp(G.pres.tot) });
  lamp(); pump();
  return true;
}
function reset() {
  if (!G.L) return false;
  cancelAnims();
  Object.assign(G, { s: G.s0, tot: z(), hist: [], redo: [], q: [], won: SIM.won(G.L, G.s0), chipPending: -1, chipsOn: false, hinted: false, sel: -1 });
  G.pres = { s: G.s0, tot: z(), won: false };
  highlight(-1);
  PX.render.sync(withV(G.s0)); emitElec(G.s0);
  PX.bus.emit('reset', { s: G.s0, tot: z() });
  lamp(); guideSoon();
  return true;
}
// lamba SUNUM durumunu gösterir (§12.5); yalnız değişince yayılır
function lamp(force) {
  const s = G.pres.s; const d = PX.solver && PX.solver.dist && s ? PX.solver.dist(s) : null;
  const state = d === null || d === undefined ? 'busy' : d < 0 ? 'dead' : 'ok', dist = d === undefined ? null : d;
  if (!force && G.lampS === state && G.lampD === dist) return;
  G.lampS = state; G.lampD = dist;
  PX.bus.emit('lamp', { state, dist });
}

// ---------------------------------------------------------------- önizleme
function preview(a, from) {
  const L = G.L, s = from || G.s; const r = SIM.apply(L, s, a);
  if (r.err) return { ok: false, err: r.err, msg: r.msg, olu: [], canli: [], kesintiDelta: 0, yedekDelta: 0, manevraDelta: 0 };
  const E0 = SIM.stateE(L, s), E1 = SIM.stateE(L, r.s); const olu = [], canli = [];
  for (let i = 0; i < L.nN; i++) { if (E0.live[i] && !E1.live[i]) olu.push(L.nodeNames[i]); else if (!E0.live[i] && E1.live[i]) canli.push(L.nodeNames[i]); }
  return { ok: true, olu, canli, kesintiDelta: SIM.kesintiOf(L, E1) - SIM.kesintiOf(L, E0), yedekDelta: r.s.sp - s.sp, manevraDelta: r.c.m, c: r.c,
    trips: (r.trips || []).map(i => (L.els[i] ? L.els[i].id : i)) };
}

// ---------------------------------------------------------------- amaç: odak (örtücü hedefleri) + rehber
// render'ın yarı saydam yapacağı örtücülerin hedefleri (sim2.occluders biçimi). Yalnız olay anında hesaplanır.
function focusTargets() {
  const L = G.L; if (!L || !G.s) return [];
  const out = []; const ps = (G.pres.s || G.s).p; const [x, y, zz] = L.G.xyz(ps); out.push([x, y + 1, zz]);
  if (G.sel >= 0 && L.els[G.sel] && L.els[G.sel].cell >= 0) out.push(L.els[G.sel].cell);
  const cur = G.cur && G.cur.kind === 'walk' ? (G.cur.sub || G.cur) : null;
  const steps = cur && cur.steps ? cur.steps : null;
  if (steps) for (const st of steps) out.push(st.k === 'karo' ? [st.x, st.y, st.z] : st.c);
  else if (G.hl >= 0) { const [a, b, c] = L.G.xyz(G.hl); out.push([a, b + 1, c]); }
  if (L.work >= 0) { const [a, b, c] = L.G.xyz(L.work); out.push([a, b + 1, c]); }
  if (G.guide && G.guide.cell >= 0) out.push(G.guide.cell);
  return out;
}
// Bir sonraki karede (rAF) yayılır: dokunuşun ilk hareket karesi örtücü saydamlığının (yeni malzeme/program) işinden
// önce çizilir (§12.3 dokunuş -> ilk hareket); saydamlık geçişi zaten 120 ms. Aynı karedeki değişiklikler birleşir.
let focusPending = false;
const nextFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : f => Promise.resolve().then(f);
function focusChanged() {
  if (focusPending) return; focusPending = true;
  nextFrame(() => { focusPending = false; if (!G.L) return;
    const path = G.cur && G.cur.kind === 'walk' ? ((G.cur.sub && G.cur.sub.path) || G.cur.path || []) : [];
    PX.bus.emit('focus', { el: G.sel, path, targets: focusTargets(), view: G.camV }); });
}
// rehber (rehber: true seviyeler): sıradaki ANAHTAR eylemin cihazı/karosu vurgulanır (ipucu tablosunun el/cell
// alanı; metin duvarı yok). Oyuncu sapınca vurgu yeni plana geçer. Ücretsizdir (ipucu sayılmaz).
function guideSoon() {
  const lv = G.lv; if (!lv || !lv.rehber || !G.L) { if (G.guide) setGuide(null); return; }
  if (G.won || G.cur || G.q.length) return;
  const L = G.L, s = G.s; let key = -1; try { key = SIM.key(L, s); } catch (e) { key = -1; }
  if (key === G.guideKey && G.guide) { applyGuide(); return; }
  const seq = ++G.guideSeq;
  const done = r => {
    if (seq !== G.guideSeq || G.L !== L || G.s !== s || G.won) return;
    if (!r) return;
    const cell = typeof r.cell === 'number' && r.cell >= 0 ? r.cell : (r.el && L.elIndex[r.el] !== undefined ? L.els[L.elIndex[r.el]].cell : -1);
    G.guideKey = key; setGuide(cell >= 0 ? { cell, el: r.el || null, tok: r.a || r.tok || null, why: r.why || '' } : null);
  };
  try {
    if (PX.solver && PX.solver.dist && PX.solver.dist(s) !== null && PX.solver.hint) {
      PX.solver.hint(s, 1, 'hamle').then(r => { if (r && !r.stale && !r.busy && !r.dead) done(r); }, () => {});
    } else if (PX.solver && PX.solver.abstractHint) {
      const ah = PX.solver.abstractHint(s);
      if (ah && ah.partial && ah.later) ah.later.then(x => done(x && { el: x.el, a: x.tok, why: x.why }), () => {});
      else if (ah) done({ el: ah.el, a: ah.tok, cell: ah.tok === 'c' ? L.work : undefined, why: ah.why });
    }
  } catch (e) { /* rehber isteğe bağlı */ }
}
function applyGuide() {
  if (!G.guide || !PX.diorama || !PX.diorama.highlight) return;
  try { PX.diorama.highlight(G.guide.cell, 'ipucu'); } catch (e) { /* yoksay */ }
}
function setGuide(g) {
  const prev = G.guide; G.guide = g;
  if (!g && prev && PX.diorama && PX.diorama.highlight) { try { PX.diorama.highlight(-1, 'ipucu'); } catch (e) { /* yoksay */ } }
  if (g) applyGuide();
  if ((prev && prev.cell) !== (g && g.cell)) { PX.bus.emit('guide', g || { cell: -1, el: null }); focusChanged(); }
}

// Kare başına (main döngüsü, Volti'den önce): ardışık yürüyüşlerde DURMADAN devam (§12.3 "yürüme içi duraklama 0").
// Ayırmasız: yalnız sayılar ve var olan nesneler.
function update() {
  const st = G.cur;
  if (!st || st.kind !== 'walk' || !st.sub || st.segs.length || instant()) return;
  const V = PX.volti; if (!V || typeof V.legEnd !== 'function' || !V.moving) return;
  const nx = G.q.length ? G.q[0] : null;
  if (!nx || nx.kind !== 'walk' || nx.void) return;
  const end = st.segEnd; if (nx.before.p !== end) return;
  if (V.legEnd() !== end || V.probe().cell !== end) return;
  st.segN++;                                                    // bu parçanın (artık yeniden hedeflenecek) Promise'i yok sayılır
  finishStep(st);
}
function state() {
  return { id: G.id, s: G.s, view: G.camV, tot: cp(G.tot), won: G.won, presentation: { tot: cp(G.pres.tot), s: G.pres.s, won: G.pres.won },
    queue: G.q.length, busy: !!G.cur || G.q.length > 0, hist: G.hist.length, redo: G.redo.length, camV: G.camV, celebrating: G.celebrating };
}
function explainTarget(t) {
  const L = G.L; if (!L || !G.s) return null;
  const tg = typeof t === 'number' ? { e: t } : typeof t === 'string' ? { e: L.elIndex[t] } : t;
  try { return SIM.explain(L, G.s, tg); } catch (e) { return { err: 'ulasilamaz', msg: str('ulasilamaz') }; }
}
function init() {
  PX.bus.on('solver:ready', () => { if (G.L) { lamp(); guideSoon(); } });
  // Yalnız oyuncuya ulaşan öneri ipucu sayılır; hesaplanıyor/çıkmaz/eski yanıt mühürleri düşürmez.
  PX.bus.on('hint', p => { if (G.L && p && !p.free && !p.dead && (p.a || p.el || (p.acts && p.acts.length))) G.hinted = true; });
}
PX.game = {
  init, load, command, state, preview, tokens, skipCelebration, precompile, update, focusTargets,
  explain: explainTarget,
  checklist(s) { const L = G.L; if (!L) return []; try { return SIM.checklist(L, s || G.pres.s || G.s); } catch (e) { return []; } },
  setInstant(on) { PX.render.instant = !!on; },
  get L() { return G.L; }, get level() { return G.lv; }, get busy() { return !!G.cur || G.q.length > 0; },
  get camView() { return G.camV; }, get selected() { return G.sel; }, get guide() { return G.guide; },
};
