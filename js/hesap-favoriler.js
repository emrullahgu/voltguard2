/* hesap/favoriler.html sayfa betiği. CSP için satır içinden taşındı (script-src 'self'); DOM hazır olduktan sonra, sayfa sonunda yüklenir. */
(function () {
  'use strict';
  /* Ortak hesap betikleri yüklenemediyse boş sayfa yerine açık bir hata gösterilir. */  if (!window.VG || !window.VG.Auth || !window.VG.AccountUI) { var gateEl = document.querySelector('[data-vg-gate]'); if (gateEl) { gateEl.hidden = false; gateEl.innerHTML = '<div class="vg-section vg-acct-state vg-acct-state--error" role="alert"><h2>Sayfa tam yüklenemedi</h2><p>Hesap betikleri indirilemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.</p></div>'; } return; }
  var Auth = window.VG.Auth;
  var UI = window.VG.AccountUI;
  var esc = UI.esc;
  var list = document.getElementById('fav-list');
  var alertEl = document.querySelector('[data-vg-alert]');
  var lastSig = '';

  UI.initPage({
    page: 'favoriler',
    protected: false,
    collections: ['favorites'],
    onReady: function (ctx) {
      var note = document.getElementById('guest-note');
      if (!ctx.user) {
        note.innerHTML = '<i class="fas fa-circle-info" aria-hidden="true"></i><div class="vg-acct-alert__body"><p>Bu liste yalnızca bu tarayıcıda saklanıyor. <a href="' + esc(Auth.loginUrl(location.pathname)) + '">Giriş yapın</a> ya da <a href="kayit.html">ücretsiz üye olun</a>; favorileriniz hesabınıza aktarılır ve tüm cihazlarınızda görünür.</p></div>';
        note.hidden = false;
      } else {
        note.hidden = true;
      }
      render(true);
    }
  });

  document.addEventListener('vg:data', function (e) {
    if (!e.detail || !e.detail.collection || e.detail.collection === 'favorites') render(false);
  });

  function sig(items) { return JSON.stringify(items, function (k, v) { return k === 'serverAt' ? undefined : v; }); }

  function render(force) {
    var items = Auth.getFavorites();
    var s = sig(items);
    if (!force && s === lastSig) return;
    lastSig = s;
    document.getElementById('count').textContent = items.length ? items.length + ' favori araç' : '';
    if (!items.length) {
      list.innerHTML = '<div class="vg-acct-state"><span class="vg-acct-state__icon" aria-hidden="true"><i class="fas fa-star"></i></span>' +
        '<h2>Henüz favori aracınız yok</h2><p><a class="vg-link" href="/hesaplama-araclari/">Hesap Araçları</a>\'ndan bir araç açın ve “Favorilere ekle” düğmesine basın.</p></div>';
      return;
    }
    list.innerHTML = items.map(function (f) {
      var link = Auth.safeHref(f.toolUrl);
      return '<article class="vg-favorite-item">' +
        '<h3><i class="fas fa-star" style="color:var(--clr-accent-text)" aria-hidden="true"></i> ' + esc(f.toolName) + '</h3>' +
        '<div class="vg-favorite-item__meta">Eklendi: ' + esc(UI.fmtDate(f.addedAt)) + '</div>' +
        '<div class="vg-favorite-item__actions">' +
        (link ? '<a class="vg-mini-btn" href="' + esc(link) + '"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i> Aracı aç<span class="vg-sr-only">: ' + esc(f.toolName) + '</span></a>' : '') +
        '<button type="button" class="vg-mini-btn vg-mini-btn--danger" data-remove="' + esc(f.toolSlug) + '" data-name="' + esc(f.toolName) + '"><i class="fas fa-trash" aria-hidden="true"></i> Kaldır<span class="vg-sr-only">: ' + esc(f.toolName) + '</span></button>' +
        '</div></article>';
    }).join('');
  }

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remove]');
    if (!btn) return;
    try {
      Auth.toggleFavorite(btn.getAttribute('data-remove'), '', '');
      render(true);
      UI.alertBox(alertEl, 'success', '“' + btn.getAttribute('data-name') + '” favorilerden kaldırıldı.');
      document.getElementById('page-title').focus();
    } catch (err) { UI.alertBox(alertEl, 'error', UI.errorMessage(err), { focus: true }); }
  });
}());
