/* =====================================================
   VoltGuard Tools — shared toolbar for calculator pages
   Auto-detects .mini-calc structure and injects:
   - Save to account (guests: this browser; merged into the account on login)
   - Toggle favorite (synced to the account when logged in)
   - Share (Web Share API or copy link)
   - Export as PDF (via jsPDF loaded on demand; Turkish letters and
     engineering symbols are transliterated, see pdfText)
   Inputs inside a [hidden] container are not listed; the result's
   .calc-breakdown lines (if any) go into the PDF and the saved record.
   Also draws a consistent "VoltGuard Tools" brand banner.
   ===================================================== */
(function (global) {
  'use strict';

  var JSPDF_URL = '/js/vendor/jspdf.umd.min.js?v=4.2.1';

  function q(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qq(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function toolSlug() {
    var m = location.pathname.match(/\/hesaplama\/([^/]+?)(?:\.html|\/)?$/);
    return m ? m[1] : null;
  }
  function toolUrl() {
    // Prefer canonical when defined for consistent share links.
    var c = q('link[rel="canonical"]');
    return c && c.href ? c.href : location.href;
  }
  function toolName() {
    var h1 = q('main h1');
    return h1 ? h1.textContent.trim() : document.title;
  }

  // Gizlenen alanlar (ör. bina tipi seçili değilken fider alanları) hesaba katılmadığı için listelenmez.
  function fieldVisible(el) {
    return el.type !== 'hidden' && !el.disabled && !el.closest('[hidden]');
  }

  function readInputs(rootSelector) {
    var root = q(rootSelector || '.mini-calc, .tool-fields, .tool-card');
    if (!root) return [];
    return qq('input, select', root).filter(fieldVisible).map(function (el) {
      var lbl = null;
      if (el.id) { var l = q('label[for="' + el.id + '"]'); if (l) lbl = l.textContent.trim(); }
      if (!lbl) { var parent = el.closest('.mini-calc__field, .tool-field'); if (parent) { var pl = q('label', parent); if (pl) lbl = pl.textContent.trim(); } }
      var val = el.value;
      if (el.tagName === 'SELECT' && el.selectedOptions[0]) val = el.selectedOptions[0].textContent.trim() + ' (' + el.value + ')';
      return { label: lbl || el.name || el.id || '?', value: val };
    });
  }

  function cleanLine(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }

  // Sonuç kutusundaki .calc-breakdown satırları "Etiket: Değer" metni olarak okunur (en fazla 20 satır).
  function readBreakdown(scope) {
    return qq('.calc-breakdown li', scope).filter(function (li) { return !li.closest('[hidden]'); }).map(function (li) {
      var parts = qq('span', li).map(function (sp) { return cleanLine(sp.textContent); }).filter(Boolean);
      return parts.length ? parts.join(': ') : cleanLine(li.textContent);
    }).filter(Boolean).slice(0, 20);
  }

  function readResult() {
    var v = q('.mini-calc__result-value, .tool-result__amount');
    var n = q('.mini-calc__result-note, .tool-result__detail');
    var box = v && v.closest('.mini-calc__result, .tool-result');
    var as = q('.calc-assumptions');
    return {
      value: v ? v.textContent.trim() : '',
      note: n ? n.textContent.trim() : '',
      breakdown: readBreakdown(box || q('.mini-calc') || document),
      // Formül, kabuller ve mevzuat/standart dayanağı (hesaplama/*.html sayfalarında sonuçla birlikte yazılır).
      assumptions: as && !as.closest('[hidden]') ? cleanLine(as.textContent.replace(/^Formül, kabuller ve dayanak/, '')) : ''
    };
  }

  var jsPdfPromise = null;
  function ensureJsPdf() {
    if (global.jspdf && global.jspdf.jsPDF) return Promise.resolve(global.jspdf.jsPDF);
    if (jsPdfPromise) return jsPdfPromise;
    jsPdfPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = JSPDF_URL;
      var done = false;
      var timer = setTimeout(fail, 15000);
      function fail() {
        if (done) return;
        done = true; clearTimeout(timer); jsPdfPromise = null; s.remove();
        reject(new Error('PDF kütüphanesi yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.'));
      }
      s.onload = function () {
        if (done) return;
        if (global.jspdf && global.jspdf.jsPDF) { done = true; clearTimeout(timer); resolve(global.jspdf.jsPDF); return; }
        fail();
      };
      s.onerror = fail;
      document.head.appendChild(s);
    });
    return jsPdfPromise;
  }

  // jsPDF'in yerleşik yazı tipleri (WinAnsi) ğ ş ı İ Ş Ğ harflerini ve mühendislik simgelerini
  // (Ω, φ, ≈, ≤ ...) taşımaz; bunlar PDF'e yazılmadan önce güvenli ASCII karşılıklarına çevrilir.
  var PDF_CHAR_MAP = {
    '\u0131': 'i', '\u0130': 'I', '\u015f': 's', '\u015e': 'S', '\u011f': 'g', '\u011e': 'G',
    '\u00e7': 'c', '\u00c7': 'C', '\u00f6': 'o', '\u00d6': 'O', '\u00fc': 'u', '\u00dc': 'U',
    '\u20ba': 'TL', '\u20ac': 'EUR',
    '\u03a9': 'ohm', '\u2126': 'ohm', '\u03c6': 'phi', '\u03a6': 'Phi', '\u03b7': 'eta', '\u03c1': 'rho',
    '\u03c0': 'pi', '\u0394': 'delta', '\u03bc': 'u',
    '\u03b8': 'theta', '\u03b1': 'alpha', '\u03ba': 'kappa', '\u03b2': 'beta', '\u03a3': 'Sum', '\u2032': "'", '\u2033': '"',
    '\u2248': '~', '\u2264': '<=', '\u2265': '>=', '\u2260': '!=', '\u221a': 'sqrt', '\u221e': 'inf', '\u2212': '-',
    '\u2192': '->', '\u2190': '<-', '\u2194': '<->',
    '\u2022': '-', '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2026': '...'
  };
  function pdfText(text) {
    var out = String(text == null ? '' : text)
      .replace(/[\u2080-\u2089]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x2080 + 48); })
      .replace(/[^\x00-\x7F]/g, function (c) { return Object.prototype.hasOwnProperty.call(PDF_CHAR_MAP, c) ? PDF_CHAR_MAP[c] : c; });
    if (out.normalize) out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return out.replace(/[^\x00-\xFF]/g, '?');
  }
  function pdfSlug(text) {
    return pdfText(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  async function exportPdf(name) {
    var jsPDF = await ensureJsPdf();
    var doc = new jsPDF({ unit: 'mm', format: 'a4' });
    var margin = 15;
    var width = 210 - 2 * margin;
    var title = name || toolName();
    var y = margin;
    function ensureSpace(height) {
      if (y + height > 280) { doc.addPage(); y = margin; }
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('VoltGuard Tools', margin, y); y += 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(120);
    var titleLines = doc.splitTextToSize(pdfText(title), width);
    doc.text(titleLines, margin, y); y += titleLines.length * 6;
    doc.text(pdfText('Tarih: ' + new Date().toLocaleString('tr-TR')), margin, y); y += 8;
    doc.setDrawColor(200); doc.line(margin, y, 210 - margin, y); y += 6;
    doc.setTextColor(30); doc.setFontSize(12); doc.setFont('helvetica', 'bold');
    doc.text(pdfText('Giriş değerleri'), margin, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    readInputs().forEach(function (f) {
      var lines = doc.splitTextToSize(pdfText(f.label + ': ' + String(f.value)), width);
      ensureSpace(lines.length * 5);
      doc.text(lines, margin, y);
      y += lines.length * 5;
    });
    y += 4;
    var r = readResult();
    ensureSpace(20);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text(pdfText('Sonuç'), margin, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    var valueLines = doc.splitTextToSize(pdfText(r.value || '-'), width);
    ensureSpace(valueLines.length * 5.5);
    doc.text(valueLines, margin, y); y += valueLines.length * 5.5 + 1;
    if (r.note) {
      doc.setFontSize(10); doc.setTextColor(120);
      var noteLines = doc.splitTextToSize(pdfText(r.note), width);
      ensureSpace(noteLines.length * 5);
      doc.text(noteLines, margin, y); y += noteLines.length * 5;
      doc.setTextColor(30);
    }
    if (r.breakdown && r.breakdown.length) {
      y += 3;
      ensureSpace(12);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(pdfText('Hesap dökümü'), margin, y); y += 5.5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      r.breakdown.forEach(function (line) {
        var lines = doc.splitTextToSize(pdfText('- ' + line), width);
        ensureSpace(lines.length * 5);
        doc.text(lines, margin, y);
        y += lines.length * 5;
      });
    }
    if (r.assumptions) {
      y += 3;
      ensureSpace(12);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(pdfText('Formül, kabuller ve dayanak'), margin, y); y += 5.5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      var asLines = doc.splitTextToSize(pdfText(r.assumptions), width);
      asLines.forEach(function (line) { ensureSpace(4.6); doc.text(line, margin, y); y += 4.6; });
    }
    y += 8;
    ensureSpace(26);
    doc.setDrawColor(200); doc.line(margin, y, 210 - margin, y); y += 5;
    doc.setFontSize(9); doc.setTextColor(120);
    var disclaimer = doc.splitTextToSize(pdfText('Bu çıktı ön değerlendirmedir; nihai proje için yetkili mühendislik doğrulaması gerekir.'), width);
    doc.text(disclaimer, margin, y); y += disclaimer.length * 4.5;
    doc.text(pdfText('Kaynak: ' + toolUrl()), margin, y); y += 4.5;
    doc.text('voltguard.com.tr | +90 545 434 67 35 | info@voltguard.com.tr', margin, y);
    var safeName = pdfSlug(title).slice(0, 60).replace(/-+$/, '') || 'tools';
    doc.save('voltguard-' + safeName + '.pdf');
  }

  async function shareCurrent() {
    var url = toolUrl();
    var title = toolName();
    if (navigator.share) {
      try { await navigator.share({ title: title, url: url }); return { ok: true, mode: 'share' }; }
      catch (e) { if (e.name === 'AbortError') return { ok: false, mode: 'abort' }; }
    }
    try { await navigator.clipboard.writeText(url); return { ok: true, mode: 'copy' }; }
    catch (e) { return { ok: false, mode: 'error' }; }
  }

  function auth() { return global.VG && global.VG.Auth ? global.VG.Auth : null; }

  // Giriş sayfası adresi (dönüş adresiyle). http(s) üzerinde kök-mutlak; file:// önizlemede Auth.pathPrefix() kullanılır.
  function loginUrl() {
    var a = auth();
    if (a && a.loginUrl) return a.loginUrl(location.pathname + location.search);
    var prefix = /^https?:$/.test(location.protocol) ? '/' : '';
    return prefix + 'hesap/giris.html?next=' + encodeURIComponent(location.pathname + location.search);
  }

  // Hesaplamayı kaydeder: giriş yapılmışsa hesaba (sunucuya senkronlanır), değilse bu tarayıcıya.
  // Misafir kayıtları giriş/kayıt sonrasında hesaba otomatik aktarılır. Sonuçla birlikte hesap dökümü
  // satırları (result.breakdown) da saklanır; Kayıtlarım sayfası bunları listeler.
  function saveCurrentToAccount(userNote) {
    var a = auth();
    if (!a) throw new Error('Hesap modülü yüklenemedi.');
    return a.saveHistory({
      toolSlug: toolSlug(),
      toolName: toolName(),
      toolUrl: toolUrl(),
      params: readInputs(),
      result: readResult(),
      note: (userNote || '').trim()
    });
  }

  // Misafir kaydettiğinde araç çubuğunun altında kalıcı (kendiliğinden kaybolmayan) bir bilgi satırı gösterilir.
  function showGuestNote(bar) {
    var a = auth();
    if (!bar || !bar.parentNode || (a && a.isLoggedIn())) return;
    var note = bar.parentNode.querySelector('.vg-toolbar-note');
    if (!note) {
      note = document.createElement('p');
      note.className = 'vg-toolbar-note';
      note.setAttribute('role', 'status');
      note.style.cssText = 'margin:-1rem 0 1.5rem;font-size:.86rem;color:var(--clr-text-muted,#5b6b7c);line-height:1.55';
      bar.parentNode.insertBefore(note, bar.nextSibling);
    }
    var prefix = /^https?:$/.test(location.protocol) ? '/' : (a ? a.pathPrefix() : '');
    var link = 'color:var(--clr-accent-text,#b45309);font-weight:600';
    note.innerHTML = 'Kayıtlarınız şimdilik yalnızca bu tarayıcıda saklanıyor. '
      + '<a href="' + loginUrl() + '" style="' + link + '">Giriş yapın</a> ya da '
      + '<a href="' + prefix + 'hesap/kayit.html" style="' + link + '">ücretsiz üye olun</a>; kayıtlarınız hesabınıza aktarılır ve tüm cihazlarınızdan erişilir. '
      + '<a href="' + prefix + 'hesap/gecmis.html" style="' + link + '">Kayıtlarımı gör</a>';
  }

  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'vg-toast vg-toast--' + (kind || 'info');
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-visible'); });
    setTimeout(function () {
      t.classList.remove('is-visible');
      setTimeout(function () { t.remove(); }, 300);
    }, 2600);
  }

  function favLabel(on) { return '<i class="fas fa-star" aria-hidden="true"></i> ' + (on ? 'Favoriden çıkar' : 'Favorilere ekle'); }
  function syncFavButton(btn) {
    var a = auth();
    if (!btn || !a) return;
    var on = !!(toolSlug() && a.isFavorite(toolSlug()));
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.innerHTML = favLabel(on);
  }

  function ensureToolbar() {
    if (q('.vg-toolbar')) return;
    var mini = q('.mini-calc');
    if (!mini) return;

    var brand = document.createElement('div');
    brand.className = 'vg-tools-badge';
    brand.innerHTML = '<i class="fas fa-toolbox" aria-hidden="true"></i><span>VoltGuard Tools</span><small>Ücretsiz mühendislik hesaplayıcısı</small>';
    mini.parentNode.insertBefore(brand, mini);

    var bar = document.createElement('div');
    bar.className = 'vg-toolbar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Hesap işlemleri');
    bar.innerHTML = [
      '<button type="button" class="vg-toolbar__btn" data-vg-action="save"><i class="fas fa-bookmark" aria-hidden="true"></i> Hesabıma kaydet</button>',
      '<button type="button" class="vg-toolbar__btn" data-vg-action="fav" aria-pressed="false">' + favLabel(false) + '</button>',
      '<button type="button" class="vg-toolbar__btn" data-vg-action="share"><i class="fas fa-share-nodes" aria-hidden="true"></i> Paylaş</button>',
      '<button type="button" class="vg-toolbar__btn" data-vg-action="pdf"><i class="fas fa-file-pdf" aria-hidden="true"></i> PDF indir</button>',
      '<button type="button" class="vg-toolbar__btn" data-vg-action="print"><i class="fas fa-print" aria-hidden="true"></i> Yazdır</button>'
    ].join('');
    mini.parentNode.insertBefore(bar, mini.nextSibling);

    var favBtn = bar.querySelector('[data-vg-action="fav"]');
    syncFavButton(favBtn);
    // Giriş yapılmışsa favoriler sunucudan yüklenince (veya başka sekmede değişince) düğme güncellenir.
    document.addEventListener('vg:data', function (e) {
      if (!e.detail || !e.detail.collection || e.detail.collection === 'favorites') syncFavButton(favBtn);
    });
    document.addEventListener('vg:auth', function () { syncFavButton(favBtn); });
    var a = auth();
    if (a && a.loadData) {
      a.ready().then(function (user) {
        if (user) return a.loadData(['favorites']);
      }).then(function () { syncFavButton(favBtn); }, function () { /* ağ yok: yerel durum gösterilir */ });
    }

    bar.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-vg-action]');
      if (!btn) return;
      handleAction(btn.getAttribute('data-vg-action'), btn, bar);
    });
  }

  async function handleAction(action, btn, bar) {
    try {
      var a = auth();
      if (action === 'save') {
        var saved = saveCurrentToAccount('');
        if (saved) {
          if (a && a.isLoggedIn()) toast('Hesabınıza kaydedildi.', 'success');
          else { toast('Bu tarayıcıya kaydedildi.', 'success'); showGuestNote(bar); }
        }
        return;
      }
      if (action === 'fav') {
        if (!a) throw new Error('Hesap modülü yüklenemedi.');
        var slug = toolSlug();
        if (!slug) throw new Error('Bu sayfa favorilere eklenemiyor.');
        var nowFav = a.toggleFavorite(slug, toolName(), toolUrl());
        btn.setAttribute('aria-pressed', nowFav ? 'true' : 'false');
        btn.innerHTML = favLabel(nowFav);
        toast(nowFav ? 'Favorilere eklendi.' : 'Favoriden çıkarıldı.', 'info');
        if (nowFav && !a.isLoggedIn()) showGuestNote(bar);
        return;
      }
      if (action === 'share') {
        var r = await shareCurrent();
        if (r.ok && r.mode === 'copy') toast('Bağlantı kopyalandı.', 'info');
        else if (r.ok) toast('Paylaşıldı.', 'success');
        else if (r.mode !== 'abort') toast('Paylaşım başarısız.', 'error');
        return;
      }
      if (action === 'pdf') { await exportPdf(); return; }
      if (action === 'print') { window.print(); return; }
    } catch (e) {
      toast(e.message || 'İşlem tamamlanamadı.', 'error');
    }
  }

  // Sonuç alanı her girişte güncellenir; ekran okuyucuların değişikliği duyurması için canlı bölge işaretlenir.
  function markLiveRegions() {
    qq('.mini-calc__result').forEach(function (el) {
      if (!el.hasAttribute('role')) el.setAttribute('role', 'status');
      if (!el.hasAttribute('aria-live')) el.setAttribute('aria-live', 'polite');
    });
  }

  function init() { markLiveRegions(); ensureToolbar(); }

  global.VG = global.VG || {};
  global.VG.Tools = {
    init: init,
    readInputs: readInputs,
    readResult: readResult,
    readBreakdown: readBreakdown,
    exportPdf: exportPdf,
    ensureJsPdf: ensureJsPdf,
    pdfText: pdfText,
    pdfSlug: pdfSlug,
    saveToAccount: saveCurrentToAccount,
    loginUrl: loginUrl,
    share: shareCurrent
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
