/* Periyodik kontrol planlayıcı
 * Dayanak: İş Ekipmanlarının Kullanımında Sağlık ve Güvenlik Şartları Yönetmeliği (RG 25.04.2013/28628, son değişiklik
 * 23.12.2025/33116) EK-III Tablo-3: ilgili standartta daha kısa süre yoksa elektrik ve topraklama tesisatı, yıldırımdan
 * korunma, jeneratör, yangın algılama, akümülatör ve transformatör için kontrol periyodu en fazla 1 yıldır.
 * Veriler yalnızca bu tarayıcıda (localStorage) saklanır; hiçbir yere gönderilmez. */
(function () {
  'use strict';
  var KEY = 'vg-periyodik-plan:v1';
  var TYPES = [
    { id: 'elektrik', name: 'Elektrik iç tesisatı', max: 12, std: 'EK-III Tablo-3' },
    { id: 'topraklama', name: 'Topraklama tesisatı', max: 12, std: 'EK-III Tablo-3' },
    { id: 'yildirim', name: 'Yıldırımdan korunma tesisatı', max: 12, std: 'EK-III Tablo-3' },
    { id: 'trafo', name: 'Transformatör', max: 12, std: 'EK-III Tablo-3' },
    { id: 'jenerator', name: 'Jeneratör', max: 12, std: 'EK-III Tablo-3 (TS ISO 8528)' },
    { id: 'aku', name: 'Akümülatör (UPS / akü grubu)', max: 12, std: 'EK-III Tablo-3' },
    { id: 'yangin', name: 'Yangın algılama ve uyarı sistemi', max: 12, std: 'EK-III Tablo-3 (TSE CEN/TS 54-14)' },
    { id: 'ozel', name: 'Diğer (kendi periyodunuz)', max: 120, std: 'Kullanıcı tanımlı' }
  ];
  var byId = {}; TYPES.forEach(function (t) { byId[t.id] = t; });
  var $ = function (s) { return document.querySelector(s); };
  var root = $('#pk-app'); if (!root) return;
  var rows = load();

  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (Array.isArray(d)) return d.filter(valid); } catch (_) { }
    var y = new Date(); y.setMonth(y.getMonth() - 10);
    var iso = y.toISOString().slice(0, 10);
    return [
      { area: 'Ana bina', type: 'elektrik', last: iso, months: 12, note: '' },
      { area: 'Ana bina', type: 'topraklama', last: iso, months: 12, note: '' },
      { area: 'Ana bina', type: 'yildirim', last: iso, months: 12, note: '' }
    ];
  }
  function valid(r) { return r && byId[r.type] && /^\d{4}-\d{2}-\d{2}$/.test(r.last || '') && r.months > 0; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch (_) { } }
  function addMonths(iso, m) {
    var p = iso.split('-').map(Number), d = new Date(p[0], p[1] - 1 + m, p[2]);
    if (d.getDate() !== p[2]) d.setDate(0); // ay sonu taşmasını önle (31 Ocak + 1 ay → 28/29 Şubat)
    return d;
  }
  function parse(iso) { var p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function fmtDate(d) { return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function status(due) {
    var days = Math.round((due - today()) / 864e5);
    if (days < 0) return { cls: 'late', text: Math.abs(days) + ' gün gecikti' };
    if (days <= 30) return { cls: 'soon', text: days + ' gün kaldı' };
    return { cls: 'ok', text: days + ' gün kaldı' };
  }

  function render() {
    var body = $('#pk-rows');
    body.innerHTML = '';
    rows.forEach(function (r, i) {
      var t = byId[r.type], tr = document.createElement('tr');
      tr.innerHTML =
        '<td><label class="sr-only" for="pk-a' + i + '">Alan / tesis</label><input id="pk-a' + i + '" type="text" maxlength="60" value="' + esc(r.area) + '" data-f="area" data-i="' + i + '"></td>' +
        '<td><label class="sr-only" for="pk-t' + i + '">Kontrol konusu</label><select id="pk-t' + i + '" data-f="type" data-i="' + i + '">' + TYPES.map(function (x) { return '<option value="' + x.id + '"' + (x.id === r.type ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></td>' +
        '<td><label class="sr-only" for="pk-l' + i + '">Son kontrol tarihi</label><input id="pk-l' + i + '" type="date" value="' + esc(r.last) + '" data-f="last" data-i="' + i + '"></td>' +
        '<td><label class="sr-only" for="pk-m' + i + '">Periyot (ay)</label><input id="pk-m' + i + '" type="number" min="1" max="' + t.max + '" step="1" inputmode="numeric" value="' + r.months + '" data-f="months" data-i="' + i + '" aria-describedby="pk-mh"></td>' +
        '<td><button type="button" class="pk-del" data-del="' + i + '" aria-label="' + esc((r.area || 'Satır') + ' · ' + t.name) + ' satırını sil">Sil</button></td>';
      body.appendChild(tr);
    });
    renderPlan();
  }
  function renderPlan() {
    var list = rows.map(function (r) { var due = addMonths(r.last, r.months); return { r: r, due: due, st: status(due), t: byId[r.type] }; })
      .sort(function (a, b) { return a.due - b.due; });
    var late = list.filter(function (x) { return x.st.cls === 'late'; }).length, soon = list.filter(function (x) { return x.st.cls === 'soon'; }).length;
    $('#pk-summary').textContent = list.length ? (late ? late + ' kontrol gecikmiş' : 'Gecikmiş kontrol yok') + ' · ' + soon + ' kontrol 30 gün içinde' : 'Listeye en az bir kalem ekleyin.';
    $('#pk-summary').dataset.level = late ? 'late' : soon ? 'soon' : 'ok';
    $('#pk-plan').innerHTML = list.map(function (x) {
      return '<li data-level="' + x.st.cls + '"><strong>' + esc(fmtDate(x.due)) + '</strong> <span>' + esc(x.r.area || '—') + ' · ' + esc(x.t.name) + '</span> <em>' + esc(x.st.text) + '</em></li>';
    }).join('');
  }
  function warn(msg) { var w = $('#pk-warn'); w.textContent = msg || ''; w.hidden = !msg; }

  root.addEventListener('input', function (e) {
    var el = e.target, i = Number(el.dataset.i), f = el.dataset.f; if (!f || !rows[i]) return;
    var v = el.value;
    if (f === 'months') {
      var max = byId[rows[i].type].max, n = Math.round(Number(v));
      if (!(n >= 1)) { el.setAttribute('aria-invalid', 'true'); return; }
      if (n > max) { warn(byId[rows[i].type].name + ' için periyot en fazla ' + max + ' ay olabilir (İş Ekipmanları Yönetmeliği EK-III Tablo-3).'); n = max; el.value = max; }
      else warn('');
      el.removeAttribute('aria-invalid'); v = n;
    }
    if (f === 'last' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { el.setAttribute('aria-invalid', 'true'); return; }
    el.removeAttribute('aria-invalid');
    rows[i][f] = v;
    if (f === 'type') { var t = byId[v]; if (rows[i].months > t.max) rows[i].months = t.max; if (v !== 'ozel') rows[i].months = Math.min(rows[i].months, 12); save(); render(); return; }
    save(); renderPlan();
  });
  root.addEventListener('click', function (e) {
    var d = e.target.closest('[data-del]');
    if (d) { rows.splice(Number(d.dataset.del), 1); save(); render(); return; }
  });
  $('#pk-add').addEventListener('click', function () {
    var last = rows.length ? rows[rows.length - 1] : null;
    rows.push({ area: last ? last.area : '', type: 'elektrik', last: new Date().toISOString().slice(0, 10), months: 12, note: '' });
    save(); render();
    var inputs = root.querySelectorAll('#pk-rows tr:last-child input'); if (inputs[0]) inputs[0].focus();
  });
  $('#pk-ics').addEventListener('click', function () {
    if (!rows.length) return;
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    var seen = {}, uid = function (r) { var k = hash(r.area + '|' + r.type); seen[k] = (seen[k] || 0) + 1; return k + (seen[k] > 1 ? '-' + seen[k] : ''); };
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VoltGuard//Periyodik Kontrol Planlayici//TR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    rows.forEach(function (r) {
      // Gecikmiş kontrol bugüne alınır; aksi hâlde ilk hatırlatma geçmişte kalır
      var t = byId[r.type], due = addMonths(r.last, r.months), late = due < today(), start = late ? today() : due;
      var next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      var title = ((late ? 'GECİKMİŞ: ' : '') + t.name + ' periyodik kontrolü' + (r.area ? ' · ' + r.area : '')).replace(/[,;\\]/g, ' ');
      // Aynı kalem yeniden içe aktarıldığında takvimde çoğalmasın diye UID alan ve konudan türetilir
      lines.push('BEGIN:VEVENT', 'UID:pk-' + uid(r) + '@voltguard.com.tr', 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + ymd(start), 'DTEND;VALUE=DATE:' + ymd(next),
        'RRULE:FREQ=MONTHLY;INTERVAL=' + r.months,
        'SUMMARY:' + title,
        'DESCRIPTION:Dayanak: ' + t.std + ' (İş Ekipmanları Yönetmeliği). Kontrol yetkili kişilerce yapılır ve raporlanır.',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + title, 'TRIGGER:-P14D', 'END:VALARM', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    download('periyodik-kontrol-plani.ics', 'text/calendar;charset=utf-8', lines.map(fold).join('\r\n') + '\r\n');
  });
  $('#pk-csv').addEventListener('click', function () {
    var cell = function (v) { v = String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var out = [['Alan / tesis', 'Kontrol konusu', 'Son kontrol', 'Periyot (ay)', 'Sonraki kontrol', 'Durum', 'Dayanak']];
    rows.forEach(function (r) { var t = byId[r.type], due = addMonths(r.last, r.months); out.push([r.area, t.name, fmtDate(parse(r.last)), r.months, fmtDate(due), status(due).text, t.std]); });
    download('periyodik-kontrol-plani.csv', 'text/csv;charset=utf-8', '﻿' + out.map(function (l) { return l.map(cell).join(';'); }).join('\r\n'));
  });
  $('#pk-print').addEventListener('click', function () { window.print(); });
  $('#pk-reset').addEventListener('click', function () {
    if (!confirm('Bu tarayıcıdaki plan silinsin mi?')) return;
    try { localStorage.removeItem(KEY); } catch (_) { }
    rows = load(); render();
  });
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h.toString(36); }
  // RFC 5545: satır en fazla 75 bayt; devam satırı bir boşlukla başlar
  function fold(line) {
    var out = [], cur = '', n = 0, enc = new TextEncoder();
    Array.from(line).forEach(function (ch) {
      var b = enc.encode(ch).length;
      if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
      cur += ch; n += b;
    });
    out.push(cur); return out.join('\r\n ');
  }
  function download(name, type, text) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  render();
})();
