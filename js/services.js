/* VoltGuard – services.js
   /hizmetler/ sayfalari icin kucuk, bagimliliksiz davranislar. Sablon: tools/templates/service-page.html
   1) [data-reveal] / [data-reveal="group"]  kaydirinca gorunur olma (prefers-reduced-motion'a uyar)
   2) .svc-steps                             zaman cizelgesi ilerleme cizgisi + aktif adim
   3) .svc-toc                               sayfa ici menude gecerli bolumu isaretleme
   4) .svc-faq details                       #capa ile acma (or. /hizmetler/x.html#sss-ucret)
   5) [data-count]                           yalnizca GERCEK sayilar icin sayac (metin zaten nihai deger)
   6) tel: / wa.me / [data-vg-teklif]        window.dataLayer varsa olay; teklif tiklamasinda hizmet
                                             adi sessionStorage 'vgServiceInterest' anahtarina yazilir */
(function () {
  'use strict';
  var d = document, root = d.documentElement, w = window;
  w.__svcReady = true;
  var reduce = !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var hasIO = 'IntersectionObserver' in w;
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };

  /* 1) Reveal */
  var revealEls = d.querySelectorAll('[data-reveal]');
  each(d.querySelectorAll('[data-reveal="group"]'), function (g) {
    each(g.children, function (c, i) { c.style.setProperty('--i', Math.min(i, 8)); });
  });
  if (reduce || !hasIO) {
    root.classList.add('svc-noanim');
  } else {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); ro.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    each(revealEls, function (el) { ro.observe(el); });
  }

  /* 2) Zaman cizelgesi */
  var lists = d.querySelectorAll('.svc-steps');
  if (lists.length && !reduce) {
    var visible = [];
    var update = function () {
      var vh = w.innerHeight || root.clientHeight, line = vh * 0.62;
      each(lists, function (ol) {
        var r = ol.getBoundingClientRect();
        var row = ol.classList.contains('svc-steps--row') && w.innerWidth >= 1024;
        var p = row ? (r.top < line ? 1 : 0) : (line - r.top) / Math.max(r.height, 1);
        ol.style.setProperty('--svc-progress', Math.max(0, Math.min(1, p)).toFixed(3));
        each(ol.querySelectorAll('.svc-step'), function (li) {
          li.classList.toggle('is-active', row ? r.top < line : li.getBoundingClientRect().top < line);
        });
      });
    };
    var ticking = false;
    var onScroll = function () {
      if (ticking || !visible.length) return;
      ticking = true;
      w.requestAnimationFrame(function () { ticking = false; update(); });
    };
    each(lists, function (ol) { ol.classList.add('is-live'); });
    if (hasIO) {
      var so = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          var i = visible.indexOf(e.target);
          if (e.isIntersecting && i < 0) visible.push(e.target);
          if (!e.isIntersecting && i > -1) visible.splice(i, 1);
        });
        update();
      });
      each(lists, function (ol) { so.observe(ol); });
    } else { visible = [1]; }
    w.addEventListener('scroll', onScroll, { passive: true });
    w.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* 3) Sayfa ici menu: gecerli bolum */
  var toc = d.querySelector('.svc-toc');
  if (toc && hasIO) {
    var links = toc.querySelectorAll('a[href^="#"]');
    var map = {};
    each(links, function (a) {
      var s = d.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
      if (s) map[s.id] = a;
    });
    var current = null;
    var setCurrent = function (a) {
      if (a === current) return;
      if (current) current.removeAttribute('aria-current');
      current = a;
      if (!a) return;
      a.setAttribute('aria-current', 'true');
      var ul = a.closest('ul');
      if (ul && ul.scrollWidth > ul.clientWidth) {
        var x = a.offsetLeft - (ul.clientWidth - a.offsetWidth) / 2;
        ul.scrollTo({ left: Math.max(0, x), behavior: reduce ? 'auto' : 'smooth' });
      }
    };
    var to = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting && map[e.target.id]) setCurrent(map[e.target.id]); });
    }, { rootMargin: '-30% 0px -60% 0px' });
    Object.keys(map).forEach(function (id) { to.observe(d.getElementById(id)); });
  }

  /* 4) SSS: capa ile ac */
  var openFromHash = function () {
    var id = decodeURIComponent((w.location.hash || '').slice(1));
    if (!id) return;
    var el = d.getElementById(id);
    if (el && el.tagName === 'DETAILS') { el.open = true; }
  };
  openFromHash();
  w.addEventListener('hashchange', openFromHash);

  /* 5) Sayaclar (yalnizca gercek sayilar) */
  var counters = d.querySelectorAll('[data-count]');
  if (counters.length && hasIO && !reduce) {
    var fmt = function (n) { return Math.round(n).toLocaleString('tr-TR'); };
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        co.unobserve(e.target);
        var el = e.target, end = parseFloat(el.getAttribute('data-count')), t0 = null, dur = 900;
        if (!isFinite(end)) return;
        var step = function (t) {
          if (t0 === null) t0 = t;
          var k = Math.min(1, (t - t0) / dur);
          el.textContent = fmt(end * (1 - Math.pow(1 - k, 3)));
          if (k < 1) w.requestAnimationFrame(step); else el.textContent = fmt(end);
        };
        el.textContent = '0';
        w.requestAnimationFrame(step);
      });
    }, { threshold: 0.6 });
    each(counters, function (el) { co.observe(el); });
  }

  /* 6) Olcum kancalari (analitik yoksa hicbir sey gondermez) */
  var service = (d.body && d.body.getAttribute('data-service')) || '';
  d.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href') || '', name = null;
    if (href.indexOf('tel:') === 0) name = 'click_to_call';
    else if (href.indexOf('wa.me/') > -1) name = 'whatsapp_click';
    else if (a.hasAttribute('data-vg-teklif')) {
      name = 'quote_cta_click';
      try { if (service) w.sessionStorage.setItem('vgServiceInterest', service); } catch (e) { /* depolama kapali */ }
    }
    if (name && w.dataLayer && typeof w.dataLayer.push === 'function') {
      w.dataLayer.push({ event: name, service: service, page_path: w.location.pathname });
    }
  });
})();
