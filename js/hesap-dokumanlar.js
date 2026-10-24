/* hesap/dokumanlar.html sayfa betiği. CSP için satır içinden taşındı (script-src 'self'); DOM hazır olduktan sonra, sayfa sonunda yüklenir. */
(function () {
  'use strict';
  /* Ortak hesap betikleri yüklenemediyse boş sayfa yerine açık bir hata gösterilir. */  if (!window.VG || !window.VG.Auth || !window.VG.AccountUI) { var gateEl = document.querySelector('[data-vg-gate]'); if (gateEl) { gateEl.hidden = false; gateEl.innerHTML = '<div class="vg-section vg-acct-state vg-acct-state--error" role="alert"><h2>Sayfa tam yüklenemedi</h2><p>Hesap betikleri indirilemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.</p></div>'; } return; }
  var Auth = window.VG.Auth;
  var UI = window.VG.AccountUI;
  var esc = UI.esc;
  var list = document.getElementById('docs-list');
  var form = document.getElementById('new-doc');
  var formAlert = document.getElementById('form-alert');
  var alertEl = document.querySelector('[data-vg-alert]');
  var lastSig = '';

  UI.initPage({
    page: 'dokumanlar',
    protected: true,
    collections: ['documents'],
    onReady: function () {
      document.getElementById('list-section').hidden = false;
      render(true);
    }
  });

  document.addEventListener('vg:data', function (e) {
    var c = e.detail && e.detail.collection;
    if (Auth.isLoggedIn() && (!c || c === 'documents')) render(false);
  });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    UI.clearAlert(formAlert);
    var errors = {};
    var name = form.elements.name.value.trim();
    var url = form.elements.url.value.trim();
    if (!name) errors.name = 'Doküman adı gerekli.';
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) errors.url = 'Geçerli bir http(s) bağlantısı girin (örn. https://...).';
    if (Object.keys(errors).length) { UI.showFormError(form, formAlert, { message: 'Lütfen işaretli alanları kontrol edin.' }, errors); return; }
    try {
      var d = Auth.addDocument(name, url, form.elements.note.value);
      UI.clearFieldErrors(form);
      form.reset();
      render(true);
      UI.alertBox(formAlert, 'success', '“' + d.name + '” kütüphanenize eklendi.');
      form.elements.name.focus();
    } catch (e) {
      UI.showFormError(form, formAlert, e, /bağlantı/i.test(e.message || '') ? { url: e.message } : null);
    }
  });

  function sig(items) { return JSON.stringify(items, function (k, v) { return k === 'serverAt' ? undefined : v; }); }

  function render(force) {
    var items = Auth.getDocuments();
    var s = sig(items);
    if (!force && s === lastSig) return;
    lastSig = s;
    if (!items.length) {
      list.innerHTML = '<div class="vg-acct-state"><span class="vg-acct-state__icon" aria-hidden="true"><i class="fas fa-bookmark"></i></span>' +
        '<h3>Henüz doküman eklenmedi</h3><p>Yukarıdaki formdan ilk yer iminizi ekleyin.</p></div>';
      return;
    }
    list.innerHTML = items.map(function (d) {
      var link = Auth.safeHref(d.url);
      return '<article class="vg-doc-item">' +
        '<h3><i class="fas fa-bookmark" aria-hidden="true" style="color:var(--clr-accent-text)"></i> ' + esc(d.name) + ' <span class="vg-item-meta">' + esc(UI.fmtDate(d.addedAt)) + '</span></h3>' +
        (d.note ? '<p class="vg-item-note" style="margin:0">' + esc(d.note) + '</p>' : '') +
        '<div class="vg-doc-item__actions">' +
        (link ? '<a class="vg-mini-btn" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i> Aç<span class="vg-sr-only">: ' + esc(d.name) + ' (yeni sekmede açılır)</span></a>' : '') +
        '<button type="button" class="vg-mini-btn vg-mini-btn--danger" data-delete="' + esc(d.id) + '" data-name="' + esc(d.name) + '"><i class="fas fa-trash" aria-hidden="true"></i> Sil<span class="vg-sr-only">: ' + esc(d.name) + '</span></button>' +
        '</div></article>';
    }).join('');
  }

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-delete]');
    if (!btn) return;
    var name = btn.getAttribute('data-name');
    UI.confirmDialog({ title: 'Doküman silinsin mi?', message: '“' + name + '” kütüphanenizden kaldırılacak.', confirmText: 'Sil', danger: true }).then(function (ok) {
      if (!ok) return;
      try {
        Auth.deleteDocument(btn.getAttribute('data-delete'));
        render(true);
        UI.alertBox(alertEl, 'success', '“' + name + '” silindi.');
        document.getElementById('list-title').focus();
      } catch (err) { UI.alertBox(alertEl, 'error', UI.errorMessage(err), { focus: true }); }
    });
  });
}());
