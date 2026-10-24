/* hesap/projeler.html sayfa betiği. CSP için satır içinden taşındı (script-src 'self'); DOM hazır olduktan sonra, sayfa sonunda yüklenir. */
(function () {
  'use strict';
  /* Ortak hesap betikleri yüklenemediyse boş sayfa yerine açık bir hata gösterilir. */  if (!window.VG || !window.VG.Auth || !window.VG.AccountUI) { var gateEl = document.querySelector('[data-vg-gate]'); if (gateEl) { gateEl.hidden = false; gateEl.innerHTML = '<div class="vg-section vg-acct-state vg-acct-state--error" role="alert"><h2>Sayfa tam yüklenemedi</h2><p>Hesap betikleri indirilemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.</p></div>'; } return; }
  var Auth = window.VG.Auth;
  var UI = window.VG.AccountUI;
  var esc = UI.esc;
  var list = document.getElementById('projects-list');
  var form = document.getElementById('new-project');
  var formAlert = document.getElementById('form-alert');
  var alertEl = document.querySelector('[data-vg-alert]');
  var lastSig = '';

  UI.initPage({
    page: 'projeler',
    protected: true,
    collections: ['projects', 'history'],
    onReady: function () {
      document.getElementById('list-section').hidden = false;
      render(true);
    }
  });

  document.addEventListener('vg:data', function (e) {
    var c = e.detail && e.detail.collection;
    if (Auth.isLoggedIn() && (!c || c === 'projects' || c === 'history')) render(false);
  });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    UI.clearAlert(formAlert);
    var name = form.elements.name.value.trim();
    if (!name) { UI.showFormError(form, formAlert, { message: 'Lütfen işaretli alanı kontrol edin.' }, { name: 'Proje adı gerekli.' }); return; }
    try {
      var p = Auth.createProject(name, form.elements.description.value);
      UI.clearFieldErrors(form);
      form.reset();
      render(true);
      UI.alertBox(formAlert, 'success', '“' + p.name + '” projesi oluşturuldu.');
      form.elements.name.focus();
    } catch (e) { UI.showFormError(form, formAlert, e); }
  });

  function sig(items) { return JSON.stringify(items, function (k, v) { return k === 'serverAt' ? undefined : v; }); }

  function render(force) {
    var items = Auth.getProjects();
    var history = Auth.getHistory();
    var s = sig([items, history]);
    if (!force && s === lastSig) return;
    lastSig = s;
    if (!items.length) {
      list.innerHTML = '<div class="vg-acct-state"><span class="vg-acct-state__icon" aria-hidden="true"><i class="fas fa-folder"></i></span>' +
        '<h3>Henüz projeniz yok</h3><p>Yukarıdaki formdan ilk projenizi oluşturun.</p></div>';
      return;
    }
    var histMap = {};
    history.forEach(function (h) { histMap[h.id] = h; });
    list.innerHTML = items.map(function (p) {
      var calcs = (p.calcIds || []).map(function (id) { return histMap[id]; }).filter(Boolean);
      var calcsHtml = calcs.length
        ? '<ul class="vg-project-calcs">' + calcs.map(function (c) {
            var link = Auth.safeHref(c.toolUrl);
            return '<li><span>' + (link ? '<a class="vg-link" href="' + esc(link) + '">' + esc(c.toolName) + '</a>' : esc(c.toolName)) + '</span>' +
              ' <strong>' + esc(c.result && c.result.value ? c.result.value : '-') + '</strong>' +
              ' <span class="vg-item-meta">' + esc(UI.fmtDate(c.savedAt)) + '</span>' +
              ' <button type="button" class="vg-mini-btn" data-detach="' + esc(c.id) + '" data-project="' + esc(p.id) + '"><i class="fas fa-xmark" aria-hidden="true"></i> Projeden çıkar<span class="vg-sr-only">: ' + esc(c.toolName) + '</span></button></li>';
          }).join('') + '</ul>'
        : '<p class="vg-item-note">Bu projeye bağlı hesaplama yok. <a class="vg-link" href="gecmis.html">Geçmiş Hesaplamalar</a> sayfasından kayıt ekleyebilirsiniz.</p>';
      return '<article class="vg-project-item">' +
        '<h3><i class="fas fa-folder" aria-hidden="true" style="color:var(--clr-accent-text)"></i> ' + esc(p.name) + ' <span class="vg-item-meta">' + esc(UI.fmtDate(p.createdAt)) + '</span></h3>' +
        (p.description ? '<p class="vg-item-note" style="margin:0">' + esc(p.description) + '</p>' : '') +
        calcsHtml +
        '<div class="vg-project-item__actions">' +
        '<button type="button" class="vg-mini-btn vg-mini-btn--danger" data-delete="' + esc(p.id) + '" data-name="' + esc(p.name) + '"><i class="fas fa-trash" aria-hidden="true"></i> Projeyi sil<span class="vg-sr-only">: ' + esc(p.name) + '</span></button>' +
        '</div></article>';
    }).join('');
  }

  list.addEventListener('click', function (e) {
    var del = e.target.closest('[data-delete]');
    var det = e.target.closest('[data-detach]');
    if (det) {
      try {
        Auth.detachCalcFromProject(det.getAttribute('data-project'), det.getAttribute('data-detach'));
        render(true);
        UI.alertBox(alertEl, 'success', 'Hesaplama projeden çıkarıldı; geçmiş kayıtlarınızda durmaya devam ediyor.');
        document.getElementById('list-title').focus();
      } catch (err) { UI.alertBox(alertEl, 'error', UI.errorMessage(err), { focus: true }); }
      return;
    }
    if (!del) return;
    var name = del.getAttribute('data-name');
    UI.confirmDialog({ title: 'Proje silinsin mi?', message: '“' + name + '” projesi silinecek. Bağlı hesaplamalar silinmez, geçmiş kayıtlarınızda kalır.', confirmText: 'Projeyi sil', danger: true }).then(function (ok) {
      if (!ok) return;
      try {
        Auth.deleteProject(del.getAttribute('data-delete'));
        render(true);
        UI.alertBox(alertEl, 'success', '“' + name + '” projesi silindi.');
        document.getElementById('list-title').focus();
      } catch (err) { UI.alertBox(alertEl, 'error', UI.errorMessage(err), { focus: true }); }
    });
  });
}());
