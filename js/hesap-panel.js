/* hesap/panel.html sayfa betiği. CSP için satır içinden taşındı (script-src 'self'); DOM hazır olduktan sonra, sayfa sonunda yüklenir. */
(function () {
  'use strict';
  /* Ortak hesap betikleri yüklenemediyse boş sayfa yerine açık bir hata gösterilir. */  if (!window.VG || !window.VG.Auth || !window.VG.AccountUI) { var gateEl = document.querySelector('[data-vg-gate]'); if (gateEl) { gateEl.hidden = false; gateEl.innerHTML = '<div class="vg-section vg-acct-state vg-acct-state--error" role="alert"><h2>Sayfa tam yüklenemedi</h2><p>Hesap betikleri indirilemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.</p></div>'; } return; }
  var Auth = window.VG.Auth;
  var UI = window.VG.AccountUI;
  var esc = UI.esc;
  var $ = function (id) { return document.getElementById(id); };
  var user = null;

  UI.initPage({
    page: 'panel',
    protected: true,
    collections: ['history', 'favorites', 'projects', 'documents'],
    onReady: function (ctx) {
      user = ctx.user;
      fillUser();
      render();
      initLegacy();
    }
  });

  document.addEventListener('vg:data', function () { if (user && Auth.isLoggedIn()) render(); });

  function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

  function fillUser() {
    user = Auth.currentUser() || user;
    $('welcome-title').textContent = 'Merhaba, ' + (firstName(user.name) || 'hoş geldiniz');
    var since = UI.fmtDate(user.createdAt);
    $('welcome-meta').textContent = user.email + (since ? ' · Üyelik: ' + since : '');
    $('p-name').value = user.name;
    $('p-email').value = user.email;
    $('p-company').value = user.company || '';
    $('p-phone').value = user.phone || '';
    $('pw-username').value = user.email;
    $('del-username').value = user.email;
    $('p-pass-wrap').hidden = true;
  }

  function render() {
    var history = Auth.getHistory();
    var favs = Auth.getFavorites();
    $('stat-history').textContent = history.length;
    $('stat-fav').textContent = favs.length;
    $('stat-proj').textContent = Auth.getProjects().length;
    $('stat-doc').textContent = Auth.getDocuments().length;

    var recent = $('recent-list');
    if (!history.length) {
      recent.innerHTML = '<div class="vg-empty">Henüz kayıtlı hesaplamanız yok. <a href="/hesaplama-araclari/">Hesap Araçları</a>\'ndan bir araç açıp “Hesabıma kaydet” düğmesine basın.</div>';
    } else {
      recent.innerHTML = history.slice(0, 5).map(function (h) {
        var link = Auth.safeHref(h.toolUrl);
        return '<article class="vg-history-item">' +
          '<h3>' + (link ? '<a href="' + esc(link) + '" style="color:inherit">' + esc(h.toolName) + '</a>' : esc(h.toolName)) + '</h3>' +
          '<div class="vg-history-item__meta">' + esc(UI.fmtDateTime(h.savedAt)) + '</div>' +
          '<div class="vg-history-item__value">' + esc(h.result && h.result.value ? h.result.value : '-') + '</div>' +
          '</article>';
      }).join('') + (history.length > 5 ? '<p style="margin:0"><a class="vg-link" href="gecmis.html">Tüm hesaplamaları gör (' + history.length + ')</a></p>' : '');
    }

    var favWrap = $('recent-fav');
    if (!favs.length) {
      favWrap.innerHTML = '<div class="vg-empty">Favori aracınız yok. <a href="/hesaplama-araclari/">Araçları keşfedin</a> ve “Favorilere ekle” düğmesine basın.</div>';
    } else {
      favWrap.innerHTML = favs.slice(0, 6).map(function (f) {
        var link = Auth.safeHref(f.toolUrl);
        return '<article class="vg-favorite-item"><h3><i class="fas fa-star" style="color:var(--clr-accent-text)" aria-hidden="true"></i> ' + esc(f.toolName) + '</h3>' +
          (link ? '<div class="vg-favorite-item__actions"><a class="vg-mini-btn" href="' + esc(link) + '"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i> Aracı aç<span class="vg-sr-only">: ' + esc(f.toolName) + '</span></a></div>' : '') +
          '</article>';
      }).join('') + (favs.length > 6 ? '<p style="margin:0"><a class="vg-link" href="favoriler.html">Tüm favoriler (' + favs.length + ')</a></p>' : '');
    }
  }

  /* ---- Eski (yalnızca tarayıcıda tutulan) hesap kayıtları ---- */
  /* Birden fazla eski hesap varsa kullanıcı kendi eski hesabını seçer (yalnızca e-posta adresi eşleşen önceden seçili
     gelir); yalnızca seçilen hesabın kayıtları taşınır ve tarayıcıdan kaldırılır, diğerlerine dokunulmaz. */
  function initLegacy() {
    var card = $('eski-veriler');
    var info = Auth.legacy.detect();
    if (!info || !info.total) { card.hidden = true; return; }
    var withData = info.users.filter(function (u) { return u.total > 0; });
    var picked = Auth.legacy.pick(info, user.email);
    var sel = $('legacy-pick');
    UI.clearAlert($('legacy-status'));
    if (withData.length > 1) {
      $('legacy-text').textContent = 'Hesap sistemimiz yenilenmeden önce bu tarayıcıda tutulan ' + withData.length + ' eski hesaba ait kayıt bulundu. ' +
        'Kendi eski hesabınızı seçip kayıtlarını (hesaplama, favori, proje, doküman) hesabınıza taşıyabilirsiniz; hesabınızda zaten olan kayıtlar tekrar eklenmez. Eski şifreler taşınmaz.';
      sel.innerHTML = (picked ? '' : '<option value="" selected disabled>Eski hesabınızı seçin</option>') + withData.map(function (u) {
        return '<option value="' + esc(u.id) + '"' + (picked && picked.id === u.id ? ' selected' : '') + '>' + esc(u.email || u.name || 'Eski hesap') + ' (' + u.total + ' kayıt)</option>';
      }).join('');
      $('legacy-pick-wrap').hidden = false;
    } else {
      var only = withData[0];
      $('legacy-text').textContent = 'Hesap sistemimiz yenilenmeden önce bu tarayıcıda tutulan ' + (only ? only.total : info.total) +
        ' kayıt bulundu (hesaplama, favori, proje, doküman). Bunları tek adımda hesabınıza taşıyabilirsiniz; hesabınızda zaten olan kayıtlar tekrar eklenmez. Eski şifreler taşınmaz.';
      sel.innerHTML = '';
      $('legacy-pick-wrap').hidden = true;
    }
    card.hidden = false;
    if (location.hash === '#eski-veriler') card.scrollIntoView({ block: 'start' });
  }
  $('legacy-move').addEventListener('click', function () {
    var btn = this;
    var sel = $('legacy-pick');
    var choose = !$('legacy-pick-wrap').hidden;
    UI.clearAlert($('legacy-status'));
    if (choose && !sel.value) {
      UI.alertBox($('legacy-status'), 'error', 'Taşınacak eski hesabı seçin.');
      sel.focus();
      return;
    }
    UI.busy(btn, true, 'Taşınıyor…');
    Auth.legacy.migrate(choose ? sel.value : null).then(function (c) {
      var n = c.history + c.favorites + c.projects + c.documents;
      UI.busy(btn, false);
      UI.alertBox(document.querySelector('[data-vg-alert]'), 'success', n ? n + ' eski kayıt hesabınıza taşındı (' + c.history + ' hesaplama, ' + c.favorites + ' favori, ' + c.projects + ' proje, ' + c.documents + ' doküman). Taşınan kayıtlar bu tarayıcıdan kaldırıldı.' : 'Eski kayıtlarınız hesabınızda zaten vardı. Tarayıcıdaki eski kopyalar kaldırıldı.', { focus: true });
      initLegacy();
      render();
    }, function (e) {
      UI.busy(btn, false);
      UI.alertBox($('legacy-status'), 'error', 'Kayıtlar taşınamadı: ' + UI.errorMessage(e));
    });
  });
  $('legacy-later').addEventListener('click', function () {
    Auth.legacy.dismiss();
    $('eski-veriler').hidden = true;
  });
  $('legacy-drop').addEventListener('click', function () {
    UI.confirmDialog({ title: 'Eski kayıtlar silinsin mi?', message: 'Bu tarayıcıda tutulan eski hesap kayıtları kalıcı olarak silinecek. Hesabınızdaki kayıtlar etkilenmez.', confirmText: 'Eski kayıtları sil', danger: true }).then(function (ok) {
      if (!ok) return;
      Auth.legacy.discard('discarded');
      $('eski-veriler').hidden = true;
      UI.alertBox(document.querySelector('[data-vg-alert]'), 'success', 'Eski kayıtlar bu tarayıcıdan silindi.', { focus: true });
    });
  });

  /* ---- Profil ---- */
  var profileForm = $('profile-form');
  $('p-email').addEventListener('input', function () {
    var changed = user && this.value.trim().toLowerCase() !== user.email;
    $('p-pass-wrap').hidden = !changed;
  });
  profileForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var al = $('profile-alert');
    UI.clearAlert(al);
    var errors = {};
    var nameErr = UI.nameProblem($('p-name').value);
    if (nameErr) errors.name = nameErr;
    var email = $('p-email').value.trim();
    if (!UI.validEmail(email)) errors.email = 'Geçerli bir e-posta adresi girin.';
    var phoneErr = UI.phoneProblem($('p-phone').value);
    if (phoneErr) errors.phone = phoneErr;
    var emailChanged = email.toLowerCase() !== user.email;
    if (emailChanged && !$('p-password').value) errors.password = 'E-posta değişikliği için mevcut şifrenizi girin.';
    if (Object.keys(errors).length) { UI.showFormError(profileForm, al, { message: 'Lütfen işaretli alanları kontrol edin.' }, errors); return; }
    UI.clearFieldErrors(profileForm);
    var btn = profileForm.querySelector('button[type="submit"]');
    UI.busy(btn, true, 'Kaydediliyor…');
    var body = { name: $('p-name').value, company: $('p-company').value, phone: $('p-phone').value };
    if (emailChanged) { body.email = email; body.password = $('p-password').value; }
    Auth.updateProfile(body).then(function (u) {
      UI.busy(btn, false);
      user = u;
      $('p-password').value = '';
      fillUser();
      UI.alertBox(al, 'success', emailChanged ? 'Bilgileriniz ve e-posta adresiniz güncellendi. Eski adresinize bilgilendirme e-postası gönderildi; diğer cihazlardaki oturumlarınız kapatıldı.' : 'Bilgileriniz güncellendi.');
    }, function (e) {
      UI.busy(btn, false);
      UI.showFormError(profileForm, al, e);
    });
  });

  /* ---- Şifre değiştir ---- */
  var pwForm = $('pw-form');
  UI.bindPasswordRules($('pw-new'), $('pw-new-rules'));
  pwForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var al = $('pw-alert');
    UI.clearAlert(al);
    var errors = {};
    if (!$('pw-current').value) errors.current = 'Mevcut şifrenizi girin.';
    var p = UI.passwordProblem($('pw-new').value);
    if (p) errors.password = p;
    else if ($('pw-new').value !== $('pw-new2').value) errors.password2 = 'Şifreler eşleşmiyor.';
    if (Object.keys(errors).length) { UI.showFormError(pwForm, al, { message: 'Lütfen işaretli alanları kontrol edin.' }, errors); return; }
    UI.clearFieldErrors(pwForm);
    var btn = pwForm.querySelector('button[type="submit"]');
    UI.busy(btn, true, 'Güncelleniyor…');
    Auth.changePassword($('pw-current').value, $('pw-new').value).then(function (msg) {
      UI.busy(btn, false);
      pwForm.reset();
      $('pw-username').value = user.email;
      UI.bindPasswordRules($('pw-new'), $('pw-new-rules'));
      UI.alertBox(al, 'success', msg, { focus: true });
    }, function (e) {
      UI.busy(btn, false);
      UI.showFormError(pwForm, al, e);
    });
  });

  /* ---- Dışa aktar (sunucudaki tüm veriler) ---- */
  $('export-btn').addEventListener('click', function () {
    var btn = this;
    var al = $('data-alert');
    UI.clearAlert(al);
    UI.busy(btn, true, 'Hazırlanıyor…');
    Auth.exportAccount().then(function (res) {
      UI.busy(btn, false);
      var blob = new Blob([res.text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      UI.alertBox(al, 'success', 'Verileriniz “' + res.filename + '” adıyla indirildi.');
    }, function (e) {
      UI.busy(btn, false);
      UI.alertBox(al, 'error', 'Veriler indirilemedi: ' + UI.errorMessage(e), { focus: true });
    });
  });

  /* ---- İçe aktar ---- */
  var importFile = $('import-file');
  $('import-btn').addEventListener('click', function () { importFile.click(); });
  importFile.addEventListener('change', function () {
    var file = importFile.files && importFile.files[0];
    var al = $('data-alert');
    if (!file) return;
    importFile.value = '';
    if (file.size > 5 * 1024 * 1024) { UI.alertBox(al, 'error', 'Dosya çok büyük (en fazla 5 MB).', { focus: true }); return; }
    var btn = $('import-btn');
    UI.busy(btn, true, 'İçe aktarılıyor…');
    var reader = new FileReader();
    reader.onerror = function () { UI.busy(btn, false); UI.alertBox(al, 'error', 'Dosya okunamadı.', { focus: true }); };
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result)); }
      catch (e) { UI.busy(btn, false); UI.alertBox(al, 'error', 'Dosya geçerli bir JSON yedeği değil.', { focus: true }); return; }
      Auth.importAll(data).then(function (c) {
        UI.busy(btn, false);
        var total = c.history + c.favorites + c.projects + c.documents;
        UI.alertBox(al, 'success', total
          ? 'İçe aktarıldı: ' + c.history + ' hesaplama, ' + c.favorites + ' favori, ' + c.projects + ' proje, ' + c.documents + ' doküman.'
          : 'Yedekteki kayıtlar hesabınızda zaten var; yeni kayıt eklenmedi.', { focus: true });
        render();
      }, function (e) {
        UI.busy(btn, false);
        UI.alertBox(al, 'error', 'İçe aktarma tamamlanamadı: ' + UI.errorMessage(e), { focus: true });
      });
    };
    reader.readAsText(file);
  });

  /* ---- Hesabı sil ---- */
  var dlg = $('delete-dialog');
  var delForm = $('delete-form');
  var opener = $('delete-open');
  opener.addEventListener('click', function () {
    delForm.reset();
    $('del-username').value = user ? user.email : '';
    UI.clearFieldErrors(delForm);
    UI.clearAlert($('delete-alert'));
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    $('del-password').focus();
  });
  function closeDlg() { if (dlg.open) { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); } }
  dlg.addEventListener('close', function () { opener.focus(); });
  $('delete-cancel').addEventListener('click', closeDlg);
  delForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var al = $('delete-alert');
    UI.clearAlert(al);
    var errors = {};
    if (!$('del-password').value) errors.password = 'Şifrenizi girin.';
    if (!$('del-confirm').checked) errors.confirm = 'Silme işlemini onaylamak için kutuyu işaretleyin.';
    if (Object.keys(errors).length) { UI.showFormError(delForm, al, { message: 'Lütfen işaretli alanları kontrol edin.' }, errors); return; }
    var btn = $('delete-submit');
    UI.busy(btn, true, 'Siliniyor…');
    UI.setLeaving(true);
    Auth.deleteAccount($('del-password').value).then(function (msg) {
      user = null;
      Auth.setFlash('success', msg);
      location.replace('giris.html');
    }, function (e) {
      UI.setLeaving(false);
      UI.busy(btn, false);
      UI.showFormError(delForm, al, e);
    });
  });
}());
