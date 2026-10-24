/* =====================================================
   VoltGuard Forms — print / CSV / HTML export helpers
   for Mühendis & Tekniker Merkezi templates.
   ===================================================== */
(function (global) {
  'use strict';

  var CONTROLS = 'input, select, textarea';
  var uid = 0;

  function q(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qq(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // Header cell (<th>) of the column that a table cell belongs to.
  function headerCell(cell) {
    var table = cell && cell.closest('table');
    var row = table && table.tHead && table.tHead.rows[0];
    return row ? row.cells[cell.cellIndex] || null : null;
  }

  // Visible label of a control: its .vg-form-field label, a label[for], or the table column header.
  function controlLabel(el) {
    var field = el.closest('.vg-form-field');
    var label = field && field.querySelector('label');
    if (label) return clean(label.textContent);
    if (el.id) {
      var byFor = document.querySelector('label[for="' + el.id + '"]');
      if (byFor) return clean(byFor.textContent);
    }
    var th = headerCell(el.closest('td'));
    if (th) return clean(th.textContent);
    return clean(el.getAttribute('aria-label') || el.name || el.id) || 'Alan';
  }

  // Readable value of a control. The "Seçiniz" placeholder option has value="" and counts as blank.
  function controlValue(el) {
    if (el.tagName === 'SELECT') {
      var opt = el.options[el.selectedIndex];
      return !opt || opt.value === '' ? '' : clean(opt.textContent);
    }
    if (el.type === 'checkbox') return el.checked ? 'Evet' : 'Hayır';
    if (el.type === 'radio') return el.checked ? clean(el.value) : '';
    return el.value;
  }

  function readValues(root) {
    return qq(CONTROLS, root).filter(function (el) {
      return !/^(hidden|button|submit|reset)$/.test(el.type);
    }).map(function (el) {
      return { label: controlLabel(el), value: controlValue(el) };
    });
  }

  // Associates labels with their controls and names table-cell controls (screen readers, label clicks).
  function labelControls(root) {
    qq('.vg-form-field', root).forEach(function (field) {
      var label = field.querySelector('label');
      var ctrl = field.querySelector(CONTROLS);
      if (!label || !ctrl || label.getAttribute('for')) return;
      if (!ctrl.id) ctrl.id = 'vgf-' + (++uid);
      label.setAttribute('for', ctrl.id);
    });
    qq('td', root).forEach(function (cell) {
      var ctrl = cell.querySelector(CONTROLS);
      if (!ctrl || ctrl.id || ctrl.hasAttribute('aria-label')) return;
      var th = headerCell(cell);
      if (!th) return;
      var what = clean(th.textContent);
      var item = '';
      Array.from(cell.parentNode.cells).some(function (c) {
        if (c.querySelector(CONTROLS)) return false;
        var t = clean(c.textContent);
        if (!t || /^\D*\d+$/.test(t)) return false;
        item = t;
        return true;
      });
      ctrl.setAttribute('aria-label', item ? what + ' - ' + item : what);
    });
  }

  function csvEscape(s) {
    var str = String(s == null ? '' : s);
    // CSV formula injection: Excel/Calc execute cells starting with = + - @ (or tab/CR). Plain numbers such as
    // "-12,5" stay numeric; any other such cell is prefixed with an apostrophe so it is shown as text.
    if (/^[=+\-@\t\r]/.test(str) && !/^-?\d+([.,]\d+)?$/.test(str)) str = "'" + str;
    if (/[",\r\n;]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function tableToCsv(tableSel) {
    var table = q(tableSel);
    if (!table) throw new Error('CSV için tablo bulunamadı: ' + tableSel);
    var rows = qq('tr', table);
    var lines = rows.map(function (tr) {
      return qq('th, td', tr).map(function (cell) {
        var input = cell.querySelector(CONTROLS);
        var v = input ? controlValue(input) : clean(cell.textContent);
        // Turkish-locale Excel reads "37.50" as text/date, so numeric cells use a decimal comma.
        if (input && input.type === 'number') v = String(v).replace('.', ',');
        return csvEscape(v);
      }).join(';');
    });
    return lines.join('\r\n');
  }

  function downloadBlob(content, filename, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  }

  function exportCsv(tableSel, name) {
    var csv = tableToCsv(tableSel);
    // BOM ensures Excel opens Turkish characters correctly.
    downloadBlob('﻿' + csv, name + '.csv', 'text/csv;charset=utf-8');
  }

  function exportHtml(name) {
    var clone = document.documentElement.cloneNode(true);
    // Kaydedilen belge (yazdırma/arşiv) her zaman açık temadır; koyu tema yalnız ekranda
    clone.setAttribute('data-theme', 'light');
    // Controls have no id/name, so live and cloned controls are paired by their position.
    // Pair them before any node is removed from the clone.
    var live = qq(CONTROLS);
    var copies = qq(CONTROLS, clone);
    copies.forEach(function (el, i) {
      var src = live[i];
      if (!src) return;
      if (el.tagName === 'SELECT') {
        qq('option', el).forEach(function (o, k) {
          if (k === src.selectedIndex) o.setAttribute('selected', 'selected');
          else o.removeAttribute('selected');
        });
      } else if (el.tagName === 'TEXTAREA') {
        el.textContent = src.value;
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        if (src.checked) el.setAttribute('checked', 'checked'); else el.removeAttribute('checked');
      } else {
        el.setAttribute('value', src.value);
      }
    });
    qq('.vg-form-actions, .vg-form-add-row, .vg-header, .vg-footer, .skip-to-content, .skip-link, .doc-header, .footer, script', clone).forEach(function (n) { n.remove(); });
    // Keep the relative stylesheet/icon URLs working when the saved file is opened elsewhere.
    var head = clone.querySelector('head');
    if (head) {
      var base = document.createElement('base');
      base.setAttribute('href', location.href.split('#')[0]);
      var charset = head.querySelector('meta[charset]');
      head.insertBefore(base, charset ? charset.nextSibling : head.firstChild);
    }
    var html = '<!DOCTYPE html>\n' + clone.outerHTML;
    downloadBlob(html, name + '.html', 'text/html;charset=utf-8');
  }

  var jsPdfPromise = null;
  function ensureJsPdf() {
    if (global.jspdf && global.jspdf.jsPDF) return Promise.resolve(global.jspdf.jsPDF);
    if (jsPdfPromise) return jsPdfPromise;
    jsPdfPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/js/vendor/jspdf.umd.min.js?v=4.2.1';
      var done = false;
      var timer = setTimeout(fail, 15000);
      function fail() {
        if (done) return;
        done = true; clearTimeout(timer); jsPdfPromise = null; s.remove();
        reject(new Error('PDF kütüphanesi yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.'));
      }
      s.onload = function () {
        if (done) return;
        if (global.jspdf && global.jspdf.jsPDF) { done = true; clearTimeout(timer); resolve(global.jspdf.jsPDF); }
        else fail();
      };
      s.onerror = fail;
      document.head.appendChild(s);
    });
    return jsPdfPromise;
  }

  // The built-in jsPDF fonts only cover Latin-1; a single character outside it garbles the whole string.
  // Every string is therefore transliterated before it is written to the PDF.
  var PDF_MAP = {
    '\u015F': 's', '\u015E': 'S', '\u011F': 'g', '\u011E': 'G', '\u0131': 'i', '\u0130': 'I',
    '\u00E7': 'c', '\u00C7': 'C', '\u00F6': 'o', '\u00D6': 'O', '\u00FC': 'u', '\u00DC': 'U',
    '\u03A9': 'Ohm', '\u2126': 'Ohm', '\u0394': 'd', '\u03B4': 'd', '\u03C6': 'phi', '\u03A6': 'Phi',
    '\u03B7': 'eta', '\u03C1': 'rho', '\u03C0': 'pi', '\u03BC': 'u', '\u221A': 'sqrt',
    '\u2264': '<=', '\u2265': '>=', '\u2260': '!=', '\u2248': '~', '\u2192': '->', '\u2190': '<-',
    '\u2014': '-', '\u2013': '-', '\u2212': '-', '\u2026': '...', '\u2022': '*',
    '\u2018': '\'', '\u2019': '\'', '\u201C': '"', '\u201D': '"', '\u20AC': 'EUR', '\u20BA': 'TL'
  };
  '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089'.split('').forEach(function (ch, n) { PDF_MAP[ch] = String(n); });
  '\u2070\u2074\u2075\u2076\u2077\u2078\u2079'.split('').forEach(function (ch, n) { PDF_MAP[ch] = String(n ? n + 3 : 0); });
  var PDF_RE = /[^\x00-\xFF]|[\u00E7\u00C7\u00F6\u00D6\u00FC\u00DC]/g;

  function pdfSafe(s) {
    return String(s == null ? '' : s).replace(PDF_RE, function (ch) {
      if (Object.prototype.hasOwnProperty.call(PDF_MAP, ch)) return PDF_MAP[ch];
      var base = ch.normalize ? ch.normalize('NFD').replace(/[\u0300-\u036F]/g, '') : ch;
      if (!base) return '';
      return /^[\x20-\x7E]+$/.test(base) ? base : '?';
    });
  }

  async function exportPdf(title, name) {
    var jsPDF = await ensureJsPdf();
    var doc = new jsPDF({ unit: 'mm', format: 'a4' });
    var margin = 15;
    var contentW = 210 - 2 * margin;
    var bottom = 282;
    var y = margin;

    function ensure(h) { if (y + h > bottom) { doc.addPage(); y = margin; } }
    // Writes wrapped text at (x, y) and moves y down, breaking pages line by line.
    function write(text, x, w, lh) {
      doc.splitTextToSize(pdfSafe(text), w).forEach(function (line) {
        ensure(lh);
        doc.text(line, x, y);
        y += lh;
      });
    }
    function plain(size) { doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(30); }
    function bold(size) { doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.setTextColor(30); }

    function displayValue(ctrl) {
      var v = controlValue(ctrl);
      return ctrl.type === 'number' ? String(v).replace('.', ',') : v;
    }

    function drawFields(container) {
      readValues(container).forEach(function (f) {
        plain(9);
        write(f.label + ': ' + (f.value === '' ? '-' : f.value), margin, contentW, 4.5);
      });
    }

    function drawNote(node) {
      var text = clean(node.textContent);
      if (!text) return;
      y += 0.5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
      write(text, margin, contentW, 3.8);
      plain(9);
    }

    function drawTotals(box) {
      var labels = qq('span', box);
      var values = qq('strong', box);
      labels.forEach(function (l, i) {
        bold(9);
        write(clean(l.textContent) + ': ' + clean(values[i] ? values[i].textContent : ''), margin, contentW, 5);
      });
      plain(9);
    }

    function drawTable(table) {
      var rows = qq('tr', table).map(function (tr) {
        var cells = Array.from(tr.cells).map(function (cell) {
          var ctrl = cell.querySelector(CONTROLS);
          return { head: cell.tagName === 'TH', text: ctrl ? displayValue(ctrl) : clean(cell.textContent) };
        });
        cells.head = cells.length > 0 && cells.every(function (c) { return c.head; });
        return cells;
      });
      if (!rows.length) return;
      var ncol = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      var weights = [];
      for (var c = 0; c < ncol; c++) {
        var wt = 4;
        rows.forEach(function (r) {
          if (!r[c]) return;
          var len = r[c].head ? Math.min(r[c].text.length, 12) : Math.min(r[c].text.length, 34);
          if (r[c].head) {
            // A header word must fit on one line.
            len = Math.max(len, Math.min(Math.max.apply(null, r[c].text.split(' ').map(function (w) { return w.length; })) + 1.5, 14));
          }
          wt = Math.max(wt, len);
        });
        weights.push(wt);
      }
      var sum = weights.reduce(function (a, b) { return a + b; }, 0);
      var widths = weights.map(function (wt) { return wt / sum * contentW; });
      var headRow = rows.filter(function (r) { return r.head; })[0];
      var lh = 3.6;
      doc.setLineWidth(0.2);
      doc.setDrawColor(170);

      function drawRow(r, isHead) {
        doc.setFontSize(8);
        var sets = r.map(function (cell, i) {
          doc.setFont('helvetica', isHead ? 'bold' : 'normal');
          var t = cell.text === '' && !isHead ? '-' : cell.text;
          return doc.splitTextToSize(pdfSafe(t), Math.max(widths[i] - 2, 3));
        });
        var h = Math.max.apply(null, sets.map(function (s) { return s.length || 1; })) * lh + 1.6;
        if (y + h > bottom) {
          doc.addPage(); y = margin;
          if (!isHead && headRow) drawRow(headRow, true);
        }
        var x = margin;
        r.forEach(function (cell, i) {
          if (isHead) { doc.setFillColor(238, 241, 245); doc.rect(x, y, widths[i], h, 'FD'); }
          else doc.rect(x, y, widths[i], h);
          doc.setFont('helvetica', isHead ? 'bold' : 'normal');
          doc.setFontSize(8);
          doc.setTextColor(30);
          sets[i].forEach(function (ln, k) { doc.text(ln, x + 1, y + 3.1 + k * lh); });
          x += widths[i];
        });
        y += h;
      }

      rows.forEach(function (r) { drawRow(r, r.head); });
      y += 4;
      plain(9);
    }

    // Header block
    bold(15);
    doc.text('VoltGuard Muhendis & Tekniker Merkezi', margin, y); y += 7;
    bold(12);
    write(title, margin, contentW, 6);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
    var meta = qq('.vg-form-meta > div').map(function (d) { return clean(d.textContent); }).join('  |  ');
    if (meta) write(meta, margin, contentW, 4);
    doc.text(pdfSafe('Olusturma tarihi: ' + new Date().toLocaleString('tr-TR')), margin, y); y += 4;
    doc.text('Kaynak: voltguard.com.tr/muhendis-merkezi.html', margin, y); y += 6;
    doc.setDrawColor(200); doc.line(margin, y, 210 - margin, y); y += 6;
    plain(9);

    qq('.vg-form-section').forEach(function (sec) {
      var h = sec.querySelector('h2');
      ensure(16);
      bold(11);
      write(h ? clean(h.textContent) : '', margin, contentW, 5);
      y += 1;
      plain(9);
      Array.from(sec.children).forEach(function (node) {
        if (node.matches('h2, .vg-form-add-row')) return;
        if (node.matches('table')) drawTable(node);
        else if (node.matches('.vg-form-total')) drawTotals(node);
        else if (node.querySelector(CONTROLS)) drawFields(node);
        else drawNote(node);
      });
      y += 3;
    });

    // Signature blocks
    var sigs = qq('.vg-form-signature');
    if (sigs.length) {
      ensure(34);
      y += 8;
      var gap = 8;
      var sw = (contentW - gap * (sigs.length - 1)) / sigs.length;
      sigs.forEach(function (s, i) {
        var x = margin + i * (sw + gap);
        var strong = s.querySelector('strong');
        var caption = Array.from(s.childNodes).filter(function (n) { return n.nodeType === 3; })
          .map(function (n) { return n.textContent; }).join('');
        bold(9);
        doc.text(pdfSafe(clean(strong ? strong.textContent : '')), x, y);
        doc.setDrawColor(60); doc.line(x, y + 16, x + sw, y + 16);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110);
        doc.text(doc.splitTextToSize(pdfSafe(clean(caption)), sw), x, y + 20);
      });
      y += 28;
    }

    // Page numbers
    var pages = doc.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150);
      doc.text('voltguard.com.tr  -  Sayfa ' + p + '/' + pages, margin, 291);
    }

    var safe = (name || 'voltguard-form').replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
    doc.save('voltguard-' + safe + '.pdf');
  }

  // Resets a cloned table row so it behaves like a fresh row.
  function resetRow(row) {
    qq('input, textarea', row).forEach(function (el) {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = el.defaultChecked;
      else el.value = el.defaultValue;
      el.removeAttribute('aria-label');
    });
    qq('select', row).forEach(function (el) {
      var d = Array.from(el.options).findIndex(function (o) { return o.defaultSelected; });
      el.selectedIndex = d < 0 ? 0 : d;
      el.removeAttribute('aria-label');
    });
    Array.from(row.cells).forEach(function (cell, i) {
      if (cell.querySelector(CONTROLS)) return;
      var text = clean(cell.textContent);
      var m = /^(\D*)(\d+)$/.exec(text);
      if (i === 0 && m) {
        // Row number (1, 2, ... or K1, K2, ...): continue the sequence.
        cell.textContent = m[1] + (parseInt(m[2], 10) + 1);
      } else if (i > 0 && text) {
        // Fixed checklist text must not be repeated on a new row: replace it with an empty field.
        var input = document.createElement('input');
        input.type = 'text';
        cell.textContent = '';
        cell.appendChild(input);
      }
    });
  }

  function bindDefaults() {
    labelControls(document);
    qq('[data-vg-form-action]').forEach(function (btn) {
      btn.addEventListener('click', async function (ev) {
        ev.preventDefault();
        var action = btn.getAttribute('data-vg-form-action');
        var title = document.querySelector('.vg-form-header h1');
        var titleText = title ? title.textContent.trim() : document.title;
        var slug = location.pathname.replace(/^.*\//, '').replace(/\.html$/i, '') || 'voltguard-form';
        try {
          if (action === 'print') window.print();
          else if (action === 'html') exportHtml(slug);
          else if (action === 'pdf') await exportPdf(titleText, slug);
          else if (action === 'csv') exportCsv(btn.dataset.target || '.vg-form-table', slug);
        } catch (e) { alert(e.message || 'İşlem başarısız.'); }
      });
    });
    qq('[data-vg-add-row]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tableSel = btn.getAttribute('data-vg-add-row');
        var table = q(tableSel);
        if (!table || !table.tBodies[0] || !table.tBodies[0].rows[0]) return;
        var body = table.tBodies[0];
        var clone = body.rows[body.rows.length - 1].cloneNode(true);
        resetRow(clone);
        body.appendChild(clone);
        labelControls(clone);
      });
    });
    qq('[data-vg-sum]').forEach(function (cell) {
      var source = cell.getAttribute('data-vg-sum');
      var recompute = function () {
        var total = qq(source).reduce(function (acc, el) { return acc + (parseFloat(el.value) || 0); }, 0);
        cell.textContent = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total);
      };
      document.addEventListener('input', recompute);
      recompute();
    });
  }

  global.VG = global.VG || {};
  global.VG.Forms = {
    exportCsv: exportCsv,
    exportHtml: exportHtml,
    exportPdf: exportPdf,
    downloadBlob: downloadBlob,
    tableToCsv: tableToCsv,
    readValues: readValues,
    pdfSafe: pdfSafe
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindDefaults);
  else bindDefaults();
}(window));
