// ============================================================================
// meta/world.js — PX.world : R1 düz seviye seçme haritası (§24.7, §8)               sahip: UI
// R1'de 3B bölge haritası yok (§24.1): VoltCity bölgeleri (Depo → Volt Mahallesi → Trafo Merkezi → Fabrika) dikey
// kaydırılan bölge kartlarıdır; her iş emri bir binadır, çözülünce pencereleri yanar. "Kalp" (ana trafo merkezi)
// en üstte her zaman görünür; her çözülen iş emri ona bir hüzme gönderir. Sıradaki iş emri ışıyan çerçeveyle işaretli
// (HUD oku yok). Kilit (§8): bölge içinde ilk iki iş emri sırayla, diğerleri serbest; bir bölge, önceki bölgenin
// Sınavı ya da bütün iş emirleri çözülünce açılır. Kilitli düğmeye dokunmak nedenini söyler (sessiz ret yok).
// ?debug ile her şey açıktır. Karanlık desen yok: zamanlayıcı, seri, sayaç baskısı yok.
//   PX.world.init()   PX.world.render(container)   PX.world.nextLevel() -> id|null   PX.world.unlocked(id) -> bool
//   düğmeler: [data-testid=lvl-<id>]
// ============================================================================
const NSW = 'http://www.w3.org/2000/svg';
function rec(id) { try { return (PX.store && PX.store.data.seviye[id]) || null; } catch (e) { return null; } }
function solved(id) { const r = rec(id); return !!(r && r.cozuldu); }
function debugAll() { try { return /(?:^|[?&])debug(?:[=&]|$)/.test(location.search); } catch (e) { return false; } }
function chapters() {
  const m = new Map(); for (const lv of PX.LEVELS || []) { if (!m.has(lv.bolum)) m.set(lv.bolum, []); m.get(lv.bolum).push(lv); }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}
function chapterCleared(list) {
  const ex = list.filter(l => l.sinif === 'sinav' || l.sinif === 'usta');
  if (ex.some(l => solved(l.id))) return true;
  return list.every(l => solved(l.id));
}
function lockInfo() {
  const out = new Map(); const chs = chapters(); let prevOk = true; let prevName = null;
  const retained = new Set((PX.store && PX.store.data.erisilen) || []);
  for (const [n, list] of chs) {
    const chOpen = debugAll() || prevOk || list.some(lv => retained.has(lv.id));
    list.forEach((lv, i) => {
      let why = null;
      if (retained.has(lv.id)) why = null;
      else if (!chOpen) why = PX.STR.bolumKilit;
      else if (!debugAll() && i === 1 && !solved(list[0].id)) why = PX.t('seviyeKilit', { ad: list[0].ad });
      else if (!debugAll() && i >= 2 && !(solved(list[0].id) && solved(list[1].id))) why = PX.t('seviyeKilit', { ad: solved(list[0].id) ? list[1].ad : list[0].ad });
      out.set(lv.id, { open: !why, why, chOpen });
    });
    prevOk = chOpen && chapterCleared(list); prevName = n;
  }
  return out;
}
function nextLevel() {
  const li = lockInfo();
  for (const lv of PX.LEVELS || []) { const x = li.get(lv.id); if (x && x.open && !solved(lv.id)) return lv.id; }
  return null;
}
function unlocked(id) { const x = lockInfo().get(id); return !!(x && x.open); }

// ---------------------------------------------------------------- çizimler
function sv(tag, a, p) { const e = document.createElementNS(NSW, tag); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
function skyline(n, frac) {
  const svg = sv('svg', { class: 'sky', viewBox: '0 0 320 54', preserveAspectRatio: 'xMidYMax slice', 'aria-hidden': 'true' });
  const g = sv('g', {}, svg); const lit = '#ffc94a', dark = '#1c2a50', body = '#16244a', edge = '#2b3d6b';
  let seed = 7 + n * 13; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const win = (x, y, w, hh, cols, rows, k) => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const on = rnd() < frac; sv('rect', { x: x + 3 + c * (w - 6) / cols, y: y + 4 + r * 7, width: Math.max(2, (w - 6) / cols - 2), height: 3.5, fill: on ? lit : dark, opacity: on ? .95 : 1 }, g); }
  };
  if (n === 0) {              // depo: raflı uzun hangar + UPS kabini
    sv('path', { d: 'M10,54V24l60,-10l60,10V54Z', fill: body, stroke: edge }, g); win(20, 28, 100, 20, 8, 3);
    sv('rect', { x: 150, y: 30, width: 34, height: 24, fill: body, stroke: edge }, g); win(150, 30, 34, 20, 3, 3);
    sv('rect', { x: 200, y: 20, width: 90, height: 34, fill: body, stroke: edge }, g); win(200, 22, 90, 30, 7, 4);
  } else if (n === 1) {       // mahalle: evler + direkler + havai hat
    for (let i = 0; i < 6; i++) { const x = 8 + i * 52, hh = 22 + (i % 3) * 6; sv('path', { d: `M${x},54V${54 - hh}l20,-10l20,10V54Z`, fill: body, stroke: edge }, g); win(x, 54 - hh + 2, 40, hh, 3, Math.floor(hh / 8)); }
    sv('path', { d: 'M0,12 Q80,22 160,12 T320,12', fill: 'none', stroke: '#3a4f80', 'stroke-width': 1 }, g);
    for (let i = 0; i < 3; i++) sv('rect', { x: 50 + i * 110, y: 10, width: 3, height: 44, fill: '#3a4f80' }, g);
  } else if (n === 2) {       // trafo merkezi: köşk + trafolar + portal
    sv('rect', { x: 14, y: 22, width: 80, height: 32, fill: body, stroke: edge }, g); win(14, 24, 80, 28, 6, 3);
    for (let i = 0; i < 2; i++) { const x = 120 + i * 70; sv('rect', { x, y: 30, width: 44, height: 24, fill: '#22305a', stroke: edge }, g); for (let k = 0; k < 6; k++) sv('rect', { x: x + 4 + k * 6.5, y: 33, width: 3, height: 18, fill: '#2b3d6b' }, g); sv('rect', { x: x + 8, y: 22, width: 4, height: 8, fill: '#8a6a3a' }, g); sv('rect', { x: x + 32, y: 22, width: 4, height: 8, fill: '#8a6a3a' }, g); }
    sv('path', { d: 'M270,54V10H310V54M270,18H310', fill: 'none', stroke: '#3a4f80', 'stroke-width': 2 }, g);
  } else {                    // fabrika: testere çatı + bacalar
    sv('path', { d: 'M10,54V26l26,-12v12l26,-12v12l26,-12v12l26,-12V54Z', fill: body, stroke: edge }, g); win(14, 30, 100, 20, 8, 3);
    sv('rect', { x: 140, y: 6, width: 10, height: 48, fill: '#22305a', stroke: edge }, g); sv('rect', { x: 160, y: 14, width: 10, height: 40, fill: '#22305a', stroke: edge }, g);
    sv('rect', { x: 190, y: 24, width: 110, height: 30, fill: body, stroke: edge }, g); win(190, 26, 110, 26, 9, 3);
    if (frac > 0) sv('path', { d: 'M145,6 q-6,-6 2,-6 q8,0 4,-6', fill: 'none', stroke: '#6a7898', 'stroke-width': 2, opacity: .7 }, g);
  }
  return svg;
}
function bldIcon(done) {
  const svg = sv('svg', { class: 'bld', viewBox: '0 0 22 22', 'aria-hidden': 'true' });
  sv('path', { d: 'M3,21V8l8,-5l8,5V21Z', fill: '#16244a', stroke: done ? '#c9a640' : '#33508a', 'stroke-width': 1.2 }, svg);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) sv('rect', { class: 'win', x: 6.5 + c * 5.5, y: 9 + r * 3.8, width: 3.2, height: 2.2, fill: done ? '#ffc94a' : '#24345e' }, svg);
  return svg;
}
function heart(n) {
  const svg = sv('svg', { viewBox: '0 0 64 48', width: 64, height: 48, 'aria-hidden': 'true' });
  for (let i = 0; i < Math.min(n, 12); i++) { const a = (-160 + i * 12) * Math.PI / 180; sv('path', { d: `M32,26 L${32 + 30 * Math.cos(a)},${26 + 30 * Math.sin(a)}`, stroke: '#ffc94a', 'stroke-width': 1.2, opacity: .55 }, svg); }
  sv('rect', { x: 16, y: 24, width: 32, height: 20, rx: 2, fill: '#22305a', stroke: '#c9a640' }, svg);
  for (let k = 0; k < 6; k++) sv('rect', { x: 19 + k * 4.5, y: 27, width: 2.5, height: 14, fill: n ? '#6a5520' : '#2b3d6b' }, svg);
  sv('circle', { cx: 32, cy: 20, r: 5, fill: n ? '#ffc94a' : '#2b3d6b' }, svg);
  return svg;
}

// ---------------------------------------------------------------- Günün Manevrası arşivi (tam; kaçırılan gün kaybolmaz, §5.5)
function archive() {
  const S = PX.STR; const h = PX.cards.h; let list = [];
  try { list = PX.daily.archive(60) || []; } catch (e) { list = []; }
  let H = null;
  const rows = list.map(x => h('tr', null, h('td', { text: x.date }), h('td', { text: x.ad || x.id }),
    h('td', { class: 'n', text: x.cozuldu ? '✓' + (Array.isArray(x.en) ? ' ' + x.en.slice(0, 3).join('/') : '') : '' }),
    h('td', null, h('button', { class: 'sm', type: 'button', text: S.basla, 'aria-label': S.gunluk + ' ' + x.date, onclick: () => { if (H) H.close(); PX.screens.playDaily(x.date); } }))));
  const body = h('div', null, h('p', { style: 'font-size:12.5px;color:var(--muted)', text: S.arsivNot }), h('table', { class: 'tbl' }, h('tbody', null, rows)));
  H = PX.cards.open({ title: S.gunluk + ' — ' + S.arsiv, body, foot: [{ label: S.tamam, cls: 'pri' }] });
}

// ---------------------------------------------------------------- render
function render(box) {
  if (!box) return; const S = PX.STR; const h = PX.cards.h; box.textContent = '';
  const li = lockInfo(); const nx = nextLevel();
  const all = PX.LEVELS || []; const nSolved = all.filter(l => solved(l.id)).length;
  box.appendChild(h('div', { class: 'kalp' }, heart(nSolved), h('div', { class: 'kt' }, h('b', { text: S.kalp }), PX.t('kalpNot', { n: nSolved }))));
  // Günün Manevrası
  if (PX.daily && PX.daily.pool && PX.daily.pool.length) {
    const d = PX.daily.today(); const g = (PX.store && PX.store.data.gunluk) || {}; const n = (PX.store && PX.store.data.istat && PX.store.data.istat.gunSayisi) || 0;
    const done = d && g[d.date] && g[d.date].cozuldu;
    const nPlayed = PX.daily.played ? PX.daily.played() : n;
    box.appendChild(h('div', { class: 'daily-card' }, h('div', { class: 'dt' }, h('b', { text: S.gunluk + (d ? ' · ' + d.date : '') }), (done ? '✓ ' + S.cozuldu + ' · ' : '') + PX.t('gunSayisi', { n: nPlayed }) + ' — ' + S.gunlukNot),
      h('div', { class: 'row', style: 'flex-direction:column;gap:6px' },
        h('button', { class: 'sm pri', type: 'button', text: S.basla, onclick: () => PX.screens.playDaily() }),
        PX.daily.archive ? h('button', { class: 'sm', type: 'button', text: S.arsiv, onclick: archive }) : null)));
  }
  for (const [n, list] of chapters()) {
    const ns = list.filter(l => solved(l.id)).length; const chOpen = list.length && li.get(list[0].id).chOpen;
    const sec = h('section', { class: 'district' + (chOpen ? '' : ' locked'), 'aria-label': S.bolum[n] || ('Bölüm ' + n) });
    sec.appendChild(h('div', { class: 'dh' }, h('h3', { text: (S.bolum[n] || ('Bölüm ' + n)) }), h('span', { class: 'dn', text: ns + '/' + list.length })));
    sec.appendChild(skyline(n, list.length ? ns / list.length : 0));
    if (!chOpen) sec.appendChild(h('div', { class: 'dnote', text: '🔒 ' + S.bolumKilit }));
    const grid = h('div', { class: 'lv-grid' });
    list.forEach((lv, i) => {
      const r = rec(lv.id); const done = !!(r && r.cozuldu); const L = li.get(lv.id) || { open: true };
      const best = done && r.en ? ['h', 'm', 'k', 'o'].map(m => r.en[m] ? r.en[m][0] : '—') : null;
      const o = lv.kanit && lv.kanit.opt;
      const b = h('button', { type: 'button', class: 'lvl-btn' + (done ? ' done' : '') + (lv.id === nx ? ' next' : '') + (L.open ? '' : ' lock'), 'data-testid': 'lvl-' + lv.id,
        'aria-label': `${PX.screens.woNo(lv)} ${lv.ad}${done ? ' — ' + S.cozuldu : ''}${L.open ? '' : ' — kilitli'}` },
        h('span', { class: 'ln1' }, h('span', { text: PX.screens.woNo(lv) }), lv.sinif ? h('span', { class: 'cls ' + lv.sinif, text: S.sinif[lv.sinif] || lv.sinif }) : null, r && r.ipuclu ? h('span', { text: '· ' + S.ipuclu }) : null),
        h('span', { class: 'ln2', text: (L.open ? '' : '🔒 ') + lv.ad }),
        h('span', { class: 'ln3', text: best ? `${S.hamleK} ${best[0]}${o ? '/' + o.hamle[0] : ''} · ${S.manevraK} ${best[1]} · ${S.kesintiK} ${best[2]}` + (r.muhur && r.muhur.length ? ' · ★' + r.muhur.length : '') : (lv.id === nx ? '▶ sıradaki iş emri' : S.cozulmedi) }),
        bldIcon(done));
      b.addEventListener('click', () => { if (!L.open) { PX.cards.toast(L.why, 'info'); return; } PX.screens.play(lv.id, { card: true }); });
      grid.appendChild(b);
    });
    sec.appendChild(grid); box.appendChild(sec);
  }
  if (!all.length) box.appendChild(h('p', { text: 'Seviye yok.' }));
  const n = box.querySelector('.lvl-btn.next'); if (n) requestAnimationFrame(() => { try { n.scrollIntoView({ block: 'center' }); } catch (e) { /* yoksay */ } });
}
PX.world = { init() {}, render, nextLevel, unlocked };
