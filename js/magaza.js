/*!
 * VoltGuard – magaza.js  (VoltGuard Mağaza tarayıcı davranışı; window.VGMagaza)
 * Çerçeve yok. Sayfaya göre bölümler kendiliğinden etkinleşir:
 *   tüm mağaza sayfaları  sepet rozeti [data-vgm-cart-count], "Sepete ekle" [data-vgm-add], "Teklif isteyin" [data-vgm-quote]
 *   kategori               marka / teknik / sıralama süzgeci [data-vgm-filter]: "Uygula" kanonik adrese gider (sunucu süzer ve sayfalar;
 *                          JS yoksa düz GET formu). Eski istemci tarafı süzgeç [data-vgm-tools] yalnızca o işaret varsa çalışır.
 *   ürün                   görsel galerisi
 *   /magaza/sepet.html     [data-vgm-cart-page]       POST /api/magaza.php?action=sepet
 *   /magaza/odeme.html     [data-vgm-checkout-page]   sepet, onbilgi, siparis
 *   /magaza/siparis-takip.html [data-vgm-track-page]  durum
 * Fiyat HESAPLANMAZ: gösterilen her tutar sunucunun döndürdüğü sayıdır (yalnızca biçimlendirilir). Sepet yalnızca
 * [{id, qty}] olarak localStorage'da tutulur; sipariş başarıyla alınınca temizlenir. Tüm sunucu metinleri
 * textContent ile yazılır (HTML enjekte edilmez).
 */
(function () {
  'use strict';

  var VERSION = '1';
  var CART_KEY = 'vg_magaza_sepet_v1';      // [{id, qty}]
  var INFO_KEY = 'vg_magaza_urunler_v1';    // {id: {n: ad, s: slug, m: en fazla adet}} (yalnızca hata durumunda sepet düzenleme yedeği)
  var DONE_KEY = 'vg_magaza_son_siparis_v1';// son siparişin ödeme bilgileri (yalnızca oturum; kişisel veri yok)
  var API = '/api/magaza.php';
  var ID_RE = /^vgm-[0-9]{4,6}$/;
  var MAX_LINES = 40;
  var MAX_QTY = 999;     // api/lib/magaza.php VGM_MAX_QTY ve katalog şeması (maxQty 1–999) ile aynı
  var MAX_PACK = 9999;  // VGM_MAX_PACK (packQty 1–9999)
  var CONTACT = '/iletisim.html#iletisim';
  var memory = {};                          // depolama kullanılamıyorsa bu sayfa oturumu için yedek

  /* ------------------------------------------------------------------ yardımcılar */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function matches(node, sel) { var f = node.matches || node.msMatchesSelector || node.webkitMatchesSelector; return f ? f.call(node, sel) : false; }
  function closest(node, sel) {
    while (node && node.nodeType === 1) { if (matches(node, sel)) return node; node = node.parentNode; }
    return null;
  }
  function trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else n.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function focusEl(node) {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (e) { try { node.focus(); } catch (e2) { /* odak verilemedi */ } }
    try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e3) { /* eski tarayıcı */ }
  }
  function toQty(v, max) {
    var n = typeof v === 'number' ? v : parseInt(String(v == null ? '' : v), 10);
    if (!isFinite(n) || n < 1) return 0;
    return Math.min(Math.floor(n), max || MAX_QTY);
  }
  function randomId(prefix) {
    var bytes = new Uint8Array(16), out = prefix, i;
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (i = 0; i < 16; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
    return out;
  }

  /* Biçim (yalnızca gösterim): sunucunun verdiği sayı "1.234,56 ₺" olarak yazılır; Türkiye UTC+3 sabittir. */
  function fmtTry(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    var s = (Math.round(Math.abs(n) * 100) / 100).toFixed(2).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '-' : '') + s[0] + ',' + s[1] + ' ₺';
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function trParts(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    var d = new Date(t + 3 * 3600 * 1000);
    return { d: pad2(d.getUTCDate()), m: pad2(d.getUTCMonth() + 1), y: d.getUTCFullYear(), h: pad2(d.getUTCHours()), i: pad2(d.getUTCMinutes()) };
  }
  function fmtDateTime(iso) { var p = trParts(iso); return p ? p.d + '.' + p.m + '.' + p.y + ' ' + p.h + ':' + p.i : ''; }
  function fmtTime(iso) { var p = trParts(iso); return p ? p.h + ':' + p.i : ''; }
  function fmtDay(ymd) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '')); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; }

  /* ------------------------------------------------------------------ depolama (hatalara karşı korumalı) */
  function kvGet(key, session) {
    try { var v = (session ? window.sessionStorage : window.localStorage).getItem(key); if (v !== null) return v; } catch (e) { /* kullanılamıyor */ }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }
  function kvSet(key, value, session) {
    memory[key] = value;
    try { (session ? window.sessionStorage : window.localStorage).setItem(key, value); } catch (e) { /* bellekte kalır */ }
  }
  function kvDel(key, session) {
    delete memory[key];
    try { (session ? window.sessionStorage : window.localStorage).removeItem(key); } catch (e) { /* yok sayılır */ }
  }
  function parseJson(raw, fallback) {
    if (typeof raw !== 'string' || raw === '') return fallback;
    try { var v = JSON.parse(raw); return v == null ? fallback : v; } catch (e) { return fallback; }
  }

  /* ------------------------------------------------------------------ sepet */
  function normalizeCart(data) {
    var out = [], seen = {};
    if (!Array.isArray(data)) return out;
    data.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var id = typeof row.id === 'string' ? row.id : '';
      var qty = toQty(row.qty, MAX_QTY);
      if (!ID_RE.test(id) || qty < 1) return;
      if (Object.prototype.hasOwnProperty.call(seen, id)) { out[seen[id]].qty = Math.min(MAX_QTY, out[seen[id]].qty + qty); return; }
      if (out.length >= MAX_LINES) return;
      seen[id] = out.length;
      out.push({ id: id, qty: qty });
    });
    return out;
  }
  function readCart() { return normalizeCart(parseJson(kvGet(CART_KEY), [])); }
  var cartListeners = [];
  function writeCart(items) {
    kvSet(CART_KEY, JSON.stringify(normalizeCart(items)));
    updateBadges();
    cartListeners.forEach(function (fn) { try { fn(); } catch (e) { /* dinleyici hatası sepeti bozmaz */ } });
  }
  function cartCount() { return readCart().reduce(function (s, r) { return s + r.qty; }, 0); }
  function updateBadges() {
    var n = cartCount();
    $$('[data-vgm-cart-count]').forEach(function (b) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = n === 0; });
    $$('[data-vgm-cart-link]').forEach(function (a) { a.setAttribute('aria-label', n ? 'Sepet, ' + n + ' ürün' : 'Sepet'); });
  }
  function readInfo() { var v = parseJson(kvGet(INFO_KEY), {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function rememberInfo(id, name, slug, max) {
    var info = readInfo();
    info[id] = { n: String(name || '').slice(0, 200), s: /^[a-z0-9-]{3,90}$/.test(slug || '') ? slug : '', m: toQty(max, MAX_QTY) || MAX_QTY };
    var keys = Object.keys(info);
    if (keys.length > 80) delete info[keys[0]];
    kvSet(INFO_KEY, JSON.stringify(info));
  }
  function addToCart(id, qty, max) {
    var items = readCart(), hit = null, capped = false;
    items.forEach(function (r) { if (r.id === id) hit = r; });
    var limit = max || MAX_QTY;
    if (hit) {
      var sum = hit.qty + qty;
      if (sum > limit) { sum = limit; capped = true; }
      hit.qty = sum;
    } else {
      if (items.length >= MAX_LINES) return { ok: false, message: 'Sepette en fazla ' + MAX_LINES + ' farklı ürün olabilir.' };
      if (qty > limit) { qty = limit; capped = true; }
      items.push({ id: id, qty: qty });
    }
    writeCart(items);
    return { ok: true, capped: capped, qty: (hit ? hit.qty : qty) };
  }
  function removeFromCart(ids) {
    var drop = {};
    ids.forEach(function (i) { drop[i] = true; });
    writeCart(readCart().filter(function (r) { return !drop[r.id]; }));
  }

  /* ------------------------------------------------------------------ sunucu isteği */
  function apiError(kind, message, extra) {
    var e = new Error(message);
    e.kind = kind;
    e.status = (extra && extra.status) || 0;
    e.code = (extra && extra.code) || '';
    e.fields = (extra && extra.fields) || null;
    return e;
  }
  function request(action, body, opts) {
    var init = { method: body ? 'POST' : 'GET', headers: { 'Accept': 'application/json' }, credentials: 'same-origin', cache: 'no-store' };
    if (body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    var timeout = (opts && opts.timeout) || 25000, ctl = null, timer = null, timedOut = false;
    if (typeof window.AbortController === 'function') {
      ctl = new window.AbortController();
      init.signal = ctl.signal;
      timer = window.setTimeout(function () { timedOut = true; ctl.abort(); }, timeout);
    }
    if (typeof window.fetch !== 'function') return Promise.reject(apiError('unsupported', 'Tarayıcınız bu işlemi desteklemiyor. Lütfen güncel bir tarayıcı kullanın veya bizi arayın.'));
    return window.fetch(API + '?action=' + encodeURIComponent(action), init).then(function (res) {
      return res.text().then(function (text) { return { res: res, data: parseJson(text, null) }; });
    }, function () {
      throw timedOut
        ? apiError('timeout', 'Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.')
        : apiError('network', 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.');
    }).then(function (r) {
      if (timer) window.clearTimeout(timer);
      if (r.data && typeof r.data === 'object' && r.data.ok === true) return r.data;
      if (r.data && typeof r.data === 'object' && r.data.ok === false) {
        throw apiError('api', String(r.data.message || 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'),
          { status: r.res.status, code: String(r.data.error || ''), fields: r.data.fields && typeof r.data.fields === 'object' ? r.data.fields : null });
      }
      throw apiError('bad', 'Mağaza hizmetine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin veya bizi arayın.', { status: r.res.status });
    }, function (err) { if (timer) window.clearTimeout(timer); throw err; });
  }

  /* ------------------------------------------------------------------ tüm sayfalar: sepete ekle, teklif, galeri */
  function initGlobal() {
    document.addEventListener('click', function (ev) {
      var add = closest(ev.target, '[data-vgm-add]');
      if (add) { onAdd(add); return; }
      var quote = closest(ev.target, '[data-vgm-quote]');
      if (quote) { onQuote(quote); return; }
      var thumb = closest(ev.target, '[data-vgm-thumb]');
      if (thumb) { ev.preventDefault(); onThumb(thumb); }
    });
    window.addEventListener('storage', function (ev) { if (ev.key === CART_KEY || ev.key === null) { updateBadges(); cartListeners.forEach(function (fn) { fn(); }); } });
    window.addEventListener('pageshow', function (ev) { if (ev.persisted) updateBadges(); });
    updateBadges();
    initChrome();
  }

  /* ------------------------------------------------------------------ mobil chrome: arama düğmesi, band, lead, yapışkan fiyat (P1-07) */
  var BANNER_KEY = 'vg_magaza_band_kapali_v1';
  function initChrome() {
    $$('[data-vgm-bar]').forEach(function (bar) {
      var toggle = $('[data-vgm-search-toggle]', bar), input = $('input[type="search"]', bar);
      if (!toggle || !input) return;
      bar.setAttribute('data-vgm-js', '');
      if (input.value) bar.setAttribute('data-search-open', '');
      toggle.addEventListener('click', function () {
        var open = !bar.hasAttribute('data-search-open');
        if (open) bar.setAttribute('data-search-open', ''); else bar.removeAttribute('data-search-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }
      });
    });
    $$('[data-vgm-banner]').forEach(function (band) {
      var close = $('[data-vgm-banner-close]', band);
      if (kvGet(BANNER_KEY) === '1') { band.hidden = true; return; }
      if (close) close.addEventListener('click', function () { band.hidden = true; kvSet(BANNER_KEY, '1'); });
    });
    $$('[data-vgm-clamp]').forEach(function (lead) {
      if (lead.scrollHeight <= lead.clientHeight + 2) return;
      var more = el('button', { type: 'button', class: 'vgm-link vgm-lead__more', 'aria-expanded': 'false' }, ['devamı']);
      more.addEventListener('click', function () {
        var open = !lead.hasAttribute('data-open');
        if (open) lead.setAttribute('data-open', ''); else lead.removeAttribute('data-open');
        more.textContent = open ? 'daha az' : 'devamı';
        more.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      lead.parentNode.insertBefore(more, lead.nextSibling);
    });
    var sticky = $('[data-vgm-sticky]'), buy = $('#satin-al');
    if (sticky && buy && typeof window.IntersectionObserver === 'function') {
      /* Şerit, kutunun tamamı değil eylem satırı (adet + Sepete ekle/Teklif) görünene kadar gösterilir (P1-07): telefonda
         kutunun üst kısmı görünürken düğme ekran altında kalabiliyor. Sayfa sonundaki yardım kutusu ya da site alt bilgisi
         görününce şerit gizlenir: alt bilginin son satırlarını örtmez ve sayfaya yer tutucu boşluk eklemek gerekmez. */
      var row = $('.vgm-buy__row', buy) || buy, rowSeen = true, endSeen = false;
      var ends = [$('.vgm-help'), $('footer')].filter(Boolean);
      var sync = function () { sticky.hidden = rowSeen || endSeen || window.innerWidth >= 992; };
      var io = new window.IntersectionObserver(function (entries) {
        entries.forEach(function (e) { rowSeen = e.isIntersecting; });
        sync();
      }, { threshold: 0.9 });
      io.observe(row);
      if (ends.length) {
        var seen = [];
        var endIo = new window.IntersectionObserver(function (entries) {
          entries.forEach(function (e) { seen[ends.indexOf(e.target)] = e.isIntersecting; });
          endSeen = seen.some(Boolean);
          sync();
        });
        ends.forEach(function (n) { endIo.observe(n); });
      }
      sticky.addEventListener('click', function (ev) {
        if (!closest(ev.target, '[data-vgm-sticky-go]')) return;
        ev.preventDefault();
        focusEl($('[data-vgm-add], [data-vgm-quote], [data-vgm-qty]', buy) || buy);
      });
    }
  }

  /* Satış birimi (katalog "unit"): adet etiketi ve fiyat eki; js tarafında yalnızca gösterim (P1-09). */
  var UNITS = { adet: ['adet', ''], metre: ['m', '/ m'], paket: ['paket', '/ paket'], 'takım': ['takım', '/ takım'], kutu: ['kutu', '/ kutu'], rulo: ['rulo', '/ rulo'], kg: ['kg', '/ kg'], set: ['set', '/ set'] };
  function unitOf(key) { return UNITS[key] || UNITS.adet; }
  function boxOf(node) { return closest(node, '.vgm-buy, .vgm-card__add, .vgm-line') || document; }
  /* Adet: en az (min) ve adım (step) kurallarına yuvarlanır; en çok (max) ile sınırlanır. */
  function snapQty(n, min, step, max) {
    var lo = Math.max(1, min || 1), st = Math.max(1, step || 1), hi = max || MAX_QTY;
    var q = toQty(n, hi) || lo;
    if (q < lo) q = lo;
    if (st > 1) q = Math.ceil(q / st) * st;
    if (q > hi) q = Math.floor(hi / st) * st || lo;
    return Math.max(1, q);
  }
  function qtyOf(box, max, min, step) {
    var input = $('[data-vgm-qty]', box);
    var raw = input ? input.value : 1;
    var q = snapQty(raw, min || (input && parseInt(input.getAttribute('min'), 10)) || 1, step || (input && parseInt(input.getAttribute('step'), 10)) || 1, max || MAX_QTY);
    if (input) input.value = String(q);
    return q;
  }

  function onAdd(btn) {
    var id = btn.getAttribute('data-vgm-add') || '';
    if (!ID_RE.test(id)) return;
    var max = toQty(btn.getAttribute('data-max'), MAX_QTY) || MAX_QTY;
    var min = toQty(btn.getAttribute('data-min'), max) || 1, step = toQty(btn.getAttribute('data-step'), max) || 1;
    var unit = unitOf(btn.getAttribute('data-unit') || 'adet')[0];
    var box = boxOf(btn), live = $('[data-vgm-live]', box);
    var qty = qtyOf(box, max, min, step);
    var h1 = $('h1');
    var name = trim(btn.getAttribute('data-name')) || (h1 ? h1.textContent : id);
    var slug = trim(btn.getAttribute('data-slug')) || (location.pathname.match(/^\/magaza\/urun\/([a-z0-9-]+)\/?$/) || [])[1] || '';
    rememberInfo(id, name, slug, max);
    var r = addToCart(id, qty, max);
    if (!live) return;
    clear(live);
    if (!r.ok) { live.textContent = r.message; return; }
    if (r.capped) {
      live.appendChild(document.createTextNode('Sepette en fazla ' + max + ' ' + unit + ' olabilir; sepetinizde şu an ' + r.qty + ' ' + unit + ' var. '));
      live.appendChild(el('a', { class: 'vgm-link', href: CONTACT, 'data-vgm-quote': '', 'data-id': id, 'data-name': name, 'data-model': trim(btn.getAttribute('data-model')), 'data-qty': String(qty), 'data-intent': 'proforma' }, ['Bu adet için proforma isteyin']));
      live.appendChild(document.createTextNode(' · '));
    } else {
      live.appendChild(document.createTextNode(qty + ' ' + unit + ' sepete eklendi. '));
    }
    live.appendChild(el('a', { class: 'vgm-link', href: '/magaza/sepet.html' }, ['Sepete git']));
  }

  /* Teklif isteği taslağı: iletişim formuna (subject "magaza") yapılandırılmış ürün listesiyle taşınır (P1-12). */
  var INTENTS = { teklif: 'güncel fiyat ve stok teklifi', proforma: 'proforma fatura', nakliye: 'nakliye dahil teklif', alternatif: 'alternatif ürün önerisi', haber: 'siparişe açılınca bilgilendirme' };
  function quoteDraft(items, intent, extra) {
    var what = INTENTS[intent] || INTENTS.teklif;
    var lines = ['[Mağaza] Aşağıdaki ürün(ler) için ' + what + ' rica ediyorum.', ''];
    items.forEach(function (it, i) {
      lines.push((i + 1) + ') ' + it.name + (it.mpn ? ' — model: ' + it.mpn : '') + ' — adet: ' + it.qty + (it.unit && it.unit !== 'adet' ? ' ' + unitOf(it.unit)[0] : '')
        + (it.url ? ' — ' + location.origin + it.url : ''));
    });
    if (extra) lines.push('', extra);
    lines.push('', 'Firma / VKN:', 'Teslimat ili:', 'İstenen termin:');
    var text = lines.join('\n').slice(0, 1000);
    try {
      window.sessionStorage.setItem('vgContactDraft', JSON.stringify({ subject: 'magaza', text: text, complete: false,
        magaza: { intent: intent, items: items.map(function (it) { return { id: it.id, mpn: it.mpn, qty: it.qty, url: it.url }; }) } }));
    } catch (e) { /* bağlantı yine de iletişim formuna gider */ }
    return text;
  }
  function onQuote(link) {
    var id = trim(link.getAttribute('data-id')), name = trim(link.getAttribute('data-name')).slice(0, 160), model = trim(link.getAttribute('data-model')).slice(0, 80);
    var url = trim(link.getAttribute('data-url')) || (id ? '' : location.pathname);
    if (!/^\/magaza\/urun\/[a-z0-9-]+\/$/.test(url)) url = '';
    var qty = toQty(link.getAttribute('data-qty'), MAX_QTY) || qtyOf(boxOf(link), MAX_QTY);
    var box = boxOf(link), add = $('[data-vgm-add], [data-vgm-qty]', box);
    var unit = add && add.getAttribute('data-unit') ? add.getAttribute('data-unit') : (link.getAttribute('data-unit') || 'adet');
    quoteDraft([{ id: ID_RE.test(id) ? id : '', name: name || id, mpn: model, qty: qty, unit: unit, url: url }], link.getAttribute('data-intent') || 'teklif');
  }
  /* Sepet -> teklif / proforma: tüm satırlar (ad, model, adet, adres) iletişim formuna taşınır. */
  function onCartQuote(btn, lines) {
    var info = readInfo();
    var items = readCart().map(function (r) {
      var l = (lines || []).filter(function (x) { return x.id === r.id; })[0] || {};
      var slug = l.slug || (info[r.id] && info[r.id].s) || '';
      return { id: r.id, name: l.name || (info[r.id] && info[r.id].n) || r.id, mpn: l.mpn || '', qty: r.qty, unit: l.unit || 'adet', url: slug ? '/magaza/urun/' + slug + '/' : '' };
    });
    if (!items.length) return;
    quoteDraft(items, 'proforma');
    window.location.href = CONTACT;
  }

  function onThumb(thumb) {
    var gallery = closest(thumb, '[data-vgm-gallery]'), main = gallery && $('[data-vgm-main]', gallery);
    if (!main) return;
    var src = thumb.getAttribute('data-src');
    if (!/^\/(?:public\/[A-Za-z0-9_.\/-]+|magaza-gorsel\/[0-9a-f]{2}\/[a-z0-9-]{3,90}\.[0-9a-f]{8}(?:-t)?\.webp)$/.test(src || '') || src.indexOf('..') !== -1) return;
    main.src = src;
    main.alt = thumb.getAttribute('data-alt') || '';
    var w = parseInt(thumb.getAttribute('data-w'), 10), h = parseInt(thumb.getAttribute('data-h'), 10);
    if (w > 0 && h > 0) { main.setAttribute('width', String(w)); main.setAttribute('height', String(h)); }
    $$('[data-vgm-thumb]', gallery).forEach(function (t) { if (t === thumb) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current'); });
  }

  /* ------------------------------------------------------------------ vitrin: arama, filtre, sıralama */
  function fold(s) {
    var map = { 'İ': 'i', 'I': 'i', 'ı': 'i', 'Ç': 'c', 'ç': 'c', 'Ğ': 'g', 'ğ': 'g', 'Ö': 'o', 'ö': 'o', 'Ş': 's', 'ş': 's', 'Ü': 'u', 'ü': 'u', 'Â': 'a', 'â': 'a', 'Î': 'i', 'î': 'i', 'Û': 'u', 'û': 'u' };
    return String(s || '').replace(/[İIıÇçĞğÖöŞşÜüÂâÎîÛû]/g, function (c) { return map[c]; }).toLowerCase();
  }
  function initTools() {
    var tools = $('[data-vgm-tools]'), grid = $('[data-vgm-grid]');
    if (!tools || !grid) return;
    var cards = $$('[data-vgm-card]', grid), original = cards.slice();
    var q = $('[data-vgm-q]', tools), cat = $('[data-vgm-cat]', tools), brand = $('[data-vgm-brand]', tools), sort = $('[data-vgm-sort]', tools);
    var count = $('[data-vgm-count]', tools), none = $('[data-vgm-empty]');
    tools.hidden = false;

    function hasOption(select, value) { return $$('option', select).some(function (o) { return o.value === value; }); }
    try {
      var params = new URLSearchParams(location.search);
      q.value = (params.get('q') || '').slice(0, 80);
      if (hasOption(cat, params.get('kategori') || '')) cat.value = params.get('kategori') || '';
      if (hasOption(brand, params.get('marka') || '')) brand.value = params.get('marka') || '';
      if (hasOption(sort, params.get('sirala') || '')) sort.value = params.get('sirala') || '';
    } catch (e) { /* URLSearchParams yok */ }

    function price(card) { var v = parseFloat(card.getAttribute('data-price')); return isFinite(v) ? v : null; }
    function apply() {
      var terms = fold(q.value).split(/\s+/).filter(Boolean), shown = 0;
      cards.forEach(function (c) {
        var ok = (!cat.value || c.getAttribute('data-category') === cat.value) && (!brand.value || c.getAttribute('data-brand') === brand.value);
        if (ok && terms.length) { var hay = c.getAttribute('data-search') || ''; ok = terms.every(function (t) { return hay.indexOf(t) !== -1; }); }
        c.hidden = !ok;
        if (ok) shown++;
      });
      var list = original.slice();
      if (sort.value === 'price-asc' || sort.value === 'price-desc') {
        var dir = sort.value === 'price-asc' ? 1 : -1;
        list.sort(function (a, b) {
          var pa = price(a), pb = price(b);
          if (pa === null && pb === null) return 0;
          if (pa === null) return 1;
          if (pb === null) return -1;
          return (pa - pb) * dir;
        });
      } else if (sort.value === 'name') {
        list.sort(function (a, b) { return String(a.getAttribute('data-name')).localeCompare(String(b.getAttribute('data-name')), 'tr'); });
      }
      list.forEach(function (c) { grid.appendChild(c); });
      count.textContent = shown === cards.length ? cards.length + ' ürün' : shown + ' / ' + cards.length + ' ürün gösteriliyor';
      none.hidden = shown !== 0;
      try {
        var p = new URLSearchParams();
        if (q.value) p.set('q', q.value);
        if (cat.value) p.set('kategori', cat.value);
        if (brand.value) p.set('marka', brand.value);
        if (sort.value) p.set('sirala', sort.value);
        var s = p.toString();
        window.history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
      } catch (e2) { /* adres güncellenemedi; filtre yine çalışır */ }
    }
    var timer = null;
    q.addEventListener('input', function () { window.clearTimeout(timer); timer = window.setTimeout(apply, 120); });
    [cat, brand, sort].forEach(function (s) { s.addEventListener('change', apply); });
    apply();
  }

  /* ------------------------------------------------------------------ kategori: marka / sıralama süzgeci */
  /* Sunucu formu GET ile işler. Seçim değişince sayfa YENİLENMEZ (WCAG 3.2.2): kullanıcı birden çok süzgeci seçip görünür
     "Uygula" düğmesine basar. JS varsa gönderim kanonik adrese gider: parametre sırası formun data-vgm-params listesi
     (sunucudaki sırayla aynı: marka, kutup, akim, egri, ka, kesit, faz, kw, sirala), bir süzgecin değerleri virgülle
     (kutup=1P,3P), varsayılanlar (boş değer, önerilen sıralama) yazılmaz, sayfa 1'e dönülür. */
  function initFilter() {
    /* Telefonda teknik özellik paneli seçili süzgeç yoksa kapalı başlar: bunu ilk boyamadan önce sunucunun </details>
       sonrasına yazdığı satır içi betik yapar (bu dosya defer ile yüklenir; burada kapatmak geç kalıp düzeni kaydırıyordu).
       Burada yalnızca ekran genişleyince (döndürme, pencere büyütme) panel yeniden açılır. */
    var mq = window.matchMedia && window.matchMedia('(max-width: 47.99rem)');
    var facets = $$('[data-vgm-facets]');
    if (mq && facets.length) {
      var onWidth = function () { if (!mq.matches) facets.forEach(function (d) { d.setAttribute('open', ''); }); };
      if (mq.addEventListener) mq.addEventListener('change', onWidth); else if (mq.addListener) mq.addListener(onWidth);
    }
    $$('[data-vgm-filter]').forEach(function (form) {
      form.addEventListener('submit', function (ev) {
        var order = String(form.getAttribute('data-vgm-params') || '').split(',').filter(Boolean);
        var values = {};
        $$('select[name], input[name]', form).forEach(function (s) {
          if (s.disabled || ((s.type === 'checkbox' || s.type === 'radio') && !s.checked)) return;
          var name = String(s.name).replace(/\[\]$/, '');
          if (!s.value || (name === 'sirala' && s.value === 'onerilen')) return;
          if (order.indexOf(name) === -1) order.push(name);
          (values[name] = values[name] || []).push(s.value);
        });
        var parts = [];
        order.forEach(function (name) {
          if (values[name]) parts.push(encodeURIComponent(name) + '=' + values[name].map(encodeURIComponent).join(','));
        });
        ev.preventDefault();
        window.location.href = (form.getAttribute('action') || location.pathname) + (parts.length ? '?' + parts.join('&') : '');
      });
    });
  }

  /* ------------------------------------------------------------------ toplam kutusu (sepet ve ödeme) */
  function renderTotals(root, totals, shipping, hasQuote) {
    function set(key, text) { $$('[data-vgm-t="' + key + '"]', root).forEach(function (n) { n.textContent = text; }); }
    if (!totals || !hasQuote) { ['tryNet', 'tryVat', 'shippingTry', 'tryGross'].forEach(function (k) { set(k, '—'); }); return; }
    set('tryNet', fmtTry(totals.tryNet));
    set('tryVat', fmtTry(totals.tryVat));
    var ship = typeof totals.shippingTry === 'number' ? totals.shippingTry : 0;
    var hint = '';
    if (ship > 0 && shipping && shipping.freeOverTry > 0) hint = ' (' + fmtTry(shipping.freeOverTry) + ' ve üzeri siparişlerde ücretsiz)';
    set('shippingTry', ship > 0 ? fmtTry(ship) + hint : 'Ücretsiz');
    set('tryGross', fmtTry(totals.tryGross));
  }
  function expiryText(quote) {
    if (!quote || !quote.expiresAt) return '';
    var t = fmtTime(quote.expiresAt);
    return t ? 'Bu fiyatlar 30 dakika geçerlidir (son geçerlilik: ' + t + ').' : '';
  }
  function untilExpiry(quote) {
    var t = quote && quote.expiresAt ? Date.parse(quote.expiresAt) : NaN;
    return isFinite(t) ? Math.max(1000, Math.min(t - Date.now() + 500, 2147000000)) : 0;
  }
  function notice(container, kind, message, extra) {
    clear(container);
    if (!message) return null;
    var box = el('div', { class: 'vgm-notice vgm-notice--' + kind }, [message]);
    if (extra) box.appendChild(extra);
    container.appendChild(box);
    return box;
  }

  /* ------------------------------------------------------------------ sepet sayfası */
  function initCartPage(root) {
    var stateEl = $('[data-vgm-state]', root), notices = $('[data-vgm-notices]', root), wrap = $('[data-vgm-cart]', root);
    var linesEl = $('[data-vgm-lines]', root), emptyEl = $('[data-vgm-empty]', root), totalsEl = $('[data-vgm-totals]', root);
    var expiryEl = $('[data-vgm-expiry]', root), checkout = $('[data-vgm-checkout-link]', root), clearBtn = $('[data-vgm-clear]', root);
    var seq = 0, loadTimer = null, expiryTimer = null, canCheckout = false;

    function view(which) {
      stateEl.hidden = which !== 'state';
      wrap.hidden = which !== 'cart';
      emptyEl.hidden = which !== 'empty';
    }
    function setCheckout(ok) {
      canCheckout = ok;
      if (ok) { checkout.removeAttribute('aria-disabled'); checkout.removeAttribute('tabindex'); }
      else { checkout.setAttribute('aria-disabled', 'true'); checkout.setAttribute('tabindex', '-1'); }
    }
    checkout.addEventListener('click', function (ev) { if (!canCheckout) ev.preventDefault(); });

    function setQty(id, qty) {
      var items = readCart();
      items.forEach(function (r) { if (r.id === id) r.qty = qty; });
      writeCart(items);
    }
    function lineNode(line, info) {
      var id = line.id, max = toQty(line.maxQty, MAX_QTY) || (info && info.m) || MAX_QTY;
      var min = toQty(line.minQty, max) || 1, step = toQty(line.step, max) || 1;
      var name = line.name || (info && info.n) || id;
      var unit = unitOf(line.unit || 'adet');
      var href = line.slug ? '/magaza/urun/' + line.slug + '/' : (info && info.s ? '/magaza/urun/' + info.s + '/' : '/magaza/');
      var input = el('input', { type: 'number', min: min, max: max, step: step, value: line.qty, inputmode: 'numeric', 'aria-label': name + ' ' + (unit[0] === 'adet' ? 'adedi' : 'miktarı (' + unit[0] + ')'), 'data-id': id, 'data-vgm-qty': '' });
      var left = el('div', { class: 'vgm-line__info' }, [
        line.brand || line.mpn ? el('p', { class: 'vgm-line__brand' }, [line.brand || '', line.brand && line.mpn ? ' · ' : '', line.mpn ? el('span', { class: 'vgm-mono', text: line.mpn }) : null]) : null,
        el('a', { class: 'vgm-line__name', href: href, text: name })
      ]);
      if (line.orderable && typeof line.unitTryGross === 'number') {
        left.appendChild(el('p', { class: 'vgm-line__unit', text: 'Birim fiyat: ' + fmtTry(line.unitTryGross) + (unit[1] ? ' ' + unit[1] : '') + ' (KDV dahil)' + (line.checkedAt ? ' · Fiyat güncelleme tarihi: ' + fmtDateTime(line.checkedAt) : '') }));
      } else if (!line.orderable && typeof line.unitTryGross === 'number') {
        left.appendChild(el('p', { class: 'vgm-line__unit', text: 'Birim fiyat (bilgi amaçlı): ' + fmtTry(line.unitTryGross) + (unit[1] ? ' ' + unit[1] : '') + ' (KDV dahil)' }));
      }
      var pack = toQty(line.packQty, MAX_PACK) || 0;
      if (unit[0] !== 'adet' || min > 1 || step > 1 || pack > 1) {
        left.appendChild(el('p', { class: 'vgm-line__unit', text: ((line.unit || 'adet') !== 'adet' && UNITS[line.unit] ? ucFirst(line.unit) + ' ile satılır' : 'Sipariş adedi') + (min > 1 ? ' · en az ' + min : '') + (step > 1 ? ' · ' + step + ' katlarında' : '') + (pack > 1 ? ' · paket: ' + pack + ' ' + unit[0] : '') }));
      }
      if (line.reasonText && !line.orderable) {
        left.appendChild(el('p', { class: 'vgm-line__warn', role: 'alert' }, [line.reasonText + ' ',
          el('a', { href: CONTACT, 'data-vgm-quote': '', 'data-id': id, 'data-name': name, 'data-model': line.mpn || '', 'data-unit': line.unit || 'adet', 'data-qty': String(line.qty), 'data-url': line.slug ? '/magaza/urun/' + line.slug + '/' : '', 'data-intent': line.reason === 'freight' ? 'nakliye' : (line.reason === 'unavailable' ? 'alternatif' : 'teklif') },
            [line.reason === 'freight' ? 'Nakliye dahil teklif alın' : (line.reason === 'unavailable' ? 'Alternatif önerin' : 'Teklif isteyin')])]));
      }
      var total = line.orderable && typeof line.lineTryGross === 'number'
        ? el('p', { class: 'vgm-line__total' }, [fmtTry(line.lineTryGross), el('small', { text: line.qty + ' ' + unit[0] })])
        : el('p', { class: 'vgm-line__total' }, ['Teklif ile']);
      var li = el('li', { class: 'vgm-line', 'data-id': id, 'data-max': String(max), 'data-min': String(min), 'data-step': String(step) }, [
        left,
        el('div', { class: 'vgm-line__qty' }, [
          el('button', { type: 'button', 'data-act': 'dec', 'aria-label': 'Azalt: ' + name }, ['−']), input,
          el('button', { type: 'button', 'data-act': 'inc', 'aria-label': 'Artır: ' + name }, ['+'])]),
        total,
        el('button', { type: 'button', class: 'vgm-link vgm-line__rm', 'data-act': 'rm', 'aria-label': 'Sepetten çıkar: ' + name }, ['Sepetten çıkar'])
      ]);
      /* En çok adedin üstü: kapmak yerine proforma yolu (P1-12). */
      var cap = el('p', { class: 'vgm-line__cap', hidden: true }, ['En fazla ' + max + ' ' + unit[0] + ' sipariş verilebilir. ',
        el('a', { class: 'vgm-link', href: CONTACT, 'data-vgm-quote': '', 'data-id': id, 'data-name': name, 'data-model': line.mpn || '', 'data-unit': line.unit || 'adet', 'data-url': line.slug ? '/magaza/urun/' + line.slug + '/' : '', 'data-intent': 'proforma' }, ['Bu adet için proforma isteyin'])]);
      left.appendChild(cap);
      return li;
    }
    function ucFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
    function restoreFocus(prev) {
      if (!prev) return;
      var li = $('.vgm-line[data-id="' + prev.id + '"]', linesEl);
      var target = li && (prev.act ? $('[data-act="' + prev.act + '"]', li) : $('input', li));
      if (target) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
    }
    function activeLine() {
      var a = document.activeElement, li = a && closest(a, '.vgm-line');
      return li ? { id: li.getAttribute('data-id'), act: a.getAttribute && a.getAttribute('data-act') } : null;
    }

    function render(data) {
      var prev = activeLine(), info = readInfo();
      lastLines = data.lines || [];
      clear(linesEl);
      (data.lines || []).forEach(function (l) { linesEl.appendChild(lineNode(l, info[l.id])); });
      var hasQuote = !!(data.quote && data.quote.token);
      renderTotals(totalsEl, data.totals, data.shipping, hasQuote);
      expiryEl.textContent = hasQuote ? expiryText(data.quote) : '';
      var parts = [];
      var skipped = (data.lines || []).some(function (l) { return !l.orderable; });
      if (!data.open) parts.push(['warn', 'Mağazamız çok yakında siparişe açılıyor. Ürünleri sepete ekleyip fiyatları görebilirsiniz; sipariş vermek henüz mümkün değil. Güncel teklif için bize yazabilirsiniz.']);
      if (skipped && data.open) parts.push(['warn', 'Bazı ürünler şu anda çevrim içi sipariş edilemiyor; toplam tutara dahil edilmedi. Ürünü sepetten çıkarabilir veya teklif isteyebilirsiniz.']);
      clear(notices);
      parts.forEach(function (p) { notices.appendChild(el('div', { class: 'vgm-notice vgm-notice--' + p[0] }, [p[1]])); });
      setCheckout(hasQuote && data.open === true);
      view('cart');
      restoreFocus(prev);
      window.clearTimeout(expiryTimer);
      var wait = hasQuote ? untilExpiry(data.quote) : 0;
      if (wait) expiryTimer = window.setTimeout(function () {
        notice(notices, 'info', 'Fiyat geçerlilik süresi doldu; güncel fiyatlar alınıyor.');
        load();
      }, wait);
    }

    function renderError(err, items) {
      clear(linesEl);
      var info = readInfo();
      items.forEach(function (r) { linesEl.appendChild(lineNode({ id: r.id, qty: r.qty, orderable: false, name: (info[r.id] && info[r.id].n) || r.id }, info[r.id])); });
      $$('.vgm-line__warn, .vgm-line__total', linesEl).forEach(function (n) { n.parentNode.removeChild(n); });
      renderTotals(totalsEl, null, null, false);
      expiryEl.textContent = '';
      setCheckout(false);
      var retry = el('button', { type: 'button', class: 'vgm-btn vgm-btn--ghost vgm-btn--sm', 'data-act': 'retry' }, ['Tekrar dene']);
      clear(notices);
      var box = el('div', { class: 'vgm-notice vgm-notice--err', role: 'alert' }, [err.message + ' ']);
      box.appendChild(retry);
      notices.appendChild(box);
      view('cart');
    }

    function load() {
      var items = readCart();
      if (!items.length) { clear(notices); view('empty'); setCheckout(false); return; }
      var mine = ++seq;
      if (wrap.hidden) { stateEl.textContent = 'Fiyatlar kontrol ediliyor…'; view('state'); }
      else wrap.setAttribute('aria-busy', 'true');
      request('sepet', { items: items }, { timeout: 30000 }).then(function (data) {
        if (mine !== seq) return;
        wrap.removeAttribute('aria-busy');
        render(data);
      }, function (err) {
        if (mine !== seq) return;
        wrap.removeAttribute('aria-busy');
        renderError(err, items);
      });
    }
    function scheduleLoad() { window.clearTimeout(loadTimer); loadTimer = window.setTimeout(load, 350); }

    linesEl.addEventListener('click', function (ev) {
      var btn = closest(ev.target, '[data-act]');
      var li = btn && closest(btn, '.vgm-line');
      if (!btn || !li) return;
      var id = li.getAttribute('data-id'), input = $('input', li), act = btn.getAttribute('data-act');
      var max = parseInt(input.getAttribute('max'), 10) || MAX_QTY, min = parseInt(input.getAttribute('min'), 10) || 1, step = parseInt(input.getAttribute('step'), 10) || 1;
      if (act === 'rm') { removeFromCart([id]); load(); return; }
      var q = toQty(input.value, MAX_QTY) || min;
      var capNote = $('.vgm-line__cap', li);
      if (act === 'inc') { q = q + step; if (q > max) { q = max; if (capNote) capNote.hidden = false; } else if (capNote) capNote.hidden = true; }
      if (act === 'dec') { q = Math.max(q - step, min); if (capNote) capNote.hidden = true; }
      q = snapQty(q, min, step, max);
      input.value = String(q);
      setQty(id, q);
      scheduleLoad();
    });
    linesEl.addEventListener('change', function (ev) {
      var input = ev.target;
      if (!input || input.tagName !== 'INPUT') return;
      var li = closest(input, '.vgm-line'), max = parseInt(input.getAttribute('max'), 10) || MAX_QTY, min = parseInt(input.getAttribute('min'), 10) || 1, step = parseInt(input.getAttribute('step'), 10) || 1;
      var wanted = toQty(input.value, MAX_QTY) || min, capNote = $('.vgm-line__cap', li);
      var q = snapQty(wanted, min, step, max);
      if (capNote) capNote.hidden = wanted <= max;
      input.value = String(q);
      setQty(li.getAttribute('data-id'), q);
      scheduleLoad();
    });
    var cartQuote = $('[data-vgm-cart-quote]', root), lastLines = [];
    if (cartQuote) cartQuote.addEventListener('click', function () { onCartQuote(cartQuote, lastLines); });
    notices.addEventListener('click', function (ev) { if (closest(ev.target, '[data-act="retry"]')) load(); });
    clearBtn.addEventListener('click', function () {
      if (window.confirm('Sepetteki tüm ürünler çıkarılsın mı?')) { writeCart([]); load(); }
    });
    cartListeners.push(function () { scheduleLoad(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !wrap.hidden) scheduleLoad(); });
    load();
  }

  /* ------------------------------------------------------------------ ödeme sayfası */
  function setupCaptcha(form) {
    var box = $('[data-vgm-captcha]', form), widget = box && $('.cf-turnstile', box);
    var key = widget ? (widget.getAttribute('data-sitekey') || '') : '';
    var enabled = !!widget && key !== '' && key.indexOf('REPLACE_WITH') !== 0;
    if (enabled) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    } else if (box) {
      box.hidden = true;
    }
    return {
      enabled: enabled,
      token: function () { var f = enabled ? form.querySelector('[name="cf-turnstile-response"]') : null; return f ? trim(f.value) : ''; },
      reset: function () { try { if (enabled && window.turnstile) window.turnstile.reset(); } catch (e) { /* widget yenilenemedi */ } }
    };
  }

  function initCheckoutPage(root) {
    var stateEl = $('[data-vgm-state]', root), notices = $('[data-vgm-notices]', root), success = $('[data-vgm-success]', root);
    var emptyEl = $('[data-vgm-empty]', root), wrap = $('[data-vgm-checkout]', root), form = $('[data-vgm-form]', root);
    var errBox = $('[data-vgm-errors]', form), statusEl = $('[data-vgm-status]', form), submitBtn = $('[data-vgm-submit]', form);
    var same = $('[data-vgm-same]', form), shipBox = $('[data-vgm-ship]', form), bireysel = $('[data-vgm-bireysel]', form), kurumsal = $('[data-vgm-kurumsal]', form);
    var consents = $$('[data-vgm-consent]', form), reWrap = $('[data-vgm-reconfirm-wrap]', form), reBox = $('[data-vgm-reconfirm]', form), reText = $('[data-vgm-reconfirm-text]', form);
    var honeypot = $('[name="website"]', form), mini = $('[data-vgm-mini]', root), totalsEl = $('[data-vgm-totals]', root), expiryEl = $('[data-vgm-expiry]', root);
    var captcha = setupCaptcha(form);
    var st = { quote: null, items: [], skipped: [], totals: null, open: false, expiry: null, docs: { preInfo: '', contract: '' }, docsShown: false,
      docsSeq: 0, docsTimer: null, expiryTimer: null, requestId: '', requestFp: '', submitting: false, needReconfirm: false };

    function view(which) {
      stateEl.hidden = which !== 'state';
      emptyEl.hidden = which !== 'empty';
      wrap.hidden = which !== 'form';
      success.hidden = which !== 'success';
    }
    function field(name) {
      var found = null;
      $$('input, select, textarea', form).forEach(function (n) { if (n.name === name) found = n; });
      return found;
    }
    function val(name) { var f = field(name); return f ? trim(f.value) : ''; }
    function billingType() { var r = $('input[name="billing.type"]:checked', form); return r && r.value === 'kurumsal' ? 'kurumsal' : 'bireysel'; }
    function status(text, kind) { statusEl.textContent = text || ''; if (kind) statusEl.setAttribute('data-kind', kind); else statusEl.removeAttribute('data-kind'); }

    /* ---- sunucuya giden gövde ---- */
    function payload() {
      var type = billingType(), isSame = same.checked;
      var b = { type: type, address: val('billing.address'), city: val('billing.city'), district: val('billing.district') };
      if (type === 'kurumsal') { b.company = val('billing.company'); b.taxOffice = val('billing.taxOffice'); b.vkn = val('billing.vkn'); }
      else { b.tckn = val('billing.tckn'); }
      var s = isSame ? { sameAsBilling: true } : {
        sameAsBilling: false, name: val('shippingAddress.name'), phone: val('shippingAddress.phone'), address: val('shippingAddress.address'),
        city: val('shippingAddress.city'), district: val('shippingAddress.district'), postalCode: val('shippingAddress.postalCode')
      };
      return {
        quote: st.quote || '', items: st.items,
        customer: { name: val('customer.name'), email: val('customer.email'), phone: val('customer.phone') },
        billing: b, shippingAddress: s, notes: val('notes'),
        consents: { preInfo: !!(field('consents.preInfo') || {}).checked, contract: !!(field('consents.contract') || {}).checked }
      };
    }

    /* ---- sepet / fiyat teyidi ---- */
    function applyQuote(data) {
      var lines = data.lines || [];
      st.open = data.open === true;
      st.items = lines.filter(function (l) { return l.orderable; }).map(function (l) { return { id: l.id, qty: l.qty }; });
      st.skipped = lines.filter(function (l) { return !l.orderable; });
      st.quote = data.quote && data.quote.token ? data.quote.token : null;
      st.totals = data.totals || null;
      st.expiry = data.quote || null;
      clear(mini);
      lines.filter(function (l) { return l.orderable; }).forEach(function (l) {
        mini.appendChild(el('li', {}, [el('span', { text: l.qty + ' × ' + l.name }), el('span', { text: fmtTry(l.lineTryGross) })]));
      });
      renderTotals(totalsEl, data.totals, data.shipping, !!st.quote);
      expiryEl.textContent = st.quote ? expiryText(data.quote) : '';
      window.clearTimeout(st.expiryTimer);
      var wait = st.quote ? untilExpiry(data.quote) : 0;
      if (wait) st.expiryTimer = window.setTimeout(function () { requote('expired'); }, wait);
      clear(notices);
      if (!st.open) notices.appendChild(el('div', { class: 'vgm-notice vgm-notice--warn', role: 'alert' }, [
        'Mağazamız çok yakında siparişe açılıyor. Şu anda sipariş verilemiyor; ürün için ', el('a', { href: CONTACT }, ['teklif isteyebilirsiniz']), '.']));
      if (st.skipped.length) {
        notices.appendChild(el('div', { class: 'vgm-notice vgm-notice--warn' }, [
          'Şu ürünler çevrim içi sipariş edilemediği için siparişe dahil değil: ' + st.skipped.map(function (l) { return l.name; }).join(', ') + '. ',
          el('a', { href: '/magaza/sepet.html' }, ['Sepeti düzenleyin']), ' veya ', el('a', { href: CONTACT }, ['teklif isteyin']), '.']));
      }
      if (!st.items.length) {
        notices.appendChild(el('div', { class: 'vgm-notice vgm-notice--err', role: 'alert' }, ['Sepetinizde sipariş verilebilir ürün yok. ', el('a', { href: '/magaza/sepet.html' }, ['Sepete dön'])]));
        view('state'); stateEl.hidden = true;
        wrap.hidden = true;
        return;
      }
      submitBtn.disabled = !st.open;
      if (!st.open) status('Sipariş verilebilmesi için mağazanın açılması gerekiyor.', 'err'); else if (statusEl.getAttribute('data-kind') === 'err') status('');
      view('form');
    }

    /* Fiyat jetonu yenilenir. reason: 'expired' (sessiz yenileme) | 'submit' (siparişte jeton süresi doldu: yeni toplamı onaylat). */
    function requote(reason) {
      var before = st.totals ? st.totals.tryGross : null;
      var items = readCart();
      if (!items.length) return Promise.resolve();
      return request('sepet', { items: items }, { timeout: 30000 }).then(function (data) {
        applyQuote(data);
        scheduleDocs(0);
        var after = data.totals ? data.totals.tryGross : null;
        if (reason === 'submit') {
          if (before !== null && after !== null && Math.abs(after - before) > 0.004) {
            st.needReconfirm = true;
            reWrap.hidden = false; reBox.checked = false;
            reText.textContent = 'Fiyatlar güncellendi: önceki toplam ' + fmtTry(before) + ', yeni toplam ' + fmtTry(after) + '. Yeni toplam tutarı onaylıyorum.';
            status('Toplam tutar değişti. Yeni tutarı ve belge metinlerini onaylayıp siparişi yeniden gönderin.', 'err');
            focusEl(reBox);
          } else {
            status('Fiyat teyidiniz yenilendi; tutar değişmedi. Siparişi yeniden gönderebilirsiniz.');
          }
        }
      }, function (err) { status(err.message, 'err'); });
    }

    /* ---- Ön Bilgilendirme Formu ve sözleşme önizlemesi ---- */
    function setDocs(pre, con) {
      var changed = st.docsShown && (pre !== st.docs.preInfo || con !== st.docs.contract);
      st.docs = { preInfo: pre, contract: con };
      st.docsShown = true;
      [['preInfo', pre], ['contract', con]].forEach(function (d) {
        var box = $('[data-vgm-doc="' + d[0] + '"]', form), msg = $('[data-vgm-doc-state="' + d[0] + '"]', form);
        box.textContent = d[1];
        box.hidden = false;
        msg.hidden = true;
      });
      consents.forEach(function (c) { c.disabled = !st.open; });
      if (changed && consents.some(function (c) { return c.checked; })) {
        consents.forEach(function (c) { c.checked = false; });
        status('Belge metinleri güncellendi; lütfen yeniden okuyup onay kutularını işaretleyin.');
      }
    }
    function docsError(message) {
      ['preInfo', 'contract'].forEach(function (k) {
        var msg = $('[data-vgm-doc-state="' + k + '"]', form);
        msg.hidden = false; msg.textContent = message;
        var box = $('[data-vgm-doc="' + k + '"]', form); box.hidden = true;
      });
      consents.forEach(function (c) { c.checked = false; c.disabled = true; });
      st.docsShown = false;
    }
    function fetchDocs() {
      if (!st.quote || !st.items.length) return;
      var mine = ++st.docsSeq;
      request('onbilgi', payload()).then(function (d) {
        if (mine !== st.docsSeq) return;
        setDocs(typeof d.preInfo === 'string' ? d.preInfo : '', typeof d.contract === 'string' ? d.contract : '');
      }, function (err) {
        if (mine !== st.docsSeq) return;
        if (err.code === 'quote_expired') { requote('expired'); return; }
        docsError(err.message + ' Sayfayı yenileyip tekrar deneyin.');
      });
    }
    function scheduleDocs(delay) { window.clearTimeout(st.docsTimer); st.docsTimer = window.setTimeout(fetchDocs, delay); }

    /* ---- hata gösterimi ---- */
    function clearErrors() {
      errBox.hidden = true; clear(errBox);
      $$('.vgm-field[data-invalid]', form).forEach(function (f) { f.removeAttribute('data-invalid'); });
      $$('.vgm-field__err', form).forEach(function (n) { n.parentNode.removeChild(n); });
      $$('[aria-invalid]', form).forEach(function (n) { n.removeAttribute('aria-invalid'); });
    }
    function showErrors(list, headline) {
      clearErrors();
      var ul = el('ul');
      list.forEach(function (p, i) {
        var input = p.name ? field(p.name) : null, holder = input ? closest(input, '.vgm-field') : null;
        if (input && holder) {
          var id = 'vgm-err-' + i;
          holder.setAttribute('data-invalid', '');
          holder.appendChild(el('p', { class: 'vgm-field__err', id: id, text: p.message }));
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', ((input.getAttribute('aria-describedby') || '') + ' ' + id).replace(/^\s+/, ''));
        }
        var li = el('li');
        if (input) {
          var a = el('a', { href: '#' + (input.id || ''), text: p.message });
          a.addEventListener('click', function (ev) { ev.preventDefault(); focusEl(input); });
          li.appendChild(a);
        } else { li.textContent = p.message; }
        ul.appendChild(li);
      });
      errBox.appendChild(el('h2', { text: headline || 'Lütfen şunları düzeltin' }));
      errBox.appendChild(ul);
      errBox.hidden = false;
      focusEl(errBox);
    }
    function validate() {
      var out = [];
      function need(name, message) { if (!val(name)) out.push({ name: name, message: message }); }
      need('customer.name', 'Ad soyad girin.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val('customer.email'))) out.push({ name: 'customer.email', message: 'Geçerli bir e-posta adresi girin.' });
      if (val('customer.phone').replace(/\D/g, '').length < 10) out.push({ name: 'customer.phone', message: 'Geçerli bir telefon numarası girin.' });
      if (billingType() === 'kurumsal') {
        need('billing.company', 'Firma ünvanını girin.'); need('billing.taxOffice', 'Vergi dairesini girin.');
        if (!/^\d{10,11}$/.test(val('billing.vkn').replace(/\s+/g, ''))) out.push({ name: 'billing.vkn', message: 'Vergi kimlik numarasını girin (10 hane).' });
      } else if (val('billing.tckn') && !/^\d{11}$/.test(val('billing.tckn').replace(/\s+/g, ''))) {
        out.push({ name: 'billing.tckn', message: 'T.C. kimlik numarası 11 haneli olmalı; boş bırakabilirsiniz.' });
      }
      need('billing.address', 'Fatura adresini girin.'); need('billing.city', 'İl girin.'); need('billing.district', 'İlçe girin.');
      if (!same.checked) {
        need('shippingAddress.name', 'Teslim alacak kişinin adını girin.'); need('shippingAddress.phone', 'Teslimat için telefon girin.');
        need('shippingAddress.address', 'Teslimat adresini girin.'); need('shippingAddress.city', 'Teslimat ilini girin.'); need('shippingAddress.district', 'Teslimat ilçesini girin.');
      }
      if (!(field('consents.preInfo') || {}).checked) out.push({ name: 'consents.preInfo', message: 'Ön Bilgilendirme Formu’nu okuyup onaylamanız gerekir.' });
      if (!(field('consents.contract') || {}).checked) out.push({ name: 'consents.contract', message: 'Mesafeli Satış Sözleşmesi’ni okuyup onaylamanız gerekir.' });
      if (st.needReconfirm && !reBox.checked) out.push({ name: null, message: 'Güncellenen toplam tutarı onaylayın.' });
      if (captcha.enabled && !captcha.token()) out.push({ name: null, message: 'Lütfen güvenlik doğrulamasını tamamlayın.' });
      return out;
    }

    /* ---- gönderim ---- */
    function onSubmit(ev) {
      ev.preventDefault();
      if (st.submitting) return;
      var problems = validate();
      if (problems.length) { showErrors(problems); status(''); return; }
      clearErrors();
      var body = payload();
      var fp = JSON.stringify([body.quote, body.items, body.customer, body.billing, body.shippingAddress, body.notes]);
      if (!st.requestId || fp !== st.requestFp) { st.requestId = randomId('o'); st.requestFp = fp; }
      body.requestId = st.requestId;
      body.website = honeypot ? honeypot.value : '';
      body.formTimestamp = String(Date.now());
      body.turnstile = captcha.token();
      st.submitting = true;
      submitBtn.disabled = true;
      form.setAttribute('aria-busy', 'true');
      status('Siparişiniz gönderiliyor…');
      request('siparis', body, { timeout: 45000 }).then(onSuccess, onFailure).then(function () {
        st.submitting = false;
        form.removeAttribute('aria-busy');
        if (!success.hidden) return;
        submitBtn.disabled = !st.open;
      });
    }
    function onSuccess(data) {
      var done = {
        reference: String(data.reference || ''), amountTry: data.amountTry, amountText: String(data.amountText || ''), payBy: String(data.payBy || ''),
        payByText: String(data.payByText || ''), bank: data.bank && typeof data.bank === 'object' ? data.bank : {}, message: String(data.message || ''),
        mailSent: data.mailSent !== false, duplicate: data.duplicate === true
      };
      kvSet(DONE_KEY, JSON.stringify(done), true);
      removeFromCart(st.items.map(function (i) { return i.id; }));
      window.clearTimeout(st.expiryTimer); window.clearTimeout(st.docsTimer);
      showSuccess(done, true);
    }
    function onFailure(err) {
      captcha.reset();
      if (err.code === 'quote_expired') { status('Fiyat teyidinin süresi doldu; güncel fiyatlar alınıyor…'); return requote('submit'); }
      if (err.fields && Object.keys(err.fields).length) {
        var list = [];
        Object.keys(err.fields).forEach(function (k) { list.push({ name: k, message: String(err.fields[k]) }); });
        showErrors(list, err.message || 'Lütfen işaretli alanları düzeltin');
        status('');
        return null;
      }
      if (err.code === 'shop_closed') { st.open = false; submitBtn.disabled = true; }
      if (err.kind === 'network' || err.kind === 'timeout' || err.kind === 'bad') {
        status(err.message + ' Siparişiniz alınmış olabilir; yeniden göndermeniz güvenlidir, aynı sipariş iki kez oluşturulmaz.', 'err');
      } else {
        status(err.message, 'err');
      }
      focusEl(statusEl);
      return null;
    }

    /* ---- sipariş tamamlandı ---- */
    function setPay(key, text) { var n = $('[data-vgm-pay="' + key + '"]', success); if (n) n.textContent = text; }
    function showSuccess(done, fresh) {
      var bank = done.bank || {};
      setPay('reference', done.reference);
      setPay('amount', done.amountText || fmtTry(done.amountTry));
      setPay('payBy', done.payByText || fmtDateTime(done.payBy));
      setPay('bankName', String(bank.ad || ''));
      setPay('holder', String(bank.hesapSahibi || ''));
      setPay('iban', String(bank.iban || ''));
      var msg = $('[data-vgm-success-msg]', success);
      msg.textContent = (done.message || 'Siparişiniz alındı.') + (fresh ? '' : ' (Bu bilgiler yalnızca bu tarayıcı oturumunda saklanır.)');
      var track = $('[data-vgm-track-link]', success);
      if (track && /^VGS-[0-9]{6}-[A-Z0-9]{5}$/.test(done.reference)) track.setAttribute('href', '/magaza/siparis-takip.html?ref=' + encodeURIComponent(done.reference));
      clear(notices);
      view('success');
      focusEl(success);
    }
    function copyValue(key) {
      var n = $('[data-vgm-pay="' + key + '"]', success), text = n ? trim(n.textContent) : '';
      var out = $('[data-vgm-copy-status]', success);
      function ok() { out.textContent = 'Kopyalandı.'; }
      function fail() { out.textContent = 'Kopyalanamadı; metni seçip kopyalayın.'; }
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, fail); return; }
      var ta = el('textarea', { readonly: true, 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? ok() : fail(); } catch (e) { fail(); }
      document.body.removeChild(ta);
    }
    success.addEventListener('click', function (ev) {
      var copy = closest(ev.target, '[data-vgm-copy]');
      if (copy) { copyValue(copy.getAttribute('data-vgm-copy')); return; }
      if (closest(ev.target, '[data-vgm-print]')) window.print();
    });

    /* ---- olaylar ---- */
    function syncBilling() { var k = billingType() === 'kurumsal'; kurumsal.hidden = !k; bireysel.hidden = k; }
    function syncShip() { shipBox.hidden = same.checked; }
    form.addEventListener('submit', onSubmit);
    form.addEventListener('input', function (ev) { if (ev.target && ev.target.type !== 'checkbox' && ev.target !== honeypot) scheduleDocs(800); });
    form.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t) return;
      if (t.name === 'billing.type') syncBilling();
      if (t === same) syncShip();
      if (t.type !== 'checkbox' || t === same || t.name === 'billing.type') scheduleDocs(t.type === 'radio' || t === same ? 0 : 300);
    });
    syncBilling(); syncShip();

    /* ---- başlangıç ---- */
    var done = parseJson(kvGet(DONE_KEY, true), null);
    var items = readCart();
    if (!items.length) {
      if (done && done.reference) { showSuccess(done, false); return; }
      view('empty');
      return;
    }
    view('state');
    stateEl.textContent = 'Fiyatlar kontrol ediliyor…';
    request('sepet', { items: items }, { timeout: 30000 }).then(function (data) {
      applyQuote(data);
      if (st.items.length) scheduleDocs(0);
    }, function (err) {
      clear(notices);
      var retry = el('button', { type: 'button', class: 'vgm-btn vgm-btn--ghost vgm-btn--sm' }, ['Tekrar dene']);
      retry.addEventListener('click', function () { window.location.reload(); });
      var box = el('div', { class: 'vgm-notice vgm-notice--err', role: 'alert' }, [err.message + ' ']);
      box.appendChild(retry);
      notices.appendChild(box);
      stateEl.hidden = true;
    });
  }

  /* ------------------------------------------------------------------ sipariş takibi */
  var STEPS = [['odeme_bekleniyor', 'Ödeme bekleniyor'], ['odeme_alindi', 'Ödeme alındı'], ['tedarikte', 'Tedarik ediliyor'], ['kargoda', 'Kargoya verildi'], ['teslim_edildi', 'Teslim edildi']];

  function initTrackPage(root) {
    var form = $('[data-vgm-track-form]', root), result = $('[data-vgm-track-result]', root), errBox = $('[data-vgm-errors]', form);
    var statusEl = $('[data-vgm-status]', form), submitBtn = $('[data-vgm-submit]', form);
    var refInput = $('[name="reference"]', form), mailInput = $('[name="email"]', form), busy = false;
    var pre = '';
    try { pre = new URLSearchParams(location.search).get('ref') || ''; } catch (e) { pre = ''; }
    if (!pre) { var done = parseJson(kvGet(DONE_KEY, true), null); pre = done && done.reference ? done.reference : ''; }
    if (/^[A-Za-z0-9-]{1,24}$/.test(pre)) refInput.value = pre.toUpperCase();

    function problem(message, input) {
      clear(errBox);
      errBox.appendChild(el('p', { text: message }));
      errBox.hidden = false;
      if (input) input.setAttribute('aria-invalid', 'true');
      focusEl(errBox);
    }
    function trackRow(label, value) { return el('div', {}, [el('dt', { text: label }), el('dd', { text: value })]); }

    function renderOrder(o) {
      clear(result);
      var status = String(o.status || '');
      var idx = -1;
      STEPS.forEach(function (s, i) { if (s[0] === status) idx = i; });
      var seen = {};
      (o.history || []).forEach(function (h) { seen[h.status] = true; });
      var head = el('section', { class: 'vgm-block' }, [
        el('h2', { text: 'Sipariş ' + String(o.reference || '') }),
        el('p', {}, [el('span', { class: 'vgm-chip vgm-chip--' + (status === 'iptal' || status === 'iade' ? 'off' : (status === 'teslim_edildi' ? 'ok' : 'wait')), text: String(o.statusLabel || status) })]),
        el('p', { class: 'vgm-fine', text: 'Sipariş tarihi: ' + fmtDateTime(o.createdAt) })
      ]);
      if (status === 'odeme_bekleniyor') {
        head.appendChild(el('div', { class: 'vgm-notice vgm-notice--warn', style: 'margin-top:.9rem' }, [
          'Ödemeniz bekleniyor. Havale/EFT açıklamasına sipariş numaranızı yazın. Son ödeme zamanı: ' + fmtDateTime(o.payBy) + ' (TSİ).']));
      }
      if (status === 'iptal' || status === 'iade') {
        head.appendChild(el('div', { class: 'vgm-notice vgm-notice--err', style: 'margin-top:.9rem' }, ['Bu sipariş ' + (status === 'iptal' ? 'iptal edildi.' : 'iade edildi.')]));
      }
      result.appendChild(head);

      var steps = el('ol', { class: 'vgm-steps', 'aria-label': 'Sipariş aşamaları' });
      STEPS.forEach(function (s, i) {
        var state = 'todo';
        if (status === 'iptal' || status === 'iade') state = seen[s[0]] ? 'done' : 'todo';
        else if (i < idx) state = 'done';
        else if (i === idx) state = 'current';
        steps.appendChild(el('li', { class: 'vgm-step', 'data-state': state }, [s[1], state === 'current' ? el('span', { class: 'vgm-sr', text: ' (güncel aşama)' }) : null]));
      });
      result.appendChild(steps);

      var tr = o.tracking && typeof o.tracking === 'object' ? o.tracking : null;
      if (tr && (tr.company || tr.code)) {
        var box = el('section', { class: 'vgm-block' }, [el('h2', { text: 'Kargo bilgisi' }), el('dl', { class: 'vgm-totals' }, [
          trackRow('Kargo firması', String(tr.company || '—')), trackRow('Takip numarası', String(tr.code || '—'))])]);
        if (typeof tr.url === 'string' && /^https?:\/\/[^\s"<>]+$/i.test(tr.url)) {
          box.appendChild(el('p', { class: 'vgm-actions' }, [el('a', { class: 'vgm-btn vgm-btn--ghost vgm-btn--sm', href: tr.url, target: '_blank', rel: 'noopener noreferrer' }, ['Kargo takip sayfası'])]));
        }
        result.appendChild(box);
      }

      var list = el('ul', { class: 'vgm-mini' });
      (o.items || []).forEach(function (it) {
        list.appendChild(el('li', {}, [el('span', { text: (it.qty || 0) + ' × ' + String(it.name || '') }), el('span', { text: fmtTry(it.lineTryGross) })]));
      });
      var t = o.totals || {};
      result.appendChild(el('section', { class: 'vgm-block' }, [el('h2', { text: 'Siparişteki ürünler' }), list, el('dl', { class: 'vgm-totals' }, [
        trackRow('Ara toplam (KDV hariç)', fmtTry(t.tryNet)), trackRow('KDV', fmtTry(t.tryVat)),
        trackRow('Kargo', typeof t.shippingTry === 'number' && t.shippingTry > 0 ? fmtTry(t.shippingTry) : 'Ücretsiz'),
        el('div', { class: 'vgm-totals__grand' }, [el('dt', { text: 'Toplam (KDV dahil)' }), el('dd', { text: fmtTry(t.tryGross) })])])]));

      var hist = el('ul', { class: 'vgm-history' });
      (o.history || []).slice().reverse().forEach(function (h) {
        hist.appendChild(el('li', {}, [el('time', { datetime: String(h.at || ''), text: fmtDateTime(h.at) }), el('strong', { text: String(h.label || h.status || '') }), h.note ? el('span', { text: ' – ' + h.note }) : null]));
      });
      if (hist.firstChild) result.appendChild(el('section', { class: 'vgm-block' }, [el('h2', { text: 'Sipariş geçmişi' }), hist]));
      focusEl(result);
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (busy) return;
      errBox.hidden = true; clear(errBox);
      $$('[aria-invalid]', form).forEach(function (n) { n.removeAttribute('aria-invalid'); });
      var ref = trim(refInput.value).toUpperCase(), email = trim(mailInput.value);
      if (!/^VGS-[0-9]{6}-[A-Z0-9]{5}$/.test(ref)) { problem('Sipariş numarasını “VGS-261027-ABC23” biçiminde girin.', refInput); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { problem('Sipariş verirken kullandığınız geçerli e-posta adresini girin.', mailInput); return; }
      busy = true; submitBtn.disabled = true; statusEl.textContent = 'Sipariş sorgulanıyor…';
      clear(result);
      request('durum', { reference: ref, email: email }).then(function (d) {
        statusEl.textContent = '';
        if (d.order && typeof d.order === 'object') renderOrder(d.order);
        else problem('Sipariş bilgisi okunamadı. Lütfen tekrar deneyin.');
      }, function (err) {
        statusEl.textContent = '';
        problem(err.message);
      }).then(function () { busy = false; submitBtn.disabled = false; });
    });
  }

  /* ------------------------------------------------------------------ yatay kaydırılan çip satırları (dar ekran) */
  /* Alt kategori / arama daraltma çipleri dar ekranda tek satırda yatay kayar (css/magaza.css). Kenar solmaları yalnızca o
     yönde gizli çip varken görünür (data-fade="start end"); seçili çip görünür alana alınır. Çipler bağlantı olduğundan
     Tab ile gezilir, odaklanan çip tarayıcı tarafından görünüme kaydırılır. */
  function initScrollers() {
    $$('[data-vgm-scroller]').forEach(function (nav) {
      var list = $('ul', nav);
      if (!list) return;
      var update = function () {
        var max = list.scrollWidth - list.clientWidth, x = list.scrollLeft, f = [];
        if (max > 2 && x > 2) f.push('start');
        if (max > 2 && x < max - 2) f.push('end');
        nav.setAttribute('data-fade', f.join(' '));
      };
      var cur = $('[aria-current="page"]', list);
      if (cur && list.scrollWidth > list.clientWidth) {
        var li = cur.parentNode;
        list.scrollLeft = Math.max(0, li.offsetLeft - 24);   // ul position: relative (css)
      }
      list.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);
      update();
    });
  }

  /* ------------------------------------------------------------------ başlat */
  function init() {
    initGlobal();
    initScrollers();
    initTools();
    initFilter();
    var cart = $('[data-vgm-cart-page]'), checkout = $('[data-vgm-checkout-page]'), track = $('[data-vgm-track-page]');
    if (cart) initCartPage(cart);
    if (checkout) initCheckoutPage(checkout);
    if (track) initTrackPage(track);
  }

  window.VGMagaza = {
    version: VERSION,
    cart: { read: readCart, write: writeCart, add: addToCart, remove: removeFromCart, count: cartCount },
    format: { try: fmtTry, dateTime: fmtDateTime }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
