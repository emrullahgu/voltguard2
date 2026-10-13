// ============================================================================
// ui/cards.js — PX.cards : sayfa (sheet) yığını, bildirim (toast), Neden? kartları, kural kartları,
//               Kural Kitabı, Saha El Kitabı (Model Notları + Tek Hat lejantı), cihaz bilgi kartı (§11, §5.6, §6.3)
//                                                                               sahip: UI
// Ret geri bildirimi girişi ASLA kilitlemez (ayrı kanal, §12.3): bildirim pointer-events:none'dır; yalnız
// "Neden?" düğmesi dokunulabilir. Ret metni sim2.ERR'den aynen (§2.15); Neden? kartı fiziği ve doğru sırayı anlatır.
// Ark ve arıza akımı yalnız Neden? kartında, durağan illüstrasyon olarak görünür (§1.4; yanıp sönme yok).
//   PX.cards.init()   PX.cards.toast(msg, kind?, {why?:errKodu, ms?})   PX.cards.hideToast()
//   PX.cards.open({title, body, foot:[{label, cls, act, keep}], onClose, label}) -> {el, body, close()}
//   PX.cards.closeAll()  PX.cards.top() -> açık sayfa sayısı
//   PX.cards.why(errKodu)  PX.cards.book()  PX.cards.manual()  PX.cards.device(el, L, s, E)
//   PX.cards.reason(yük) / PX.cards.hideReason()  NEDEN KARTI (kural sürümü 4): erişilemeyen hedef için engel(ler)
//        adıyla, çözüm cihazına "… yanına git" düğmesi ve "Neden?" ile. Dokunmayı engellemez (kartın kendisi hariç);
//        sıradaki kabul edilen komutta kapanır. [data-testid=reason]
//   PX.cards.ruleNode(key) -> HTMLElement   PX.cards.levelRules(L, def) -> [key]   PX.cards.h(tag, attrs, ...kids)
//   [data-testid=toast]   [data-testid=sheet]
// ============================================================================
const $ = id => document.getElementById(id);
function h(tag, attrs) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k]; if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (let i = 2; i < arguments.length; i++) kid(e, arguments[i]);
  return e;
}
function kid(e, c) {                                 // iç içe diziler düzleştirilir; null/false atlanır
  if (c === null || c === undefined || c === false || c === '') return;
  if (Array.isArray(c)) { for (const x of c) kid(e, x); return; }
  e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
}
const T = () => PX.STR;

// ---------------------------------------------------------------- sayfa yığını
const stack = [];
function trDur() { const app = $('app'); return (app && app.classList.contains('rm')) || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 0 : 190; }
function open(o) {
  o = o || {};
  const host = $('sheet-host'); if (!host) return null;
  const prevFocus = document.activeElement;
  const bg = h('div', { class: 'sheet-bg ov' });
  const body = h('div', { class: 'sh-body' });
  if (typeof o.body === 'string') body.appendChild(h('p', { text: o.body })); else if (o.body) body.appendChild(o.body);
  const xb = h('button', { class: 'x', type: 'button', 'aria-label': T().kapat, html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' });
  const sheet = h('div', { class: 'sheet ov' + (o.cls ? ' ' + o.cls : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.label || o.title || '', 'data-testid': 'sheet' },
    h('div', { class: 'sh-head' }, h('h2', { text: o.title || '' }), xb), body);
  let foot = null;
  if (o.foot && o.foot.length) {
    foot = h('div', { class: 'sh-foot' });
    for (const b of o.foot) {
      const btn = h('button', { class: 'sm ' + (b.cls || ''), type: 'button', text: b.label, 'data-testid': b.testid });
      btn.addEventListener('click', () => { if (!b.keep) close(); if (b.act) b.act(); });
      foot.appendChild(btn);
    }
    sheet.appendChild(foot);
  }
  host.appendChild(bg); host.appendChild(sheet);
  let closed = false;
  const H = { el: sheet, body, foot, close, o };
  function close() {
    if (closed) return; closed = true;
    const wasTop = stack[stack.length - 1] === H;
    const i = stack.indexOf(H); if (i >= 0) stack.splice(i, 1);
    bg.classList.remove('on'); sheet.classList.remove('on');
    const d = trDur(); setTimeout(() => { bg.remove(); sheet.remove(); }, d + 20);
    if (o.onClose) try { o.onClose(); } catch (e) { console.error(e); }
    if (wasTop && prevFocus && prevFocus.focus && document.contains(prevFocus)) try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* yoksay */ }
    PX.bus.emit('sheet', { open: stack.length });
  }
  xb.addEventListener('click', close);
  if (o.dismiss !== false) bg.addEventListener('click', close);
  stack.push(H);
  requestAnimationFrame(() => { if (closed) return; bg.classList.add('on'); sheet.classList.add('on'); if (stack[stack.length - 1] !== H) return; const f = sheet.querySelector('.sh-foot .pri') || xb; try { f.focus({ preventScroll: true }); } catch (e) { /* yoksay */ } });
  PX.bus.emit('sheet', { open: stack.length });
  return H;
}
function closeAll() { while (stack.length) stack[stack.length - 1].close(); }

// ---------------------------------------------------------------- bildirim
let tTimer = 0, tWhy = null;
function toast(msg, kind, opts) {
  if (!msg) return; opts = opts || {};
  const el = $('toast'); if (!el) return;
  $('toast-msg').textContent = msg;
  el.className = 'toast ' + (kind || '');
  tWhy = opts.why && T().nedenKart[opts.why] ? opts.why : null;
  $('toast-why').hidden = !tWhy;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.remove('off'));
  clearTimeout(tTimer);
  tTimer = setTimeout(hideToast, opts.ms || (kind === 'err' ? 4200 : 2800));
}
function hideToast() {
  const el = $('toast'); if (!el || el.hidden) return; clearTimeout(tTimer);
  el.classList.add('off'); tWhy = null; $('toast-why').hidden = true;
  setTimeout(() => { if (el.classList.contains('off')) el.hidden = true; }, trDur() + 20);
}

// ---------------------------------------------------------------- mini şemalar
const MINI = {
  // Neden? kartları
  yuk: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 1, label: 'kesici' }, { t: 'ayirici', c: 0, mark: ['arc', 'x'], label: 'ayırıcı' }, { n: 'dead' }, { t: 'yuk' }],
  paralel: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 1 }, { t: 'ayirici', c: 0, mark: 'x', label: 'ayırıcı' }, { t: 'kesici', c: 1 }, { t: 'kaynak' }],
  trafo: [{ t: 'kaynak' }, { n: 'live' }, { t: 'ayirici', c: 0, mark: 'x', label: 'ayırıcı' }, { n: 'dead' }, { t: 'trafo' }, { t: 'yuk' }],
  kondans: [{ t: 'kaynak' }, { n: 'live' }, { t: 'ayirici', c: 0, mark: 'x', label: 'ayırıcı' }, { n: 'dead' }, { t: 'kondansator' }],
  asiri: [{ t: 'kaynak' }, { n: 'live' }, { t: 'ayirici', c: 1, mark: ['arc', 'x'] }, { t: 'yuk', fed: true }],
  ayrilmamis: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 0, label: '1 ayır' }, { n: 'dead' }, { t: 'ayirici', c: 0, mark: 'lock', label: '2 kilitle' }, { n: 'earth' }, { t: 'toprak', c: 1, down: true, mark: 'ok' }, { t: 'yuk' }],
  once_toprak: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 0 }, { n: 'dead' }, { t: 'ayirici', c: 0, mark: 'lock', label: 'sonra' }, { n: 'earth' }, { t: 'toprak', c: 1, down: true, mark: 'x' }, { t: 'yuk' }],
  toprak: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 1, mark: ['arc', 'x'] }, { t: 'toprak', c: 1, down: true }, { t: 'yuk' }],
  toprak_canli: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 1 }, { t: 'toprak', c: 0, down: true, mark: 'x' }, { t: 'yuk', fed: true }],
  koruma_yok: [{ t: 'kaynak' }, { n: 'live' }, { t: 'ayirici', c: 1 }, { t: 'ariza', down: true, mark: 'x' }, { t: 'yuk' }],
  kesemez: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 1 }, { t: 'yuk_ayirici', c: 0, mark: 'x' }, { t: 'ariza', down: true }, { t: 'yuk' }],
  senkron: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 0, mark: 'x', label: '25' }, { t: 'kaynak' }],
  tehlike: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 0 }, { n: 'dead' }, { t: 'ayirici', c: 0, mark: 'lock' }, { t: 'toprak', c: 0, down: true, mark: 'x' }, { t: 'yuk' }],
  kond: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 0 }, { n: 'dead' }, { t: 'kondansator', charge: 2 }],
  is_toprak: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 0 }, { n: 'dead' }, { t: 'ayirici', c: 0, mark: 'lock' }, { n: 'earth' }, { t: 'toprak', c: 1, down: true, mark: 'ok' }, { t: 'yuk' }],
  is_kilit: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 0, mark: 'x', label: 'açık kesici' }, { n: 'dead' }, { t: 'toprak', c: 1, down: true }, { t: 'yuk' }],
  // kural kartları
  r_kesici: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 1 }, { t: 'yuk', fed: true }],
  r_ayirici: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 0, label: '1' }, { n: 'dead' }, { t: 'ayirici', c: 0, label: '2' }, { t: 'yuk' }],
  r_yuk_ayirici: [{ t: 'kaynak' }, { n: 'live' }, { t: 'yuk_ayirici', c: 1 }, { t: 'yuk', fed: true }],
  r_loto: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 0 }, { n: 'dead' }, { t: 'ayirici', c: 0, mark: 'lock' }, { t: 'yuk' }],
  r_toprak: [{ t: 'kaynak' }, { n: 'live' }, { t: 'ayirici', c: 0, mark: 'lock' }, { n: 'earth' }, { t: 'toprak', c: 1, down: true }, { t: 'yuk' }],
  r_bara: [{ t: 'kaynak' }, { n: 'live' }, { t: 'ayirici', c: 0 }, { n: 'dead' }, { t: 'yuk' }],
  r_is: [{ t: 'kesici', c: 0 }, { n: 'dead' }, { t: 'ayirici', c: 0, mark: 'lock' }, { n: 'earth' }, { t: 'toprak', c: 1, down: true, mark: 'ok' }, { t: 'yuk' }],
  r_sigorta: [{ t: 'kaynak' }, { n: 'live' }, { t: 'sigorta', c: 1 }, { t: 'yuk', fed: true }],
  r_ariza: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 0, label: 'açtı' }, { n: 'dead' }, { t: 'ariza', down: true }, { t: 'yuk' }],
  r_trafo: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 1 }, { t: 'trafo' }, { t: 'yuk', fed: true }],
  r_hedef: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 1 }, { t: 'ayirici', c: 1, mark: 'ok' }, { t: 'yuk', fed: true }],
  r_kontaktor: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kontaktor', c: 1 }, { t: 'yuk', fed: true, motor: true }],
  r_kondansator: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 0 }, { n: 'dead' }, { t: 'kondansator', charge: 3 }],
  r_reaktif: [{ t: 'kaynak' }, { n: 'live' }, { t: 'kesici', c: 1 }, { t: 'kondansator' }],
};
// fiziksel engel kartları: aynı fizik, benzer şema
MINI.kapi_kilitli = MINI.r_toprak; MINI.kapi_icerde = MINI.r_toprak; MINI.r_kapi = MINI.r_toprak;
MINI.bolge_gerilimli = MINI.tehlike; MINI.bolge_topraksiz = MINI.is_toprak; MINI.bolge_kond = MINI.kond;
function miniOf(key, scale) {
  const items = MINI[key]; if (!items || !PX.sld || !PX.sld.mini) return null;
  try { return PX.sld.mini(items, { scale: scale || 1 }); } catch (e) { console.error('[PX.cards] mini', key, e); return null; }
}

// ---------------------------------------------------------------- Neden? kartı
// yalnız konum/geometri retleri (güvenlik notu ve titreşim yok)
const GEOM = { ulasilamaz: 1, erisilemez: 1, yol_yok: 1, yon_yok: 1, uzak: 1, zaten: 1, duvar: 1, gecersiz: 1, saglam: 1 };
function why(code) {
  const S = T(); const k = S.nedenKart[code]; if (!k) return;
  const body = h('div', null,
    h('p', null, h('b', { text: S.ERR[code] || '' })),
    (() => { const m = miniOf(code, 1.25); return m ? h('div', { class: 'mini illu' }, m) : null; })(),
    h('p', { text: k[1] }),
    GEOM[code] ? null : h('p', { class: 'note', style: 'font-size:12px;color:var(--dim)', text: S.guvenlikNotu }));
  open({ title: S.neden + ' — ' + k[0], body, foot: [{ label: S.kuralKitabi, act: book }, { label: S.tamam, cls: 'pri' }] });
}

// ---------------------------------------------------------------- kural kartları / Kural Kitabı / El Kitabı
function seenRules() { try { const a = PX.store && PX.store.get('ui.kural'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function markSeen(keys) {
  if (!PX.store || !keys || !keys.length) return; const a = seenRules(); let ch = false;
  for (const k of keys) if (a.indexOf(k) < 0) { a.push(k); ch = true; }
  if (ch) try { PX.store.set('ui.kural', a); } catch (e) { /* yoksay */ }
}
function levelRules(L, def) {
  const has = t => L.els.some(e => e.t === t); const hd = (def && def.hedef) || {};
  const r = [];
  if ((L.stairs && L.stairs.length) || (L.ladders && L.ladders.length)) r.push('merdiven');
  if (has('kesici')) r.push('kesici');
  if (has('ayirici')) r.push('ayirici');
  if (L.kilit > 0) r.push('loto');
  if (has('toprak') || L.nSet) r.push('toprak');
  if (has('bara')) r.push('bara');
  if (L.work >= 0 || (def && def.is)) r.push('is');
  if (has('yuk_ayirici')) r.push('yuk_ayirici');
  if (has('sigorta')) r.push('sigorta');
  if (has('ariza')) r.push('ariza');
  if (has('trafo')) r.push('trafo');
  if (hd.kapali || hd.acik || hd.gerilimli) r.push('hedef');
  if (L.doors && L.doors.length) r.push('kapi');
  if (has('kontaktor')) r.push('kontaktor');
  if (has('kondansator')) r.push('kondansator');
  if (hd.cosphi) r.push('reaktif');
  return r;
}
function ruleNode(key, seen) {
  const k = T().kural[key]; if (!k) return null;
  const m = miniOf('r_' + key, 1);
  return h('div', { class: 'rule' + (seen ? ' seen' : '') }, h('div', { class: 'mini', style: 'margin:0;display:grid;place-items:center;min-height:56px' }, m),
    h('div', null, h('b', { text: k[0] }), h('div', { class: 'rd', text: k[1] })));
}
function book() {
  const S = T(); const seen = seenRules();
  const body = h('div', null,
    h('p', { class: 'rd', style: 'color:var(--muted);font-size:12.5px', text: 'Her kural ilk karşılaşmada iş emri kartında gelir. Kurallar sim2 kural sürümü ' + (PX.SIM.RULES_VERSION || 3) + ' ile birebir aynıdır.' }),
    S.kuralSira.map(k => ruleNode(k, seen.indexOf(k) >= 0)),
    h('h3', { text: S.sozluk }),
    h('table', { class: 'tbl' }, h('tbody', null, S.sozlukListe.map(([a, b]) => h('tr', null, h('td', null, h('b', { text: a })), h('td', { text: b }))))));
  open({ title: S.kuralKitabi, body, foot: [{ label: S.elKitabi, act: manual }, { label: S.tamam, cls: 'pri' }] });
}
function legendRow(t, st, name, note) {
  let svgEl = null;
  try { svgEl = PX.sld.mini(st, { scale: 0.9 }); } catch (e) { /* yoksay */ }
  return h('tr', null, h('td', { style: 'width:86px' }, svgEl), h('td', null, h('b', { text: name }), note ? h('div', { class: 'rd', style: 'font-size:12px;color:var(--muted)', text: note }) : null));
}
function manual() {
  const S = T();
  const tags = h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
    [['live', S.canli, S.lejant.canli], ['dead', S.oluTopraksiz, S.lejant.oluTopraksiz], ['earth', S.toprakli, S.lejant.toprakli],
      ['lock', '🔒 ' + S.kilitli, S.lejant.kilitli]]
      .map(([c, a, b]) => h('div', null, h('span', { class: 'tag ' + c, text: a }), ' ', h('span', { style: 'font-size:12.5px;color:var(--muted)', text: b }))));
  const sym = h('table', { class: 'tbl' }, h('tbody', null,
    legendRow('kesici', [{ n: 'live' }, { t: 'kesici', c: 1 }, { t: 'kesici', c: 0 }], 'Kesici (-Q0x)', 'Kapalı / açık; sabit kontakta çarpı. Çekmeli tipte iki uçta ok başları.'),
    legendRow('ayirici', [{ n: 'live' }, { t: 'ayirici', c: 1 }, { t: 'ayirici', c: 0 }], 'Ayırıcı (-Q1x, -Q9x)', 'Sabit kontakta dik çizgi.'),
    legendRow('yuk_ayirici', [{ n: 'live' }, { t: 'yuk_ayirici', c: 1 }], 'Yük ayırıcısı (-QLx)', 'Çember + dik çizgi.'),
    legendRow('toprak', [{ n: 'dead' }, { t: 'kesici', c: 0 }, { n: 'earth' }, { t: 'toprak', c: 1, down: true }], 'Topraklama ayırıcısı (-Q8x)', 'Kapalıyken bölüm topraklanmış ve kısa devre edilmiştir.'),
    legendRow('sigorta', [{ n: 'live' }, { t: 'sigorta', c: 1 }, { t: 'sigorta', c: 0 }], 'NH sigorta (-F)', 'Eriyince içi kesik; "ERİDİ".'),
    legendRow('kontaktor', [{ n: 'live' }, { t: 'kontaktor', c: 1 }, { t: 'buton', c: 0 }], 'Kontaktör (-K) ve buton (-S)', 'NA/NK etiketli.'),
    legendRow('trafo', [{ n: 'live' }, { t: 'trafo' }], 'Trafo (-T)', 'İki sargı; iki yönlü enerjilenir.'),
    legendRow('kond', [{ n: 'dead' }, { t: 'kondansator', charge: 2 }], 'Kondansatör bataryası (-C)', 'Halka: kalan şarj (karar).'),
    legendRow('ariza', [{ n: 'live' }, { t: 'ariza', down: true }], 'Arıza (kablo eki)', 'Toprağa şönt.'),
    legendRow('yuk', [{ t: 'kaynak' }, { n: 'live' }, { t: 'yuk', fed: true }], 'Kaynak ve yük', 'Beslenen yük dolu çizilir.')));
  const body = h('div', null,
    h('h3', { text: S.guvenlikBaslik }), h('div', { class: 'goal', text: S.guvenlikNotu }),
    h('h3', { text: S.modelNotlari }), h('ul', null, S.modelNotlariListe.map(x => h('li', { text: x }))),
    h('h3', { text: 'Tek Hat lejantı (IEC 60617 tarzı)' }), tags, sym);
  open({ title: S.elKitabi, body, foot: [{ label: S.kuralKitabi, act: book }, { label: S.tamam, cls: 'pri' }] });
}

// ---------------------------------------------------------------- cihaz bilgi kartı
function device(e, L, s, E) {
  const S = T(); if (!e || !L) return;
  if (!s && PX.game) { const st = PX.game.state(); s = st.presentation.s || st.s; }
  if (!E && s) E = PX.SIM.stateE(L, s);
  const rows = [];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== '') rows.push(h('div', { class: 'k', text: k }), h('div', { text: String(v) })); };
  add('Tür', (S.tip && S.tip[e.t]) || e.t + (e.cekmeli ? ' (çekmeli)' : ''));
  if (e.cekmeli) add('Çekmeli', 'evet — dışarı çekilince görünür ayırma noktası');
  const kvOf = n => { const v = L.kv[L.nodeIdx[n]]; return v === undefined ? '' : String(v).replace('.', ',') + ' kV'; };
  if (e.a && e.b) add('Bağlantı', `${e.a} ↔ ${e.b} (${kvOf(e.a)})`); else if (e.dugum) add('Düğüm', `${e.dugum} (${kvOf(e.dugum)})`);
  if (s) {
    if (e.bit !== undefined) add('Konum', ((s.b >> e.bit) & 1) ? (e.t === 'sigorta' ? 'sağlam' : 'KAPALI') : (e.t === 'sigorta' ? S.eridi : 'AÇIK'));
    if (e.lk >= 0) add('LOTO', ((s.lk >> e.lk) & 1) ? S.kilitli + ' (etiket: ÇALIŞMA VAR — KAPATMAYIN — VOLTİ)' : 'kilitli değil');
    if (e.t === 'kondansator') add('Şarj', (Math.floor(s.ch / Math.pow(4, e.ci)) % 4) + ' / 3 karar');
    if (e.t === 'yuk' && E) add('Durum', ((E.loadMask >> e.li) & 1) ? 'besleniyor' : 'beslenmiyor');
    if (e.dugum && E) { const n = L.nodeIdx[e.dugum]; const st = PX.sld.nodeState(E, n); add('Düğüm durumu', st === 'live' ? S.canli : st === 'earth' ? S.toprakli : S.oluTopraksiz); }
    if (e.ei !== undefined && E && E.cur) { const I = E.cur[e.ei]; add('Akım', I > 1e-6 ? PX.tnum(I, 1) + ' birim' : '0'); }
  }
  if (e.I) add(S.esik, e.I + ' birim (anma değil, açma eşiği)');
  if (e.kademe !== undefined && (e.t === 'kesici' || e.t === 'sigorta')) add(S.kademe, e.kademe + ' (düşük kademe önce açar)');
  if (e.t === 'yuk') { const ld = L.loads[e.li]; add(S.talep, ld.d + ' birim'); add(S.oncelik, 'w = ' + ld.w + (ld.req ? ' (' + S.zorunlu + ')' : ' (' + S.istege + ')')); if (ld.p || ld.q) add('P / Q', ld.p + ' / ' + ld.q); }
  if (e.t === 'kondansator') add('Q', e.q + ' birim');
  if (e.t === 'bara') add('Yaklaşma bölgesi', (e.r || 1) + ' hücre');
  // hücre kapısı: kilitleme koşulu ve şu anki durumu
  if (e.t === 'kapi' && s && e.di !== undefined && L.doors[e.di]) {
    const d = L.doors[e.di]; const nm = x => x >= 0 && L.els[x] ? PX.SIM.labelOf(L, x) : '';
    const need = []; if (d.earth >= 0) need.push(nm(d.earth) + ' kapalı'); if (d.lock >= 0) need.push(nm(d.lock) + ' kilitli');
    add(S.kapiKosul, need.join(' ve ') || '—');
    add('Durum', PX.SIM.doorOpen(L, s.b, s.lk, e.di) ? S.kapiAcik : S.kapiKapali);
  }
  // durum rozetleri (renk tek ipucu değil: metin)
  let ds = null; try { ds = s && e.i !== undefined && e.t !== 'kapi' ? PX.SIM.deviceState(L, s, e.i) : null; } catch (x) { ds = null; }
  const badges = ds ? stateBadges(ds, e) : null;
  const rk = { kesici: 'kesici', ayirici: 'ayirici', yuk_ayirici: 'yuk_ayirici', toprak: 'toprak', sigorta: 'sigorta', trafo: 'trafo', kondansator: 'kondansator', kontaktor: 'kontaktor', bara: 'bara', ariza: 'ariza', kapi: 'kapi' }[e.t];
  // "Volti'yi gönder": yalnız Volti'nin orada yapacağı bir iş varsa (işletilebilir cihaz / kapı). Erişilemezse aynı
  // komut neden kartını açar (asla sessiz kalmaz). Yük, kaynak, trafo… için düğme yok: kartta nedeni yazılır.
  const OPS = { kesici: 1, ayirici: 1, yuk_ayirici: 1, toprak: 1, sigorta: 1, buton: 1 };
  const operable = e.cell >= 0 && L.approach && L.approach[e.i] && L.approach[e.i].length && (OPS[e.t] || e.lk >= 0 || (e.t === 'bara' && L.nSet > 0))
    && !(e.t === 'sigorta' && e.lk < 0 && s && ((s.b >> e.bit) & 1));   // sağlam sigorta: yapılacak iş yok
  const goes = e.t === 'kapi' || operable;
  const body = h('div', null, badges, h('div', { class: 'kv' }, rows), !goes && e.cell >= 0 ? h('p', { class: 'note', style: 'font-size:12px;color:var(--muted)', text: S.yerindeYok }) : null, rk ? ruleNode(rk, true) : null);
  const foot = [{ label: S.tamam, cls: 'pri' }];
  if (goes && PX.game && PX.screens && PX.screens.current === 'game') foot.unshift({ label: S.voltiGonder, testid: 'btn-send', act: () => PX.game.command({ t: 'tap', cell: e.cell, src: 'card' }) });
  open({ title: PX.SIM.labelOf ? PX.SIM.labelOf(L, e.i) : e.id + (e.ad ? ' — ' + e.ad : ''), body, foot });
}
// durum rozetleri: CANLI / ÖLÜ — TOPRAKSIZ / TOPRAKLI / KİLİTLİ / KAPALI / AÇIK / ERİDİ / YÜKLÜ (metinli)
function stateBadges(ds, e) {
  const S = T(); const out = [];
  if (ds.closed !== undefined && e.t !== 'sigorta') out.push(h('span', { class: 'tag', text: ds.closed ? S.kapaliK : S.acikK }));
  if (ds.blown) out.push(h('span', { class: 'tag warn', text: S.eridi }));
  if (ds.live) out.push(h('span', { class: 'tag live', text: S.canli }));
  else if (ds.earthed) out.push(h('span', { class: 'tag earth', text: S.toprakli }));
  else out.push(h('span', { class: 'tag dead', text: S.oluTopraksiz }));
  if (ds.locked) out.push(h('span', { class: 'tag lock', text: '🔒 ' + S.kilitli }));
  if (ds.charge) out.push(h('span', { class: 'tag warn', text: S.yuklu + ' ' + ds.charge + '/3' }));
  return h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px' }, out);
}

// ---------------------------------------------------------------- NEDEN KARTI (erişilemeyen hedef; kural sürümü 4)
// Yük: cmd:rejected {err, msg, cells, blockers:[{err, el, msg, id}], fix:[el], hedef, reason:true}
const RS = { el: null, timer: 0, fix: -1, cells: null };
function reason(p) {
  const S = T(); const L = PX.game && PX.game.L; const box = $('reason'); if (!box || !L || !p) return;
  hideReason(true);
  const k = S.nedenKart[p.err];
  const tgt = p.hedef && p.hedef !== 'bu karo' ? p.hedef : null;
  const title = (k ? k[0] : S.erisimYok) + (tgt ? ' · ' + tgt : '');
  box.textContent = '';
  const head = h('div', { class: 'rs-h' }, h('span', { class: 'rs-i', 'aria-hidden': 'true', text: '!' }), h('b', { class: 'rs-t', text: title }),
    h('button', { class: 'rs-x', type: 'button', 'aria-label': S.kapat, onclick: () => hideReason(), html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' }));
  box.appendChild(head);
  box.appendChild(h('div', { class: 'rs-m', text: p.msg || S.ERR[p.err] || p.err }));
  const extra = (p.blockers || []).slice(1).map(b => b.msg).filter((m, i, a) => m && m !== p.msg && a.indexOf(m) === i);
  if (extra.length) box.appendChild(h('ul', { class: 'rs-l' }, extra.slice(0, 3).map(m => h('li', { text: m }))));
  const row = h('div', { class: 'rs-b' });
  const fixE = Array.isArray(p.fix) && p.fix.length ? p.fix[0] : -1; RS.fix = fixE;
  if (fixE >= 0 && L.els[fixE] && L.els[fixE].cell >= 0) {
    const fe = L.els[fixE];
    row.appendChild(h('button', { class: 'sm pri', type: 'button', 'data-testid': 'reason-go', text: PX.t('oraGit', { id: fe.id }),
      onclick: () => { hideReason(); PX.game.command({ t: 'tap', cell: fe.cell, src: 'reason' }); } }));
  }
  const showE = fixE < 0 && Array.isArray(p.show) && p.show.length ? p.show[0] : -1;
  if (showE >= 0 && L.els[showE] && PX.sld) {
    const se = L.els[showE];
    row.appendChild(h('button', { class: 'sm', type: 'button', 'data-testid': 'reason-sld', text: S.tekHatGoster,
      onclick: () => { hideReason(); try { PX.sld.open(true); PX.sld.highlight(se.id); } catch (x) { /* yoksay */ } } }));
  }
  if (k) row.appendChild(h('button', { class: 'sm', type: 'button', text: S.neden, onclick: () => { const c = p.err; hideReason(); why(c); } }));
  if (row.childNodes.length) box.appendChild(row);
  box.hidden = false; requestAnimationFrame(() => box.classList.remove('off'));
  // vurgu: engel hücreleri halkalanır (render onReject p.cells); çözüm cihazı ayrıca yeşil kare
  RS.cells = p.cells || null;
  if (fixE >= 0 && PX.diorama && PX.diorama.highlight && L.els[fixE] && L.els[fixE].cell >= 0) { try { PX.diorama.highlight(L.els[fixE].cell, 'erisim'); } catch (x) { /* yoksay */ } }
  if (PX.sld && PX.sld.highlight && fixE >= 0) { try { PX.sld.highlight(L.els[fixE].id); } catch (x) { /* yoksay */ } }
  clearTimeout(RS.timer); RS.timer = setTimeout(() => hideReason(), 9000);
}
function hideReason(quick) {
  const box = $('reason'); clearTimeout(RS.timer); if (!box || box.hidden) return;
  if (RS.fix >= 0 && PX.diorama && PX.diorama.highlight) { try { PX.diorama.highlight(-1, 'erisim'); } catch (x) { /* yoksay */ } }
  RS.fix = -1; RS.cells = null;
  if (quick) { box.hidden = true; box.classList.add('off'); return; }
  box.classList.add('off'); setTimeout(() => { if (box.classList.contains('off')) box.hidden = true; }, trDur() + 20);
}


function vibrate(ms) {
  try { if (PX.store && PX.store.get('ayar.titresim') === false) return; if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* yoksay */ }
}
function init() {
  const S = T();
  if (S && !S.tip) S.tip = { kaynak: 'Kaynak', yuk: 'Yük', kesici: 'Kesici', ayirici: 'Ayırıcı', yuk_ayirici: 'Yük ayırıcısı (RMU)', toprak: 'Topraklama ayırıcısı',
    sigorta: 'NH sigorta', kontaktor: 'Kontaktör (AC-3)', yardimci: 'Yardımcı kontak', buton: 'Buton', kondansator: 'Kondansatör bataryası', bara: 'Açık bara',
    kapi: 'Hücre kapısı (kilitlemeli)', ariza: 'Arıza (kablo eki)', trafo: 'Trafo', kablo: 'Kablo' };
  $('toast-why').addEventListener('click', () => { const c = tWhy; hideToast(); if (c) why(c); });
  PX.bus.on('cmd:rejected', p => {
    if (!p || p.err === 'bos' || p.err === 'tampon' || !p.msg && p.err === 'kazanildi') return;
    // erişilemeyen hedef: engeli adıyla gösteren neden kartı (toast değil); Volti asla sessizce takılmaz
    if (p.reason || (p.blockers && p.blockers.length)) { hideToast(); reason(p); if (!GEOM[p.err]) vibrate(18); return; }
    const msg = p.msg || (S.ERR[p.err] || p.err);
    toast(msg, 'err', { why: p.err });
    if (!GEOM[p.err]) vibrate(18);
  });
  PX.bus.on('cmd:accepted', p => { const el = $('toast'); if (el && el.classList.contains('err')) hideToast(); if (!(p && p.cmd && p.cmd.t === 'rot')) hideReason(); });
  for (const ev of ['undo', 'redo', 'reset', 'level:loaded', 'win']) PX.bus.on(ev, () => hideReason(true));
  PX.bus.on('toast', p => p && toast(p.msg, p.kind));
  PX.bus.on('hint', p => { if (!p || !p.why) return; if (PX.hud && PX.hud.hintOpen && PX.hud.hintOpen()) return; toast(p.why, 'hint', { ms: 5200 }); });
  PX.bus.on('ui:longpress', p => {
    const L = PX.game && PX.game.L; if (!L || !p) return;
    let e = null; if (typeof p.el === 'string') e = L.els[L.elIndex[p.el]]; else if (typeof p.el === 'number' && p.el >= 0) e = L.els[p.el];
    if (!e && p.cell >= 0) e = L.els.find(x => x.cell === p.cell) || null;
    if (e) device(e, L);
  });
  PX.bus.on('level:loaded', () => { hideToast(); for (let i = stack.length - 1; i >= 0; i--) if (stack[i].o.levelScoped) stack[i].close(); });
  // Escape: en üstteki sayfayı kapat; sayfa açıkken oyun tuşları sahneye gitmez
  window.addEventListener('keydown', ev => {
    if (!stack.length) return;
    if (ev.key === 'Tab') {
      const sheet = stack[stack.length - 1].el;
      const list = [...sheet.querySelectorAll('button, input, textarea, select, a[href], [tabindex]')].filter(e => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length);
      const first = list[0], last = list[list.length - 1];
      const target = !sheet.contains(document.activeElement) ? (ev.shiftKey ? last : first) : ev.shiftKey && document.activeElement === first ? last : !ev.shiftKey && document.activeElement === last ? first : null;
      if (target) { ev.preventDefault(); target.focus({ preventScroll: true }); }
      ev.stopPropagation(); return;
    }
    if (ev.key === 'Escape') { ev.preventDefault(); stack[stack.length - 1].close(); }
    if (!(ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) && ev.key !== 'Tab' && ev.key !== 'Enter' && ev.key !== ' ') ev.stopPropagation();
    else if (ev.key === ' ' || ev.key === 'Enter') ev.stopPropagation();
  }, true);
}
PX.cards = { init, toast, hideToast, open, closeAll, top: () => stack.length, why, book, manual, device, ruleNode, levelRules, seenRules, markSeen, h, miniOf, reason, hideReason, stateBadges };
