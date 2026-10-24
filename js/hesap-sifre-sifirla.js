/* hesap/sifre-sifirla.html sayfa betiği. CSP için satır içinden taşındı (script-src 'self'); DOM hazır olduktan sonra, sayfa sonunda yüklenir. */
(function () {
  'use strict';
  if (!window.VG || !window.VG.Auth || !window.VG.AccountUI) {
    var failEl = document.getElementById('request-alert');
    failEl.className = 'vg-acct-alert vg-acct-alert--error';
    failEl.setAttribute('role', 'alert');
    failEl.textContent = 'Sayfa tam yüklenemedi. Lütfen bağlantınızı kontrol edip sayfayı yenileyin.';
    failEl.hidden = false;
    return;
  }
  var Auth = window.VG.Auth;
  var UI = window.VG.AccountUI;
  var $ = function (id) { return document.getElementById(id); };

  /* Jeton URL'nin #t= parçasında gelir: sunucuya, günlüklere veya Referer başlığına gitmez. Okunduktan sonra adres çubuğundan silinir. */
  var token = '';
  /* Bağlantı bu sayfa açıkken aynı sekmeye yapıştırılırsa (yalnızca # değişir, sayfa yenilenmez) sayfayı baştan yükle. */
  window.addEventListener('hashchange', function () { if (/(?:^#|&)t=/.test(location.hash)) location.reload(); });
  var m = location.hash.match(/(?:^#|&)t=([A-Za-z0-9_-]{20,100})/);
  if (m) {
    token = m[1];
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* eski tarayıcı */ }
  }

  if (token) {
    $('request-view').hidden = true;
    $('reset-view').hidden = false;
    document.querySelector('section.vg-auth-card').setAttribute('aria-labelledby', 'reset-title-2');
    UI.bindPasswordRules($('new-password'), $('reset-rules'));
    var resetForm = $('reset-form');
    var resetAlert = $('reset-alert');
    resetForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      UI.clearAlert(resetAlert);
      var p1 = $('new-password').value, p2 = $('new-password2').value;
      var errors = {};
      var pe = UI.passwordProblem(p1);
      if (pe) errors.password = pe;
      else if (p1 !== p2) errors.password2 = 'Şifreler eşleşmiyor.';
      if (Object.keys(errors).length) { UI.showFormError(resetForm, resetAlert, { message: 'Lütfen işaretli alanları kontrol edin.' }, errors); return; }
      UI.clearFieldErrors(resetForm);
      var btn = resetForm.querySelector('button[type="submit"]');
      UI.busy(btn, true, 'Kaydediliyor…');
      Auth.resetPassword(token, p1).then(function (msg) {
        Auth.setFlash('success', msg);
        location.replace('giris.html');
      }, function (e) {
        UI.busy(btn, false);
        if (e && e.code === 'invalid_token') {
          UI.alertBox(resetAlert, 'error', e.message, {
            focus: true,
            html: '<div class="vg-acct-alert__actions"><a class="vg-btn vg-btn--ghost vg-btn--sm" href="sifre-sifirla.html">Yeni bağlantı iste</a></div>'
          });
          resetForm.hidden = true;
          return;
        }
        UI.showFormError(resetForm, resetAlert, e);
      });
    });
    UI.enableSubmit(resetForm);
    return;
  }

  /* İstek görünümü */
  var form = $('request-form');
  var alertEl = $('request-alert');
  var emailIn = $('email');
  try {
    var remembered = sessionStorage.getItem('vg_reset_email');
    sessionStorage.removeItem('vg_reset_email');
    if (remembered && !emailIn.value) emailIn.value = remembered;
  } catch (e) { /* depolama kapalı */ }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    UI.clearAlert(alertEl);
    if (!UI.validEmail(emailIn.value)) {
      UI.showFormError(form, alertEl, { message: 'Lütfen işaretli alanı kontrol edin.' }, { email: 'Geçerli bir e-posta adresi girin.' });
      return;
    }
    UI.clearFieldErrors(form);
    var btn = form.querySelector('button[type="submit"]');
    UI.busy(btn, true, 'Talep alınıyor…');
    Auth.forgotPassword(emailIn.value).then(function (msg) {
      UI.busy(btn, false);
      form.hidden = true;
      $('request-done').hidden = false;
      UI.alertBox(alertEl, 'info', msg, { focus: true });
    }, function (e) {
      UI.busy(btn, false);
      UI.showFormError(form, alertEl, e);
    });
  });
  $('request-again').addEventListener('click', function () {
    UI.clearAlert(alertEl);
    $('request-done').hidden = true;
    form.hidden = false;
    emailIn.value = '';
    emailIn.focus();
  });
  UI.enableSubmit(form);
}());
