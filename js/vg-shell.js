/*!
 * VoltGuard – vg-shell.js
 * Ortak site başlığı (#vgHeader) davranışı: mobil menü, "Kaynaklar" açılır menüsü, kaydırma gölgesi,
 * Esc / dışarı tıklama / klavye gezinmesi, aria-current senkronu, çapa hizalama, yıl, prefetch yedeği.
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
  var desktopMQ = window.matchMedia('(min-width: 68.75rem)');
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
     scrollTo() hedefe kayar, hareket durunca (veya sayfa #bölüm ile açılınca) kayma varsa yeniden hizalar. */
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  function wantTop() { return header.getBoundingClientRect().height + 12; }
  function hashTarget(h) {
    if (!h || h.length < 2) return null;
    try { return doc.getElementById(decodeURIComponent(h.slice(1))); } catch (err) { return null; }
  }
  function settle(el) {
    var last = -1, n = 0, stop = false, evs = ['wheel', 'touchstart', 'keydown'];
    function cancel() { stop = true; }
    evs.forEach(function (t) { window.addEventListener(t, cancel, { once: true, passive: true }); });
    (function tick() {
      if (stop) return;
      var y = window.pageYOffset;
      if (y === last) {
        if (Math.abs(el.getBoundingClientRect().top - wantTop()) <= 6) { done(); return; }
        el.scrollIntoView({ block: 'start', behavior: 'instant' });
        last = -1;
      } else {
        last = y;
      }
      if (++n < 30) setTimeout(tick, 140); else done();
    }());
    function done() { evs.forEach(function (t) { window.removeEventListener(t, cancel); }); }
  }
  function scrollToEl(target) {
    var el = typeof target === 'string' ? doc.getElementById(target.replace(/^#/, '')) : target;
    if (!el) return false;
    el.scrollIntoView({ block: 'start', behavior: reduceMQ.matches ? 'instant' : 'smooth' });
    settle(el);
    return true;
  }
  // Bağlantıyla gidilen bölüme odağı da taşı (klavye/ekran okuyucu kullanıcısı bölümün başından devam etsin).
  // Odaklanamayan hedefe tabindex="-1" eklenir; halka gösterilmez (css/vg-shell.css [data-vg-anchor-focus]).
  function focusTarget(el) {
    if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) {
      el.setAttribute('tabindex', '-1');
      el.setAttribute('data-vg-anchor-focus', '');
    }
    try { el.focus({ preventScroll: true }); } catch (err) { /* eski tarayıcı */ }
  }
  // Aynı sayfadaki /#bölüm bağlantıları (başlık, alt bilgi, içerik): geçmişe ekle, kaydır, hizala, odağı taşı
  doc.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href*="#"]') : null;
    if (!a || (a.target && a.target !== '_self')) return;
    var u;
    try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (u.origin !== location.origin || u.hash.length < 2 || canon(u.pathname) !== canon(location.pathname)) return;
    var el = hashTarget(u.hash);
    if (!el) return;
    e.preventDefault();
    if (location.hash !== u.hash) { try { history.pushState(null, '', u.pathname + u.search + u.hash); } catch (err) { /* no-op */ } }
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
      if (/^\/(hesap\/|contact\.php)/.test(u.pathname) || /\.(pdf|php|zip|mp4)$/i.test(u.pathname)) return;
      done[u.pathname] = 1;
      var l = doc.createElement('link');
      l.rel = 'prefetch';
      l.href = u.pathname + u.search;
      doc.head.appendChild(l);
    };
    ['mouseover', 'touchstart', 'focusin'].forEach(function (t) { doc.addEventListener(t, pf, { passive: true, capture: true }); });
  }

  window.VGShell = { header: header, close: closeAll, refreshCurrent: refreshCurrent, scrollTo: scrollToEl, version: 1 };
  try { doc.dispatchEvent(new CustomEvent('vg:shell-ready')); } catch (err) { /* eski tarayıcı */ }
}());
