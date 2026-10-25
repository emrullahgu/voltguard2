/*!
 * VoltGuard – vg-shell.js
 * Ortak site başlığı (#vgHeader) davranışı: mobil menü, açılır menüler (Hizmetler / Kurumsal / Teknik Kaynaklar), tema düğmesi, kaydırma gölgesi,
 * Esc / dışarı tıklama / klavye gezinmesi, aria-current senkronu, çapa hizalama, yıl, prefetch yedeği,
 * alt bilgi animasyonlarının ekran dışındayken duraklatılması, service worker kaydı (/sw.js).
 * Bağımlılık yok, defer ile yüklenir. İki kez yüklense de ikinci çalıştırma kendini devre dışı bırakır.
 * Başlık/alt bilgi işaretlemesi: tools/shell/header.html + tools/shell/footer.html (tools/shell.py işler).
 *
 * Genel API (window.VGShell):
 *   VGShell.close()           menüyü ve açılır menüleri kapatır
 *   VGShell.refreshCurrent()  başlıktaki aria-current'ı location'a göre yeniden hesaplar
 *                             (hesap bağlantısının href'i değiştirildikten sonra çağırın)
 *   VGShell.scrollTo(id|el)   başlığın altına doğru hizalanmış çapa kaydırması (kayma düzeltmeli)
 * Olay: document 'vg:shell-ready' (başlık hazır olunca).
 */
// ---------- Renk teması (açık / koyu) ----------
// <html data-theme="light|dark"> ilk boyamadan önce tools/shell/head.html'deki satır içi betikle yazılır
// (localStorage 'vg-theme' yoksa işletim sistemi tercihi). Burada: başlıktaki [data-vg-theme-toggle]
// düğmeleri, açık seçimin saklanması (depolama engelliyse yalnız bu sayfa için), sistem tercihi değişimi.
// Olay: document 'vg:theme' (detail.theme). API: window.VGTheme.get() / .set('dark'|'light'|null).
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  if (window.VGTheme) return;
  var KEY = 'vg-theme', mq = null, memo = null, animT = 0;
  try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { /* eski tarayıcı */ }
  function stored() {
    var v = memo;
    try { v = localStorage.getItem(KEY) || memo; } catch (e) { /* depolama engelli */ }
    return v === 'dark' || v === 'light' ? v : null;
  }
  function system() { return mq && mq.matches ? 'dark' : 'light'; }
  function current() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function sync() {
    var dark = current() === 'dark';
    [].forEach.call(doc.querySelectorAll('[data-vg-theme-toggle]'), function (b) {
      var label = dark ? 'Açık temaya geç' : 'Koyu temaya geç';
      b.setAttribute('aria-pressed', dark ? 'true' : 'false');
      b.setAttribute('aria-label', label);
      if (b.hasAttribute('title')) b.setAttribute('title', label);
      var txt = b.querySelector('[data-vg-theme-text]');
      if (txt) txt.textContent = dark ? 'Açık tema' : 'Koyu tema';
    });
  }
  function apply(theme) {
    var prev = current();
    root.setAttribute('data-theme', theme);
    sync();
    if (prev !== theme) {
      try { doc.dispatchEvent(new CustomEvent('vg:theme', { detail: { theme: theme } })); } catch (e) { /* no-op */ }
    }
  }
  function set(theme) {
    memo = theme === 'dark' || theme === 'light' ? theme : null;
    try { if (memo) localStorage.setItem(KEY, memo); else localStorage.removeItem(KEY); } catch (e) { /* depolama engelli: yalnız bu sayfa */ }
    apply(memo || system());
  }
  // Satır içi başlatıcı yoksa (eski önbellek) burada uygula
  if (!root.hasAttribute('data-theme')) root.setAttribute('data-theme', stored() || system());
  if (mq) {
    var onSys = function () { if (!stored()) apply(system()); };
    if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys);
  }
  // Başka sekmede değiştirildiyse eşitle
  window.addEventListener('storage', function (e) {
    if (e.key === KEY || e.key === null) { memo = null; apply(stored() || system()); }
  });
  // bfcache'ten dönüşte güncel seçimi yansıt
  window.addEventListener('pageshow', function (e) { if (e.persisted) apply(stored() || system()); });
  doc.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-vg-theme-toggle]') : null;
    if (!b) return;
    e.preventDefault();
    root.classList.add('vg-theme-anim');
    clearTimeout(animT);
    animT = setTimeout(function () { root.classList.remove('vg-theme-anim'); }, 450);
    set(current() === 'dark' ? 'light' : 'dark');
  });
  window.VGTheme = { get: current, set: set };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', sync); else sync();
})();

(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  if (root.getAttribute('data-vg-shell')) return;           // çift bağlama koruması
  var header = doc.getElementById('vgHeader');
  if (!header) return;
  root.setAttribute('data-vg-shell', '1');
  root.classList.add('vg-js');

  var burger = header.querySelector('.vg-burger');
  var nav = header.querySelector('.vg-nav');
  var dds = [].slice.call(header.querySelectorAll('[data-vg-dd]'));
  var desktopMQ = window.matchMedia('(min-width: 80rem)');
  var hoverMQ = window.matchMedia('(hover: hover) and (pointer: fine)');

  function isOpenMenu() { return header.classList.contains('is-open'); }

  /* ---------- Mobil menü ---------- */
  function setMenu(open, focusFirst) {
    if (!burger || !nav || open === isOpenMenu()) return;
    header.classList.toggle('is-open', open);
    root.classList.toggle('vg-lock', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Menüyü kapat' : 'Menüyü aç');
    if (!open) closeDds();
    else if (focusFirst) {
      var first = nav.querySelector('a[href], button');
      if (first) first.focus();
    }
  }

  /* ---------- Açılır menü (Kaynaklar) ---------- */
  function setDd(dd, open, focusItem) {
    var btn = dd.querySelector('.vg-dd__btn');
    if (!btn) return;
    if (open) {
      closeDds(dd);
      dd.setAttribute('data-open', '');
    } else {
      dd.removeAttribute('data-open');
    }
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && focusItem) {
      var items = dd.querySelectorAll('.vg-dd__menu a');
      var target = focusItem === 'last' ? items[items.length - 1] : items[0];
      if (target) target.focus();
    }
  }
  function closeDds(except) {
    dds.forEach(function (d) {
      if (d !== except && d.hasAttribute('data-open')) setDd(d, false);
    });
  }
  function closeAll() { setMenu(false); closeDds(); }

  dds.forEach(function (dd) {
    var btn = dd.querySelector('.vg-dd__btn');
    var timer = 0;
    var hoverAt = 0;
    if (!btn) return;

    btn.addEventListener('click', function (e) {
      // Fare ile üzerine gelince açıldıysa hemen ardından gelen tıklama menüyü kapatmasın.
      if (desktopMQ.matches && hoverAt && Date.now() - hoverAt < 450) { hoverAt = 0; dd.__vgHover = false; return; }
      dd.__vgHover = false;
      setDd(dd, !dd.hasAttribute('data-open'), e.detail === 0 ? 'first' : false);
    });
    dd.addEventListener('mouseenter', function () {
      if (!desktopMQ.matches || !hoverMQ.matches) return;
      clearTimeout(timer);
      if (!dd.hasAttribute('data-open')) { hoverAt = Date.now(); dd.__vgHover = true; setDd(dd, true); }
    });
    dd.addEventListener('mouseleave', function () {
      if (!desktopMQ.matches || !hoverMQ.matches || !dd.__vgHover) return;
      clearTimeout(timer);
      timer = setTimeout(function () { dd.__vgHover = false; setDd(dd, false); }, 160);
    });
  });

  if (burger) {
    burger.addEventListener('click', function (e) { setMenu(!isOpenMenu(), e.detail === 0); });
  }

  /* Tıklamalar: dışarı tıklama, bağlantıya gidince kapatma, perde (scrim) */
  doc.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (!header.contains(t)) { closeAll(); return; }
    if (t.closest('[data-vg-scrim]')) { closeAll(); return; }
    if (t.closest('a[href]')) { closeAll(); return; }
    if (!t.closest('[data-vg-dd]')) closeDds();
  });

  /* Klavye: Esc, ok tuşları */
  doc.addEventListener('keydown', function (e) {
    var k = e.key;
    var open = dds.filter(function (d) { return d.hasAttribute('data-open'); })[0];
    if (k === 'Escape') {
      if (open) {
        var inside = open.contains(doc.activeElement);
        setDd(open, false);
        if (inside) open.querySelector('.vg-dd__btn').focus();
      } else if (isOpenMenu()) {
        setMenu(false);
        if (burger) burger.focus();
      }
      return;
    }
    var dd = e.target && e.target.closest ? e.target.closest('[data-vg-dd]') : null;
    if (!dd || !header.contains(dd)) return;
    var btn = dd.querySelector('.vg-dd__btn');
    var items = [].slice.call(dd.querySelectorAll('.vg-dd__menu a'));
    var i = items.indexOf(e.target);
    if (e.target === btn && (k === 'ArrowDown' || k === 'ArrowUp')) {
      e.preventDefault();
      setDd(dd, true, k === 'ArrowUp' ? 'last' : 'first');
    } else if (i > -1) {
      if (k === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (k === 'ArrowUp') { e.preventDefault(); (i === 0 ? btn : items[i - 1]).focus(); }
      else if (k === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (k === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    }
  });

  /* Odak başlığın dışına çıkınca menüleri kapat (Tab ile terk) */
  header.addEventListener('focusout', function (e) {
    var to = e.relatedTarget;
    if (!to) return;                                    // boş alana tıklama: click/Esc yönetir
    if (header.contains(to)) {
      dds.forEach(function (d) { if (d.hasAttribute('data-open') && !d.contains(to)) setDd(d, false); });
      return;
    }
    closeAll();
  });

  /* Genişlik eşiği geçilince (döndürme / yeniden boyutlandırma) menüyü sıfırla */
  function onMQ() { closeAll(); }
  if (desktopMQ.addEventListener) desktopMQ.addEventListener('change', onMQ);
  else if (desktopMQ.addListener) desktopMQ.addListener(onMQ);
  window.addEventListener('pageshow', function (e) { if (e.persisted) { closeAll(); refreshCurrent(); } });
  window.addEventListener('hashchange', closeAll);

  /* ---------- Kaydırma: gölge ---------- */
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      header.classList.toggle('is-scrolled', (window.pageYOffset || root.scrollTop) > 6);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- aria-current (statik işaretleme tools/shell.py'de; bu, canlı senkron) ---------- */
  function canon(p) {
    p = String(p || '/').replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    return p === '/teklif-araclari' ? '/hesaplama-araclari' : p;
  }
  function refreshCurrent() {
    var here = canon(location.pathname);
    [].forEach.call(header.querySelectorAll('a[href^="/"]'), function (a) {
      var href = a.getAttribute('href');
      if (href.indexOf('#') > -1) return;               // /#bölüm bağlantıları sayfa değil
      var sec = a.getAttribute('data-vg-match');
      var cur = null;
      if (canon(href.split('?')[0]) === here) cur = 'page';
      else if (sec && location.pathname.indexOf(sec) === 0) cur = 'true';
      if (cur) a.setAttribute('aria-current', cur); else a.removeAttribute('aria-current');
    });
  }
  refreshCurrent();

  /* ---------- Ana sayfada bölüm izleme (Hizmetler / Projeler vurgusu) ---------- */
  (function spy() {
    if (canon(location.pathname) !== '/' || !('IntersectionObserver' in window)) return;
    var map = {};
    var seen = {};
    [].forEach.call(header.querySelectorAll('a[href^="/#"]'), function (a) {
      var id = a.getAttribute('href').slice(2);
      if (id && doc.getElementById(id)) (map[id] = map[id] || []).push(a);
    });
    var current = null;
    function mark(id) {
      current = id;
      [].forEach.call(header.querySelectorAll('a.is-active'), function (a) { a.classList.remove('is-active'); });
      (map[id] || []).forEach(function (a) { a.classList.add('is-active'); });
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) mark(en.target.id);
        else if (current === en.target.id) mark(null);
      });
    }, { rootMargin: '-35% 0px -60% 0px' });
    Object.keys(map).forEach(function (id) { if (!seen[id]) { seen[id] = 1; io.observe(doc.getElementById(id)); } });
  }());

  /* ---------- Yıl ---------- */
  var yr = new Date().getFullYear();
  if (yr >= 2026) [].forEach.call(doc.querySelectorAll('[data-vg-year]'), function (el) { el.textContent = yr; });

  /* ---------- Ana içeriğe geç: <base href> olan sayfalarda #main yanlış adrese gitmesin ---------- */
  var skip = doc.querySelector('.skip-to-content');
  if (skip) {
    skip.addEventListener('click', function (e) {
      var main = doc.getElementById('main');
      if (!main) return;
      e.preventDefault();
      main.focus({ preventScroll: true });
      main.scrollIntoView({ block: 'start' });
    });
  }

  /* ---------- Çapa (#bölüm) kaydırma ----------
     Ana sayfadaki bölümler content-visibility:auto kullanır: ekran dışındaki bölümler gerçek yükseklikleri
     yerine tahmini boyutla yer kaplar, bu yüzden uzak bir çapaya kayarken hedef konum kayabilir.
     scrollTo() hedefe kayar, hareket durunca (veya sayfa #bölüm ile açılınca) kayma varsa yeniden hizalar.
     Hedef çizgi, tarayıcının scrollIntoView'da kullandığı değerle aynıdır: kökün scroll-padding-top'ı
     (hizmet sayfalarında yapışkan sayfa içi menü dahil ~136px) + hedefin scroll-margin-top'ı. */
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  function cssPx(v, base) {
    var n = parseFloat(v);
    if (!isFinite(n)) return NaN;                          // 'auto' vb.
    return /%$/.test(String(v)) ? n * base / 100 : n;
  }
  function wantTop(el) {
    var pad = NaN, margin = 0;
    try {
      pad = cssPx(getComputedStyle(root).scrollPaddingTop, window.innerHeight);
      if (el) margin = cssPx(getComputedStyle(el).scrollMarginTop, 0) || 0;
    } catch (err) { /* eski tarayıcı */ }
    if (!(pad >= 0)) pad = header.getBoundingClientRect().height + 12;
    return pad + margin;
  }
  function hashTarget(h) {
    if (!h || h.length < 2) return null;
    try { return doc.getElementById(decodeURIComponent(h.slice(1))); } catch (err) { return null; }
  }
  /* Tek hizalama döngüsü: her yeni settle() (yeni çapa tıklaması) ve her kullanıcı kaydırma girişimi jetonu
     artırır; eski döngü bir sonraki adımında jetonun değiştiğini görüp durur. Böylece 1-4 sn içinde ikinci bir
     bağlantıya tıklandığında eski döngü sayfayı önceki hedefe geri çekmez. */
  var settleToken = 0;
  function cancelSettle() { settleToken++; }
  ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach(function (t) {
    window.addEventListener(t, cancelSettle, { passive: true, capture: true });
  });
  function settle(el) {
    var token = ++settleToken, last = -1, fixes = 0, t0 = Date.now();
    (function tick() {
      if (token !== settleToken || !el.isConnected) return;
      var y = window.pageYOffset;
      if (y === last) {                                    // hareket bitti (140 ms boyunca sabit)
        var off = el.getBoundingClientRect().top - wantTop(el);
        if (Math.abs(off) <= 6) return;
        var se = doc.scrollingElement || root;
        if (off > 0 && y >= se.scrollHeight - window.innerHeight - 1) return;   // sayfa sonu: daha fazla kayamaz
        if (++fixes > 6) return;
        el.scrollIntoView({ block: 'start', behavior: 'instant' });
        if (window.pageYOffset === y) return;              // tarayıcı zaten hizalı sayıyor: düzeltilecek bir şey yok
        last = -1;
      } else {
        last = y;                                          // yumuşak kaydırma sürüyor: bitmesini bekle
      }
      // Süre sınırı adım sayısı yerine zamana bağlı: yavaş cihazda uzun bir yumuşak kaydırma bitmeden döngü sonlanmasın.
      if (Date.now() - t0 < 10000) setTimeout(tick, 140);
    }());
  }
  var lastJump = null;                                     // { el, at }: en son scrollTo() hedefi
  function scrollToEl(target) {
    var el = typeof target === 'string' ? doc.getElementById(target.replace(/^#/, '')) : target;
    if (!el) return false;
    el.scrollIntoView({ block: 'start', behavior: reduceMQ.matches ? 'instant' : 'smooth' });
    settle(el);
    lastJump = { el: el, at: Date.now() };
    return true;
  }
  // Bağlantıyla gidilen bölüme odağı da taşı (klavye/ekran okuyucu kullanıcısı bölümün başından devam etsin).
  // Odaklanamayan hedefe tabindex="-1" eklenir; halka gösterilmez (css/vg-shell.css [data-vg-anchor-focus];
  // sayfa CSS'indeki daha özgül :focus-visible kuralları da halkayı çizmesin diye satır içi outline:none).
  function focusTarget(el) {
    if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) {
      el.setAttribute('tabindex', '-1');
      el.setAttribute('data-vg-anchor-focus', '');
      el.style.outline = 'none';
    }
    try { el.focus({ preventScroll: true }); } catch (err) { /* eski tarayıcı */ }
  }
  // Aynı sayfadaki /#bölüm bağlantıları (başlık, alt bilgi, içerik): geçmişe ekle, kaydır, hizala, odağı taşı
  doc.addEventListener('click', function (e) {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href*="#"]') : null;
    if (!a || (a.target && a.target !== '_self')) return;
    var u;
    try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (u.origin !== location.origin || u.hash.length < 2 || canon(u.pathname) !== canon(location.pathname)) return;
    var el = hashTarget(u.hash);
    if (!el) return;
    if (e.defaultPrevented) {
      // Bağlantıyı başka bir betik (ör. js/main.js) VGShell.scrollTo ile kaydırdıysa yalnızca odağı taşı.
      if (lastJump && lastJump.el === el && Date.now() - lastJump.at < 250) focusTarget(el);
      return;
    }
    e.preventDefault();
    if (location.hash !== u.hash) { try { history.pushState(null, '', u.pathname + u.search + u.hash); } catch (err) { /* no-op */ } }
    if (el.tagName === 'DETAILS' && !el.open) el.open = true;   // pushState hashchange tetiklemez
    scrollToEl(el);
    focusTarget(el);
  });
  // Sayfa #bölüm ile açıldıysa (başka sayfadan gelen /#hizmetler gibi): yükleme bitince kaymayı düzelt
  window.addEventListener('load', function () { var el = hashTarget(location.hash); if (el) settle(el); }, { once: true });

  /* ---------- Speculation Rules desteklenmeyen tarayıcılar için hover/dokunma prefetch yedeği ---------- */
  var specOk = window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules');
  if (!specOk) {
    var done = {};
    var pf = function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      var u;
      try { u = new URL(a.href, location.href); } catch (err) { return; }
      if (u.origin !== location.origin || u.pathname === location.pathname || done[u.pathname]) return;
      if (/^\/(hesap\/|calisan(?:\/|$)|api\/|contact\.php)/.test(u.pathname) || /\.(pdf|php|zip|mp4)$/i.test(u.pathname)) return;
      done[u.pathname] = 1;
      var l = doc.createElement('link');
      l.rel = 'prefetch';
      l.href = u.pathname + u.search;
      doc.head.appendChild(l);
    };
    ['mouseover', 'touchstart', 'focusin'].forEach(function (t) { doc.addEventListener(t, pf, { passive: true, capture: true }); });
  }

  /* ---------- Alt bilgi animasyonlarını görünmezken duraklat (ana iş parçacığı yükü) ---------- */
  (function footerPause() {
    var footer = doc.getElementById('vgFooter');
    if (!footer) return;
    var svgs = [].slice.call(footer.querySelectorAll('svg.sig-trace'));
    function set(on) {
      footer.classList.toggle('is-inview', on);
      svgs.forEach(function (s) {
        try { if (on && !reduceMQ.matches) s.unpauseAnimations(); else s.pauseAnimations(); } catch (err) { /* SMIL yok */ }
      });
    }
    if (!('IntersectionObserver' in window)) { set(true); return; }
    set(false);
    new IntersectionObserver(function (entries) {
      set(entries[entries.length - 1].isIntersecting);
    }, { rootMargin: '200px 0px' }).observe(footer);
  }());

  /* ---------- Service worker: tüm sayfalarda kayıt (çevrimdışı destek, ağ-öncelikli; bkz. /sw.js) ---------- */
  if ('serviceWorker' in navigator) {
    var regSW = function () { navigator.serviceWorker.register('/sw.js').catch(function () { /* no-op */ }); };
    if (doc.readyState === 'complete') regSW();
    else window.addEventListener('load', regSW, { once: true });
  }

  window.VGShell = { header: header, close: closeAll, refreshCurrent: refreshCurrent, scrollTo: scrollToEl, version: 1 };
  try { doc.dispatchEvent(new CustomEvent('vg:shell-ready')); } catch (err) { /* eski tarayıcı */ }
}());
