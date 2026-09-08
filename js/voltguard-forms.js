/* =====================================================
   VoltGuard Forms — print / CSV / HTML export helpers
   for Mühendis & Tekniker Merkezi templates.
   ===================================================== */
(function (global) {
  'use strict';

  function q(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qq(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function readValues(root) {
    return qq('input, select, textarea', root).map(function (el) {
      var label = '';
      if (el.id) { var l = document.querySelector('label[for="' + el.id + '"]'); if (l) label = l.textContent.trim(); }
      if (!label) {
        var cell = el.closest('td');
        if (cell) {
          var th = document.querySelectorAll(cell.closest('table').tHead.rows[0].cells)[cell.cellIndex];
          if (th) label = th.textContent.trim();
        }
      }
      var val = el.value;
      if (el.tagName === 'SELECT' && el.selectedOptions[0]) val = el.selectedOptions[0].textContent.trim();
      if (el.type === 'checkbox') val = el.checked ? 'Evet' : 'Hayır';
      return { label: label || el.name || el.id || '?', value: val };
    });
  }

  function csvEscape(s) {
    var str = String(s == null ? '' : s);
    if (/[",\r\n;]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function tableToCsv(tableSel) {
    var table = q(tableSel);
    if (!table) throw new Error('CSV için tablo bulunamadı: ' + tableSel);
    var rows = qq('tr', table);
    var lines = rows.map(function (tr) {
      return qq('th, td', tr).map(function (cell) {
        var input = cell.querySelector('input, select, textarea');
        var v = input ? (input.tagName === 'SELECT' && input.selectedOptions[0] ? input.selectedOptions[0].textContent : input.value) : cell.textContent.trim();
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
    downloadBlob('\uFEFF' + csv, name + '.csv', 'text/csv;charset=utf-8');
  }

  function exportHtml(name) {
    var clone = document.documentElement.cloneNode(true);
    qq('.vg-form-actions, .doc-header, .footer, script', clone).forEach(function (n) { n.remove(); });
    qq('input, select, textarea', clone).forEach(function (el) {
      var live = document.getElementById(el.id) || Array.from(document.querySelectorAll('[name="' + el.name + '"]')).find(function (x) { return x.value != null; });
      if (!live) return;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.setAttribute('value', live.value);
        if (el.tagName === 'TEXTAREA') el.textContent = live.value;
      } else if (el.tagName === 'SELECT' && live.selectedOptions[0]) {
        qq('option', el).forEach(function (o) { o.removeAttribute('selected'); });
        var target = qq('option', el).find(function (o) { return o.value === live.value; });
        if (target) target.setAttribute('selected', 'selected');
      }
    });
    var html = '<!DOCTYPE html>\n' + clone.outerHTML;
    downloadBlob(html, name + '.html', 'text/html;charset=utf-8');
  }

  function ensureJsPdf() {
    if (global.jspdf && global.jspdf.jsPDF) return Promise.resolve(global.jspdf.jsPDF);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.crossOrigin = 'anonymous';
      s.onload = function () { resolve(global.jspdf.jsPDF); };
      s.onerror = function () { reject(new Error('PDF kütüphanesi yüklenemedi.')); };
      document.head.appendChild(s);
    });
  }

  async function exportPdf(title, name) {
    var jsPDF = await ensureJsPdf();
    var doc = new jsPDF({ unit: 'mm', format: 'a4' });
    var margin = 15;
    var y = margin;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text('VoltGuard Muhendis & Tekniker Merkezi', margin, y); y += 7;
    doc.setFontSize(12); doc.setTextColor(30);
    doc.text(title, margin, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
    doc.text('Tarih: ' + new Date().toLocaleString('tr-TR'), margin, y); y += 4;
    doc.text('Kaynak: voltguard.com.tr/muhendis-merkezi.html', margin, y); y += 6;
    doc.setDrawColor(200); doc.line(margin, y, 210 - margin, y); y += 6;
    doc.setTextColor(30);

    qq('.vg-form-section').forEach(function (sec) {
      var h = sec.querySelector('h2');
      var heading = h ? h.textContent.trim() : '';
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      if (y > 275) { doc.addPage(); y = margin; }
      doc.text(heading, margin, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);

      var table = sec.querySelector('.vg-form-table');
      if (table) {
        qq('tr', table).forEach(function (tr) {
          if (y > 275) { doc.addPage(); y = margin; }
          var cells = qq('th, td', tr).map(function (cell) {
            var i = cell.querySelector('input, select, textarea');
            var v = i ? (i.tagName === 'SELECT' && i.selectedOptions[0] ? i.selectedOptions[0].textContent : i.value) : cell.textContent.trim();
            return v;
          });
          var line = cells.join(' | ');
          var wrapped = doc.splitTextToSize(line, 210 - 2 * margin);
          doc.text(wrapped, margin, y);
          y += wrapped.length * 4;
        });
      } else {
        readValues(sec).forEach(function (f) {
          if (y > 275) { doc.addPage(); y = margin; }
          var line = f.label + ': ' + f.value;
          var wrapped = doc.splitTextToSize(line, 210 - 2 * margin);
          doc.text(wrapped, margin, y);
          y += wrapped.length * 4.5;
        });
      }
      y += 3;
    });

    var safe = (name || 'voltguard-form').replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
    doc.save('voltguard-' + safe + '.pdf');
  }

  function bindDefaults() {
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
        var last = table.tBodies[0].rows[table.tBodies[0].rows.length - 1];
        var clone = last.cloneNode(true);
        qq('input, textarea', clone).forEach(function (el) { el.value = ''; });
        qq('select', clone).forEach(function (el) { el.selectedIndex = 0; });
        table.tBodies[0].appendChild(clone);
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
    tableToCsv: tableToCsv
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindDefaults);
  else bindDefaults();
}(window));
