// ============================================================================
// ui/hud.js — PX.hud : sayaçlar, çözülebilirlik lambası, kemer (kilit/yedek/takım), eylem çipleri, kontrol
//             düğmeleri, ipucu penceresi, iş emri şeridi, İŞ LİSTESİ (sim2.checklist), cihaz etiketleri (kod + durum
//             rozeti; seçili/rehber cihazda tam işlev adı sim2.labelOf), iş noktası altyazısı (def.is.ad) (§11.2, §25)
//                                                                               sahip: UI
// SUNUM DURUMU (§12.5): sayaçlar, lamba ve kemer yalnız 'anim:step' (adım animasyonu bitince) ile ilerler; geri al /
// yinele / baştan sonrası PX.game.state().presentation okunur. Controller'ın 'lamp' olayı mantıksal durumu taşır;
// kuyruk doluyken yok sayılır ve lamba sunulan durum için PX.solver.dist(...) ile yeniden hesaplanır — lamba hiçbir
// zaman oyuncunun gördüğünün önüne geçmez.
// Kare başına iş: yalnız cihaz kodu kaplaması, YALNIZ kamera değiştiyse (sabit durumda ayırma yok).
// DOM kimlikleri (testler kullanır): [data-testid=hud-top], [data-testid=hud-controls], btn-undo, btn-redo,
//   btn-rot-left, btn-rot-right, btn-hint, btn-menu, btn-defter, [data-testid=chip][data-tok], [data-testid=lamp],
//   [data-testid=task] (iş listesi; [data-k] öğeler, .done), [data-testid=dl][data-el] cihaz etiketleri, [data-testid=dl-work]
//   PX.hud.init()   PX.hud.chips() -> [tok]   PX.hud.metric -> 'h'|'k' (ipucu ölçütü)   PX.hud.peek(html, ms)
//   PX.hud.hintOpen() -> bool   PX.hud.revealOpt()   PX.hud.applySettings(ayar)
// ============================================================================
const $ = id => document.getElementById(id);
const SIM = PX.SIM;
const ICON = {
  ok: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg>',
  dead: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
  busy: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 1.5a4.5 4.5 0 1 1-4.5 4.5"/></svg>',
  lock: '<svg viewBox="0 0 14 14"><path d="M4 6V4.5a3 3 0 0 1 6 0V6" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2.5" y="6" width="9" height="6.5" rx="1.2" fill="currentColor"/></svg>',
  fuse: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="2" width="6" height="10" rx="1"/><path d="M7 0.5v13"/></svg>',
  earth: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 1v6M2 7h10M4 9.5h6M5.8 12h2.4"/></svg>',
  eye: '<svg viewBox="0 0 16 12" width="16" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 6q7-7 14 0q-7 7-14 0z"/><circle cx="8" cy="6" r="1.8" fill="currentColor"/></svg>',
};
const H = {
  L: null, lv: null, id: null, presS: null, tot: { h: -1, m: -1, k: -1, o: -1 }, chipActs: [], metric: 'h', hintOpen: false,
  labels: [], labOn: true, labShown: true, labDirty: true, cam: new Float64Array(10), tmp: { x: 0, y: 0 }, peekT: 0, optShown: false,
  task: [], taskOpen: false, hot: null, guide: null,
};
const T = () => PX.STR;

// ---------------------------------------------------------------- dokunuş: eylem pointerup'ta (§12.3 giriş kilidi 0 ms, §12.7 sessiz ret yok)
// Chrome, tuvaldeki hızlı kaydırmanın fırlatması (fling) sürerken gelen dokunuşu "fling iptali" sayar ve sentetik
// 'click'i yutar: düğmeye pointerdown + pointerup gelir, click GELMEZ (kaydırmadan ~150–300 ms sonra Geri Al sessizce
// kayboluyordu). Bu yüzden HUD düğmeleri ve çipler pointerup'ta tetiklenir. Dokunmada ardından gelecek click,
// touchend'de preventDefault ile iptal edilir (düğme açtığı sayfanın arka planına "hayalet tık" da düşmez); fare/kalem
// click'i zaman penceresiyle tekilleştirilir. Klavye (Enter/Boşluk) ve programatik .click() pointer olayı üretmez:
// click yolu çalışır.
const TAP_SLOP = 14, TAP_DEDUP_MS = 700;
function onTap(el, fn) {
  if (!el) return;
  let pid = null, x0 = 0, y0 = 0, last = -1e9, eatTouch = false, downAt = -1e9;
  el.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    pid = ev.pointerId; x0 = ev.clientX; y0 = ev.clientY; downAt = performance.now();
  });
  el.addEventListener('pointercancel', () => { pid = null; });
  el.addEventListener('pointerup', ev => {
    if (pid === null || ev.pointerId !== pid) return; pid = null;
    if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > TAP_SLOP) return;
    const r = el.getBoundingClientRect();
    if (ev.clientX < r.left - 6 || ev.clientX > r.right + 6 || ev.clientY < r.top - 6 || ev.clientY > r.bottom + 6) return;
    last = performance.now(); eatTouch = ev.pointerType === 'touch';
    fn(ev);
  });
  el.addEventListener('touchend', ev => { if (eatTouch) { eatTouch = false; if (ev.cancelable) ev.preventDefault(); } }, { passive: false });
  el.addEventListener('click', ev => {
    if (ev.detail > 0 && performance.now() - last < TAP_DEDUP_MS) { ev.preventDefault(); return; }   // detail 0: klavye/.click()
    // hayalet tık: dokunuş başka yerde (tuval) başlayıp bu düğme parmağın altında YENİ belirdiyse tarayıcının ürettiği
    // click buraya düşer (ör. Volti'ye dokununca çıkan çip). Bu öğede basış yoksa fare/dokunuş tıklaması yok sayılır.
    if (ev.detail > 0 && performance.now() - downAt > 1500) { ev.preventDefault(); return; }
    fn(ev);
  });
}

// ---------------------------------------------------------------- sayaçlar
function setTot(t) {
  if (!t) return;
  for (const m of ['h', 'm', 'k', 'o']) {
    const v = t[m] | 0; if (H.tot[m] === v) continue;
    const first = H.tot[m] < 0; H.tot[m] = v; $('cnt-' + m).textContent = v;
    if (!first) { const c = $('c-' + m); c.classList.remove('tick'); void c.offsetWidth; c.classList.add('tick'); }
  }
}
function optVals(lv) { const o = lv && lv.kanit && lv.kanit.opt; if (!o) return null; return { h: o.hamle && o.hamle[0], m: o.manevra && o.manevra[1], k: o.kesinti && o.kesinti[2], o: o.olay && o.olay[3] }; }
function showOpt(on) {
  const ov = on ? optVals(H.lv) : null; H.optShown = !!ov;
  for (const m of ['h', 'm', 'k', 'o']) { const e = $('opt-' + m); e.textContent = ov && ov[m] !== undefined ? '/' + ov[m] : ''; e.title = ov ? T().optimum : ''; }
}
function solvedBefore(id) { try { const r = PX.store && PX.store.data.seviye[id]; return !!(r && r.cozuldu); } catch (e) { return false; } }

// ---------------------------------------------------------------- lamba (sunum durumu için)
function lampFor(s) {
  let d = null; try { d = PX.solver && s ? PX.solver.dist(s) : null; } catch (e) { d = null; }
  lampSet(d === null || d === undefined ? 'busy' : d < 0 ? 'dead' : 'ok');
}
function lampSet(state) {
  const el = $('lamp'); if (el.getAttribute('data-state') === state) return;
  el.setAttribute('data-state', state); el.className = 'lamp ' + state;
  const txt = state === 'ok' ? T().cozumMumkun : state === 'dead' ? T().cikmaz : T().hesaplaniyor;
  el.title = txt; $('lamp-txt').textContent = txt; $('lamp-ic').innerHTML = ICON[state];
  el.setAttribute('aria-label', txt);
  $('lamp-undo').hidden = state !== 'dead';
}

// ---------------------------------------------------------------- kemer
function belt() {
  const box = $('belt'); const L = H.L, s = H.presS; box.textContent = ''; if (!L || !s) return;
  const S = T();
  if (L.kilit > 0) {
    let used = 0; for (let x = s.lk; x; x &= x - 1) used++;
    const b = document.createElement('span'); b.className = 'bi'; b.title = PX.t('kilitKalan', { n: L.kilit - used, top: L.kilit });
    for (let i = 0; i < L.kilit; i++) { const k = document.createElement('span'); k.innerHTML = ICON.lock; k.style.color = '#ff8090'; if (i >= L.kilit - used) k.className = 'used'; b.appendChild(k); }
    box.appendChild(b);
  }
  if (L.yedek > 0) { const b = document.createElement('span'); b.className = 'bi'; b.title = PX.t('yedekKalan', { n: s.sp }); b.innerHTML = ICON.fuse + '<span>' + s.sp + '</span>'; b.style.color = s.sp ? '#ffcf9a' : 'var(--dim)'; box.appendChild(b); }
  if (L.nSet) { const b = document.createElement('span'); b.className = 'bi'; const on = s.st > 0; b.title = on ? PX.t('setTakili', { b: L.els[L.baras[s.st - 1].el].id }) : S.setBosta; b.innerHTML = ICON.earth; b.style.color = on ? '#c8d93a' : 'var(--muted)'; if (!on) b.style.opacity = '.75'; box.appendChild(b); }
}

// ---------------------------------------------------------------- çipler
function chipPreviewText(x) {
  const S = T(); const p = x.preview; if (!p) return '';
  if (p.ok === false) { const k = S.nedenKart[p.err]; return '⚠ ' + (k ? k[0] : (p.msg || p.err)); }
  const parts = [];
  if (p.c && p.c.m) parts.push(S.manevraK + ' +' + p.c.m);
  if (p.c && p.c.o) parts.push(S.olayK + ' +' + p.c.o);
  if (p.kesintiDelta) parts.push(S.kesintiK + ' ' + (p.kesintiDelta > 0 ? '+' : '') + p.kesintiDelta + '/komut');
  if (p.olu && p.olu.length && H.L) {
    const set = new Set(p.olu.map(n => H.L.nodeIdx[n])); const names = [];
    for (const ld of H.L.loads) if (set.has(ld.node)) names.push(H.L.els[ld.el].ad || H.L.els[ld.el].id);
    if (names.length) parts.push('düşer: ' + names.join(', '));
  }
  if (p.yedekDelta) { const sp = H.presS ? H.presS.sp : 0; parts.push('yedek: ' + sp + ' → ' + (sp + p.yedekDelta)); }
  return parts.join(' · ');
}
function chips(p) {
  const box = $('chips'); box.textContent = ''; H.chipActs = (p && p.actions) || [];
  box.classList.remove('shake'); box.classList.add('chips-in');
  // seçili cihazın tam adı + durum rozetleri (oyuncu NE'ye dokunduğunu bilir)
  if (p && p.title && H.chipActs.length) {
    const hd = document.createElement('div'); hd.className = 'chip-head'; hd.setAttribute('data-testid', 'chip-head');
    const b = document.createElement('b'); b.textContent = p.title; hd.appendChild(b);
    for (const t of badgeList(p.state, H.L && p.el ? H.L.els[H.L.elIndex[p.el]] : null)) { const sp = document.createElement('span'); sp.className = 'bdg ' + t[0]; sp.textContent = t[1]; hd.appendChild(sp); }
    box.appendChild(hd);
  }
  H.chipActs.forEach((x, i) => {
    const b = document.createElement('button'); b.type = 'button';
    const bad = x.preview && x.preview.ok === false;
    b.className = 'chip-btn' + (bad ? ' bad' : '') + (x.preview && x.preview.yedekDelta ? ' irrev' : '');
    b.setAttribute('data-testid', 'chip'); b.setAttribute('data-tok', x.tok);
    const k = document.createElement('span'); k.className = 'ck'; k.textContent = i < 9 ? String(i + 1) : ''; b.appendChild(k);
    const t = document.createElement('span'); t.className = 'ct';
    const c1 = document.createElement('span'); c1.className = 'c1'; c1.textContent = (p.el ? p.el + ' · ' : '') + chipLabel(x); t.appendChild(c1);
    const sub = chipPreviewText(x); if (sub) { const c2 = document.createElement('span'); c2.className = 'c2'; c2.textContent = sub; t.appendChild(c2); }
    b.appendChild(t);
    if (bad && x.preview.msg) b.title = x.preview.msg;
    b.setAttribute('aria-label', c1.textContent + (sub ? ' — ' + sub : ''));
    onTap(b, () => { if (!b.isConnected) return; clearChips(); const ok = PX.game.command({ t: 'act', a: x.a, tok: x.tok }); if (!ok && p && PX.game.state && !PX.game.state().busy) chips(p); });
    box.appendChild(b);
  });
  box.hidden = !H.chipActs.length;
}
// Sabit topraklama ayırıcısı (el.t 'toprak') bir anahtardır: "Kapat (toprakla)" / "Aç (topraklamayı kaldır)". Controller
// etiketi taşınabilir takım ifadesini ("Topraklama takımını tak/sök") her ikisi için kullanır; burada ayrılır.
function chipLabel(x) {
  const lab = String(x.label || ''); const a = x.a; const L = H.L; const E = T().eylem || {};
  const el = a && a.t === 'op' && L && a.e !== undefined ? L.els[a.e] : null;
  if (!el || el.t !== 'toprak' || !E.toprakKapat) return lab;
  let s = null; try { s = PX.game.state().s; } catch (e) { s = null; }
  const kap = s ? !((s.b >> el.bit) & 1) : lab.indexOf(E.topraklaSok) < 0;
  const word = kap ? E.toprakKapat : E.toprakAc;
  const i = lab.lastIndexOf(' · '); return i >= 0 ? lab.slice(0, i + 3) + word : word;
}
function clearChips() { if (!H.chipActs.length && $('chips').hidden) return; chips(null); }
function shakeChips() { const b = $('chips'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }

// ---------------------------------------------------------------- İŞ LİSTESİ (sim2.checklist, sunum durumu)
// Beş altın kural (1–5), iş, geri verme, hedef yükler, normal konum… Her adım sunulunca yeniden hesaplanır (olay anında;
// kare başına değil). Kapalıyken tek satır: "3/8 · Sıradaki: 2 Kilitle ve etiketle…"; dokununca liste açılır.
const GRUP = { altin: 'Beş altın kural', is: 'İş', geri: 'Geri verme', hedef: 'Hedef' };
function taskList() {
  const box = $('task'); if (!box) return; const L = H.L, s = H.presS;
  let items = []; try { items = L && s ? SIM.checklist(L, s) : []; } catch (e) { items = []; }
  const sig = items.map(x => x.k + (x.done ? 1 : 0)).join('|'); if (sig === H.taskSig && !box.hidden === !!items.length) return; H.taskSig = sig;
  H.task = items; box.hidden = !items.length; if (!items.length) return;
  const S = T(); const done = items.filter(x => x.done).length; const next = items.find(x => !x.done);
  $('task-n').textContent = done + '/' + items.length;
  $('task-next').textContent = next ? S.siradaki + ': ' + next.ad : S.tamamlandi;
  box.classList.toggle('all', !next);
  $('task-btn').setAttribute('aria-label', S.isListesi + ' ' + done + '/' + items.length + (next ? ' — ' + S.siradaki + ': ' + next.ad : ''));
  const list = $('task-list'); list.textContent = ''; let g = '';
  for (const it of items) {
    if (it.grup !== g) { g = it.grup; const hg = document.createElement('li'); hg.className = 'tg'; hg.textContent = GRUP[g] || g; list.appendChild(hg); }
    const li = document.createElement('li'); li.setAttribute('data-k', it.k);
    li.className = 'ti' + (it.done ? ' done' : '') + (it === next ? ' next' : '');
    const m = document.createElement('span'); m.className = 'tm'; m.innerHTML = it.done ? ICON.ok : ''; li.appendChild(m);
    const t = document.createElement('span'); t.textContent = it.ad; li.appendChild(t);
    list.appendChild(li);
  }
}
function taskToggle(on) {
  H.taskOpen = on === undefined ? !H.taskOpen : !!on;
  const box = $('task'); if (!box) return;
  box.classList.toggle('open', H.taskOpen); $('task-list').hidden = !H.taskOpen;
  $('task-btn').setAttribute('aria-expanded', String(H.taskOpen));
}
function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------------------------------------------------------------- düğme durumları
function controlsState() {
  if (!PX.game || !PX.game.L) return; const st = PX.game.state();
  $('btn-undo').setAttribute('aria-disabled', String(!st.hist)); $('btn-redo').setAttribute('aria-disabled', String(!st.redo));
}

// ---------------------------------------------------------------- ipucu penceresi
function buildHint() {
  const S = T(); const pop = $('hint-pop'); pop.textContent = '';
  const h3 = document.createElement('h3'); h3.innerHTML = '<span>' + S.ipucu + '</span>'; pop.appendChild(h3);
  const lab = document.createElement('div'); lab.className = 'note'; lab.textContent = S.ipucuMetrik; pop.appendChild(lab);
  const seg = document.createElement('div'); seg.className = 'hp-row seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', S.ipucuMetrik);
  for (const [m, l] of [['h', S.hamleK], ['k', S.kesintiK]]) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.setAttribute('data-m', m); b.setAttribute('aria-pressed', String(H.metric === m));
    onTap(b, () => setMetric(m)); seg.appendChild(b);
  }
  pop.appendChild(seg);
  const row = document.createElement('div'); row.className = 'hp-row';
  for (const tier of [1, 2]) {
    const b = document.createElement('button'); b.type = 'button'; b.id = 'hint-' + tier; b.textContent = tier === 1 ? S.ipucu1 : S.ipucu2;
    onTap(b, () => { $('hint-out').textContent = S.ipucuBekle; PX.game.command({ t: 'hint', tier, metric: H.metric }); });
    row.appendChild(b);
  }
  pop.appendChild(row);
  const radio = document.createElement('div'); radio.id = 'hint-radio'; radio.className = 'radio'; radio.hidden = true; pop.appendChild(radio);
  const out = document.createElement('div'); out.id = 'hint-out'; out.setAttribute('aria-live', 'polite'); pop.appendChild(out);
  const note = document.createElement('div'); note.className = 'note'; note.textContent = S.ipucuNot; pop.appendChild(note);
}
function setMetric(m) {
  H.metric = m === 'k' ? 'k' : 'h';
  for (const b of $('hint-pop').querySelectorAll('[data-m]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-m') === H.metric));
  try { if (PX.store) PX.store.set('ayar.ipucuMetrik', H.metric); } catch (e) { /* yoksay */ }
  PX.bus.emit('ui:metric', { m: H.metric });
}
function hintToggle(on) {
  H.hintOpen = on === undefined ? !H.hintOpen : !!on;
  $('hint-pop').classList.toggle('on', H.hintOpen); $('btn-hint').classList.toggle('on', H.hintOpen); $('btn-hint').setAttribute('aria-expanded', String(H.hintOpen));
  if (H.hintOpen) {
    const lv = H.lv || {}; const r = (lv.isEmri && lv.isEmri.telsiz) || lv.telsiz; const rb = $('hint-radio');
    if (rb) { rb.textContent = r || ''; rb.hidden = !r; }
    $('hint-out').textContent = ''; const b = $('hint-1'); if (b) try { b.focus({ preventScroll: true }); } catch (e) { /* yoksay */ } }
}
function describeTok(tok) {
  const L = H.L; if (!L || !tok) return ''; const st = PX.game.state(); const s = st.s; let a = null;
  try { a = SIM.decodeAct(L, s, tok); } catch (e) { a = null; } if (!a) return tok;
  if (a.t === 'git') return 'Yürü';
  let r = null; try { r = SIM.apply(L, s, a); } catch (e) { r = null; }
  const d = SIM.describe(L, s, a, r && !r.err ? r : { c: { m: 1 } });
  return d ? (PX.trLine ? PX.trLine(d) : d) : tok;
}
function onHint(p) {
  if (!p) return;
  // Bekleyen/ücretsiz yanıt koşuyu işaretlemez; gerçek öneri arka plan güncellemesiyle de gelebilir.
  if (!p.free && !p.dead && (p.a || p.el || (p.acts && p.acts.length)) && PX.screens && PX.screens.noteHint) PX.screens.noteHint();
  if (!H.hintOpen) return;
  const out = $('hint-out'); out.textContent = '';
  if (p.why) { const d = document.createElement('div'); d.textContent = PX.trLine ? PX.trLine(p.why) : p.why; out.appendChild(d); }
  // ok satırı: sıradaki ANAHTAR eylem (p.a: cihaz işlemi / iş); acts[0] çoğu zaman bir yürüyüştür
  const key = p.a || (p.acts && p.acts.find(t => t && !/^g\d/.test(t))) || (p.acts && p.acts[0]);
  if (key) { const d = document.createElement('div'); d.style.color = 'var(--cyan)'; d.textContent = '→ ' + describeTok(key); out.appendChild(d); }
  if (!out.textContent) out.textContent = T().hesaplaniyor;
}

// ---------------------------------------------------------------- iş emri şeridi (dokunmayı engellemez)
function peek(html, ms) {
  const el = $('peek'); clearTimeout(H.peekT);
  if (!html) { el.classList.add('off'); return; }
  el.innerHTML = html; el.classList.remove('off');
  H.peekT = setTimeout(() => el.classList.add('off'), ms || 3800);
}

// ---------------------------------------------------------------- cihaz kodu kaplaması
// Her cihazda kod + durum rozeti (metin: KAPALI/AÇIK, CANLI, ÖLÜ·TOPRAKSIZ, TOPRAKLI, KİLİTLİ; renk tek ipucu değil).
// Seçili (çip) ya da rehber cihazında tam işlev adı (sim2.labelOf: "Q01 Okul fideri kesicisi"). İş noktası karosunda
// altyazı (def.is.ad). Hedef yükte HEDEF rozeti (beslenince ✓). Metin yalnız durum değişince yazılır.
// compact: sahne etiketi (kalabalık olmasın): anahtarlarda yalnız konum (+ kilit/eridi), iletkenlerde (bara, toprak,
// kondansatör, arıza) gerilim durumu. Seçili cihazın çip başlığında tam liste (compact = false).
function badgeList(ds, e, compact) {
  const S = T(); const out = []; if (!ds || !e) return out;
  if (e.t === 'yuk') return out;
  if (compact && (e.t === 'kesici' || e.t === 'ayirici' || e.t === 'yuk_ayirici' || e.t === 'sigorta' || e.t === 'kontaktor' || e.t === 'buton' || e.t === 'kaynak' || e.t === 'trafo')) {
    if (ds.closed !== undefined && e.t !== 'sigorta') out.push(['sw', ds.closed ? S.kapaliK : S.acikK]);
    if (ds.blown) out.push(['warn', S.eridi]);
    if (ds.locked) out.push(['lock', '🔒']);
    return out;
  }
  if (ds.closed !== undefined && e.t !== 'sigorta' && e.t !== 'kapi') out.push(['sw', ds.closed ? S.kapaliK : S.acikK]);
  if (ds.blown) out.push(['warn', S.eridi]);
  if (e.t !== 'kaynak' && e.t !== 'kapi') { if (ds.live) out.push(['live', S.canli]); else if (ds.earthed) out.push(['earth', S.toprakli]); else out.push(['dead', S.oluTopraksizK]); }
  if (ds.locked) out.push(['lock', '🔒 ' + S.kilitli]);
  if (ds.charge) out.push(['warn', S.yuklu + ' ' + ds.charge + '/3']);
  return out;
}
function buildLabels() {
  const box = $('labels'); box.textContent = ''; H.labels.length = 0; H.labDirty = true;
  const L = H.L; if (!L) return;
  const goal = new Set(); L.loads.forEach((l, i) => { if ((L.goalMask >> i) & 1) goal.add(l.el); });
  for (const e of L.els) {
    if (e.cell < 0 || e.t === 'kablo' || e.t === 'yardimci') continue;
    const [x, y, z] = L.G.xyz(e.cell);
    const d = document.createElement('div'); d.className = 'dl'; d.setAttribute('data-testid', 'dl'); d.setAttribute('data-el', e.id);
    const n = document.createElement('span'); n.className = 'dn'; n.textContent = e.id; d.appendChild(n);
    const b = document.createElement('span'); b.className = 'ds'; d.appendChild(b);
    box.appendChild(d);
    H.labels.push({ el: d, nEl: n, bEl: b, e: e.i, cell: e.cell, id: e.id, full: SIM.labelOf(L, e.i), goal: goal.has(e.i), x, y: y + 0.62, z, shown: false, sig: '', mw: -1, mh: 0, box: { x: 0, y: 0, w: 0, h: 0, dx: 0, dy: 0 } });
  }
  if (L.work >= 0) {
    const [x, y, z] = L.G.xyz(L.work); const S = T(); const ad = (L.def.is && L.def.is.ad) || S.isNoktasi;
    const d = document.createElement('div'); d.className = 'dl work'; d.setAttribute('data-testid', 'dl-work');
    d.innerHTML = '<span class="dn">İŞ</span>'; const t = document.createElement('span'); t.className = 'ds'; t.textContent = ad; d.appendChild(t); box.appendChild(d);
    H.labels.push({ el: d, e: -1, cell: L.work, id: '#is', full: ad, goal: false, x, y: y + 0.55, z, shown: false, sig: '', work: true, mw: -1, mh: 0, box: { x: 0, y: 0, w: 0, h: 0, dx: 0, dy: 0 } });
  }
  H.boxes = H.labels.map(l => l.box);
  labelStates();
}
function labelStates() {
  const L = H.L, s = H.presS; if (!L || !s) return; const S = T();
  let E = null; try { E = SIM.stateE(L, s); } catch (e) { E = null; }
  for (const lb of H.labels) {
    if (lb.work) { const done = !!s.w; const sig = done ? 'w1' : 'w0'; if (sig !== lb.sig) { lb.sig = sig; lb.el.classList.toggle('done', done); lb.mw = -1; H.labDirty = true; } continue; }
    const e = L.els[lb.e]; let txt = '', cls = '';
    if (e.t === 'yuk' && lb.goal) { const fed = E && ((E.loadMask >> e.li) & 1); txt = fed ? '✓ ' + S.hedefRozet : S.hedefRozet; cls = fed ? 'gok' : 'ggoal'; }
    else { let ds = null; try { ds = SIM.deviceState(L, s, lb.e); } catch (x) { ds = null; } const hot0 = H.hot === lb.id || (!!H.guide && H.guide === lb.id); const bl = badgeList(ds, e, !hot0); txt = bl.map(t => t[1]).join(' · ');
      const pick = bl.find(t => t[0] === 'lock') || bl.find(t => t[0] !== 'sw') || bl[0]; cls = pick ? pick[0] : ''; }
    const hot = H.hot === lb.id || (H.guide && H.guide === lb.id);
    const sig = txt + '|' + cls + '|' + (hot ? 1 : 0);
    if (sig === lb.sig) continue; lb.sig = sig;
    lb.nEl.textContent = hot ? lb.full : lb.id; lb.bEl.textContent = txt; lb.bEl.className = 'ds ' + cls; lb.bEl.hidden = !txt;
    lb.mw = -1; H.labDirty = true;
  }
}
// Kamera ayıklamasından sonra kenara kırpmak kutuları yeniden çakıştırır. Son yerleşim sınırlar içinde aranır.
function fitLabels(boxes, W, height) {
  const placed = [];
  const order = boxes.slice().sort((a, b) => b.w * b.h - a.w * a.h);
  for (const b of order) {
    const minX = b.w / 2 + 2, maxX = W - minX, minY = b.h / 2 + 2, maxY = height - minY;
    const x0 = Math.max(minX, Math.min(maxX, b.x + b.dx)), y0 = Math.max(minY, Math.min(maxY, b.y + b.dy));
    const xs = [x0, minX, maxX], ys = [y0, minY, maxY];
    for (const p of placed) { xs.push(p.x - (p.w + b.w) / 2 - 2, p.x + (p.w + b.w) / 2 + 2); ys.push(p.y - (p.h + b.h) / 2 - 2, p.y + (p.h + b.h) / 2 + 2); }
    let best = Infinity, bx = x0, by = y0;
    for (const y of ys) {
      if (y < minY || y > maxY) continue;
      for (const x of xs) {
        if (x < minX || x > maxX) continue;
        const dist = (x - x0) ** 2 + (y - y0) ** 2; if (dist >= best) continue;
        let hit = false;
        for (const p of placed) if (Math.abs(x - p.x) < (b.w + p.w) / 2 + 1 && Math.abs(y - p.y) < (b.h + p.h) / 2 + 1) { hit = true; break; }
        if (!hit) { best = dist; bx = x; by = y; }
      }
    }
    b.x = bx; b.y = by; b.dx = b.dy = 0; placed.push(b);
  }
}
function frameHook() {
  if (!H.labOn || !H.labels.length) return;
  const C = PX.camera; if (!C || !C.cam) return;
  const busy = C.busy ? C.busy() : false;
  if (busy) { if (H.labShown) { $('labels').style.visibility = 'hidden'; H.labShown = false; } return; }
  const cam = C.cam, sc = PX.scene, k = H.cam;
  const a0 = C.az, a1 = cam.position.x, a2 = cam.position.y, a3 = cam.position.z, a4 = cam.zoom, a5 = cam.top, a6 = cam.right, a7 = sc ? sc.w : 0, a8 = sc ? sc.h : 0, a9 = C.v;
  if (!H.labDirty && k[0] === a0 && k[1] === a1 && k[2] === a2 && k[3] === a3 && k[4] === a4 && k[5] === a5 && k[6] === a6 && k[7] === a7 && k[8] === a8 && k[9] === a9) {
    if (!H.labShown) { $('labels').style.visibility = ''; H.labShown = true; } return;
  }
  k[0] = a0; k[1] = a1; k[2] = a2; k[3] = a3; k[4] = a4; k[5] = a5; k[6] = a6; k[7] = a7; k[8] = a8; k[9] = a9; H.labDirty = false;
  // Kural sürümü 4: hiçbir şey gizli değil (örtücüler saydam) => bütün etiketler görünür. Yalnız kamera/metin değişince:
  // etiket boyutu (metni değiştiyse) bir kez ölçülür, camera.declutter çakışmayı giderir, sahne kenarına kırpılır.
  const rect = sc && sc.rect ? sc.rect : { left: 0, top: 0, width: 375, height: 667 };
  const W = rect.width || 375, Hh = rect.height || 667;
  for (let i = 0; i < H.labels.length; i++) {
    const lb = H.labels[i];
    if (!lb.shown) { lb.shown = true; lb.el.style.display = ''; }
    if (lb.mw < 0) { lb.mw = lb.el.offsetWidth; lb.mh = lb.el.offsetHeight; }
    C.worldToClient(lb.x, lb.y, lb.z, H.tmp);
    const b = lb.box; b.w = lb.mw; b.h = lb.mh; b.x = H.tmp.x - rect.left; b.y = H.tmp.y - rect.top - lb.mh / 2 - 6; b.dx = 0; b.dy = 0;
  }
  if (C.declutter) { try { C.declutter(H.boxes); } catch (e) { /* çakışma giderme isteğe bağlı */ } }
  fitLabels(H.boxes, W, Hh);
  for (let i = 0; i < H.labels.length; i++) {
    const lb = H.labels[i], b = lb.box;
    let x = b.x + b.dx - b.w / 2, y = b.y + b.dy - b.h / 2;
    lb.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
  }
  if (!H.labShown) { $('labels').style.visibility = ''; H.labShown = true; }
}
function hotLabel(id) {
  H.hot = id || null;
  for (const lb of H.labels) { lb.el.classList.toggle('hot', !!id && lb.id === id); lb.el.classList.toggle('guide', !!H.guide && lb.id === H.guide); }
  labelStates();
}

// ---------------------------------------------------------------- ayarlar
function applySettings(a) {
  a = a || (PX.store ? PX.store.data.ayar : {}) || {};
  const app = $('app');
  const rm = !!a.hareketAzalt; app.classList.toggle('rm', rm);
  app.classList.toggle('lefty', !!a.solak);
  H.labOn = a.etiketler !== false; $('labels').hidden = !H.labOn; H.labDirty = true;
  H.metric = a.ipucuMetrik === 'k' ? 'k' : 'h';
  const pop = $('hint-pop');
  if (pop) for (const b of pop.querySelectorAll('[data-m]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-m') === H.metric));
}

// ---------------------------------------------------------------- olaylar
function onLevel(p) {
  H.L = p.L; H.lv = p.level; H.id = p.id; H.presS = p.s; H.tot = { h: -1, m: -1, k: -1, o: -1 }; H.lampDead = false;
  const lv = p.level || {}; const S = T();
  let no = PX.screens && PX.screens.woNo ? PX.screens.woNo(lv) : S.isEmri;
  if (PX.daily && PX.daily.current) no = S.gunluk;
  $('lvl-no').textContent = no; $('lvl-name').textContent = lv.ad || p.id;
  $('lvl-title').setAttribute('aria-label', no + ' · ' + (lv.ad || p.id) + ' — ' + S.isEmri);
  setTot({ h: 0, m: 0, k: 0, o: 0 }); showOpt(solvedBefore(p.id));
  H.hot = null; H.guide = null; H.taskSig = null;
  clearChips(); hintToggle(false); belt(); buildLabels(); lampFor(p.s); controlsState(); taskList();
  taskToggle(false);                                             // kapalı başlar: tek satır 'Sıradaki: …' (sahneyi örtmez)
}
function fromPresentation() {
  const st = PX.game.state(); H.presS = st.presentation.s || st.s;
  setTot(st.presentation.tot); belt(); lampFor(H.presS); controlsState(); labelStates(); taskList();
}
function init() {
  const cmd = c => () => PX.game.command(c);
  onTap($('btn-undo'), cmd({ t: 'undo' }));
  onTap($('btn-redo'), cmd({ t: 'redo' }));
  onTap($('btn-rot-left'), cmd({ t: 'rot', d: -1 }));
  onTap($('btn-rot-right'), cmd({ t: 'rot', d: 1 }));
  onTap($('task-btn'), () => taskToggle());
  onTap($('btn-hint'), () => hintToggle());
  onTap($('btn-defter'), () => PX.screens && PX.screens.defter && PX.screens.defter());
  onTap($('btn-menu'), () => PX.screens && PX.screens.menu ? PX.screens.menu() : PX.screens.show('levels'));
  onTap($('lvl-title'), () => PX.screens && PX.screens.workOrder && H.lv && PX.screens.workOrder(H.lv, { fromHud: true }));
  onTap($('lamp-undo'), () => PX.game.command({ t: 'undo' }));
  $('lamp-undo').textContent = T().geriAlSoru;
  const S = T(); for (const m of ['h', 'm', 'k', 'o']) { $('cl-' + m).textContent = S[{ h: 'hamleK', m: 'manevraK', k: 'kesintiK', o: 'olayK' }[m]]; $('c-' + m).title = S[{ h: 'hamle', m: 'manevra', k: 'kesinti', o: 'olay' }[m]]; }
  buildHint();
  window.addEventListener('keydown', ev => { if (ev.key === 'Escape' && H.hintOpen && !(PX.cards && PX.cards.top())) { hintToggle(false); ev.stopPropagation(); } }, true);

  PX.bus.on('level:loaded', onLevel);
  PX.bus.on('anim:step', p => {
    const prev = H.presS; H.presS = p.after || H.presS; setTot(p.tot);
    if (!prev || !p.after || prev.lk !== p.after.lk || prev.sp !== p.after.sp || prev.st !== p.after.st) belt();
    lampFor(H.presS); controlsState();
    if (p.kind !== 'walk') { labelStates(); taskList(); }
  });
  PX.bus.on('anim:done', () => { controlsState(); });
  for (const ev of ['undo', 'redo', 'reset']) PX.bus.on(ev, () => { clearChips(); fromPresentation(); });
  // döndürme yalnız kamera: çipler ve ipucu penceresi yerinde kalır
  PX.bus.on('cmd:accepted', p => { const rot = p.cmd && p.cmd.t === 'rot'; if (p.cmd && p.cmd.t !== 'tap' && !rot) clearChips(); controlsState(); if (H.hintOpen && p.cmd && p.cmd.t !== 'hint' && !rot) hintToggle(false); });
  PX.bus.on('guide', g => { H.guide = g && g.el ? g.el : null; hotLabel(H.hot); });
  PX.bus.on('cmd:rejected', p => { if (p && p.err === 'tampon') shakeChips(); });
  PX.bus.on('lamp', p => { if (!p || (PX.game && PX.game.busy)) return; H.lampDead = p.state === 'dead'; lampFor(H.presS); });
  PX.bus.on('solver:ready', () => lampFor(H.presS));
  PX.bus.on('ui:chip', p => { chips(p); hotLabel(p && p.el); });
  PX.bus.on('win', () => { taskList(); });
  PX.bus.on('ui:chipKey', p => { const x = H.chipActs[p.i]; if (x) { clearChips(); PX.game.command({ t: 'act', a: x.a, tok: x.tok }); } });
  PX.bus.on('hint', onHint);
  PX.bus.on('win', () => { showOpt(true); clearChips(); hintToggle(false); });
  PX.bus.on('settings', p => applySettings(p && p.ayar));
  PX.bus.on('sld:select', p => hotLabel(p && p.el));
  PX.bus.on('screen', () => { H.labDirty = true; });
  if (PX.main && PX.main.onFrame) PX.main.onFrame(frameHook);
  applySettings();
  lampSet('busy');
}
PX.hud = {
  declutterWired: true,
  init, chips: () => H.chipActs.map(x => x.tok), get metric() { return H.metric; }, peek, hintOpen: () => H.hintOpen, revealOpt: () => showOpt(true),
  applySettings, ICON, onTap, chipLabel, task: () => H.task.slice(), taskToggle, badgeList,
};
