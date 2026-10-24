/* hesap/gecmis.html sayfa betiği. CSP için satır içinden taşındı (script-src 'self'); DOM hazır olduktan sonra, sayfa sonunda yüklenir. */
(function () {
  'use strict';
  /* Ortak hesap betikleri yüklenemediyse boş sayfa yerine açık bir hata gösterilir. */  if (!window.VG || !window.VG.Auth || !window.VG.AccountUI) { var gateEl = document.querySelector('[data-vg-gate]'); if (gateEl) { gateEl.hidden = false; gateEl.innerHTML = '<div class="vg-section vg-acct-state vg-acct-state--error" role="alert"><h2>Sayfa tam yüklenemedi</h2><p>Hesap betikleri indirilemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.</p></div>'; } return; }
  var Auth = window.VG.Auth;
  var UI = window.VG.AccountUI;
  var esc = UI.esc;
  var list = document.getElementById('history-list');
  var filter = document.getElementById('filter');
  var countEl = document.getElementById('count');
  var alertEl = document.querySelector('[data-vg-alert]');
  var openIds = {};
  var lastSig = '';
  var member = false;

  UI.initPage({
    page: 'gecmis',
    protected: false,
    collections: ['history', 'projects'],
    onReady: function (ctx) {
      member = !!ctx.user;
      var note = document.getElementById('guest-note');
      if (!member) {
        note.innerHTML = '<i class="fas fa-circle-info" aria-hidden="true"></i><div class="vg-acct-alert__body"><p>Bu liste yalnızca bu tarayıcıda saklanıyor. <a href="' + esc(Auth.loginUrl(location.pathname)) + '">Giriş yapın</a> ya da <a href="kayit.html">ücretsiz üye olun</a>; kayıtlarınız hesabınıza aktarılır ve tüm cihazlarınızdan erişilir.</p></div>';
        note.hidden = false;
      } else {
        note.hidden = true;
      }
      render(true);
    }
  });

  document.addEventListener('vg:data', function (e) {
    var c = e.detail && e.detail.collection;
    if (!c || c === 'history' || c === 'projects') render(false);
  });
  filter.addEventListener('input', function () { render(true); });

  function sig(items) { return JSON.stringify(items, function (k, v) { return k === 'serverAt' ? undefined : v; }); }

  function render(force) {
    var all = Auth.getHistory();
    var projects = member ? Auth.getProjects() : [];
    var s = sig([all, projects, member]);
    if (!force && s === lastSig) return;
    lastSig = s;
    var q = filter.value.trim().toLocaleLowerCase('tr');
    var items = q ? all.filter(function (h) { return String(h.toolName || '').toLocaleLowerCase('tr').indexOf(q) >= 0; }) : all;
    countEl.textContent = all.length ? (q ? items.length + ' / ' + all.length + ' kayıt gösteriliyor' : all.length + ' kayıt') : '';
    filter.parentNode.hidden = all.length < 4;
    if (!all.length) {
      list.innerHTML = '<div class="vg-acct-state"><span class="vg-acct-state__icon" aria-hidden="true"><i class="fas fa-calculator"></i></span>' +
        '<h2>Henüz kayıtlı hesaplama yok</h2><p><a class="vg-link" href="/hesaplama-araclari/">Hesap Araçları</a>\'ndan bir araç açın ve sonucun altındaki “Hesabıma kaydet” düğmesine basın.</p></div>';
      return;
    }
    if (!items.length) { list.innerHTML = '<div class="vg-empty">Aramanızla eşleşen kayıt yok.</div>'; return; }
    var focusKey = document.activeElement && list.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
    var projById = {};
    projects.forEach(function (p) { projById[p.id] = p; });
    list.innerHTML = items.map(function (h) { return renderItem(h, projects); }).join('');
    if (focusKey) { var f = list.querySelector('[data-key="' + focusKey + '"]'); if (f) f.focus(); }
  }

  function renderItem(h, projects) {
    var link = Auth.safeHref(h.toolUrl);
    var params = (h.params || []).filter(function (p) { return p && (p.label || p.value); });
    var paramsHtml = params.length ? '<dl class="vg-history-item__params">' + params.map(function (p) {
      return '<dt>' + esc(p.label || '-') + '</dt><dd>' + esc(p.value || '-') + '</dd>';
    }).join('') + '</dl>' : '';
    // Hesap dökümü satırları (ör. işletme sorumluluğu kalemleri) kayıtla birlikte saklanır.
    var breakdown = h.result && Array.isArray(h.result.breakdown) ? h.result.breakdown.filter(function (l) { return typeof l === 'string' && l; }) : [];
    var breakdownHtml = breakdown.length ? '<ul class="vg-history-item__breakdown" aria-label="Hesap dökümü">' + breakdown.map(function (l) {
      return '<li>' + esc(l) + '</li>';
    }).join('') + '</ul>' : '';
    var inProjects = projects.filter(function (p) { return (p.calcIds || []).indexOf(h.id) >= 0; });
    var attach = '';
    if (member) {
      var opts = projects.filter(function (p) { return inProjects.indexOf(p) < 0; });
      attach = projects.length
        ? (opts.length ? '<label class="vg-sr-only" for="att-' + esc(h.id) + '">Projeye ekle: ' + esc(h.toolName) + '</label>' +
           '<select id="att-' + esc(h.id) + '" class="vg-item-select" data-attach="' + esc(h.id) + '" data-key="att-' + esc(h.id) + '"><option value="">Projeye ekle…</option>' +
           opts.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select>' : '')
        : '<a class="vg-mini-btn" href="projeler.html"><i class="fas fa-folder-plus" aria-hidden="true"></i> Proje oluştur</a>';
    }
    return '<details class="vg-history-item" data-id="' + esc(h.id) + '"' + (openIds[h.id] ? ' open' : '') + '>' +
      '<summary data-key="sum-' + esc(h.id) + '"><div class="vg-history-item__head"><h3>' + esc(h.toolName) + '</h3>' +
      '<span class="vg-history-item__chev" aria-hidden="true"><i class="fas fa-chevron-down"></i></span></div>' +
      '<div class="vg-history-item__meta">' + esc(UI.fmtDateTime(h.savedAt)) + (inProjects.length ? ' · Proje: ' + inProjects.map(function (p) { return esc(p.name); }).join(', ') : '') + '</div>' +
      '<div class="vg-history-item__value">' + esc(h.result && h.result.value ? h.result.value : '-') + '</div></summary>' +
      paramsHtml +
      (h.result && h.result.note ? '<p class="vg-item-note">' + esc(h.result.note) + '</p>' : '') +
      breakdownHtml +
      (h.note ? '<p class="vg-item-note"><strong>Not:</strong> ' + esc(h.note) + '</p>' : '') +
      '<div class="vg-history-item__actions">' +
      (link ? '<a class="vg-mini-btn" href="' + esc(link) + '"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i> Aracı yeniden aç</a>' : '') +
      attach +
      '<button type="button" class="vg-mini-btn vg-mini-btn--danger" data-delete="' + esc(h.id) + '" data-key="del-' + esc(h.id) + '"><i class="fas fa-trash" aria-hidden="true"></i> Sil<span class="vg-sr-only">: ' + esc(h.toolName) + '</span></button>' +
      '</div></details>';
  }

  list.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.matches && d.matches('details[data-id]')) { if (d.open) openIds[d.getAttribute('data-id')] = 1; else delete openIds[d.getAttribute('data-id')]; }
  }, true);

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-delete]');
    if (!btn) return;
    var id = btn.getAttribute('data-delete');
    UI.confirmDialog({ title: 'Kayıt silinsin mi?', message: 'Bu hesaplama kaydı kalıcı olarak silinecek; bağlı olduğu projelerden de çıkarılır.', confirmText: 'Kaydı sil', danger: true }).then(function (ok) {
      if (!ok) return;
      try {
        Auth.deleteHistory(id);
        delete openIds[id];
        render(true);
        UI.alertBox(alertEl, 'success', 'Kayıt silindi.');
        document.getElementById('page-title').setAttribute('tabindex', '-1');
        document.getElementById('page-title').focus();
      } catch (err) { UI.alertBox(alertEl, 'error', UI.errorMessage(err), { focus: true }); }
    });
  });

  list.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-attach]');
    if (!sel || !sel.value) return;
    var pid = sel.value;
    var p = Auth.getProjects().filter(function (x) { return x.id === pid; })[0];
    try {
      Auth.attachCalcToProject(pid, sel.getAttribute('data-attach'));
      render(true);
      UI.alertBox(alertEl, 'success', 'Kayıt “' + (p ? p.name : 'proje') + '” projesine eklendi.');
    } catch (err) { UI.alertBox(alertEl, 'error', UI.errorMessage(err), { focus: true }); }
  });
}());
