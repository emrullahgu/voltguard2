/*!
 * VoltGuard – vg-engage.js
 * Geri dönüş bileşeni: "Günün teknik bilgisi" (sözlük, her gün), "Haftanın simülasyonu" (VoltSim, her hafta),
 * "Haftanın mühendislik sorusu" (her hafta) ve "Popüler / Öne çıkan araçlar".
 * Veri: js/vg-engage-data.js (node tools/build-engage.cjs). Seçim tarihe göre belirlenir (Türkiye saati); rastgele değildir.
 * "Popüler" yalnızca api/metrics.php gerçek kullanım verisi döndürürse yazılır; yoksa elle seçilmiş "Öne çıkan araçlar".
 * Kullanım: <section data-vg-engage></section> + bu iki betik (defer). Çerez veya kalıcı depolama kullanmaz.
 */
(function (w, d) {
  'use strict';

  function istanbulDate(now) {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
    } catch (e) { /* eski tarayıcı */ }
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  /** Tarih → { day: gün sırası, week: Pazartesi başlayan hafta sırası }. 1970-01-01 Perşembedir. */
  function index(dateStr) {
    var p = dateStr.split('-').map(Number);
    var day = Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 864e5);
    return { day: day, week: Math.floor((day + 3) / 7) };
  }
  function pick(data, dateStr) {
    var i = index(dateStr);
    var mod = function (n, len) { return ((n % len) + len) % len; };
    return {
      term: data.terms.length ? data.terms[mod(i.day, data.terms.length)] : null,
      sim: data.sims.length ? data.sims[mod(i.week, data.sims.length)] : null,
      question: data.questions.length ? data.questions[mod(i.week, data.questions.length)] : null
    };
  }
  w.VGEngage = { pick: pick, index: index, istanbulDate: istanbulDate };

  var data = w.VG_ENGAGE_DATA;
  var roots = d.querySelectorAll ? d.querySelectorAll('[data-vg-engage]') : [];
  if (!data || !roots.length) return;

  var CSS = '.vg-eng{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));margin:0}' +
    '.vg-eng__card{background:var(--th-surface,#fff);border:1px solid var(--clr-border,#e2e8f0);border-radius:14px;padding:1.15rem 1.2rem;display:flex;flex-direction:column;gap:.55rem;min-width:0}' +
    '.vg-eng__k{font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--clr-accent-text,#b45309);margin:0}' +
    '.vg-eng__t{font-size:1.05rem;font-weight:700;color:var(--th-heading,#0a1628);margin:0;line-height:1.35}' +
    '.vg-eng__p{font-size:.9rem;line-height:1.6;color:var(--th-text-2,#334155);margin:0}' +
    '.vg-eng__a{font-weight:600;color:var(--th-blue-ink,#1d4ed8);text-decoration:none;margin-top:auto}.vg-eng__a:hover{text-decoration:underline}' +
    '.vg-eng fieldset{border:0;margin:0;padding:0;display:grid;gap:.4rem}.vg-eng legend{font-size:.92rem;font-weight:600;color:var(--th-heading,#0a1628);line-height:1.5;margin-bottom:.35rem;padding:0}' +
    '.vg-eng label{display:flex;gap:.5rem;align-items:flex-start;font-size:.88rem;line-height:1.45;padding:.45rem .55rem;border:1px solid var(--th-border,#e2e8f0);border-radius:8px;cursor:pointer}' +
    '.vg-eng label:has(input:checked){border-color:var(--th-blue-ink,#1d4ed8);background:var(--th-tint-blue,#eff6ff)}.vg-eng input[type=radio]{margin-top:.2rem;flex:none}' +
    '.vg-eng label.is-right{border-color:#16a34a;background:var(--th-tint-green,#f0fdf4)}.vg-eng label.is-wrong{border-color:#dc2626;background:var(--th-tint-red,#fef2f2)}' +
    '.vg-eng__btn{align-self:flex-start;font:inherit;font-size:.88rem;font-weight:600;padding:.5rem 1rem;min-height:40px;border-radius:999px;border:0;background:#0a1628;color:#fff;box-shadow:inset 0 0 0 1px var(--th-border-strong,transparent);cursor:pointer}' +
    '.vg-eng__btn:focus-visible,.vg-eng label:focus-within{outline:3px solid rgba(59,130,246,.45);outline-offset:2px}' +
    '.vg-eng__fb{font-size:.88rem;line-height:1.55;margin:0}.vg-eng__fb strong{display:block}' +
    '.vg-eng__list{list-style:none;margin:0;padding:0;display:grid;gap:.35rem}.vg-eng__list a{display:flex;gap:.5rem;align-items:baseline;color:var(--th-heading,#0a1628);text-decoration:none;font-size:.9rem;padding:.35rem 0;border-bottom:1px solid var(--th-border,#f1f5f9)}' +
    '.vg-eng__list a:hover{color:var(--th-blue-ink,#1d4ed8)}.vg-eng__n{font-variant-numeric:tabular-nums;color:var(--clr-text-muted,#5b6b7c);font-size:.8rem;min-width:1.2rem}.vg-eng__note{font-size:.76rem;color:var(--clr-text-muted,#64748b);margin:0}';
  if (!d.getElementById('vg-engage-css')) {
    var st = d.createElement('style'); st.id = 'vg-engage-css'; st.textContent = CSS; d.head.appendChild(st);
  }

  function el(tag, cls, text) { var n = d.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function link(href, text, cls) { var a = el('a', cls || 'vg-eng__a', text); a.href = href; return a; }
  function card(kicker, title) {
    var c = el('article', 'vg-eng__card');
    c.appendChild(el('p', 'vg-eng__k', kicker));
    if (title) c.appendChild(el('h3', 'vg-eng__t', title));
    return c;
  }

  function termCard(t) {
    var c = card('Günün teknik bilgisi', t.term);
    c.appendChild(el('p', 'vg-eng__p', t.def));
    c.appendChild(link(t.url, 'Sözlükte oku →'));
    return c;
  }
  function simCard(s) {
    var c = card('Haftanın simülasyonu', s.name);
    c.appendChild(el('p', 'vg-eng__p', s.desc));
    c.appendChild(link(s.url, 'Simülasyonu aç →'));
    return c;
  }
  var quizSeq = 0;
  function quizCard(q) {
    var c = card('Haftanın mühendislik sorusu');
    var id = 'vg-eng-q' + (++quizSeq);
    var fs = el('fieldset'); var lg = el('legend', '', q.q); fs.appendChild(lg);
    q.o.forEach(function (opt, i) {
      var lab = el('label'); var inp = el('input'); inp.type = 'radio'; inp.name = id; inp.value = String(i);
      lab.appendChild(inp); lab.appendChild(d.createTextNode(opt)); fs.appendChild(lab);
    });
    var btn = el('button', 'vg-eng__btn', 'Cevabı kontrol et'); btn.type = 'button';
    var fb = el('p', 'vg-eng__fb'); fb.setAttribute('role', 'status'); fb.setAttribute('aria-live', 'polite');
    btn.addEventListener('click', function () {
      var chosen = fs.querySelector('input:checked');
      if (!chosen) { fb.textContent = 'Önce bir seçenek işaretleyin.'; return; }
      var labels = fs.querySelectorAll('label');
      for (var i = 0; i < labels.length; i++) labels[i].classList.remove('is-right', 'is-wrong');
      var right = Number(chosen.value) === q.a;
      labels[q.a].classList.add('is-right');
      if (!right) chosen.parentNode.classList.add('is-wrong');
      fb.textContent = '';
      fb.appendChild(el('strong', '', right ? 'Doğru!' : 'Doğru cevap: ' + q.o[q.a]));
      fb.appendChild(d.createTextNode(q.e + ' '));
      fb.appendChild(link(q.src[0], 'Kaynak: ' + q.src[1], ''));
    });
    c.appendChild(fs); c.appendChild(btn); c.appendChild(fb);
    return c;
  }
  function toolsCard(items, popular) {
    var c = card(popular ? 'Popüler araçlar' : 'Öne çıkan araçlar', popular ? 'Son 30 günde en çok kullanılanlar' : 'Ücretsiz mühendislik araçları');
    var ol = el('ol', 'vg-eng__list');
    items.forEach(function (t, i) {
      var li = el('li'); var a = link(t.url, '', ''); a.appendChild(el('span', 'vg-eng__n', String(i + 1))); a.appendChild(d.createTextNode(t.name));
      li.appendChild(a); ol.appendChild(li);
    });
    c.appendChild(ol);
    if (popular) c.appendChild(el('p', 'vg-eng__note', 'Sıralama çerezsiz, anonim kullanım sayımlarından gelir.'));
    c.appendChild(link('/hesaplama-araclari/', 'Tüm hesap araçları →'));
    return c;
  }

  var bySlug = {}; data.tools.forEach(function (t) { bySlug[t.slug] = t; });
  var simById = {}; data.sims.forEach(function (s) { simById[s.id] = s; });
  function featured() { return data.featured.map(function (s) { return bySlug[s]; }).filter(Boolean).slice(0, 6); }
  function mapPopular(items) {
    return (items || []).map(function (it) {
      var slug = String(it.slug || '');
      if (bySlug[slug]) return bySlug[slug];
      var m = slug.match(/^sim-([a-z0-9-]+)$/);
      if (m && simById[m[1]]) return { url: simById[m[1]].url, name: 'VoltSim · ' + simById[m[1]].name };
      return null;
    }).filter(Boolean).slice(0, 6);
  }

  var today = pick(data, istanbulDate(new Date()));
  Array.prototype.forEach.call(roots, function (root) {
    var grid = el('div', 'vg-eng');
    var parts = (root.getAttribute('data-vg-engage') || 'term,sim,quiz,tools').split(',');
    var toolsSlot = null;
    parts.forEach(function (p) {
      p = p.trim();
      if (p === 'term' && today.term) grid.appendChild(termCard(today.term));
      else if (p === 'sim' && today.sim) grid.appendChild(simCard(today.sim));
      else if (p === 'quiz' && today.question) grid.appendChild(quizCard(today.question));
      else if (p === 'tools') { toolsSlot = toolsCard(featured(), false); grid.appendChild(toolsSlot); }
    });
    root.textContent = '';
    root.appendChild(grid);
    if (toolsSlot && /^https?:$/.test(w.location.protocol) && !/\.netlify\.app$/i.test(w.location.hostname) && w.fetch) {
      w.fetch('/api/metrics.php?action=popular', { credentials: 'omit', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var list = j && j.ok ? mapPopular(j.items) : [];
          if (list.length >= 3 && toolsSlot.parentNode) {
            var fresh = toolsCard(list, true);
            toolsSlot.parentNode.replaceChild(fresh, toolsSlot);
            toolsSlot = fresh;
          }
        })
        .catch(function () { /* ölçüm API'si yok: öne çıkan liste kalır */ });
    }
  });
}(window, document));
