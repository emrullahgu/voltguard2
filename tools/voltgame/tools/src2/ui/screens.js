// ============================================================================
// ui/screens.js — PX.screens : açılış (Volti öz-testi), seviye seçme (PX.world), iş emri kartı, kazanma paneli
//                 (metrikler + doğrulanmış Pareto cephesi + dürüst çözüm uzayı), Manevra Defteri, duraklat menüsü,
//                 ayarlar, kod yapıştır, Günün Manevrası (§11.1, §5, §24.7)                     sahip: UI
// Akış: Açılış → (Devam et: sıradaki iş emri kartı | Seviye Seç) → İş Emri kartı → Diorama → Kazanma paneli
//       (Sonraki = varsayılan, ≤ 300 ms oynanabilir; Harita isteğe bağlı) → …
// Doğrudan bağlantı (?lvl=, Game.load) kart göstermeden oynatır: play(id) = yükle ve oyna.
// Geçişler 150–220 ms opaklık+öteleme (.ov), kesilebilir; hareketAzalt/prefers-reduced-motion ile 0. Karanlık desen
// yok: zamanlayıcı, seri, bildirim, enerji, reklam, satın alma yok; "N gün oynandı" tek sayaçtır.
//   PX.screens.init()  .show('title'|'levels'|'game'|'win')  .current  .play(id, {card?, peek?}) -> Promise
//   .workOrder(lv, opts)  .menu()  .settings()  .defter()  .codePaste(kod?)  .playDaily(tarih?)  .noteHint()
//   [data-testid=title-screen] btn-play · [data-testid=level-select] · [data-testid=win-panel] btn-next · btn-map
// ============================================================================
const $ = id => document.getElementById(id);
const SIM = PX.SIM;
const T = () => PX.STR;
const h = function () { return PX.cards.h.apply(null, arguments); };
const G = { current: 'title', lastWin: null, hinted: false, daily: null, winTimer: 0, winBuilt: null, defterH: null, chartMode: 'k' };

// ---------------------------------------------------------------- ekranlar
function show(name) {
  G.current = name;
  $('scr-title').classList.toggle('on', name === 'title');
  $('scr-levels').classList.toggle('on', name === 'levels');
  $('win-panel').classList.toggle('on', name === 'win');
  $('app').classList.toggle('ingame', name === 'game' || name === 'win');
  if (name === 'levels' && PX.world) { PX.world.render($('level-list')); levelsScroll(); }
  if (name === 'title') titleRefresh();
  if (PX.scene && PX.scene.resize) PX.scene.resize(false);
  if (name === 'win') { const b = $('btn-next'); try { (b.hidden ? $('btn-map') : b).focus({ preventScroll: true }); } catch (e) { /* yoksay */ } }
  PX.bus.emit('screen', { name });
}
// Seviye Seç açılışı: PX.world sıradaki iş emrini ortalar (rAF). Henüz kampanyada çözülmüş iş emri yoksa ya da sıradaki
// iş emri liste başından görülebiliyorsa liste EN ÜSTTEN açılır: "Günün Manevrası" kartı ve Kalp başlığın altında
// gizli kalmasın (yatay 667×375'te 'Başla'/'Arşiv' görünüm dışındaydı). Bu rAF, world'ün rAF'ından SONRA çalışır.
function levelsScroll() {
  requestAnimationFrame(() => {
    const sc = $('scr-levels'); if (!sc || G.current !== 'levels') return;
    const n = sc.querySelector('.lvl-btn.next');
    const top = () => { sc.scrollTop = 0; };
    if (!n || !campaignSolved()) return top();
    const r = n.getBoundingClientRect(), b = sc.getBoundingClientRect();
    const yAtTop = r.bottom - b.top + sc.scrollTop;               // scrollTop = 0 iken düğmenin alt kenarı
    if (yAtTop <= sc.clientHeight - 8) top();
  });
}
function levelById(id) { return (PX.LEVELS || []).find(l => l.id === id) || null; }
function nextId(id) {
  const L = PX.LEVELS || []; const i = L.findIndex(l => l.id === id);
  return i >= 0 && i + 1 < L.length ? L[i + 1].id : null;
}
// Kazanma panelindeki "Sonraki": sıradaki iş emri KİLİTLİYSE (§8: bölge, önceki bölgenin Sınavı ya da bütün iş
// emirleri çözülünce açılır) kilit kuralı atlanmaz; açık ve çözülmemiş ilk iş emrine gidilir (yoksa düğme gizlenir).
function nextPlayable(id) {
  const n = nextId(id); const W = PX.world;
  if (!n || !W || !W.unlocked || W.unlocked(n)) return n;
  const alt = W.nextLevel ? W.nextLevel() : null;
  return alt && alt !== id && W.unlocked(alt) ? alt : null;
}
// İş emri kartı ilk karşılaşmada (§6.3, §13 #18): yeni kural kartı, seviyenin kendi kural kartı, bölüm hikâyesi ya da
// öğretici telsiz satırı varsa ve bu kart daha önce gösterilmediyse "Sonraki" kartı gösterir; yoksa yalnız şerit (peek).
function cardSeen(id) { try { const a = PX.store && PX.store.get('ui.isEmri'); return Array.isArray(a) && a.indexOf(id) >= 0; } catch (e) { return false; } }
function markCard(id) {
  if (!PX.store || !id) return;
  try { const a = PX.store.get('ui.isEmri'); const b = Array.isArray(a) ? a.slice() : []; if (b.indexOf(id) < 0) { b.push(id); PX.store.set('ui.isEmri', b); } } catch (e) { /* yoksay */ }
}
function cardNews(lv) {
  if (!lv) return false; const L = compileOf(lv); if (!L) return false;
  const seen = PX.cards.seenRules(); if (PX.cards.levelRules(L, lv.def).some(k => seen.indexOf(k) < 0)) return true;
  if (cardSeen(lv.id)) return false;
  const same = (PX.LEVELS || []).filter(l => l.bolum === lv.bolum); const story = same.length && same[0].id === lv.id && T().bolumHikaye[lv.bolum];
  const radio = ((lv.isEmri && lv.isEmri.telsiz) || lv.telsiz) && (lv.sinif === 'ogretici' || lv.ogretici);
  return !!((lv.kural && lv.kural.baslik) || story || radio);
}
function play(id, opts) {
  opts = opts || {};
  if (PX.cards) PX.cards.closeAll();
  G.daily = null;
  show('game');
  const p = PX.game.load(id);
  const lv = levelById(id);
  if (lv && opts.card) workOrder(lv, { start: true });
  else if (lv && opts.peek && PX.hud) PX.hud.peek('<b>' + esc(woNo(lv)) + ' · ' + esc(lv.ad || lv.id) + '</b><br>' + esc(goalLine(lv, null)), 4200);
  return p;
}
function playDaily(date) {
  const d = PX.daily && PX.daily.today(date); if (!d) return Promise.resolve(null);
  if (PX.cards) PX.cards.closeAll();
  show('game'); const p = PX.game.load({ daily: d.date }); G.daily = d.date;
  if (PX.hud) PX.hud.peek('<b>' + esc(T().gunluk) + ' · ' + esc(d.date) + '</b><br>' + esc(goalLine(d.level, null)), 4200);
  return p;
}
function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function woNo(lv) {
  if (!lv) return T().isEmri;
  if (lv.isEmri && lv.isEmri.no) return String(lv.isEmri.no).replace(/^İE-0*(?=\d)/, 'İE ');
  if (lv.no) return PX.t('isEmriNo', { no: lv.no });
  if (typeof lv.bolum === 'number') { const same = (PX.LEVELS || []).filter(l => l.bolum === lv.bolum); const i = same.findIndex(l => l.id === lv.id); if (i >= 0) return PX.t('isEmriNo', { no: lv.bolum + '.' + (i + 1) }); }
  return T().isEmri;
}
function compileOf(lv) { if (PX.game && PX.game.level === lv && PX.game.L) return PX.game.L; try { return SIM.compile(lv.def); } catch (e) { return null; } }
function loadNames(L, ids) { return ids.map(id => { const e = L.els[L.elIndex[id]]; return e ? (e.ad || e.id) : id; }); }
function goalLine(lv, L) {
  L = L || compileOf(lv); if (!L) return '';
  const hd = (lv.def && lv.def.hedef) || {}; const S = T();
  const ids = hd.yukler || L.loads.filter(l => l.req).map(l => L.els[l.el].id);
  return PX.t('hedef', { yukler: loadNames(L, ids).join(', '), cosphi: hd.cosphi ? PX.t('hedefReaktif', { ind: (hd.cosphi.ind === undefined ? 200 : hd.cosphi.ind) / 10, kap: (hd.cosphi.kap === undefined ? 150 : hd.cosphi.kap) / 10 }) : '', is: L.work >= 0 ? S.hedefIs : '' });
}

// ---------------------------------------------------------------- optimizasyon talepleri (§24.6)
// Üç seviye dosyası biçimi de okunur: {ad|id, metin|aciklama, kisit:{kesinti|k|kesintiMax, hamle|h, manevra|m|manevraMax,
// donmeMax, agirlik:{yük:w}, kesintisiz:[yük], yasak:[el]}, enAz:'hamle'|'h'|…, deger}  ya da  {…, opt:[h,m,k,o], agirlikliKesinti}
const MET = { hamle: 'h', h: 'h', manevra: 'm', m: 'm', kesinti: 'k', k: 'k' };
function talepList(lv) {
  const raw = (lv && (lv.talepler || lv.talep)) || []; if (!Array.isArray(raw)) return [];
  return raw.filter(Boolean).map(t => {
    const K = t.kisit || {}; const pick = (...ks) => { for (const k of ks) if (typeof K[k] === 'number') return K[k]; return undefined; };
    const n = { id: t.id || '', ad: t.ad || t.id || '', metin: t.metin || t.aciklama || '',
      k: pick('kesinti', 'k', 'kesintiMax'), h: pick('hamle', 'h', 'hamleMax'), m: pick('manevra', 'm', 'manevraMax'), d: pick('donmeMax', 'donme'),
      agirlik: K.agirlik && typeof K.agirlik === 'object' ? K.agirlik : null, kesintisiz: Array.isArray(K.kesintisiz) ? K.kesintisiz : null,
      yasak: Array.isArray(K.yasak) ? K.yasak : null, enAz: null, deger: null, tieH: null };
    if (n.agirlik && typeof t.agirlikliKesinti === 'number') { n.enAz = 'w'; n.deger = t.agirlikliKesinti; n.tieH = t.opt ? t.opt[0] : null; }
    else if (t.enAz && MET[t.enAz]) { n.enAz = MET[t.enAz]; n.deger = typeof t.deger === 'number' ? t.deger : (t.opt ? t.opt[{ h: 0, m: 1, k: 2 }[n.enAz]] : null); }
    else if (Array.isArray(t.opt)) { n.enAz = 'h'; n.deger = t.opt[0]; }
    return n;
  });
}
function talepKisitText(n, L, hideVal) {
  const S = T(); const out = [];
  const nm = id => { const e = L && L.els[L.elIndex[id]]; return e ? (e.ad || e.id) : id; };
  if (n.agirlik) out.push(PX.t('kisitAgirlik', { liste: Object.keys(n.agirlik).map(nm).join(', ') }));
  if (n.kesintisiz) out.push(PX.t('kisitKesintisiz', { liste: n.kesintisiz.map(nm).join(', ') }));
  if (n.yasak) out.push(PX.t('kisitYasak', { liste: n.yasak.join(', ') }));
  if (n.k !== undefined) out.push(PX.t('kisitK', { n: n.k })); if (n.h !== undefined) out.push(PX.t('kisitH', { n: n.h }));
  if (n.m !== undefined) out.push(PX.t('kisitM', { n: n.m }));
  if (n.enAz) out.push((n.enAz === 'w' ? S.enAzH : S['enAz' + n.enAz.toUpperCase()]) + (!hideVal && n.deger !== null && n.deger !== undefined && n.enAz !== 'w' ? ' = ' + n.deger : ''));
  return out.join(' · ');
}
// oyuncunun dizgisini kurallarla yeniden oynatarak talebi değerlendirir (yalnız kazanma anında; kare başına değil)
function talepEval(n, L, str, tot) {
  let ok = true; let w = 0;
  const needTrace = n.agirlik || n.kesintisiz || n.yasak;
  if (needTrace && L) {
    try {
      let s = SIM.initState(L); const loadIdx = id => { const e = L.els[L.elIndex[id]]; return e && e.li !== undefined ? e.li : -1; };
      const ks = n.kesintisiz ? n.kesintisiz.map(loadIdx) : []; const ag = n.agirlik ? Object.keys(n.agirlik).map(id => [loadIdx(id), +n.agirlik[id] || 0]) : [];
      const fedAll = E => ks.every(i => i < 0 || ((E.loadMask >> i) & 1));
      if (ks.length && !fedAll(SIM.stateE(L, s))) ok = false;
      for (const tok of String(str || '').split(/\s+/).filter(Boolean)) {
        const a = SIM.decodeAct(L, s, tok); if (!a) { ok = false; break; }
        const r = SIM.apply(L, s, a); if (r.err) { ok = false; break; }
        if (n.yasak && a.e !== undefined && L.els[a.e] && n.yasak.indexOf(L.els[a.e].id) >= 0) ok = false;
        s = r.s;
        if (ks.length || ag.length) { const E = SIM.stateE(L, s); if (ks.length && !fedAll(E)) ok = false; if (r.c && r.c.h > 0) for (const [i, wt] of ag) if (i >= 0 && !((E.loadMask >> i) & 1)) w += wt; }
      }
    } catch (e) { return { state: '?', val: null }; }
  }
  if (n.k !== undefined && tot.k > n.k) ok = false; if (n.h !== undefined && tot.h > n.h) ok = false;
  if (n.m !== undefined && tot.m > n.m) ok = false;
  const val = n.enAz === 'w' ? w : n.enAz ? tot[n.enAz] : null;
  let best = ok;
  if (ok && n.enAz && n.deger !== null && n.deger !== undefined) best = n.enAz === 'w' ? (w < n.deger || (w === n.deger && (n.tieH === null || tot.h <= n.tieH))) : val <= n.deger;
  return { state: !ok ? 'no' : best ? 'ok' : 'near', val };
}
// hideVal: ilk çözümden önce doğrulanmış değer ("en az Hamle = 15" = Kesinti optimumunun Hamle'si) gösterilmez —
// aynı kartta "Doğrulanmış optimumlar ilk çözümden sonra açılır." yazıyor
function talepNode(n, L, ev, hideVal) {
  const S = T(); const st = ev ? ev.state : null;
  const tag = st === 'ok' ? h('span', { class: 'tag ok', text: '✓ ' + S.talepOk }) : st === 'near' ? h('span', { class: 'tag warn', text: S.talepYakin }) : st === 'no' ? h('span', { class: 'tag', text: S.talepYok }) : null;
  const valTxt = ev && ev.val !== null && ev.val !== undefined && st !== 'no' && n.enAz ? PX.t('seninDeger', { v: ev.val }) + (n.enAz === 'w' ? ' ' + S.agirlikliKesinti : '') : '';
  return h('div', { class: 'talep' }, h('div', { class: 'tl1' }, h('b', { text: n.ad }), tag),
    n.metin ? h('div', { class: 'rd', text: n.metin }) : null,
    h('div', { class: 'tl3', text: talepKisitText(n, L, hideVal) + (valTxt ? ' — ' + valTxt : '') }));
}

// ---------------------------------------------------------------- iş emri kartı
function ownMini(t) {
  const R = [[/topraks[ıi]z|canl[ıi] say/i, 'r_bara'], [/alt[ıi]n kural|toprak/i, 'r_toprak'], [/sigorta/i, 'r_sigorta'], [/se[çc]ici koruma|ar[ıi]za/i, 'r_ariza'],
    [/y[üu]k ay[ıi]r[ıi]c/i, 'r_yuk_ayirici'], [/NAN|ring|halka/i, 'r_hedef'], [/trafo|geri besleme/i, 'r_trafo'], [/kondansat/i, 'r_kondansator'], [/kontakt/i, 'r_kontaktor'],
    [/kilit|LOTO/i, 'r_loto'], [/ay[ıi]r[ıi]c/i, 'r_ayirici'], [/kap[ıi] kilit|h[üu]cre kap/i, 'r_kapi']];
  for (const [re, k] of R) if (re.test(t)) return k; return 'r_kesici';
}
function workOrder(lv, opts) {
  opts = opts || {}; const S = T(); const L = compileOf(lv); if (!L) return null;
  const hd = (lv.def && lv.def.hedef) || {}; const IE = lv.isEmri && typeof lv.isEmri === 'object' ? lv.isEmri : null;
  const head = h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px' },
    h('span', { class: 'io', text: woNo(lv) }), lv.sinif ? h('span', { class: 'cls ' + lv.sinif, text: S.sinif[lv.sinif] || lv.sinif }) : null,
    h('span', { class: 'tag', text: lv.biyom || S.bolumKisa[lv.bolum] || '' }));
  // bölüm hikâyesi (bölümün ilk iş emrinde) + iş emri yazısı
  const sameCh = (PX.LEVELS || []).filter(l => l.bolum === lv.bolum); const firstOfCh = sameCh.length && sameCh[0].id === lv.id;
  const chStory = firstOfCh && S.bolumHikaye[lv.bolum] ? h('p', { class: 'story', text: S.bolumHikaye[lv.bolum] }) : null;
  const memo = IE ? h('div', { class: 'memo' },
    h('div', { class: 'kv' }, IE.kimden ? [h('div', { class: 'k', text: S.kimden }), h('div', { text: IE.kimden })] : null,
      IE.konu ? [h('div', { class: 'k', text: S.konu }), h('div', null, h('b', { text: IE.konu }))] : null),
    IE.metin ? h('p', { text: IE.metin }) : null)
    : (typeof lv.hikaye === 'string' ? h('p', { text: lv.hikaye }) : null);
  // durum: başlangıçta beslenmeyen yükler (veriden, dürüst)
  let s0 = null, E0 = null; try { s0 = SIM.initState(L); E0 = SIM.stateE(L, s0); } catch (e) { /* yoksay */ }
  const unfed = E0 ? L.loads.filter((ld, i) => !((E0.loadMask >> i) & 1)).map(ld => L.els[ld.el].ad || L.els[ld.el].id) : [];
  const durum = h('p', { style: 'color:var(--muted);font-size:13px' },
    unfed.length ? PX.t('durumBeslenmeyen', { liste: unfed.join(', ') }) : S.durumHepsi,
    L.zone.length ? PX.t('durumBakim', { liste: L.zone.map(n => { const b = L.baras.find(x => x.node === n); return b ? L.els[b.el].id + ' (' + (L.els[b.el].ad || L.nodeNames[n]) + ')' : L.nodeNames[n]; }).join(', ') }) : '');
  // hedef: elle yazılmış iş emri hedefi varsa o, yoksa motorun hedefinden
  const goals = [];
  if (IE && IE.hedef) goals.push(h('div', { text: IE.hedef }));
  else {
    goals.push(h('div', { text: goalLine(lv, L) }));
    if (hd.gerilimli) goals.push(h('div', { text: PX.t('hedefGerilimli', { liste: hd.gerilimli.map(n => { const b = L.baras.find(x => x.node === L.nodeIdx[n]); return b ? L.els[b.el].id : n; }).join(', ') }) }));
    if (hd.kapali) goals.push(h('div', { text: PX.t('hedefKapali', { liste: hd.kapali.join(', ') }) }));
    if (hd.acik) goals.push(h('div', { text: PX.t('hedefAcik', { liste: hd.acik.join(', ') }) }));
    const acil = L.sources.filter(x => x.acil).map(x => L.els[x.el].id); if (acil.length) goals.push(h('div', { text: PX.t('hedefAcil', { liste: acil.join(', ') }) }));
  }
  goals.push(h('div', { style: 'color:var(--muted);font-size:12px;margin-top:3px', text: S.hedefTemiz }));
  // yükler
  const loads = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: S.yukler }), h('th', { class: 'n', text: S.talep }), h('th', { class: 'n', text: S.oncelik }))),
    h('tbody', null, L.loads.map(ld => { const e = L.els[ld.el]; return h('tr', null, h('td', null, h('b', { text: e.id }), ' ' + (e.ad || '')), h('td', { class: 'n', text: ld.d }), h('td', { class: 'n', text: ld.w + (ld.req ? '' : ' (' + S.istege + ')') })); })));
  // koruma
  const prot = L.els.filter(e => (e.t === 'kesici' || e.t === 'sigorta') && e.I);
  const protT = prot.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: S.korumalar }), h('th', { class: 'n', text: S.esik }), h('th', { class: 'n', text: S.kademe }))),
    h('tbody', null, prot.map(e => h('tr', null, h('td', null, h('b', { text: e.id }), ' ' + (e.ad || '')), h('td', { class: 'n', text: e.I }), h('td', { class: 'n', text: e.kademe || 0 }))))) : null;
  // elindekiler
  const kit = [];
  kit.push(h('span', { class: 'tag' + (L.kilit ? ' lock' : ''), text: L.kilit ? '🔒 ' + PX.t('asmaKilitN', { n: L.kilit }) : S.asmaKilitYok }));
  if (L.yedek) kit.push(h('span', { class: 'tag warn', text: 'NH yedek × ' + L.yedek }));
  if (L.nSet) kit.push(h('span', { class: 'tag earth', text: 'Taşınabilir topraklama × 1' }));
  // optimumlar (ilk çözümden sonra)
  const rec = PX.store && PX.store.data.seviye[lv.id]; const solved = !!(rec && rec.cozuldu); const o = lv.kanit && lv.kanit.opt;
  const optP = solved && o ? h('p', null, h('b', { text: S.optimum + ': ' }), `${S.hamleK} ${o.hamle[0]} · ${S.manevraK} ${o.manevra[1]} · ${S.kesintiK} ${o.kesinti[2]} · ${S.olayK} ${o.olay[3]}`,
    rec.en && rec.en.h ? h('div', { style: 'color:var(--muted);font-size:12.5px', text: S.kisiselEn + ': ' + ['h', 'm', 'k', 'o'].map(m => rec.en[m] ? rec.en[m][0] : '—').join(' / ') }) : null)
    : h('p', { style: 'color:var(--muted);font-size:12.5px', text: S.optimumKapali });
  // tek hat önizleme
  let mini = null;
  try { const D = PX.sld.diagram(L, lv, { interactive: false, horiz: true }); if (s0) D.update(s0, E0); D.svg.style.width = '100%'; D.svg.style.height = 'auto'; D.svg.style.maxWidth = Math.round(D.W * 1.1) + 'px'; D.svg.removeAttribute('height'); mini = h('div', { class: 'mini', style: 'max-height:280px;padding:4px' }, D.svg); } catch (e) { console.error('[PX.screens] önizleme', e); }
  // talepler
  const tl = talepList(lv); const done = rec && Array.isArray(rec.talep) ? rec.talep : [];
  const talepBox = tl.length ? [h('h3', { text: S.talepler + (solved ? ' · ' + PX.t('talepKac', { n: tl.filter(t => done.indexOf(t.id) >= 0).length, top: tl.length }) : '') }),
    h('p', { style: 'font-size:12px;color:var(--dim);margin-top:0', text: S.talepNot }),
    tl.map(t => talepNode(t, L, done.indexOf(t.id) >= 0 ? { state: 'ok', val: null } : null, !solved))] : null;
  // yeni kurallar: seviyenin kendi kural kartı (varsa) + motorun ilk kez gördüğü kurallar
  const seen = PX.cards.seenRules(); const rules = PX.cards.levelRules(L, lv.def); const fresh = rules.filter(k => seen.indexOf(k) < 0);
  const own = lv.kural && lv.kural.baslik ? h('div', { class: 'rule' }, h('div', { class: 'mini', style: 'margin:0;display:grid;place-items:center;min-height:56px' }, PX.cards.miniOf(ownMini(lv.kural.baslik + ' ' + (lv.kural.metin || '')), 1)),
    h('div', null, h('b', { text: lv.kural.baslik }), h('div', { class: 'rd', text: lv.kural.metin || '' }))) : null;
  const radio = (IE && IE.telsiz) || lv.telsiz;
  const radioP = radio && (lv.sinif === 'ogretici' || lv.ogretici) ? h('div', { class: 'radio', text: radio }) : null;
  // tek cümle özet (isEmri.ozet): kartın ilk okunan şeyi. Uzun metin, tablolar ve şema "Ayrıntı"nın altında.
  const ozet = IE && IE.ozet ? IE.ozet : null;
  const saha = sahaLine(L);
  const ozetP = ozet ? h('p', { class: 'ozet', 'data-testid': 'wo-ozet', style: 'font-size:15.5px;line-height:1.4;font-weight:600;color:var(--ink);margin:4px 0 8px', text: ozet }) : null;
  const detail = h('div', { class: 'wo-detail', 'data-testid': 'wo-detail' }, memo, durum,
    mini ? h('h3', { text: S.tekHat }) : null, mini,
    h('h3', { text: S.yukler }), loads, protT,
    h('h3', { text: S.kaynaklar }), h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, kit),
    h('h3', { text: S.optimum }), optP, talepBox);
  // özet varsa ayrıntı katlanır (öğreticide ve tekrar açılışta açık); özet yoksa her şey görünür (eski seviyeler)
  const fold = !!ozet && !opts.fromHud;
  let toggle = null;
  if (fold) {
    detail.hidden = true;
    toggle = h('button', { class: 'sm', type: 'button', 'data-testid': 'wo-more', 'aria-expanded': 'false', text: S.ayrinti + ' ▾', style: 'margin:6px 0 2px' });
    toggle.addEventListener('click', () => { detail.hidden = !detail.hidden; toggle.textContent = detail.hidden ? S.ayrinti + ' ▾' : S.ayrintiGizle + ' ▴'; toggle.setAttribute('aria-expanded', String(!detail.hidden)); });
  }
  const body = h('div', null, head, chStory, ozetP,
    h('h3', { text: 'Hedef' }), h('div', { class: 'goal' }, goals), saha, radioP,
    (own || fresh.length) ? h('h3', { text: S.yeniKurallar }) : null, own, fresh.map(k => PX.cards.ruleNode(k, false)),
    toggle, detail,
    (lv.bolum === 0 || fresh.length) ? h('div', { class: 'goal', style: 'border-left-color:var(--cyan);font-size:12.5px' }, h('b', { text: S.guvenlikBaslik + '. ' }), S.guvenlikNotu) : null);
  const foot = [{ label: S.kuralKitabi, keep: true, act: () => PX.cards.book() }];
  if (opts.start) foot.push({ label: S.basla, cls: 'pri', testid: 'btn-wo-start' }); else foot.push({ label: S.tamam, cls: 'pri' });
  return PX.cards.open({ title: S.isEmri + ' — ' + (lv.ad || lv.id), body, foot, levelScoped: !opts.start, onClose: () => { PX.cards.markSeen(fresh); markCard(lv.id); } });
}

// saha özeti: iş noktası (def.is.ad), merdiven/iskele/hücre kapısı sayısı — oyuncu NEREYE ve NASIL gideceğini bilir
function sahaLine(L) {
  if (!L) return null; const parts = [];
  if (L.work >= 0) parts.push('İş noktası: ' + ((L.def.is && L.def.is.ad) || 'işaretli karo'));
  const n = (a, w) => a && a.length ? a.length + ' ' + w : null;
  const geo = [n(L.stairs, 'merdiven'), n(L.ladders, 'iskele'), n(L.doors, 'hücre kapısı (kilitlemeli)')].filter(Boolean);
  if (geo.length) parts.push('Sahada ' + geo.join(', ') + ': katlar arasında yalnız bunlardan geçilir.');
  if (!parts.length) return null;
  return h('p', { class: 'saha', 'data-testid': 'wo-saha', style: 'font-size:12.5px;color:var(--muted);margin:6px 0 0' }, parts.join(' · '));
}

// ---------------------------------------------------------------- duraklat menüsü
const MI = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4l12 8-12 8z"/></svg>', reset: '<svg viewBox="0 0 24 24"><path d="M3 4v6h6"/><path d="M3.5 13a8.5 8.5 0 102.4-6.4L3 10"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>', book: '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5"/></svg>',
  manual: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z"/></svg>', set: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/></svg>', map: '<svg viewBox="0 0 24 24"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>', log: '<svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z"/><path d="M9 9h7M9 13h7M9 17h4"/></svg>',
};
function menu() {
  const S = T(); let H = null;
  const item = (ic, label, fn) => h('button', { type: 'button', html: MI[ic] + '<span>' + esc(label) + '</span>', onclick: () => { H.close(); fn(); } });
  const lv = PX.game && PX.game.level;
  const body = h('div', { class: 'menu-list' },
    item('play', S.devam, () => {}),
    PX.game && PX.game.L ? item('reset', S.sifirla, () => PX.game.command({ t: 'reset' })) : null,
    lv ? item('card', S.isEmri, () => workOrder(lv, {})) : null,
    PX.game && PX.game.L ? item('log', S.defter, defter) : null,
    item('book', S.kuralKitabi, () => PX.cards.book()),
    item('manual', S.elKitabi, () => PX.cards.manual()),
    item('set', S.ayarlar, settings),
    item('code', S.kodYapistir, () => codePaste()),
    item('map', S.seviyeSec, () => show('levels')),
    item('home', S.anaEkran, () => show('title')));
  H = PX.cards.open({ title: S.duraklat, body });
}

// ---------------------------------------------------------------- ayarlar
function setAyar(k, v) { try { PX.store.set('ayar.' + k, v); } catch (e) { /* yoksay */ } PX.bus.emit('settings', { ayar: PX.store ? PX.store.data.ayar : {}, key: k }); }
function settings() {
  let H = null;
  const S = T(); const A = (PX.store && PX.store.data.ayar) || {}; const AS = S.ayar;
  const tgl = (key, label, def) => {
    const on = A[key] === undefined ? !!def : !!A[key];
    const b = h('button', { class: 'tgl', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label });
    b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); setAyar(key, v); });
    return h('div', { class: 'set-row' }, h('span', { class: 'sl', text: label }), b);
  };
  const rng = (key, label) => {
    const r = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(A[key] === undefined ? 0.5 : A[key]), 'aria-label': label });
    r.addEventListener('input', () => setAyar(key, +r.value));
    return h('div', { class: 'set-row' }, h('label', { text: label }), r);
  };
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': AS.kalite });
  for (const k of ['oto', 'dusuk', 'orta', 'yuksek']) {
    const b = h('button', { type: 'button', text: AS.kaliteSec[k], 'aria-pressed': String((A.kalite || 'oto') === k) });
    b.addEventListener('click', () => { for (const x of seg.children) x.setAttribute('aria-pressed', String(x === b)); setAyar('kalite', k); });
    seg.appendChild(b);
  }
  const store = PX.store && PX.store.available;
  const body = h('div', null,
    h('div', { class: 'set-row', style: 'flex-wrap:wrap' }, h('span', { class: 'sl', text: AS.kalite }), seg),
    h('div', { style: 'font-size:11.5px;color:var(--dim);margin:-2px 0 6px', text: AS.kaliteNot }),
    rng('ses', AS.ses), rng('muzik', AS.muzik),
    tgl('titresim', AS.titresim, true), tgl('hareketAzalt', AS.hareketAzalt, false), tgl('isikAzalt', AS.isikAzalt, false),
    tgl('etiketler', AS.etiketler, true), tgl('akim', AS.akim, false), tgl('solak', AS.solak, false),
    h('p', { style: 'font-size:12px;color:var(--muted)', text: store ? S.kayitAcik : S.kayitKapali }),
    h('div', { class: 'set-row' }, h('span', { class: 'sl', text: AS.sifirla }),
      h('button', { class: 'sm warn', type: 'button', text: AS.sifirla, onclick: () => {
        PX.cards.open({ title: AS.sifirla, body: AS.sifirlaOnay, foot: [{ label: S.geri }, { label: AS.sifirlaEvet, cls: 'warn', act: () => {
          try { PX.store.reset(); } catch (e) { /* yoksay */ }
          PX.bus.emit('settings', { ayar: PX.store ? PX.store.data.ayar : {} }); PX.cards.toast(AS.silindi, 'ok'); if (G.current === 'levels') PX.world.render($('level-list'));
          if (H) H.close(); settings();
        } }] });
      } })));
  H = PX.cards.open({ title: S.ayarlar, body, foot: [{ label: S.tamam, cls: 'pri' }] });
}

// ---------------------------------------------------------------- Manevra Defteri
// sim2.describe satırları PX.trLine ile düzeltilir (app/strings.js): "görünüm 2'ye", "(… topraklama ayırıcısı) AÇILDI".
const trFix = l => (PX.trLine ? PX.trLine(l) : String(l));
function defterLines() {
  const L = PX.game && PX.game.L; if (!L) return { lines: [], str: '', tot: null };
  const str = PX.game.tokens(); let r = null; try { r = SIM.replay(L, str); } catch (e) { r = null; }
  return { lines: r && r.log ? r.log.map(trFix) : [], str, tot: r ? r.tot : null, won: r && r.won };
}
function defterText(d) {
  const S = T(); const lv = PX.game.level || {};
  return `${S.oyunAdi} — ${lv.id || ''} ${lv.ad || ''}\n${S.defter}\n` + d.lines.map((l, i) => `${i + 1}. ${l}`).join('\n') +
    (d.tot ? `\n${S.hamleK} ${d.tot.h} · ${S.manevraK} ${d.tot.m} · ${S.kesintiK} ${d.tot.k} · ${S.olayK} ${d.tot.o}` : '') + `\n${S.defterDizgi}: ${d.str}`;
}
function defter() {
  const S = T(); if (G.defterH) { G.defterH.close(); }
  const list = h('ol', { class: 'log' }); const tot = h('p', { style: 'font-size:13px;color:var(--muted)' }); const dz = h('div', { class: 'mono' });
  const fill = () => {
    const d = defterLines(); list.textContent = '';
    if (!d.lines.length) list.appendChild(h('li', { style: 'list-style:none;padding-left:0', text: S.defterBos }));
    for (const l of d.lines) list.appendChild(h('li', { text: l }));
    tot.textContent = d.tot ? `${S.hamleK} ${d.tot.h} · ${S.manevraK} ${d.tot.m} · ${S.kesintiK} ${d.tot.k} · ${S.olayK} ${d.tot.o}` : '';
    dz.textContent = d.str || '—';
  };
  fill();
  const offs = ['anim:step', 'undo', 'redo', 'reset', 'level:loaded'].map(ev => PX.bus.on(ev, fill));
  const body = h('div', null, list, tot, h('h3', { text: S.defterDizgi }), dz);
  G.defterH = PX.cards.open({ title: S.defter, body, onClose: () => { offs.forEach(f => f()); G.defterH = null; },
    foot: [{ label: S.kopyala, keep: true, act: () => copy(defterText(defterLines())) }, { label: S.tamam, cls: 'pri' }] });
}
function copy(text) {
  const ok = () => PX.cards.toast(T().kopyalandi, 'ok'); const bad = () => PX.cards.toast(T().kopyalanamadi, 'err');
  try {
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(ok, () => fallback() ? ok() : bad()); return; }
  } catch (e) { /* yoksay */ }
  if (fallback()) ok(); else bad();
  function fallback() {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.select(); const r = document.execCommand('copy'); ta.remove(); return r; } catch (e) { return false; }
  }
}
function challengeCode(id, str, tot) {
  let c = null; try { c = PX.ghost && PX.ghost.code ? PX.ghost.code(id, str, tot) : null; } catch (e) { c = null; }
  return c;
}
function challengeLink(code) { try { if (/^https?:$/.test(location.protocol)) return location.origin + (PX.HOST && PX.HOST.sharePath ? PX.HOST.sharePath : location.pathname) + '#' + code; } catch (e) { /* yoksay */ } return null; }
function playCode(r) {
  if (levelById(r.id)) return play(r.id, { peek: true });
  if (PX.cards) PX.cards.closeAll();
  G.daily = null; show('game');
  // Kod bulmacayı tanımlar; tarih taşımayan günlük kod için bir gün kaydı yazılmaz.
  return PX.game.load(r.level);
}

// ---------------------------------------------------------------- kod yapıştır
function codePaste(prefill) {
  const S = T();
  const ta = h('textarea', { class: 'code', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': S.kodYapistir, placeholder: 'PX2-…' });
  if (prefill) ta.value = prefill;
  const out = h('div', { style: 'min-height:24px;margin-top:8px', 'aria-live': 'polite' });
  const verify = () => {
    out.textContent = '';
    const raw = String(ta.value || '').trim().replace(/^.*#(?=PX2-)/, '');
    let r = null; try { r = PX.ghost && PX.ghost.verify ? PX.ghost.verify(raw) : null; } catch (e) { r = null; }
    if (!r || !r.ok) { out.appendChild(h('p', { style: 'color:#ffb3bd', text: (r && r.msg) || S.dogrulanamadi })); return; }
    out.appendChild(h('p', { style: 'color:#bff5d6', text: PX.t('kodGecerli', { id: r.id, h: r.tot.h, m: r.tot.m, k: r.tot.k, o: r.tot.o }) + (r.eski ? ' · ' + T().eskiKural : '') }));
    const lv = r.level || levelById(r.id);
    if (lv) out.appendChild(h('div', { class: 'row', style: 'justify-content:flex-start' },
      h('button', { class: 'sm pri', type: 'button', text: S.kodSeviyeAc, onclick: () => playCode(r) }),
      h('button', { class: 'sm', type: 'button', text: S.hayalet, onclick: () => { playCode(r).then(() => ghost(r.str)); } })));
  };
  const body = h('div', null, h('p', { style: 'font-size:13px;color:var(--muted)', text: S.kodYapistirNot }), ta, out);
  PX.cards.open({ title: S.kodYapistir, body, foot: [{ label: S.kodDogrula, cls: 'pri', keep: true, act: verify }, { label: S.kapat }] });
  if (prefill) verify();
}
function ghost(str, speed) {
  let r; try { r = PX.ghost && PX.ghost.play ? PX.ghost.play(str, { speed: speed || 1 }) : undefined; } catch (e) { r = undefined; }
  if (r === undefined || r === null || r === false) PX.cards.toast(T().hayaletYok, 'info');
}

// ---------------------------------------------------------------- kazanma paneli
function inFront(front, a, b) { return !!(front && front.some(p => p[0] === a && p[1] === b)); }
function seals(lv, tot, hinted) {
  const o = lv.kanit && lv.kanit.opt; const out = []; if (!o) return out;
  const fk = lv.kanit.frontK || [];
  const joint = o.hamle[1] === o.manevra[1] && o.hamle[2] === o.kesinti[2];
  const muh = joint ? (tot.h === o.hamle[0] && tot.m === o.manevra[1] && tot.k === o.kesinti[2]) : (inFront(fk, tot.h, tot.k) && tot.m <= Math.max(o.hamle[1], o.kesinti[1]) && tot.o === 0);
  out.push({ k: 'muhendis', ok: muh && !hinted });
  if (o.kesinti[2] === 0) out.push({ k: 'sifirKesinti', ok: tot.k === 0 });
  out.push({ k: 'temiz', ok: tot.o === 0 && !hinted });
  if (fk.length >= 3) { const isEnd = (tot.h === o.hamle[0] && tot.k === o.hamle[2]) || (tot.h === o.kesinti[0] && tot.k === o.kesinti[2]); out.push({ k: 'pareto', ok: inFront(fk, tot.h, tot.k) && !isEnd }); }
  return out;
}
function sealIcon(ok) {
  return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="' + (ok ? '#f5c542' : 'none') + '" stroke="' + (ok ? '#ffe7a0' : '#4a5a80') + '" stroke-width="1.5"/>' +
    '<path d="M12 5l2 4.2 4.6.6-3.4 3.2.9 4.5L12 15.3 7.9 17.5l.9-4.5L5.4 9.8 10 9.2z" fill="' + (ok ? '#7a5a10' : '#4a5a80') + '"/></svg>';
}
function svgEl(tag, a, p) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
function chartPareto(lv, tot, hist, mode) {
  const S = T(); const k = lv.kanit || {}; const front = (mode === 'm' ? k.frontM : k.frontK) || [];
  const yOf = v => mode === 'm' ? v[1] : v[2];
  const pts = front.map(p => [p[0], p[1]]); const me = [tot.h, mode === 'm' ? tot.m : tot.k];
  const hp = (hist || []).map(g => [g[0], yOf(g)]);
  const all = pts.concat([me]).concat(hp); if (!all.length) return null;
  let x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0])), y1 = Math.max(1, ...all.map(p => p[1]));
  x0 -= 1; x1 += 1; y1 = Math.ceil(y1 * 1.1);
  const W = 260, H = 130, l = 30, r = 8, t = 8, b = 22;
  const X = x => l + (x - x0) / (x1 - x0) * (W - l - r), Y = y => t + (1 - y / y1) * (H - t - b);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': S.pareto });
  svgEl('path', { d: `M${l},${t}V${H - b}H${W - r}`, fill: 'none', stroke: '#33508a' }, svg);
  const tl = (x, y, s, a) => { const e = svgEl('text', { x, y, 'text-anchor': a || 'middle' }, svg); e.textContent = s; };
  tl((l + W - r) / 2, H - 4, S.hamleK + ' →'); tl(4, t + 8, mode === 'm' ? 'M' : 'K', 'start');
  for (const xv of [x0 + 1, x1 - 1]) tl(X(xv), H - b + 11, String(xv)); tl(l - 4, Y(0) + 3, '0', 'end'); tl(l - 4, Y(y1) + 7, String(y1), 'end');
  if (pts.length) {
    const sorted = pts.slice().sort((p, q) => p[0] - q[0]); let d = '';
    sorted.forEach((p, i) => { d += (i ? `H${X(p[0]).toFixed(1)}V${Y(p[1]).toFixed(1)}` : `M${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`); });
    svgEl('path', { d, fill: 'none', stroke: '#5cf0ff', 'stroke-width': 1.4, 'stroke-dasharray': '3 3' }, svg);
    for (const p of pts) { svgEl('circle', { cx: X(p[0]), cy: Y(p[1]), r: 4, fill: '#0f3446', stroke: '#5cf0ff', 'stroke-width': 1.6 }, svg);
      const e = svgEl('text', { x: X(p[0]) + 6, y: Y(p[1]) - 6, 'text-anchor': 'start', style: 'fill:#9fefff' }, svg); e.textContent = p[0] + '·' + p[1]; }
  }
  for (const p of hp) svgEl('circle', { cx: X(p[0]), cy: Y(p[1]), r: 2.4, fill: '#8aa0c8', opacity: .7 }, svg);
  const mx = X(me[0]), my = Y(me[1]); svgEl('path', { d: `M${mx},${my - 6}L${mx + 6},${my}L${mx},${my + 6}L${mx - 6},${my}Z`, fill: '#f5c542', stroke: '#fff', 'stroke-width': 1 }, svg);
  return svg;
}
function chartSpace(lv, tot, hist, best) {
  const S = T(); const u = lv.kanit && lv.kanit.uzay; const o = lv.kanit && lv.kanit.opt; if (!u || !u.length || !o) return null;
  const hs = u.map(p => p[0]).concat([tot.h]).concat((hist || []).map(g => g[0]));
  const x0 = Math.min(o.hamle[0], ...hs) - 1, x1 = Math.max(...hs, o.hamle[0] + 4) + 1; const cmax = Math.max(...u.map(p => p[1]));
  const W = 260, H = 130, l = 10, r = 8, t = 26, b = 30;
  const X = x => l + (x - x0) / (x1 - x0) * (W - l - r); const bw = Math.max(3, Math.min(22, (W - l - r) / (x1 - x0) * 0.7));
  const Y = c => t + (1 - c / cmax) * (H - t - b);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': S.cozumUzayi });
  svgEl('path', { d: `M${l},${H - b}H${W - r}`, stroke: '#33508a' }, svg);
  const ox = X(o.hamle[0]); svgEl('path', { d: `M${ox},${8}V${H - b}`, stroke: '#44e08a', 'stroke-width': 1.6, 'stroke-dasharray': '3 2' }, svg);
  for (const [hv, c] of u) { svgEl('rect', { x: X(hv) - bw / 2, y: Y(c), width: bw, height: H - b - Y(c), fill: '#2b4580', opacity: .8 }, svg); const e = svgEl('text', { x: X(hv), y: Y(c) - 3, 'text-anchor': 'middle', style: 'fill:#dfe9ff' }, svg); e.textContent = String(c); }
  { const right = ox < (l + W - r) / 2; const e = svgEl('text', { x: right ? ox + 4 : ox - 4, y: 9, 'text-anchor': right ? 'start' : 'end', style: 'fill:#9ff0c0' }, svg); e.textContent = S.optimum + ' ' + o.hamle[0]; }
  for (const g of (hist || [])) svgEl('circle', { cx: X(g[0]), cy: H - b + 8, r: 2.4, fill: '#8aa0c8' }, svg);
  if (best) svgEl('rect', { x: X(best) - 2, y: H - b + 2, width: 4, height: 12, fill: '#ffe7a0' }, svg);
  const mx = X(tot.h); svgEl('path', { d: `M${mx},${H - b + 2}l5,8h-10z`, fill: '#f5c542' }, svg);
  for (const xv of [x0 + 1, x1 - 1]) { const e = svgEl('text', { x: X(xv), y: H - 4, 'text-anchor': 'middle' }, svg); e.textContent = String(xv); }
  return svg;
}
function onWin(p) {
  const S = T(); G.lastWin = p; const lv = (PX.game && PX.game.level) || levelById(p.id) || { id: p.id };
  const tot = p.tot; const o = p.opt || (lv.kanit && lv.kanit.opt) || null;
  // kayıt: mühürler, ipuçlu bayrağı, günlük
  if (p.hinted) G.hinted = true;
  const ss = seals(lv, tot, G.hinted);
  if (Array.isArray(p.seals)) {                     // controller mühür listesi yetkilidir; burada yalnız gösterilecek olanlar seçilir
    const got = p.seals.map(k => typeof k === 'string' ? k : (k && k.k)).filter(Boolean);
    for (const x of ss) x.ok = got.indexOf(x.k) >= 0;
    for (const k of got) if (!ss.some(x => x.k === k)) ss.push({ k, ok: true });
  }
  // optimizasyon talepleri: dizgi kurallarla yeniden oynatılarak değerlendirilir
  const Lc = (PX.game && PX.game.L && PX.game.level === lv) ? PX.game.L : compileOf(lv);
  const tl = talepList(lv); const tev = tl.map(t => talepEval(t, Lc, p.ghost || '', tot));
  let rec = null;
  try {
    if (PX.store) {
      rec = PX.store.level(p.id);
      // 'ipuçlu' koşuya aittir (§5.6): ipucusuz bir çözüm bayrağı kaldırır ve kalıcı olarak 'ipucsuz' işaretler; ipuçlu
      // bir çözüm bayrağı yalnız seviye hiç ipucusuz çözülmemişse koyar (hint.js'in 'win' dinleyicisi önce çalışır)
      if (G.hinted) rec.ipuclu = !rec.ipucsuz; else { rec.ipuclu = false; rec.ipucsuz = true; }
      for (const x of ss) if (x.ok && rec.muhur.indexOf(x.k) < 0) rec.muhur.push(x.k);
      if (tl.length) { if (!Array.isArray(rec.talep)) rec.talep = []; tl.forEach((t, i) => { if (tev[i].state === 'ok' && t.id && rec.talep.indexOf(t.id) < 0) rec.talep.push(t.id); }); }
      PX.store.save();
    }
  } catch (e) { console.error('[PX.screens] kayıt', e); }
  const hist = rec ? rec.gecmis : []; const best = rec && rec.en && rec.en.h ? rec.en.h[0] : null;
  // gövde
  const body = $('win-body'); body.textContent = '';
  body.appendChild(h('h2', { id: 'win-title' }, h('span', { html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>' }), S.kazandi));
  body.appendChild(h('div', { class: 'wp-sub', text: woNo(lv) + ' · ' + (lv.ad || p.id) + (G.hinted ? ' · ' + S.ipuclu : '') }));
  const ov = o ? { h: o.hamle[0], m: o.manevra[1], k: o.kesinti[2], o: o.olay[3] } : null;
  const en = rec && rec.en ? rec.en : {};
  const row = (m, name) => h('tr', null, h('td', { text: name }), h('td', { class: 'you' + (ov && tot[m] <= ov[m] ? ' hit' : ''), text: tot[m] }),
    h('td', { text: ov ? ov[m] : '—' }), h('td', { text: en[m] ? en[m][0] : '—' }));
  body.appendChild(h('table', { class: 'mt' }, h('thead', null, h('tr', null, h('th', { text: '' }), h('th', { text: S.senin }), h('th', { text: S.optimum }), h('th', { text: S.kisiselEn }))),
    h('tbody', null, row('h', S.hamle), row('m', S.manevra), row('k', S.kesinti), row('o', S.olay))));
  if (o) {
    const vec = v => v.join(' · '); const same = vec(o.hamle) === vec(o.kesinti) && vec(o.hamle) === vec(o.manevra);
    body.appendChild(h('div', { class: 'wp-sub', text: same ? PX.t('planTek', { v: vec(o.hamle) }) : `${S.planlar}: ${S.hamleOpt} ${vec(o.hamle)} · ${S.manevraOpt} ${vec(o.manevra)} · ${S.kesintiOpt} ${vec(o.kesinti)}` }));
  }
  // mühürler
  if (ss.length) body.appendChild(h('div', { class: 'seals' }, ss.map(x => h('div', { class: 'seal' + (x.ok ? '' : ' no'), title: S.muhurAcik[x.k] || '' }, h('span', { html: sealIcon(x.ok) }), S.muhur[x.k] || x.k))));
  // ödül sahnesi (diegetik, §24.8) ve talepler
  const IE = lv.isEmri && typeof lv.isEmri === 'object' ? lv.isEmri : null;
  if (IE && IE.odul) body.appendChild(h('div', { class: 'reward', text: IE.odul }));
  if (tl.length) {
    const doneN = rec && Array.isArray(rec.talep) ? tl.filter(t => rec.talep.indexOf(t.id) >= 0).length : tev.filter(e => e.state === 'ok').length;
    body.appendChild(h('details', { class: 'talepler' }, h('summary', { text: S.talepler + ' · ' + PX.t('talepKac', { n: doneN, top: tl.length }) }),
      tl.map((t, i) => talepNode(t, Lc, tev[i]))));
  }
  // grafikler
  const cP = h('div', { class: 'chart' }); const cS = h('div', { class: 'chart' });
  const drawP = () => {
    cP.textContent = '';
    const seg = h('div', { class: 'seg', style: 'gap:2px' }, [['k', 'H×K'], ['m', 'H×M']].map(([m, l]) => h('button', { type: 'button', text: l, style: 'min-height:44px;min-width:48px;padding:0 8px;font-size:12px', 'aria-pressed': String(G.chartMode === m), onclick: () => { G.chartMode = m; drawP(); } })));
    cP.appendChild(h('h4', null, h('span', { text: S.pareto }), seg));
    const c = chartPareto(lv, tot, hist, G.chartMode); if (c) cP.appendChild(c);
    const fr = (G.chartMode === 'm' ? (lv.kanit || {}).frontM : (lv.kanit || {}).frontK) || [];
    cP.appendChild(h('div', { class: 'cn', text: fr.length === 1 ? S.paretoTek : S.paretoNot }));
  };
  drawP();
  const sp = chartSpace(lv, tot, hist, best);
  if (sp) { cS.appendChild(h('h4', null, h('span', { text: S.cozumUzayi + ' · ' + S.hamleK }))); cS.appendChild(sp); cS.appendChild(h('div', { class: 'cn', text: S.cozumUzayiNot })); }
  body.appendChild(h('div', { class: 'charts' }, cP, sp ? cS : null));
  // bağlantılar
  const code = challengeCode(p.id, p.ghost || '', tot); const link = code ? challengeLink(code) : null;
  body.appendChild(h('div', { class: 'row', style: 'justify-content:flex-start' },
    h('button', { class: 'sm', type: 'button', text: S.defter, onclick: defter }),
    h('div', { class: 'seg ghostseg', role: 'group', 'aria-label': S.hayalet }, h('span', { class: 'gl', text: S.hayalet }),
      [1, 2, 4].map(sp => h('button', { type: 'button', text: sp + '×', 'aria-label': S.hayalet + ' ' + sp + '×', onclick: () => { show('game'); ghost(p.ghost || '', sp); } }))),
    code ? h('button', { class: 'sm', type: 'button', text: link ? S.meydanOkuma : S.meydanOkumaKod, onclick: () => copy(link || code) }) : null,
    h('button', { class: 'sm', type: 'button', text: S.tekrar, onclick: () => PX.game.command({ t: 'reset' }) })));
  if (code) body.appendChild(h('div', { class: 'mono', style: 'font-size:10.5px;opacity:.8', text: code }));
  const nid = G.daily ? null : nextPlayable(p.id); G.nextId = nid;
  $('btn-next').hidden = !nid;
  if (nid && PX.render && PX.render.prepare) { try { PX.render.prepare(levelById(nid)); } catch (e) { /* yoksay */ } }
  clearTimeout(G.winTimer);
  G.winTimer = setTimeout(() => { if (G.lastWin === p && G.current === 'game' && PX.game.state().presentation.won) show('win'); }, 200);
}

// ---------------------------------------------------------------- açılış
function progressNext() {
  if (PX.world && PX.world.nextLevel) return PX.world.nextLevel();
  const L = PX.LEVELS || []; const d = PX.store ? PX.store.data.seviye : {}; const n = L.find(l => !(d[l.id] && d[l.id].cozuldu)); return n ? n.id : null;
}
// yalnız KAMPANYA ilerlemesi sayılır: Günün Manevrası çözümü (seviye[Gxx] kaydı) başlığı "Devam et" yapmaz
function campaignSolved() { try { const d = PX.store.data.seviye; return (PX.LEVELS || []).some(l => d[l.id] && d[l.id].cozuldu); } catch (e) { return false; } }
const anySolved = campaignSolved;
function titleRefresh() {
  const S = T(); $('btn-play').textContent = anySolved() ? S.devam : S.basla;
  const more = $('title-more'); more.textContent = '';
  more.appendChild(h('button', { class: 'sm', type: 'button', text: S.seviyeSec, onclick: () => show('levels') }));
  if (PX.daily && PX.daily.pool && PX.daily.pool.length) more.appendChild(h('button', { class: 'sm', type: 'button', text: S.gunluk, onclick: () => playDaily() }));
  more.appendChild(h('button', { class: 'sm', type: 'button', text: S.kodYapistir, onclick: () => codePaste() }));
  more.appendChild(h('button', { class: 'sm', type: 'button', text: S.elKitabi, onclick: () => PX.cards.manual() }));
  more.appendChild(h('button', { class: 'sm', type: 'button', text: S.ayarlar, onclick: settings }));
  const sf = $('title-safety'); sf.textContent = ''; sf.appendChild(h('b', { text: S.guvenlikBaslik + '. ' })); sf.appendChild(document.createTextNode(S.guvenlikNotu));
  sf.appendChild(h('div', { style: 'margin-top:6px;font-size:11.5px;color:var(--dim)', text: PX.store && PX.store.available ? S.kayitAcik : S.kayitKapali }));
}
function oztest() {
  const box = $('oztest'); if (!box) return; box.textContent = '';
  T().oztest.forEach((l, i) => { const d = h('div', { text: '> ' + l, class: /HASARLI/.test(l) ? 'bad' : '' }); d.style.animationDelay = (0.12 + i * 0.16) + 's'; box.appendChild(d); });
}

// ---------------------------------------------------------------- init
function noteHint() { G.hinted = true; }
function init() {
  oztest(); titleRefresh();
  $('btn-play').addEventListener('click', () => { const id = progressNext(); if (id) play(id, { card: true }); else show('levels'); });
  const tap = (el, fn) => { if (PX.hud && PX.hud.onTap) PX.hud.onTap(el, fn); else el.addEventListener('click', fn); };
  tap($('btn-next'), () => {
    const n = G.lastWin && (G.nextId !== undefined ? G.nextId : nextPlayable(G.lastWin.id)); if (!n) return;
    if (PX.world && PX.world.unlocked && !PX.world.unlocked(n)) { show('levels'); return; }
    play(n, cardNews(levelById(n)) ? { card: true } : { peek: true });
  });
  tap($('btn-map'), () => show('levels'));
  $('btn-levels-back').addEventListener('click', () => show(PX.game && PX.game.L ? 'game' : 'title'));
  $('btn-levels-code').addEventListener('click', () => codePaste());
  PX.bus.on('win', onWin);
  PX.bus.on('level:loaded', p => {
    G.lastWin = null; G.hinted = false; clearTimeout(G.winTimer);
    G.daily = PX.daily && PX.daily.current ? PX.daily.current.date || 'gunluk' : null;
    if (G.current === 'win' || G.current === 'title' || G.current === 'levels') { if (G.current === 'win') show('game'); }
  });
  PX.bus.on('reset', () => { G.hinted = false; clearTimeout(G.winTimer); if (G.current === 'win') show('game'); });
  PX.bus.on('undo', () => { clearTimeout(G.winTimer); if (G.current === 'win') show('game'); });
  PX.bus.on('settings', () => { if (G.current === 'title') titleRefresh(); });
  // meydan okuma bağlantısı: http(s) altında #PX2-… parçası
  try {
    if (/^https?:$/.test(location.protocol) && /^#PX2-/.test(location.hash)) { const c = decodeURIComponent(location.hash.slice(1)); setTimeout(() => codePaste(c), 300); }
  } catch (e) { /* yoksay */ }
}
PX.screens = { init, show, play, playDaily, workOrder, menu, settings, defter, codePaste, noteHint, nextId, nextPlayable, cardNews, woNo, goalLine, copy,
  talepKisitText, talepList, get current() { return G.current; } };
