// ============================================================================
// game/hint.js — PX.hint : iki kademeli ipucu (kural dürtmesi / hayalet adım), metrik seçimi (§5.6, §23.3-6)
//                                                                               sahip: Kurallar
//   PX.hint.request(tier 1|2, opts?) -> Promise<{tier, metric, acts:[simge], why, el, cell, dead, abstract, undo}>
//        ayrıca bus 'hint' olayı aynı yükle. tier 1 = kural dürtmesi (sıradaki optimum eylem + nedeni, şablondan:
//        sim2.apply ret kodu + describe adları), tier 2 = hayalet adım (sıradaki segment hayalet Volti ile oynatılır).
//   PX.hint.metric  (get/set: 'hamle'|'manevra'|'kesinti'|'olay' ya da kısa h|m|k|o; ayar.ipucuMetrik'e kısa kod
//                   kaydedilir; HUD'un 'ui:metric' {m} olayını izler; değişince 'hint:metric' {metric})
//   Sonuçta r.a = sıradaki ANAHTAR eylemin simgesi (yürüyüş değil), r.el/r.cell = cihaz ve hücresi.
//   Kural sürümü 4: döndürme ve izdüşüm yok; plan yalnız yürüyüş (g) + cihaz/iş eylemlerinden oluşur.
//   PX.hint.used    bu koşuda (yükleme/Baştan'dan beri) ücretli ipucu alındı mı. Çıkmaz ipucu ücretsizdir, sayılmaz.
//   PX.hint.explain(L, s, r)  r.plan'dan metin üretir (solverClient çağırır)   PX.hint.stopDemo()
// Tablo hazır değilse PX.solver.abstractHint (yalnız elektrik). Asla yanlış "Çıkmaz" demez (yalnız tablo -1 derse).
// Kazanınca ipucu kullanıldıysa store'daki seviye kaydına ipuclu=true yazılır (Temiz İşçilik / Mühendis Mührü verilmez).
// ============================================================================
const SIM = PX.SIM;
const METRICS = ['hamle', 'manevra', 'kesinti', 'olay'];
const MNAME = { hamle: 'Hamle', manevra: 'Manevra', kesinti: 'Kesinti', olay: 'Olay' };
// erişim/konum retleri neden sayılmaz (yürüyüş planın parçası): uzak, zaten, yol/kapı/bölge engelleri ayrıca açıklanır
const NOREASON = { ulasilamaz: 1, dogrulanamadi: 1, uzak: 1, zaten: 1, yol_yok: 1, gecersiz: 1 };
const H = { metric: null, used: false, rej: null, inited: false, demo: false, seq: 0 };

function str(k, d) { return (PX.STR && typeof PX.STR[k] === 'string') ? PX.STR[k] : d; }
function errMsg(e) { return (PX.STR && PX.STR.ERR && PX.STR.ERR[e]) || (SIM.ERR && SIM.ERR[e]) || e; }
function nameOf(el) { return el ? (el.ad ? el.id + ' (' + el.ad + ')' : el.id) : ''; }

// ---------------------------------------------------------------- metrik seçimi
// Arayüz (ui/hud.js) kısa kodları kullanır: h|m|k|o (ayar.ipucuMetrik ve 'ui:metric' {m}). İkisi de kabul edilir;
// kayda kısa kod yazılır (HUD ile aynı biçim).
const SHORT = { h: 'hamle', m: 'manevra', k: 'kesinti', o: 'olay' };
const LONG = { hamle: 'h', manevra: 'm', kesinti: 'k', olay: 'o' };
function norm(m) { return METRICS.indexOf(m) >= 0 ? m : (SHORT[m] || null); }
function getMetric() {
  if (H.metric) return H.metric;
  let m = null; try { m = PX.store && PX.store.get ? PX.store.get('ayar.ipucuMetrik') : null; } catch (e) { m = null; }
  H.metric = norm(m) || 'hamle';
  return H.metric;
}
function setMetric(m, quiet) {
  m = norm(m); if (!m) return false;
  const changed = H.metric !== m; H.metric = m;
  if (!quiet) try { if (PX.store && PX.store.set) PX.store.set('ayar.ipucuMetrik', LONG[m]); } catch (e) { /* kayıt kapalı */ }
  if (changed && PX.bus) PX.bus.emit('hint:metric', { metric: m });
  return true;
}

// ---------------------------------------------------------------- metin şablonları
function verb(L, s, a) {
  const el = a.e !== undefined ? L.els[a.e] : null;
  switch (a.t) {
    case 'op': { const kap = !((s.b >> el.bit) & 1);
      if (el.t === 'toprak') return kap ? 'gerilim yokluğunu tespit et ve topraklamayı kapat' : 'topraklama ayırıcısını aç';
      return kap ? 'kapat' : 'aç'; }
    case 'kilit': return 'kilitle ve etiketle';
    case 'kilitac': return 'kilidini ve etiketini kaldır';
    case 'degistir': return 'NH sigorta bıçağını yedekle değiştir';
    case 'bas': return 'butonuna bas';
    case 'set': return s.st ? 'taşınabilir topraklamayı sök' : 'taşınabilir topraklamayı tak';
    case 'calis': return 'işi yap';
    case 'bekle': return 'kondansatör deşarjını bekle';
  }
  return '';
}
function lower(t) { return /^(İş|Kondansatör)/.test(t) ? t.charAt(0).toLocaleLowerCase('tr') + t.slice(1) : t; }
function phrase(L, s, a, cap) {
  const el = a.e !== undefined ? L.els[a.e] : null;
  if (!el) { const v = verb(L, s, a); return cap ? v.charAt(0).toLocaleUpperCase('tr') + v.slice(1) : v; }
  return nameOf(el) + ': ' + verb(L, s, a);
}
// gereklilik kipi (edilgen): "Q01 (Fider kesicisi) açılmalı" — Türkçe ek uyumu kod adlarına bağlı kalmaz
function must(L, s, a) {
  const el = a.e !== undefined ? L.els[a.e] : null; const nm = nameOf(el);
  switch (a.t) {
    case 'op': { const kap = !((s.b >> el.bit) & 1);
      if (el.t === 'toprak') return nm + (kap ? ' gerilim yokluğu tespit edilip kapatılmalı (topraklama)' : ' açılmalı (topraklama kaldırılır)');
      return nm + (kap ? ' kapatılmalı' : ' açılmalı'); }
    case 'kilit': return nm + ' kilitlenip etiketlenmeli';
    case 'kilitac': return nm + ' kilidi ve etiketi kaldırılmalı';
    case 'degistir': return nm + ' NH sigorta bıçağı yedekle değiştirilmeli';
    case 'bas': return nm + ' butonuna basılmalı';
    case 'set': return nm + (s.st ? ' taşınabilir topraklaması sökülmeli' : ' taşınabilir topraklaması takılmalı');
    case 'calis': return 'İş noktasında iş yapılmalı';
    case 'bekle': return 'Kondansatör deşarjı beklenmeli';
  }
  return '';
}
function negative(L, s, a, same) {
  const el = a.e !== undefined ? L.els[a.e] : null; const nm = same ? 'cihaz' : nameOf(el);
  switch (a.t) {
    case 'op': { const kap = !((s.b >> el.bit) & 1); if (el.t === 'toprak') return nm + (kap ? ' topraklanamaz' : ' açılamaz'); return nm + (kap ? ' kapatılamaz' : ' açılamaz'); }
    case 'kilit': return nm + ' kilitlenemez';
    case 'kilitac': return nm + ' kilidi kaldırılamaz';
    case 'degistir': return nm + ' sigortası değiştirilemez';
    case 'bas': return nm + ' butonuna basılamaz';
    case 'set': return nm + (s.st ? ' taşınabilir topraklaması sökülemez' : ' taşınabilir topraklama takılamaz');
    case 'calis': return 'iş yapılamaz';
    case 'bekle': return 'beklenemez';
  }
  return '';
}
function loadNames(L, mask) {
  const out = []; L.loads.forEach((l, i) => { if (l.req && ((mask >> i) & 1)) { const el = L.els[l.el]; out.push(el.ad || el.id); } });
  return out.length > 1 ? out.slice(0, -1).join(', ') + ' ve ' + out[out.length - 1] : out.join('');
}
// eylemin etkisinden neden (bloklanan izleyici bulunamazsa)
function effectReason(L, st) {
  const a = st.a, before = st.before, after = st.after; const el = a.e !== undefined ? L.els[a.e] : null;
  switch (a.t) {
    case 'calis': return 'İş bölgesi ölü, sabit bağlantıyla topraklı ve kilitli ayrılmış: iş yapılabilir.';
    case 'kilit': return 'Görünür ayırma noktası kilitlenip etiketlenir (beş altın kuralın ikincisi): kimse geri kapatamaz.';
    case 'kilitac': return 'Topraklama kalktı: kilit kaldırılabilir, bölüm yeniden enerjilenmeye hazır.';
    case 'set': return before.st ? 'Geri verme sırası: önce topraklama kaldırılır, sonra kilit.' : 'Gerilim yokluğu tespit edilip topraklanır ve kısa devre edilir (dördüncü kural).';
    case 'degistir': return 'Eriyen NH bıçağı yalnız iki taraf ölüyken yedekle değiştirilir.';
    case 'bekle': return 'Kondansatör deşarj olmadan enerji verilemez ve topraklanamaz.';
  }
  if (el && el.t === 'toprak') return ((before.b >> el.bit) & 1) ? 'Geri verme sırası: önce topraklama kaldırılır, sonra kilit.' : 'Gerilim yokluğu tespit edilip topraklanır ve kısa devre edilir (dördüncü kural).';
  const E0 = SIM.stateE(L, before), E1 = SIM.stateE(L, after);
  const gain = E1.loadMask & ~E0.loadMask, lost = E0.loadMask & ~E1.loadMask;
  if (gain && loadNames(L, gain)) return 'Bu manevra ' + loadNames(L, gain) + ' beslemesini geri verir.';
  if (el && el.bit !== undefined && ((L.posMask >> el.bit) & 1)) {
    const want = (L.posVal >> el.bit) & 1, now = (after.b >> el.bit) & 1;
    if (want === now) return 'Normal işletme konumu: ' + el.id + (want ? ' kapalı' : ' açık') + ' olmalı.';
  }
  if (lost && loadNames(L, lost)) return 'Bu adımda ' + loadNames(L, lost) + ' beslemesiz kalır; seçili metrik için en iyi yol bunu kabul ediyor.';
  if (el && el.t === 'kesici' && !((after.b >> el.bit) & 1)) return 'Yük akımını kesici keser: ayırıcıdan önce kesici açılır.';
  if (el && el.t === 'yuk_ayirici' && !((after.b >> el.bit) & 1)) return 'Yük ayırıcısı yük ve halka akımını açabilir (arıza akımını değil).';
  return '';
}
// plan dizgisinden metin üretir; r.why, r.el, r.cell, r.a doldurulur
function explain(L, s, r) {
  const steps = []; let x = s;
  for (const tok of r.plan || []) {
    const a = SIM.decodeAct(L, x, tok); if (!a) break;
    const res = SIM.apply(L, x, a); if (res.err) break;
    steps.push({ a, tok, before: x, after: res.s, c: res.c }); x = res.s;
  }
  let i = -1; for (let j = 0; j < steps.length; j++) if (steps[j].a.t !== 'git') { i = j; break; }
  const mp = r.metric && r.metric !== 'hamle' ? MNAME[r.metric] + ' hedefi — ' : '';
  if (i < 0) { r.why = steps.length ? mp + 'Hedef karoya yürü.' : ''; return r; }
  const st = steps[i], a = st.a, el = a.e !== undefined ? L.els[a.e] : null;
  r.a = st.tok; r.el = el ? el.id : null; r.cell = el ? el.cell : (a.t === 'calis' ? L.work : -1);
  // erişim: cihaza giden yol bir merdiven/iskele ya da kapıdan geçiyorsa söylenir (fiziksel rota)
  let nav = '';
  if (i > 0) { const w = steps.slice(0, i).filter(z => z.a.t === 'git'); let k = '';
    for (const z of w) { const path = SIM.walkPath(L, z.before, z.a.to) || []; if (path.some(q => q.k === 'merdiven')) k = k || 'merdiven'; if (path.some(q => q.k === 'iskele')) k = 'iskele'; }
    if (k) nav = k === 'iskele' ? ' (Oraya iskeleden çıkılır.)' : ' (Oraya merdivenden gidilir.)'; }
  // 1) oyuncunun bu durumda reddedilen son denemesi
  let rej = '';
  if (H.rej && r.key !== undefined && H.rej.key === r.key && !NOREASON[H.rej.err]) rej = 'Son deneme reddedildi: ' + errMsg(H.rej.err) + ' ';
  // 2) bu eylemin AÇTIĞI bir sonraki plan eylemi: şimdi reddedilir (ret kodu), eylemden sonra yasal (describe adları)
  let why = '';
  for (let j = i + 1; j < steps.length && j <= i + 14 && !why; j++) {
    const b = steps[j]; if (b.a.t === 'git') continue;
    const x0 = st.before, x1 = st.after;
    const y0 = { p: b.before.p, b: x0.b, lk: x0.lk, sp: x0.sp, st: x0.st, ch: x0.ch, w: x0.w };
    const y1 = { p: b.before.p, b: x1.b, lk: x1.lk, sp: x1.sp, st: x1.st, ch: x1.ch, w: x1.w };
    let r0 = null, r1 = null; try { r0 = SIM.apply(L, y0, b.a); r1 = SIM.apply(L, y1, b.a); } catch (e) { r0 = null; }
    if (r0 && r0.err && !NOREASON[r0.err] && r1 && !r1.err) why = 'Önce ' + must(L, x0, a) + '. Bu yapılmadan ' + negative(L, y0, b.a, b.a.e !== undefined && b.a.e === a.e) + ' — ' + errMsg(r0.err);
  }
  if (!why) { const eff = effectReason(L, st); why = 'Sıradaki manevra: ' + must(L, st.before, a) + '.' + (eff ? ' ' + eff : ''); }
  if (r.tier === 2) {
    const walks = steps.slice(0, i).filter(z => z.a.t === 'git').length;
    r.why = mp + str('ipucu2', 'Hayalet adım') + ': ' + (walks ? 'yürü' + (nav ? (nav.indexOf('iskele') >= 0 ? ' (iskeleden çık)' : ' (merdivenden)') : '') + ', ' : '') + 'sonra ' + lower(must(L, st.before, a)) + '.';
  } else r.why = mp + rej + why + nav;
  return r;
}

// ---------------------------------------------------------------- istek
function emit(r) {
  if (r && !r.free && !r.dead && (r.a || r.el || (r.acts && r.acts.length))) H.used = true;
  if (PX.bus) PX.bus.emit('hint', r); return r;
}
function deadEnd(L, s, tier) {
  // geçmişi yeniden oynatıp çözülebilir son durumu bul: kaç adım geri alınmalı
  let undo = 0, culprit = '';
  try {
    const toks = PX.game.tokens ? PX.game.tokens().trim() : '';
    const list = toks ? toks.split(/\s+/) : [];
    const states = [SIM.initState(L)];
    for (const t of list) { const x = states[states.length - 1]; const a = SIM.decodeAct(L, x, t); if (!a) break; const res = SIM.apply(L, x, a); if (res.err) break; states.push(res.s); }
    for (let i = states.length - 1; i >= 0; i--) { const d = PX.solver.dist(states[i]); if (d !== null && d >= 0) { undo = states.length - 1 - i; if (i < list.length) { const a = SIM.decodeAct(L, states[i], list[i]); const res = a && SIM.apply(L, states[i], a); culprit = a && res && !res.err ? (SIM.describe(L, states[i], a, res) || '') : ''; } break; } }
  } catch (e) { undo = 0; }
  const why = str('cikmaz', 'Çıkmaz') + ' — ' + (undo ? undo + ' adım ' + str('geriAl', 'Geri Al') : str('geriAl', 'Geri Al') + '?') + (culprit ? ' (hedefe dönüş «' + culprit + '» sonrası kapandı)' : '');
  return { tier, metric: getMetric(), acts: [], plan: [], why, dead: true, undo, free: true };
}
function request(tier, opts) {
  init();
  const seq = ++H.seq; stopDemo();                              // ücretsiz/boş yeni yanıt da eski isteği geçersiz kılar
  tier = tier === 2 ? 2 : 1; opts = opts || {};
  const st = PX.game && PX.game.state ? PX.game.state() : null; const L = PX.game && PX.game.L;
  if (!st || !st.s || !L || st.won) return Promise.resolve(null);
  const s = st.s, metric = norm(opts.metric) || getMetric();
  const d = PX.solver ? PX.solver.dist(s) : null;
  if (d === -1) return Promise.resolve(emit(deadEnd(L, s, tier)));            // çıkmaz: ücretsiz, sayılmaz
  if (d === null) {
    // Tablo hazır değil: yalnız-elektrik soyutlaması. Bütçe yetmezse önce "Hesaplanıyor…" yayılır, arama arka planda
    // sürer; bulununca (durum ve seviye aynıysa) ikinci bir 'hint' olayı {update:true} yayılır. Tablo bu arada hazır
    // olduysa tam (tablolu) ipucu istenir.
    const ah = PX.solver ? PX.solver.abstractHint(s) : { el: null, why: str('hesaplaniyor', 'Hesaplanıyor…') };
    const r = absHint(L, tier, metric, ah);
    emit(r);
    if (!ah.partial || !ah.later) return Promise.resolve(r);
    return ah.later.then(res => {
      if (seq !== H.seq || !PX.game.state || PX.game.state().s !== s) return r;
      if (PX.solver.dist(s) !== null) return request(tier, Object.assign({}, opts, { retried: true }));
      if (!res) return r;
      return emit(Object.assign(absHint(L, tier, metric, res), { update: true }));
    });
  }
  return PX.solver.hint(s, tier, metric).then(r => {
    if (seq !== H.seq) return null;                                            // daha yeni bir istek var
    const cur = PX.game.state();
    if (r.stale || cur.s !== s) {                                              // durum değişti: bir kez yeniden iste
      if (opts.retried || !cur.s || cur.won) return null;
      return request(tier, Object.assign({}, opts, { retried: true }));
    }
    if (r.busy) r = absHint(L, tier, metric, PX.solver.abstractHint(s));
    if (r.dead) return emit(deadEnd(L, s, tier));
    if (tier === 2 && r.acts.length && PX.ghost && PX.ghost.play && opts.demo !== false) {
      H.demo = seq;
      const done = () => { if (H.demo === seq) H.demo = false; };
      Promise.resolve(PX.ghost.play(r.acts.join(' '), { from: s, speed: 1, demo: true, id: PX.game.level && PX.game.level.id })).then(done, done);
    }
    return emit(r);
  });
}
function absHint(L, tier, metric, ah) {
  const r = { tier, metric, acts: ah.tok ? [ah.tok] : [], plan: [], a: ah.tok || null, why: ah.why, el: ah.el,
    cell: ah.el && L.elIndex[ah.el] !== undefined ? L.els[L.elIndex[ah.el]].cell : -1, abstract: true, partial: !!ah.partial, dead: false };
  return r;
}
function stopDemo() { if (H.demo && PX.ghost && PX.ghost.stop) PX.ghost.stop(); H.demo = false; }
function init() {
  if (H.inited || !PX.bus) return; H.inited = true;
  PX.bus.on('level:loaded', () => { H.used = false; H.rej = null; H.seq++; stopDemo(); });
  PX.bus.on('reset', () => { H.used = false; H.rej = null; H.seq++; stopDemo(); });
  PX.bus.on('undo', () => { stopDemo(); });
  PX.bus.on('ui:metric', p => { if (p) setMetric(p.m || p.metric, true); });          // HUD seçicisi (kaydı HUD yazar)
  PX.bus.on('settings', p => { if (p && p.ayar) setMetric(norm(p.ayar.ipucuMetrik) || 'hamle', true); });
  PX.bus.on('cmd:accepted', () => { H.rej = null; stopDemo(); });
  PX.bus.on('cmd:rejected', p => {
    try { const L = PX.game.L, s = PX.game.state().s; if (L && s && p && p.err && SIM.ERR[p.err]) H.rej = { err: p.err, key: SIM.key(L, s) }; } catch (e) { /* yoksay */ }
  });
  PX.bus.on('win', p => {
    if (!H.used || !p || !PX.store || !PX.store.level) return;
    try { const rec = PX.store.level(p.id); if (rec && !rec.ipuclu) { rec.ipuclu = true; if (PX.store.save) PX.store.save(); } } catch (e) { /* kayıt kapalı */ }
  });
}
if (PX.bus) init();
PX.hint = {
  request, explain, stopDemo, setMetric, METRICS,
  get metric() { return getMetric(); }, set metric(m) { setMetric(m); },
  get used() { return H.used; },
};
