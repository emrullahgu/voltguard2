/* =====================================================
   VoltGuard Tools — shared toolbar for calculator pages
   Auto-detects .mini-calc structure and injects:
   - Save to account
   - Toggle favorite
   - Share (Web Share API or copy link)
   - Export as PDF (via jsPDF loaded on demand; Turkish letters and
     engineering symbols are transliterated, see pdfText)
   Also draws a consistent "VoltGuard Tools" brand banner.
   ===================================================== */
(function (global) {
  'use strict';

  var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

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

  function readInputs(rootSelector) {
    var root = q(rootSelector || '.mini-calc, .tool-fields, .tool-card');
    if (!root) return [];
    return qq('input, select', root).map(function (el) {
      var lbl = null;
      if (el.id) { var l = q('label[for="' + el.id + '"]'); if (l) lbl = l.textContent.trim(); }
      if (!lbl) { var parent = el.closest('.mini-calc__field, .tool-field'); if (parent) { var pl = q('label', parent); if (pl) lbl = pl.textContent.trim(); } }
      var val = el.value;
      if (el.tagName === 'SELECT' && el.selectedOptions[0]) val = el.selectedOptions[0].textContent.trim() + ' (' + el.value + ')';
      return { label: lbl || el.name || el.id || '?', value: val };
    });
  }

  function readResult() {
    var v = q('.mini-calc__result-value, .tool-result__amount');
    var n = q('.mini-calc__result-note, .tool-result__detail');
    return {
      value: v ? v.textContent.trim() : '',
      note: n ? n.textContent.trim() : ''
    };
  }

  var jsPdfPromise = null;
  function ensureJsPdf() {
    if (global.jspdf && global.jspdf.jsPDF) return Promise.resolve(global.jspdf.jsPDF);
    if (jsPdfPromise) return jsPdfPromise;
    jsPdfPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = JSPDF_URL;
      s.crossOrigin = 'anonymous';
      s.onload = function () {
        if (global.jspdf && global.jspdf.jsPDF) { resolve(global.jspdf.jsPDF); return; }
        jsPdfPromise = null;
        reject(new Error('PDF kütüphanesi yüklenemedi.'));
      };
      s.onerror = function () { jsPdfPromise = null; s.remove(); reject(new Error('PDF kütüphanesi yüklenemedi.')); };
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

  // Giriş sayfası adresi: http(s) üzerinde alan adı köküne göre mutlak yol (temiz URL'lerde ../ göreli yolu
  // /hesaplama/hesap/... gibi var olmayan bir adrese giderdi); file:// önizlemede Auth.pathPrefix() kullanılır.
  function loginUrl() {
    var prefix = /^https?:$/.test(location.protocol) ? '/' : (global.VG && global.VG.Auth ? global.VG.Auth.pathPrefix() : '');
    return prefix + 'hesap/giris.html?next=' + encodeURIComponent(location.pathname + location.search);
  }

  function saveCurrentToAccount(userNote) {
    if (!global.VG || !global.VG.Auth) throw new Error('Auth modülü yüklenmedi.');
    var user = global.VG.Auth.currentUser();
    if (!user) {
      location.href = loginUrl();
      return null;
    }
    var params = readInputs();
    var result = readResult();
    return global.VG.Auth.saveHistory({
      toolSlug: toolSlug(),
      toolName: toolName(),
      toolUrl: toolUrl(),
      params: params,
      result: result,
      note: (userNote || '').trim()
    });
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

  function ensureToolbar() {
    if (q('.vg-toolbar')) return;
    var mini = q('.mini-calc');
    if (!mini) return;

    var user = global.VG && global.VG.Auth ? global.VG.Auth.currentUser() : null;
    var isFav = user && global.VG.Auth.isFavorite(toolSlug());
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
      '<button type="button" class="vg-toolbar__btn" data-vg-action="fav" aria-pressed="' + (isFav ? 'true' : 'false') + '"><i class="fas ' + (isFav ? 'fa-star' : 'fa-star') + '" aria-hidden="true"></i> ' + (isFav ? 'Favoriden çıkar' : 'Favorilere ekle') + '</button>',
      '<button type="button" class="vg-toolbar__btn" data-vg-action="share"><i class="fas fa-share-nodes" aria-hidden="true"></i> Paylaş</button>',
      '<button type="button" class="vg-toolbar__btn" data-vg-action="pdf"><i class="fas fa-file-pdf" aria-hidden="true"></i> PDF indir</button>',
      '<button type="button" class="vg-toolbar__btn" data-vg-action="print"><i class="fas fa-print" aria-hidden="true"></i> Yazdır</button>'
    ].join('');
    mini.parentNode.insertBefore(bar, mini.nextSibling);

    bar.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-vg-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-vg-action');
      handleAction(action, btn);
    });
  }

  async function handleAction(action, btn) {
    try {
      if (action === 'save') {
        var saved = saveCurrentToAccount('');
        if (saved) toast('Hesabınıza kaydedildi.', 'success');
        return;
      }
      if (action === 'fav') {
        var user = global.VG.Auth.currentUser();
        if (!user) {
          location.href = loginUrl();
          return;
        }
        var nowFav = global.VG.Auth.toggleFavorite(toolSlug(), toolName(), toolUrl());
        btn.setAttribute('aria-pressed', nowFav ? 'true' : 'false');
        btn.innerHTML = '<i class="fas fa-star" aria-hidden="true"></i> ' + (nowFav ? 'Favoriden çıkar' : 'Favorilere ekle');
        toast(nowFav ? 'Favorilere eklendi.' : 'Favoriden çıkarıldı.', 'info');
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
    exportPdf: exportPdf,
    pdfText: pdfText,
    pdfSlug: pdfSlug,
    saveToAccount: saveCurrentToAccount,
    share: shareCurrent
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
