/* VoltGuard site içi arama. Dizin: js/search-index.js (tools/build-search-index.cjs üretir).
 * Türkçe karakter ve büyük/küçük harf farkı gözetilmez; tüm sözcükler eşleşmeli (VE). Sözcük başı eşleşmesi
 * öne alınır; "topraklamanın" gibi ekli uzun sorgular eşleşme bulunana kadar sondan kısaltılır (en az 5 harf).
 * Tarayıcıda #site-search formunu çalıştırır; Node'da { fold, search } dışa aktarılır (birim testleri). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VGSiteSearch = api; api.mount(root.document); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MAP = { 'ı': 'i', 'i̇': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u', 'φ': 'f' };
  function fold(s) {
    return String(s || '').toLocaleLowerCase('tr').replace(/i̇|[ışğüöçâîûφ]/g, function (c) { return MAP[c]; });
  }
  var FIELDS = [['t', 12], ['h', 8], ['k', 5], ['d', 3], ['b', 1]];
  var STOP = { 've': 1, 'ile': 1, 'icin': 1, 'bir': 1, 'nedir': 1, 'nasil': 1, 'mi': 1, 'mu': 1, 'da': 1, 'de': 1, 'kac': 1, 'olmali': 1, 'hesaplama': 0 };

  var prepared = null;
  function prepare(index) {
    if (prepared && prepared.src === index) return prepared.items;
    var items = index.map(function (it) {
      var f = {}; FIELDS.forEach(function (p) { f[p[0]] = ' ' + fold(it[p[0]]) + ' '; });
      return { it: it, f: f };
    });
    prepared = { src: index, items: items };
    return items;
  }
  // Bir sözcüğün alandaki en iyi eşleşmesi: 2 = sözcük başı, 1 = sözcük içi, 0 = yok
  function hit(hay, w) {
    var i = hay.indexOf(w);
    if (i < 0) return 0;
    var re = new RegExp('[^a-z0-9]' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return re.test(hay) ? 2 : 1;
  }
  function scoreWord(p, w) {
    var s = 0;
    FIELDS.forEach(function (f) { var h = hit(p.f[f[0]], w); if (h) s += f[1] * (h === 2 ? 1 : 0.4); });
    return s;
  }
  function search(index, query, limit) {
    var q = fold(query).replace(/[^a-z0-9.,%/+\- ]+/g, ' ').trim();
    if (!q) return [];
    var words = q.split(/\s+/).filter(function (w) { return w.length > 1 && !STOP[w]; });
    if (!words.length) words = q.split(/\s+/);
    var items = prepare(index), out = [];
    items.forEach(function (p) {
      var total = 0, used = [];
      for (var i = 0; i < words.length; i++) {
        var w = words[i], s = scoreWord(p, w);
        // Türkçe ekleri tolere et: uzun sözcüklerde sondan kısalt (kısa kökler başka sözcüklere karışır)
        if (w.length >= 7) while (!s && w.length > 5) { w = w.slice(0, -1); s = scoreWord(p, w) * 0.8; }
        if (!s) return;
        total += s; used.push(w);
      }
      if (words.length > 1 && p.f.t.indexOf(' ' + words.join(' ')) !== -1) total += 15; // başlıkta tam ifade
      if (p.it.s === 'Sözlük' && p.f.t.indexOf(' ' + words[0]) === 1) total += 6;
      out.push({ item: p.it, score: total, words: used });
    });
    out.sort(function (a, b) { return b.score - a.score || a.item.t.localeCompare(b.item.t, 'tr'); });
    return limit ? out.slice(0, limit) : out;
  }

  // ---------- Arayüz ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Katlanmış metindeki eşleşme konumları özgün metinle aynı uzunluktadır (tek karakter → tek karakter)
  function mark(text, words) {
    var f = fold(text), ranges = [];
    words.forEach(function (w) { var i = 0; while ((i = f.indexOf(w, i)) !== -1) { ranges.push([i, i + w.length]); i += w.length; } });
    if (!ranges.length || f.length !== text.length) return esc(text);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var html = '', pos = 0;
    ranges.forEach(function (r) { if (r[0] < pos) return; html += esc(text.slice(pos, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + '</mark>'; pos = r[1]; });
    return html + esc(text.slice(pos));
  }
  function snippet(it, words) {
    var src = [it.d, it.b, it.k].filter(Boolean), best = src[0] || '';
    for (var i = 0; i < src.length; i++) {
      var f = fold(src[i]), at = -1;
      for (var j = 0; j < words.length && at < 0; j++) at = f.indexOf(words[j]);
      if (at >= 0) {
        if (src[i].length <= 220) return src[i];
        var start = Math.max(0, src[i].lastIndexOf(' ', Math.max(0, at - 60)));
        return (start > 0 ? '… ' : '') + src[i].slice(start, start + 220).trim() + (start + 220 < src[i].length ? ' …' : '');
      }
    }
    return best.length > 220 ? best.slice(0, 220).replace(/\s+\S*$/, '') + ' …' : best;
  }
  function mount(doc) {
    var form = doc && doc.getElementById('site-search');
    if (!form) return;
    var input = form.querySelector('input[name="q"]'), list = doc.getElementById('ss-results'), status = doc.getElementById('ss-status'), tips = doc.getElementById('ss-tips');
    var index = (typeof window !== 'undefined' && window.VG_SEARCH_INDEX) || [];
    var PAGE = 20, shown = PAGE, last = [];
    function render(q, push) {
      last = search(index, q); shown = PAGE;
      draw(q);
      if (push !== false && typeof history !== 'undefined' && history.replaceState) {
        var url = q ? '?q=' + encodeURIComponent(q) : location.pathname;
        history.replaceState(null, '', url);
      }
      doc.title = (q ? '“' + q + '” araması' : 'Sitede Ara') + ' | VoltGuard';
    }
    function draw(q) {
      tips.hidden = !!q;
      if (!q) { list.innerHTML = ''; status.textContent = ''; return; }
      status.textContent = last.length ? '“' + q + '” için ' + last.length + ' sonuç' : '“' + q + '” için sonuç bulunamadı. Daha kısa ya da farklı bir sözcük deneyin.';
      list.innerHTML = last.slice(0, shown).map(function (r) {
        var it = r.item;
        return '<li class="ss-item"><a class="ss-link" href="' + esc(it.u) + '"><span class="ss-tag">' + esc(it.s) + '</span>' +
          '<span class="ss-title">' + mark(it.t, r.words) + '</span></a>' +
          '<p class="ss-snip">' + mark(snippet(it, r.words), r.words) + '</p><span class="ss-url">voltguard.com.tr' + esc(it.u) + '</span></li>';
      }).join('') + (last.length > shown ? '<li class="ss-more"><button type="button" id="ss-more">Daha fazla sonuç (' + (last.length - shown) + ')</button></li>' : '');
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); render(input.value.trim()); });
    var t = null;
    input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { render(input.value.trim()); }, 120); });
    list.addEventListener('click', function (e) {
      if (e.target.id === 'ss-more') { shown += PAGE; draw(input.value.trim()); var items = list.querySelectorAll('.ss-link'); if (items[shown - PAGE]) items[shown - PAGE].focus(); }
    });
    tips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]'); if (!b) return;
      input.value = b.getAttribute('data-q'); render(input.value); input.focus();
    });
    var q0 = new URLSearchParams(location.search).get('q') || '';
    input.value = q0;
    render(q0.trim(), false);
    if (!q0) input.focus();
  }
  return { fold: fold, search: search, mount: mount };
});
